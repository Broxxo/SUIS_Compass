import type { Pool } from 'pg';
import pool from '../config/database.js';

export type FunctionalRoleType = 'grade-head' | 'subject-group-head';

export type FunctionalRoleAssignmentRow = {
  id: string;
  academicYearId: string;
  roleType: FunctionalRoleType;
  scopeKey: string;
  scopeLabel: string | null;
  teacherId: string | null;
  teacherName: string | null;
  updatedAt: string | null;
};

let ensured = false;

export async function ensureFunctionalRoleAssignmentsTable(db: Pool = pool): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS functional_role_assignments (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      role_type VARCHAR(40) NOT NULL CHECK (role_type IN ('grade-head', 'subject-group-head')),
      scope_key VARCHAR(120) NOT NULL,
      scope_label VARCHAR(200),
      teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(academic_year_id, role_type, scope_key)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_functional_role_assignments_year_type
      ON functional_role_assignments(academic_year_id, role_type)
  `);
  ensured = true;
}

export async function listFunctionalRoleAssignments(
  academicYearId: string,
  db: Pool = pool,
): Promise<FunctionalRoleAssignmentRow[]> {
  await ensureFunctionalRoleAssignmentsTable(db);
  const rows = (
    await db.query(
      `SELECT a.id, a.academic_year_id, a.role_type, a.scope_key, a.scope_label, a.teacher_id, a.updated_at,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM functional_role_assignments a
       LEFT JOIN users u ON u.id = a.teacher_id
       WHERE a.academic_year_id = $1
       ORDER BY a.role_type ASC, a.scope_key ASC`,
      [academicYearId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id as string,
    academicYearId: r.academic_year_id as string,
    roleType: r.role_type as FunctionalRoleType,
    scopeKey: r.scope_key as string,
    scopeLabel: (r.scope_label as string | null) ?? null,
    teacherId: (r.teacher_id as string | null) ?? null,
    teacherName: (r.teacher_name as string | null) ?? null,
    updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
  }));
}

export async function upsertFunctionalRoleAssignment(
  input: {
    academicYearId: string;
    roleType: FunctionalRoleType;
    scopeKey: string;
    scopeLabel?: string | null;
    teacherId: string | null;
    updatedBy?: string | null;
  },
  db: Pool = pool,
): Promise<void> {
  await ensureFunctionalRoleAssignmentsTable(db);
  const { academicYearId, roleType, scopeKey, scopeLabel, teacherId, updatedBy } = input;
  if (!teacherId) {
    await db.query(
      `DELETE FROM functional_role_assignments
       WHERE academic_year_id = $1 AND role_type = $2 AND scope_key = $3`,
      [academicYearId, roleType, scopeKey],
    );
    return;
  }
  const id = `fra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.query(
    `INSERT INTO functional_role_assignments
      (id, academic_year_id, role_type, scope_key, scope_label, teacher_id, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (academic_year_id, role_type, scope_key)
     DO UPDATE SET
       scope_label = EXCLUDED.scope_label,
       teacher_id = EXCLUDED.teacher_id,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
    [id, academicYearId, roleType, scopeKey, scopeLabel ?? null, teacherId, updatedBy ?? null],
  );
}
