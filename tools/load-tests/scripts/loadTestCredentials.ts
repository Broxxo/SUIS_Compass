/**
 * 压测账号凭据（仅本机、仅 gitignore 文件）。勿提交 Git。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOAD_TEST_CREDENTIALS_PATH = path.resolve(__dirname, '../credentials.local.json');

export type LoadTestCredentialUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  password: string;
  /** 阿里云等线上环境与本地不同的登录名 */
  cloudUsername?: string;
};

export type LoadTestCredentialsFile = {
  exportedAt: string;
  /** 脱敏后的数据源说明（不含密码） */
  sourceHint: string;
  users: LoadTestCredentialUser[];
  byUsername: Record<string, string>;
  byUserId: Record<string, string>;
};

export function loadTestCredentialsFile(
  filePath = LOAD_TEST_CREDENTIALS_PATH,
): LoadTestCredentialsFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as LoadTestCredentialsFile;
    if (!raw?.byUsername || typeof raw.byUsername !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

export function resolveLoginUsername(
  user: LoadTestCredentialUser,
  apiBase: string,
): string {
  const cloud = user.cloudUsername?.trim();
  if (apiBase.startsWith('https://') && cloud) return cloud;
  return user.username;
}

export function rebuildCredentialIndexes(users: LoadTestCredentialUser[]): {
  byUsername: Record<string, string>;
  byUserId: Record<string, string>;
} {
  const byUsername: Record<string, string> = {};
  const byUserId: Record<string, string> = {};
  for (const u of users) {
    byUsername[u.username] = u.password;
    if (u.cloudUsername?.trim()) byUsername[u.cloudUsername.trim()] = u.password;
    byUserId[u.id] = u.password;
  }
  return { byUsername, byUserId };
}

export function passwordMapFromCredentials(
  creds: LoadTestCredentialsFile | null,
): Map<string, string> | undefined {
  if (!creds) return undefined;
  return new Map(Object.entries(creds.byUsername));
}

export function resolvePasswordForUsername(
  username: string,
  argv: string[],
  creds?: LoadTestCredentialsFile | null,
): string {
  const store = creds ?? loadTestCredentialsFile();
  const fromFile = store?.byUsername[username.trim()];
  if (fromFile) return fromFile;

  const fromArg = argv.find((a) => a.startsWith('--password='))?.slice('--password='.length).trim();
  const fromEnv = process.env.LOAD_TEST_PASSWORD?.trim();
  const fallback = fromArg || fromEnv;
  if (fallback) return fallback;

  throw new Error(
    `未找到用户「${username}」的密码：请先运行 npm run export:load-credentials，或设置 LOAD_TEST_PASSWORD / --password=`,
  );
}

export function writeLoadTestCredentialsFile(
  users: LoadTestCredentialUser[],
  sourceHint: string,
  filePath = LOAD_TEST_CREDENTIALS_PATH,
): string {
  const { byUsername, byUserId } = rebuildCredentialIndexes(users);
  const payload: LoadTestCredentialsFile = {
    exportedAt: new Date().toISOString(),
    sourceHint,
    users,
    byUsername,
    byUserId,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
