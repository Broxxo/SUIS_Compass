/**
 * 统一顶部导航栏：左侧 logo + 用户（点击展开登出），中间当前功能名，右侧内置语言切换 + 可选 AI 按钮 + 各应用自定义按钮
 */
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { LogOut, ArrowLeft, User as UserIcon, Bot } from 'lucide-react';
import { Button } from './ui/button';
import type { User } from '../types';
import { formatNavUserLabel } from '../lib/userDisplay';

interface AppTopBarProps {
  /** 中间显示的功能名称（单语：中文界面用中文，英文界面用英文） */
  title: string;
  /** 是否显示返回按钮（进入子模块时 true） */
  showBack?: boolean;
  /** 点击返回时的回调 */
  onBack?: () => void;
  /** 中间区域（如课程视图 Tab）：存在时与标题并排展示，标题缩至左侧辅助文案 */
  centerContent?: ReactNode;
  /** 右侧区域：各应用自定义按钮（语言切换与 AI 按钮已内置，放在自定义按钮之后） */
  rightChildren?: ReactNode;
  /** 传入则显示 AI 按钮，点击切换侧边栏；不传则不显示（主页 / 更多 / SUIS AI 全屏不传） */
  onToggleAI?: () => void;
  /** AI 侧边栏是否打开，用于按钮高亮 */
  isAIOpen?: boolean;
}

const ROLE_LABELS: Record<User['role'], { zh: string; en: string }> = {
  'system-admin': { zh: '系统管理员', en: 'System Admin' },
  admin: { zh: '管理员', en: 'Admin' },
  teacher: { zh: '教职工', en: 'Staff' },
  student: { zh: '学生', en: 'Student' },
};

export default function AppTopBar({ title, showBack, onBack, centerContent, rightChildren, onToggleAI, isAIOpen }: AppTopBarProps) {
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const isZh = language === 'zh';
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const roleLabel = user?.role ? ROLE_LABELS[user.role][isZh ? 'zh' : 'en'] : '';
  const navUserLabel = user ? formatNavUserLabel(user) : '';

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-20 h-[var(--app-topbar-height)] border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div
        className={`h-full mx-auto px-3 sm:px-4 flex items-center gap-[0.55rem] sm:gap-[0.825rem] ${
          centerContent ? 'max-w-[100rem] justify-between' : 'max-w-6xl justify-between'
        }`}
      >
        {/* 左侧：主界面为 logo，子应用为返回按钮；右侧固定为用户头像 */}
        <div className="flex items-center gap-[0.55rem] min-w-0 shrink-0">
          {showBack && onBack ? (
            <Button
              variant="outline"
              size="icon"
              onClick={onBack}
              className="h-[var(--app-topbar-control)] w-[var(--app-topbar-control)] rounded-lg flex-shrink-0"
              title={isZh ? '返回主界面' : 'Back to home'}
            >
              <ArrowLeft className="h-[var(--app-topbar-icon)] w-[var(--app-topbar-icon)]" />
            </Button>
          ) : (
            <img src="/suislogo.png" alt="SUIS" className="h-[var(--app-topbar-logo)] w-auto object-contain flex-shrink-0" />
          )}
          <div className="relative flex items-center gap-[0.55rem] min-w-0" ref={userMenuRef}>
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => user && setUserMenuOpen((o) => !o)}
              className="h-[var(--app-topbar-control)] w-[var(--app-topbar-control)] rounded-full flex-shrink-0 p-0"
              title={user ? navUserLabel : isZh ? '未登录' : 'Not logged in'}
            >
              <UserIcon className="h-[var(--app-topbar-icon)] w-[var(--app-topbar-icon)]" />
            </Button>
            {user && (
              <span
                className="hidden sm:inline-block text-[0.9625rem] font-medium text-slate-700 truncate max-w-[10rem] md:max-w-[14rem]"
                title={navUserLabel}
              >
                {navUserLabel}
              </span>
            )}
            {user && userMenuOpen && (
              <div className="absolute left-0 top-full mt-1 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-30">
                <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100 truncate max-w-[240px]">
                  {navUserLabel}
                  {roleLabel && <span className="text-slate-400">（{roleLabel}）</span>}
                </div>
                {(user.role === 'system-admin' || user.role === 'admin') && (
                  <button
                    type="button"
                    onClick={() => {
                      const win = window as any;
                      if (typeof win.__openAdminPanel === 'function') {
                        win.__openAdminPanel();
                      }
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm transition-colors"
                  >
                    <span>{isZh ? '后台管理' : 'Admin panel'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{isZh ? '登出' : 'Log out'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {centerContent ? (
          <>
            <span className="hidden sm:inline text-[0.9625rem] font-medium text-slate-600 truncate max-w-[9rem] md:max-w-[12rem] shrink-0">
              {title}
            </span>
            <div className="flex-1 min-w-0 flex justify-center overflow-x-auto overflow-y-hidden no-scrollbar">
              {centerContent}
            </div>
          </>
        ) : (
          <h1 className="absolute left-1/2 -translate-x-1/2 text-[1.2375rem] sm:text-[1.375rem] font-semibold text-slate-800 truncate max-w-[50vw] pointer-events-none">
            {title}
          </h1>
        )}

        {/* 右侧：各应用功能按钮（返回已在左侧替代 logo）+ 内置 AI 按钮 + 内置语言切换 */}
        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto min-w-0 shrink-0">
          {rightChildren}
          {onToggleAI ? (
            <Button
              variant={isAIOpen ? 'default' : 'outline'}
              size="icon"
              onClick={onToggleAI}
              className="h-[var(--app-topbar-control)] w-[var(--app-topbar-control)] flex-shrink-0 rounded-lg"
              title="AI"
              aria-label="AI"
            >
              <Bot className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLanguage(isZh ? 'en' : 'zh')}
            className="h-[var(--app-topbar-control)] min-w-[2.75rem] rounded-lg px-3 text-[0.9625rem]"
            title={isZh ? 'Switch to English' : '切换到中文'}
          >
            {isZh ? 'EN' : '中'}
          </Button>
        </div>
      </div>
    </header>
  );
}
