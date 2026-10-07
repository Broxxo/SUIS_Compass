/**
 * 协和灯塔：桌面是平铺的三折页，中间宽、两侧窄。点一项阅读全文。
 * 窄屏一次只看一面，用底部切换。
 * 教师阅览；只有系统管理员可以改上墙内容。AI 使用顶栏原有入口。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAIContext } from '../contexts/AIContext';
import { api } from '../lib/api';
import type { LighthouseBoard, LighthouseEntry, LighthouseFrame } from '../types/lighthouse';
import AppTopBar from './AppTopBar';

type Focus = 'overview' | 'front' | 'left' | 'right';
type WallId = 'front' | 'left' | 'right';

const EASE = '780ms cubic-bezier(0.22, 1, 0.36, 1)';

function pick(isZh: boolean, zh: string, en: string): string {
  const primary = (isZh ? zh : en).trim();
  return primary || (isZh ? en : zh).trim();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

function useMotion(): boolean {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOk(!mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return ok;
}

/** 桌面三折页：两侧窄、中间宽，三面同一高度、没有透视。底部留出展墙和地板。 */
const FOLD_TOP = 5;
const FOLD_HEIGHT = 82;
const FOLD_PAD = 2.4;
const SIDE_WIDTH = 22;
const FOLD_GAP = 0.8;
const FRONT_WIDTH = 100 - FOLD_PAD * 2 - SIDE_WIDTH * 2 - FOLD_GAP * 2;
const FRONT_LEFT = FOLD_PAD + SIDE_WIDTH + FOLD_GAP;

function wallBox(which: WallId, focus: Focus, narrow: boolean): CSSProperties {
  const fade = 'opacity 520ms ease, left 780ms cubic-bezier(0.22, 1, 0.36, 1), top 780ms cubic-bezier(0.22, 1, 0.36, 1), width 780ms cubic-bezier(0.22, 1, 0.36, 1), height 780ms cubic-bezier(0.22, 1, 0.36, 1)';
  if (narrow) {
    return {
      position: 'absolute',
      left: '3%',
      top: '2%',
      width: '94%',
      height: '96%',
      opacity: focus === which || (focus === 'overview' && which === 'front') ? 1 : 0,
      pointerEvents: focus === which || (focus === 'overview' && which === 'front') ? 'auto' : 'none',
      transition: fade,
    };
  }
  const left = which === 'left' ? FOLD_PAD : which === 'front' ? FRONT_LEFT : FRONT_LEFT + FRONT_WIDTH + FOLD_GAP;
  const width = which === 'front' ? FRONT_WIDTH : SIDE_WIDTH;
  return {
    position: 'absolute',
    left: `${left}%`,
    top: `${FOLD_TOP}%`,
    width: `${width}%`,
    height: `${FOLD_HEIGHT}%`,
    opacity: 1,
    pointerEvents: 'auto',
    transition: fade,
    zIndex: which === 'front' ? 2 : 1,
  };
}

export default function XieheLighthouse({
  onBackToHub,
  isAIOpen,
  onToggleAI,
}: {
  onBackToHub: () => void;
  isAIOpen?: boolean;
  onToggleAI?: () => void;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { setContextFromApp } = useAIContext();
  const isZh = language === 'zh';
  const canEdit = user?.role === 'system-admin';
  const narrow = useNarrow();
  const motion = useMotion();
  const frontRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<LighthouseBoard | null>(null);
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [focus, setFocus] = useState<Focus>('overview');
  const [readingId, setReadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const dirty = !!board && JSON.stringify(board) !== saved;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await api.getLighthouse();
      setBoard(next);
      setSaved(JSON.stringify(next));
    } catch {
      setError(isZh ? '灯塔暂时没有点亮，请稍后再试。' : 'The lighthouse could not be opened. Try again.');
    } finally {
      setLoading(false);
    }
  }, [isZh]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!motion) {
      setArrived(true);
      return;
    }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setArrived(true)));
    return () => cancelAnimationFrame(id);
  }, [motion]);

  const summary = useMemo(() => {
    if (!board) return '';
    const line = (title: string, body: string) => `- ${title}${body ? `：${body.slice(0, 360)}` : isZh ? '：（尚未写入）' : ': (not written yet)'}`;
    const front = board.front.map((item) => line(pick(isZh, item.titleZh, item.titleEn) || (isZh ? '未命名' : 'Untitled'), pick(isZh, item.bodyZh, item.bodyEn)));
    const left = board.left.map((item) => line(pick(isZh, item.titleZh, item.titleEn), pick(isZh, item.bodyZh, item.bodyEn)));
    const right = board.right.map((item) => line(pick(isZh, item.titleZh, item.titleEn), pick(isZh, item.bodyZh, item.bodyEn)));
    const facing = focus === 'left' ? (isZh ? '规划墙' : 'plans wall') : focus === 'right' ? (isZh ? '制度墙' : 'regulations wall') : focus === 'front' ? (isZh ? '正墙' : 'front wall') : (isZh ? '房间中央' : 'the middle of the room');
    return [
      isZh ? `读者正站在${facing}。` : `The reader is facing ${facing}.`,
      isZh ? '正墙（愿景、理念、学习者素养）：' : 'Front wall:',
      front.join('\n') || (isZh ? '（空）' : '(empty)'),
      isZh ? '左墙（规划与部门工作计划）：' : 'Left wall (plans):',
      left.join('\n') || (isZh ? '（空）' : '(empty)'),
      isZh ? '右墙（管理制度册）：' : 'Right wall (regulations):',
      right.join('\n') || (isZh ? '（空）' : '(empty)'),
    ].join('\n').slice(0, 4500);
  }, [board, focus, isZh]);

  useEffect(() => {
    if (!onToggleAI) return;
    setContextFromApp('lighthouse', { view: 'lighthouse', summary });
  }, [onToggleAI, setContextFromApp, summary]);

  const leave = useCallback(() => {
    if (dirty && editing) {
      const ok = window.confirm(isZh ? '墙上还有未保存的修改，离开后会丢掉。仍要离开吗？' : 'Unsaved wall changes will be lost. Leave anyway?');
      if (!ok) return;
    }
    if (!motion) {
      onBackToHub();
      return;
    }
    setLeaving(true);
    window.setTimeout(onBackToHub, 460);
  }, [dirty, editing, isZh, motion, onBackToHub]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (readingId) {
        setReadingId(null);
        return;
      }
      if (focus !== 'overview') {
        setFocus('overview');
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, readingId]);

  const patchFrame = (id: string, patch: Partial<LighthouseFrame>) => {
    setBoard((prev) => prev && ({ ...prev, front: prev.front.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  };

  const patchEntry = (wall: 'left' | 'right', id: string, patch: Partial<LighthouseEntry>) => {
    setBoard((prev) => prev && ({ ...prev, [wall]: prev[wall].map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  };

  const beginDrag = (event: ReactPointerEvent, frame: LighthouseFrame, mode: 'move' | 'resize') => {
    if (!editing) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = frontRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...frame };
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      if (mode === 'move') {
        const w = origin.w;
        const h = origin.h;
        patchFrame(frame.id, { x: clamp(origin.x + dx, 0, 100 - w), y: clamp(origin.y + dy, 0, 100 - h) });
      } else {
        const w = clamp(origin.w + dx, 16, 78);
        const h = clamp(origin.h + dy, 14, 72);
        patchFrame(frame.id, { w, h, x: Math.min(origin.x, 100 - w), y: Math.min(origin.y, 100 - h) });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addFrame = () => {
    const frame: LighthouseFrame = {
      id: newId('lf'),
      titleZh: '新区块',
      titleEn: 'New panel',
      bodyZh: '',
      bodyEn: '',
      x: 34,
      y: 36,
      w: 32,
      h: 28,
    };
    setBoard((prev) => prev && ({ ...prev, front: [...prev.front, frame].slice(0, 8) }));
    setSelectedId(frame.id);
  };

  const addEntry = (wall: 'left' | 'right') => {
    const entry: LighthouseEntry = {
      id: newId(wall === 'left' ? 'll' : 'lr'),
      titleZh: wall === 'left' ? '新的计划' : '新的章节',
      titleEn: wall === 'left' ? 'New plan' : 'New chapter',
      bodyZh: '',
      bodyEn: '',
    };
    setBoard((prev) => prev && ({ ...prev, [wall]: [...prev[wall], entry].slice(0, 24) }));
    setSelectedId(entry.id);
  };

  const removeSelected = () => {
    if (!board || !selectedId) return;
    if (confirmDeleteId !== selectedId) {
      setConfirmDeleteId(selectedId);
      return;
    }
    setBoard({
      front: board.front.filter((item) => item.id !== selectedId),
      left: board.left.filter((item) => item.id !== selectedId),
      right: board.right.filter((item) => item.id !== selectedId),
    });
    setSelectedId(null);
    setConfirmDeleteId(null);
    setReadingId(null);
  };

  const moveEntry = (wall: 'left' | 'right', id: string, dir: -1 | 1) => {
    setBoard((prev) => {
      if (!prev) return prev;
      const list = [...prev[wall]];
      const index = list.findIndex((item) => item.id === id);
      const next = index + dir;
      if (index < 0 || next < 0 || next >= list.length) return prev;
      const [item] = list.splice(index, 1);
      list.splice(next, 0, item);
      return { ...prev, [wall]: list };
    });
  };

  const save = async (): Promise<boolean> => {
    if (!board || !canEdit) return false;
    const unnamed = [...board.left, ...board.right].some((item) => !item.titleZh.trim() && !item.titleEn.trim());
    if (unnamed) {
      setSaveError(isZh ? '左墙和右墙的每一项都需要标题。' : 'Each item on the side walls needs a title.');
      return false;
    }
    setSaving(true);
    setSaveError('');
    try {
      const next = await api.saveLighthouse(board);
      setBoard(next);
      setSaved(JSON.stringify(next));
      return true;
    } catch (err) {
      const message = err instanceof Error && err.message === 'forbidden'
        ? (isZh ? '只有系统管理员可以改墙上的内容。' : 'Only a system admin can change the walls.')
        : (isZh ? '没有保存成功，请再试一次。' : 'Could not save. Try again.');
      setSaveError(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openItem = (id: string) => {
    if (editing) {
      setSelectedId(id);
      setConfirmDeleteId(null);
      return;
    }
    setReadingId(id);
  };

  const selectedFrame = board?.front.find((item) => item.id === selectedId) ?? null;
  const selectedEntry = board?.left.find((item) => item.id === selectedId) ?? board?.right.find((item) => item.id === selectedId) ?? null;
  const selectedWall: 'left' | 'right' | null = board?.left.some((item) => item.id === selectedId) ? 'left' : board?.right.some((item) => item.id === selectedId) ? 'right' : null;

  const reading = board
    ? board.front.find((item) => item.id === readingId) ?? board.left.find((item) => item.id === readingId) ?? board.right.find((item) => item.id === readingId) ?? null
    : null;

  return (
    <div className="h-dvh min-h-0 bg-[#e6ddd0]">
      <AppTopBar
        title={isZh ? '协和灯塔' : 'Xiehe Lighthouse'}
        showBack
        onBack={leave}
        isAIOpen={isAIOpen}
        onToggleAI={onToggleAI}
        rightChildren={canEdit ? (
          <div className="flex items-center gap-1.5">
            {editing && dirty ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="h-[var(--app-topbar-control)] rounded-lg bg-amber-700 px-3 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
              >
                {saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (editing && dirty) {
                  void save().then((ok) => {
                    if (ok) setEditing(false);
                  });
                  return;
                }
                const enter = !editing;
                setEditing(enter);
                setReadingId(null);
                setConfirmDeleteId(null);
              }}
              className="h-[var(--app-topbar-control)] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
            >
              {editing ? (isZh ? '完成' : 'Done') : (isZh ? (narrow ? '整理' : '整理墙面') : 'Arrange')}
            </button>
          </div>
        ) : null}
      />
      <div className="h-full pt-[var(--app-topbar-height)]">
        <div
          className="relative h-full overflow-hidden"
          style={{
            background: 'radial-gradient(ellipse 78% 46% at 50% -6%, rgba(255,252,246,0.96), rgba(255,252,246,0) 68%), linear-gradient(180deg, #f4efe6 0%, #e7dfd2 58%, #ddd2c3 100%)',
            opacity: arrived && !leaving ? 1 : 0,
            transform: arrived && !leaving ? 'none' : 'scale(0.94) translateY(28px)',
            transition: motion ? `opacity 700ms ease, transform ${EASE}` : undefined,
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[6.5%]"
            style={{
              background: 'linear-gradient(180deg, #c9aa7c 0%, #a98456 22%, #8d6a42 100%)',
              boxShadow: 'inset 0 10px 14px rgba(92, 58, 24, 0.16)',
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-[6.5%] h-3" style={{ background: 'linear-gradient(to top, rgba(92,58,28,0.16), rgba(92,58,28,0))' }} />
          {loading ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-600">{isZh ? '正在点灯…' : 'Lighting the room…'}</p>
          ) : error || !board ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-stone-700">
              <p>{error}</p>
              <button type="button" onClick={() => void load()} className="rounded-lg bg-white/70 px-3 py-1.5 text-sm text-stone-700">{isZh ? '重试' : 'Retry'}</button>
            </div>
          ) : (
            <>
              <WallShell
                which="left"
                focus={focus}
                narrow={narrow}
              >
                <EntryWall
                  entries={board.left}
                  isZh={isZh}
                  editing={editing}
                  selectedId={selectedId}
                  empty={isZh ? '规划还没有挂上' : 'No plans on this wall yet'}
                  onOpen={openItem}
                  onMove={(id, dir) => moveEntry('left', id, dir)}
                  onAdd={canEdit && editing ? () => addEntry('left') : undefined}
                />
              </WallShell>
              <WallShell
                which="right"
                focus={focus}
                narrow={narrow}
              >
                <EntryWall
                  entries={board.right}
                  isZh={isZh}
                  editing={editing}
                  selectedId={selectedId}
                  empty={isZh ? '制度册还没有挂上' : 'No regulations on this wall yet'}
                  onOpen={openItem}
                  onMove={(id, dir) => moveEntry('right', id, dir)}
                  onAdd={canEdit && editing ? () => addEntry('right') : undefined}
                />
              </WallShell>
              <WallShell
                which="front"
                focus={focus}
                narrow={narrow}
              >
                <div ref={frontRef} className="relative h-full w-full">
                  {board.front.map((frame) => (
                    <button
                      key={frame.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openItem(frame.id);
                      }}
                      onPointerDown={(event) => {
                        if (!editing) return;
                        beginDrag(event, frame, 'move');
                      }}
                      className={`absolute z-10 overflow-hidden rounded-sm border bg-[#fffaf3] text-left shadow-[0_10px_18px_rgba(72,46,20,0.12)] ${selectedId === frame.id && editing ? 'border-amber-600 ring-2 ring-amber-500/50' : 'border-[#c4a57a] hover:-translate-y-0.5'}`}
                      style={{ left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.w}%`, height: `${frame.h}%` }}
                    >
                      <span className="block truncate px-3 pt-2 text-sm font-semibold text-stone-800">{pick(isZh, frame.titleZh, frame.titleEn) || (isZh ? '未命名' : 'Untitled')}</span>
                      <span className="line-clamp-3 px-3 pt-1 text-xs leading-snug text-stone-600">
                        {pick(isZh, frame.bodyZh, frame.bodyEn) || (isZh ? '尚未写入' : 'Not written yet')}
                      </span>
                      {editing ? (
                        <span
                          className="absolute bottom-1 right-1 h-4 w-4 cursor-se-resize rounded-sm border border-amber-800/30 bg-amber-100"
                          onPointerDown={(event) => beginDrag(event, frame, 'resize')}
                        />
                      ) : null}
                    </button>
                  ))}
                  {editing ? (
                    <button type="button" onClick={addFrame} className="absolute bottom-3 left-3 z-30 rounded-lg bg-stone-800/80 px-2.5 py-1 text-xs text-amber-50">
                      {isZh ? '加一块' : 'Add panel'}
                    </button>
                  ) : null}
                </div>
              </WallShell>

              {focus === 'overview' || focus === 'front' ? (
                <img
                  src="/suislogo.png"
                  alt={isZh ? '协和' : 'Xiehe'}
                  className="pointer-events-none absolute left-1/2 z-30 h-12 w-auto -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_8px_12px_rgba(72,46,20,0.28)] sm:h-[3.75rem]"
                  style={{
                    top: narrow ? '2%' : `${FOLD_TOP}%`,
                    transition: motion ? `top ${EASE}` : undefined,
                  }}
                />
              ) : null}

              {reading && !editing ? (
                <div className="absolute inset-[8%] z-40 flex flex-col overflow-hidden rounded-3xl bg-[#fffaf3] shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-amber-900/10 px-5 py-4">
                    <h2 className="text-xl font-semibold text-stone-900">{pick(isZh, reading.titleZh, reading.titleEn) || (isZh ? '未命名' : 'Untitled')}</h2>
                    <button type="button" onClick={() => setReadingId(null)} className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100">
                      {isZh ? '回到墙前' : 'Back to the wall'}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[15px] leading-relaxed text-stone-700 whitespace-pre-wrap">
                    {pick(isZh, reading.bodyZh, reading.bodyEn) || (isZh ? '这一块还没有写入内容。' : 'Nothing has been written here yet.')}
                  </div>
                </div>
              ) : null}

              {!narrow && !editing && !reading ? (
                <p className="pointer-events-none absolute bottom-[8%] left-1/2 z-30 -translate-x-1/2 text-xs text-stone-600">
                  {isZh ? '点一项阅读全文' : 'Open an item to read it'}
                </p>
              ) : null}
              {narrow && !(editing && (selectedFrame || selectedEntry)) ? (
                <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full bg-[#f7f1e6]/95 p-1 shadow-sm">
                  {(['front', 'left', 'right'] as const).map((wall) => (
                    <button
                      key={wall}
                      type="button"
                      onClick={() => { setFocus(wall); setReadingId(null); }}
                      className={`rounded-full px-3 py-1 text-xs ${(focus === wall || (focus === 'overview' && wall === 'front')) ? 'bg-stone-800 text-[#f7f1e6]' : 'text-stone-700'}`}
                    >
                      {wall === 'front' ? (isZh ? '方向' : 'Direction') : wall === 'left' ? (isZh ? '规划' : 'Plans') : (isZh ? '制度' : 'Rules')}
                    </button>
                  ))}
                </div>
              ) : null}

              {editing && (selectedFrame || selectedEntry) ? (
                <Editor
                  isZh={isZh}
                  titleZh={(selectedFrame ?? selectedEntry)!.titleZh}
                  titleEn={(selectedFrame ?? selectedEntry)!.titleEn}
                  bodyZh={(selectedFrame ?? selectedEntry)!.bodyZh}
                  bodyEn={(selectedFrame ?? selectedEntry)!.bodyEn}
                  confirmDelete={confirmDeleteId === selectedId}
                  saveError={saveError}
                  onChange={(patch) => {
                    if (selectedFrame) patchFrame(selectedFrame.id, patch);
                    else if (selectedEntry && selectedWall) patchEntry(selectedWall, selectedEntry.id, patch);
                  }}
                  onDelete={removeSelected}
                  onClose={() => { setSelectedId(null); setConfirmDeleteId(null); }}
                />
              ) : null}
              {saveError && !selectedId ? (
                <p className="absolute bottom-14 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-700">{saveError}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Poly Haven「Walnut Veneer」，CC0。四条边用同一张木纹，线脚从外到内完全一样。 */
const FRAME_WOOD = '/frame-walnut.jpg';
const RAIL = 22;

type RailSide = 'top' | 'right' | 'bottom' | 'left';

function WoodRail({ side }: { side: RailSide }) {
  const horizontal = side === 'top' || side === 'bottom';
  const clip = {
    top: `polygon(0 0, 100% 0, calc(100% - ${RAIL}px) 100%, ${RAIL}px 100%)`,
    bottom: `polygon(${RAIL}px 0, calc(100% - ${RAIL}px) 0, 100% 100%, 0 100%)`,
    left: `polygon(0 0, 100% ${RAIL}px, 100% calc(100% - ${RAIL}px), 0 100%)`,
    right: `polygon(0 ${RAIL}px, 100% 0, 100% 100%, 0 calc(100% - ${RAIL}px))`,
  }[side];
  const bevel = {
    top: 'to bottom',
    bottom: 'to top',
    left: 'to right',
    right: 'to left',
  }[side];
  const slice = { top: '12% center', right: '78% center', bottom: '46% center', left: '30% center' }[side];
  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{
        top: side === 'bottom' ? undefined : 0,
        bottom: side === 'top' ? undefined : 0,
        left: side === 'right' ? undefined : 0,
        right: side === 'left' ? undefined : 0,
        width: horizontal ? undefined : RAIL,
        height: horizontal ? RAIL : undefined,
        clipPath: clip,
        containerType: 'size',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: horizontal ? '100cqh' : '100%',
          height: horizontal ? '100cqw' : '100%',
          transform: horizontal ? 'translate(-50%, -50%) rotate(90deg)' : 'translate(-50%, -50%)',
          backgroundImage: `url(${FRAME_WOOD})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '96px 100%',
          backgroundPosition: slice,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${bevel}, rgba(255,244,224,0.5) 0 2px, rgba(255,244,224,0) 6px, rgba(0,0,0,0) 34%, rgba(36,16,6,0.32) 64%, rgba(255,232,196,0.38) 80%, rgba(24,10,4,0.58) 100%)`,
        }}
      />
    </div>
  );
}

function MountedFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full w-full" style={{ boxShadow: '0 16px 28px rgba(72,46,20,0.2), 0 2px 6px rgba(72,46,20,0.12)' }}>
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <WoodRail key={side} side={side} />
      ))}
      <div className="absolute overflow-hidden bg-[#1a100c] p-[4px]" style={{ inset: RAIL }}>
        <div className="flex h-full min-h-0 bg-[#f4eee4] p-2 sm:p-3" style={{ boxShadow: 'inset 0 0 0 1px rgba(120,78,36,0.22)' }}>
          <div
            className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fbf8f2]"
            style={{ boxShadow: 'inset 0 1px 4px rgba(72,44,16,0.14)', containerType: 'size' }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function WallShell({
  which,
  focus,
  narrow,
  children,
}: {
  which: WallId;
  focus: Focus;
  narrow: boolean;
  children: ReactNode;
}) {
  const facing: Focus = narrow && focus === 'overview' ? 'front' : focus;
  const shown = !narrow || facing === which;
  return (
    <div
      style={wallBox(which, facing, narrow)}
      aria-hidden={shown ? undefined : true}
      inert={shown ? undefined : true}
    >
      <MountedFrame>{children}</MountedFrame>
    </div>
  );
}

function EntryWall({
  entries,
  isZh,
  editing,
  selectedId,
  empty,
  onOpen,
  onMove,
  onAdd,
}: {
  entries: LighthouseEntry[];
  isZh: boolean;
  editing: boolean;
  selectedId: string | null;
  empty: string;
  onOpen: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3 sm:p-4">
      {entries.length === 0 ? <p className="m-auto text-sm text-stone-500">{empty}</p> : null}
      {entries.map((entry, index) => (
        <div key={entry.id} className={`rounded-lg border bg-white/85 ${selectedId === entry.id && editing ? 'border-amber-600 ring-2 ring-amber-500/40' : 'border-amber-900/10'}`}>
          <button type="button" onClick={() => onOpen(entry.id)} className="block w-full px-3 py-2.5 text-left">
            <span className="block text-sm font-semibold text-stone-800">{pick(isZh, entry.titleZh, entry.titleEn) || (isZh ? '未命名' : 'Untitled')}</span>
            <span className="mt-1 block line-clamp-3 text-xs leading-snug text-stone-600">
              {pick(isZh, entry.bodyZh, entry.bodyEn) || (isZh ? '尚未写入' : 'Not written yet')}
            </span>
          </button>
          {editing ? (
            <div className="flex gap-2 px-3 pb-2 text-xs text-stone-500">
              <button type="button" disabled={index === 0} onClick={() => onMove(entry.id, -1)} className="disabled:opacity-30">{isZh ? '上移' : 'Up'}</button>
              <button type="button" disabled={index === entries.length - 1} onClick={() => onMove(entry.id, 1)} className="disabled:opacity-30">{isZh ? '下移' : 'Down'}</button>
            </div>
          ) : null}
        </div>
      ))}
      {onAdd ? (
        <button type="button" onClick={onAdd} className="mt-auto rounded-lg bg-stone-800/80 px-3 py-2 text-xs text-amber-50">
          {isZh ? '再挂一项' : 'Add item'}
        </button>
      ) : null}
    </div>
  );
}

function Editor({
  isZh,
  titleZh,
  titleEn,
  bodyZh,
  bodyEn,
  confirmDelete,
  saveError,
  onChange,
  onDelete,
  onClose,
}: {
  isZh: boolean;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  confirmDelete: boolean;
  saveError: string;
  onChange: (patch: { titleZh?: string; titleEn?: string; bodyZh?: string; bodyEn?: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const field = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800';
  return (
    <div className="absolute inset-x-3 bottom-3 z-50 max-h-[46%] overflow-auto rounded-2xl border border-amber-900/15 bg-[#fffaf3] p-3 shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[22rem]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">{isZh ? '编辑这块内容' : 'Edit this piece'}</span>
        <button type="button" onClick={onClose} className="text-sm text-stone-500">{isZh ? '收起' : 'Close'}</button>
      </div>
      <div className="grid gap-2">
        <input className={field} value={titleZh} placeholder={isZh ? '中文标题' : 'Chinese title'} onChange={(e) => onChange({ titleZh: e.target.value })} />
        <input className={field} value={titleEn} placeholder={isZh ? '英文标题' : 'English title'} onChange={(e) => onChange({ titleEn: e.target.value })} />
        <textarea className={`${field} min-h-[5.5rem]`} value={bodyZh} placeholder={isZh ? '中文正文' : 'Chinese text'} onChange={(e) => onChange({ bodyZh: e.target.value })} />
        <textarea className={`${field} min-h-[4.5rem]`} value={bodyEn} placeholder={isZh ? '英文正文' : 'English text'} onChange={(e) => onChange({ bodyEn: e.target.value })} />
      </div>
      {saveError ? <p className="mt-2 text-xs text-red-700">{saveError}</p> : null}
      <button type="button" onClick={onDelete} className="mt-2 text-xs text-red-700">
        {confirmDelete ? (isZh ? '再点一次，从墙上取下' : 'Click again to remove') : (isZh ? '从墙上取下' : 'Remove')}
      </button>
    </div>
  );
}
