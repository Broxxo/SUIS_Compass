import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { authenticateUser } from '../lib/users';
import { api, USE_CLOUD_STORAGE } from '../lib/api';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'curriculum-roadmap-auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    // 从 localStorage 恢复登录状态
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 验证用户是否仍然有效
        const validUser = authenticateUser(parsed.username, parsed.password);
        return validUser;
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
    return null;
  });

  const login = async (username: string, password: string): Promise<boolean> => {
    // 如果使用云端存储，通过 API 登录
    if (USE_CLOUD_STORAGE) {
      try {
        const response = await api.login(username, password);
        if (response.success && response.user) {
          const user: User = {
            id: response.user.id,
            username: response.user.username,
            password: password, // 保存密码用于本地验证（实际应用中应该使用 token）
            role: response.user.role,
            displayName: response.user.display_name,
          };
          setUser(user);
          localStorage.setItem(
            AUTH_STORAGE_KEY,
            JSON.stringify({ username, password, userId: user.id })
          );
          return true;
        }
        return false;
      } catch (error) {
        console.error('Login failed:', error);
        return false;
      }
    }

    // 本地验证（向后兼容）
    const authenticatedUser = authenticateUser(username, password);
    if (authenticatedUser) {
      setUser(authenticatedUser);
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({ username, password, userId: authenticatedUser.id })
      );
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  useEffect(() => {
    // 当用户状态改变时，更新 localStorage
    if (user) {
      // 保持登录状态
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [user]);

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
