/**
 * 仅通过 HTTP API（JWT）构建学业报告写入任务，不依赖 DATABASE_URL。
 */
import {
  getGradeCatalogIdForClass,
  resolveTemplateDimensionsForGrade,
  type GradeConfig,
  type Term,
} from '@repo/shared';
import {
  effectiveEnableScore,
  inclusionPayloadFromApiPreset,
  resolveExamFullScore,
  type HomeroomFillTask,
  type ReportLoadPlan,
  type SubjectFillTask,
} from './reportLoadContext.js';
import { loginWithPassword } from './loadTestAuth.js';
import type { LoadTestCredentialsFile } from './loadTestCredentials.js';

export type ApiFetch = (path: string) => Promise<unknown>;

export type ReportApiSharedContext = {
  templateTitle: string;
  term: Term;
  yearName: string;
  template: {
    id: string;
    title?: string | null;
    academicYearId: string;
    term: Term;
    status: string;
    schoolSegmentId?: string | null;
    homeroomCommentMode?: string;
    subjects: Array<{
      subjectKey: string;
      subjectName?: string | null;
      subjectNameZh?: string | null;
      enableScore?: boolean;
      enableLearningQuality?: boolean;
      gradeDimensions?: Array<{ gradeId: string; dimensions: Array<{ dimensionLabelZh?: string; dimensionLabelEn?: string }> }>;
      dimensions?: Array<{ dimensionKey: string; dimensionLabel: string }>;
    }>;
  };
  segmentId: string;
  templateSubjectByKey: Map<string, ReportApiSharedContext['template']['subjects'][number]>;
  inclusionCtx: ReturnType<typeof inclusionPayloadFromApiPreset>;
  gradeStructure: GradeConfig;
  segmentGradeIds: string[];
  studentsByClass: Map<string, Array<{ id: string; name: string }>>;
  classGradeById: Map<string, number>;
};

function segmentGradeIdsFromConfig(config: GradeConfig, segmentId: string): string[] {
  const sid = String(segmentId ?? '').trim();
  if (!sid) return config.items.map((i) => i.id);
  const seg = config.segments?.find((s) => String(s.id ?? '').trim() === sid);
  if (seg?.gradeIds?.length) return seg.gradeIds.map((g) => String(g).trim()).filter(Boolean);
  return config.items.map((i) => i.id);
}

export function createApiFetch(apiBase: string, token: string): ApiFetch {
  const base = apiBase.replace(/\/$/, '');
  return async (path: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
  };
}

export async function loadReportApiSharedContext(
  fetchApi: ApiFetch,
  templateTitle: string,
  term: Term,
): Promise<ReportApiSharedContext> {
  const yearsData = (await fetchApi('/api/classes/academic-years')) as { years?: Array<{ id: string; isCurrent?: boolean; name: string }> };
  const years = yearsData.years ?? [];
  const currentYear = years.find((y) => y.isCurrent) ?? years[0];
  if (!currentYear) throw new Error('未找到学年');

  const templatesData = (await fetchApi(
    `/api/classes/reports/templates/${encodeURIComponent(currentYear.id)}/${encodeURIComponent(term)}`,
  )) as { templates?: Array<{ id: string; title?: string | null }> };
  const templateSummary = (templatesData.templates ?? []).find(
    (t) => (t.title ?? '').trim() === templateTitle.trim(),
  );
  if (!templateSummary) {
    throw new Error(`未找到报告模板「${templateTitle}」（${currentYear.name} · ${term}）`);
  }

  const templateData = (await fetchApi(
    `/api/classes/reports/templates/${encodeURIComponent(templateSummary.id)}`,
  )) as { template: ReportApiSharedContext['template'] };
  const template = templateData.template;
  const segmentId = String(template.schoolSegmentId ?? '').trim();

  const presetData = (await fetchApi(
    `/api/classes/reports/year-dimension-presets/${encodeURIComponent(template.academicYearId)}`,
  )) as {
    preset?: {
      stageInclusion?: Record<string, string[]>;
      evaluationGradeInclusion?: unknown;
      examGradeInclusion?: unknown;
      examConfigs?: unknown;
      subjectKeyToCourseId?: Record<string, string>;
    } | null;
  };
  const inclusionCtx = inclusionPayloadFromApiPreset(presetData.preset ?? {});
  const gradeStructure = (await fetchApi('/api/settings/school-grade-structure')) as GradeConfig;
  const segmentGradeIds = segmentGradeIdsFromConfig(gradeStructure, segmentId);

  const classesData = (await fetchApi(
    `/api/classes?academicYearId=${encodeURIComponent(template.academicYearId)}`,
  )) as { classes?: Array<{ id: string; grade: number; name: string }> };
  const classGradeById = new Map<string, number>();
  for (const c of classesData.classes ?? []) {
    classGradeById.set(c.id, Number(c.grade));
  }

  const studentsData = (await fetchApi(
    `/api/classes/students?academicYearId=${encodeURIComponent(template.academicYearId)}`,
  )) as { students?: Array<{ id: string; name?: string; nameZh?: string; currentClassId?: string | null }> };
  const studentsByClass = new Map<string, Array<{ id: string; name: string }>>();
  for (const stu of studentsData.students ?? []) {
    const classId = String(stu.currentClassId ?? '').trim();
    if (!classId) continue;
    const list = studentsByClass.get(classId) ?? [];
    list.push({
      id: stu.id,
      name: (stu.nameZh ?? stu.name ?? stu.id).toString(),
    });
    studentsByClass.set(classId, list);
  }

  return {
    templateTitle,
    term,
    yearName: currentYear.name,
    template,
    segmentId,
    templateSubjectByKey: new Map(template.subjects.map((s) => [s.subjectKey, s] as const)),
    inclusionCtx,
    gradeStructure,
    segmentGradeIds,
    studentsByClass,
    classGradeById,
  };
}

export type MyProgressClass = {
  classId: string;
  className: string;
  grade: number;
  requiredSubjectKeys: string[];
  homeroomEvaluationAvailable?: boolean;
};

export function buildTeacherReportPlanFromContext(
  ctx: ReportApiSharedContext,
  teacher: { id: string; displayName: string },
  progressClasses: MyProgressClass[],
): ReportLoadPlan {
  const { template, segmentId, templateSubjectByKey, inclusionCtx, gradeStructure, segmentGradeIds, studentsByClass } =
    ctx;

  const subjectTasks: SubjectFillTask[] = [];
  const homeroomTasks: HomeroomFillTask[] = [];

  for (const cls of progressClasses) {
    const classStudents = studentsByClass.get(cls.classId) ?? [];
    const gradeCatalogId = getGradeCatalogIdForClass(gradeStructure, cls.grade, { className: cls.className });

    for (const subjectKey of cls.requiredSubjectKeys) {
      const tplSubject = templateSubjectByKey.get(subjectKey);
      if (!tplSubject) continue;
      const dims = resolveTemplateDimensionsForGrade(tplSubject, gradeCatalogId).map((d) => ({
        dimensionKey: d.dimensionKey,
        dimensionLabel: d.dimensionLabel,
      }));
      const subjectName =
        (tplSubject.subjectNameZh ?? tplSubject.subjectName ?? subjectKey).toString().trim() || subjectKey;
      const enableScore = effectiveEnableScore(
        template.term,
        segmentId,
        subjectKey,
        gradeCatalogId,
        segmentGradeIds,
        tplSubject.enableScore !== false,
        inclusionCtx,
      );
      const examFullScore = enableScore
        ? resolveExamFullScore(template.term, segmentId, subjectKey, gradeCatalogId, inclusionCtx)
        : null;

      for (const stu of classStudents) {
        subjectTasks.push({
          teacherId: teacher.id,
          teacherName: teacher.displayName,
          classId: cls.classId,
          className: cls.className,
          classGrade: cls.grade,
          studentId: stu.id,
          subjectKey,
          subjectName,
          enableScore,
          examFullScore,
          dimensions: dims,
          templateId: template.id,
          academicYearId: template.academicYearId,
          term: template.term,
        });
      }
    }

    if (cls.homeroomEvaluationAvailable) {
      for (const stu of classStudents) {
        homeroomTasks.push({
          teacherId: teacher.id,
          teacherName: teacher.displayName,
          classId: cls.classId,
          className: cls.className,
          studentId: stu.id,
          studentName: stu.name,
          templateId: template.id,
          academicYearId: template.academicYearId,
          term: template.term,
          homeroomCommentMode: template.homeroomCommentMode ?? 'required',
        });
      }
    }
  }

  return {
    template: {
      id: template.id,
      academicYearId: template.academicYearId,
      term: template.term,
      title: template.title ?? ctx.templateTitle,
      schoolSegmentId: segmentId,
      homeroomCommentMode: template.homeroomCommentMode ?? 'required',
    },
    portraitTemplate: null,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks: [],
    subjectSettings: {
      templateId: template.id,
      templateTitle: template.title ?? ctx.templateTitle,
      term: template.term,
      segmentId,
      examScopeKey: '',
      rows: [],
      evaluationByGradeLevel: {},
      examByGradeLevel: {},
    },
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: subjectTasks.length > 0 || homeroomTasks.length > 0 ? 1 : 0,
      templateSubjects: template.subjects.length,
      skippedStaffingRows: 0,
      skippedNotInEvaluation: 0,
      portraitTeachers: 0,
    },
  };
}

export async function buildReportLoadPlanFromApi(
  fetchApi: ApiFetch,
  teacher: { id: string; displayName: string },
  templateTitle: string,
  term: Term,
): Promise<ReportLoadPlan> {
  const ctx = await loadReportApiSharedContext(fetchApi, templateTitle, term);
  const progressData = (await fetchApi(
    `/api/classes/reports/templates/${encodeURIComponent(ctx.template.id)}/my-progress`,
  )) as { progress: { classes: MyProgressClass[] } };
  const progressClasses = progressData.progress?.classes ?? [];
  if (progressClasses.length === 0) {
    throw new Error('my-progress 显示该教师在本报告下无可填写班级');
  }
  const plan = buildTeacherReportPlanFromContext(ctx, teacher, progressClasses);
  const examTaskCount = plan.subjectTasks.filter((t) => t.enableScore).length;
  console.log(`测评成绩任务: ${examTaskCount}/${plan.subjectTasks.length}`);
  return plan;
}

export function createBearerAuthProvider(token: string) {
  return async (_teacherId: string) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });
}

export function pickAdminCredential(creds: LoadTestCredentialsFile) {
  const admins = creds.users.filter((u) => u.role === 'system-admin' || u.role === 'admin');
  return admins[0] ?? null;
}

export async function loginAdminFromCredentials(
  apiBase: string,
  creds: LoadTestCredentialsFile,
): Promise<{ token: string; username: string }> {
  const admins = creds.users.filter((u) => u.role === 'system-admin' || u.role === 'admin');
  if (admins.length === 0) {
    throw new Error('credentials.local.json 中需要至少一个 admin 或 system-admin 账号');
  }
  const errors: string[] = [];
  for (const admin of admins) {
    try {
      const session = await loginWithPassword(apiBase, admin.username, admin.password);
      return { token: session.token, username: admin.username };
    } catch (e) {
      errors.push(`${admin.username}: ${(e as Error).message}`);
    }
  }
  throw new Error(`无法使用凭据文件中的管理员登录：\n${errors.join('\n')}`);
}
