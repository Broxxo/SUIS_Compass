import type { User } from '../types';

/**
 * 本地测试用预设账号（仅在前端校验，方便无后端时登录）。
 * 正式环境请使用后端数据库账号。
 */
type PresetEntry = User & { password: string };

export const PRESET_USERS: PresetEntry[] = [
  {
    id: 'admin-1',
    username: 'Admin',
    password: '1234',
    role: 'system-admin',
    displayName: '系统管理员',
    nameZh: '系统管理员',
    nameEn: null,
  },
];

function presetToUser(u: PresetEntry): User {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    nameZh: u.nameZh ?? null,
    nameEn: u.nameEn ?? null,
  };
}

export function authenticateUser(username: string, password: string): User | null {
  const u = PRESET_USERS.find((x) => x.username === username && x.password === password);
  return u ? presetToUser(u) : null;
}

export function getUserById(userId: string): User | null {
  const u = PRESET_USERS.find((x) => x.id === userId);
  return u ? presetToUser(u) : null;
}
