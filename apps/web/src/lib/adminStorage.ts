/**
 * 后台用户管理数据：支持 localStorage 本地测试与云端同步。
 * 本地：全部读写 localStorage；云端：优先 API，失败回退本地。
 * 本地模式下会把登录用预设账号（如 Admin）合并进列表，保证至少能看到当前登录账号。
 */
import type { User } from '../types';
import { STORAGE_KEYS } from './constants';
import { getCurrentUserId } from './authUtils';
import { api, USE_CLOUD_STORAGE } from './api';
import { logError } from './errorHandler';
import { PRESET_USERS } from './users';

export type AdminUser = User & {
  createdAt?: string;
  password?: string | null;
  department?: string | null;
  studentId?: string | null;
  studentNameZh?: string | null;
  studentNameEn?: string | null;
};

const KEY = STORAGE_KEYS.ADMIN_USERS;

function loadFromLocal(): AdminUser[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    logError('adminStorage loadFromLocal', e);
  }
  return [];
}

/** 将登录用预设账号转为 AdminUser，供本地模式下在后台列表中显示 */
function getPresetAsAdminUsers(): AdminUser[] {
  return PRESET_USERS.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    password: u.password,
    department: null,
    createdAt: undefined,
  }));
}

function saveToLocal(users: AdminUser[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(users));
  } catch (e) {
    logError('adminStorage saveToLocal', e);
  }
}

/**
 * 用本地存储的后台用户列表校验登录（仅用于本地测试）。
 * 先查预设再查本地列表，供 AuthContext 在本地模式下使用。
 */
export function authenticateLocalAdminUser(username: string, password: string): User | null {
  const list = loadFromLocal();
  const u = list.find((x) => x.username === username && (x.password ?? '') === password);
  return u ? { id: u.id, username: u.username, role: u.role, displayName: u.displayName } : null;
}

/** 加载用户列表：云端时先拉 API；教职工列表写入本地缓存。scope=students 时仅云端可用，本地模式返回空数组。 */
export async function loadUsers(scope: 'staff' | 'students' = 'staff'): Promise<AdminUser[]> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const list = await api.getAllUsers(scope);
      if (scope === 'staff') saveToLocal(list);
      return list;
    } catch (e) {
      logError('loadUsers from cloud', e);
    }
  }
  if (scope === 'students') return [];
  const local = loadFromLocal();
  const presets = getPresetAsAdminUsers();
  return [...presets, ...local.filter((u) => !presets.some((p) => p.id === u.id))];
}

/** 批量开通学生登录（学号作用户名）。仅云端模式可用。 */
export async function importStudentAccounts(items: { studentId: string; password: string }[]): Promise<{
  created: Array<{ studentId: string; username: string; password: string; displayName: string; userId: string }>;
  skipped: Array<{ studentId: string; reason: string }>;
}> {
  if (!USE_CLOUD_STORAGE || !getCurrentUserId()) {
    throw new Error('Student account import requires cloud mode (VITE_USE_CLOUD_STORAGE=true) and login.');
  }
  return api.importStudentAccounts(items);
}

/** 创建用户：先写本地，云端时再调 API */
export async function createUser(input: {
  username: string;
  displayName?: string;
  role: User['role'];
  password: string;
  department?: string | null;
}): Promise<AdminUser> {
  const id = `admin-user-${Date.now()}`;
  const now = new Date().toISOString();
  const user: AdminUser = {
    id,
    username: input.username,
    displayName: input.displayName ?? input.username,
    role: input.role,
    createdAt: now,
    password: input.password,
    department: input.department ?? null,
  };
  const users = loadFromLocal();
  users.unshift(user);
  saveToLocal(users);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const created = await api.createUser(input);
      const updated = users.map((u) => (u.id === id ? { ...created, password: input.password } : u));
      saveToLocal(updated);
      return { ...created, password: input.password };
    } catch (e) {
      logError('createUser to cloud', e);
      throw e;
    }
  }
  return user;
}

/** 更新单个用户部门 */
export async function updateUserDepartment(userId: string, department: string | null): Promise<void> {
  const users = loadFromLocal();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx] = { ...users[idx], department };
  saveToLocal(users);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.updateUserDepartment(userId, department);
    } catch (e) {
      logError('updateUserDepartment to cloud', e);
    }
  }
}

/** 更新用户角色（仅系统管理员可改）：教师↔管理员 */
export async function updateUserRole(userId: string, role: 'admin' | 'teacher'): Promise<void> {
  const users = loadFromLocal();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  const u = users[idx];
  if (u.role === 'system-admin') return;
  users[idx] = { ...u, role };
  saveToLocal(users);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.updateUserRole(userId, role);
    } catch (e) {
      logError('updateUserRole to cloud', e);
    }
  }
}

/** 批量更新部门 */
export async function batchUpdateDepartment(userIds: string[], department: string | null): Promise<void> {
  const users = loadFromLocal();
  const set = new Set(userIds);
  const next = users.map((u) => (set.has(u.id) ? { ...u, department } : u));
  saveToLocal(next);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.batchUpdateDepartment(userIds, department);
    } catch (e) {
      logError('batchUpdateDepartment to cloud', e);
    }
  }
}

/** 删除用户：本地校验 confirmUsername 与用户名一致后删除；云端时再调 API。本地模式下不允许删除预设登录账号。 */
export async function deleteUser(userId: string, confirmUsername: string): Promise<void> {
  if (!USE_CLOUD_STORAGE && PRESET_USERS.some((p) => p.id === userId)) {
    throw new Error('Cannot delete preset login account in local mode.');
  }
  const users = loadFromLocal();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found');
  if (user.username !== confirmUsername) {
    throw new Error(confirmUsername ? 'Username does not match' : 'Please type the username to confirm');
  }
  const next = users.filter((u) => u.id !== userId);
  saveToLocal(next);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.deleteUser(userId, confirmUsername);
    } catch (e) {
      logError('deleteUser from cloud', e);
    }
  }
}
