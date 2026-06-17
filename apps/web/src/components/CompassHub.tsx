/**
 * SUIS COMPASS 主入口：16 单位网格，2x2 与 1x1 入口错落排布，随窗口自适应。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  defaultAnimateLayoutChanges,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type { HubPortraitNavigation, HubTeacherTodoItem } from '../types/hubNavigation';
import AppTopBar from './AppTopBar';
import HubTeacherTodosTile, { hubTodosFrostedStyle, type HubTodosViewerRole } from './HubTeacherTodosTile';
import { Button } from './ui/button';

type HubView =
  | 'suis-ai'
  | 'curriculum-roadmap'
  | 'student-portrait'
  | 'teacher-portrait'
  | 'academic-reports'
  | 'class-assistant';

/** 立体入口按钮通用样式：阴影、高光、hover 上浮 */
const tileBase =
  'rounded-2xl flex flex-col items-center justify-center text-white font-semibold transition-all duration-200 ' +
  'border border-white/20 shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400';

type HubTileId =
  | 'teacher-todos'
  | 'class-assistant'
  | 'suis-ai'
  | 'curriculum-roadmap'
  | 'student-portrait'
  | 'teacher-portrait'
  | 'academic-reports'
  | `placeholder-${number}`;

type HubTile = {
  id: HubTileId;
  kind: 'app' | 'placeholder' | 'widget';
  view?: HubView;
  spanX: 1 | 2;
  spanY: 1 | 2;
  /** 1x1 小格字体、2x2 大格字体分别控制 */
  fontSize: string;
  className?: string;
  style?: React.CSSProperties;
  renderLabel?: (isZh: boolean) => React.ReactNode;
};

const HUB_LAYOUT_STORAGE_KEY = 'suis-compass-hub-layout-v3';

function migrateSavedHubIds(savedIds: string[]): string[] {
  const out: string[] = [];
  for (const id of savedIds) {
    if (id === 'class-management') continue;
    if (!out.includes(id)) out.push(id);
  }
  if (!out.includes('teacher-todos')) {
    out.unshift('teacher-todos');
  }
  return out;
}

function reorderBySavedIds<T extends { id: string }>(items: T[], savedIds: string[] | null) {
  if (!savedIds || savedIds.length === 0) return items;
  const migrated = migrateSavedHubIds(savedIds);
  const map = new Map(items.map((x) => [x.id, x] as const));
  const result: T[] = [];
  for (const id of migrated) {
    const hit = map.get(id);
    if (hit) {
      result.push(hit);
      map.delete(id);
    }
  }
  // append any new items
  for (const x of items) {
    if (map.has(x.id)) result.push(x);
  }
  return result;
}

type PackedPos = {
  col: number; // 1-based
  row: number; // 1-based
  spanX: 1 | 2;
  spanY: 1 | 2;
};

function packTilesIntoGrid(tiles: HubTile[], columns: number, rows: number): Map<HubTileId, PackedPos> | null {
  const out = new Map<HubTileId, PackedPos>();
  const occ: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));

  const canPlace = (r: number, c: number, spanX: number, spanY: number) => {
    if (c + spanX > columns) return false;
    if (r + spanY > rows) return false;
    for (let rr = r; rr < r + spanY; rr++) {
      for (let cc = c; cc < c + spanX; cc++) {
        if (occ[rr][cc]) return false;
      }
    }
    return true;
  };

  const mark = (r: number, c: number, spanX: number, spanY: number, v: boolean) => {
    for (let rr = r; rr < r + spanY; rr++) {
      for (let cc = c; cc < c + spanX; cc++) {
        occ[rr][cc] = v;
      }
    }
  };

  const candidates: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      candidates.push({ r, c });
    }
  }

  // Order-sensitive backtracking: place tiles in the same order as `tiles`.
  // This is what makes a 2x2 tile able to "insert" into a region of 1x1 tiles after reordering.
  const placeAtIndex = (i: number): boolean => {
    if (i >= tiles.length) return true;
    const t = tiles[i];
    const spanX = t.spanX;
    const spanY = t.spanY;

    for (const { r, c } of candidates) {
      if (!canPlace(r, c, spanX, spanY)) continue;
      mark(r, c, spanX, spanY, true);
      out.set(t.id, { row: r + 1, col: c + 1, spanX, spanY });
      if (placeAtIndex(i + 1)) return true;
      out.delete(t.id);
      mark(r, c, spanX, spanY, false);
    }
    return false;
  };

  if (!placeAtIndex(0)) return null;
  return out;
}

function useLongPress(options: { delayMs: number; tolerancePx: number; onLongPress: () => void }) {
  const { delayMs, tolerancePx, onLongPress } = options;
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
    firedRef.current = false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    firedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, delayMs);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || firedRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > tolerancePx) {
      clear();
    }
  };

  const onPointerUp = () => clear();
  const onPointerCancel = () => clear();

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

function SortableTile({
  tile,
  isZh,
  editing,
  activeId,
  packed,
  onClick,
  onLongPress,
  onOpenTodo,
  todosViewerRole,
}: {
  tile: HubTile;
  isZh: boolean;
  editing: boolean;
  activeId: HubTileId | null;
  packed: PackedPos;
  onClick?: () => void;
  onLongPress: (tileId: HubTileId) => void;
  onOpenTodo: (item: HubTeacherTodoItem) => void;
  todosViewerRole: HubTodosViewerRole;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tile.id,
    disabled: !editing,
    animateLayoutChanges: (args) => {
      // smoother reflow when sorting in a dense grid
      return defaultAnimateLayoutChanges({
        ...args,
        wasDragging: true,
      });
    },
  });

  const longPress = useLongPress({
    delayMs: 380,
    tolerancePx: 8,
    onLongPress: () => onLongPress(tile.id),
  });

  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    zIndex: isDragging ? 50 : undefined,
    willChange: 'transform',
    touchAction: 'none',
  };

  const baseStyle: React.CSSProperties = {
    gridColumnStart: packed.col,
    gridColumnEnd: `span ${packed.spanX}`,
    gridRowStart: packed.row,
    gridRowEnd: `span ${packed.spanY}`,
    fontSize: tile.fontSize,
    ...tile.style,
  };

  const commonClass =
    (tile.kind === 'placeholder'
      ? 'rounded-xl bg-slate-200/60 border border-slate-200'
      : tile.kind === 'widget'
        ? 'rounded-2xl overflow-hidden'
        : tileBase) +
    ' select-none';

  const jiggleClass =
    editing && tile.kind !== 'placeholder' && tile.id !== activeId ? ' hub-jiggle' : '';

  if (tile.kind === 'placeholder') {
    return (
      <div
        ref={setNodeRef}
        data-hub-tile
        className={commonClass}
        style={{
          ...baseStyle,
          ...dndStyle,
          aspectRatio: '1',
        }}
        {...attributes}
        {...(editing ? listeners : undefined)}
        {...(!editing ? longPress : undefined)}
        aria-hidden
      />
    );
  }

  if (tile.kind === 'widget') {
    return (
      <div
        ref={setNodeRef}
        data-hub-tile
        className={`${commonClass}${jiggleClass}`}
        style={{
          ...baseStyle,
          ...dndStyle,
          background: 'transparent',
        }}
        {...attributes}
        {...(editing ? listeners : undefined)}
        {...(!editing ? longPress : undefined)}
      >
        <HubTeacherTodosTile
          isZh={isZh}
          editing={editing}
          viewerRole={todosViewerRole}
          onOpenTodo={onOpenTodo}
        />
      </div>
    );
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      data-hub-tile
      className={`${commonClass}${jiggleClass} ${tile.className ?? ''}`}
      style={{
        ...baseStyle,
        ...dndStyle,
      }}
      {...attributes}
      {...(editing ? listeners : undefined)}
      {...(!editing ? longPress : undefined)}
    >
      {tile.renderLabel ? tile.renderLabel(isZh) : null}
    </button>
  );
}

export default function CompassHub({
  onNavigate,
  onOpenTodo,
}: {
  onNavigate: (view: HubView) => void;
  onOpenTodo: (nav: HubPortraitNavigation) => void;
}) {
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();
  const isZh = language === 'zh';
  const isTeacher = user?.role === 'teacher';
  const isAdmin = user?.role === 'admin' || user?.role === 'system-admin';
  const todosViewerRole: HubTodosViewerRole | null = isTeacher ? 'teacher' : isAdmin ? 'admin' : null;
  const showTodosTile = isTeacher || isAdmin;
  const [editing, setEditing] = useState(false);
  const [activeId, setActiveId] = useState<HubTileId | null>(null);
  const lastOverIdRef = useRef<HubTileId | null>(null);

  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(orientation: portrait)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(orientation: portrait)');
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    // Safari fallback: addListener/removeListener
    if ('addEventListener' in mql) mql.addEventListener('change', handler);
    else (mql as any).addListener(handler);
    setIsPortrait(mql.matches);
    return () => {
      if ('removeEventListener' in mql) mql.removeEventListener('change', handler);
      else (mql as any).removeListener(handler);
    };
  }, []);

  const columns = isPortrait ? 3 : 5;
  const rows = isPortrait ? 5 : 3;

  const handleOpenTodo = (item: HubTeacherTodoItem) => {
    if (item.target.type === 'teacher-portrait-collection') {
      onOpenTodo({
        view: 'teacher-portrait',
        academicYearId: item.target.academicYearId,
        term: item.target.term,
        templateId: item.target.templateId,
        portraitTab: isAdmin ? 'school' : 'collections',
      });
      return;
    }
    onOpenTodo({
      view: 'academic-reports',
      academicYearId: item.target.academicYearId,
      term: item.target.term,
      templateId: item.target.templateId,
    });
  };

  const defaultTiles: HubTile[] = useMemo(
    () => [
      ...(showTodosTile
        ? [{ id: 'teacher-todos' as const, kind: 'widget' as const, spanX: 1 as const, spanY: 1 as const, fontSize: '0.75rem' }]
        : []),
      { id: 'placeholder-1', kind: 'placeholder', spanX: 1, spanY: 1, fontSize: '1rem' },
      { id: 'placeholder-2', kind: 'placeholder', spanX: 1, spanY: 1, fontSize: '1rem' },

      {
        id: 'teacher-portrait',
        kind: 'app',
        view: 'teacher-portrait',
        spanX: 2,
        spanY: 2,
        fontSize: 'clamp(1.25rem, 3vw, 1.85rem)',
        className: 'p-2 sm:p-4',
        style: {
          background: 'linear-gradient(145deg, #d9776c 0%, #c4685a 50%, #a85548 100%)',
          boxShadow: '0 8px 24px -4px rgba(168, 85, 72, 0.38), inset 0 1px 0 rgba(255,255,255,0.2)',
        },
        renderLabel: (zh) => (
          <span className="flex flex-col items-center leading-tight">
            <span>{zh ? '教师' : 'Teacher'}</span>
            <span>{zh ? '中心' : 'Center'}</span>
          </span>
        ),
      },
      {
        id: 'suis-ai',
        kind: 'app',
        view: 'suis-ai',
        spanX: 1,
        spanY: 1,
        fontSize: 'clamp(0.95rem, 2.2vw, 1.25rem)',
        className: 'p-1.5 sm:p-2',
        style: {
          background: 'linear-gradient(145deg, #6366f1 0%, #7c3aed 50%, #6d28d9 100%)',
          boxShadow: '0 6px 16px -2px rgba(99, 102, 241, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        },
        renderLabel: () => <span>SUIS AI</span>,
      },
      {
        id: 'curriculum-roadmap',
        kind: 'app',
        view: 'curriculum-roadmap',
        spanX: 1,
        spanY: 1,
        fontSize: 'clamp(0.95rem, 2.2vw, 1.25rem)',
        className: 'p-1.5 sm:p-2',
        style: {
          background: 'linear-gradient(145deg, #0ea5e9 0%, #0284c7 50%, #0369a1 100%)',
          boxShadow: '0 6px 16px -2px rgba(14, 165, 233, 0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
        },
        renderLabel: (zh) => (
          <span className="flex flex-col items-center leading-tight">
            <span>{zh ? '课程' : 'Curriculum'}</span>
            <span>{zh ? '河流' : 'Roadmap'}</span>
          </span>
        ),
      },
      {
        id: 'academic-reports',
        kind: 'app',
        view: 'academic-reports',
        spanX: 1,
        spanY: 1,
        fontSize: 'clamp(0.95rem, 2.2vw, 1.25rem)',
        className: 'p-1.5 sm:p-2',
        style: {
          background: 'linear-gradient(145deg, #0d9488 0%, #0f766e 50%, #115e59 100%)',
          boxShadow: '0 6px 16px -2px rgba(15, 118, 110, 0.35), inset 0 1px 0 rgba(255,255,255,0.22)',
        },
        renderLabel: (zh) => (
          <span className="flex flex-col items-center leading-tight">
            <span>{zh ? '学业' : 'Academic'}</span>
            <span>{zh ? '报告' : 'Reports'}</span>
          </span>
        ),
      },

      {
        id: 'student-portrait',
        kind: 'app',
        view: 'student-portrait',
        spanX: 2,
        spanY: 2,
        fontSize: 'clamp(1.25rem, 3vw, 1.85rem)',
        className: 'p-2 sm:p-4',
        style: {
          background: 'linear-gradient(145deg, #10b981 0%, #059669 50%, #047857 100%)',
          boxShadow: '0 8px 24px -4px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
        },
        renderLabel: (zh) => (
          <span className="flex flex-col items-center leading-tight">
            <span>{zh ? '学生' : 'Student'}</span>
            <span>{zh ? '中心' : 'Center'}</span>
          </span>
        ),
      },
      {
        id: 'class-assistant',
        kind: 'app',
        view: 'class-assistant',
        spanX: 1,
        spanY: 1,
        fontSize: 'clamp(0.95rem, 2.2vw, 1.25rem)',
        className: 'p-1.5 sm:p-2',
        style: {
          background: 'linear-gradient(145deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
          boxShadow: '0 6px 16px -2px rgba(245, 158, 11, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        },
        renderLabel: (zh) => (
          <span className="flex flex-col items-center leading-tight">
            <span>{zh ? '课堂' : 'Class'}</span>
            <span>{zh ? '助手' : 'Assistant'}</span>
          </span>
        ),
      },
    ],
    [showTodosTile]
  );

  const [tiles, setTiles] = useState<HubTile[]>(() => {
    try {
      if (typeof window === 'undefined') return defaultTiles;
      let raw = window.localStorage.getItem(HUB_LAYOUT_STORAGE_KEY);
      if (!raw) raw = window.localStorage.getItem('suis-compass-hub-layout-v2');
      const saved = raw ? migrateSavedHubIds(JSON.parse(raw) as string[]) : null;
      return reorderBySavedIds(defaultTiles, saved);
    } catch {
      return defaultTiles;
    }
  });

  // Keep in sync when defaultTiles changes (unlikely), preserving user order.
  useEffect(() => {
    setTiles((prev) => {
      const savedIds = prev.map((t) => t.id);
      return reorderBySavedIds(defaultTiles, savedIds);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTiles.length]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HUB_LAYOUT_STORAGE_KEY, JSON.stringify(tiles.map((t) => t.id)));
    } catch {
      // ignore
    }
  }, [tiles]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } })
  );

  const onDragStart = (e: DragStartEvent) => {
    if (!editing) setEditing(true);
    setActiveId(e.active.id as HubTileId);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    const overId = (over?.id as HubTileId | undefined) ?? lastOverIdRef.current ?? null;
    lastOverIdRef.current = null;
    if (!overId) return;
    if (active.id === overId) return;
    setTiles((prev) => {
      const oldIndex = prev.findIndex((t) => t.id === active.id);
      const newIndex = prev.findIndex((t) => t.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const onDragCancel = () => setActiveId(null);

  const onDragOver = (e: DragOverEvent) => {
    if (e.over?.id) lastOverIdRef.current = e.over.id as HubTileId;
  };

  const handleLongPress = (tileId: HubTileId) => {
    if (!editing) setEditing(true);
    // If user long-presses a tile and then drags, DnD will take over.
    setActiveId(tileId);
  };

  const activeTile = useMemo(() => tiles.find((t) => t.id === activeId) ?? null, [tiles, activeId]);

  const lastGoodPackedRef = useRef<Map<HubTileId, PackedPos> | null>(null);
  const packedMap = useMemo(() => {
    const packed = packTilesIntoGrid(tiles, columns, rows);
    if (packed) {
      lastGoodPackedRef.current = packed;
      return packed;
    }
    return lastGoodPackedRef.current ?? new Map<HubTileId, PackedPos>();
  }, [tiles, columns, rows]);

  const gridWidth = useMemo(() => {
    // Fixed-scale: tile size computed from viewport but uniform inside a screen.
    // Keep breathing room similar to iOS.
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const topReserved = 64 + 24; // topbar + padding approx
    const sidePadding = 16; // outer
    const gap = Math.max(8, Math.min(16, vw * 0.015));
    const usableW = vw - sidePadding * 2;
    const usableH = vh - topReserved;
    const tileByW = (usableW - gap * (columns - 1)) / columns;
    const tileByH = (usableH - gap * (rows - 1)) / rows;
    const tile = Math.max(76, Math.min(140, Math.floor(Math.min(tileByW, tileByH))));
    const width = tile * columns + gap * (columns - 1);
    return { tile, gap, width };
  }, [columns, rows]);

  useEffect(() => {
    const onResize = () => {
      // trigger recompute
      setIsPortrait(window.matchMedia('(orientation: portrait)').matches);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pt-16 pb-6">
      <AppTopBar
        title="SUIS Compass 智能教学中心"
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
      <div
        className="px-2 py-4 sm:p-6 flex justify-center min-h-0"
        onPointerDownCapture={(e) => {
          if (!editing) return;
          const target = e.target as HTMLElement | null;
          if (!target) return;
          // Click/tap outside any tile exits edit mode.
          if (!target.closest('[data-hub-tile]')) {
            setEditing(false);
            setActiveId(null);
          }
        }}
      >
        <div className="w-full flex justify-center">
          <div className="w-fit max-w-full">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToParentElement]}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            >
              <SortableContext items={tiles.map((t) => t.id)} strategy={rectSortingStrategy}>
                <div
                  className="grid"
                  style={{
                    width: gridWidth.width,
                    height: gridWidth.tile * rows + gridWidth.gap * (rows - 1),
                    gridTemplateColumns: `repeat(${columns}, ${gridWidth.tile}px)`,
                    gridAutoRows: `${gridWidth.tile}px`,
                    gap: `${gridWidth.gap}px`,
                  }}
                >
                  {tiles.map((tile) => (
                    <SortableTile
                      key={tile.id}
                      tile={tile}
                      isZh={isZh}
                      editing={editing}
                      activeId={activeId}
                      packed={packedMap.get(tile.id) ?? { col: 1, row: 1, spanX: tile.spanX, spanY: tile.spanY }}
                      onLongPress={handleLongPress}
                      onOpenTodo={handleOpenTodo}
                      todosViewerRole={todosViewerRole ?? 'teacher'}
                      onClick={
                        tile.kind === 'app'
                          ? () => {
                              if (editing) return;
                              if (tile.view) onNavigate(tile.view);
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </SortableContext>

              {/* iOS-like floating tile during drag */}
              <DragOverlay>
                {activeTile ? (
                  <div
                    className={
                      activeTile.kind === 'placeholder'
                        ? 'rounded-xl bg-slate-200/70 border border-slate-200 shadow-2xl'
                        : activeTile.kind === 'widget'
                          ? 'rounded-2xl shadow-2xl p-2 text-xs text-slate-700'
                          : `${tileBase} shadow-2xl`
                    }
                    style={{
                      width: gridWidth.tile * activeTile.spanX + gridWidth.gap * (activeTile.spanX - 1),
                      height: gridWidth.tile * activeTile.spanY + gridWidth.gap * (activeTile.spanY - 1),
                      fontSize: activeTile.fontSize,
                      ...activeTile.style,
                      ...(activeTile.kind === 'widget' ? hubTodosFrostedStyle : {}),
                      transform: 'scale(1.05)',
                      touchAction: 'none',
                    }}
                    aria-hidden
                  >
                    {activeTile.kind === 'app' && activeTile.renderLabel ? activeTile.renderLabel(isZh) : null}
                    {activeTile.kind === 'widget' ? (isZh ? '待办' : 'Tasks') : null}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            {/* Editing hint */}
            {editing ? (
              <div className="mt-3 text-center text-xs text-slate-500 select-none">
                {isZh ? '编辑模式：拖拽调整位置，点击空白退出' : 'Edit mode: drag to rearrange, tap empty area to exit'}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
