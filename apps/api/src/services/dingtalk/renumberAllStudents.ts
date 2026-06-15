import pool from '../../config/database.js';
import { classIndexFromLocalClassName } from './classNameMapping.js';
import { buildStudentNumber, entryYearShortCode } from './studentNumber.js';

export type RenumberAllStudentsResult = {
  ok: boolean;
  error: string | null;
  academicYearId: string | null;
  academicYearName: string | null;
  updated: number;
  loginAccountsUpdated: number;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
  samples: Array<{ studentId: string; name: string; oldNumber: string | null; newNumber: string; className: string }>;
};

type ClassRow = { id: string; name: string; grade: number };
type StudentRow = {
  id: string;
  name: string;
  name_zh: string | null;
  student_number: string | null;
  class_id: string;
  class_name: string;
  grade: number;
};

export async function renumberAllStudentsInSystem(): Promise<RenumberAllStudentsResult> {
  const year = (await pool.query(
    `SELECT id, name FROM academic_years WHERE is_current = TRUE ORDER BY updated_at DESC LIMIT 1`,
  )).rows[0] as { id: string; name: string } | undefined;

  if (!year) {
    return {
      ok: false,
      error: '未设置当前学年',
      academicYearId: null,
      academicYearName: null,
      updated: 0,
      loginAccountsUpdated: 0,
      skipped: [],
      samples: [],
    };
  }

  const classes = (await pool.query(
    `SELECT id, name, grade FROM classes WHERE academic_year_id = $1 ORDER BY grade, name`,
    [year.id],
  )).rows as ClassRow[];

  const classById = new Map(classes.map((c) => [c.id, c]));
  const enrolled = (await pool.query(
    `SELECT
       s.id,
       s.name,
       s.name_zh,
       s.student_number,
       e.class_id,
       c.name AS class_name,
       c.grade
     FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
     JOIN classes c ON c.id = e.class_id
     WHERE s.status = 'active'
     ORDER BY c.grade, c.name, COALESCE(NULLIF(s.name_zh, ''), s.name), s.id`,
    [year.id],
  )).rows as StudentRow[];

  const fallback = (await pool.query(
    `SELECT
       s.id,
       s.name,
       s.name_zh,
       s.student_number,
       s.current_class_id AS class_id,
       c.name AS class_name,
       c.grade
     FROM students s
     JOIN classes c ON c.id = s.current_class_id AND c.academic_year_id = $1
     WHERE s.status = 'active'
       AND s.current_class_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM student_enrollments e
         WHERE e.student_id = s.id AND e.academic_year_id = $1
       )
     ORDER BY c.grade, c.name, COALESCE(NULLIF(s.name_zh, ''), s.name), s.id`,
    [year.id],
  )).rows as StudentRow[];

  const toRenumber = [...enrolled, ...fallback];
  const skipped: RenumberAllStudentsResult['skipped'] = [];
  const samples: RenumberAllStudentsResult['samples'] = [];
  const usedNumbers = new Set<string>();
  let updated = 0;
  let loginAccountsUpdated = 0;

  const byClass = new Map<string, StudentRow[]>();
  for (const row of toRenumber) {
    if (!classById.has(row.class_id)) {
      skipped.push({ studentId: row.id, name: row.name_zh ?? row.name, reason: '班级不在当前学年' });
      continue;
    }
    const list = byClass.get(row.class_id) ?? [];
    list.push(row);
    byClass.set(row.class_id, list);
  }

  const assignedIds = new Set(toRenumber.map((s) => s.id));
  const allActive = (await pool.query(
    `SELECT id, name, name_zh, student_number FROM students WHERE status = 'active'`,
  )).rows as Array<{ id: string; name: string; name_zh: string | null; student_number: string | null }>;

  for (const s of allActive) {
    if (assignedIds.has(s.id)) continue;
    skipped.push({
      studentId: s.id,
      name: s.name_zh ?? s.name,
      reason: '未分班（无当前学年学籍）',
    });
  }

  const yearShort = entryYearShortCode(null, year.name);
  const client = await pool.connect();
  const pending: Array<{ id: string; oldNumber: string | null; newNumber: string; name: string; className: string }> = [];

  try {
    await client.query('BEGIN');

    for (const cls of classes) {
      const students = byClass.get(cls.id) ?? [];
      const classIndex = classIndexFromLocalClassName(cls.name, cls.grade);
      let seat = 1;

      for (const s of students) {
        let newNumber = buildStudentNumber(yearShort, cls.grade, classIndex, seat);
        while (usedNumbers.has(newNumber)) {
          seat += 1;
          newNumber = buildStudentNumber(yearShort, cls.grade, classIndex, seat);
        }
        usedNumbers.add(newNumber);
        seat += 1;

        const oldNumber = s.student_number?.trim() || null;
        if (oldNumber === newNumber) continue;

        pending.push({
          id: s.id,
          oldNumber,
          newNumber,
          name: s.name_zh ?? s.name,
          className: cls.name,
        });
      }
    }

    // 先清空待更新学号，避免新学号与尚未更新的旧学号 unique 冲突
    for (const item of pending) {
      await client.query(
        `UPDATE students SET student_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [item.id],
      );
    }

    for (const item of pending) {
      await client.query(
        `UPDATE students SET student_number = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [item.id, item.newNumber],
      );
      updated += 1;

      if (samples.length < 12) {
        samples.push({
          studentId: item.id,
          name: item.name,
          oldNumber: item.oldNumber,
          newNumber: item.newNumber,
          className: item.className,
        });
      }

      if (item.oldNumber) {
        const userRes = await client.query(
          `UPDATE users SET username = $1, updated_at = CURRENT_TIMESTAMP
           WHERE student_id = $2 AND role = 'student' AND TRIM(username) = TRIM($3)
           RETURNING id`,
          [item.newNumber, item.id, item.oldNumber],
        );
        loginAccountsUpdated += userRes.rowCount ?? 0;
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Renumber failed',
      academicYearId: year.id,
      academicYearName: year.name,
      updated: 0,
      loginAccountsUpdated: 0,
      skipped,
      samples,
    };
  } finally {
    client.release();
  }

  return {
    ok: true,
    error: null,
    academicYearId: year.id,
    academicYearName: year.name,
    updated,
    loginAccountsUpdated,
    skipped,
    samples,
  };
}
