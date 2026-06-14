import { Fragment, useCallback, useEffect, useState } from 'react';
import { fetchHubAdminTodos, fetchHubTeacherTodos } from '../lib/hubTeacherTodos';
import type { HubTeacherTodoItem } from '../types/hubNavigation';

const MAX_VISIBLE_TODOS = 2;

/** 淡青蓝磨砂玻璃（拖拽预览与主组件一致） */
const hubTodosGlassLayers = {
  wash: 'linear-gradient(165deg, rgba(236,254,255,0.52) 0%, rgba(207,250,254,0.34) 50%, rgba(224,247,250,0.42) 100%)',
  blur: 'blur(20px) saturate(152%)',
  border: '1px solid rgba(125, 211, 252, 0.42)',
  shadow: '0 4px 14px rgba(103, 155, 175, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.32)',
  divider:
    'linear-gradient(90deg, transparent 0%, rgba(125,211,252,0.22) 20%, rgba(125,211,252,0.22) 80%, transparent 100%)',
} as const;

export const hubTodosFrostedStyle: React.CSSProperties = {
  background: hubTodosGlassLayers.wash,
  backdropFilter: hubTodosGlassLayers.blur,
  WebkitBackdropFilter: hubTodosGlassLayers.blur,
  border: hubTodosGlassLayers.border,
  boxShadow: hubTodosGlassLayers.shadow,
};

export type HubTodosViewerRole = 'teacher' | 'admin';

export default function HubTeacherTodosTile({
  isZh,
  editing,
  viewerRole,
  onOpenTodo,
}: {
  isZh: boolean;
  editing: boolean;
  viewerRole: HubTodosViewerRole;
  onOpenTodo: (item: HubTeacherTodoItem) => void;
}) {
  const [todos, setTodos] = useState<HubTeacherTodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const items =
        viewerRole === 'admin' ? await fetchHubAdminTodos(isZh) : await fetchHubTeacherTodos(isZh);
      setTodos(items);
    } catch {
      setTodos([]);
    } finally {
      setLoading(false);
    }
  }, [isZh, viewerRole]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const visibleTodos = todos.slice(0, MAX_VISIBLE_TODOS);

  return (
    <div
      className="relative isolate h-full w-full overflow-hidden rounded-2xl"
      style={hubTodosFrostedStyle}
    >
      <div className="relative z-10 flex h-full w-full flex-col text-left text-slate-800">
        <div className="shrink-0 px-2.5 pb-1 pt-2.5">
          <div className="text-[10px] font-medium tracking-wide text-slate-500 sm:text-[11px]">
            {isZh ? '待办' : 'Tasks'}
          </div>
        </div>
        <div className="min-h-0 flex-1 px-2 pb-2">
          {loading ? (
            <p className="text-[10px] text-slate-500 sm:text-[11px]">{isZh ? '加载中…' : 'Loading…'}</p>
          ) : visibleTodos.length === 0 ? (
            <p className="text-[10px] leading-snug text-slate-500 sm:text-[11px]">
              {isZh ? '暂无待办' : 'No tasks'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg">
              {visibleTodos.map((item, index) => (
                <Fragment key={item.key}>
                  {index > 0 ? (
                    <div
                      className="mx-1 h-px"
                      style={{ background: hubTodosGlassLayers.divider }}
                      aria-hidden
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={editing}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editing) return;
                      onOpenTodo(item);
                    }}
                    className="w-full rounded-lg px-1.5 py-1.5 text-left transition-all hover:bg-cyan-100/60 hover:ring-1 hover:ring-cyan-200/45 active:bg-cyan-200/50 active:ring-cyan-300/40 disabled:pointer-events-none disabled:opacity-60"
                  >
                    <div className="line-clamp-2 text-[10px] font-medium leading-tight text-slate-700 sm:text-[11px]">
                      {item.label}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] leading-tight text-slate-500 sm:text-[10px]">
                      {item.subtitle}
                    </div>
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
