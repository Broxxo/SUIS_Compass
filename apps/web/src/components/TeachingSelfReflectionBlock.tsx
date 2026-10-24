import { useCallback, useEffect, useState } from 'react';
import { sortPublishedTasksNewestFirst, teacherPortraitCollectionTypeLabel, templateIncludesKiss, type TeacherCollectionBlock } from '@repo/shared';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import type { ReportTeachingDiagnosis, Term } from '../types/classManagement';
import TeacherCollectionAnswerForm from './TeacherCollectionAnswerForm';
import TeachingDiagnosisKissDisplay from './TeachingDiagnosisKissDisplay';

type ReflectionItem = {
  id: string;
  title: string | null;
  status: string;
  formBlocks: TeacherCollectionBlock[] | null;
  diagnosis: ReportTeachingDiagnosis;
  textAnswers: Record<string, string>;
  hasContent: boolean;
  updatedAt: string | null;
};

export default function TeachingSelfReflectionBlock({
  isZh,
  yearId,
  term,
  teacherId,
}: {
  isZh: boolean;
  yearId: string;
  term: Term;
  /** 管理员查看指定教师时传入 */
  teacherId?: string;
}) {
  const [items, setItems] = useState<ReflectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReflection = useCallback(async () => {
    if (!USE_CLOUD_STORAGE || !yearId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setItems([]);
    setError(null);
    try {
      const templates = teacherId
        ? await api.getAdminTeacherPortraitTemplates({ academicYearId: yearId, term })
        : await api.getTeacherPortraitCollections({ academicYearId: yearId, term });
      const open = templates.filter((t) => {
        if (t.status !== 'published' && t.status !== 'closed') return false;
        return teacherId ? true : templateIncludesKiss(t);
      });
      const sortedTemplates = sortPublishedTasksNewestFirst(
        open.map((t) => ({
          tpl: t,
          id: t.id,
          publishedAt: t.publishedAt,
          updatedAt: t.updatedAt,
          isComplete: false,
        })),
      ).map((row) => row.tpl);

      const entries = await Promise.all(
        sortedTemplates.map(async (tpl): Promise<ReflectionItem | null> => {
          if (teacherId) {
            const submissions = await api.getAdminTeacherPortraitTemplateSubmissions(tpl.id);
            const submission = submissions.find((row) => row.teacherId === teacherId);
            if (!submission) return null;
            return {
              id: tpl.id,
              title: tpl.title,
              status: tpl.status,
              formBlocks: tpl.formBlocks ?? null,
              diagnosis: submission.diagnosis,
              textAnswers: submission.textAnswers ?? {},
              hasContent: submission.hasContent,
              updatedAt: submission.updatedAt,
            } satisfies ReflectionItem;
          }
          const data = await api.getTeacherPortraitCollection(tpl.id);
          return {
            id: tpl.id,
            title: data.template.title,
            status: data.template.status,
            formBlocks: data.template.formBlocks ?? null,
            diagnosis: data.submission.diagnosis,
            textAnswers: data.submission.textAnswers ?? {},
            hasContent: data.submission.hasContent,
            updatedAt: data.submission.updatedAt,
          } satisfies ReflectionItem;
        }),
      );
      setItems(entries.filter((item): item is ReflectionItem => item != null));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load diagnosis');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [yearId, term, teacherId]);

  useEffect(() => {
    void loadReflection();
  }, [loadReflection]);

  const hasUnfilled = !teacherId && items.some((item) => !item.hasContent);

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      {loading && <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-500">
          {teacherId
            ? isZh
              ? '这个学期没有向这位教师发布的任务。'
              : 'No published task for this teacher this term.'
            : isZh
              ? '当前学期暂无已发布的教学诊断采集任务。'
              : 'No published teaching diagnosis collection for this term.'}
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-5">
          {items.map((item, idx) => (
            <div key={item.id} className={idx > 0 ? 'pt-5 border-t border-slate-100' : ''}>
              <p className="text-xs text-slate-500 mb-3">
                {item.title || teacherPortraitCollectionTypeLabel('teaching-diagnosis-kiss', isZh)}
                {teacherId ? '' : ' · KISS'}
                {item.status === 'closed' ? (isZh ? ' · 已截止' : ' · Closed') : ''}
                {item.hasContent
                  ? isZh
                    ? ' · 已提交'
                    : ' · Submitted'
                  : isZh
                    ? ' · 未提交'
                    : ' · Not submitted'}
                {item.hasContent && item.updatedAt
                  ? ` · ${new Date(item.updatedAt).toLocaleString(isZh ? 'zh-CN' : undefined)}`
                  : ''}
              </p>
              {teacherId ? (
                item.hasContent ? (
                  <TeacherCollectionAnswerForm
                    blocks={item.formBlocks}
                    diagnosis={item.diagnosis}
                    textAnswers={item.textAnswers}
                    onDiagnosisChange={() => {}}
                    onTextAnswerChange={() => {}}
                    disabled
                    isZh={isZh}
                  />
                ) : null
              ) : (
                <TeachingDiagnosisKissDisplay value={item.diagnosis} isZh={isZh} />
              )}
            </div>
          ))}
          {hasUnfilled && (
            <p className="text-xs text-slate-500">
              {isZh ? '如需填写或修改，请前往「教师发展」。' : 'To fill or edit, go to Teacher development.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
