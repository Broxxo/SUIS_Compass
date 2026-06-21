/**
 * 从本地 PostgreSQL users.password 列导出压测凭据（仅开发库；生产通常无明文列）。
 *
 *   npm run export:load-credentials
 *
 * 输出：tools/load-tests/credentials.local.json（已 gitignore，勿提交）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { writeLoadTestCredentialsFile } from './loadTestCredentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^postgresql:/, 'http:'));
    return `postgresql://${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'postgresql://***';
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL 未设置（apps/api/.env）');
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
  try {
    const result = await pool.query(
      `SELECT id, username, role,
              COALESCE(NULLIF(TRIM(name_zh), ''), NULLIF(TRIM(display_name), ''), NULLIF(TRIM(name_en), ''), username) AS display_name,
              password
       FROM users
       WHERE role IN ('teacher', 'admin', 'system-admin', 'student')
       ORDER BY role ASC, username ASC`,
    );

    const users: Array<{
      id: string;
      username: string;
      role: string;
      displayName: string;
      password: string;
    }> = [];
    let skippedNoPlain = 0;

    for (const row of result.rows as Array<{
      id: string;
      username: string;
      role: string;
      display_name: string;
      password: string | null;
    }>) {
      const password = String(row.password ?? '').trim();
      if (!password) {
        skippedNoPlain += 1;
        continue;
      }
      users.push({
        id: row.id,
        username: row.username,
        role: row.role,
        displayName: row.display_name,
        password,
      });
    }

    if (users.length === 0) {
      throw new Error(
        '没有可导出的明文密码（users.password 为空）。本地开发库导入账号后重试；云上库通常只有 password_hash，无法从此脚本导出。',
      );
    }

    const out = writeLoadTestCredentialsFile(users, redactDatabaseUrl(databaseUrl));
    const byRole = users.reduce<Record<string, number>>((acc, u) => {
      acc[u.role] = (acc[u.role] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`已导出 ${users.length} 个账号 → ${out}`);
    console.log('按角色:', byRole);
    if (skippedNoPlain > 0) {
      console.log(`跳过 ${skippedNoPlain} 个无明文 password 的账号（仅有 bcrypt 时无法导出）`);
    }
    console.log('\n该文件已 gitignore，请勿提交 Git 或上传到服务器。');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
