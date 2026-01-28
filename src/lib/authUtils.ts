/**
 * 认证相关的工具函数
 */

const AUTH_STORAGE_KEY = 'curriculum-roadmap-auth';

/**
 * 获取当前用户ID（从认证状态中获取）
 * 这是一个共享函数，用于在 storage.ts 和 api.ts 中复用
 */
export function getCurrentUserId(): string | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.userId || null;
    }
  } catch (error) {
    // 静默失败，不输出错误（避免在未登录时产生噪音）
  }
  return null;
}
