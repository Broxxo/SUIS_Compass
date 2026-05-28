/**
 * 将 @repo/shared 中的小学段期中测试报告蓝图写入数据库（可重复执行）。
 */
import type { Pool } from 'pg';
import {
  MIDTERM_PRIMARY_G46_SUBJECTS,
  MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE,
  MIDTERM_PRIMARY_G46_UNIFIED_LEVEL_DESCRIPTIONS,
  type MidtermPrimaryDimensionDef,
  type MidtermPrimarySubjectBlueprint,
  defaultReportScoreGradeMinScores,
  staffingSubjectKeyFromCourse,
} from '@repo/shared';
import { sanitizeExamConfigs } from './reportExamConfigSanitize.js';

type Term = 'Semester 1' | 'Semester 2';
type TargetLevel = 'A' | 'B' | 'C' | 'D';

type GradeConfigItem = { id: string; label: string; level: number };
type GradeConfigSegment = { id: string; label: string; gradeIds: string[] };
type GradeConfig = { items: GradeConfigItem[]; segments?: GradeConfigSegment[] };

type CourseRow = {
  id: string;
  name: string;
  subject_category_zh: string | null;
};

export type ApplyMidtermPrimaryTestReportOptions = {
  academicYearId: string;
  term: Term;
  /** 默认自动解析 label 含「小学」的学段 */
  primarySegmentId?: string;
  publish?: boolean;
  release?: boolean;
};

export type ApplyMidtermPrimaryTestReportResult = {
  academicYearId: string;
  term: Term;
  primarySegmentId: string;
  templateId: string;
  courseIds: string[];
  examCourseIds: string[];
};

function rid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeIdentifier(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || 'item';
}

async function ensureReportTemplateTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_templates (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      title VARCHAR(200),
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      template_type VARCHAR(40) NOT NULL DEFAULT 'portrait-evaluation',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional',
      school_segment_id VARCHAR(120) NOT NULL DEFAULT '',
      created_by VARCHAR(50),
      updated_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      published_at TIMESTAMP,
      released_at TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_year_dimension_presets (
      academic_year_id VARCHAR(50) PRIMARY KEY REFERENCES academic_years(id) ON DELETE CASCADE,
      homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by VARCHAR(50),
      updated_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_template_subjects (
      id VARCHAR(100) PRIMARY KEY,
      template_id VARCHAR(100) NOT NULL REFERENCES student_report_templates(id) ON DELETE CASCADE,
      subject_key VARCHAR(255) NOT NULL,
      subject_name TEXT NOT NULL,
      subject_name_zh TEXT,
      subject_name_en TEXT,
      module_type VARCHAR(40) NOT NULL DEFAULT 'subject_score',
      enable_score BOOLEAN NOT NULL DEFAULT TRUE,
      enable_teacher_comment BOOLEAN NOT NULL DEFAULT TRUE,
      enable_learning_quality BOOLEAN NOT NULL DEFAULT TRUE,
      score_visibility VARCHAR(40) NOT NULL DEFAULT 'teacher_homeroom_admin',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_template_dimensions (
      id VARCHAR(100) PRIMARY KEY,
      template_subject_id VARCHAR(100) NOT NULL REFERENCES student_report_template_subjects(id) ON DELETE CASCADE,
      dimension_key VARCHAR(255) NOT NULL,
      dimension_label TEXT NOT NULL,
      dimension_label_zh TEXT,
      dimension_label_en TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_template_level_descriptions (
      id VARCHAR(100) PRIMARY KEY,
      template_dimension_id VARCHAR(100) NOT NULL REFERENCES student_report_template_dimensions(id) ON DELETE CASCADE,
      level VARCHAR(2) NOT NULL,
      description TEXT NOT NULL
    )
  `);
}

async function loadGradeConfig(_pool: Pool): Promise<GradeConfig> {
  const { loadSchoolGradeStructure } = await import('./schoolGradeStructure.js');
  const cfg = await loadSchoolGradeStructure();
  if (!cfg.items?.length) {
    throw new Error('school grade structure not found');
  }
  return cfg;
}

function resolvePrimarySegment(config: GradeConfig, override?: string): GradeConfigSegment {
  if (override?.trim()) {
    const hit = config.segments?.find((s) => s.id === override.trim());
    if (hit) return hit;
    throw new Error(`primarySegmentId not found: ${override}`);
  }
  const seg = config.segments?.find((s) => /小学|primary/i.test(s.label));
  if (!seg) throw new Error('No 小学 segment in grade_config.segments');
  return seg;
}

async function loadCourses(pool: Pool): Promise<CourseRow[]> {
  const r = await pool.query(`SELECT id, name, subject_category_zh FROM courses ORDER BY name ASC`);
  return r.rows as CourseRow[];
}

function resolveCourse(courses: CourseRow[], patterns: string[]): CourseRow | null {
  for (const p of patterns) {
    const hit = courses.find((c) => String(c.name).includes(p));
    if (hit) return hit;
  }
  return null;
}

function resolveSubjects(courses: CourseRow[]): Array<MidtermPrimarySubjectBlueprint & { courseId: string; subjectKey: string }> {
  const out: Array<MidtermPrimarySubjectBlueprint & { courseId: string; subjectKey: string }> = [];
  const used = new Set<string>();
  for (const bp of MIDTERM_PRIMARY_G46_SUBJECTS) {
    const course = resolveCourse(courses, bp.courseNamePatterns);
    if (!course) {
      throw new Error(
        `Course not found for ${bp.subjectNameZh}. Add a course matching: ${bp.courseNamePatterns.join(' | ')}`,
      );
    }
    if (used.has(course.id)) continue;
    used.add(course.id);
    const subjectKey = staffingSubjectKeyFromCourse(course.id, course.name);
    out.push({ ...bp, courseId: course.id, subjectKey });
  }
  return out;
}

function buildPresetSubjectRow(
  bp: MidtermPrimarySubjectBlueprint & { courseId: string; subjectKey: string },
  gradeIds: string[],
) {
  const dimensions = bp.dimensions.map((d) => ({
    dimensionLabelZh: d.dimensionLabelZh,
    dimensionLabelEn: d.dimensionLabelEn,
    levelDescriptions: {} as Partial<Record<TargetLevel, string>>,
  }));
  const gradeDimensions = gradeIds.map((gradeId) => ({ gradeId, dimensions }));
  return {
    courseId: bp.courseId,
    subjectKey: bp.subjectKey,
    subjectNameZh: bp.subjectNameZh,
    subjectNameEn: bp.subjectNameEn,
    enableScore: bp.enableScore,
    enableTeacherComment: bp.enableTeacherComment,
    enableTarget: bp.enableTarget,
    gradeDimensions,
    dimensions,
  };
}

function buildExamDimensionScores(dims: MidtermPrimaryDimensionDef[]) {
  return dims
    .filter((d) => d.examMaxScore != null && Number.isFinite(d.examMaxScore))
    .map((d) => ({
      dimensionLabelZh: d.dimensionLabelZh,
      dimensionLabelEn: d.dimensionLabelEn,
      score: d.examMaxScore as number,
    }));
}

function examScopeKey(term: Term, schoolSegmentId: string): string {
  return `${term}::${schoolSegmentId.trim()}`;
}

async function mergeYearPreset(
  pool: Pool,
  academicYearId: string,
  primarySegment: GradeConfigSegment,
  resolved: Array<MidtermPrimarySubjectBlueprint & { courseId: string; subjectKey: string }>,
  term: Term,
): Promise<void> {
  const gradeIds = primarySegment.gradeIds;
  const courseIds = resolved.map((s) => s.courseId);
  const examCourseIds = resolved.filter((s) => s.enableScore).map((s) => s.courseId);

  const existingRow = (
    await pool.query(`SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`, [
      academicYearId,
    ])
  ).rows[0] as { payload: unknown } | undefined;

  const existingPayload =
    existingRow?.payload && typeof existingRow.payload === 'object' && !Array.isArray(existingRow.payload)
      ? (existingRow.payload as Record<string, unknown>)
      : {};

  const existingSubjects = Array.isArray(existingPayload.subjects) ? [...(existingPayload.subjects as unknown[])] : [];
  const byKey = new Map<string, unknown>();
  for (const row of existingSubjects) {
    const rec = row as Record<string, unknown>;
    const k = String(rec.subjectKey ?? '').trim();
    if (k) byKey.set(k, row);
  }
  for (const bp of resolved) {
    byKey.set(bp.subjectKey, buildPresetSubjectRow(bp, gradeIds));
  }

  const stageInclusion =
    existingPayload.stageInclusion && typeof existingPayload.stageInclusion === 'object' && !Array.isArray(existingPayload.stageInclusion)
      ? { ...(existingPayload.stageInclusion as Record<string, string[]>) }
      : {};
  stageInclusion[primarySegment.id] = courseIds;

  const evaluationGradeInclusion =
    existingPayload.evaluationGradeInclusion
    && typeof existingPayload.evaluationGradeInclusion === 'object'
    && !Array.isArray(existingPayload.evaluationGradeInclusion)
      ? { ...(existingPayload.evaluationGradeInclusion as Record<string, Record<string, string[]>>) }
      : {};
  const evalByCourse: Record<string, string[]> = {};
  for (const cid of courseIds) evalByCourse[cid] = [...gradeIds];
  evaluationGradeInclusion[primarySegment.id] = evalByCourse;

  const examGradeInclusion =
    existingPayload.examGradeInclusion
    && typeof existingPayload.examGradeInclusion === 'object'
    && !Array.isArray(existingPayload.examGradeInclusion)
      ? { ...(existingPayload.examGradeInclusion as Record<string, Record<string, string[]>>) }
      : {};
  const examByCourse: Record<string, string[]> = {};
  for (const cid of examCourseIds) examByCourse[cid] = [...gradeIds];
  examGradeInclusion[examScopeKey(term, primarySegment.id)] = examByCourse;

  const examConfigsRaw =
    existingPayload.examConfigs && typeof existingPayload.examConfigs === 'object' && !Array.isArray(existingPayload.examConfigs)
      ? { ...(existingPayload.examConfigs as Record<string, unknown>) }
      : {};

  const percentBands = defaultReportScoreGradeMinScores();
  const examSubjects = resolved
    .filter((s) => s.enableScore)
    .map((s) => ({
      courseId: s.courseId,
      subjectKey: s.subjectKey,
      subjectNameZh: s.subjectNameZh,
      subjectNameEn: s.subjectNameEn,
      gradeConfigs: gradeIds.map((gradeId) => ({
        gradeId,
        percentBands,
        dimensionScores: buildExamDimensionScores(s.dimensions),
      })),
    }));

  examConfigsRaw[examScopeKey(term, primarySegment.id)] = {
    subjectInclusion: examCourseIds,
    subjects: examSubjects,
  };

  const payload = JSON.stringify({
    ...existingPayload,
    subjects: Array.from(byKey.values()),
    stageInclusion,
    evaluationGradeInclusion,
    examGradeInclusion,
    examConfigs: sanitizeExamConfigs({ examConfigs: examConfigsRaw }),
    unifiedLevelDescriptions: MIDTERM_PRIMARY_G46_UNIFIED_LEVEL_DESCRIPTIONS,
  });

  await pool.query(
    `INSERT INTO student_report_year_dimension_presets
      (academic_year_id, homeroom_comment_mode, payload, updated_at)
     VALUES ($1, 'optional', $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (academic_year_id) DO UPDATE
     SET homeroom_comment_mode = 'optional',
         payload = EXCLUDED.payload,
         updated_at = CURRENT_TIMESTAMP`,
    [academicYearId, payload],
  );
}

async function upsertTemplateSubjects(
  pool: Pool,
  templateId: string,
  resolved: Array<MidtermPrimarySubjectBlueprint & { courseId: string; subjectKey: string }>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
  await client.query(
    `DELETE FROM student_report_template_level_descriptions
     WHERE template_dimension_id IN (
       SELECT d.id FROM student_report_template_dimensions d
       JOIN student_report_template_subjects s ON s.id = d.template_subject_id
       WHERE s.template_id = $1
     )`,
    [templateId],
  );
  await client.query(
    `DELETE FROM student_report_template_dimensions
     WHERE template_subject_id IN (SELECT id FROM student_report_template_subjects WHERE template_id = $1)`,
    [templateId],
  );
  await client.query(`DELETE FROM student_report_template_subjects WHERE template_id = $1`, [templateId]);

  const usedSubjectKeys = new Set<string>();
  for (let i = 0; i < resolved.length; i += 1) {
    const bp = resolved[i];
    let subjectKey = normalizeIdentifier(bp.subjectKey);
    let seq = 2;
    while (usedSubjectKeys.has(subjectKey)) {
      subjectKey = `${normalizeIdentifier(bp.subjectKey)}_${seq}`;
      seq += 1;
    }
    usedSubjectKeys.add(subjectKey);

    const moduleType = bp.enableScore ? 'subject_score' : bp.enableTeacherComment ? 'subject_comment' : 'non_score_comment';
    const subjectId = rid('srts');
    await client.query(
      `INSERT INTO student_report_template_subjects
        (id, template_id, subject_key, subject_name, subject_name_zh, subject_name_en, module_type,
         enable_score, enable_teacher_comment, enable_learning_quality, score_visibility, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        subjectId,
        templateId,
        subjectKey,
        bp.subjectNameZh,
        bp.subjectNameZh,
        bp.subjectNameEn,
        moduleType,
        bp.enableScore,
        bp.enableTeacherComment,
        bp.enableLearningQuality,
        'teacher_homeroom_admin',
        i,
      ],
    );

    const usedDimKeys = new Set<string>();
    for (let j = 0; j < bp.dimensions.length; j += 1) {
      const d = bp.dimensions[j];
      const dimLabelEn = d.dimensionLabelEn.trim();
      let dimKey = normalizeIdentifier(dimLabelEn);
      let dimSeq = 2;
      while (usedDimKeys.has(dimKey)) {
        dimKey = `${normalizeIdentifier(dimLabelEn)}_${dimSeq}`;
        dimSeq += 1;
      }
      usedDimKeys.add(dimKey);
      const dimId = rid('srtd');
      await client.query(
        `INSERT INTO student_report_template_dimensions
          (id, template_subject_id, dimension_key, dimension_label, dimension_label_zh, dimension_label_en, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dimId, subjectId, dimKey, d.dimensionLabelZh, d.dimensionLabelZh, dimLabelEn, j],
      );
      for (const lv of ['A', 'B', 'C', 'D'] as const) {
        const text = MIDTERM_PRIMARY_G46_UNIFIED_LEVEL_DESCRIPTIONS[lv];
        await client.query(
          `INSERT INTO student_report_template_level_descriptions (id, template_dimension_id, level, description)
           VALUES ($1, $2, $3, $4)`,
          [rid('srtdl'), dimId, lv, text],
        );
      }
    }
  }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function applyMidtermPrimaryTestReport(
  pool: Pool,
  options: ApplyMidtermPrimaryTestReportOptions,
): Promise<ApplyMidtermPrimaryTestReportResult> {
  await ensureReportTemplateTables(pool);

  const gradeConfig = await loadGradeConfig(pool);
  const primarySegment = resolvePrimarySegment(gradeConfig, options.primarySegmentId);
  const courses = await loadCourses(pool);
  const resolved = resolveSubjects(courses);

  const sumCheck = (label: string, dims: MidtermPrimaryDimensionDef[]) => {
    const sum = dims.reduce((a, d) => a + (d.examMaxScore ?? 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.01) {
      throw new Error(`${label} exam dimension max scores must sum to 100 (got ${sum})`);
    }
  };
  for (const s of resolved) {
    if (s.enableScore) sumCheck(s.subjectNameZh, s.dimensions);
  }

  await mergeYearPreset(pool, options.academicYearId, primarySegment, resolved, options.term);

  const existing = (
    await pool.query(
      `SELECT id FROM student_report_templates
       WHERE academic_year_id = $1 AND term = $2 AND school_segment_id = $3 AND title = $4
       LIMIT 1`,
      [options.academicYearId, options.term, primarySegment.id, MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE],
    )
  ).rows[0] as { id: string } | undefined;

  let templateId = existing?.id ?? rid('srt');
  if (!existing) {
    await pool.query(
      `INSERT INTO student_report_templates
        (id, academic_year_id, term, title, status, template_type, is_active, homeroom_comment_mode, school_segment_id)
       VALUES ($1, $2, $3, $4, 'draft', 'portrait-evaluation', TRUE, 'optional', $5)`,
      [templateId, options.academicYearId, options.term, MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE, primarySegment.id],
    );
  } else {
    await pool.query(
      `UPDATE student_report_templates SET homeroom_comment_mode = 'optional', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [templateId],
    );
  }

  await upsertTemplateSubjects(pool, templateId, resolved);

  if (options.publish) {
    await pool.query(
      `UPDATE student_report_templates
       SET status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [templateId],
    );
  }
  if (options.release) {
    await pool.query(
      `UPDATE student_report_templates
       SET status = 'published', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [templateId],
    );
  }

  return {
    academicYearId: options.academicYearId,
    term: options.term,
    primarySegmentId: primarySegment.id,
    templateId,
    courseIds: resolved.map((s) => s.courseId),
    examCourseIds: resolved.filter((s) => s.enableScore).map((s) => s.courseId),
  };
}
