import pool from '../config/database.js';
import { ensureFunctionalRoleAssignmentsTable } from './functionalRoleAssignments.js';
import { userHasModuleGrant } from './modulePermissionGrants.js';

async function getUserRole(userId: string): Promise<string | undefined> {
  if (!userId) return undefined;
  const row = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0] as
    | { role: string }
    | undefined;
  return row?.role;
}

async function isSubjectGroupHead(userId: string): Promise<boolean> {
  await ensureFunctionalRoleAssignmentsTable();
  const headed = (
    await pool.query(
      `SELECT 1 FROM functional_role_assignments
       WHERE role_type = 'subject-group-head' AND teacher_id = $1
       LIMIT 1`,
      [userId],
    )
  ).rows[0];
  return Boolean(headed);
}

/** 新建/编辑/删除课程、调序等框架能力：管理员或 curriculum 额外授权。 */
export async function canManageCurriculumFramework(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  if (role === 'system-admin' || role === 'admin') return true;
  return userHasModuleGrant(userId, 'curriculum');
}

/** 编辑单元格子：管理员、学科组长，或 curriculum 额外授权。 */
export async function canEditCurriculumUnits(userId: string): Promise<boolean> {
  if (await canManageCurriculumFramework(userId)) return true;
  return isSubjectGroupHead(userId);
}

/** @deprecated 使用 canEditCurriculumUnits；保留给旧调用点 */
export async function canManageCurriculumRiver(userId: string): Promise<boolean> {
  return canEditCurriculumUnits(userId);
}
