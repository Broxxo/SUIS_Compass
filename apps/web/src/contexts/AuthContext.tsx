import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '../types';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import { authenticateUser } from '../lib/users';
import { authenticateLocalAdminUser } from '../lib/adminStorage';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_STORAGE_KEY = 'curriculum-roadmap-auth';

function toUser(r: {
  id: string;
  username: string;
  role: string;
  displayName: string;
  studentId?: string | null;
}): User {
  return {
    id: r.id,
    username: r.username,
    role: r.role as User['role'],
    displayName: r.displayName,
    studentId: r.studentId ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) {
      setHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as { token?: string; user?: unknown };
      if (parsed.token && USE_CLOUD_STORAGE) {
        api
          .getUser()
          .then((data: { user?: unknown }) => {
            if (data?.user) {
              setUser(toUser(data.user as Parameters<typeof toUser>[0]));
            }
          })
          .catch(() => {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          })
          .finally(() => setHydrated(true));
        return;
      }
      if (parsed.user && typeof parsed.user === 'object' && 'id' in parsed.user) {
        const raw = parsed.user as { id: string; username: string; role: string; displayName: string };
        const normalized = raw.username === 'Admin'
          ? { ...raw, role: (raw.role === 'admin' ? 'system-admin' : raw.role) as 'system-admin' | 'admin' | 'teacher', displayName: '系统管理员' }
          : raw;
        const userObj = toUser(normalized);
        setUser(userObj);
        if (normalized !== raw) {
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...parsed, user: userObj }));
        }
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    setHydrated(true);
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    if (USE_CLOUD_STORAGE) {
      try {
        const data = await api.login(username, password) as {
          success?: boolean;
          token?: string;
          user?: { id: string; username: string; role: string; displayName: string; studentId?: string | null };
        };
        if (data.success && data.token && data.user) {
          const u = toUser(data.user);
          setUser(u);
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: data.token, user: u }));
          return true;
        }
      } catch {
        // API 不可用时回退到本地预设（方便本地测试）
      }
    }
    const presetUser = authenticateUser(username, password);
    if (presetUser) {
      setUser(presetUser);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: presetUser }));
      return true;
    }
    const localAdminUser = authenticateLocalAdminUser(username, password);
    if (localAdminUser) {
      setUser(localAdminUser);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: localAdminUser }));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (!parsed.user && user) {
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...parsed, user }));
        }
      } catch {
        // ignore
      }
    }
  }, [user]);

  if (!hydrated) {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
