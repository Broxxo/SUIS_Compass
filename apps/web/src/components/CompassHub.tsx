/**
 * SUIS COMPASS 主入口：16 单位网格，仅 2x2 与 1x1 入口，错落排布。
 */
import { useLanguage } from '../contexts/LanguageContext';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';

type HubView = 'suis-ai' | 'curriculum-roadmap' | 'student-portrait' | 'class-assistant' | 'class-management';

const GRID_COLS = 4;
const GRID_ROWS = 4;
const GAP = 12;

/** 立体入口按钮通用样式：阴影、高光、hover 上浮 */
const tileBase =
  'rounded-2xl flex flex-col items-center justify-center text-white font-semibold transition-all duration-200 ' +
  'border border-white/20 shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400';

export default function CompassHub({
  onNavigate,
}: {
  onNavigate: (view: HubView) => void;
}) {
  const { language, setLanguage } = useLanguage();
  const isZh = language === 'zh';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pt-16 pb-6">
      <AppTopBar
        title={isZh ? '协和智能教学中心' : 'SUIS COMPASS'}
        rightChildren={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLanguage(isZh ? 'en' : 'zh')}
            className="h-9 rounded-lg px-3 min-w-[2.5rem]"
            title={isZh ? 'Switch to English' : '切换到中文'}
          >
            {isZh ? 'EN' : '中'}
          </Button>
        }
      />
      <div className="p-4 sm:p-6">

      {/* 16 单位网格：4x4，错落有致 */}
      <div
        className="mx-auto max-w-2xl"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          gap: GAP,
          aspectRatio: '1',
          minHeight: 280,
          maxHeight: 'min(90vmin, 420px)',
        }}
      >
        {/* SUIS AI - 2x2，左上 */}
        <button
          type="button"
          onClick={() => onNavigate('suis-ai')}
          className={`${tileBase} text-xl sm:text-2xl p-4`}
          style={{
            background: 'linear-gradient(145deg, #6366f1 0%, #7c3aed 50%, #6d28d9 100%)',
            boxShadow: '0 8px 24px -4px rgba(99, 102, 241, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
            gridColumn: '1 / span 2',
            gridRow: '1 / span 2',
          }}
        >
          <span>SUIS AI</span>
        </button>

        {/* 课程河流 - 1x1 */}
        <button
          type="button"
          onClick={() => onNavigate('curriculum-roadmap')}
          className={`${tileBase} text-sm sm:text-base p-2`}
          style={{
            background: 'linear-gradient(145deg, #0ea5e9 0%, #0284c7 50%, #0369a1 100%)',
            boxShadow: '0 6px 16px -2px rgba(14, 165, 233, 0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
            gridColumn: '3 / span 1',
            gridRow: '1 / span 1',
          }}
        >
          <span className="flex flex-col items-center leading-tight">
            <span>{isZh ? '课程' : 'Curriculum'}</span>
            <span>{isZh ? '河流' : 'Roadmap'}</span>
          </span>
        </button>

        {/* 占位 1 */}
        <div className="rounded-xl bg-slate-200/60 border border-slate-200" style={{ gridColumn: '4', gridRow: '1' }} />

        {/* 占位 2 */}
        <div className="rounded-xl bg-slate-200/60 border border-slate-200" style={{ gridColumn: '3', gridRow: '2' }} />

        {/* 占位 3 */}
        <div className="rounded-xl bg-slate-200/60 border border-slate-200" style={{ gridColumn: '4', gridRow: '2' }} />

        {/* 学生画像 - 2x2，中下 */}
        <button
          type="button"
          onClick={() => onNavigate('student-portrait')}
          className={`${tileBase} text-xl sm:text-2xl p-4`}
          style={{
            background: 'linear-gradient(145deg, #10b981 0%, #059669 50%, #047857 100%)',
            boxShadow: '0 8px 24px -4px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
            gridColumn: '2 / span 2',
            gridRow: '3 / span 2',
          }}
        >
          <span className="flex flex-col items-center leading-tight">
            <span>{isZh ? '学生' : 'Student'}</span>
            <span>{isZh ? '画像' : 'Portrait'}</span>
          </span>
        </button>

        {/* 课堂助手 - 1x1 */}
        <button
          type="button"
          onClick={() => onNavigate('class-assistant')}
          className={`${tileBase} text-sm sm:text-base p-2`}
          style={{
            background: 'linear-gradient(145deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
            boxShadow: '0 6px 16px -2px rgba(245, 158, 11, 0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
            gridColumn: '4 / span 1',
            gridRow: '3 / span 1',
          }}
        >
          <span className="flex flex-col items-center leading-tight">
            <span>{isZh ? '课堂' : 'Class'}</span>
            <span>{isZh ? '助手' : 'Assistant'}</span>
          </span>
        </button>

        {/* 我的班级 - 1x1，右下 */}
        <button
          type="button"
          onClick={() => onNavigate('class-management')}
          className={`${tileBase} text-sm sm:text-base p-2`}
          style={{
            background: 'linear-gradient(145deg, #64748b 0%, #475569 50%, #334155 100%)',
            boxShadow: '0 6px 16px -2px rgba(71, 85, 105, 0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
            gridColumn: '4',
            gridRow: '4',
          }}
        >
          <span className="flex flex-col items-center leading-tight">
            <span>{isZh ? '我的' : 'My'}</span>
            <span>{isZh ? '班级' : 'Classes'}</span>
          </span>
        </button>

        {/* 占位 5 */}
        <div className="rounded-xl bg-slate-200/60 border border-slate-200" style={{ gridColumn: '1', gridRow: '3' }} />

        {/* 占位 6 */}
        <div className="rounded-xl bg-slate-200/60 border border-slate-200" style={{ gridColumn: '1', gridRow: '4' }} />
      </div>
      </div>
    </div>
  );
}
