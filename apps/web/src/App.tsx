import { useState, useEffect } from 'react'
import CurriculumRoadmap from './components/CurriculumRoadmap'
import CompassHub from './components/CompassHub'
import LoginDialog from './components/LoginDialog'
import AIPanel from './components/AIPanel'
import { LanguageProvider } from './contexts/LanguageContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AIContextProvider, useAIContext } from './contexts/AIContext'
import AdminPanel from './components/AdminPanel'
import ClassManagement from './components/ClassManagement'
import ClassAssistant from './components/ClassAssistant'

type HubView =
  | 'suis-ai'
  | 'curriculum-roadmap'
  | 'student-portrait'
  | 'teacher-portrait'
  | 'class-assistant'
  | 'class-management'
  | 'admin';

const MOBILE_BREAKPOINT = 768;

function AppContent() {
  const { isAuthenticated, user } = useAuth();
  const { setScreenId, setContextPayload } = useAIContext();
  const [view, setView] = useState<HubView | 'hub'>('hub');
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

  // SUIS AI：从主界面进入，全屏
  if (view === 'suis-ai') {
    return (
      <div className="h-screen w-screen flex flex-col">
        <AIPanel fullScreen fromHub onClose={() => setView('hub')} />
      </div>
    );
  }

  // 课程河流：始终挂载一个 CurriculumRoadmap；打开 AI 时桌面半屏、手机全屏覆盖
  if (view === 'curriculum-roadmap') {
    return (
      <div className="h-screen w-screen flex relative">
        <div
          className={aiOverlayOpen && !isMobile ? 'w-1/2 min-w-0 overflow-hidden' : 'w-full'}
          style={aiOverlayOpen && isMobile ? { display: 'none' } : undefined}
        >
          <CurriculumRoadmap
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
                : 'fixed inset-y-0 right-0 z-30 w-1/2 min-w-[360px] max-w-[720px] bg-white border-l border-slate-200 flex flex-col shadow-xl'
            }
          >
            <AIPanel fullScreen={isMobile} fromHub={false} onClose={() => setAiOverlayOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  if (view === 'admin') {
    return <AdminPanel onBackToHub={() => setView('hub')} />;
  }

  if (view === 'class-management') {
    return (
      <ClassManagement
        onBackToHub={() => setView('hub')}
        pageTitle={undefined}
        hideYearGear
      />
    );
  }

  if (view === 'class-assistant') {
    return <ClassAssistant onBackToHub={() => setView('hub')} />
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
      onNavigate={(v) => {
        if (v === 'suis-ai') {
          // 从主 HUB 进入 SUIS AI 时，重置上下文为“无特定应用”
          setScreenId(null);
          setContextPayload({});
        }
        setView(v);
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
