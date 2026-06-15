import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { api } from '../../lib/api';
import type { DingTalkPreviewData } from '../../types/dingtalk';
import type { DingTalkSyncApplyResult, DingTalkSyncPlan } from '../../types/dingtalkSync';

type DingTalkSyncDialogProps = {
  isZh: boolean;
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
  dingTalkPreview: DingTalkPreviewData | null;
};

const TYPE_LABEL: Record<string, { zh: string; en: string; className: string }> = {
  add: { zh: '新增', en: 'Add', className: 'text-emerald-700 bg-emerald-50' },
  remove: { zh: '删除', en: 'Remove', className: 'text-red-700 bg-red-50' },
  update: { zh: '更新', en: 'Update', className: 'text-blue-700 bg-blue-50' },
};

export default function DingTalkSyncDialog({
  isZh,
  open,
  onClose,
  onApplied,
  dingTalkPreview,
}: DingTalkSyncDialogProps) {
  const hasDingTalkPreview = Boolean(dingTalkPreview?.fetchedAt);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState<DingTalkSyncPlan | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applyResult, setApplyResult] = useState<DingTalkSyncApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setApplyResult(null);
    setError(null);
    if (!hasDingTalkPreview) {
      setPlan(null);
      setSelected({});
      return;
    }
    setLoading(true);
    void api.getDingTalkSyncPlan(dingTalkPreview ?? undefined)
      .then((p) => {
        setPlan(p);
        const initial: Record<string, boolean> = {};
        for (const a of p.actions) initial[a.id] = a.selected;
        setSelected(initial);
        if (!p.ok && p.error) setError(p.error);
      })
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load sync plan'))
      .finally(() => setLoading(false));
  }, [open, dingTalkPreview, hasDingTalkPreview]);

  const selectedCount = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).length,
    [selected],
  );

  const handleApply = async () => {
    const actionIds = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
    if (actionIds.length === 0) return;
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const result = await api.applyDingTalkSync({
        actionIds,
        preview: dingTalkPreview ?? undefined,
        plan: plan ?? undefined,
      });
      setApplyResult(result);
      if (result.ok) {
        onApplied?.();
        if (dingTalkPreview?.fetchedAt) {
          const refreshed = await api.getDingTalkSyncPlan(dingTalkPreview);
          setPlan(refreshed);
          const nextSelected: Record<string, boolean> = {};
          for (const a of refreshed.actions) nextSelected[a.id] = a.selected;
          setSelected(nextSelected);
        }
      }
      if (result.error) setError(result.error);
      else if (result.failed.length > 0) {
        setError(
          isZh
            ? `${result.failed.length} 项同步失败，请查看下方详情`
            : `${result.failed.length} item(s) failed — see details below`,
        );
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Sync apply failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isZh ? '同步学生数据' : 'Sync students from DingTalk'}</DialogTitle>
          <DialogDescription>
            {isZh
              ? '对照当前学年本地学生与钉钉缓存数据。每项变更需单独勾选确认；性别等钉钉未提供字段将留空（gender=other）。'
              : 'Compare local students with cached DingTalk data for the current year. Confirm each change individually.'}
          </DialogDescription>
        </DialogHeader>

        {!hasDingTalkPreview && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {isZh
              ? '请先在「钉钉 API」点击「刷新」拉取最新钉钉学生，再打开本对话框。'
              : 'Click Refresh on DingTalk API first, then open this dialog.'}
          </p>
        )}

        {loading && (
          <p className="text-sm text-slate-500">{isZh ? '正在生成差异清单…' : 'Building diff…'}</p>
        )}

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        {plan && !loading && (
          <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
            <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>{isZh ? '当前学年' : 'Year'}: {plan.academicYearName ?? '—'}</span>
              <span>
                {isZh ? '钉钉（去重）' : 'DingTalk (unique)'}:{' '}
                {plan.dingtalkUniqueStudentCount ?? plan.dingtalkStudentCount}
                {plan.dingtalkUniqueStudentCount != null
                  && plan.dingtalkUniqueStudentCount !== plan.dingtalkStudentCount
                  ? ` / ${plan.dingtalkStudentCount} ${isZh ? '条' : 'rows'}`
                  : ''}
              </span>
              <span>{isZh ? '本地学籍' : 'Local'}: {plan.localStudentCount}</span>
              {plan.dingtalkFetchedAt && (
                <span>
                  {isZh ? '钉钉数据时间' : 'Fetched'}:{' '}
                  {new Date(plan.dingtalkFetchedAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}
                </span>
              )}
            </div>

            {plan.classCountDrifts && plan.classCountDrifts.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                <div className="font-medium mb-1">
                  {isZh ? '班级人数差异（钉钉映射 vs 本地学籍）' : 'Class headcount drift (DingTalk vs local)'}
                </div>
                <ul className="list-disc pl-4 space-y-0.5 max-h-32 overflow-y-auto">
                  {plan.classCountDrifts.slice(0, 12).map((d) => (
                    <li key={d.localClassId}>
                      {d.localClassName}: {isZh ? '钉钉' : 'DT'} {d.dingtalkCount} / {isZh ? '本地' : 'local'} {d.localCount}
                      {' '}
                      ({d.delta > 0 ? '+' : ''}{d.delta})
                    </li>
                  ))}
                </ul>
                {plan.classCountDrifts.length > 12 && (
                  <div className="text-slate-500 mt-1">
                    {isZh ? `…另有 ${plan.classCountDrifts.length - 12} 个班级` : `…and ${plan.classCountDrifts.length - 12} more classes`}
                  </div>
                )}
              </div>
            )}

            {plan.unmappedClasses.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="font-medium mb-1">{isZh ? '未能匹配本地班级的钉钉班级' : 'Unmapped DingTalk classes'}</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {plan.unmappedClasses.map((u) => (
                    <li key={u.dingtalkClassId}>
                      {u.dingtalkClassName}
                      {u.expectedLocalClassName ? ` → 期望 ${u.expectedLocalClassName}` : ''}
                      {' '}({u.studentCount} {isZh ? '人' : 'students'})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.actions.length === 0 ? (
              <p className="text-sm text-slate-600 py-4 text-center">
                {isZh ? '钉钉与本地数据一致，无需同步。' : 'No differences — nothing to sync.'}
              </p>
            ) : (
              <table className="min-w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50">
                  <tr className="text-left text-slate-500">
                    <th className="px-2 py-2 w-8" />
                    <th className="px-2 py-2">{isZh ? '类型' : 'Type'}</th>
                    <th className="px-2 py-2">{isZh ? '姓名' : 'Name'}</th>
                    <th className="px-2 py-2">{isZh ? '钉钉班级' : 'DingTalk class'}</th>
                    <th className="px-2 py-2">{isZh ? '本地班级' : 'Local class'}</th>
                    <th className="px-2 py-2">{isZh ? '学号' : 'No.'}</th>
                    <th className="px-2 py-2">{isZh ? '变更' : 'Changes'}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.actions.map((a) => {
                    const label = TYPE_LABEL[a.type] ?? TYPE_LABEL.update;
                    return (
                      <tr key={a.id} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(selected[a.id])}
                            onChange={(e) => setSelected((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${label.className}`}>
                            {isZh ? label.zh : label.en}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-800">{a.name}</td>
                        <td className="px-2 py-2 text-slate-600">{a.dingtalkClassLabel}</td>
                        <td className="px-2 py-2 text-slate-600">
                          {a.localClassName ?? a.expectedLocalClassName ?? '—'}
                        </td>
                        <td className="px-2 py-2 text-slate-600">{a.studentNo ?? '—'}</td>
                        <td className="px-2 py-2 text-slate-600">
                          <div>{a.changes.join('；')}</div>
                          {a.warning && <div className="text-amber-700 mt-0.5">{a.warning}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {applyResult && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs space-y-1">
                <div className="font-medium text-slate-700">
                  {isZh ? '执行结果' : 'Apply result'}
                  {applyResult.applied.length > 0 && (
                    <span className="text-emerald-700 font-normal ml-2">
                      {isZh ? `成功 ${applyResult.applied.length} 项` : `${applyResult.applied.length} applied`}
                    </span>
                  )}
                  {applyResult.failed.length > 0 && (
                    <span className="text-red-700 font-normal ml-2">
                      {isZh ? `失败 ${applyResult.failed.length} 项` : `${applyResult.failed.length} failed`}
                    </span>
                  )}
                </div>
                {applyResult.applied.slice(0, 5).map((r) => (
                  <div key={r.actionId} className="text-emerald-700">{r.message}</div>
                ))}
                {applyResult.applied.length > 5 && (
                  <div className="text-slate-500">
                    {isZh ? `…另有 ${applyResult.applied.length - 5} 项成功` : `…and ${applyResult.applied.length - 5} more`}
                  </div>
                )}
                {applyResult.failed.slice(0, 8).map((r) => (
                  <div key={r.actionId} className="text-red-700">{r.error}</div>
                ))}
                {applyResult.failed.length > 8 && (
                  <div className="text-red-600">
                    {isZh ? `…另有 ${applyResult.failed.length - 8} 项失败` : `…and ${applyResult.failed.length - 8} more failures`}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={applying}>
            {isZh ? '关闭' : 'Close'}
          </Button>
          <Button
            onClick={() => void handleApply()}
            disabled={applying || loading || selectedCount === 0 || !plan?.ok}
          >
            {applying
              ? (isZh ? '同步中…' : 'Applying…')
              : (isZh ? `确认同步（${selectedCount} 项）` : `Apply (${selectedCount})`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
