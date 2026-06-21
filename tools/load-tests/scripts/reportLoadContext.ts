/**
 * 学业报告压测：按模板学科 + 岗位安排 + 学年评价/考试年级设置生成写入任务。
 */
import pg from 'pg';
import {
  DEFAULT_EXAM_GRADE_FULL_SCORE,
  effectiveTemplateSubjectEnableScore,
  examFullScoreFromGradeConfig,
  extractEvaluationGradeInclusion,
  extractExamGradeInclusion,
  isEvaluationGradeIncluded,
  isExamGradeIncluded,
  parseReportGradeDimensionSnapshots,
  reportExamScopeKey,
  resolveTemplateDimensionsForGrade,
  type ReportGradeDimensionSnapshot,
  type ReportYearInclusionPresetSlice,
} from '@repo/shared';
import { sanitizeExamConfigs } from '../../../apps/api/src/lib/reportExamConfigSanitize.js';
import {
  getGradeCatalogIdForClass,
  isClassInSegmentGrades,
  loadSchoolGradeStructure,
} from '../../../apps/api/src/lib/schoolGradeStructure.js';
import {
  loadYearPresetSubjectRows,
  resolveStaffingSubjectKeysForReportTemplate,
} from '../../../apps/api/src/lib/reportYearInclusionContext.js';

export type Term = 'Semester 1' | 'Semester 2';

export type TemplateSubject = {
  subjectKey: string;
  subjectName: string;
  enableScore: boolean;
  enableLearningQuality: boolean;
  gradeDimensions: ReportGradeDimensionSnapshot[];
  dimensions: Array<{ dimensionKey: string; dimensionLabel: string }>;
};

export type SubjectFillTask = {
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  classGrade: number;
  studentId: string;
  subjectKey: string;
  subjectName: string;
  enableScore: boolean;
  /** 考试学科本年级满分；非考试科为 null */
  examFullScore: number | null;
  dimensions: TemplateSubject['dimensions'];
  templateId: string;
  academicYearId: string;
  term: Term;
};

export type HomeroomFillTask = {
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  templateId: string;
  academicYearId: string;
  term: Term;
  homeroomCommentMode: string;
};

export type ReportTemplateSpec = {
  templateTitle: string;
  gradeMin: number;
  gradeMax: number;
  /** 默认 Semester 2（2025-26 下学期） */
  term?: Term;
};

export type ReportLoadSuite = {
  plans: ReportLoadPlan[];
  /** 合并后的执行计划（多学段任务并入同一并发池） */
  executionPlan: ReportLoadPlan;
  portraitTemplates: Array<{ id: string; title: string }>;
};

export type PortraitKissTask = {
  teacherId: string;
  teacherName: string;
  templateId: string;
  templateTitle: string;
};

export type ReportLoadPlan = {
  template: {
    id: string;
    academicYearId: string;
    term: Term;
    title: string;
    schoolSegmentId: string;
    homeroomCommentMode: string;
  };
  portraitTemplate: { id: string; title: string } | null;
  subjectTasks: SubjectFillTask[];
  homeroomTasks: HomeroomFillTask[];
  portraitKissTasks: PortraitKissTask[];
  subjectSettings: ReportSubjectSettingsSnapshot;
  stats: {
    classes: number;
    subjectTeachers: number;
    templateSubjects: number;
    skippedStaffingRows: number;
    skippedNotInEvaluation: number;
    portraitTeachers: number;
  };
};

export type GradeSubjectSettingRow = {
  gradeCatalogId: string;
  gradeLevel: number;
  subjectKey: string;
  subjectName: string;
  courseId: string | null;
  inTemplate: boolean;
  inEvaluation: boolean;
  isExam: boolean;
  templateEnableScore: boolean;
  effectiveEnableScore: boolean;
  dimensionCount: number;
};

export type ReportSubjectSettingsSnapshot = {
  templateId: string;
  templateTitle: string;
  term: Term;
  segmentId: string;
  examScopeKey: string;
  rows: GradeSubjectSettingRow[];
  /** grade level → subject names participating in evaluation */
  evaluationByGradeLevel: Record<number, string[]>;
  /** grade level → subject names participating in exam (测评成绩) */
  examByGradeLevel: Record<number, string[]>;
};

type GradeItem = { id: string; level: number };

function extractPresetSubjectsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const subs = (raw as { subjects?: unknown }).subjects;
    if (Array.isArray(subs)) return subs;
  }
  return [];
}

function buildSubjectKeyToCourseId(payload: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of extractPresetSubjectsArray(payload)) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const sk = String(rec.subjectKey ?? '').trim();
    const cid = String(rec.courseId ?? '').trim();
    if (sk && cid) out.set(sk, cid);
  }
  return out;
}

function extractStageInclusion(payload: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return out;
  const si = (payload as { stageInclusion?: unknown }).stageInclusion;
  if (!si || typeof si !== 'object' || Array.isArray(si)) return out;
  for (const [k, v] of Object.entries(si)) {
    const key = String(k).trim();
    if (!key || !Array.isArray(v)) continue;
    out[key] = v.map((x) => String(x).trim()).filter(Boolean);
  }
  return out;
}

async function getSchoolSettingsHolderUserId(pool: pg.Pool): Promise<string | null> {
  const sa = await pool.query(
    `SELECT id FROM users WHERE role = 'system-admin' ORDER BY created_at ASC NULLS LAST LIMIT 1`,
  );
  if (sa.rows[0]) return String((sa.rows[0] as { id: string }).id).trim();
  const ad = await pool.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC NULLS LAST LIMIT 1`);
  return (ad.rows[0] as { id: string } | undefined)?.id ? String((ad.rows[0] as { id: string }).id).trim() : null;
}

async function loadGradeStructureJson(pool: pg.Pool): Promise<unknown | null> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_settings (
      id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
      grade_structure JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by VARCHAR(50)
    )
  `);
  const school = await pool.query(`SELECT grade_structure FROM school_settings WHERE id = 'default' LIMIT 1`);
  const schoolRaw = school.rows[0]?.grade_structure;
  if (schoolRaw != null) return typeof schoolRaw === 'string' ? JSON.parse(schoolRaw) : schoolRaw;

  const holder = await getSchoolSettingsHolderUserId(pool);
  if (!holder) return null;
  const r = await pool.query(`SELECT grade_config FROM user_settings WHERE user_id = $1 LIMIT 1`, [holder]);
  const raw = r.rows[0]?.grade_config;
  return raw == null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function loadGradeConfigItemsForReport(pool: pg.Pool): Promise<GradeItem[]> {
  const fallback = () => Array.from({ length: 9 }, (_, i) => ({ id: `g${i + 1}`, level: i + 1 }));
  const parsed = await loadGradeStructureJson(pool);
  const items = (parsed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return fallback();
  const out: GradeItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const level = Number(rec.level);
    if (!id || !Number.isFinite(level)) continue;
    out.push({ id, level: Math.round(level) });
  }
  return out.length > 0 ? out.sort((a, b) => a.level - b.level) : fallback();
}

export function gradeCatalogIdForClass(items: GradeItem[], classGrade: number): string | null {
  return items.find((i) => i.level === classGrade)?.id ?? null;
}

export async function loadSegmentGradeIds(pool: pg.Pool, segmentId: string): Promise<string[]> {
  const sid = String(segmentId ?? '').trim();
  if (!sid) return [];
  const parsed = await loadGradeStructureJson(pool);
  const segments = (parsed as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return [];
  const hit = segments.find((s: unknown) => {
    if (!s || typeof s !== 'object') return false;
    return String((s as { id?: string }).id ?? '').trim() === sid;
  }) as { gradeIds?: unknown } | undefined;
  if (!hit || !Array.isArray(hit.gradeIds)) return [];
  return hit.gradeIds.map((g) => String(g ?? '').trim()).filter(Boolean);
}

export async function loadYearInclusionPayload(pool: pg.Pool, academicYearId: string) {
  const row = (
    await pool.query(
      `SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`,
      [academicYearId],
    )
  ).rows[0] as { payload: unknown } | undefined;
  const payload = row?.payload ?? {};
  return inclusionPayloadFromRawPreset(payload);
}

/** 与 GET /api/classes/reports/year-dimension-presets 返回的 preset 字段对齐 */
export function inclusionPayloadFromApiPreset(preset: {
  stageInclusion?: Record<string, string[]>;
  evaluationGradeInclusion?: unknown;
  examGradeInclusion?: unknown;
  examConfigs?: unknown;
  subjectKeyToCourseId?: Record<string, string>;
}): Awaited<ReturnType<typeof loadYearInclusionPayload>> {
  return {
    stageInclusion: preset.stageInclusion ?? {},
    evaluationGradeInclusion: extractEvaluationGradeInclusion(preset),
    examGradeInclusion: extractExamGradeInclusion(preset),
    examConfigs: sanitizeExamConfigs(
      preset.examConfigs != null ? { examConfigs: preset.examConfigs } : preset,
    ),
    subjectKeyToCourseId: new Map(Object.entries(preset.subjectKeyToCourseId ?? {})),
  };
}

function inclusionPayloadFromRawPreset(payload: unknown): Awaited<ReturnType<typeof loadYearInclusionPayload>> {
  return {
    stageInclusion: extractStageInclusion(payload),
    evaluationGradeInclusion: extractEvaluationGradeInclusion(payload),
    examGradeInclusion: extractExamGradeInclusion(payload),
    examConfigs: sanitizeExamConfigs(payload),
    subjectKeyToCourseId: buildSubjectKeyToCourseId(payload),
  };
}

export function subjectRequiredForClassGrade(
  subjectKey: string,
  segmentId: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  ctx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
): boolean {
  if (!segmentId || !gradeCatalogId) return true;
  const courseId = ctx.subjectKeyToCourseId.get(subjectKey);
  if (!courseId) return true;
  return isEvaluationGradeIncluded(
    segmentId,
    courseId,
    gradeCatalogId,
    segmentGradeIds,
    ctx.stageInclusion,
    ctx.evaluationGradeInclusion,
  );
}

function presetSliceFromLoadContext(
  ctx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
): ReportYearInclusionPresetSlice {
  const subjectKeyToCourseId: Record<string, string> = {};
  for (const [sk, cid] of ctx.subjectKeyToCourseId) {
    subjectKeyToCourseId[sk] = cid;
  }
  return {
    stageInclusion: ctx.stageInclusion,
    evaluationGradeInclusion: ctx.evaluationGradeInclusion,
    examGradeInclusion: ctx.examGradeInclusion,
    examConfigs: ctx.examConfigs,
    subjectKeyToCourseId,
  };
}

/** 读取考试学科本年级满分（与 API 校验一致） */
export function resolveExamFullScore(
  term: Term,
  segmentId: string,
  subjectKey: string,
  gradeCatalogId: string | null,
  ctx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
): number {
  const examKey = reportExamScopeKey(term, segmentId);
  const scope = ctx.examConfigs[examKey];
  if (!scope) return DEFAULT_EXAM_GRADE_FULL_SCORE;
  const examSubject = scope.subjects.find((s) => s.subjectKey === subjectKey);
  if (!examSubject) return DEFAULT_EXAM_GRADE_FULL_SCORE;
  const gradeConfigs = examSubject.gradeConfigs ?? [];
  const examG =
    (gradeCatalogId ? gradeConfigs.find((g) => g.gradeId === gradeCatalogId) : null)
    ?? gradeConfigs[0]
    ?? null;
  return examFullScoreFromGradeConfig(examG?.fullScore, examG?.percentBands);
}

/** 与 API / 教师工作台 / 学生端共用的测评成绩开关（学年模块化配置优先） */
export function effectiveEnableScore(
  term: Term,
  segmentId: string,
  subjectKey: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  templateEnableScore: boolean,
  ctx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
): boolean {
  return effectiveTemplateSubjectEnableScore(
    term,
    segmentId,
    subjectKey,
    gradeCatalogId,
    segmentGradeIds,
    templateEnableScore,
    presetSliceFromLoadContext(ctx),
  );
}

export async function buildReportSubjectSettingsSnapshot(
  pool: pg.Pool,
  templateRow: {
    id: string;
    title: string;
    term: Term;
    academic_year_id: string;
    school_segment_id: string;
  },
  subjectMap: Map<string, TemplateSubject>,
  inclusionCtx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
  segmentGradeIds: string[],
  gradeItems: GradeItem[],
): Promise<ReportSubjectSettingsSnapshot> {
  const segmentId = String(templateRow.school_segment_id ?? '').trim();
  const examScopeKey = reportExamScopeKey(templateRow.term, segmentId);
  const rows: GradeSubjectSettingRow[] = [];
  const evaluationByGradeLevel: Record<number, string[]> = {};
  const examByGradeLevel: Record<number, string[]> = {};

  const courseNameById = new Map<string, string>();
  const courseRows = (await pool.query(`SELECT id, name FROM courses`)).rows as Array<{
    id: string;
    name: string;
  }>;
  for (const c of courseRows) courseNameById.set(c.id, c.name);

  for (const gradeCatalogId of segmentGradeIds) {
    const gradeLevel = gradeItems.find((g) => g.id === gradeCatalogId)?.level ?? 0;
    if (!gradeLevel) continue;
    for (const [subjectKey, sub] of subjectMap) {
      const courseId = inclusionCtx.subjectKeyToCourseId.get(subjectKey) ?? null;
      const inEvaluation = courseId
        ? isEvaluationGradeIncluded(
            segmentId,
            courseId,
            gradeCatalogId,
            segmentGradeIds,
            inclusionCtx.stageInclusion,
            inclusionCtx.evaluationGradeInclusion,
          )
        : true;
      const isExam = courseId
        ? isExamGradeIncluded(
            templateRow.term,
            segmentId,
            courseId,
            gradeCatalogId,
            segmentGradeIds,
            inclusionCtx.stageInclusion,
            inclusionCtx.evaluationGradeInclusion,
            inclusionCtx.examGradeInclusion,
            inclusionCtx.examConfigs,
          )
        : sub.enableScore;
      const effectiveScore = effectiveEnableScore(
        templateRow.term,
        segmentId,
        subjectKey,
        gradeCatalogId,
        segmentGradeIds,
        sub.enableScore,
        inclusionCtx,
      );
      if (!inEvaluation) continue;
      const displayName =
        sub.subjectName || (courseId ? (courseNameById.get(courseId) ?? subjectKey) : subjectKey);
      const dimCount = resolveTemplateDimensionsForGrade(sub, gradeCatalogId).length;
      rows.push({
        gradeCatalogId,
        gradeLevel,
        subjectKey,
        subjectName: displayName,
        courseId,
        inTemplate: true,
        inEvaluation,
        isExam,
        templateEnableScore: sub.enableScore,
        effectiveEnableScore: effectiveScore,
        dimensionCount: dimCount,
      });
      if (!evaluationByGradeLevel[gradeLevel]) evaluationByGradeLevel[gradeLevel] = [];
      evaluationByGradeLevel[gradeLevel].push(displayName);
      if (isExam) {
        if (!examByGradeLevel[gradeLevel]) examByGradeLevel[gradeLevel] = [];
        examByGradeLevel[gradeLevel].push(displayName);
      }
    }
  }

  for (const level of Object.keys(evaluationByGradeLevel)) {
    evaluationByGradeLevel[Number(level)].sort((a, b) => a.localeCompare(b, 'zh'));
  }
  for (const level of Object.keys(examByGradeLevel)) {
    examByGradeLevel[Number(level)].sort((a, b) => a.localeCompare(b, 'zh'));
  }

  return {
    templateId: templateRow.id,
    templateTitle: templateRow.title,
    term: templateRow.term,
    segmentId,
    examScopeKey,
    rows,
    evaluationByGradeLevel,
    examByGradeLevel,
  };
}

export function printReportSubjectSettings(snapshot: ReportSubjectSettingsSnapshot): void {
  console.log('--- 学业报告学科设置（按年级） ---');
  console.log(`模板: ${snapshot.templateTitle} (${snapshot.templateId})`);
  console.log(`学期: ${snapshot.term} | 学段: ${snapshot.segmentId} | 考试范围: ${snapshot.examScopeKey}`);
  const levels = [
    ...new Set([
      ...Object.keys(snapshot.evaluationByGradeLevel).map(Number),
      ...Object.keys(snapshot.examByGradeLevel).map(Number),
    ]),
  ].sort((a, b) => a - b);
  for (const level of levels) {
    const evalSubs = snapshot.evaluationByGradeLevel[level] ?? [];
    const examSubs = snapshot.examByGradeLevel[level] ?? [];
    const nonExam = evalSubs.filter((n) => !examSubs.includes(n));
    console.log(`G${level} 参加评价 (${evalSubs.length}): ${evalSubs.join('、') || '—'}`);
    console.log(`     考试学科 (${examSubs.length}): ${examSubs.join('、') || '—'} → 需测评成绩 + 学科成绩分析`);
    console.log(`     非考试 (${nonExam.length}): ${nonExam.join('、') || '—'} → 仅目标等第 + 教学反思`);
  }
  console.log('');
}

async function resolvePortraitTemplate(
  pool: pg.Pool,
  portraitTitle: string | null | undefined,
  academicYearId: string,
): Promise<{ id: string; title: string } | null> {
  const title = String(portraitTitle ?? '').trim();
  if (!title) return null;
  const row = (
    await pool.query(
      `SELECT id, title FROM teacher_portrait_collection_templates
       WHERE academic_year_id = $1 AND status = 'published'
         AND (title = $2 OR title ILIKE $3)
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [academicYearId, title, `%${title}%`],
    )
  ).rows[0] as { id: string; title: string } | undefined;
  return row ? { id: row.id, title: row.title } : null;
}

export async function resolvePortraitTemplates(
  pool: pg.Pool,
  portraitTitles: string[],
  academicYearId: string,
): Promise<Array<{ id: string; title: string }>> {
  const out: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  for (const raw of portraitTitles) {
    const hit = await resolvePortraitTemplate(pool, raw, academicYearId);
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push(hit);
  }
  return out;
}

async function buildPortraitKissTasksForTeachers(
  pool: pg.Pool,
  academicYearId: string,
  gradeMin: number,
  gradeMax: number,
  portraitTemplates: Array<{ id: string; title: string }>,
): Promise<PortraitKissTask[]> {
  if (portraitTemplates.length === 0) return [];
  const teacherRows = (
    await pool.query(
      `SELECT DISTINCT u.id AS teacher_id,
              COALESCE(NULLIF(u.name_zh,''), u.display_name, u.username) AS teacher_name
       FROM users u
       WHERE u.role = 'teacher'
         AND u.id IN (
           SELECT a.teacher_id
           FROM class_subject_teacher_assignments a
           JOIN classes c ON c.id = a.class_id
           WHERE a.academic_year_id = $1
             AND c.grade BETWEEN $2 AND $3
             AND a.subject_key <> '__homeroom__'
           UNION
           SELECT a.teacher_id
           FROM class_teacher_assignments a
           JOIN classes c ON c.id = a.class_id
           WHERE c.academic_year_id = $1
             AND c.grade BETWEEN $2 AND $3
             AND a.role = 'homeroom'
             AND a.unassigned_at IS NULL
         )
       ORDER BY teacher_name ASC`,
      [academicYearId, gradeMin, gradeMax],
    )
  ).rows as Array<{ teacher_id: string; teacher_name: string }>;
  const tasks: PortraitKissTask[] = [];
  for (const t of teacherRows) {
    for (const pt of portraitTemplates) {
      tasks.push({
        teacherId: t.teacher_id,
        teacherName: t.teacher_name,
        templateId: pt.id,
        templateTitle: pt.title,
      });
    }
  }
  return tasks;
}

export function mergeReportLoadPlans(
  plans: ReportLoadPlan[],
  portraitKissTasks: PortraitKissTask[],
  portraitTemplates: Array<{ id: string; title: string }>,
): ReportLoadPlan {
  const first = plans[0];
  if (!first) {
    throw new Error('mergeReportLoadPlans: no plans');
  }
  const subjectTasks = plans.flatMap((p) => p.subjectTasks);
  const homeroomTasks = plans.flatMap((p) => p.homeroomTasks);
  return {
    template: first.template,
    portraitTemplate: portraitTemplates[0] ?? null,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks,
    subjectSettings: first.subjectSettings,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: new Set(subjectTasks.map((t) => t.teacherId)).size,
      templateSubjects: plans.reduce((n, p) => n + p.stats.templateSubjects, 0),
      skippedStaffingRows: plans.reduce((n, p) => n + p.stats.skippedStaffingRows, 0),
      skippedNotInEvaluation: plans.reduce((n, p) => n + p.stats.skippedNotInEvaluation, 0),
      portraitTeachers: new Set(portraitKissTasks.map((t) => t.teacherId)).size,
    },
  };
}

/** 先锋小学 + 先锋初中 两学段学业报告，合并并发执行 */
export async function buildReportLoadSuite(
  pool: pg.Pool,
  specs: ReportTemplateSpec[],
  portraitTemplateTitles: string[],
): Promise<ReportLoadSuite> {
  if (specs.length === 0) throw new Error('buildReportLoadSuite: no report template specs');
  const plans: ReportLoadPlan[] = [];
  for (const spec of specs) {
    const plan = await buildReportLoadPlan(
      pool,
      spec.templateTitle,
      spec.gradeMin,
      spec.gradeMax,
      null,
      spec.term,
    );
    plans.push(plan);
  }
  const academicYearId = plans[0].template.academicYearId;
  const gradeMin = Math.min(...specs.map((s) => s.gradeMin));
  const gradeMax = Math.max(...specs.map((s) => s.gradeMax));
  const portraitTemplates =
    portraitTemplateTitles.length > 0
      ? await resolvePortraitTemplates(pool, portraitTemplateTitles, academicYearId)
      : [];
  const portraitKissTasks =
    portraitTemplates.length > 0
      ? await buildPortraitKissTasksForTeachers(
          pool,
          academicYearId,
          gradeMin,
          gradeMax,
          portraitTemplates,
        )
      : [];
  const executionPlan = mergeReportLoadPlans(plans, portraitKissTasks, portraitTemplates);
  return { plans, executionPlan, portraitTemplates };
}

export async function buildReportLoadPlan(
  pool: pg.Pool,
  templateTitle: string,
  gradeMin = 4,
  gradeMax = 6,
  portraitTemplateTitle?: string | null,
  term?: Term,
): Promise<ReportLoadPlan> {
  const termFilter = term === 'Semester 1' || term === 'Semester 2' ? term : null;
  let templateRow = (
    await pool.query(
      `SELECT id, academic_year_id, term, status, title,
              COALESCE(school_segment_id, '') AS school_segment_id,
              homeroom_comment_mode
       FROM student_report_templates
       WHERE title = $1
         AND ($2::text IS NULL OR term = $2)
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [templateTitle, termFilter],
    )
  ).rows[0] as {
    id: string;
    academic_year_id: string;
    term: Term;
    status: string;
    title: string;
    school_segment_id: string;
    homeroom_comment_mode: string;
  } | undefined;

  if (!templateRow) {
    templateRow = (
      await pool.query(
        `SELECT id, academic_year_id, term, status, title,
                COALESCE(school_segment_id, '') AS school_segment_id,
                homeroom_comment_mode
         FROM student_report_templates
         WHERE title ILIKE $1 AND status = 'published'
           AND ($2::text IS NULL OR term = $2)
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [`%${templateTitle}%`, termFilter],
      )
    ).rows[0] as typeof templateRow;
  }
  if (!templateRow) {
    templateRow = (
      await pool.query(
        `SELECT id, academic_year_id, term, status, title,
                COALESCE(school_segment_id, '') AS school_segment_id,
                homeroom_comment_mode
         FROM student_report_templates
         WHERE status = 'published'
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
      )
    ).rows[0] as typeof templateRow;
  }
  if (!templateRow) throw new Error(`Template not found: ${templateTitle}`);
  if (templateRow.status !== 'published') throw new Error(`Template not published: ${templateRow.status}`);

  const segmentId = String(templateRow.school_segment_id ?? '').trim();
  const inclusionCtx = await loadYearInclusionPayload(pool, templateRow.academic_year_id);
  const gradeItems = await loadGradeConfigItemsForReport(pool);
  const segmentGradeIds = segmentId ? await loadSegmentGradeIds(pool, segmentId) : [];
  const gradeConfig = await loadSchoolGradeStructure();
  const classInTemplateSegment = (cls: { grade: number; name: string }) =>
    segmentGradeIds.length === 0
      || isClassInSegmentGrades(gradeConfig, cls, segmentGradeIds);

  const subjectsRows = (
    await pool.query(
      `SELECT subject_key, subject_name, enable_score, enable_learning_quality, grade_dimensions
       FROM student_report_template_subjects
       WHERE template_id = $1
       ORDER BY sort_order ASC`,
      [templateRow.id],
    )
  ).rows as Array<{
    subject_key: string;
    subject_name: string;
    enable_score: boolean;
    enable_learning_quality: boolean;
    grade_dimensions: unknown;
  }>;

  const dimsRows = (
    await pool.query(
      `SELECT s.subject_key, d.dimension_key, d.dimension_label
       FROM student_report_template_subjects s
       LEFT JOIN student_report_template_dimensions d ON d.template_subject_id = s.id
       WHERE s.template_id = $1`,
      [templateRow.id],
    )
  ).rows as Array<{ subject_key: string; dimension_key: string | null; dimension_label: string | null }>;

  const templateSubjectKeys = new Set(subjectsRows.map((s) => s.subject_key));
  const subjectMap = new Map<string, TemplateSubject>();
  for (const s of subjectsRows) {
    subjectMap.set(s.subject_key, {
      subjectKey: s.subject_key,
      subjectName: s.subject_name,
      enableScore: Boolean(s.enable_score),
      enableLearningQuality: s.enable_learning_quality !== false,
      gradeDimensions: parseReportGradeDimensionSnapshots(s.grade_dimensions),
      dimensions: [],
    });
  }
  for (const d of dimsRows) {
    const sub = subjectMap.get(d.subject_key);
    if (!sub || !d.dimension_key || !d.dimension_label) continue;
    sub.dimensions.push({ dimensionKey: d.dimension_key, dimensionLabel: d.dimension_label });
  }

  const evaluationSubjectKeys = resolveStaffingSubjectKeysForReportTemplate(
    [...templateSubjectKeys],
    segmentId,
    segmentGradeIds,
    inclusionCtx,
  );
  const libraryRows = await loadYearPresetSubjectRows(templateRow.academic_year_id);
  const libraryByKey = new Map(libraryRows.map((r) => [r.subjectKey, r] as const));
  for (const sk of evaluationSubjectKeys) {
    if (templateSubjectKeys.has(sk)) continue;
    templateSubjectKeys.add(sk);
    const lib = libraryByKey.get(sk);
    subjectMap.set(sk, {
      subjectKey: sk,
      subjectName: lib?.subjectNameZh || lib?.subjectNameEn || sk,
      enableScore: lib?.enableScore ?? true,
      enableLearningQuality: true,
      gradeDimensions: lib?.gradeDimensions ?? [],
      dimensions: (lib?.dimensions ?? []).map((d, i) => ({
        dimensionKey: `dim_${i}`,
        dimensionLabel: d.dimensionLabelZh || d.dimensionLabelEn,
      })),
    });
  }

  const assignmentRows = (
    await pool.query(
      `WITH g46 AS (
         SELECT id, name, grade FROM classes
         WHERE academic_year_id = $1 AND grade BETWEEN $2 AND $3
       ),
       st AS (
         SELECT DISTINCT e.student_id, e.class_id
         FROM student_enrollments e
         JOIN students s ON s.id = e.student_id
         WHERE e.academic_year_id = $1 AND s.status = 'active'
       )
       SELECT
         a.teacher_id,
         COALESCE(NULLIF(u.name_zh,''), u.display_name, u.username) AS teacher_name,
         c.id AS class_id,
         c.name AS class_name,
         c.grade AS class_grade,
         a.subject_key,
         a.subject_name,
         st.student_id
       FROM class_subject_teacher_assignments a
       JOIN g46 c ON c.id = a.class_id
       JOIN users u ON u.id = a.teacher_id
       JOIN st ON st.class_id = a.class_id
       WHERE a.academic_year_id = $1
         AND a.subject_key <> '__homeroom__'`,
      [templateRow.academic_year_id, gradeMin, gradeMax],
    )
  ).rows as Array<{
    teacher_id: string;
    teacher_name: string;
    class_id: string;
    class_name: string;
    class_grade: number;
    subject_key: string;
    subject_name: string;
    student_id: string;
  }>;

  let skippedStaffingRows = 0;
  let skippedNotInEvaluation = 0;
  const subjectTasks: SubjectFillTask[] = [];
  const staffingNameByKey = new Map<string, string>();
  const segmentAssignmentRows = assignmentRows.filter((r) =>
    classInTemplateSegment({ grade: Number(r.class_grade), name: r.class_name }),
  );

  for (const r of segmentAssignmentRows) {
    if (!staffingNameByKey.has(r.subject_key)) {
      staffingNameByKey.set(r.subject_key, r.subject_name);
    }
    const sub = subjectMap.get(r.subject_key);
    if (sub && staffingNameByKey.get(r.subject_key)) {
      sub.subjectName = staffingNameByKey.get(r.subject_key)!;
    }
  }

  for (const r of segmentAssignmentRows) {
    if (!templateSubjectKeys.has(r.subject_key)) {
      skippedStaffingRows += 1;
      continue;
    }
    const sub = subjectMap.get(r.subject_key);
    if (!sub) continue;
    const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, Number(r.class_grade), {
      className: r.class_name,
    });
    if (
      !subjectRequiredForClassGrade(r.subject_key, segmentId, gradeCatalogId, segmentGradeIds, inclusionCtx)
    ) {
      skippedNotInEvaluation += 1;
      continue;
    }
    const taskDimensions = resolveTemplateDimensionsForGrade(sub, gradeCatalogId).map((d) => ({
      dimensionKey: d.dimensionKey,
      dimensionLabel: d.dimensionLabel,
    }));
    const enableScore = effectiveEnableScore(
      templateRow.term,
      segmentId,
      r.subject_key,
      gradeCatalogId,
      segmentGradeIds,
      sub.enableScore,
      inclusionCtx,
    );
    subjectTasks.push({
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      classId: r.class_id,
      className: r.class_name,
      classGrade: Number(r.class_grade),
      studentId: r.student_id,
      subjectKey: r.subject_key,
      subjectName: staffingNameByKey.get(r.subject_key) ?? sub.subjectName,
      enableScore,
      examFullScore: enableScore
        ? resolveExamFullScore(templateRow.term, segmentId, r.subject_key, gradeCatalogId, inclusionCtx)
        : null,
      dimensions: taskDimensions,
      templateId: templateRow.id,
      academicYearId: templateRow.academic_year_id,
      term: templateRow.term,
    });
  }

  const homeroomRowsRaw = (
    await pool.query(
      `WITH g46 AS (
         SELECT id, name, grade FROM classes WHERE academic_year_id = $1 AND grade BETWEEN $2 AND $3
       ),
       st AS (
         SELECT e.student_id, e.class_id
         FROM student_enrollments e
         JOIN students s ON s.id = e.student_id
         WHERE e.academic_year_id = $1 AND s.status = 'active'
       )
       SELECT
         a.teacher_id,
         COALESCE(NULLIF(u.name_zh,''), u.display_name, u.username) AS teacher_name,
         c.id AS class_id,
         c.name AS class_name,
         c.grade AS class_grade,
         st.student_id,
         COALESCE(NULLIF(s.name_zh,''), s.name_en, s.name, st.student_id) AS student_name
       FROM class_teacher_assignments a
       JOIN g46 c ON c.id = a.class_id
       JOIN users u ON u.id = a.teacher_id
       JOIN st ON st.class_id = c.id
       JOIN students s ON s.id = st.student_id
       WHERE a.role = 'homeroom' AND a.unassigned_at IS NULL`,
      [templateRow.academic_year_id, gradeMin, gradeMax],
    )
  ).rows as Array<{
    teacher_id: string;
    teacher_name: string;
    class_id: string;
    class_name: string;
    class_grade: number;
    student_id: string;
    student_name: string;
  }>;

  const homeroomRows = homeroomRowsRaw.filter((r) =>
    classInTemplateSegment({ grade: Number(r.class_grade), name: r.class_name }),
  );

  const homeroomTasks: HomeroomFillTask[] = homeroomRows.map((r) => ({
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    classId: r.class_id,
    className: r.class_name,
    studentId: r.student_id,
    studentName: r.student_name,
    templateId: templateRow.id,
    academicYearId: templateRow.academic_year_id,
    term: templateRow.term,
    homeroomCommentMode: templateRow.homeroom_comment_mode,
  }));

  const portraitTemplate = portraitTemplateTitle
    ? await resolvePortraitTemplate(pool, portraitTemplateTitle, templateRow.academic_year_id)
    : null;
  const portraitKissTasks: PortraitKissTask[] = portraitTemplate
    ? await buildPortraitKissTasksForTeachers(
        pool,
        templateRow.academic_year_id,
        gradeMin,
        gradeMax,
        [portraitTemplate],
      )
    : [];

  const subjectSettings = await buildReportSubjectSettingsSnapshot(
    pool,
    templateRow,
    subjectMap,
    inclusionCtx,
    segmentGradeIds,
    gradeItems,
  );

  return {
    template: {
      id: templateRow.id,
      academicYearId: templateRow.academic_year_id,
      term: templateRow.term,
      title: templateRow.title,
      schoolSegmentId: segmentId,
      homeroomCommentMode: templateRow.homeroom_comment_mode,
    },
    portraitTemplate,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks,
    subjectSettings,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: new Set(subjectTasks.map((t) => t.teacherId)).size,
      templateSubjects: subjectsRows.length,
      skippedStaffingRows,
      skippedNotInEvaluation,
      portraitTeachers: portraitKissTasks.length,
    },
  };
}
