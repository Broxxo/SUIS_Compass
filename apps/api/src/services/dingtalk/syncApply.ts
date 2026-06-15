import pool from '../../config/database.js';
import { getCachedDingTalkPreview, seedDingTalkPreviewCache } from './preview.js';
import type { DingTalkPreviewResult } from './types.js';
import { ensureDingTalkUserIdColumn } from './ensureDingTalkUserId.js';
import { matchDingTalkStudentToLocalClass } from './classNameMapping.js';
import { buildDingTalkSyncPlan, getCurrentAcademicYear, type DingTalkSyncPlan } from './syncPlan.js';
import {
  resolveStudentNumberForSyncInsert,
  resolveStudentNumberForSyncUpdate,
} from './studentNumber.js';

export type DingTalkSyncApplyInput = {
  actionIds: string[];
  clientPreview?: DingTalkPreviewResult | null;
  /** 前端已生成的差异计划，与快照 fetchedAt 一致时可跳过重复比对 */
  plan?: DingTalkSyncPlan | null;
};

export type DingTalkSyncApplyResult = {
  ok: boolean;
  error: string | null;
  applied: Array<{ actionId: string; type: string; studentId: string | null; message: string }>;
  skipped: Array<{ actionId: string; reason: string }>;
  failed: Array<{ actionId: string; error: string }>;
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeStudentId(userid: string): string {
  const cleaned = userid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return cleaned ? `dt-${cleaned}` : `dt-${Date.now()}`;
}

type LocalClassRow = { id: string; name: string; grade: number; academic_year_id: string };

function resolveClassForAction(
  action: { localClassId: string | null; localClassName: string | null },
  localClasses: LocalClassRow[],
  dt: { className: string; gradeName?: string | null; gradeLevel?: number | null; classPath?: string | null } | null,
): { classId: string; className: string; grade: number } | null {
  if (action.localClassId) {
    const fromPlan = localClasses.find((c) => c.id === action.localClassId);
    if (fromPlan) {
      return { classId: fromPlan.id, className: fromPlan.name, grade: fromPlan.grade };
    }
  }
  if (!dt) return null;
  return matchDingTalkStudentToLocalClass(
    {
      className: dt.className,
      gradeName: dt.gradeName,
      gradeLevel: dt.gradeLevel,
      classPath: dt.classPath,
    },
    localClasses,
  );
}

export async function applyDingTalkSync(input: DingTalkSyncApplyInput): Promise<DingTalkSyncApplyResult> {
  await ensureDingTalkUserIdColumn();
  const year = await getCurrentAcademicYear();
  if (!year) {
    return {
      ok: false,
      error: '未设置当前学年',
      applied: [],
      skipped: [],
      failed: [],
    };
  }
  const academicYearId = year.id;
  const academicYearName = year.name;

  const preview = getCachedDingTalkPreview();
  if ((!preview?.fetchedAt || preview.students.length === 0) && input.clientPreview?.fetchedAt) {
    seedDingTalkPreviewCache(input.clientPreview);
  }
  const activePreview = getCachedDingTalkPreview();
  if (!activePreview?.fetchedAt || activePreview.students.length === 0) {
    return {
      ok: false,
      error: '请先刷新钉钉数据',
      applied: [],
      skipped: [],
      failed: [],
    };
  }

  const clientPlan = input.plan?.ok ? input.plan : null;
  const plan = clientPlan && clientPlan.dingtalkFetchedAt === activePreview.fetchedAt
    ? clientPlan
    : await buildDingTalkSyncPlan({ clientPreview: input.clientPreview ?? activePreview });
  if (!plan.ok) {
    return { ok: false, error: plan.error, applied: [], skipped: [], failed: [] };
  }

  const applied: DingTalkSyncApplyResult['applied'] = [];
  const skipped: DingTalkSyncApplyResult['skipped'] = [];
  const failed: DingTalkSyncApplyResult['failed'] = [];

  const localClasses = (await pool.query(
    `SELECT id, name, grade, academic_year_id FROM classes WHERE academic_year_id = $1`,
    [academicYearId],
  )).rows as LocalClassRow[];
  const localClassById = new Map(localClasses.map((c) => [c.id, c]));

  const dtByUserId = new Map(activePreview.students.map((s) => [s.userid, s]));
  const actionById = new Map(plan.actions.map((a) => [a.id, a]));
  const usedStudentNumbers = new Set<string>(
    (
      await pool.query(
        `SELECT student_number FROM students WHERE student_number IS NOT NULL AND TRIM(student_number) <> ''`,
      )
    ).rows.map((r: { student_number: string }) => r.student_number.trim()),
  );
  const classNextSeat = new Map<string, number>();

  const client = await pool.connect();
  let savepointSeq = 0;
  try {
    await client.query('BEGIN');

    for (const actionId of input.actionIds) {
      const action = actionById.get(actionId);
      if (!action) {
        skipped.push({ actionId, reason: '计划项不存在或已过期，请重新打开同步' });
        continue;
      }

      const savepoint = `sync_sp_${++savepointSeq}`;
      await client.query(`SAVEPOINT ${savepoint}`);

      try {
        if (action.type === 'add') {
          const dt = action.dingtalkUserId ? dtByUserId.get(action.dingtalkUserId) : null;
          if (!dt) {
            failed.push({ actionId, error: '钉钉学生数据已过期，请刷新后重试' });
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            continue;
          }
          const classMatch = resolveClassForAction(action, localClasses, dt);
          if (!classMatch) {
            failed.push({ actionId, error: `无法匹配本地班级：${action.expectedLocalClassName ?? action.dingtalkClassLabel}` });
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            continue;
          }

          const studentId = sanitizeStudentId(dt.userid);
          const existing = (await client.query(
            'SELECT id FROM students WHERE dingtalk_user_id = $1 OR id = $2 LIMIT 1',
            [dt.userid, studentId],
          )).rows[0];
          if (existing) {
            failed.push({ actionId, error: '学生已存在' });
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            continue;
          }

          const studentNoResolved = await resolveStudentNumberForSyncInsert({
            client,
            academicYearId,
            academicYearName,
            usedInBatch: usedStudentNumbers,
            classNextSeat,
            dingtalkStudentNo: dt.studentNo,
            startYear: dt.startYear,
            classId: classMatch.classId,
            className: classMatch.className,
            grade: classMatch.grade,
          });

          await client.query(
            `INSERT INTO students (
              id, name, name_zh, name_en, gender, current_grade, current_class_id,
              student_number, dingtalk_user_id, status
            ) VALUES ($1, $2, $2, NULL, 'other', $3, $4, $5, $6, 'active')`,
            [
              studentId,
              dt.name,
              classMatch.grade,
              classMatch.classId,
              studentNoResolved.value,
              dt.userid,
            ],
          );

          const enrollmentId = createId('enr');
          await client.query(
            `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (student_id, academic_year_id)
             DO UPDATE SET class_id = EXCLUDED.class_id`,
            [enrollmentId, studentId, classMatch.classId, academicYearId],
          );

          applied.push({
            actionId,
            type: 'add',
            studentId,
            message: studentNoResolved.note
              ? `已添加 ${dt.name} → ${classMatch.className}（${studentNoResolved.note}）`
              : `已添加 ${dt.name} → ${classMatch.className}`,
          });
        } else if (action.type === 'update') {
          const dt = action.dingtalkUserId ? dtByUserId.get(action.dingtalkUserId) : null;
          if (!dt || !action.studentId) {
            failed.push({ actionId, error: '缺少学生或钉钉数据' });
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            continue;
          }

          const classMatch = resolveClassForAction(action, localClasses, dt);

          const existingRow = (await client.query(
            'SELECT student_number FROM students WHERE id = $1 LIMIT 1',
            [action.studentId],
          )).rows[0] as { student_number: string | null } | undefined;

          const updateClassId = classMatch?.classId ?? action.localClassId ?? '';
          const updateClassName = classMatch?.className ?? action.localClassName ?? '';
          const updateGrade =
            classMatch?.grade
            ?? (updateClassId ? localClassById.get(updateClassId)?.grade : undefined)
            ?? dt.gradeLevel
            ?? null;

          const studentNoResolved = await resolveStudentNumberForSyncUpdate({
            client,
            academicYearId,
            academicYearName,
            usedInBatch: usedStudentNumbers,
            classNextSeat,
            dingtalkStudentNo: dt.studentNo,
            startYear: dt.startYear,
            classId: updateClassId,
            className: updateClassName,
            grade: updateGrade ?? 1,
            studentId: action.studentId,
            existingStudentNumber: existingRow?.student_number ?? null,
          });

          await client.query(
            `UPDATE students SET
               name = $2,
               name_zh = $2,
               student_number = COALESCE($3, student_number),
               dingtalk_user_id = COALESCE(dingtalk_user_id, $4),
               current_grade = COALESCE($5, current_grade),
               current_class_id = COALESCE($6, current_class_id),
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [
              action.studentId,
              dt.name,
              studentNoResolved.value,
              dt.userid,
              classMatch?.grade ?? null,
              classMatch?.classId ?? null,
            ],
          );

          if (classMatch) {
            const enrollmentId = createId('enr');
            await client.query(
              `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (student_id, academic_year_id)
               DO UPDATE SET class_id = EXCLUDED.class_id`,
              [enrollmentId, action.studentId, classMatch.classId, academicYearId],
            );
          }

          applied.push({
            actionId,
            type: 'update',
            studentId: action.studentId,
            message: studentNoResolved.note
              ? `已更新 ${dt.name}（${studentNoResolved.note}）`
              : `已更新 ${dt.name}`,
          });
        } else if (action.type === 'remove') {
          if (!action.studentId) {
            failed.push({ actionId, error: '缺少学生 ID' });
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            continue;
          }
          await client.query('DELETE FROM student_enrollments WHERE student_id = $1', [action.studentId]);
          await client.query('DELETE FROM students WHERE id = $1', [action.studentId]);
          applied.push({
            actionId,
            type: 'remove',
            studentId: action.studentId,
            message: `已删除 ${action.name}`,
          });
        }

        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        failed.push({
          actionId,
          error: e instanceof Error ? e.message : 'Apply failed',
        });
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Transaction failed',
      applied,
      skipped,
      failed,
    };
  } finally {
    client.release();
  }

  const allFailed = applied.length === 0 && failed.length > 0 && input.actionIds.length > 0;
  const partialFailed = failed.length > 0 && applied.length > 0;

  return {
    ok: !allFailed,
    error: allFailed
      ? `同步失败：${failed.length} 项未能写入数据库${failed[0] ? `（例如：${failed[0].error}）` : ''}`
      : partialFailed
        ? `部分成功：${applied.length} 项已同步，${failed.length} 项失败`
        : null,
    applied,
    skipped,
    failed,
  };
}
