/**
 * 压测 HTTP 认证：JWT 登录（生产）或 X-User-Id（仅开发环境 API）。
 */
import type pg from 'pg';
import {
  loadTestCredentialsFile,
  passwordMapFromCredentials,
  resolvePasswordForUsername,
  type LoadTestCredentialsFile,
} from './loadTestCredentials.js';

export type AuthHeadersFn = (teacherId: string) => Promise<Record<string, string>>;

export type TeacherCredential = {
  id: string;
  username: string;
  displayName: string;
};

export function createLegacyAuthProvider(): AuthHeadersFn {
  return async (teacherId: string) => ({
    'Content-Type': 'application/json',
    'X-User-Id': teacherId,
  });
}

export async function loginWithPassword(
  apiBase: string,
  username: string,
  password: string,
  timeoutMs = 15_000,
): Promise<{ token: string; userId: string; displayName: string }> {
  const base = apiBase.replace(/\/$/, '');
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Login failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text) as {
      token?: string;
      user?: { id: string; displayName?: string };
    };
    if (!data.token || !data.user?.id) {
      throw new Error('Login response missing token or user.id');
    }
    return {
      token: data.token,
      userId: data.user.id,
      displayName: (data.user.displayName ?? '').trim() || username,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveTeacherByName(
  pool: pg.Pool,
  nameOrUsername: string,
): Promise<TeacherCredential> {
  const needle = nameOrUsername.trim();
  if (!needle) throw new Error('Teacher name or username is required');
  const result = await pool.query(
    `SELECT id, username,
            COALESCE(NULLIF(TRIM(name_zh), ''), NULLIF(TRIM(display_name), ''), NULLIF(TRIM(name_en), ''), username) AS display_name
     FROM users
     WHERE role = 'teacher'
       AND (
         username = $1
         OR TRIM(COALESCE(name_zh, '')) = $1
         OR TRIM(COALESCE(display_name, '')) = $1
         OR TRIM(COALESCE(name_en, '')) = $1
       )
     ORDER BY created_at ASC
     LIMIT 2`,
    [needle],
  );
  if (result.rows.length === 0) {
    throw new Error(`未找到教师账号：${needle}`);
  }
  if (result.rows.length > 1) {
    throw new Error(`教师名称「${needle}」匹配到多个账号，请改用 --username= 指定登录名`);
  }
  const row = result.rows[0] as { id: string; username: string; display_name: string };
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export async function resolveTeacherUsernameMap(
  pool: pg.Pool,
  teacherIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(teacherIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const result = await pool.query(
    `SELECT id, username FROM users WHERE id = ANY($1::text[])`,
    [unique],
  );
  const map = new Map<string, string>();
  for (const row of result.rows as Array<{ id: string; username: string }>) {
    map.set(row.id, row.username);
  }
  return map;
}

/** 按远程 userId 缓存 JWT；username / 密码来自 credentials.local.json */
export function createJwtAuthProviderFromCredentials(
  apiBase: string,
  creds: LoadTestCredentialsFile,
  remoteUserIdToUsername: Map<string, string>,
): AuthHeadersFn {
  const tokenByTeacherId = new Map<string, string>();

  return async (teacherId: string) => {
    let token = tokenByTeacherId.get(teacherId);
    if (!token) {
      const username = remoteUserIdToUsername.get(teacherId);
      if (!username) {
        throw new Error(`凭据文件中无教师 userId=${teacherId} 的 username 映射`);
      }
      const password = creds.byUsername[username];
      if (!password) {
        throw new Error(`凭据文件中无用户「${username}」的密码`);
      }
      const session = await loginWithPassword(apiBase, username, password);
      tokenByTeacherId.set(teacherId, session.token);
      if (session.userId !== teacherId) {
        tokenByTeacherId.set(session.userId, session.token);
      }
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };
}

/** 按教师 id 缓存 JWT；默认密码适用于批量压测（各校测试账号同密）。 */
export function createJwtAuthProvider(
  apiBase: string,
  pool: pg.Pool,
  defaultPassword: string,
  passwordByUsername?: Map<string, string>,
): AuthHeadersFn {
  const tokenByTeacherId = new Map<string, string>();
  const usernameByTeacherId = new Map<string, string>();

  return async (teacherId: string) => {
    let token = tokenByTeacherId.get(teacherId);
    if (!token) {
      let username = usernameByTeacherId.get(teacherId);
      if (!username) {
        const map = await resolveTeacherUsernameMap(pool, [teacherId]);
        username = map.get(teacherId);
        if (!username) throw new Error(`Teacher id not found: ${teacherId}`);
        usernameByTeacherId.set(teacherId, username);
      }
      const password = passwordByUsername?.get(username) ?? defaultPassword;
      const session = await loginWithPassword(apiBase, username, password);
      if (session.userId !== teacherId) {
        throw new Error(`Login user id mismatch: expected ${teacherId}, got ${session.userId}`);
      }
      token = session.token;
      tokenByTeacherId.set(teacherId, token);
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };
}

export function resolveLoadTestPassword(argv: string[]): string {
  const creds = loadTestCredentialsFile();
  if (creds && creds.users.length > 0) {
    const fromArg = argv.find((a) => a.startsWith('--password='))?.slice('--password='.length).trim();
    const fromEnv = process.env.LOAD_TEST_PASSWORD?.trim();
    if (fromArg || fromEnv) return fromArg || fromEnv!;
    return creds.users[0]!.password;
  }
  const fromArg = argv.find((a) => a.startsWith('--password='))?.slice('--password='.length).trim();
  const fromEnv = process.env.LOAD_TEST_PASSWORD?.trim();
  const password = fromArg || fromEnv;
  if (!password) {
    throw new Error(
      '请设置密码：npm run export:load-credentials 生成 credentials.local.json，或设置 LOAD_TEST_PASSWORD / --password=',
    );
  }
  return password;
}

export { resolvePasswordForUsername };

export function shouldUseJwtAuth(argv: string[]): boolean {
  const explicit = argv.find((a) => a.startsWith('--auth='))?.slice('--auth='.length).trim();
  if (explicit === 'jwt') return true;
  if (explicit === 'legacy') return false;
  const env = process.env.LOAD_TEST_AUTH?.trim();
  if (env === 'jwt') return true;
  if (env === 'legacy') return false;
  const apiBase = process.env.API_BASE_URL?.trim() || '';
  return apiBase.startsWith('https://');
}
