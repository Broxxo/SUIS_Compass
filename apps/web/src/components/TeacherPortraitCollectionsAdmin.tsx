import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TEACHER_PORTRAIT_COLLECTION_TYPES,
  teacherPortraitCollectionTypeLabel,
  type TeacherPortraitCollectionType,
} from '@repo/shared';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import type {
  TeacherPortraitCollectionProgress,
  TeacherPortraitCollectionTemplateSummary,
  Term,
} from '../types/classManagement';
import TeacherPortraitCollectionFormPreview from './TeacherPortraitCollectionFormPreview';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const COLLECTION_TYPE_OPTIONS = Object.keys(
  TEACHER_PORTRAIT_COLLECTION_TYPES,
) as TeacherPortraitCollectionType[];

function statusLabel(status: string, isZh: boolean): string {
  if (status === 'published') return isZh ? '已发布' : 'Published';
  if (status === 'closed') return isZh ? '已停发' : 'Stopped';
  return isZh ? '草稿' : 'Draft';
}

function collectionTypeFromRaw(raw: string): TeacherPortraitCollectionType {
  if (raw in TEACHER_PORTRAIT_COLLECTION_TYPES) return raw as TeacherPortraitCollectionType;
  return 'teaching-diagnosis-kiss';
}

export default function TeacherPortraitCollectionsAdmin({
  isZh,
  yearId,
  term,
}: {
  isZh: boolean;
  yearId: string;
  term: Term;
}) {
  const [list, setList] = useState<TeacherPortraitCollectionTemplateSummary[]>([]);
  const [progressById, setProgressById] = useState<Record<string, TeacherPortraitCollectionProgress>>({});
  const [newTitle, setNewTitle] = useState('');
  const [newCollectionType, setNewCollectionType] =
    useState<TeacherPortraitCollectionType>('teaching-diagnosis-kiss');
  const [loading, setLoading] = useState(false);
  const [progressListLoading, setProgressListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTemplateId, setEditTemplateId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [progressDialogTitle, setProgressDialogTitle] = useState('');
  const [progressDialogData, setProgressDialogData] = useState<TeacherPortraitCollectionProgress | null>(null);
  const [progressDialogLoading, setProgressDialogLoading] = useState(false);

  const newTypeDefaultTitle = useMemo(
    () => teacherPortraitCollectionTypeLabel(newCollectionType, isZh),
    [newCollectionType, isZh],
  );

  const loadList = useCallback(async () => {
    if (!USE_CLOUD_STORAGE || !yearId) {
      setList([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const templates = await api.getAdminTeacherPortraitTemplates({ academicYearId: yearId, term });
      setList(templates);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [yearId, term]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || list.length === 0) {
      setProgressById({});
      return;
    }
    let cancelled = false;
    setProgressListLoading(true);
    Promise.all(
      list.map(async (tpl) => {
        if (tpl.status === 'draft') return [tpl.id, null] as const;
        try {
          const progress = await api.getAdminTeacherPortraitTemplateProgress(tpl.id);
          return [tpl.id, progress] as const;
        } catch {
          return [tpl.id, null] as const;
        }
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        const next: Record<string, TeacherPortraitCollectionProgress> = {};
        for (const [id, progress] of pairs) {
          if (progress) next[id] = progress;
        }
        setProgressById(next);
      })
      .finally(() => {
        if (!cancelled) setProgressListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [list]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await loadList();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCreate = () =>
    runAction(async () => {
      if (!yearId) throw new Error(isZh ? '请先选择学年' : 'Select academic year');
      await api.createAdminTeacherPortraitTemplate({
        academicYearId: yearId,
        term,
        title: newTitle.trim() || newTypeDefaultTitle,
        collectionType: newCollectionType,
      });
      setNewTitle('');
      setCreateDialogOpen(false);
    });

  const openEditDialog = (tpl: TeacherPortraitCollectionTemplateSummary) => {
    const type = collectionTypeFromRaw(tpl.collectionType);
    setEditTemplateId(tpl.id);
    setEditTitle(tpl.title || teacherPortraitCollectionTypeLabel(type, isZh));
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () =>
    runAction(async () => {
      if (!editTemplateId) return;
      await api.putAdminTeacherPortraitTemplate(editTemplateId, {
        title: editTitle.trim() || null,
      });
      setEditDialogOpen(false);
      setEditTemplateId('');
      setEditTitle('');
    });

  const openProgressDialog = async (tpl: TeacherPortraitCollectionTemplateSummary) => {
    const type = collectionTypeFromRaw(tpl.collectionType);
    setProgressDialogOpen(true);
    setProgressDialogTitle(tpl.title || teacherPortraitCollectionTypeLabel(type, isZh));
    setProgressDialogData(null);
    setProgressDialogLoading(true);
    setError(null);
    try {
      const progress = await api.getAdminTeacherPortraitTemplateProgress(tpl.id);
      setProgressDialogData(progress);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load progress');
    } finally {
      setProgressDialogLoading(false);
    }
  };

  const handleDelete = (tpl: TeacherPortraitCollectionTemplateSummary) => {
    const type = collectionTypeFromRaw(tpl.collectionType);
    const label = tpl.title || teacherPortraitCollectionTypeLabel(type, isZh);
    const msg =
      tpl.status === 'draft'
        ? isZh
          ? `确定删除草稿「${label}」？`
          : `Delete draft “${label}”?`
        : isZh
          ? `确定删除「${label}」？已填写的教师数据将一并删除。`
          : `Delete “${label}”? All teacher submissions will be removed.`;
    if (!window.confirm(msg)) return;
    void runAction(async () => {
      await api.deleteAdminTeacherPortraitTemplate(tpl.id);
      if (progressDialogOpen && progressDialogData?.templateId === tpl.id) {
        setProgressDialogOpen(false);
        setProgressDialogData(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">{isZh ? '新建采集' : 'New collection'}</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '模版' : 'Template'}</label>
            <select
              value={newCollectionType}
              onChange={(e) => setNewCollectionType(e.target.value as TeacherPortraitCollectionType)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {COLLECTION_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {teacherPortraitCollectionTypeLabel(type, isZh)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '标题（可选）' : 'Title (optional)'}</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={newTypeDefaultTitle}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button
            type="button"
            size="sm"
            disabled={!USE_CLOUD_STORAGE || !yearId || busy}
            onClick={() => setCreateDialogOpen(true)}
          >
            {isZh ? '创建模版' : 'Create template'}
          </Button>
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-slate-100 shrink-0">
            <DialogTitle>{isZh ? '模版预览' : 'Template preview'}</DialogTitle>
            <DialogDescription>
              {isZh
                ? `即将创建「${newTitle.trim() || newTypeDefaultTitle}」信息采集模版，请确认教师填写内容。`
                : `You are about to create “${newTitle.trim() || newTypeDefaultTitle}”. Review the teacher form below.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <TeacherPortraitCollectionFormPreview collectionType={newCollectionType} isZh={isZh} />
          </div>
          <DialogFooter className="px-6 py-4 border-t border-slate-100 shrink-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={busy}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handleConfirmCreate()}>
              {busy ? (isZh ? '创建中…' : 'Creating…') : isZh ? '确认创建' : 'Confirm create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '编辑模版名称' : 'Edit template name'}</DialogTitle>
          </DialogHeader>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={isZh ? '模版名称' : 'Template name'}
          />
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={busy}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handleSaveEdit()}>
              {isZh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={progressDialogOpen}
        onOpenChange={(open) => {
          setProgressDialogOpen(open);
          if (!open) {
            setProgressDialogData(null);
            setProgressDialogTitle('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isZh ? '进度确认' : 'Progress confirmation'}</DialogTitle>
            <DialogDescription>
              {isZh
                ? `教师信息采集：${progressDialogTitle || '—'}（仅后台可见）`
                : `Teacher collection: ${progressDialogTitle || '-'} (admin only)`}
            </DialogDescription>
          </DialogHeader>
          {progressDialogLoading ? (
            <div className="text-sm text-slate-500 py-4">{isZh ? '加载进度中…' : 'Loading progress…'}</div>
          ) : !progressDialogData ? (
            <div className="text-sm text-slate-500 py-4">{isZh ? '暂无进度数据。' : 'No progress data yet.'}</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{isZh ? `专任教师：${progressDialogData.totalTeachers}` : `Teachers: ${progressDialogData.totalTeachers}`}</span>
                <span className="text-emerald-700">
                  {isZh ? `已填写：${progressDialogData.completedTeachers}` : `Completed: ${progressDialogData.completedTeachers}`}
                </span>
                <span className="text-amber-700">
                  {isZh ? `未填写：${progressDialogData.pendingTeachers}` : `Pending: ${progressDialogData.pendingTeachers}`}
                </span>
                <span className="font-semibold">
                  {isZh ? `完成率：${progressDialogData.completionRate}%` : `Rate: ${progressDialogData.completionRate}%`}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                  <div className="text-xs font-semibold text-amber-900 mb-2">
                    {isZh ? `未填写（${progressDialogData.pending.length}）` : `Pending (${progressDialogData.pending.length})`}
                  </div>
                  {progressDialogData.pending.length === 0 ? (
                    <p className="text-xs text-slate-500">{isZh ? '全员已填写。' : 'All teachers submitted.'}</p>
                  ) : (
                    <ul className="text-sm text-slate-800 space-y-1 max-h-48 overflow-y-auto">
                      {progressDialogData.pending.map((t) => (
                        <li key={t.teacherId}>{t.teacherName}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                  <div className="text-xs font-semibold text-emerald-900 mb-2">
                    {isZh ? `已填写（${progressDialogData.completed.length}）` : `Completed (${progressDialogData.completed.length})`}
                  </div>
                  {progressDialogData.completed.length === 0 ? (
                    <p className="text-xs text-slate-500">{isZh ? '暂无提交。' : 'No submissions yet.'}</p>
                  ) : (
                    <ul className="text-sm text-slate-800 space-y-1 max-h-48 overflow-y-auto">
                      {progressDialogData.completed.map((t) => (
                        <li key={t.teacherId}>{t.teacherName}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      {loading && <div className="text-xs text-slate-500">{isZh ? '加载中…' : 'Loading…'}</div>}

      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <div className="text-xs font-semibold text-slate-700">{isZh ? '本学期采集任务' : 'Collections this term'}</div>
        {list.length === 0 ? (
          <p className="text-xs text-slate-500">{isZh ? '暂无任务，请先创建。' : 'No collections yet.'}</p>
        ) : (
          <div className="space-y-2">
            {list.map((tpl) => {
              const type = collectionTypeFromRaw(tpl.collectionType);
              const typeLabel = teacherPortraitCollectionTypeLabel(type, isZh);
              const displayTitle = tpl.title || typeLabel;
              const progress = progressById[tpl.id];
              const showProgress = tpl.status !== 'draft';
              const rate = progress?.completionRate ?? 0;

              return (
                <div
                  key={tpl.id}
                  className="rounded border border-slate-200 px-3 py-2.5 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">{displayTitle}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {typeLabel} · {statusLabel(tpl.status, isZh)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 shrink-0 justify-end">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => openEditDialog(tpl)}>
                        {isZh ? '编辑' : 'Edit'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || tpl.status !== 'draft'}
                        onClick={() =>
                          void runAction(async () => {
                            await api.publishAdminTeacherPortraitTemplate(tpl.id);
                          })
                        }
                      >
                        {isZh ? '发布' : 'Publish'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || tpl.status !== 'published'}
                        onClick={() =>
                          void runAction(async () => {
                            await api.closeAdminTeacherPortraitTemplate(tpl.id);
                          })
                        }
                      >
                        {isZh ? '停发' : 'Stop'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || tpl.status === 'draft'}
                        onClick={() => void openProgressDialog(tpl)}
                      >
                        {isZh ? '进度确认' : 'Progress'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        disabled={busy}
                        onClick={() => handleDelete(tpl)}
                      >
                        {isZh ? '删除' : 'Delete'}
                      </Button>
                    </div>
                  </div>

                  {showProgress && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                        <span>
                          {progressListLoading && !progress
                            ? isZh
                              ? '加载进度…'
                              : 'Loading…'
                            : progress
                              ? isZh
                                ? `已填写 ${progress.completedTeachers}/${progress.totalTeachers} 人`
                                : `${progress.completedTeachers}/${progress.totalTeachers} submitted`
                              : isZh
                                ? '进度暂不可用'
                                : 'Progress unavailable'}
                        </span>
                        {progress ? <span>{progress.completionRate}%</span> : null}
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                        {progress ? (
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all"
                            style={{ width: `${Math.min(100, rate)}%` }}
                          />
                        ) : (
                          <div className={`h-full w-full ${progressListLoading ? 'bg-slate-300 animate-pulse' : 'bg-slate-200'}`} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
