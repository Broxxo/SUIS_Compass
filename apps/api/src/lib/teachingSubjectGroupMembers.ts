import type { Pool } from 'pg';
import pool from '../config/database.js';

export type TeachingSubjectGroupMemberRow = {
  groupId: string;
  teacherId: string;
  teacherName: string | null;
};

let ensured = false;

export async function ensureTeachingSubjectGroupMembersTable(db: Pool = pool): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS teaching_subject_group_members (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      group_id VARCHAR(80) NOT NULL,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(academic_year_id, group_id, teacher_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tsg_members_year_group
      ON teaching_subject_group_members(academic_year_id, group_id)
  `);
  ensured = true;
}

export async function listTeachingSubjectGroupMembers(
  academicYearId: string,
  db: Pool = pool,
): Promise<TeachingSubjectGroupMemberRow[]> {
  await ensureTeachingSubjectGroupMembersTable(db);
  const rows = (
    await db.query(
      `SELECT m.group_id, m.teacher_id,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM teaching_subject_group_members m
       LEFT JOIN users u ON u.id = m.teacher_id
       WHERE m.academic_year_id = $1
       ORDER BY m.group_id ASC, teacher_name ASC`,
      [academicYearId],
    )
  ).rows;
  return rows.map((r) => ({
    groupId: r.group_id as string,
    teacherId: r.teacher_id as string,
    teacherName: (r.teacher_name as string | null) ?? null,
  }));
}

export async function replaceTeachingSubjectGroupMembers(
  input: {
    academicYearId: string;
    groupId: string;
    teacherIds: string[];
  },
  db: Pool = pool,
): Promise<void> {
  await ensureTeachingSubjectGroupMembersTable(db);
  const { academicYearId, groupId } = input;
  const teacherIds = [...new Set(input.teacherIds.map((id) => String(id).trim()).filter(Boolean))];
  await db.query(
    `DELETE FROM teaching_subject_group_members
     WHERE academic_year_id = $1 AND group_id = $2`,
    [academicYearId, groupId],
  );
  for (const teacherId of teacherIds) {
    const id = `tsgm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.query(
      `INSERT INTO teaching_subject_group_members (id, academic_year_id, group_id, teacher_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (academic_year_id, group_id, teacher_id) DO NOTHING`,
      [id, academicYearId, groupId, teacherId],
    );
  }
}

export async function deleteTeachingSubjectGroupMembersForGroup(
  academicYearId: string,
  groupId: string,
  db: Pool = pool,
): Promise<void> {
  await ensureTeachingSubjectGroupMembersTable(db);
  await db.query(
    `DELETE FROM teaching_subject_group_members
     WHERE academic_year_id = $1 AND group_id = $2`,
    [academicYearId, groupId],
  );
}
