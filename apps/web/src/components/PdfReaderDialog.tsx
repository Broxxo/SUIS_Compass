import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from './ui/button';
import { fetchAuthedArrayBuffer } from '../lib/schoolProjectsApi';

type PdfViewport = { width: number; height: number };

type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    transform?: number[];
  }) => PdfRenderTask;
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PageSlot = {
  pageNum: number;
  /** CSS 逻辑宽高（未乘 zoom），用于占位 */
  baseWidth: number;
  baseHeight: number;
};

/** 每个 canvas 上正在进行的渲染任务 */
const activeRenderTasks = new WeakMap<HTMLCanvasElement, PdfRenderTask>();
const canvasChains = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

function chainFor(canvas: HTMLCanvasElement): Promise<unknown> {
  return canvasChains.get(canvas) ?? Promise.resolve();
}

function setChain(canvas: HTMLCanvasElement, chain: Promise<unknown>): void {
  canvasChains.set(canvas, chain);
}

function cancelCanvasRender(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const task = activeRenderTasks.get(canvas);
  if (!task) return;
  try {
    task.cancel();
  } catch {
    /* ignore */
  }
  void task.promise.catch(() => undefined);
}

function isRenderCancelled(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'RenderingCancelledException';
}

function getOutputScale(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
}

async function loadPdfDocument(data: ArrayBuffer): Promise<PdfDoc> {
  const pdfjsLib = await import('pdfjs-dist');
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  }
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  return (await loadingTask.promise) as unknown as PdfDoc;
}

async function paintPage(
  doc: PdfDoc,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const previous = chainFor(canvas);
  const run = previous.then(async () => {
    const pending = activeRenderTasks.get(canvas);
    if (pending) {
      try {
        pending.cancel();
      } catch {
        /* ignore */
      }
      await pending.promise.catch(() => undefined);
      activeRenderTasks.delete(canvas);
    }

    const pdfPage = await doc.getPage(pageNum);
    const context = canvas.getContext('2d');
    if (!context) return;
    const viewport = pdfPage.getViewport({ scale });
    const outputScale = getOutputScale();
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const renderTask = pdfPage.render({
      canvasContext: context,
      viewport,
      ...(outputScale === 1 ? {} : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
    });
    activeRenderTasks.set(canvas, renderTask);
    try {
      await renderTask.promise;
    } finally {
      if (activeRenderTasks.get(canvas) === renderTask) activeRenderTasks.delete(canvas);
    }
  });

  setChain(canvas, run.catch(() => undefined));
  return run;
}

/**
 * PDF 瀑布式阅读：与 Word 阅读器同一套壳与连续滚动体验。
 * 可见页懒渲染，避免长文档一次画完卡死。
 */
export default function PdfReaderDialog({
  open,
  title,
  fileUrl,
  isZh,
  onClose,
}: {
  open: boolean;
  title: string;
  fileUrl: string | null;
  isZh: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasElsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderedScaleRef = useRef<Map<number, number>>(new Map());
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const docRef = useRef<PdfDoc | null>(null);
  const renderToken = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(720);

  const cleanupDoc = useCallback(async () => {
    for (const canvas of canvasElsRef.current.values()) {
      cancelCanvasRender(canvas);
    }
    const doc = docRef.current;
    docRef.current = null;
    if (doc) {
      try {
        await doc.destroy();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const paintVisible = useCallback(async () => {
    const doc = docRef.current;
    if (!doc || pageCount < 1) return;
    const token = ++renderToken.current;
    const visible = [...visiblePagesRef.current].sort((a, b) => a - b);
    // 邻页预渲染，滚动更顺
    const want = new Set<number>();
    for (const n of visible) {
      for (let d = -1; d <= 1; d += 1) {
        const p = n + d;
        if (p >= 1 && p <= pageCount) want.add(p);
      }
    }
    const slotByPage = new Map(slots.map((s) => [s.pageNum, s]));

    for (const pageNum of [...want].sort((a, b) => a - b)) {
      if (token !== renderToken.current) return;
      const canvas = canvasElsRef.current.get(pageNum);
      const slot = slotByPage.get(pageNum);
      if (!canvas || !slot) continue;
      const scale = ((fitWidth * zoom) / Math.max(1, slot.baseWidth));
      const prevScale = renderedScaleRef.current.get(pageNum);
      if (prevScale != null && Math.abs(prevScale - scale) < 0.001) continue;
      try {
        await paintPage(doc, pageNum, canvas, scale);
        if (token !== renderToken.current) return;
        renderedScaleRef.current.set(pageNum, scale);
      } catch (e: unknown) {
        if (isRenderCancelled(e)) continue;
        if (token === renderToken.current) {
          setError((e as Error).message || (isZh ? '渲染失败' : 'Render failed'));
          return;
        }
      }
    }

    // 远离视口的页释放位图，省内存
    for (const [pageNum, canvas] of canvasElsRef.current) {
      if (want.has(pageNum)) continue;
      if (!renderedScaleRef.current.has(pageNum)) continue;
      cancelCanvasRender(canvas);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      renderedScaleRef.current.delete(pageNum);
    }
  }, [fitWidth, zoom, pageCount, slots, isZh]);

  useEffect(() => {
    if (!open || !fileUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSlots([]);
    setPageCount(0);
    setCurrentPage(1);
    setZoom(1);
    renderedScaleRef.current.clear();
    visiblePagesRef.current.clear();
    pageElsRef.current.clear();
    canvasElsRef.current.clear();

    void (async () => {
      try {
        await cleanupDoc();
        const buffer = await fetchAuthedArrayBuffer(fileUrl);
        if (cancelled) return;
        const doc = await loadPdfDocument(buffer);
        if (cancelled) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        const nextSlots: PageSlot[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1 });
          nextSlots.push({
            pageNum: n,
            baseWidth: viewport.width,
            baseHeight: viewport.height,
          });
        }
        setSlots(nextSlots);
        setPageCount(doc.numPages);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message || (isZh ? '无法打开 PDF' : 'Could not open PDF'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderToken.current += 1;
      observerRef.current?.disconnect();
      observerRef.current = null;
      void cleanupDoc();
    };
  }, [open, fileUrl, isZh, cleanupDoc]);

  // 内容区宽度 → 适配单栏纸宽（与 Word max-w-4xl 对齐）
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = scrollRef.current;
      if (!el) return;
      const pad = window.innerWidth >= 640 ? 48 : 24;
      const maxPaper = 896; // max-w-4xl
      setFitWidth(Math.max(280, Math.min(maxPaper, el.clientWidth - pad)));
    };
    update();
    const observer = new ResizeObserver(update);
    if (scrollRef.current) observer.observe(scrollRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [open, loading, pageCount]);

  // IntersectionObserver：哪些页在视口
  useEffect(() => {
    if (!open || loading || pageCount < 1) return;
    observerRef.current?.disconnect();
    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const pageNum = Number((entry.target as HTMLElement).dataset.pageNum || 0);
          if (!pageNum) continue;
          if (entry.isIntersecting) {
            if (!visiblePagesRef.current.has(pageNum)) {
              visiblePagesRef.current.add(pageNum);
              changed = true;
            }
          } else if (visiblePagesRef.current.delete(pageNum)) {
            changed = true;
          }
        }
        if (visiblePagesRef.current.size > 0) {
          const top = Math.min(...visiblePagesRef.current);
          setCurrentPage(top);
        }
        if (changed) void paintVisible();
      },
      { root, rootMargin: '200px 0px', threshold: 0.01 },
    );
    observerRef.current = observer;
    for (const el of pageElsRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [open, loading, pageCount, slots, paintVisible]);

  // zoom / fitWidth 变化时重绘可见页
  useEffect(() => {
    if (!open || loading || pageCount < 1) return;
    renderedScaleRef.current.clear();
    void paintVisible();
  }, [open, loading, pageCount, zoom, fitWidth, paintVisible]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))));
      }
      if (event.key === '-') {
        event.preventDefault();
        setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pageLabel =
    pageCount === 0
      ? '—'
      : isZh
        ? `${currentPage} / ${pageCount}`
        : `${currentPage} / ${pageCount}`;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1a1410] text-amber-50">
      <header className="flex shrink-0 items-center gap-2 border-b border-amber-100/10 bg-black/30 px-3 py-2 backdrop-blur-sm sm:px-4">
        <div className="min-w-0 flex-1 truncate text-sm font-medium tracking-wide">
          {title || (isZh ? '阅读' : 'Reader')}
        </div>
        <span className="hidden text-[11px] text-amber-100/50 sm:inline">
          {isZh ? 'PDF 连续预览' : 'PDF continuous preview'}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-100/20 bg-transparent text-amber-50 hover:bg-amber-100/10"
            disabled={zoom <= 0.7}
            onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}
            aria-label={isZh ? '缩小' : 'Zoom out'}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-amber-100/70">{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-100/20 bg-transparent text-amber-50 hover:bg-amber-100/10"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))))}
            aria-label={isZh ? '放大' : 'Zoom in'}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
        <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-amber-100/70">{pageLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-100/20 bg-transparent text-amber-50 hover:bg-amber-100/10"
          onClick={onClose}
        >
          <X className="mr-1 h-4 w-4" />
          {isZh ? '关闭' : 'Close'}
        </Button>
      </header>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-amber-100/60">
            {isZh ? '正在打开…' : 'Opening…'}
          </p>
        ) : null}
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-300">{error}</p>
        ) : null}

        {!loading && !error && slots.length > 0 ? (
          <div className="mx-auto min-h-full max-w-4xl px-3 py-6 sm:px-6">
            <div className="overflow-hidden rounded-sm bg-[#f7f1e6] text-slate-900 shadow-[0_25px_80px_rgba(0,0,0,0.55)]">
              <div className="space-y-5 px-0 py-6 sm:px-0">
                {slots.map((slot) => {
                  const cssW = fitWidth * zoom;
                  const cssH = (slot.baseHeight / slot.baseWidth) * cssW;
                  return (
                    <div
                      key={slot.pageNum}
                      data-page-num={slot.pageNum}
                      ref={(el) => {
                        if (el) pageElsRef.current.set(slot.pageNum, el);
                        else pageElsRef.current.delete(slot.pageNum);
                      }}
                      className="mx-auto"
                      style={{ width: cssW, maxWidth: '100%' }}
                    >
                      <div
                        className="relative mx-auto overflow-hidden bg-white shadow-[0_8px_28px_rgba(40,25,10,0.12)]"
                        style={{ width: cssW, height: cssH }}
                      >
                        <canvas
                          ref={(el) => {
                            if (el) canvasElsRef.current.set(slot.pageNum, el);
                            else canvasElsRef.current.delete(slot.pageNum);
                          }}
                          className="block bg-white"
                        />
                        <span className="pointer-events-none absolute bottom-2 right-3 rounded bg-black/35 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90">
                          {slot.pageNum}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-amber-100/10 bg-black/25 px-4 py-2 text-[11px] text-amber-100/55">
        <span>PDF</span>
        <span className="hidden sm:inline">{isZh ? '滚轮连续浏览 · Esc 关闭' : 'Scroll continuously · Esc close'}</span>
      </footer>
    </div>
  );
}
