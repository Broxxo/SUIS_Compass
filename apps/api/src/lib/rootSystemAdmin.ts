import pool from '../config/database.js';

/** 初始系统管理员：最早创建的系统管理员账号。身份不能被撤销，也只有该账号能再授出系统管理员。 */
export async function getRootSystemAdminId(): Promise<string | null> {
  const row = (
    await pool.query(
      `SELECT id FROM users
       WHERE role = 'system-admin'
       ORDER BY created_at ASC NULLS LAST, id ASC
       LIMIT 1`,
    )
  ).rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

export async function isRootSystemAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const rootId = await getRootSystemAdminId();
  return rootId === userId;
}
