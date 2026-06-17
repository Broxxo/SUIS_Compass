import type { Pool } from 'pg';
import pool from '../config/database.js';
import { ensureFunctionalRoleAssignmentsTable } from './functionalRoleAssignments.js';
import { getGradeCatalogIdForClass, loadSchoolGradeStructure } from './schoolGradeStructure.js';

export async function getTeacherGradeHeadScopeKeys(
  teacherId: string,
  academicYearId: string,
  db: Pool = pool,
): Promise<Set<string>> {
  await ensureFunctionalRoleAssignmentsTable(db);
  const rows = (
    await db.query(
      `SELECT scope_key
       FROM functional_role_assignments
       WHERE academic_year_id = $1 AND role_type = 'grade-head' AND teacher_id = $2`,
      [academicYearId, teacherId],
    )
  ).rows as Array<{ scope_key: string }>;
  return new Set(rows.map((r) => r.scope_key));
}

export async function getGradeHeadClassIdsForTeacher(
  teacherId: string,
  academicYearId: string,
  db: Pool = pool,
): Promise<string[]> {
  const scopeKeys = await getTeacherGradeHeadScopeKeys(teacherId, academicYearId, db);
  if (scopeKeys.size === 0) return [];
  const gradeConfig = await loadSchoolGradeStructure();
  const classRows = (
    await db.query(`SELECT id, grade, name FROM classes WHERE academic_year_id = $1`, [academicYearId])
  ).rows as Array<{ id: string; grade: number; name: string }>;
  return classRows
    .filter((c) => {
      const catalogId = getGradeCatalogIdForClass(gradeConfig, Number(c.grade), {
        className: String(c.name ?? ''),
      });
      return !!catalogId && scopeKeys.has(catalogId);
    })
    .map((c) => c.id);
}

export async function teacherIsGradeHeadOfClass(
  teacherId: string,
  classId: string,
  academicYearId: string,
  db: Pool = pool,
): Promise<boolean> {
  const scopeKeys = await getTeacherGradeHeadScopeKeys(teacherId, academicYearId, db);
  if (scopeKeys.size === 0) return false;
  const row = (
    await db.query(`SELECT grade, name FROM classes WHERE id = $1 AND academic_year_id = $2 LIMIT 1`, [
      classId,
      academicYearId,
    ])
  ).rows[0] as { grade: number; name: string } | undefined;
  if (!row) return false;
  const gradeConfig = await loadSchoolGradeStructure();
  const catalogId = getGradeCatalogIdForClass(gradeConfig, Number(row.grade), {
    className: String(row.name ?? ''),
  });
  return !!catalogId && scopeKeys.has(catalogId);
}

/** 学生是否在教师所管年级的任一班级就读（任意学年学籍均可） */
export async function teacherIsGradeHeadOfStudent(
  teacherId: string,
  studentId: string,
  db: Pool = pool,
): Promise<boolean> {
  const enrollments = (
    await db.query(
      `SELECT e.academic_year_id, e.class_id
       FROM student_enrollments e
       WHERE e.student_id = $1`,
      [studentId],
    )
  ).rows as Array<{ academic_year_id: string; class_id: string }>;
  for (const enr of enrollments) {
    if (await teacherIsGradeHeadOfClass(teacherId, enr.class_id, enr.academic_year_id, db)) {
      return true;
    }
  }
  return false;
}

/** 教师作为年级组长可见的班级 id（可按学年过滤；不传学年时汇总全部任职学年） */
export async function getGradeHeadClassIdsForTeacherQuery(
  teacherId: string,
  academicYearId?: string,
  db: Pool = pool,
): Promise<string[]> {
  if (academicYearId) {
    return getGradeHeadClassIdsForTeacher(teacherId, academicYearId, db);
  }
  await ensureFunctionalRoleAssignmentsTable(db);
  const yearRows = (
    await db.query(
      `SELECT DISTINCT academic_year_id
       FROM functional_role_assignments
       WHERE role_type = 'grade-head' AND teacher_id = $1`,
      [teacherId],
    )
  ).rows as Array<{ academic_year_id: string }>;
  const ids = new Set<string>();
  for (const row of yearRows) {
    for (const cid of await getGradeHeadClassIdsForTeacher(teacherId, row.academic_year_id, db)) {
      ids.add(cid);
    }
  }
  return Array.from(ids);
}
