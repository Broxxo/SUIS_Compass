import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import {
  createProjectPreviewText,
  deleteProjectPreviewAsset,
  downloadAuthedFile,
  fetchProjectPreview,
  projectPreviewFileUrl,
  updateProjectPreviewText,
  uploadProjectPreviewPdf,
  type ProjectPreviewAsset,
} from '../lib/schoolProjectsApi';
import PdfReaderDialog from './PdfReaderDialog';

const PDF_MAX_BYTES = 50 * 1024 * 1024;

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectPreviewSection({
  projectId,
  mode,
  isZh,
  revision = 0,
  onChanged,
}: {
  projectId: string;
  /** view：展开卡片只读展示，无内容则不渲染；edit：编辑项目对话框内管理 */
  mode: 'view' | 'edit';
  isZh: boolean;
  revision?: number;
  onChanged?: () => void;
}) {
  const canEdit = mode === 'edit';
  const [assets, setAssets] = useState<ProjectPreviewAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [textEditor, setTextEditor] = useState<{ assetId: string | null; title: string; bodyText: string } | null>(
    null,
  );
  const [pdfReader, setPdfReader] = useState<{ title: string; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const board = await fetchProjectPreview(projectId);
        if (!cancelled) setAssets(board.assets);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message || (isZh ? '预览加载失败' : 'Could not load preview'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, isZh, revision]);

  const applyAssets = (next: ProjectPreviewAsset[]) => {
    setAssets(next);
    onChanged?.();
  };

  const saveText = async () => {
    if (!textEditor || !textEditor.bodyText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = textEditor.assetId
        ? await updateProjectPreviewText(projectId, textEditor.assetId, textEditor)
        : await createProjectPreviewText(projectId, textEditor);
      applyAssets(next);
      setTextEditor(null);
    } catch (e: unknown) {
      setError((e as Error).message || (isZh ? '保存失败' : 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const onUploadPdf = async (file: File | null) => {
    if (!file) return;
    if (file.size > PDF_MAX_BYTES) {
      setError(isZh ? 'PDF 不能超过 50MB' : 'PDF must be 50MB or smaller');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setBusy(true);
    setError(null);
    try {
      applyAssets(await uploadProjectPreviewPdf(projectId, file));
    } catch (e: unknown) {
      const code = (e as Error).message;
      setError(
        code === 'file_too_large'
          ? isZh
            ? 'PDF 不能超过 50MB'
            : 'PDF must be 50MB or smaller'
          : code || (isZh ? '上传失败' : 'Upload failed'),
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onDelete = async (asset: ProjectPreviewAsset) => {
    if (!window.confirm(isZh ? `删除「${asset.title || asset.originalName}」？` : `Delete “${asset.title || asset.originalName}”?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      applyAssets(await deleteProjectPreviewAsset(projectId, asset.id));
    } catch (e: unknown) {
      setError((e as Error).message || (isZh ? '删除失败' : 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  // 展开卡片：无内容时整块不显示
  if (mode === 'view') {
    if (loading || error) return null;
    if (assets.length === 0) return null;
  }

  return (
    <div className={mode === 'view' ? 'mb-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3' : 'space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-slate-500">{isZh ? '项目预览' : 'Project preview'}</h3>
          {mode === 'edit' ? (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {isZh ? '添加文本或上传 PDF 后，展开项目时才会显示预览区。' : 'After you add text or a PDF, the preview appears when the project is expanded.'}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setTextEditor({ assetId: null, title: '', bodyText: '' })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {isZh ? '添加文本' : 'Add text'}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" />
              {isZh ? '上传 PDF' : 'Upload PDF'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => void onUploadPdf(event.target.files?.[0] ?? null)}
            />
          </div>
        ) : null}
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</div> : null}
      {mode === 'edit' && loading ? <p className="text-xs text-slate-500">{isZh ? '加载预览…' : 'Loading preview…'}</p> : null}
      {mode === 'edit' && !loading && assets.length === 0 ? (
        <p className="text-xs text-slate-500">{isZh ? '还没有预览内容。' : 'No preview content yet.'}</p>
      ) : null}

      <div className="space-y-2">
        {assets.map((asset) => (
          <div key={asset.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {asset.kind === 'pdf' ? 'PDF' : isZh ? '文本' : 'Text'}
                  </span>
                  <span className="truncate text-sm font-medium text-slate-800">{asset.title || asset.originalName || '—'}</span>
                  {asset.kind === 'pdf' ? (
                    <span className="text-xs text-slate-400">{formatBytes(asset.sizeBytes)}</span>
                  ) : null}
                </div>
                {asset.kind === 'text' ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                    {asset.bodyText.length > 400 ? `${asset.bodyText.slice(0, 400)}…` : asset.bodyText}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {asset.kind === 'pdf' ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setPdfReader({
                          title: asset.title || asset.originalName || 'PDF',
                          url: projectPreviewFileUrl(projectId, asset.id),
                        })
                      }
                    >
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      {isZh ? '阅读' : 'Read'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void downloadAuthedFile(
                          projectPreviewFileUrl(projectId, asset.id),
                          asset.originalName || asset.title || 'document.pdf',
                        )
                          .catch((e: unknown) =>
                            setError((e as Error).message || (isZh ? '下载失败' : 'Download failed')),
                          )
                          .finally(() => setBusy(false));
                      }}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" />
                      {isZh ? '下载' : 'Download'}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setTextEditor({ assetId: asset.id, title: asset.title, bodyText: asset.bodyText })
                    }
                  >
                    {canEdit ? (isZh ? '编辑' : 'Edit') : isZh ? '查看' : 'View'}
                  </Button>
                )}
                {canEdit ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onDelete(asset)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      <PdfReaderDialog
        open={pdfReader != null}
        title={pdfReader?.title || ''}
        fileUrl={pdfReader?.url ?? null}
        isZh={isZh}
        onClose={() => setPdfReader(null)}
      />

      <Dialog open={textEditor != null} onOpenChange={(open) => !open && setTextEditor(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {textEditor?.assetId
                ? canEdit
                  ? isZh
                    ? '编辑文本'
                    : 'Edit text'
                  : isZh
                    ? '查看文本'
                    : 'View text'
                : isZh
                  ? '添加文本'
                  : 'Add text'}
            </DialogTitle>
          </DialogHeader>
          {textEditor ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">{isZh ? '标题（可选）' : 'Title (optional)'}</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={textEditor.title}
                  disabled={!canEdit}
                  onChange={(event) => setTextEditor({ ...textEditor, title: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">{isZh ? '内容（可粘贴）' : 'Content (paste allowed)'}</span>
                <textarea
                  className="min-h-40 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={textEditor.bodyText}
                  disabled={!canEdit}
                  readOnly={!canEdit}
                  onChange={(event) => setTextEditor({ ...textEditor, bodyText: event.target.value })}
                  placeholder={isZh ? '在此粘贴或输入项目说明…' : 'Paste or type project notes…'}
                />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setTextEditor(null)}>
              {canEdit ? (isZh ? '取消' : 'Cancel') : isZh ? '关闭' : 'Close'}
            </Button>
            {canEdit ? (
              <Button type="button" disabled={busy || !textEditor?.bodyText.trim()} onClick={() => void saveText()}>
                {isZh ? '保存' : 'Save'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
