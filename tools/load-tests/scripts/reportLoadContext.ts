/**
 * 学业报告压测：按模板学科 + 岗位安排 + 学年评价/考试年级设置生成写入任务。
 */
import pg from 'pg';
import {
  extractEvaluationGradeInclusion,
  extractExamGradeInclusion,
  isEvaluationGradeIncluded,
  isExamGradeIncluded,
  reportExamScopeKey,
} from '@repo/shared';
import { sanitizeExamConfigs } from '../../../apps/api/src/lib/reportExamConfigSanitize.js';

export type Term = 'Semester 1' | 'Semester 2';

export type TemplateSubject = {
  subjectKey: string;
  subjectName: string;
  enableScore: boolean;
  enableLearningQuality: boolean;
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
  templateId: string;
  academicYearId: string;
  term: Term;
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
  subjectTasks: SubjectFillTask[];
  homeroomTasks: HomeroomFillTask[];
  subjectSettings: ReportSubjectSettingsSnapshot;
  stats: {
    classes: number;
    subjectTeachers: number;
    templateSubjects: number;
    skippedStaffingRows: number;
    skippedNotInEvaluation: number;
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

export function effectiveEnableScore(
  term: Term,
  segmentId: string,
  subjectKey: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  templateEnableScore: boolean,
  ctx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
): boolean {
  if (!segmentId || !gradeCatalogId) return templateEnableScore;
  const courseId = ctx.subjectKeyToCourseId.get(subjectKey);
  if (!courseId) return templateEnableScore;
  if (
    isExamGradeIncluded(
      term,
      segmentId,
      courseId,
      gradeCatalogId,
      segmentGradeIds,
      ctx.stageInclusion,
      ctx.evaluationGradeInclusion,
      ctx.examGradeInclusion,
      ctx.examConfigs,
    )
  ) {
    return true;
  }
  return templateEnableScore;
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
        dimensionCount: sub.dimensions.length,
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

export async function buildReportLoadPlan(
  pool: pg.Pool,
  templateTitle: string,
  gradeMin = 4,
  gradeMax = 6,
): Promise<ReportLoadPlan> {
  let templateRow = (
    await pool.query(
      `SELECT id, academic_year_id, term, status, title,
              COALESCE(school_segment_id, '') AS school_segment_id,
              homeroom_comment_mode
       FROM student_report_templates
       WHERE title = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [templateTitle],
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
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [`%${templateTitle}%`],
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

  const subjectsRows = (
    await pool.query(
      `SELECT subject_key, subject_name, enable_score, enable_learning_quality
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
      dimensions: [],
    });
  }
  for (const d of dimsRows) {
    const sub = subjectMap.get(d.subject_key);
    if (!sub || !d.dimension_key || !d.dimension_label) continue;
    sub.dimensions.push({ dimensionKey: d.dimension_key, dimensionLabel: d.dimension_label });
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

  for (const r of assignmentRows) {
    if (!templateSubjectKeys.has(r.subject_key)) {
      skippedStaffingRows += 1;
      continue;
    }
    const sub = subjectMap.get(r.subject_key);
    if (!sub) continue;
    const gradeCatalogId = gradeCatalogIdForClass(gradeItems, Number(r.class_grade));
    if (
      !subjectRequiredForClassGrade(r.subject_key, segmentId, gradeCatalogId, segmentGradeIds, inclusionCtx)
    ) {
      skippedNotInEvaluation += 1;
      continue;
    }
    subjectTasks.push({
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      classId: r.class_id,
      className: r.class_name,
      classGrade: Number(r.class_grade),
      studentId: r.student_id,
      subjectKey: r.subject_key,
      subjectName: sub.subjectName,
      enableScore: effectiveEnableScore(
        templateRow.term,
        segmentId,
        r.subject_key,
        gradeCatalogId,
        segmentGradeIds,
        sub.enableScore,
        inclusionCtx,
      ),
      dimensions: sub.dimensions,
      templateId: templateRow.id,
      academicYearId: templateRow.academic_year_id,
      term: templateRow.term,
    });
  }

  const homeroomRows = (
    await pool.query(
      `WITH g46 AS (
         SELECT id, name FROM classes WHERE academic_year_id = $1 AND grade BETWEEN $2 AND $3
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
         st.student_id
       FROM class_teacher_assignments a
       JOIN g46 c ON c.id = a.class_id
       JOIN users u ON u.id = a.teacher_id
       JOIN st ON st.class_id = c.id
       WHERE a.role = 'homeroom' AND a.unassigned_at IS NULL`,
      [templateRow.academic_year_id, gradeMin, gradeMax],
    )
  ).rows as Array<{
    teacher_id: string;
    teacher_name: string;
    class_id: string;
    class_name: string;
    student_id: string;
  }>;

  const homeroomTasks: HomeroomFillTask[] = homeroomRows.map((r) => ({
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    classId: r.class_id,
    className: r.class_name,
    studentId: r.student_id,
    templateId: templateRow.id,
    academicYearId: templateRow.academic_year_id,
    term: templateRow.term,
  }));

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
    subjectTasks,
    homeroomTasks,
    subjectSettings,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: new Set(subjectTasks.map((t) => t.teacherId)).size,
      templateSubjects: subjectsRows.length,
      skippedStaffingRows,
      skippedNotInEvaluation,
    },
  };
}
