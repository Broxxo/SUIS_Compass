import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAIContext } from '../contexts/AIContext';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import { latestAcademicYear, useTermForYear } from '../lib/academicPeriodDefault';
import {
  loadAcademicYears,
  loadAllClasses,
  loadStudents,
  loadEnrollments,
} from '../lib/classStorage';
import { loadGradeConfigSync } from '../lib/storage';
import { normalizeGradeConfig } from '../lib/gradeConfig';
import {
  buildClassCompletionRows,
  buildSubjectDistribution,
  buildTeachersBySegment,
  buildTeacherWorkload,
  maxCountForBars,
  teachersFromStaffing,
} from '../lib/teacherPortraitStats';
import type {
  AcademicYear,
  ClassItem,
  EvaluationTemplateSummary,
  ReportTemplateProgress,
  StaffingAssignment,
  Term,
} from '../types/classManagement';
import TeacherPortraitCollectionFill from './TeacherPortraitCollectionFill';
import TeacherPortraitPersonalDashboard from './TeacherPortraitPersonalDashboard';
import TeacherPortraitAdminPersonalDashboard from './TeacherPortraitAdminPersonalDashboard';
import TeacherPortraitSubjectGroupDashboard from './TeacherPortraitSubjectGroupDashboard';
import { AcademicYearSelect } from './academicPeriodSelectors';
import {
  buildTeacherPortraitAIPayload,
  type TeacherPortraitSubjectDashboardSlice,
} from '../lib/teacherPortraitAIContext';
import {
  buildSubjectScoreScalesForReportDashboard,
  type ReportSubjectScoreScaleSet,
} from '../lib/studentPortraitOverview';

type PortraitTab = 'school' | 'dashboard' | 'subject' | 'collections';

function HorizontalBarChart({
  rows,
  maxValue,
  label,
  value,
  valueSuffix = '',
  isZh,
}: {
  rows: Array<{ key: string; label: string; value: number; hint?: string }>;
  maxValue: number;
  label: string;
  value: (r: { value: number }) => number;
  valueSuffix?: string;
  isZh: boolean;
}) {
  return (
    <div className="space-y-2.5" aria-label={label}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{isZh ? '暂无数据' : 'No data'}</p>
      ) : (
        rows.map((row) => {
          const v = value(row);
          const pct = Math.round((v / maxValue) * 100);
          return (
            <div key={row.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-700 font-medium truncate" title={row.label}>
                  {row.label}
                </span>
                <span className="text-slate-500 tabular-nums shrink-0">
                  {v}
                  {valueSuffix}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all"
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>
              {row.hint ? <p className="text-[11px] text-slate-500 truncate">{row.hint}</p> : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div className={`rounded-xl border p-4 bg-gradient-to-br ${accent}`}>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 tabular-nums mt-1">{value}</div>
      {sub ? <div className="text-[11px] text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

export default function TeacherPortrait({
  onBackToHub,
  initialTab,
  initialYearId,
  initialTerm,
  initialCollectionTemplateId,
  isAIOpen = false,
  onToggleAI,
}: {
  onBackToHub: () => void;
  initialTab?: PortraitTab;
  initialYearId?: string;
  initialTerm?: Term;
  initialCollectionTemplateId?: string;
  isAIOpen?: boolean;
  onToggleAI?: () => void;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { setContextFromApp } = useAIContext();
  const isZh = language === 'zh';
  const isAdmin = user?.role === 'system-admin' || user?.role === 'admin';

  const [tab, setTab] = useState<PortraitTab>(initialTab ?? (isAdmin ? 'school' : 'dashboard'));
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState<string>('');
  const { term: fillTerm, setTerm: setFillTerm } = useTermForYear(
    yearId,
    initialYearId,
    initialTerm,
  );
  const [collectionsVisitSeq, setCollectionsVisitSeq] = useState(0);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [teachers, setTeachers] = useState<Array<{ id: string; primarySubject?: string | null }>>([]);
  const [assignments, setAssignments] = useState<StaffingAssignment[]>([]);
  const [reportTemplates, setReportTemplates] = useState<EvaluationTemplateSummary[]>([]);
  const [reportProgress, setReportProgress] = useState<ReportTemplateProgress | null>(null);
  const [myAssignments, setMyAssignments] = useState<
    Array<{ classId: string; subjectKey: string; subjectName?: string }>
  >([]);
  const [canViewSubjectDashboard, setCanViewSubjectDashboard] = useState(false);
  const [subjectDashboardSlice, setSubjectDashboardSlice] = useState<TeacherPortraitSubjectDashboardSlice | null>(
    null,
  );
  const [subjectDashboardScoreScaleSet, setSubjectDashboardScoreScaleSet] =
    useState<ReportSubjectScoreScaleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      loadAcademicYears(),
      loadAllClasses(),
      loadStudents(),
      loadEnrollments(),
    ])
      .then(async ([y, cls, , enrollments]) => {
        if (cancelled) return;
        setYears(y);
        const yid = initialYearId || latestAcademicYear(y)?.id || '';
        setYearId(yid);
        setClasses(cls);
        const yearClassIds = new Set(cls.filter((c) => c.academicYearId === yid).map((c) => c.id));
        const count = new Set(
          enrollments.filter((e) => e.academicYearId === yid && yearClassIds.has(e.classId)).map((e) => e.studentId),
        ).size;
        setStudentCount(count);

        if (!USE_CLOUD_STORAGE || !yid) {
          setAssignments([]);
          setTeachers([]);
          setReportTemplates([]);
          setReportProgress(null);
          setMyAssignments([]);
          setCanViewSubjectDashboard(false);
          return;
        }

        if (isAdmin) {
          const [staff, users, templates] = await Promise.all([
            api.getAdminStaffingAssignments(yid),
            api.getAllUsers('staff'),
            api.getAdminReportTemplates({ academicYearId: yid }),
          ]);
          if (cancelled) return;
          setAssignments(staff);
          setTeachers(
            users
              .filter((u) => u.role === 'teacher')
              .map((u) => ({ id: u.id, primarySubject: u.primarySubject ?? null })),
          );
          setReportTemplates(templates);
          const active = templates.find((t) => t.status === 'published') ?? templates[0];
          if (active?.id) {
            const progress = await api.getAdminReportTemplateProgress(active.id);
            if (!cancelled) setReportProgress(progress);
          } else {
            setReportProgress(null);
          }
          const subjectGroups = await api.getPortraitSubjectGroups(yid).catch(() => ({ groups: [], isAdmin: true }));
          if (!cancelled) setCanViewSubjectDashboard(subjectGroups.groups.length > 0 || isAdmin);
        } else if (user?.role === 'teacher') {
          const [mine, subjectGroups] = await Promise.all([
            api.getMySubjectAssignments(yid),
            api.getPortraitSubjectGroups(yid).catch(() => ({ groups: [], isAdmin: false })),
          ]);
          if (!cancelled) {
            setMyAssignments(mine);
            setCanViewSubjectDashboard(subjectGroups.groups.length > 0);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message || 'Failed to load teacher portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, user?.role, initialYearId]);

  useEffect(() => {
    if (tab === 'collections') {
      setCollectionsVisitSeq((s) => s + 1);
    }
  }, [tab]);

  useEffect(() => {
    if (!isAdmin || !USE_CLOUD_STORAGE || !yearId) return;
    let cancelled = false;
    Promise.all([
      api.getAdminStaffingAssignments(yearId),
      api.getAdminReportTemplates({ academicYearId: yearId }),
    ])
      .then(async ([staff, templates]) => {
        if (cancelled) return;
        setAssignments(staff);
        setReportTemplates(templates);
        const active = templates.find((t) => t.status === 'published') ?? templates[0];
        if (active?.id) {
          const progress = await api.getAdminReportTemplateProgress(active.id);
          if (!cancelled) setReportProgress(progress);
        } else {
          setReportProgress(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message || 'Failed to refresh');
      });
    return () => {
      cancelled = true;
    };
  }, [yearId, isAdmin]);

  useEffect(() => {
    if (isAdmin || user?.role !== 'teacher' || !USE_CLOUD_STORAGE || !yearId) return;
    let cancelled = false;
    api
      .getMySubjectAssignments(yearId)
      .then((mine) => {
        if (!cancelled) setMyAssignments(mine);
      })
      .catch(() => {
        if (!cancelled) setMyAssignments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [yearId, isAdmin, user?.role]);

  useEffect(() => {
    if (isAdmin || user?.role !== 'teacher' || !USE_CLOUD_STORAGE || !yearId) return;
    let cancelled = false;
    api
      .getPortraitSubjectGroups(yearId)
      .then((data) => {
        if (!cancelled) setCanViewSubjectDashboard(data.groups.length > 0);
      })
      .catch(() => {
        if (!cancelled) setCanViewSubjectDashboard(false);
      });
    return () => {
      cancelled = true;
    };
  }, [yearId, isAdmin, user?.role]);

  const yearClasses = useMemo(
    () => classes.filter((c) => c.academicYearId === yearId),
    [classes, yearId],
  );
  const classById = useMemo(() => new Map(yearClasses.map((c) => [c.id, c] as const)), [yearClasses]);

  const primarySubjectByTeacher = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const t of teachers) m.set(t.id, t.primarySubject ?? null);
    return m;
  }, [teachers]);

  const subjectDistribution = useMemo(() => buildSubjectDistribution(assignments), [assignments]);
  const teacherWorkload = useMemo(
    () => buildTeacherWorkload(assignments, primarySubjectByTeacher),
    [assignments, primarySubjectByTeacher],
  );
  const classCompletion = useMemo(() => buildClassCompletionRows(reportProgress), [reportProgress]);
  const staffingTeacherCount = useMemo(() => teachersFromStaffing(assignments).size, [assignments]);

  const gradeConfig = useMemo(() => normalizeGradeConfig(loadGradeConfigSync()), []);

  useEffect(() => {
    const sd = subjectDashboardSlice;
    if (
      !USE_CLOUD_STORAGE ||
      !sd ||
      sd.loading ||
      sd.dataSource !== 'report' ||
      !sd.dashboard?.sourceId ||
      !yearId ||
      !sd.dashboard.gradeRows.length
    ) {
      setSubjectDashboardScoreScaleSet(null);
      return;
    }
    let cancelled = false;
    const templateId = sd.dashboard.sourceId;
    const reportLabel = sd.sourceTitle ?? sd.dashboard.sourceTitle ?? '';
    Promise.all([
      api.getTeacherReportYearDimensionExamPreset(yearId),
      api.getReportTemplateById(templateId),
    ])
      .then(([preset, template]) => {
        if (cancelled) return;
        setSubjectDashboardScoreScaleSet(
          buildSubjectScoreScalesForReportDashboard({
            template,
            examPreset: preset,
            gradeConfig,
            gradeRows: sd.dashboard!.gradeRows,
            reportLabel,
            term: sd.term,
            templateTitle: template.title ?? null,
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setSubjectDashboardScoreScaleSet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectDashboardSlice, yearId, gradeConfig]);

  const teachersBySegment = useMemo(
    () => buildTeachersBySegment(assignments, classById, gradeConfig),
    [assignments, classById, gradeConfig],
  );
  const segmentBarMax = maxCountForBars(teachersBySegment, (r) => r.teacherCount);
  const workloadBarMax = maxCountForBars(teacherWorkload.slice(0, 10), (r) => r.slots);
  const attentionClasses = classCompletion.filter((c) => c.completionRate < 85 && c.totalStudents > 0).slice(0, 8);

  const activeReport = reportTemplates.find((t) => t.status === 'published') ?? reportTemplates[0];

  const academicYearName = useMemo(
    () => years.find((y) => y.id === yearId)?.name ?? null,
    [years, yearId],
  );

  const personalAssignments = useMemo(() => {
    const byClass = new Map<string, { className: string; grade: number; subjects: string[] }>();
    for (const a of myAssignments) {
      const cls = classById.get(a.classId);
      if (!cls) continue;
      let row = byClass.get(a.classId);
      if (!row) {
        row = { className: cls.name, grade: cls.grade, subjects: [] };
        byClass.set(a.classId, row);
      }
      const subj = (a.subjectName || a.subjectKey).trim();
      if (subj && !row.subjects.includes(subj)) row.subjects.push(subj);
    }
    return [...byClass.values()].sort((a, b) => a.grade - b.grade || a.className.localeCompare(b.className));
  }, [myAssignments, classById]);

  const schoolStatsForAI = useMemo(
    () => ({
      teacherCount: teachers.length,
      staffingTeacherCount,
      classCount: yearClasses.length,
      studentCount,
      subjectCount: subjectDistribution.length,
      reportTitle: activeReport?.title ?? null,
      completionRate: reportProgress?.completionRate ?? null,
      completedStudents: reportProgress?.completedStudents ?? null,
      totalStudents: reportProgress?.totalStudents ?? null,
      pendingStudents: reportProgress?.pendingStudents ?? null,
      attentionClasses: attentionClasses.map((c) => ({
        className: c.className,
        completionRate: c.completionRate,
        pendingStudents: c.pendingStudents,
      })),
    }),
    [
      teachers.length,
      staffingTeacherCount,
      yearClasses.length,
      studentCount,
      subjectDistribution.length,
      activeReport?.title,
      reportProgress,
      attentionClasses,
    ],
  );

  const teacherPortraitAIPayload = useMemo(
    () =>
      buildTeacherPortraitAIPayload({
        tab,
        isAdmin,
        isZh,
        academicYearName,
        term: fillTerm,
        schoolStats: schoolStatsForAI,
        personalAssignments,
        subjectDashboard: subjectDashboardSlice,
        subjectScoreScaleSet: subjectDashboardScoreScaleSet,
        tabLabels: {
          school: isZh ? '学校看板' : 'School dashboard',
          subject: isZh ? '学科看板' : 'Subject dashboard',
          personal: isZh ? '个人看板' : 'Personal dashboard',
          collections: isZh ? '教师发展' : 'Teacher development',
        },
      }),
    [
      tab,
      isAdmin,
      isZh,
      academicYearName,
      fillTerm,
      schoolStatsForAI,
      personalAssignments,
      subjectDashboardSlice,
      subjectDashboardScoreScaleSet,
    ],
  );

  useEffect(() => {
    if (!onToggleAI) return;
    setContextFromApp('teacher-portrait', teacherPortraitAIPayload);
  }, [teacherPortraitAIPayload, setContextFromApp, onToggleAI]);

  return (
    <div className={`${onToggleAI ? 'h-full min-h-0 max-md:h-auto max-md:min-h-dvh' : 'min-h-screen'} flex w-full flex-col overflow-x-auto bg-slate-50 pt-[var(--app-topbar-height)]`}>
      <AppTopBar
        title={isZh ? '教师中心' : 'Teacher Center'}
        showBack
        onBack={onBackToHub}
        rightChildren={
          onToggleAI ? (
            <Button
              variant={isAIOpen ? 'default' : 'outline'}
              size="icon"
              onClick={onToggleAI}
              className="h-[var(--app-topbar-control)] w-[var(--app-topbar-control)] rounded-lg flex-shrink-0"
              title="AI"
            >
              <Bot className="h-4 w-4" />
            </Button>
          ) : undefined
        }
      />
      <main className="mx-auto w-full min-h-0 max-w-6xl flex-1 space-y-4 overflow-auto px-4 py-6">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          {isAdmin ? (
            <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex gap-1">
              <Button variant={tab === 'school' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('school')}>
                {isZh ? '学校看板' : 'School dashboard'}
              </Button>
              {canViewSubjectDashboard ? (
                <Button variant={tab === 'subject' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('subject')}>
                  {isZh ? '学科看板' : 'Subject dashboard'}
                </Button>
              ) : null}
              <Button variant={tab === 'dashboard' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('dashboard')}>
                {isZh ? '个人看板' : 'Personal dashboard'}
              </Button>
            </div>
          ) : user?.role === 'teacher' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex gap-1">
              {canViewSubjectDashboard ? (
                <Button variant={tab === 'subject' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('subject')}>
                  {isZh ? '学科看板' : 'Subject dashboard'}
                </Button>
              ) : null}
              <Button
                variant={tab === 'dashboard' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTab('dashboard')}
              >
                {isZh ? '个人看板' : 'Personal dashboard'}
              </Button>
              <Button
                variant={tab === 'collections' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTab('collections')}
              >
                {isZh ? '教师发展' : 'Teacher development'}
              </Button>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex gap-1">
              <Button variant="default" size="sm" disabled>
                {isZh ? '学科看板' : 'Subject dashboard'}
              </Button>
            </div>
          )}
          {isAdmin && tab !== 'dashboard' && tab !== 'subject' && (
            <AcademicYearSelect
              isZh={isZh}
              years={years}
              value={yearId}
              onChange={setYearId}
              className="py-1.5"
            />
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}
        {!USE_CLOUD_STORAGE && !loading && (
          <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            {isZh
              ? '教师画像需开启云端存储（VITE_USE_CLOUD_STORAGE=true）并联调岗位安排与学业报告 API。'
              : 'Teacher portrait requires cloud storage and staffing/report APIs.'}
          </div>
        )}

        {loading && <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>}

        {!loading && tab === 'school' && isAdmin && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                label={isZh ? '专任教师' : 'Teachers'}
                value={teachers.length}
                sub={isZh ? `本学年有岗位 ${staffingTeacherCount} 人` : `${staffingTeacherCount} with assignments`}
                accent="from-rose-50 to-white border-rose-100"
              />
              <KpiCard
                label={isZh ? '班级' : 'Classes'}
                value={yearClasses.length}
                accent="from-pink-50 to-white border-pink-100"
              />
              <KpiCard
                label={isZh ? '学生' : 'Students'}
                value={studentCount}
                accent="from-fuchsia-50 to-white border-fuchsia-100"
              />
              <KpiCard
                label={isZh ? '学科（任课）' : 'Subjects taught'}
                value={subjectDistribution.length}
                accent="from-violet-50 to-white border-violet-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      {isZh ? '学业报告完成度' : 'Report completion'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {activeReport?.title || (isZh ? '暂无已发布模板' : 'No published template')}
                    </p>
                  </div>
                  {reportProgress ? (
                    <div className="text-right">
                      <div className="text-2xl font-bold text-rose-600 tabular-nums">{reportProgress.completionRate}%</div>
                      <div className="text-[11px] text-slate-500">
                        {reportProgress.completedStudents}/{reportProgress.totalStudents}
                      </div>
                    </div>
                  ) : null}
                </div>
                {reportProgress ? (
                  <>
                    <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                        style={{ width: `${Math.min(100, reportProgress.completionRate)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {isZh
                        ? `仍有 ${reportProgress.pendingStudents} 名学生未达「全班完成」标准（含学科与班主任模块）。`
                        : `${reportProgress.pendingStudents} students not yet fully complete.`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">{isZh ? '暂无进度数据' : 'No progress data'}</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  {isZh ? '各学段任课教师人数' : 'Teachers by school segment'}
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  {isZh
                    ? '按岗位安排统计：在该学段有任教学科岗位的教师（跨学段可重复计数）。'
                    : 'Teachers with subject assignments in each segment (may count twice across segments).'}
                </p>
                {teachersBySegment.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {isZh ? '请先在后台「学校设置」配置学段与年级' : 'Configure segments in Admin → School settings'}
                  </p>
                ) : (
                  <HorizontalBarChart
                    isZh={isZh}
                    label={isZh ? '学段教师人数' : 'Teachers by segment'}
                    maxValue={segmentBarMax}
                    value={(r) => r.value}
                    valueSuffix={isZh ? ' 人' : ''}
                    rows={teachersBySegment.map((s) => ({
                      key: s.segmentId,
                      label: s.segmentLabel,
                      value: s.teacherCount,
                    }))}
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                {isZh ? '教师任课负荷 TOP' : 'Top teaching load'}
              </h3>
              <HorizontalBarChart
                isZh={isZh}
                label={isZh ? '任课负荷' : 'Load'}
                maxValue={workloadBarMax}
                value={(r) => r.value}
                valueSuffix={isZh ? ' 班科' : ' slots'}
                rows={teacherWorkload.slice(0, 10).map((t) => ({
                  key: t.teacherId,
                  label: t.teacherName,
                  value: t.slots,
                  hint: t.primarySubject || undefined,
                }))}
              />
            </div>

            {attentionClasses.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <h3 className="text-sm font-semibold text-amber-900 mb-2">
                  {isZh ? '待关注班级（完成率 < 85%）' : 'Classes needing attention (<85%)'}
                </h3>
                <ul className="grid sm:grid-cols-2 gap-2 text-sm text-amber-950">
                  {attentionClasses.map((c) => (
                    <li key={c.classId} className="flex justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 border border-amber-100">
                      <span>{c.className}</span>
                      <span className="tabular-nums">
                        {c.completionRate}% · {isZh ? '待完成' : 'pending'} {c.pendingStudents}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!loading && tab === 'subject' && canViewSubjectDashboard && (
          <TeacherPortraitSubjectGroupDashboard
            isZh={isZh}
            isAdmin={isAdmin}
            years={years}
            yearId={yearId}
            onYearIdChange={setYearId}
            onAIContextChange={setSubjectDashboardSlice}
          />
        )}

        {!loading && tab === 'dashboard' && isAdmin && (
          <TeacherPortraitAdminPersonalDashboard
            isZh={isZh}
            years={years}
            yearId={yearId}
            onYearIdChange={setYearId}
            assignments={assignments}
            classById={classById}
            teachers={teachers}
          />
        )}

        {!loading && !isAdmin && user?.role === 'teacher' && tab === 'dashboard' && (
          <TeacherPortraitPersonalDashboard
            isZh={isZh}
            years={years}
            yearId={yearId}
            term={fillTerm}
            myAssignments={myAssignments}
            classById={classById}
            onYearIdChange={setYearId}
            onTermChange={setFillTerm}
          />
        )}

        {!loading && !isAdmin && user?.role === 'teacher' && tab === 'collections' && (
          <TeacherPortraitCollectionFill
            isZh={isZh}
            years={years}
            yearId={yearId}
            term={fillTerm}
            onYearIdChange={setYearId}
            onTermChange={setFillTerm}
            preferLatestTaskKey={collectionsVisitSeq}
            initialTemplateId={initialCollectionTemplateId}
          />
        )}

        {!loading && !isAdmin && user?.role !== 'teacher' && (
          <p className="text-sm text-slate-500">{isZh ? '当前角色暂无教师画像视图' : 'No view for this role'}</p>
        )}
      </main>
    </div>
  );
}
