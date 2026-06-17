import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import {
  ALL_SUBJECTS_PORTRAIT_GROUP_ID,
  type AcademicYear,
  type SubjectGroupDataSource,
  type SubjectGroupPortraitDashboard,
  type SubjectGroupPortraitSummary,
  type Term,
} from '../types/classManagement';
import {
  AcademicYearSelectField,
  FilterField,
  FilterSelect,
  FilterToolbar,
  TermSelectField,
} from './academicPeriodSelectors';
import type { TeacherPortraitSubjectDashboardSlice } from '../lib/teacherPortraitAIContext';
import TeachingDiagnosisKissDisplay from './TeachingDiagnosisKissDisplay';

type SourceOption = {
  key: string;
  dataSource: SubjectGroupDataSource;
  sourceId: string;
  title: string;
};

function parseSourceKey(key: string): { dataSource: SubjectGroupDataSource; sourceId: string } | null {
  const idx = key.indexOf('::');
  if (idx <= 0) return null;
  const type = key.slice(0, idx);
  const sourceId = key.slice(idx + 2);
  if ((type === 'report' || type === 'diagnosis') && sourceId) {
    return { dataSource: type, sourceId };
  }
  return null;
}

export default function TeacherPortraitSubjectGroupDashboard({
  isZh,
  isAdmin,
  years,
  yearId,
  onYearIdChange,
  onAIContextChange,
}: {
  isZh: boolean;
  isAdmin: boolean;
  years: AcademicYear[];
  yearId: string;
  onYearIdChange: (id: string) => void;
  onAIContextChange?: (slice: TeacherPortraitSubjectDashboardSlice | null) => void;
}) {
  const [term, setTerm] = useState<Term>('Semester 1');
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [groups, setGroups] = useState<SubjectGroupPortraitSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [dashboard, setDashboard] = useState<SubjectGroupPortraitDashboard | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedSource = useMemo(() => parseSourceKey(selectedSourceKey), [selectedSourceKey]);

  const loadGroups = useCallback(async () => {
    if (!USE_CLOUD_STORAGE || !yearId) {
      setGroups([]);
      setSelectedGroupId('');
      return;
    }
    setLoadingGroups(true);
    try {
      const data = await api.getPortraitSubjectGroups(yearId);
      setGroups(data.groups);
      setSelectedGroupId((prev) => {
        if (data.groups.length === 0) return '';
        if (prev && data.groups.some((g) => g.id === prev)) return prev;
        return data.groups[0].id;
      });
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load groups');
      setGroups([]);
      setSelectedGroupId('');
    } finally {
      setLoadingGroups(false);
    }
  }, [yearId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !yearId) {
      setSourceOptions([]);
      setSelectedSourceKey('');
      return;
    }
    let cancelled = false;
    setLoadingSources(true);
    (async () => {
      try {
        const [reportTemplates, diagnosisTemplates] = await Promise.all([
          isAdmin
            ? api.getAdminReportTemplates({ academicYearId: yearId, term })
            : api.getReportTemplatesForTerm(yearId, term),
          isAdmin
            ? api.getAdminTeacherPortraitTemplates({ academicYearId: yearId, term })
            : api.getTeacherPortraitCollections({ academicYearId: yearId, term }),
        ]);

        const reports = reportTemplates
          .filter((t) => (t.status === 'published' || t.status === 'closed') && t.id)
          .map((t) => ({
            key: `report::${t.id}`,
            dataSource: 'report' as const,
            sourceId: t.id!,
            title: isZh
              ? `学业报告 · ${(t.title ?? '').trim() || '未命名'}`
              : `Report · ${(t.title ?? '').trim() || 'Untitled'}`,
          }));

        const diagnoses = diagnosisTemplates
          .filter((t) => t.status === 'published' || t.status === 'closed')
          .map((t) => ({
            key: `diagnosis::${t.id}`,
            dataSource: 'diagnosis' as const,
            sourceId: t.id,
            title: isZh
              ? `教学诊断 · ${(t.title ?? '').trim() || '未命名'}`
              : `Diagnosis · ${(t.title ?? '').trim() || 'Untitled'}`,
          }));

        const options = [...reports, ...diagnoses];
        if (!cancelled) {
          setSourceOptions(options);
          setSelectedSourceKey((prev) => {
            if (options.length === 0) return '';
            if (prev && options.some((o) => o.key === prev)) return prev;
            return options[0].key;
          });
        }
      } catch {
        if (!cancelled) {
          setSourceOptions([]);
          setSelectedSourceKey('');
        }
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [yearId, term, isAdmin, isZh]);

  const showGroupSelector = isAdmin || groups.length > 1;
  const effectiveGroupId = showGroupSelector ? selectedGroupId : groups[0]?.id ?? '';
  const isAllSubjectsView = effectiveGroupId === ALL_SUBJECTS_PORTRAIT_GROUP_ID;

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !yearId || !effectiveGroupId || !parsedSource) {
      setDashboard(null);
      return;
    }
    let cancelled = false;
    setLoadingDashboard(true);
    setError(null);
    api
      .getSubjectGroupPortraitDashboard({
        groupId: effectiveGroupId,
        academicYearId: yearId,
        term,
        dataSource: parsedSource.dataSource,
        sourceId: parsedSource.sourceId,
      })
      .then((data) => {
        if (!cancelled) {
          setDashboard(data);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError((e as Error)?.message || 'Failed to load dashboard');
          setDashboard(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDashboard(false);
      });
    return () => {
      cancelled = true;
    };
  }, [yearId, effectiveGroupId, term, parsedSource?.dataSource, parsedSource?.sourceId]);

  const activeDataSource = dashboard?.dataSource ?? parsedSource?.dataSource ?? 'report';

  const groupName = useMemo(() => {
    if (!dashboard) {
      const g = groups.find((x) => x.id === effectiveGroupId);
      if (!g) return '';
      return isZh ? g.nameZh : g.nameEn || g.nameZh;
    }
    return isZh ? dashboard.group.nameZh : dashboard.group.nameEn || dashboard.group.nameZh;
  }, [dashboard, groups, effectiveGroupId, isZh]);

  const diagnosisMembers = useMemo(
    () => dashboard?.members ?? [],
    [dashboard],
  );

  const diagnosisSubmittedCount = useMemo(
    () => diagnosisMembers.filter((m) => m.diagnosisHasContent).length,
    [diagnosisMembers],
  );

  useEffect(() => {
    if (!onAIContextChange) return;
    if (!yearId || !effectiveGroupId || !parsedSource) {
      onAIContextChange(null);
      return;
    }
    const selectedGroup = groups.find((g) => g.id === effectiveGroupId);
    const sourceOpt = sourceOptions.find((o) => o.key === selectedSourceKey);
    onAIContextChange({
      term,
      dataSource: parsedSource.dataSource,
      sourceTitle: dashboard?.sourceTitle ?? sourceOpt?.title ?? null,
      groupName:
        groupName ||
        (selectedGroup ? (isZh ? selectedGroup.nameZh : selectedGroup.nameEn || selectedGroup.nameZh) : ''),
      subjectLabels: dashboard?.group.subjectLabels ?? selectedGroup?.subjectLabels ?? [],
      memberCount: dashboard?.group.memberCount ?? selectedGroup?.memberCount ?? 0,
      dashboard,
      loading: loadingDashboard || loadingGroups || loadingSources,
    });
  }, [
    onAIContextChange,
    yearId,
    effectiveGroupId,
    parsedSource,
    term,
    selectedSourceKey,
    sourceOptions,
    groups,
    dashboard,
    loadingDashboard,
    loadingGroups,
    loadingSources,
    groupName,
    isZh,
  ]);

  if (!USE_CLOUD_STORAGE) {
    return (
      <p className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
        {isZh ? '学科看板需开启云端存储并联调 API。' : 'Subject dashboard requires cloud storage.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <FilterToolbar>
        <AcademicYearSelectField isZh={isZh} years={years} value={yearId} onChange={onYearIdChange} />
        <TermSelectField isZh={isZh} value={term} onChange={setTerm} />
        <FilterField label={isZh ? '报告 / 诊断' : 'Report / diagnosis'}>
          <FilterSelect
            value={selectedSourceKey}
            onChange={(e) => setSelectedSourceKey(e.target.value)}
            disabled={loadingSources || sourceOptions.length === 0}
          >
            {sourceOptions.length === 0 ? (
              <option value="">{isZh ? '暂无可用任务' : 'No tasks'}</option>
            ) : (
              sourceOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.title}
                </option>
              ))
            )}
          </FilterSelect>
        </FilterField>
        {showGroupSelector ? (
          <FilterField label={isZh ? '学科组' : 'Subject group'}>
            <FilterSelect
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              disabled={loadingGroups || groups.length === 0}
            >
              {groups.length === 0 ? (
                <option value="">{isZh ? '暂无学科组' : 'No groups'}</option>
              ) : (
                groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {isZh ? g.nameZh : g.nameEn || g.nameZh}
                  </option>
                ))
              )}
            </FilterSelect>
          </FilterField>
        ) : null}
      </FilterToolbar>

      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      ) : null}

      {loadingGroups ? (
        <p className="text-sm text-slate-500">{isZh ? '加载学科组…' : 'Loading groups…'}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500">
          {isZh
            ? '您当前不是任何学科组的组长，暂无学科看板。'
            : 'You are not assigned as a subject group lead.'}
        </p>
      ) : loadingDashboard ? (
        <p className="text-sm text-slate-500">{isZh ? '加载看板数据…' : 'Loading dashboard…'}</p>
      ) : dashboard ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <h2 className="text-lg font-semibold text-slate-900">{groupName}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {dashboard.group.subjectLabels.join(isZh ? '、' : ', ') || '—'}
              {dashboard.sourceTitle ? (
                <span className="text-slate-400">
                  {' '}
                  · {dashboard.sourceTitle}
                </span>
              ) : null}
              <span className="text-slate-400 ml-2">
                ·{' '}
                {isAllSubjectsView
                  ? isZh
                    ? `全校 ${dashboard.group.memberCount} 位任课教师`
                    : `${dashboard.group.memberCount} teachers school-wide`
                  : isZh
                    ? `${dashboard.group.memberCount} 人`
                    : `${dashboard.group.memberCount} members`}
              </span>
            </p>
          </div>

          {activeDataSource === 'diagnosis' ? (
            diagnosisMembers.length === 0 ? (
              <p className="text-sm text-slate-500">
                {isZh
                  ? '当前所选教学诊断下暂无学科组人员，请确认学科组成员配置。'
                  : 'No subject group members for the selected diagnosis.'}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  {isZh
                    ? `已提交诊断 ${diagnosisSubmittedCount}/${diagnosisMembers.length}`
                    : `Submitted ${diagnosisSubmittedCount}/${diagnosisMembers.length}`}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {diagnosisMembers.map((member) => {
                    const subjectLabels = [
                      ...new Set(member.assignments.map((a) => a.subjectName)),
                    ].sort((a, b) => a.localeCompare(b, 'zh'));
                    return (
                      <div
                        key={member.teacherId}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-2 min-w-0"
                      >
                        <div className="text-sm font-semibold text-slate-900">{member.teacherName}</div>
                        {subjectLabels.length > 0 ? (
                          <p
                            className="text-[11px] text-slate-500 leading-tight"
                            title={subjectLabels.join(isZh ? '、' : ', ')}
                          >
                            {subjectLabels.join(isZh ? '、' : ', ')}
                          </p>
                        ) : null}
                        {member.diagnosisHasContent && member.diagnosis ? (
                          <TeachingDiagnosisKissDisplay value={member.diagnosis} isZh={isZh} />
                        ) : (
                          <p className="text-sm text-slate-400">{isZh ? '未提交' : 'Not submitted'}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ) : dashboard.gradeRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {isZh
                ? '当前所选报告下暂无班级质量数据，请确认岗位安排、学科组配置与报告成绩已录入。'
                : 'No class quality data for the selected report.'}
            </p>
          ) : (
            <div className="space-y-2">
              {dashboard.gradeRows.map((row) => (
                <div
                  key={row.grade}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2"
                >
                  <div className="flex items-stretch gap-2 min-w-0">
                    <div className="flex flex-col items-center justify-center shrink-0 border-r border-slate-200/90 pr-2 min-w-[3.25rem] text-center py-1">
                      <span className="inline-flex items-center justify-center rounded-md bg-indigo-100 text-indigo-800 px-2 py-0.5 text-base font-semibold whitespace-nowrap">
                        {row.gradeLabel}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 flex items-stretch gap-1.5 overflow-x-auto py-0.5">
                      {row.classes.map((cell) => (
                        <div
                          key={cell.classId}
                          className="shrink-0 min-w-[7.5rem] max-w-[9.5rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 space-y-1"
                        >
                          <div className="text-sm font-semibold text-slate-800 leading-tight text-center">
                            {cell.className}
                          </div>
                          <div className="space-y-0.5">
                            {cell.subjectScores.map((line) => (
                              <div
                                key={`${cell.classId}::${line.subjectKey}`}
                                className="flex items-baseline justify-between gap-1 text-sm leading-tight"
                              >
                                <span
                                  className="text-slate-500 truncate shrink min-w-0"
                                  title={line.subjectName}
                                >
                                  {line.subjectName}
                                </span>
                                <span className="font-bold text-emerald-600 tabular-nums shrink-0">
                                  {line.avgScore == null ? '—' : line.avgScore}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col justify-center gap-0.5 shrink-0 border-l border-slate-200/90 pl-2 min-w-[5.5rem] max-w-[7rem] py-1">
                      {row.subjectAverages.length > 0 ? (
                        row.subjectAverages.map((line) => (
                          <div
                            key={`avg::${line.subjectKey}`}
                            className="flex items-baseline justify-between gap-1 text-sm leading-tight"
                          >
                            <span
                              className="text-slate-500 truncate min-w-0"
                              title={line.subjectName}
                            >
                              {line.subjectName}
                            </span>
                            <span className="font-bold text-emerald-600 tabular-nums shrink-0">
                              {line.avgScore == null ? '—' : line.avgScore}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 text-center">—</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
