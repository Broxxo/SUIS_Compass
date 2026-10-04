/**
 * 更多功能：主界面里不那么常用的入口。格子样式与主界面一致，课堂助手排在第一位。
 */
import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';

export type HubMoreView = 'class-assistant';

const tileClass =
  'rounded-2xl flex flex-col items-center justify-center text-white font-semibold transition-all duration-200 ' +
  'border border-white/20 shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400';

type MoreApp = {
  id: HubMoreView;
  lines: (isZh: boolean) => [string, string];
  style: React.CSSProperties;
};

/** 新的不常用功能加在这个列表后面。 */
const MORE_APPS: MoreApp[] = [
  {
    id: 'class-assistant',
    lines: (isZh) => (isZh ? ['课堂', '助手'] : ['Class', 'Assistant']),
    style: {
      background: 'linear-gradient(145deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
      boxShadow: '0 6px 16px -2px rgba(245, 158, 11, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
    },
  },
];

export default function HubMoreApps({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (view: HubMoreView) => void;
}) {
  const { language, setLanguage } = useLanguage();
  const isZh = language === 'zh';
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(orientation: portrait)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(orientation: portrait)');
    const handler = (event: MediaQueryListEvent) => setIsPortrait(event.matches);
    if ('addEventListener' in mql) mql.addEventListener('change', handler);
    else (mql as unknown as { addListener: (cb: (event: MediaQueryListEvent) => void) => void }).addListener(handler);
    return () => {
      if ('removeEventListener' in mql) mql.removeEventListener('change', handler);
      else (mql as unknown as { removeListener: (cb: (event: MediaQueryListEvent) => void) => void }).removeListener(handler);
    };
  }, []);

  const columns = isPortrait ? 3 : 5;
  const rows = isPortrait ? 5 : 3;
  const grid = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const usableW = vw - 16;
    const usableH = vh - 88;
    const gap = Math.max(8, Math.min(16, vw * 0.015));
    const tileByW = (usableW - gap * (columns - 1)) / columns;
    const tileByH = (usableH - gap * (rows - 1)) / rows;
    const tile = Math.max(76, Math.min(140, Math.floor(Math.min(tileByW, tileByH))));
    return {
      tile,
      gap,
      width: tile * columns + gap * (columns - 1),
      height: tile * rows + gap * (rows - 1),
    };
  }, [columns, rows, isPortrait]);

  return (
    <div className="min-h-dvh w-full max-w-[100%] overflow-x-auto bg-gradient-to-b from-slate-50 to-white pt-[calc(var(--app-topbar-height)+0.5rem)] pb-6">
      <AppTopBar
        title={isZh ? '更多功能' : 'More'}
        showBack
        onBack={onBack}
        rightChildren={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLanguage(isZh ? 'en' : 'zh')}
            className="h-[var(--app-topbar-control)] min-w-[2.75rem] rounded-lg px-3 text-[0.9625rem]"
            title={isZh ? 'Switch to English' : '切换到中文'}
          >
            {isZh ? 'EN' : '中'}
          </Button>
        }
      />
      <div className="flex justify-center px-2 py-4 sm:p-6">
        <div
          className="grid"
          style={{
            width: grid.width,
            height: grid.height,
            gridTemplateColumns: `repeat(${columns}, ${grid.tile}px)`,
            gridAutoRows: `${grid.tile}px`,
            gap: `${grid.gap}px`,
          }}
        >
          {MORE_APPS.map((app, index) => {
            const [primary, secondary] = app.lines(isZh);
            const col = (index % columns) + 1;
            const row = Math.floor(index / columns) + 1;
            return (
              <button
                key={app.id}
                type="button"
                className={`${tileClass} p-1.5 sm:p-2`}
                style={{
                  ...app.style,
                  gridColumnStart: col,
                  gridRowStart: row,
                  fontSize: 'clamp(0.95rem, 2.2vw, 1.25rem)',
                }}
                onClick={() => onOpen(app.id)}
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>{primary}</span>
                  <span>{secondary}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
