import { useCallback, useEffect, useRef, useState } from 'react';
import { pickPreferredPublishedTask, teacherPortraitCollectionTypeLabel } from '@repo/shared';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import type {
  AcademicYear,
  ReportTeachingDiagnosis,
  TeacherPortraitCollectionTemplateSummary,
  Term,
} from '../types/classManagement';
import { AcademicYearTermFields } from './academicPeriodSelectors';
import TeachingDiagnosisKissForm from './TeachingDiagnosisKissForm';
import { Button } from './ui/button';

const emptyDiagnosis = (): ReportTeachingDiagnosis => ({
  keep: '',
  improve: '',
  stop: '',
  start: '',
});

export default function TeacherPortraitCollectionFill({
  isZh,
  years,
  yearId,
  term,
  onYearIdChange,
  onTermChange,
  preferLatestTaskKey = 0,
}: {
  isZh: boolean;
  years: AcademicYear[];
  yearId: string;
  term: Term;
  onYearIdChange: (id: string) => void;
  onTermChange: (t: Term) => void;
  /** 每次进入「教师发展」tab 递增，用于自动选中最近待办 */
  preferLatestTaskKey?: number;
}) {
  const [list, setList] = useState<TeacherPortraitCollectionTemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [diagnosis, setDiagnosis] = useState<ReportTeachingDiagnosis>(emptyDiagnosis());
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState<string>('published');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const lastPreferLatestTaskKeyRef = useRef(preferLatestTaskKey);
  const manualTemplatePickRef = useRef(false);

  const pickTemplateId = useCallback((open: TeacherPortraitCollectionTemplateSummary[]) => {
    const picked = pickPreferredPublishedTask(
      open.map((t) => ({
        id: t.id,
        publishedAt: t.publishedAt,
        updatedAt: t.updatedAt,
        isComplete: t.mySubmission?.hasContent === true,
      })),
    );
    return picked?.id ?? open[0]?.id ?? '';
  }, []);

  const loadList = useCallback(async () => {
    if (!USE_CLOUD_STORAGE || !yearId) {
      setList([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const templates = await api.getTeacherPortraitCollections({ academicYearId: yearId, term });
      const open = templates.filter((t) => t.status === 'published' || t.status === 'closed');
      setList(open);
      if (open.length === 0) {
        setSelectedId('');
        return;
      }
      const forcePrefer = preferLatestTaskKey !== lastPreferLatestTaskKeyRef.current;
      if (forcePrefer) {
        lastPreferLatestTaskKeyRef.current = preferLatestTaskKey;
        manualTemplatePickRef.current = false;
      }
      setSelectedId((prev) => {
        if (!forcePrefer && manualTemplatePickRef.current && prev && open.some((t) => t.id === prev)) {
          return prev;
        }
        if (!forcePrefer && prev && open.some((t) => t.id === prev)) {
          return prev;
        }
        return pickTemplateId(open) || open[0].id;
      });
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [yearId, term, preferLatestTaskKey, pickTemplateId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !selectedId) {
      setDiagnosis(emptyDiagnosis());
      setCanEdit(false);
      return;
    }
    let cancelled = false;
    setError(null);
    api
      .getTeacherPortraitCollection(selectedId)
      .then((data) => {
        if (cancelled) return;
        setDiagnosis(data.submission.diagnosis);
        setCanEdit(data.template.canEdit === true);
        setStatus(data.template.status);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message || 'Failed to load detail');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = list.find((t) => t.id === selectedId) ?? null;

  const handleSave = async () => {
    if (!selectedId || !canEdit) return;
    setSaving(true);
    setError(null);
    setSavedHint(null);
    try {
      await api.saveTeacherPortraitCollection(selectedId, { diagnosis });
      setSavedHint(isZh ? '已保存' : 'Saved');
      await loadList();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <AcademicYearTermFields
        isZh={isZh}
        years={years}
        yearId={yearId}
        term={term}
        onYearIdChange={(id) => {
          manualTemplatePickRef.current = false;
          onYearIdChange(id);
        }}
        onTermChange={(t) => {
          manualTemplatePickRef.current = false;
          onTermChange(t);
        }}
        allowEmptyYear
      />

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      {loading && <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>}

      {!loading && list.length === 0 && (
        <p className="text-sm text-slate-500">
          {isZh ? '当前学期暂无已发布的教师采集任务。' : 'No published teacher collections for this term.'}
        </p>
      )}

      {list.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {list.map((tpl) => (
              <Button
                key={tpl.id}
                size="sm"
                variant={tpl.id === selectedId ? 'default' : 'outline'}
                onClick={() => {
                  manualTemplatePickRef.current = true;
                  setSelectedId(tpl.id);
                }}
              >
                {tpl.title || teacherPortraitCollectionTypeLabel('teaching-diagnosis-kiss', isZh)}
                {tpl.mySubmission?.hasContent ? (isZh ? ' · 已填' : ' · Done') : ''}
              </Button>
            ))}
          </div>

          {selected && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {selected.title || teacherPortraitCollectionTypeLabel('teaching-diagnosis-kiss', isZh)}
                </h3>
                {status === 'closed' ? (
                  <p className="text-xs text-slate-500 mt-1">
                    {isZh ? '已截止（只读）' : 'Closed (read-only)'}
                  </p>
                ) : null}
              </div>
              <TeachingDiagnosisKissForm
                value={diagnosis}
                onChange={setDiagnosis}
                disabled={!canEdit}
                isZh={isZh}
              />
              <div className="flex items-center gap-3">
                <Button type="button" disabled={!canEdit || saving} onClick={() => void handleSave()}>
                  {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
                </Button>
                {savedHint && <span className="text-sm text-emerald-600">{savedHint}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
