import { useEffect, useMemo, useState } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type {
  AcademicYear,
  ClassItem,
  Enrollment,
  ReportTemplate,
  Student,
  StudentTermReport,
  StudentTermSubjectReport,
  TargetLevel,
  Term,
} from '../types/classManagement';
import { loadAcademicYears, loadCurrentAcademicYearId, loadAllClasses, loadStudents, loadEnrollments } from '../lib/classStorage';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import { fullUnifiedLevelTextFromPreset } from '../lib/reportPresetUnifiedLevels';
import { reportLetterGradeFromScore } from '@repo/shared';
import { normalizeGradeConfig, getSchoolSegmentIdForStudentGradeLevel } from '../lib/gradeConfig';
import { loadGradeConfigSync } from '../lib/storage';

type PortraitTab = 'overview' | 'my-students';

/** 学生画像内：长期发展各框架入口；当前仅「学业报告」承载按模板的学期学科评价与班主任评语。 */
type PortraitLensTab = 'academic' | 'interests' | 'generalLearning' | 'socialEmotional';

const PORTRAIT_LENS_TABS: { id: PortraitLensTab; labelZh: string; labelEn: string }[] = [
  { id: 'academic', labelZh: '学业报告', labelEn: 'Academic report' },
  { id: 'interests', labelZh: '兴趣特长', labelEn: 'Interests & strengths' },
  { id: 'generalLearning', labelZh: '通用学习能力', labelEn: 'General learning skills' },
  { id: 'socialEmotional', labelZh: '社会情感能力', labelEn: 'Social-emotional learning' },
];

type SubjectDraft = {
  id: string;
  subjectKey: string;
  subjectName: string;
  midtermScore: number | null;
  midtermGrade: string | null;
  finalScore: number | null;
  finalGrade: string | null;
  learningQualityGrade: TargetLevel | null;
  teacherComment: string | null;
  teacherId: string | null;
  dimensions: Array<{
    id: string;
    dimensionKey: string;
    dimensionLabel: string;
    rating: TargetLevel;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>;
};

/**
 * GET 报告详情可能按角色过滤 subjectReports；与模板合并后才能稳定展示全部学科行（与初次进入页面的 useEffect 逻辑一致）。
 */
function mergeStudentTermReportWithTemplate(
  detail: StudentTermReport,
  template: ReportTemplate | null
): StudentTermReport {
  const normalized: StudentTermReport = {
    ...detail,
    subjectReports: (detail.subjectReports ?? []).map((s) => ({
      ...s,
      dimensions: (s.dimensions ?? []).map((d) => ({
        ...d,
        rating: (d.rating ?? 'A') as TargetLevel,
      })),
    })),
  };
  const tplSubjects = template?.subjects ?? [];
  if (tplSubjects.length === 0) {
    return normalized;
  }
  const mergedSubjects: StudentTermSubjectReport[] = tplSubjects.map((tplSubject) => {
    const existing = normalized.subjectReports.find((s) => s.subjectKey === tplSubject.subjectKey);
    if (existing) {
      return {
        ...existing,
        subjectName: tplSubject.subjectName,
        learningQualityGrade: existing.learningQualityGrade ?? null,
        dimensions: tplSubject.dimensions.map((tplDim) => {
          const oldDim = existing.dimensions.find((d) => d.dimensionKey === tplDim.dimensionKey);
          return {
            id: oldDim?.id ?? tplDim.id,
            dimensionKey: tplDim.dimensionKey,
            dimensionLabel: tplDim.dimensionLabel,
            sortOrder: tplDim.sortOrder,
            rating: (oldDim?.rating ?? 'A') as TargetLevel,
            levelDescriptions: tplDim.levelDescriptions,
          };
        }),
      };
    }
    return {
      id: `tpl-${tplSubject.id}`,
      subjectKey: tplSubject.subjectKey,
      subjectName: tplSubject.subjectName,
      midtermScore: null,
      midtermGrade: null,
      finalScore: null,
      finalGrade: null,
      learningQualityGrade: null,
      teacherComment: null,
      teacherId: null,
      dimensions: tplSubject.dimensions.map((d) => ({
        id: d.id,
        dimensionKey: d.dimensionKey,
        dimensionLabel: d.dimensionLabel,
        sortOrder: d.sortOrder,
        rating: 'A' as TargetLevel,
        levelDescriptions: d.levelDescriptions,
      })),
      createdAt: null,
      updatedAt: null,
    };
  });
  return { ...normalized, subjectReports: mergedSubjects };
}

export default function StudentPortrait({
  onBackToHub,
  initialTab = 'overview',
}: {
  onBackToHub: () => void;
  initialTab?: PortraitTab;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const isStudentSelf = user?.role === 'student';
  const [tab, setTab] = useState<PortraitTab>(initialTab);
  const [portraitLensTab, setPortraitLensTab] = useState<PortraitLensTab>('academic');
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [homeroomEditable, setHomeroomEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportTerm, setReportTerm] = useState<Term>('Semester 1');
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [reportList, setReportList] = useState<Array<{
    id: string;
    studentId: string;
    academicYearId: string;
    academicYearName: string;
    term: Term;
    templateId: string | null;
    templateTitle: string | null;
    homeroomComment: string | null;
    updatedAt: string | null;
  }>>([]);
  const [reportDetail, setReportDetail] = useState<StudentTermReport | null>(null);
  const [reportTemplate, setReportTemplate] = useState<ReportTemplate | null>(null);
  const [homeroomCommentDraft, setHomeroomCommentDraft] = useState('');
  const [mySubjectAssignments, setMySubjectAssignments] = useState<Array<{ classId: string; subjectKey: string }>>([]);
  /** 学年学科目标预设中的全学科共用 A–D 说明（用于学业报告开头展示一次） */
  const [academicYearRubric, setAcademicYearRubric] = useState<Record<TargetLevel, string> | null>(null);

  useEffect(() => {
    if (isStudentSelf) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadAcademicYears(),
      loadCurrentAcademicYearId(),
      loadAllClasses(),
      loadStudents(),
      loadEnrollments(),
    ])
      .then(([y, current, cls, stu, enr]) => {
        if (cancelled) return;
        setYears(y);
        setCurrentYearId(current || y[0]?.id || null);
        setClasses(cls);
        setStudents(stu);
        setEnrollments(enr);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load student portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf]);

  useEffect(() => {
    if (!isStudentSelf) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!USE_CLOUD_STORAGE) {
      setLoading(false);
      setError(isZh ? '学生登录需开启云端模式（VITE_USE_CLOUD_STORAGE）并联调服务器。' : 'Student login requires cloud mode and API.');
      return;
    }
    const sid = user?.studentId;
    if (!sid) {
      setLoading(false);
      setError(isZh ? '该账号未关联学籍，无法展示画像。请联系管理员。' : 'This account is not linked to a student record.');
      return;
    }
    api
      .getStudents()
      .then((stuList) => {
        if (cancelled) return;
        setYears([]);
        setCurrentYearId(null);
        setClasses([]);
        setStudents(stuList);
        setEnrollments([]);
        setSelectedStudentId(sid);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load student portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.studentId, user?.id, isZh]);

  useEffect(() => {
    setPortraitLensTab('academic');
  }, [selectedStudentId]);

  const yearClasses = useMemo(
    () => classes.filter((c) => !currentYearId || c.academicYearId === currentYearId),
    [classes, currentYearId]
  );

  const classIdsSet = useMemo(() => new Set(yearClasses.map((c) => c.id)), [yearClasses]);

  const activeEnrollments = useMemo(
    () => enrollments.filter((e) => classIdsSet.has(e.classId)),
    [enrollments, classIdsSet]
  );

  const classStudentIds = useMemo(() => {
    if (!selectedClassId) return new Set<string>();
    return new Set(activeEnrollments.filter((e) => e.classId === selectedClassId).map((e) => e.studentId));
  }, [activeEnrollments, selectedClassId]);

  const myStudents = useMemo(
    () => students.filter((s) => classStudentIds.has(s.id)),
    [students, classStudentIds]
  );

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  const isAdminRole = user?.role === 'admin' || user?.role === 'system-admin';
  const canViewSchoolDashboard = !isStudentSelf && isAdminRole;
  const canEditHomeroomComment = !isStudentSelf && (isAdminRole || homeroomEditable) && reportTemplate?.homeroomCommentMode !== 'disabled';
  const homeroomCommentRequired = reportTemplate?.homeroomCommentMode === 'required';
  const showHomeroomComment = reportTemplate?.homeroomCommentMode !== 'disabled';
  const canTeacherEditReport = !isStudentSelf && (isAdminRole || reportTemplate?.status === 'published');
  const teacherStaffedSubjectKeysForClass = useMemo(() => {
    if (user?.role !== 'teacher' || !selectedClassId) return new Set<string>();
    return new Set(
      mySubjectAssignments.filter((a) => a.classId === selectedClassId).map((a) => a.subjectKey),
    );
  }, [user?.role, selectedClassId, mySubjectAssignments]);
  const canEditSubjectTermReport = (subjectKey: string) =>
    canTeacherEditReport &&
    (isAdminRole || (user?.role === 'teacher' && teacherStaffedSubjectKeysForClass.has(subjectKey)));
  const canHintEditTermReport = useMemo(
    () =>
      !isStudentSelf &&
      canTeacherEditReport &&
      (isAdminRole ||
        homeroomEditable ||
        (user?.role === 'teacher' && !!selectedClassId && teacherStaffedSubjectKeysForClass.size > 0)),
    [
      isStudentSelf,
      canTeacherEditReport,
      isAdminRole,
      homeroomEditable,
      user?.role,
      selectedClassId,
      teacherStaffedSubjectKeysForClass,
    ]
  );
  const templateSubjectMap = useMemo(
    () => new Map((reportTemplate?.subjects ?? []).map((s) => [s.subjectKey, s] as const)),
    [reportTemplate],
  );

  useEffect(() => {
    if (isStudentSelf) return;
    if (!canViewSchoolDashboard && tab === 'overview') {
      setTab('my-students');
    }
  }, [isStudentSelf, canViewSchoolDashboard, tab]);

  useEffect(() => {
    if (isStudentSelf) {
      setHomeroomEditable(false);
      return;
    }
    if (!USE_CLOUD_STORAGE) {
      setHomeroomEditable(user?.role === 'admin' || user?.role === 'system-admin');
      return;
    }
    if (!selectedClassId || !user?.id || user.role === 'admin' || user.role === 'system-admin') {
      setHomeroomEditable(user?.role === 'admin' || user?.role === 'system-admin');
      return;
    }
    api
      .getClassTeachers(selectedClassId)
      .then((teachers) => {
        const isHomeroom = teachers.some((t) => t.teacherId === user.id && t.role === 'homeroom');
        setHomeroomEditable(isHomeroom);
      })
      .catch(() => setHomeroomEditable(false));
  }, [selectedClassId, user?.id, user?.role, isStudentSelf]);

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || user?.role !== 'teacher' || !currentYearId) {
      setMySubjectAssignments([]);
      return;
    }
    let cancelled = false;
    api
      .getMySubjectAssignments(currentYearId)
      .then((rows) => {
        if (!cancelled) setMySubjectAssignments(rows);
      })
      .catch(() => {
        if (!cancelled) setMySubjectAssignments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.role, currentYearId]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !currentYearId) {
      setAcademicYearRubric(null);
      return;
    }
    let cancelled = false;
    api
      .getAdminReportYearDimensionPreset(currentYearId)
      .then((p) => {
        if (cancelled) return;
        setAcademicYearRubric(fullUnifiedLevelTextFromPreset(p?.unifiedLevelDescriptions));
      })
      .catch(() => {
        if (cancelled) return;
        setAcademicYearRubric(fullUnifiedLevelTextFromPreset(null));
      });
    return () => {
      cancelled = true;
    };
  }, [currentYearId]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (!selectedStudentId) {
      setReportList([]);
      setReportDetail(null);
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    api
      .getStudentTermReports(selectedStudentId)
      .then((list) => {
        if (cancelled) return;
        setReportList(list);
        if (!currentYearId && list.length > 0) {
          setCurrentYearId(list[0].academicYearId);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load term reports');
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, currentYearId]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (!selectedStudentId || !currentYearId) {
      setReportTemplates([]);
      setSelectedTemplateId('');
      setReportTemplate(null);
      setReportDetail(null);
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    const schoolSeg = getSchoolSegmentIdForStudentGradeLevel(
      gc,
      students.find((x) => x.id === selectedStudentId)?.currentGrade ?? null,
    );
    api
      .getReportTemplatesForTerm(currentYearId, reportTerm, schoolSeg ? { schoolSegmentId: schoolSeg } : undefined)
      .then(async (templates) => {
        if (cancelled) return;
        setReportTemplates(templates);
        const effectiveTemplateId = selectedTemplateId && templates.some((t) => t.id === selectedTemplateId)
          ? selectedTemplateId
          : (templates[0]?.id ?? '');
        setSelectedTemplateId(effectiveTemplateId);
        if (!effectiveTemplateId) {
          setReportTemplate(null);
          setReportDetail(null);
          setHomeroomCommentDraft('');
          return;
        }
        const [template, detail] = await Promise.all([
          api.getReportTemplateById(effectiveTemplateId),
          api.getStudentTermReportDetail(selectedStudentId, currentYearId, reportTerm, effectiveTemplateId),
        ]);
        if (cancelled) return;
        setReportTemplate(template);
        const merged = mergeStudentTermReportWithTemplate(detail, template);
        setReportDetail(merged);
        setHomeroomCommentDraft(merged.homeroomComment ?? '');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load report detail');
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, currentYearId, reportTerm, selectedTemplateId, students]);

  const learningStats = useMemo(() => {
    const inYearStudentIds = new Set(activeEnrollments.map((e) => e.studentId));
    const inYearStudents = students.filter((s) => inYearStudentIds.has(s.id));
    const active = inYearStudents.filter((s) => (s.status ?? 'active') === 'active').length;
    const byDivision = new Map<string, number>();
    const byGrade = new Map<string, number>();
    for (const s of inYearStudents) {
      const div = s.division || (isZh ? '未设置' : 'Not set');
      byDivision.set(div, (byDivision.get(div) ?? 0) + 1);
      const g = s.currentGrade != null ? `G${s.currentGrade}` : (isZh ? '未设置' : 'Not set');
      byGrade.set(g, (byGrade.get(g) ?? 0) + 1);
    }
    return {
      total: inYearStudents.length,
      active,
      activeRate: inYearStudents.length ? Math.round((active / inYearStudents.length) * 100) : 0,
      byDivision: Array.from(byDivision.entries()).sort((a, b) => b[1] - a[1]),
      byGrade: Array.from(byGrade.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [activeEnrollments, students, isZh]);

  const upsertSubjectDraft = (subjectKey: string, updater: (draft: SubjectDraft) => SubjectDraft) => {
    setReportDetail((prev) => {
      if (!prev) return prev;
      const nextSubjects = [...prev.subjectReports];
      const idx = nextSubjects.findIndex((s) => s.subjectKey === subjectKey);
      if (idx === -1) return prev;
      const base = nextSubjects[idx];
      const draft: SubjectDraft = {
        id: base.id,
        subjectKey: base.subjectKey,
        subjectName: base.subjectName,
        midtermScore: base.midtermScore,
        midtermGrade: base.midtermGrade,
        finalScore: base.finalScore,
        finalGrade: base.finalGrade,
        learningQualityGrade: base.learningQualityGrade ?? null,
        teacherComment: base.teacherComment,
        teacherId: base.teacherId,
        dimensions: base.dimensions.map((d) => ({
          id: d.id,
          dimensionKey: d.dimensionKey,
          dimensionLabel: d.dimensionLabel,
          rating: (d.rating ?? 'A') as TargetLevel,
          levelDescriptions: { ...d.levelDescriptions },
        })),
      };
      const updated = updater(draft);
      nextSubjects[idx] = {
        ...base,
        ...updated,
      } as StudentTermSubjectReport;
      return { ...prev, subjectReports: nextSubjects };
    });
  };

  const saveSubjectReport = async (subject: StudentTermSubjectReport) => {
    if (!selectedStudentId || !currentYearId || !selectedTemplateId) return;
    if (!canEditSubjectTermReport(subject.subjectKey)) {
      setError(isZh ? '您无权保存该学科报告。' : 'You are not allowed to save this subject report.');
      return;
    }
    setReportSaving(true);
    setError(null);
    try {
      await api.upsertStudentTermSubjectReport(selectedStudentId, currentYearId, reportTerm, selectedTemplateId, subject.subjectKey, {
        subjectName: subject.subjectName,
        midtermScore: subject.midtermScore,
        finalScore: subject.finalScore,
        teacherComment: subject.teacherComment,
        learningQualityGrade: subject.learningQualityGrade ?? null,
        dimensions: subject.dimensions.map((d) => ({
          dimensionKey: d.dimensionKey,
          dimensionLabel: d.dimensionLabel,
          rating: (d.rating ?? 'A') as TargetLevel,
          levelDescriptions: d.levelDescriptions,
        })),
      });
      const [next, tpl] = await Promise.all([
        api.getStudentTermReportDetail(selectedStudentId, currentYearId, reportTerm, selectedTemplateId),
        api.getReportTemplateById(selectedTemplateId),
      ]);
      setReportTemplate(tpl);
      const merged = mergeStudentTermReportWithTemplate(next, tpl);
      setReportDetail(merged);
      setHomeroomCommentDraft(merged.homeroomComment ?? '');
      const list = await api.getStudentTermReports(selectedStudentId);
      setReportList(list);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save subject report');
    } finally {
      setReportSaving(false);
    }
  };

  const saveHomeroomComment = async () => {
    if (!selectedStudentId || !currentYearId || !selectedTemplateId) return;
    if (homeroomCommentRequired && !homeroomCommentDraft.trim()) {
      setError(isZh ? '该模板要求填写班主任评语。' : 'Homeroom comment is required by template.');
      return;
    }
    setReportSaving(true);
    setError(null);
    try {
      await api.updateStudentTermHomeroomComment(selectedStudentId, currentYearId, reportTerm, selectedTemplateId, homeroomCommentDraft || null);
      const [next, tpl] = await Promise.all([
        api.getStudentTermReportDetail(selectedStudentId, currentYearId, reportTerm, selectedTemplateId),
        api.getReportTemplateById(selectedTemplateId),
      ]);
      setReportTemplate(tpl);
      const merged = mergeStudentTermReportWithTemplate(next, tpl);
      setReportDetail(merged);
      setHomeroomCommentDraft(merged.homeroomComment ?? '');
      const list = await api.getStudentTermReports(selectedStudentId);
      setReportList(list);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save homeroom comment');
    } finally {
      setReportSaving(false);
    }
  };

  const reportYearOptions = useMemo(() => {
    if (!isStudentSelf) return years.map((y) => ({ id: y.id, name: y.name }));
    const map = new Map<string, string>();
    for (const r of reportList) {
      if (!map.has(r.academicYearId)) map.set(r.academicYearId, r.academicYearName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [isStudentSelf, years, reportList]);

  return (
    <div className="min-h-screen bg-slate-50 pt-14">
      <AppTopBar
        title={isStudentSelf ? (isZh ? '我的画像' : 'My profile') : isZh ? '学生画像' : 'Student Portrait'}
        showBack={!isStudentSelf}
        onBack={isStudentSelf ? undefined : onBackToHub}
      />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {!isStudentSelf && (
          <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex gap-1">
            {canViewSchoolDashboard && (
              <Button variant={tab === 'overview' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('overview')}>
                {isZh ? '学校看板' : 'School dashboard'}
              </Button>
            )}
            <Button variant={tab === 'my-students' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('my-students')}>
              {isZh ? '我的学生' : 'My Students'}
            </Button>
          </div>
        )}

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        {!USE_CLOUD_STORAGE && !loading && !isStudentSelf && (
          <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            {isZh
              ? '本地模式：看板与班级学生列表来自 localStorage；学期学业报告等需开启 VITE_USE_CLOUD_STORAGE 并联调后端 API。'
              : 'Local mode: dashboard and class lists use localStorage; term academic reports need API (set VITE_USE_CLOUD_STORAGE=true).'}
          </div>
        )}
        {loading && <div className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</div>}

        {!loading && isStudentSelf && selectedStudent && (
          <section className="space-y-4">
            <p className="text-sm text-slate-600">
              {isZh ? '以下为学生画像（只读）。基础学籍信息如有误请联系班主任或管理员。' : 'Your student portrait (read-only). Contact your teacher or admin if core records are wrong.'}
            </p>
            <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex flex-wrap gap-1">
              {PORTRAIT_LENS_TABS.map((t) => (
                <Button
                  key={t.id}
                  variant={portraitLensTab === t.id ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setPortraitLensTab(t.id)}
                >
                  {isZh ? t.labelZh : t.labelEn}
                </Button>
              ))}
            </div>
            {portraitLensTab === 'academic' && (
            <>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
              <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-semibold">
                    {(selectedStudent.nameZh || selectedStudent.name).slice(0, 1)}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-800">{selectedStudent.nameZh || selectedStudent.name}</div>
                    <div className="text-sm text-slate-500">
                      {selectedStudent.nameEn || '—'} · {selectedStudent.studentNumber || '—'} · {selectedStudent.status || 'active'}
                    </div>
                  </div>
                </div>
              </div>
            <div id="term-report-panel" className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-semibold text-slate-800">{isZh ? '学业报告（按学期）' : 'Academic report (by term)'}</h3>
                {reportLoading && <span className="text-xs text-slate-500">{isZh ? '加载中…' : 'Loading…'}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={currentYearId || ''}
                  onChange={(e) => setCurrentYearId(e.target.value || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[160px]"
                >
                  <option value="">{isZh ? '选择学年' : 'Select year'}</option>
                  {reportYearOptions.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
                <select
                  value={reportTerm}
                  onChange={(e) => setReportTerm(e.target.value as Term)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[140px]"
                >
                  <option value="Semester 1">{isZh ? '上学期' : 'Semester 1'}</option>
                  <option value="Semester 2">{isZh ? '下学期' : 'Semester 2'}</option>
                </select>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                >
                  <option value="">{isZh ? '选择评价报告' : 'Select report'}</option>
                  {reportTemplates.map((tpl) => (
                    <option key={tpl.id ?? 'null'} value={tpl.id ?? ''}>
                      {tpl.title || (isZh ? '未命名评价' : 'Untitled evaluation')}
                    </option>
                  ))}
                </select>
              </div>
              {!reportDetail || reportDetail.subjectReports.length === 0 ? (
                <p className="text-sm text-slate-500">{isZh ? '该学期暂无学业报告。' : 'No report for this term yet.'}</p>
              ) : (
                <div className="space-y-3">
                  {reportDetail.subjectReports.map((s) => (
                    <div key={s.subjectKey} className="rounded-lg border border-slate-200 p-3">
                      {(() => {
                        const subjectConfig = templateSubjectMap.get(s.subjectKey);
                        return (
                          <>
                      <div className="text-sm font-semibold text-slate-800">{s.subjectName}</div>
                      {subjectConfig?.enableLearningQuality !== false && s.learningQualityGrade ? (
                        <div className="text-xs text-slate-500 mt-1">
                          {isZh ? '学习品质' : 'Learning quality'}: <span className="font-medium text-slate-800">{s.learningQualityGrade}</span>
                        </div>
                      ) : null}
                      {subjectConfig?.enableScore !== false && (
                        <div className="text-xs text-slate-500 mt-1">
                          {isZh ? '期中等第' : 'Midterm grade'}:{' '}
                          {s.midtermGrade ??
                            reportLetterGradeFromScore(s.midtermScore, reportTemplate?.scoreGradeMinScores) ??
                            '—'}{' '}
                          · {isZh ? '期末等第' : 'Final grade'}:{' '}
                          {s.finalGrade ??
                            reportLetterGradeFromScore(s.finalScore, reportTemplate?.scoreGradeMinScores) ??
                            '—'}
                        </div>
                      )}
                      {subjectConfig?.enableTeacherComment !== false && s.teacherComment && (
                        <p className="text-sm text-slate-700 mt-2">{s.teacherComment}</p>
                      )}
                      {s.dimensions.length > 0 && (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {s.dimensions.map((d) => (
                            <div key={d.id} className="text-xs rounded border border-slate-100 px-2 py-1.5">
                              <span className="text-slate-700">{d.dimensionLabel}</span>
                              <span className="ml-2 font-medium text-slate-900">{d.rating ?? '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {showHomeroomComment && (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500 mb-1">{isZh ? '班主任评语' : 'Homeroom comment'}</div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{reportDetail.homeroomComment || (isZh ? '暂无' : 'N/A')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>
            </>
            )}
            {portraitLensTab === 'interests' && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
                {isZh
                  ? '「兴趣特长」框架开发中，将用于记录与展示学生的长期兴趣与特长发展。'
                  : 'Interests & strengths: coming soon — a space for long-term interest and talent development.'}
              </div>
            )}
            {portraitLensTab === 'generalLearning' && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
                {isZh
                  ? '「通用学习能力」框架开发中，将用于学习策略、习惯等维度的长期追踪。'
                  : 'General learning skills: coming soon — strategies, habits, and longitudinal tracking.'}
              </div>
            )}
            {portraitLensTab === 'socialEmotional' && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
                {isZh
                  ? '「社会情感能力」框架开发中，将用于协作、自我管理等方面的长期观察。'
                  : 'Social-emotional learning: coming soon — collaboration, self-management, and related dimensions.'}
              </div>
            )}
          </section>
        )}

        {!loading && canViewSchoolDashboard && tab === 'overview' && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '学年在册学生' : 'Students in year'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.total}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '在读学生' : 'Active students'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.active}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '在读率' : 'Active rate'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.activeRate}%</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学部分布' : 'Division distribution'}</h3>
                <ul className="space-y-1 text-sm">
                  {learningStats.byDivision.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-slate-700">{k}</span>
                      <span className="text-slate-500">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '年级分布' : 'Grade distribution'}</h3>
                <ul className="space-y-1 text-sm">
                  {learningStats.byGrade.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-slate-700">{k}</span>
                      <span className="text-slate-500">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              {isZh
                ? '教学建议：优先关注“在读状态非 active”的学生；结合「学业报告」与后续画像维度（通用学习能力、社会情感等），识别需要长期支持的方向。'
                : 'Teaching tip: prioritize students not in active status; combine term reports and future portrait lenses (learning skills, SEL) for long-term support planning.'}
            </div>
          </section>
        )}

        {!loading && !isStudentSelf && tab === 'my-students' && (
          <section className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学年' : 'Academic year'}</label>
                <select
                  value={currentYearId || ''}
                  onChange={(e) => setCurrentYearId(e.target.value || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                >
                  <option value="">—</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '班级' : 'Class'}</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value);
                    setSelectedStudentId('');
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[220px]"
                >
                  <option value="">{isZh ? '请选择班级' : 'Select class'}</option>
                  {yearClasses.map((c) => (
                    <option key={c.id} value={c.id}>G{c.grade} {c.name}</option>
                  ))}
                </select>
              </div>
              {tab === 'my-students' && (
                <div className="text-xs text-slate-500">
                  {canHintEditTermReport
                    ? (isZh
                        ? '在「学业报告」中可按权限填写班主任评语与学科评价（评价模板已发布）。'
                        : 'Under Academic report you may enter homeroom notes and subject evaluations when the template is published.')
                    : (isZh
                        ? '学期报告为只读，或评价模板尚未发布。'
                        : 'Term report is read-only, or the evaluation template is not published yet.')}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-3 lg:col-span-3">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学生列表' : 'Students'}</h3>
                <div className="space-y-2 max-h-[520px] overflow-y-auto">
                  {myStudents.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStudentId(s.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-sm ${
                        selectedStudentId === s.id
                          ? 'border-sky-400 bg-sky-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-medium text-slate-800">{s.nameZh || s.name}</div>
                      <div className="text-xs text-slate-500">{s.studentNumber || '—'} · {s.division || (isZh ? '未设学部' : 'No division')}</div>
                    </button>
                  ))}
                  {selectedClassId && myStudents.length === 0 && (
                    <div className="text-xs text-slate-500">{isZh ? '该班暂无学生' : 'No students in this class.'}</div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 lg:col-span-9">
                {!selectedStudent ? (
                  <div className="text-sm text-slate-500">{isZh ? '请选择左侧学生查看电子档案' : 'Select a student to open the profile card.'}</div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex flex-wrap gap-1">
                      {PORTRAIT_LENS_TABS.map((t) => (
                        <Button
                          key={t.id}
                          variant={portraitLensTab === t.id ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => setPortraitLensTab(t.id)}
                        >
                          {isZh ? t.labelZh : t.labelEn}
                        </Button>
                      ))}
                    </div>
                    {portraitLensTab === 'academic' && (
                    <div id="term-report-panel" className="border border-slate-200 rounded-xl p-3 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-sm font-semibold text-slate-800">{isZh ? '学业报告（本学期快照）' : 'Academic report snapshot'}</h4>
                        {reportLoading && <span className="text-xs text-slate-500">{isZh ? '加载中…' : 'Loading…'}</span>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={currentYearId || ''}
                          onChange={(e) => setCurrentYearId(e.target.value || null)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[170px]"
                        >
                          <option value="">{isZh ? '选择学年' : 'Select year'}</option>
                          {reportYearOptions.map((y) => (
                            <option key={y.id} value={y.id}>{y.name}</option>
                          ))}
                        </select>
                        <select
                          value={reportTerm}
                          onChange={(e) => setReportTerm(e.target.value as Term)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[140px]"
                        >
                          <option value="Semester 1">{isZh ? '上学期' : 'Semester 1'}</option>
                          <option value="Semester 2">{isZh ? '下学期' : 'Semester 2'}</option>
                        </select>
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                        >
                          <option value="">{isZh ? '选择评价报告' : 'Select report'}</option>
                          {reportTemplates.map((tpl) => (
                            <option key={tpl.id ?? 'null'} value={tpl.id ?? ''}>
                              {tpl.title || (isZh ? '未命名评价' : 'Untitled evaluation')}
                            </option>
                          ))}
                        </select>
                      </div>

                      {reportDetail &&
                        reportDetail.subjectReports.some((s) => (s.dimensions ?? []).length > 0) && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-3 space-y-2">
                            <div className="text-xs font-semibold text-slate-800">
                              {isZh ? '课程目标达成 · 等第说明' : 'Target attainment — grading rubric'}
                            </div>
                            <div className="space-y-1.5 text-[11px] text-slate-700 leading-snug">
                              {(['A', 'B', 'C', 'D'] as const).map((lv) => {
                                const text = (academicYearRubric ?? fullUnifiedLevelTextFromPreset(null))[lv];
                                return (
                                  <p key={lv} className="break-words">
                                    <span className="font-semibold text-slate-800">{lv}</span>
                                    <span className="text-slate-500"> · </span>
                                    {text}
                                  </p>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      {reportDetail && showHomeroomComment && (
                        <div className="rounded-lg border border-slate-200 p-3">
                          <div className="text-xs text-slate-500 mb-1">
                            {isZh ? '班主任评语' : 'Homeroom comment'}
                            {homeroomCommentRequired ? <span className="text-red-500 ml-1">*</span> : null}
                          </div>
                          <textarea
                            value={homeroomCommentDraft}
                            onChange={(e) => setHomeroomCommentDraft(e.target.value)}
                            className="w-full min-h-[86px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            disabled={!canEditHomeroomComment || !canTeacherEditReport || reportSaving}
                            placeholder={isZh ? '输入本学期班主任评语' : 'Type homeroom comment'}
                          />
                          {canEditHomeroomComment && (
                            <div className="mt-2 flex justify-end">
                              <Button
                                size="sm"
                                onClick={saveHomeroomComment}
                                disabled={reportSaving || !selectedStudentId || !currentYearId || !canTeacherEditReport || (homeroomCommentRequired && !homeroomCommentDraft.trim())}
                              >
                                {reportSaving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存班主任评语' : 'Save homeroom comment'}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {!reportDetail || reportDetail.subjectReports.length === 0 ? (
                        <p className="text-sm text-slate-500">{isZh ? '该学期暂无学科报告，可先新增学科并保存。' : 'No subject report yet for this term.'}</p>
                      ) : (
                        <div className="space-y-3">
                          {reportDetail.subjectReports.map((s) => (
                            <div key={s.subjectKey} className="rounded-lg border border-slate-200 p-3 space-y-3">
                              {(() => {
                                const subjectConfig = templateSubjectMap.get(s.subjectKey);
                                return (
                                  <>
                              <div className="text-sm font-medium text-slate-800">{s.subjectName || (isZh ? '未命名学科' : 'Untitled subject')}</div>
                              {(s.dimensions.length > 0 ||
                                subjectConfig?.enableLearningQuality !== false ||
                                subjectConfig?.enableScore !== false) && (
                                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                                  <div className="text-xs font-medium text-slate-600 mb-2">
                                    {isZh ? '评价维度' : 'Evaluation dimensions'}
                                  </div>
                                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                                    <table className="w-full min-w-[280px] border-collapse text-xs">
                                      <tbody>
                                        {s.dimensions.map((dim, idx) => (
                                          <tr key={dim.id} className="bg-white">
                                            <td className="border border-slate-200 px-2 py-1.5 align-middle text-sm text-slate-800">
                                              {dim.dimensionLabel}
                                            </td>
                                            <td className="border border-slate-200 p-1 align-middle w-[7.5rem]">
                                              <select
                                                value={dim.rating ?? 'A'}
                                                onChange={(e) =>
                                                  upsertSubjectDraft(s.subjectKey, (d) => {
                                                    const next = [...d.dimensions];
                                                    next[idx] = { ...next[idx], rating: e.target.value as TargetLevel };
                                                    return { ...d, dimensions: next };
                                                  })
                                                }
                                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                                                disabled={!canEditSubjectTermReport(s.subjectKey) || reportSaving}
                                                aria-label={isZh ? `${dim.dimensionLabel} 等第` : `${dim.dimensionLabel} level`}
                                              >
                                                <option value="A">A</option>
                                                <option value="B">B</option>
                                                <option value="C">C</option>
                                                <option value="D">D</option>
                                              </select>
                                            </td>
                                          </tr>
                                        ))}
                                        {subjectConfig?.enableLearningQuality !== false ? (
                                          <tr
                                            className={`bg-slate-50/95 ${s.dimensions.length > 0 ? 'border-t-2 border-slate-300' : ''}`}
                                          >
                                            <td className="border border-slate-200 px-2 py-2 align-middle text-slate-800 text-[11px] sm:text-xs font-medium leading-snug">
                                              {isZh ? '学习品质：兴趣、习惯与态度' : 'Learning quality: interest, habits, attitude'}
                                            </td>
                                            <td className="border border-slate-200 p-1.5 align-middle w-[7.5rem] bg-slate-50/95">
                                              <select
                                                value={s.learningQualityGrade ?? ''}
                                                onChange={(e) => {
                                                  const v = e.target.value.trim() as TargetLevel | '';
                                                  upsertSubjectDraft(s.subjectKey, (d) => ({
                                                    ...d,
                                                    learningQualityGrade: v === 'A' || v === 'B' || v === 'C' || v === 'D' ? v : null,
                                                  }));
                                                }}
                                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                                                disabled={!canEditSubjectTermReport(s.subjectKey) || reportSaving}
                                                aria-label={
                                                  isZh
                                                    ? '学习品质：兴趣、习惯与态度 等第'
                                                    : 'Learning quality (interest, habits, attitude) level'
                                                }
                                              >
                                                <option value="">{isZh ? '—' : '—'}</option>
                                                <option value="A">A</option>
                                                <option value="B">B</option>
                                                <option value="C">C</option>
                                                <option value="D">D</option>
                                              </select>
                                            </td>
                                          </tr>
                                        ) : null}
                                        {subjectConfig?.enableScore !== false ? (
                                          <tr
                                            className={`bg-slate-100/80 ${
                                              subjectConfig?.enableLearningQuality !== false
                                                ? 'border-t border-slate-300'
                                                : s.dimensions.length > 0
                                                  ? 'border-t-2 border-slate-300'
                                                  : ''
                                            }`}
                                          >
                                            <td className="border border-slate-200 px-2 py-2 align-middle text-slate-800 text-xs font-medium">
                                              {isZh ? '测评成绩' : 'Assessment score'}
                                            </td>
                                            <td className="border border-slate-200 p-1.5 align-middle min-w-[10rem] bg-slate-100/80">
                                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                                                <input
                                                  type="number"
                                                  min={0}
                                                  max={100}
                                                  step={0.5}
                                                  value={s.finalScore ?? ''}
                                                  onChange={(e) => {
                                                    const v = e.target.value.trim();
                                                    upsertSubjectDraft(s.subjectKey, (d) => ({
                                                      ...d,
                                                      finalScore: v ? Number(v) : null,
                                                      midtermScore: null,
                                                    }));
                                                  }}
                                                  disabled={!canEditSubjectTermReport(s.subjectKey) || reportSaving}
                                                  className="h-8 w-full min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs bg-white"
                                                  placeholder={isZh ? '分数' : 'Score'}
                                                />
                                                <input
                                                  value={
                                                    s.finalGrade ??
                                                    reportLetterGradeFromScore(
                                                      s.finalScore,
                                                      reportTemplate?.scoreGradeMinScores,
                                                    ) ??
                                                    ''
                                                  }
                                                  readOnly
                                                  className="h-8 w-full min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-600 sm:max-w-[4.5rem]"
                                                  placeholder={isZh ? '等第' : 'Grade'}
                                                />
                                              </div>
                                            </td>
                                          </tr>
                                        ) : null}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                              {subjectConfig?.enableTeacherComment !== false && (
                                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                                  <label className="block text-xs text-slate-500">{isZh ? '学科教师评语（可选）' : 'Teacher comment (optional)'}</label>
                                  <textarea
                                    value={s.teacherComment ?? ''}
                                    onChange={(e) => upsertSubjectDraft(s.subjectKey, (d) => ({ ...d, teacherComment: e.target.value }))}
                                    disabled={!canEditSubjectTermReport(s.subjectKey) || reportSaving}
                                    className="w-full min-h-[72px] rounded border border-slate-300 px-2 py-1.5 text-sm bg-white"
                                  />
                                </div>
                              )}
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => void saveSubjectReport(s)}
                                  disabled={reportSaving || !s.subjectName.trim() || !canEditSubjectTermReport(s.subjectKey)}
                                >
                                  {reportSaving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存学科报告' : 'Save subject report'}
                                </Button>
                              </div>
                                  </>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    )}
                    {portraitLensTab === 'interests' && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
                        {isZh
                          ? '「兴趣特长」框架开发中，将用于记录与展示学生的长期兴趣与特长发展。'
                          : 'Interests & strengths: coming soon — a space for long-term interest and talent development.'}
                      </div>
                    )}
                    {portraitLensTab === 'generalLearning' && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
                        {isZh
                          ? '「通用学习能力」框架开发中，将用于学习策略、习惯等维度的长期追踪。'
                          : 'General learning skills: coming soon — strategies, habits, and longitudinal tracking.'}
                      </div>
                    )}
                    {portraitLensTab === 'socialEmotional' && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
                        {isZh
                          ? '「社会情感能力」框架开发中，将用于协作、自我管理等方面的长期观察。'
                          : 'Social-emotional learning: coming soon — collaboration, self-management, and related dimensions.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

