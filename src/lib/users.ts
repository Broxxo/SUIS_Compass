import { User } from '../types';

// 预设账号数据
export const PRESET_USERS: User[] = [
  {
    id: 'admin-1',
    username: 'Admin',
    password: '4321',
    role: 'admin',
    displayName: '总管理员',
  },
  {
    id: 'hf-admin-1',
    username: 'HF-Admin',
    password: '1234',
    role: 'hf-admin',
    displayName: 'HF管理员',
  },
  {
    id: 'wx-admin-1',
    username: 'WX-Admin',
    password: '1234',
    role: 'wx-admin',
    displayName: 'WX管理员',
  },
];

/**
 * 验证用户登录
 */
export function authenticateUser(username: string, password: string): User | null {
  const user = PRESET_USERS.find(
    (u) => u.username === username && u.password === password
  );
  return user || null;
}

/**
 * 根据用户ID获取用户信息
 */
export function getUserById(userId: string): User | null {
  return PRESET_USERS.find((u) => u.id === userId) || null;
}
