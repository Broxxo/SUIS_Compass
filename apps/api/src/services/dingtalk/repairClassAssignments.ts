import pool from '../../config/database.js';
import { getCachedDingTalkPreview, seedDingTalkPreviewCache } from './preview.js';
import type { DingTalkPreviewResult } from './types.js';
import { resolveDingTalkClassMatch } from './classNameMapping.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type RepairClassAssignmentsResult = {
  ok: boolean;
  error: string | null;
  academicYearId: string | null;
  updated: number;
  unchanged: number;
  skipped: number;
  samples: Array<{ name: string; from: string | null; to: string }>;
};

export async function repairStudentClassAssignmentsFromDingTalk(
  clientPreview?: DingTalkPreviewResult | null,
): Promise<RepairClassAssignmentsResult> {
  if ((!getCachedDingTalkPreview()?.fetchedAt) && clientPreview?.fetchedAt) {
    seedDingTalkPreviewCache(clientPreview);
  }
  const preview = getCachedDingTalkPreview();
  if (!preview?.fetchedAt || preview.students.length === 0) {
    return {
      ok: false,
      error: '暂无钉钉快照，请先在「钉钉 API」点击刷新',
      academicYearId: null,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      samples: [],
    };
  }

  const year = (await pool.query(
    `SELECT id FROM academic_years WHERE is_current = TRUE ORDER BY updated_at DESC LIMIT 1`,
  )).rows[0] as { id: string } | undefined;
  if (!year) {
    return {
      ok: false,
      error: '未设置当前学年',
      academicYearId: null,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      samples: [],
    };
  }

  const localClasses = (await pool.query(
    `SELECT id, name, grade, academic_year_id FROM classes WHERE academic_year_id = $1`,
    [year.id],
  )).rows as Array<{ id: string; name: string; grade: number; academic_year_id: string }>;

  const dtByUserId = new Map(preview.students.map((s) => [s.userid, s]));
  const students = (await pool.query(
    `SELECT s.id, s.dingtalk_user_id, s.name, s.name_zh, s.current_class_id, c.name AS class_name
     FROM students s
     LEFT JOIN classes c ON c.id = s.current_class_id
     WHERE s.status = 'active' AND s.dingtalk_user_id IS NOT NULL`,
  )).rows as Array<{
    id: string;
    dingtalk_user_id: string;
    name: string;
    name_zh: string | null;
    current_class_id: string | null;
    class_name: string | null;
  }>;

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const samples: RepairClassAssignmentsResult['samples'] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of students) {
      const dt = dtByUserId.get(row.dingtalk_user_id);
      if (!dt) {
        skipped += 1;
        continue;
      }

      const { classMatch } = resolveDingTalkClassMatch(
        {
          className: dt.className,
          gradeName: dt.gradeName,
          gradeLevel: dt.gradeLevel,
          classPath: dt.classPath,
        },
        localClasses,
      );

      if (!classMatch) {
        skipped += 1;
        continue;
      }

      if (row.current_class_id === classMatch.classId) {
        unchanged += 1;
        continue;
      }

      await client.query(
        `UPDATE students SET
           current_class_id = $2,
           current_grade = $3,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id, classMatch.classId, classMatch.grade],
      );

      await client.query(
        `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, academic_year_id)
         DO UPDATE SET class_id = EXCLUDED.class_id`,
        [createId('enr'), row.id, classMatch.classId, year.id],
      );

      updated += 1;
      if (samples.length < 15) {
        samples.push({
          name: row.name_zh ?? row.name,
          from: row.class_name,
          to: classMatch.className,
        });
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Repair failed',
      academicYearId: year.id,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      samples,
    };
  } finally {
    client.release();
  }

  return {
    ok: true,
    error: null,
    academicYearId: year.id,
    updated,
    unchanged,
    skipped,
    samples,
  };
}
