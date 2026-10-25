import { useCallback, useEffect, useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { api } from '../../lib/api';
import PdfReaderDialog from '../PdfReaderDialog';

type StoredFileRow = Awaited<ReturnType<typeof api.getStoredFiles>>[number];

function formatBytes(n: number, isZh: boolean): string {
  if (!n) return isZh ? '—' : '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function moduleLabel(key: string, isZh: boolean): string {
  if (key === 'project') return isZh ? '项目中心' : 'Projects';
  return key || (isZh ? '未知模块' : 'Unknown');
}

export default function AdminStoredFilesPanel({ isZh }: { isZh: boolean }) {
  const [files, setFiles] = useState<StoredFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textView, setTextView] = useState<StoredFileRow | null>(null);
  const [pdfReader, setPdfReader] = useState<{ title: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFiles(await api.getStoredFiles());
    } catch (e: unknown) {
      setError((e as Error).message || (isZh ? '加载失败' : 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [isZh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onView = (file: StoredFileRow) => {
    setError(null);
    if (file.kind === 'text') {
      setTextView(file);
      return;
    }
    setPdfReader({
      title: file.title || file.originalName || 'PDF',
      url: api.storedFileContentUrl(file.id),
    });
  };

  const onDelete = async (file: StoredFileRow) => {
    const label = file.title || file.originalName || file.id;
    if (!window.confirm(isZh ? `删除「${label}」？磁盘上的文件也会删除。` : `Delete “${label}”? The file on disk will also be removed.`)) {
      return;
    }
    setBusyId(file.id);
    setError(null);
    try {
      setFiles(await api.deleteStoredFile(file.id));
    } catch (e: unknown) {
      setError((e as Error).message || (isZh ? '删除失败' : 'Delete failed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{isZh ? '文件管理' : 'File manager'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isZh
              ? '系统管理员可查看并删除各模块上传到 Volume 的文件与文本资料。'
              : 'System admins can view and delete files and text assets uploaded across modules.'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void reload()}>
          {isZh ? '刷新' : 'Refresh'}
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p> : null}

      {!loading && files.length === 0 ? (
        <p className="text-sm text-slate-500">{isZh ? '还没有上传文件。' : 'No stored files yet.'}</p>
      ) : null}

      {!loading && files.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{isZh ? '模块' : 'Module'}</th>
                  <th className="px-3 py-2 font-medium">{isZh ? '归属' : 'Belongs to'}</th>
                  <th className="px-3 py-2 font-medium">{isZh ? '类型' : 'Type'}</th>
                  <th className="px-3 py-2 font-medium">{isZh ? '标题 / 文件名' : 'Title / name'}</th>
                  <th className="px-3 py-2 font-medium">{isZh ? '大小' : 'Size'}</th>
                  <th className="px-3 py-2 font-medium">{isZh ? '上传人' : 'By'}</th>
                  <th className="px-3 py-2 font-medium">{isZh ? '操作' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map((file) => (
                  <tr key={file.id} className="align-top">
                    <td className="px-3 py-2 text-slate-700">{moduleLabel(file.moduleKey, isZh)}</td>
                    <td className="px-3 py-2 text-slate-600">{file.entityTitle || file.entityId}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {file.kind === 'pdf' ? 'PDF' : isZh ? '文本' : 'Text'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{file.title || '—'}</div>
                      {file.originalName ? <div className="text-xs text-slate-500">{file.originalName}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {file.kind === 'pdf' ? formatBytes(file.sizeBytes, isZh) : isZh ? '库内文本' : 'In DB'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{file.createdByName || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === file.id}
                          onClick={() => onView(file)}
                        >
                          <FileText className="mr-1 h-3.5 w-3.5" />
                          {file.kind === 'pdf' ? (isZh ? '阅读' : 'Read') : isZh ? '查看' : 'View'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === file.id}
                          onClick={() => void onDelete(file)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          {isZh ? '删除' : 'Delete'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <PdfReaderDialog
        open={pdfReader != null}
        title={pdfReader?.title || ''}
        fileUrl={pdfReader?.url ?? null}
        isZh={isZh}
        onClose={() => setPdfReader(null)}
      />

      <Dialog open={textView != null} onOpenChange={(open) => !open && setTextView(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{textView?.title || (isZh ? '文本内容' : 'Text')}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            {textView?.bodyText || ''}
          </pre>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTextView(null)}>
              {isZh ? '关闭' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
