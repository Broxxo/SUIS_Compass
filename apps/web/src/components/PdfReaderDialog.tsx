import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from './ui/button';
import { fetchAuthedArrayBuffer } from '../lib/schoolProjectsApi';

type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

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
  const pdfPage = await doc.getPage(pageNum);
  const viewport = pdfPage.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await pdfPage.render({ canvasContext: context, viewport }).promise;
}

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
  const stageRef = useRef<HTMLDivElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const renderToken = useRef(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 当前摊开左页页码（1、3、5…） */
  const [leftPage, setLeftPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [twoPage, setTwoPage] = useState(true);
  const [flipKey, setFlipKey] = useState(0);

  const cleanupDoc = useCallback(async () => {
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

  const rightPage = twoPage && leftPage + 1 <= pageCount ? leftPage + 1 : null;
  const canPrev = leftPage > 1;
  const canNext = twoPage ? leftPage + 2 <= pageCount : leftPage < pageCount;

  const goPrev = useCallback(() => {
    setLeftPage((p) => {
      const step = twoPage ? 2 : 1;
      const next = Math.max(1, p - step);
      if (twoPage && next % 2 === 0) return Math.max(1, next - 1);
      return next;
    });
    setFlipKey((k) => k + 1);
  }, [twoPage]);

  const goNext = useCallback(() => {
    setLeftPage((p) => {
      const step = twoPage ? 2 : 1;
      let next = p + step;
      if (twoPage) {
        if (next % 2 === 0) next -= 1;
        if (next > pageCount) return p;
        return next;
      }
      return Math.min(pageCount, next);
    });
    setFlipKey((k) => k + 1);
  }, [twoPage, pageCount]);

  useEffect(() => {
    if (!open || !fileUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLeftPage(1);
    setPageCount(0);
    setZoom(1);
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
        setPageCount(doc.numPages);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message || (isZh ? '无法打开 PDF' : 'Could not open PDF'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void cleanupDoc();
    };
  }, [open, fileUrl, isZh, cleanupDoc]);

  useEffect(() => {
    if (twoPage && leftPage > 1 && leftPage % 2 === 0) {
      setLeftPage((p) => p - 1);
    }
  }, [twoPage, leftPage]);

  useEffect(() => {
    if (!open) return;
    const updateLayout = () => {
      const wide = window.innerWidth >= 768;
      setTwoPage(wide);
      const stage = stageRef.current;
      if (!stage || !docRef.current) return;
      void (async () => {
        try {
          const doc = docRef.current;
          if (!doc) return;
          const sample = await doc.getPage(Math.min(leftPage, doc.numPages));
          const base = sample.getViewport({ scale: 1 });
          const padX = 48;
          const padY = 32;
          const availW = Math.max(240, stage.clientWidth - padX);
          const availH = Math.max(240, stage.clientHeight - padY);
          const pagesWide = wide ? 2 : 1;
          const fit = Math.min(availW / (base.width * pagesWide), availH / base.height);
          setFitScale(Math.max(0.35, Math.min(fit, 2.2)));
        } catch {
          /* ignore */
        }
      })();
    };
    updateLayout();
    const observer = new ResizeObserver(() => updateLayout());
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener('resize', updateLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateLayout);
    };
  }, [open, leftPage, pageCount]);

  useEffect(() => {
    if (!open || !docRef.current || pageCount < 1) return;
    const token = ++renderToken.current;
    const doc = docRef.current;
    const scale = fitScale * zoom;
    void (async () => {
      try {
        const leftCanvas = leftCanvasRef.current;
        if (leftCanvas) await paintPage(doc, leftPage, leftCanvas, scale);
        if (token !== renderToken.current) return;
        const rightCanvas = rightCanvasRef.current;
        if (twoPage && rightCanvas) {
          if (rightPage) {
            await paintPage(doc, rightPage, rightCanvas, scale);
          } else {
            const w = leftCanvasRef.current?.width || 400;
            const h = leftCanvasRef.current?.height || 560;
            const ctx = rightCanvas.getContext('2d');
            if (ctx) {
              rightCanvas.width = w;
              rightCanvas.height = h;
              rightCanvas.style.width = leftCanvasRef.current?.style.width || `${w}px`;
              rightCanvas.style.height = leftCanvasRef.current?.style.height || `${h}px`;
              ctx.fillStyle = '#f7f1e6';
              ctx.fillRect(0, 0, w, h);
            }
          }
        }
      } catch (e: unknown) {
        if (token === renderToken.current) {
          setError((e as Error).message || (isZh ? '渲染失败' : 'Render failed'));
        }
      }
    })();
  }, [open, leftPage, rightPage, pageCount, fitScale, zoom, twoPage, isZh, flipKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goPrev();
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        goNext();
      }
      if (event.key === '+' || event.key === '=') setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))));
      if (event.key === '-') setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goPrev, goNext]);

  if (!open) return null;

  const pageLabel =
    pageCount === 0
      ? '—'
      : twoPage && rightPage
        ? isZh
          ? `${leftPage}–${rightPage} / ${pageCount}`
          : `${leftPage}–${rightPage} / ${pageCount}`
        : isZh
          ? `${leftPage} / ${pageCount}`
          : `${leftPage} / ${pageCount}`;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1a1410] text-amber-50">
      <header className="flex shrink-0 items-center gap-2 border-b border-amber-100/10 bg-black/30 px-3 py-2 backdrop-blur-sm sm:px-4">
        <div className="min-w-0 flex-1 truncate text-sm font-medium tracking-wide">
          {title || (isZh ? '阅读' : 'Reader')}
        </div>
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
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-100/20 bg-transparent text-amber-50 hover:bg-amber-100/10"
            disabled={!canPrev}
            onClick={goPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[5.5rem] text-center text-xs tabular-nums text-amber-100/70">{pageLabel}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-100/20 bg-transparent text-amber-50 hover:bg-amber-100/10"
            disabled={!canNext}
            onClick={goNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
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

      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-amber-100/60">
            {isZh ? '正在打开…' : 'Opening…'}
          </p>
        ) : null}
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-300">{error}</p>
        ) : null}

        {!loading && !error ? (
          <div className="absolute inset-0 flex items-center justify-center px-2 py-4 sm:px-6">
            {/* 左右点击翻页热区 */}
            <button
              type="button"
              className="absolute inset-y-0 left-0 z-10 w-[18%] cursor-w-resize bg-transparent disabled:cursor-default"
              disabled={!canPrev}
              aria-label={isZh ? '上一面' : 'Previous spread'}
              onClick={goPrev}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 z-10 w-[18%] cursor-e-resize bg-transparent disabled:cursor-default"
              disabled={!canNext}
              aria-label={isZh ? '下一面' : 'Next spread'}
              onClick={goNext}
            />

            <div
              key={flipKey}
              className="book-spread relative z-[1] flex max-h-full max-w-full animate-[bookIn_280ms_ease-out] overflow-hidden rounded-sm shadow-[0_25px_80px_rgba(0,0,0,0.55)]"
              style={{
                background: 'linear-gradient(90deg, #efe6d8 0%, #f7f1e6 48%, #e8dfd0 52%, #f7f1e6 100%)',
              }}
            >
              <div className="relative bg-white">
                <canvas ref={leftCanvasRef} className="block max-h-[min(82vh,920px)] w-auto bg-white" />
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-8 opacity-40"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(60,40,20,0.18))' }}
                />
              </div>

              {twoPage ? (
                <>
                  <div
                    className="w-[3px] shrink-0 self-stretch"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(40,25,10,0.35), rgba(255,255,255,0.25) 45%, rgba(40,25,10,0.28))',
                    }}
                    aria-hidden
                  />
                  <div className="relative bg-white">
                    <canvas ref={rightCanvasRef} className="block max-h-[min(82vh,920px)] w-auto bg-[#f7f1e6]" />
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 w-8 opacity-40"
                      style={{ background: 'linear-gradient(270deg, transparent, rgba(60,40,20,0.16))' }}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-amber-100/10 bg-black/25 px-4 py-2 text-[11px] text-amber-100/55">
        <span>{twoPage ? (isZh ? '摊开阅读 · 左右翻面' : 'Open book · flip spreads') : isZh ? '单页模式' : 'Single page'}</span>
        <div className="flex items-center gap-4 sm:hidden">
          <button type="button" className="inline-flex items-center gap-1 disabled:opacity-40" disabled={!canPrev} onClick={goPrev}>
            <ChevronLeft className="h-3.5 w-3.5" /> {isZh ? '上一面' : 'Prev'}
          </button>
          <button type="button" className="inline-flex items-center gap-1 disabled:opacity-40" disabled={!canNext} onClick={goNext}>
            {isZh ? '下一面' : 'Next'} <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="hidden sm:inline">{isZh ? '← → 翻面 · Esc 关闭' : '← → flip · Esc close'}</span>
      </footer>

      <style>{`
        @keyframes bookIn {
          from { opacity: 0.55; transform: rotateY(-6deg) scale(0.985); }
          to { opacity: 1; transform: rotateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
