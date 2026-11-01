import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { fetchAuthedArrayBuffer, fetchAuthedJson } from '../lib/schoolProjectsApi';

type WordKind = 'doc' | 'docx';

type WordHtmlPayload = {
  kind?: WordKind;
  mode?: 'rich' | 'text';
  html?: string;
  title?: string;
  error?: string;
};

const NARROW_BREAKPOINT = 720;

/**
 * Word 在线阅读：
 * - docx：前端 docx-preview；窄屏忽略固定页宽并等比适配视口
 * - doc：后端 HTML，流体排版
 */
export default function WordReaderDialog({
  open,
  title,
  fileUrl,
  htmlUrl,
  kind,
  isZh,
  onClose,
}: {
  open: boolean;
  title: string;
  fileUrl: string | null;
  htmlUrl: string | null;
  kind: WordKind;
  isZh: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const renderGen = useRef(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modeNote, setModeNote] = useState<string | null>(null);
  /** 仅 docx 固定页宽时使用；流体模式为 1 */
  const [fitScale, setFitScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const isNarrow = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const shell = shellRef.current;
    const w = shell?.clientWidth || window.innerWidth;
    return w < NARROW_BREAKPOINT;
  }, []);

  const measureFit = useCallback(() => {
    const shell = shellRef.current;
    const host = hostRef.current;
    if (!shell || !host) return;

    const page = host.querySelector('section.suis-docx') as HTMLElement | null;
    if (!page) {
      // HTML 流体模式：不缩放
      setFitScale(1);
      setNaturalSize(null);
      return;
    }

    // 先清缩放再量自然尺寸
    host.style.transform = '';
    host.style.width = '';
    const naturalW = Math.max(page.scrollWidth, page.offsetWidth, host.scrollWidth);
    const naturalH = Math.max(host.scrollHeight, host.offsetHeight);
    const avail = Math.max(200, shell.clientWidth);
    const scale = naturalW > avail + 1 ? Math.min(1, avail / naturalW) : 1;
    setNaturalSize({ w: naturalW, h: naturalH });
    setFitScale(scale);
  }, []);

  const renderDocx = useCallback(
    async (buffer: ArrayBuffer, cancelled: () => boolean) => {
      const host = hostRef.current;
      const styleHost = styleRef.current;
      if (!host) return;
      host.innerHTML = '';
      if (styleHost) styleHost.innerHTML = '';
      setFitScale(1);
      setNaturalSize(null);

      const { renderAsync } = await import('docx-preview');
      if (cancelled()) return;

      const narrow = isNarrow();
      await renderAsync(buffer, host, styleHost ?? undefined, {
        className: 'suis-docx',
        inWrapper: true,
        breakPages: true,
        renderHeaders: !narrow,
        renderFooters: !narrow,
        // 窄屏：去掉固定页宽，正文随容器回流，更易读
        ignoreWidth: narrow,
        ignoreHeight: true,
        useBase64URL: true,
      });
      if (cancelled()) return;

      setModeNote(
        narrow
          ? isZh
            ? 'DOCX · 适配手机宽度'
            : 'DOCX · fit to phone'
          : isZh
            ? 'DOCX 分页预览'
            : 'DOCX page preview',
      );

      // 等布局完成后再量；仍溢出则等比缩小（表格/图片等）
      requestAnimationFrame(() => {
        if (!cancelled()) measureFit();
      });
    },
    [isNarrow, isZh, measureFit],
  );

  const renderHtmlFallback = useCallback(
    async (cancelled: () => boolean) => {
      const host = hostRef.current;
      if (!host || !htmlUrl) throw new Error(isZh ? '无法打开文档' : 'Could not open document');
      const payload = await fetchAuthedJson<WordHtmlPayload>(htmlUrl);
      if (cancelled()) return;
      if (payload.error) throw new Error(payload.error);
      host.innerHTML = `<div class="suis-word-html">${payload.html || ''}</div>`;
      setFitScale(1);
      setNaturalSize(null);
      setModeNote(
        payload.mode === 'text'
          ? isZh
            ? '旧版 DOC · 文本预览（版式可能简化）'
            : 'Legacy DOC · text preview (layout simplified)'
          : isZh
            ? 'Word 预览'
            : 'Word preview',
      );
    },
    [htmlUrl, isZh],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const gen = ++renderGen.current;
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = '';
    if (styleRef.current) styleRef.current.innerHTML = '';
    bufferRef.current = null;
    setLoading(true);
    setError(null);
    setModeNote(null);
    setFitScale(1);
    setNaturalSize(null);

    void (async () => {
      try {
        if (kind === 'docx' && fileUrl) {
          try {
            const buffer = await fetchAuthedArrayBuffer(fileUrl);
            if (cancelled || gen !== renderGen.current) return;
            bufferRef.current = buffer;
            await renderDocx(buffer, () => cancelled || gen !== renderGen.current);
            if (!cancelled && gen === renderGen.current) setLoading(false);
            return;
          } catch (docxErr) {
            console.warn('docx-preview failed, fallback to html', docxErr);
          }
        }

        await renderHtmlFallback(() => cancelled || gen !== renderGen.current);
      } catch (e: unknown) {
        if (!cancelled && gen === renderGen.current) {
          setError((e as Error).message || (isZh ? '渲染失败' : 'Render failed'));
        }
      } finally {
        if (!cancelled && gen === renderGen.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (hostRef.current) hostRef.current.innerHTML = '';
      if (styleRef.current) styleRef.current.innerHTML = '';
    };
  }, [open, fileUrl, htmlUrl, kind, isZh, renderDocx, renderHtmlFallback]);

  // 旋转 / 改窗口宽：docx 按新宽度重渲或重新缩放
  useEffect(() => {
    if (!open) return;
    const shell = shellRef.current;
    if (!shell) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastNarrow = isNarrow();

    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const narrow = isNarrow();
        const buffer = bufferRef.current;
        // 跨过窄/宽断点时，docx 需要换 ignoreWidth 重渲
        if (kind === 'docx' && buffer && narrow !== lastNarrow) {
          lastNarrow = narrow;
          const gen = ++renderGen.current;
          setLoading(true);
          void renderDocx(buffer, () => gen !== renderGen.current)
            .catch(() => undefined)
            .finally(() => {
              if (gen === renderGen.current) setLoading(false);
            });
          return;
        }
        lastNarrow = narrow;
        measureFit();
      }, 120);
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(shell);
    window.addEventListener('orientationchange', onResize);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('orientationchange', onResize);
    };
  }, [open, kind, isNarrow, measureFit, renderDocx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const scaled = fitScale < 0.999 && naturalSize != null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1a1410] text-amber-50">
      <header className="flex shrink-0 items-center gap-2 border-b border-amber-100/10 bg-black/30 px-3 py-2 backdrop-blur-sm sm:px-4">
        <div className="min-w-0 flex-1 truncate text-sm font-medium tracking-wide">
          {title || (isZh ? '阅读' : 'Reader')}
        </div>
        {modeNote ? <span className="hidden text-[11px] text-amber-100/50 sm:inline">{modeNote}</span> : null}
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

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        {loading ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-amber-100/60">
            {isZh ? '正在打开…' : 'Opening…'}
          </p>
        ) : null}
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-300">{error}</p>
        ) : null}

        <div ref={styleRef} className="hidden" aria-hidden />

        <div
          ref={shellRef}
          className={`mx-auto min-h-full w-full max-w-4xl px-2 py-4 sm:px-6 sm:py-6 ${loading || error ? 'invisible' : ''}`}
        >
          <div
            className="word-reader-frame overflow-hidden rounded-sm bg-[#f7f1e6] text-slate-900 shadow-[0_25px_80px_rgba(0,0,0,0.55)]"
            style={
              scaled
                ? {
                    height: Math.ceil(naturalSize.h * fitScale),
                    width: '100%',
                  }
                : undefined
            }
          >
            <div
              ref={hostRef}
              className="word-reader-host"
              style={
                scaled
                  ? {
                      transform: `scale(${fitScale})`,
                      transformOrigin: 'top left',
                      width: naturalSize.w,
                    }
                  : { width: '100%' }
              }
            />
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-amber-100/10 bg-black/25 px-4 py-2 text-[11px] text-amber-100/55">
        <span>{kind === 'docx' ? 'DOCX' : 'DOC'}</span>
        <span className="sm:hidden">{isZh ? '已适配屏幕宽度' : 'Fit to screen width'}</span>
        <span className="hidden sm:inline">{isZh ? 'Esc 关闭' : 'Esc close'}</span>
      </footer>

      <style>{`
        .word-reader-host .suis-docx-wrapper {
          background: transparent !important;
          padding: 1rem 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        .word-reader-host .suis-docx-wrapper > section.suis-docx {
          margin: 0 auto 1rem !important;
          box-shadow: 0 8px 28px rgba(40, 25, 10, 0.12);
          background: #fff !important;
          box-sizing: border-box !important;
          max-width: 100% !important;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        @media (max-width: 719px) {
          .word-reader-host .suis-docx-wrapper {
            padding: 0.65rem 0 !important;
          }
          .word-reader-host .suis-docx-wrapper > section.suis-docx {
            width: 100% !important;
            padding: 0.85rem 0.75rem !important;
            min-height: 0 !important;
            margin-bottom: 0.75rem !important;
          }
          .word-reader-host .suis-docx-wrapper > section.suis-docx article {
            max-width: 100% !important;
          }
        }
        .word-reader-host table {
          max-width: 100% !important;
          table-layout: fixed;
        }
        .word-reader-host td,
        .word-reader-host th {
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .word-reader-host img {
          max-width: 100% !important;
          height: auto !important;
        }
        .word-reader-host .suis-word-html {
          padding: 1.25rem 1rem 1.75rem;
          background: #fff;
          min-height: 70vh;
          line-height: 1.75;
          font-size: 15px;
          color: #1e293b;
          overflow-wrap: anywhere;
          word-break: break-word;
          box-sizing: border-box;
          width: 100%;
        }
        @media (max-width: 719px) {
          .word-reader-host .suis-word-html {
            padding: 1rem 0.85rem 1.5rem;
            font-size: 14px;
            line-height: 1.7;
          }
        }
        .word-reader-host .suis-word-html h1,
        .word-reader-host .suis-word-html h2,
        .word-reader-host .suis-word-html h3 {
          margin: 1.25em 0 0.5em;
          font-weight: 700;
          color: #0f172a;
        }
        .word-reader-host .suis-word-html p {
          margin: 0 0 0.85em;
        }
        .word-reader-host .suis-word-html ul,
        .word-reader-host .suis-word-html ol {
          margin: 0 0 0.85em 1.25em;
          padding-left: 0.25em;
        }
        .word-reader-host .suis-word-html table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.75em 0;
        }
        .word-reader-host .suis-word-html td,
        .word-reader-host .suis-word-html th {
          border: 1px solid #cbd5e1;
          padding: 0.35em 0.5em;
        }
        .word-reader-host .suis-word-html img {
          max-width: 100%;
          height: auto;
        }
        .word-reader-host .word-header,
        .word-reader-host .word-footer {
          color: #64748b;
          font-size: 12px;
          border-bottom: 1px solid #e2e8f0;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
        }
        .word-reader-host .word-footer {
          border-bottom: 0;
          border-top: 1px solid #e2e8f0;
          margin-top: 1.5rem;
          margin-bottom: 0;
          padding-top: 0.5rem;
        }
        .word-reader-host .word-empty {
          color: #94a3b8;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
