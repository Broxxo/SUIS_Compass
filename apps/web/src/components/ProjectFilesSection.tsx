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

function formatDate(value: string | null, isZh: boolean): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return isZh ? `${y}-${m}-${d}` : `${y}-${m}-${d}`;
}

/** 文本资料下载为 .txt，便于和 PDF 一样"同步"到本地 */
function downloadTextFile(asset: ProjectPreviewAsset): void {
  const name = (asset.title || asset.originalName || 'note').replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([asset.bodyText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.txt') ? name : `${name}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ProjectFilesSection({
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
        if (!cancelled) setError((e as Error).message || (isZh ? '文件加载失败' : 'Could not load files'));
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
          : code === 'invalid_pdf'
            ? isZh
              ? '只支持 PDF 文件'
              : 'Only PDF files are supported'
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

  const onDownload = (asset: ProjectPreviewAsset) => {
    if (asset.kind === 'text') {
      downloadTextFile(asset);
      return;
    }
    setBusy(true);
    void downloadAuthedFile(
      projectPreviewFileUrl(projectId, asset.id),
      asset.originalName || `${asset.title || 'document'}.pdf`,
    )
      .catch((e: unknown) => setError((e as Error).message || (isZh ? '下载失败' : 'Download failed')))
      .finally(() => setBusy(false));
  };

  // 展开卡片：无内容时整块不显示
  if (mode === 'view') {
    if (loading || error) return null;
    if (assets.length === 0) return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-slate-500">
            {isZh ? '项目文件' : 'Project files'}
            {assets.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                {assets.length}
              </span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {canEdit
              ? isZh
                ? '上传与本项目相关的 PDF 或编写文本资料，团队成员打开项目即可查看与下载。'
                : 'Upload project PDFs or write notes; teammates can view and download them from the project.'
              : isZh
                ? '项目相关 PDF 与文本资料，可在线阅读或下载。'
                : 'Project PDFs and notes — read online or download.'}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {isZh ? '上传 PDF' : 'Upload PDF'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setTextEditor({ assetId: null, title: '', bodyText: '' })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {isZh ? '新建文本' : 'New note'}
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

      {error ? <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</div> : null}
      {canEdit && loading ? <p className="mt-2 text-xs text-slate-500">{isZh ? '加载文件…' : 'Loading files…'}</p> : null}
      {canEdit && !loading && assets.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {isZh ? '还没有项目文件，上传 PDF 或新建文本开始协作。' : 'No project files yet — upload a PDF or create a note.'}
        </p>
      ) : null}

      {assets.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">{isZh ? '文件' : 'File'}</th>
                <th className="hidden px-3 py-1.5 font-medium sm:table-cell">{isZh ? '大小' : 'Size'}</th>
                <th className="hidden px-3 py-1.5 font-medium md:table-cell">{isZh ? '上传人' : 'By'}</th>
                <th className="hidden px-3 py-1.5 font-medium md:table-cell">{isZh ? '日期' : 'Date'}</th>
                <th className="px-3 py-1.5 text-right font-medium">{isZh ? '操作' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => (
                <tr key={asset.id} className="align-middle">
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          asset.kind === 'pdf' ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'
                        }`}
                      >
                        {asset.kind === 'pdf' ? 'PDF' : isZh ? '文本' : 'TXT'}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">
                          {asset.title || asset.originalName || '—'}
                        </div>
                        {asset.kind === 'text' ? (
                          <div className="truncate text-xs text-slate-400">
                            {asset.bodyText.length > 80 ? `${asset.bodyText.slice(0, 80)}…` : asset.bodyText}
                          </div>
                        ) : asset.originalName && asset.originalName !== asset.title ? (
                          <div className="truncate text-xs text-slate-400">{asset.originalName}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-slate-500 sm:table-cell">
                    {asset.kind === 'pdf' ? formatBytes(asset.sizeBytes) : isZh ? '库内文本' : 'In DB'}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-slate-500 md:table-cell">
                    {asset.createdByName || '—'}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-slate-500 md:table-cell">
                    {formatDate(asset.createdAt, isZh)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {asset.kind === 'pdf' ? (
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
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setTextEditor({ assetId: asset.id, title: asset.title, bodyText: asset.bodyText })}
                        >
                          <FileText className="mr-1 h-3.5 w-3.5" />
                          {canEdit ? (isZh ? '编辑' : 'Edit') : isZh ? '查看' : 'View'}
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onDownload(asset)}>
                        <Download className="h-3.5 w-3.5" />
                        <span className="sr-only">{isZh ? '下载' : 'Download'}</span>
                      </Button>
                      {canEdit ? (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onDelete(asset)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">{isZh ? '删除' : 'Delete'}</span>
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

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
                    ? '编辑文本资料'
                    : 'Edit note'
                  : isZh
                    ? '查看文本资料'
                    : 'View note'
                : isZh
                  ? '新建文本资料'
                  : 'New note'}
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
                  placeholder={isZh ? '在此粘贴或输入项目资料…' : 'Paste or type project material…'}
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
