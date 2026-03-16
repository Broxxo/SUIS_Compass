const AUTH_STORAGE_KEY = 'curriculum-roadmap-auth';

/** 获取当前用户 ID（从认证状态中获取） */
export function getCurrentUserId(): string | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { user?: { id: string }; userId?: string };
      return parsed.user?.id ?? parsed.userId ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

/** 获取当前 token（用于 API 请求头） */
export function getToken(): string | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { token?: string };
      return parsed.token ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}
