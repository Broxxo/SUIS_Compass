import { useState, useEffect } from 'react'
import CurriculumRoadmap from './components/CurriculumRoadmap'
import CompassHub from './components/CompassHub'
import LoginDialog from './components/LoginDialog'
import AIPanel from './components/AIPanel'
import { LanguageProvider } from './contexts/LanguageContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AIContextProvider, useAIContext } from './contexts/AIContext'
import AdminPanel from './components/AdminPanel'
import ClassAssistant from './components/ClassAssistant'
import HubMoreApps from './components/HubMoreApps'
import OpenLessons from './components/OpenLessons'
import SchoolCalendar from './components/SchoolCalendar'
import XieheLighthouse from './components/XieheLighthouse'
import MailboxInbox from './components/MailboxInbox'
import StudentPortrait from './components/StudentPortrait'
import TeacherPortrait from './components/TeacherPortrait'
import type { HubPortraitNavigation } from './types/hubNavigation'

type HubView =
  | 'suis-ai'
  | 'curriculum-roadmap'
  | 'student-portrait'
  | 'teacher-portrait'
  | 'academic-reports'
  | 'class-assistant'
  | 'open-lessons'
  | 'school-calendar'
  | 'lighthouse'
  | 'more'
  | 'admin'
  | 'mailbox';

const MOBILE_BREAKPOINT = 768;

/**
 * 桌面侧窗 AI 在上一档上再收窄 10%，空出来的宽度还给主栏，两边仍然相接。
 * 窄屏：主栏 63.55%，侧窗 36.45%（最宽 524.88px）。
 * 宽于 1440px：主栏 calc(81.775% - 262.44px)，侧窗 calc(18.225% + 262.44px)。
 */
const AI_DOCK_MAIN_OPEN = 'w-[63.55%] min-w-0 overflow-hidden min-[1440px]:w-[calc(81.775%-262.44px)]';
const AI_DOCK_MAIN_OPEN_FULL = 'h-full w-[63.55%] min-w-0 overflow-hidden min-[1440px]:w-[calc(81.775%-262.44px)]';
/** 桌面锁在一屏里；手机宽度放开，让窗口本身能上下、左右滚到超出的内容。 */
const APP_FRAME = 'flex h-dvh w-full min-w-0 overflow-auto max-md:h-auto max-md:min-h-dvh max-md:overflow-visible';
const AI_DOCK_PANEL =
  'fixed inset-y-0 right-0 z-30 flex w-[36.45%] min-w-[262.44px] max-w-[524.88px] flex-col border-l border-slate-200 bg-white shadow-xl min-[1440px]:w-[calc(18.225%+262.44px)] min-[1440px]:max-w-none';

function AppContent() {
  const { isAuthenticated, user } = useAuth();
  const { setScreenId, setContextPayload } = useAIContext();
  const [view, setView] = useState<HubView | 'hub'>('hub');
  const [portraitNav, setPortraitNav] = useState<HubPortraitNavigation | null>(null);
  const [aiOverlayOpen, setAiOverlayOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    mql.addEventListener('change', update);
    update();
    return () => mql.removeEventListener('change', update);
  }, []);

  // 提供给顶栏用户菜单调用的全局入口（仅 admin 会看到）
  useEffect(() => {
    const win = window as any;
    const handler = () => {
      // 只有管理员和系统管理员可以打开后台管理
      if (user?.role === 'admin' || user?.role === 'system-admin') {
        setView('admin');
      }
    };
    win.__openAdminPanel = handler;
    return () => {
      if (win.__openAdminPanel === handler) {
        delete win.__openAdminPanel;
      }
    };
  }, [user?.role]);

  // 登录 / 注销 或角色变化时，重置视图，防止教师继承上一次的 admin 视图
  useEffect(() => {
    if (!isAuthenticated) {
      setView('hub');
      setAiOverlayOpen(false);
      return;
    }
    if (view === 'admin' && user && user.role !== 'admin' && user.role !== 'system-admin') {
      setView('hub');
    }
  }, [isAuthenticated, user?.role, view]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const config = {
        VITE_USE_CLOUD_STORAGE: import.meta.env.VITE_USE_CLOUD_STORAGE,
        VITE_API_URL: import.meta.env.VITE_API_URL,
        USE_CLOUD_STORAGE: import.meta.env.VITE_USE_CLOUD_STORAGE === 'true',
        API_BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
      };
      console.log('🚀 App Configuration:', config);
      if (!config.USE_CLOUD_STORAGE) {
        console.warn('⚠️ Cloud storage is DISABLED! Data will only be saved to localStorage.');
      } else {
        console.log('✅ Cloud storage is ENABLED');
        console.log(`📡 API URL: ${config.API_BASE_URL}`);
      }
    }
  }, []);

  if (!isAuthenticated) {
    return <LoginDialog />;
  }

  // 学生账号仅使用学生画像（自有数据），不进入主 HUB 与其他应用
  if (user?.role === 'student') {
    return <StudentPortrait onBackToHub={() => {}} />;
  }

  // SUIS AI：从主界面进入，全屏
  if (view === 'suis-ai') {
    return (
      <div className="flex h-dvh w-full min-w-0 flex-col overflow-hidden">
        <AIPanel fullScreen fromHub onClose={() => setView('hub')} />
      </div>
    );
  }

  // 课程河流：始终挂载一个 CurriculumRoadmap；打开 AI 时桌面半屏、手机全屏覆盖
  if (view === 'curriculum-roadmap') {
    return (
      <div className="relative flex h-dvh w-full min-w-0 overflow-hidden">
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN : 'h-full min-h-0 w-full min-w-0'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <CurriculumRoadmap
            surface="hub"
            onBackToHub={() => setView('hub')}
            isAIOpen={aiOverlayOpen}
            onToggleAI={() => setAiOverlayOpen((open) => !open)}
          />
        </div>
        {aiOverlayOpen && (
          <div
            className={
              isMobile
                ? 'fixed inset-0 z-30 bg-white flex flex-col'
                : AI_DOCK_PANEL
            }
          >
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'admin') {
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <AdminPanel onBackToHub={() => setView('hub')} isAIOpen={aiOverlayOpen} onToggleAI={() => setAiOverlayOpen((open) => !open)} />
        </div>
        {aiOverlayOpen && (
          <div className={isMobile ? 'fixed inset-0 z-30 bg-white flex flex-col' : AI_DOCK_PANEL}>
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'more') {
    return (
      <HubMoreApps
        onBack={() => setView('hub')}
        onOpen={(next) => setView(next)}
      />
    );
  }

  if (view === 'class-assistant') {
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <ClassAssistant onBackToHub={() => setView('more')} isAIOpen={aiOverlayOpen} onToggleAI={() => setAiOverlayOpen((open) => !open)} />
        </div>
        {aiOverlayOpen && (
          <div className={isMobile ? 'fixed inset-0 z-30 bg-white flex flex-col' : AI_DOCK_PANEL}>
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'lighthouse') {
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <XieheLighthouse
            onBackToHub={() => setView('hub')}
            isAIOpen={aiOverlayOpen}
            onToggleAI={() => setAiOverlayOpen((open) => !open)}
          />
        </div>
        {aiOverlayOpen && (
          <div className={isMobile ? 'fixed inset-0 z-30 bg-white flex flex-col' : AI_DOCK_PANEL}>
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'school-calendar') {
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <SchoolCalendar
            onBackToHub={() => setView('hub')}
            isAIOpen={aiOverlayOpen}
            onToggleAI={() => setAiOverlayOpen((open) => !open)}
          />
        </div>
        {aiOverlayOpen && (
          <div
            className={
              isMobile
                ? 'fixed inset-0 z-30 bg-white flex flex-col'
                : AI_DOCK_PANEL
            }
          >
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'open-lessons') {
    const nav = portraitNav?.view === 'open-lessons' ? portraitNav : null;
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <OpenLessons
            onBackToHub={() => {
              setPortraitNav(null);
              setView('hub');
            }}
            initialYearId={nav?.academicYearId}
            initialTerm={nav?.term}
            initialLessonKind={nav?.lessonKind}
            initialLessonId={nav?.lessonId}
            isAIOpen={aiOverlayOpen}
            onToggleAI={() => setAiOverlayOpen((open) => !open)}
          />
        </div>
        {aiOverlayOpen && (
          <div className={isMobile ? 'fixed inset-0 z-30 bg-white flex flex-col' : AI_DOCK_PANEL}>
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'student-portrait' || view === 'academic-reports') {
    const nav = portraitNav?.view === 'academic-reports' ? portraitNav : null;
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <StudentPortrait
            onBackToHub={() => {
              setPortraitNav(null);
              setView('hub');
            }}
            initialTab={view === 'academic-reports' ? 'academic-reports' : 'overview'}
            initialWorkbenchTemplateId={nav?.templateId}
            initialReportYearId={nav?.academicYearId}
            initialReportTerm={nav?.term}
            isAIOpen={aiOverlayOpen}
            onToggleAI={() => setAiOverlayOpen((open) => !open)}
          />
        </div>
        {aiOverlayOpen && (
          <div
            className={
              isMobile
                ? 'fixed inset-0 z-30 bg-white flex flex-col'
                : AI_DOCK_PANEL
            }
          >
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'teacher-portrait') {
    const nav = portraitNav?.view === 'teacher-portrait' ? portraitNav : null;
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <TeacherPortrait
            onBackToHub={() => {
              setPortraitNav(null);
              setView('hub');
            }}
            initialTab={nav?.portraitTab ?? (nav ? 'collections' : undefined)}
            initialYearId={nav?.academicYearId}
            initialTerm={nav?.term}
            initialCollectionTemplateId={nav?.templateId}
            isAIOpen={aiOverlayOpen}
            onToggleAI={() => setAiOverlayOpen((open) => !open)}
          />
        </div>
        {aiOverlayOpen && (
          <div
            className={
              isMobile
                ? 'fixed inset-0 z-30 bg-white flex flex-col'
                : AI_DOCK_PANEL
            }
          >
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'mailbox') {
    return (
      <div className={`${APP_FRAME} relative`}>
        <div
          className={aiOverlayOpen && !isMobile ? AI_DOCK_MAIN_OPEN_FULL : 'w-full h-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <MailboxInbox onBack={() => setView('hub')} isAIOpen={aiOverlayOpen} onToggleAI={() => setAiOverlayOpen((open) => !open)} />
        </div>
        {aiOverlayOpen && (
          <div className={isMobile ? 'fixed inset-0 z-30 bg-white flex flex-col' : AI_DOCK_PANEL}>
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  // 其他入口暂未实现
  if (view !== 'hub') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <p className="text-slate-600 mb-4">该功能即将推出</p>
        <button
          type="button"
          onClick={() => setView('hub')}
          className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800"
        >
          返回主界面
        </button>
      </div>
    );
  }

  return (
    <CompassHub
      onOpenInbox={() => setView('mailbox')}
      onNavigate={(v) => {
        setPortraitNav(null);
        if (v === 'suis-ai') {
          // 从主 HUB 进入 SUIS AI 时，重置上下文为“无特定应用”
          setScreenId(null);
          setContextPayload({});
        }
        setView(v);
      }}
      onOpenTodo={(nav) => {
        setPortraitNav(nav);
        setView(nav.view);
      }}
    />
  );
}

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AIContextProvider>
          <AppContent />
        </AIContextProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App
