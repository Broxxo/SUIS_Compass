import express, { type Request, type Response, type NextFunction } from 'express';
import pool from '../config/database.js';
import { buildAcademicYearPromotionPreview, promoteAcademicYearToNext, buildAcademicYearUndoPreview, undoAcademicYearPromotion, prepareAcademicYearPromotionDependencies } from '../lib/academicYearPromotion.js';
import { setCanonicalConfigAcademicYearId, resolveConfigAcademicYearId } from '../lib/canonicalAcademicConfig.js';
import { ensureClassArchiveColumns } from '../lib/classArchiveColumns.js';
import { ensureClassTeacherAssignmentsTable } from '../lib/ensureClassTeacherAssignmentsTable.js';
import { ensureStaffingTables } from '../lib/ensureStaffingTables.js';
import { upsertHomeroomStaffingFromClassTables } from '../lib/homeroomStaffingSync.js';
import {
  getGradeHeadClassIdsForTeacher,
  getGradeHeadClassIdsForTeacherQuery,
  teacherIsGradeHeadOfClass,
  teacherIsGradeHeadOfStudent,
} from '../lib/gradeHeadAccess.js';
import { sanitizeExamConfigs } from '../lib/reportExamConfigSanitize.js';
import {
  effectiveTemplateSubjectEnableScore,
  ensureReportYearDimensionPresetTable,
  filterClassIdsForReportSegment,
  filterSubjectsForGradeCatalog,
  resolveReportTemplateSubjectsFromLibrary,
  filterTeacherSubjectByClassForReportTemplate,
  getGradeCatalogIdForClass,
  isTemplateSubjectRequiredForGrade,
  loadReportYearInclusionContext,
  loadSchoolGradeStructure,
  loadSegmentGradeIds,
  resolveStaffingSubjectKeysForReportTemplate,
  staffingSubjectKeysForTemplateSubjectAtGrade,
  isClassInSegmentGrades,
  type ReportYearInclusionContext,
} from '../lib/reportYearInclusionContext.js';
import {
  configuredReportScoreGradeMins,
  examFullScoreFromGradeConfig,
  mergeReportScoreGradeMinScores,
  reportLetterGradeFromExamPercentBands,
  reportLetterGradeFromScore,
  parseReportGradeDimensionSnapshots,
  reportScoreLetterGradeToTargetLevel,
  resolveTemplateDimensionsForGrade,
  STAFFING_HOMEROOM_SUBJECT_KEY,
  type ReportGradeDimensionSnapshot,
  type ReportScoreLetterGrade,
} from '@repo/shared';
import { createRunOnce } from '../lib/runOnce.js';
import { ensureGradeLevelConstraints } from '../lib/ensureGradeLevelConstraints.js';
import {
  ensureTeacherPortraitCollectionTables,
  emptyTeachingDiagnosis as portraitEmptyDiagnosis,
  getTeacherDepartment,
  getTeacherPortraitTemplateById,
  parseTargetDepartments,
  parseTeachingDiagnosis as parsePortraitDiagnosis,
  teacherMatchesTargetDepartments,
  teachingDiagnosisHasContent as portraitDiagnosisHasContent,
  type TeachingDiagnosisPayload as PortraitDiagnosisPayload,
} from '../lib/teacherPortraitCollections.js';
import {
  buildSubjectGroupPortraitDashboard,
  listPortraitSubjectGroups,
} from '../lib/subjectGroupPortraitDashboard.js';

type ReqWithUserId = Request & { userId?: string };
type Term = 'Semester 1' | 'Semester 2';
type ReportGrade = ReportScoreLetterGrade;
type TargetLevel = 'A' | 'B' | 'C' | 'D';
type TemplateStatus = 'draft' | 'published' | 'closed';
type HomeroomCommentMode = 'disabled' | 'optional' | 'required';

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type TeachingDiagnosisPayload = { keep: string; improve: string; stop: string; start: string };

function emptyTeachingDiagnosis(): TeachingDiagnosisPayload {
  return { keep: '', improve: '', stop: '', start: '' };
}

function parseTeachingDiagnosisFromDb(
  diagnosisRaw: unknown,
  legacyReflection: string | null,
): TeachingDiagnosisPayload {
  if (diagnosisRaw && typeof diagnosisRaw === 'object' && !Array.isArray(diagnosisRaw)) {
    const rec = diagnosisRaw as Record<string, unknown>;
    return {
      keep: String(rec.keep ?? '').trim(),
      improve: String(rec.improve ?? '').trim(),
      stop: String(rec.stop ?? '').trim(),
      start: String(rec.start ?? '').trim(),
    };
  }
  const legacy = String(legacyReflection ?? '').trim();
  if (!legacy) return emptyTeachingDiagnosis();
  return { keep: '', improve: '', stop: '', start: legacy };
}

function teachingDiagnosisHasContent(d: TeachingDiagnosisPayload): boolean {
  return Boolean(d.keep || d.improve || d.stop || d.start);
}

function parseWeaknessRowsFromDb(raw: unknown): Array<{ weakPoint: string; errorAnalysis: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => row as Record<string, unknown>)
    .map((row) => ({
      weakPoint: String(row.weakPoint ?? '').trim(),
      errorAnalysis: String(row.errorAnalysis ?? '').trim(),
    }))
    .filter((row) => row.weakPoint || row.errorAnalysis);
}

function parseStudentAnalysisRowsFromDb(raw: unknown): Array<{ studentId: string; learningAnalysis: string; supportPlan: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => row as Record<string, unknown>)
    .map((row) => ({
      studentId: String(row.studentId ?? '').trim(),
      learningAnalysis: String(row.learningAnalysis ?? row.learning_analysis ?? '').trim(),
      supportPlan: String(row.supportPlan ?? row.support_plan ?? '').trim(),
    }))
    .filter((row) => row.studentId && (row.learningAnalysis || row.supportPlan));
}

function toReportGrade(score: number | null | undefined, mins: Partial<Record<string, number>> | null): ReportGrade | null {
  return reportLetterGradeFromScore(score, mins);
}

const portraitTablesOnce = createRunOnce();
const gradeConstraintsOnce = createRunOnce();

async function ensureStudentPortraitTables(): Promise<void> {
  await gradeConstraintsOnce.run(() => ensureGradeLevelConstraints(pool));
  await portraitTablesOnce.run(async () => {
  await pool.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS name_zh VARCHAR(100),
      ADD COLUMN IF NOT EXISTS name_en VARCHAR(100),
      ADD COLUMN IF NOT EXISTS current_grade INTEGER,
      ADD COLUMN IF NOT EXISTS current_class_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS division VARCHAR(50),
      ADD COLUMN IF NOT EXISTS entry_date DATE,
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'active'
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_number_unique ON students(student_number) WHERE student_number IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_current_class_id ON students(current_class_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_status ON students(status)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_unique_per_year ON student_enrollments(student_id, academic_year_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_assignment_history (
      id VARCHAR(80) PRIMARY KEY,
      student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      class_id VARCHAR(50) REFERENCES classes(id) ON DELETE SET NULL,
      grade INTEGER CHECK (grade >= 1 AND grade <= 12),
      division VARCHAR(50),
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
      effective_to DATE,
      source VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'promotion', 'import', 'sync')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profile_modules (
      id VARCHAR(80) PRIMARY KEY,
      key VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      description TEXT,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profile_module_fields (
      id VARCHAR(80) PRIMARY KEY,
      module_id VARCHAR(80) NOT NULL REFERENCES student_profile_modules(id) ON DELETE CASCADE,
      field_key VARCHAR(80) NOT NULL,
      label VARCHAR(120) NOT NULL,
      field_type VARCHAR(30) NOT NULL CHECK (field_type IN ('text', 'number', 'single-select', 'multi-select', 'score')),
      score_min NUMERIC,
      score_max NUMERIC,
      options JSONB,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(module_id, field_key)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profile_values (
      id VARCHAR(100) PRIMARY KEY,
      student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      module_id VARCHAR(80) NOT NULL REFERENCES student_profile_modules(id) ON DELETE CASCADE,
      field_key VARCHAR(80) NOT NULL,
      value_json JSONB NOT NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, module_id, field_key)
    );
  `);
  await pool.query(`
    INSERT INTO student_profile_modules (id, key, name, description, is_system, is_enabled)
    VALUES ('spm-ability', 'ability', '能力画像', '能力雷达图模块，默认分值范围 0-10', TRUE, TRUE)
    ON CONFLICT (key) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_term_reports (
      id VARCHAR(100) PRIMARY KEY,
      student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      template_id VARCHAR(100),
      homeroom_comment TEXT,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, academic_year_id, term, template_id)
    );
  `);
  await pool.query(`ALTER TABLE student_term_reports ADD COLUMN IF NOT EXISTS template_id VARCHAR(100)`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'student_term_reports_student_id_academic_year_id_term_key'
      ) THEN
        ALTER TABLE student_term_reports DROP CONSTRAINT student_term_reports_student_id_academic_year_id_term_key;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_student_term_reports_student_term_template_unique
      ON student_term_reports(student_id, academic_year_id, term, COALESCE(template_id, ''))
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_term_subject_reports (
      id VARCHAR(100) PRIMARY KEY,
      report_id VARCHAR(100) NOT NULL REFERENCES student_term_reports(id) ON DELETE CASCADE,
      subject_key VARCHAR(80) NOT NULL,
      subject_name VARCHAR(120) NOT NULL,
      midterm_score NUMERIC(5,2),
      midterm_grade VARCHAR(10),
      final_score NUMERIC(5,2),
      final_grade VARCHAR(10),
      teacher_comment TEXT,
      learning_quality_grade VARCHAR(2),
      teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(report_id, subject_key)
    );
  `);
  await pool.query(
    `ALTER TABLE student_term_subject_reports ADD COLUMN IF NOT EXISTS learning_quality_grade VARCHAR(2)`,
  );
  await pool.query(
    `ALTER TABLE student_term_subject_reports ADD COLUMN IF NOT EXISTS exam_dimension_scores JSONB`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_term_target_dimensions (
      id VARCHAR(100) PRIMARY KEY,
      subject_report_id VARCHAR(100) NOT NULL REFERENCES student_term_subject_reports(id) ON DELETE CASCADE,
      dimension_key VARCHAR(80) NOT NULL,
      dimension_label VARCHAR(120) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subject_report_id, dimension_key)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_term_target_level_descriptions (
      id VARCHAR(100) PRIMARY KEY,
      dimension_id VARCHAR(100) NOT NULL REFERENCES student_term_target_dimensions(id) ON DELETE CASCADE,
      level VARCHAR(1) NOT NULL CHECK (level IN ('A', 'B', 'C', 'D')),
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(dimension_id, level)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_term_target_ratings (
      id VARCHAR(100) PRIMARY KEY,
      subject_report_id VARCHAR(100) NOT NULL REFERENCES student_term_subject_reports(id) ON DELETE CASCADE,
      dimension_id VARCHAR(100) NOT NULL REFERENCES student_term_target_dimensions(id) ON DELETE CASCADE,
      rating VARCHAR(1) NOT NULL CHECK (rating IN ('A', 'B', 'C', 'D')),
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subject_report_id, dimension_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_term_reports_student
      ON student_term_reports(student_id, academic_year_id, term, template_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_term_subject_reports_report
      ON student_term_subject_reports(report_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_term_target_dimensions_subject
      ON student_term_target_dimensions(subject_report_id, sort_order)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_term_target_ratings_subject
      ON student_term_target_ratings(subject_report_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_templates (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      title VARCHAR(160),
      template_type VARCHAR(40) NOT NULL DEFAULT 'portrait-evaluation',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      published_at TIMESTAMP,
      released_at TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
      homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK (homeroom_comment_mode IN ('disabled', 'optional', 'required')),
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'student_report_templates_academic_year_id_term_key'
      ) THEN
        ALTER TABLE student_report_templates DROP CONSTRAINT student_report_templates_academic_year_id_term_key;
      END IF;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE student_report_templates
    ADD COLUMN IF NOT EXISTS homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional'
  `);
  await pool.query(`ALTER TABLE student_report_templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(40) NOT NULL DEFAULT 'portrait-evaluation'`);
  await pool.query(`ALTER TABLE student_report_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE student_report_templates ADD COLUMN IF NOT EXISTS published_at TIMESTAMP`);
  await pool.query(`ALTER TABLE student_report_templates ADD COLUMN IF NOT EXISTS released_at TIMESTAMP`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'student_term_reports_template_id_fkey'
      ) THEN
        ALTER TABLE student_term_reports
          ADD CONSTRAINT student_term_reports_template_id_fkey
          FOREIGN KEY (template_id) REFERENCES student_report_templates(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_template_subjects (
      id VARCHAR(100) PRIMARY KEY,
      template_id VARCHAR(100) NOT NULL REFERENCES student_report_templates(id) ON DELETE CASCADE,
      subject_key VARCHAR(80) NOT NULL,
      subject_name VARCHAR(120) NOT NULL,
      subject_name_zh VARCHAR(120) NOT NULL DEFAULT '',
      subject_name_en VARCHAR(120) NOT NULL DEFAULT '',
      module_type VARCHAR(30) NOT NULL DEFAULT 'subject_score',
      enable_score BOOLEAN NOT NULL DEFAULT TRUE,
      enable_teacher_comment BOOLEAN NOT NULL DEFAULT TRUE,
      score_visibility VARCHAR(40) NOT NULL DEFAULT 'teacher_homeroom_admin',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(template_id, subject_key)
    );
  `);
  await pool.query(`ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS subject_name_zh VARCHAR(120) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS subject_name_en VARCHAR(120) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS module_type VARCHAR(30) NOT NULL DEFAULT 'subject_score'`);
  await pool.query(`ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS enable_score BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS enable_teacher_comment BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS score_visibility VARCHAR(40) NOT NULL DEFAULT 'teacher_homeroom_admin'`);
  await pool.query(
    `ALTER TABLE student_report_template_subjects ADD COLUMN IF NOT EXISTS enable_learning_quality BOOLEAN NOT NULL DEFAULT TRUE`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_template_dimensions (
      id VARCHAR(100) PRIMARY KEY,
      template_subject_id VARCHAR(100) NOT NULL REFERENCES student_report_template_subjects(id) ON DELETE CASCADE,
      dimension_key VARCHAR(80) NOT NULL,
      dimension_label VARCHAR(120) NOT NULL,
      dimension_label_zh VARCHAR(120) NOT NULL DEFAULT '',
      dimension_label_en VARCHAR(120) NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(template_subject_id, dimension_key)
    );
  `);
  await pool.query(`ALTER TABLE student_report_template_dimensions ADD COLUMN IF NOT EXISTS dimension_label_zh VARCHAR(120) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE student_report_template_dimensions ADD COLUMN IF NOT EXISTS dimension_label_en VARCHAR(120) NOT NULL DEFAULT ''`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_template_level_descriptions (
      id VARCHAR(100) PRIMARY KEY,
      template_dimension_id VARCHAR(100) NOT NULL REFERENCES student_report_template_dimensions(id) ON DELETE CASCADE,
      level VARCHAR(1) NOT NULL CHECK (level IN ('A', 'B', 'C', 'D')),
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(template_dimension_id, level)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_report_templates_year_term
      ON student_report_templates(academic_year_id, term)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_report_templates_year_term_title
      ON student_report_templates(academic_year_id, term, title)
  `);
  await pool.query(
    `ALTER TABLE student_report_templates ADD COLUMN IF NOT EXISTS school_segment_id VARCHAR(120) NOT NULL DEFAULT ''`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_score_grade_bands (
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      school_segment_id VARCHAR(120) NOT NULL DEFAULT '',
      min_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (academic_year_id, term, school_segment_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_report_score_grade_bands_year
      ON student_report_score_grade_bands(academic_year_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_subject_class_insights (
      id VARCHAR(80) PRIMARY KEY,
      template_id VARCHAR(100) NOT NULL REFERENCES student_report_templates(id) ON DELETE CASCADE,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_key VARCHAR(255) NOT NULL,
      weakness_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      teaching_reflection TEXT,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(template_id, class_id, subject_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_report_subject_class_insights_lookup
      ON student_report_subject_class_insights(template_id, class_id, subject_key)
  `);
  await pool.query(`
    ALTER TABLE student_report_subject_class_insights
      ADD COLUMN IF NOT EXISTS student_analysis_rows JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE student_report_subject_class_insights
      ADD COLUMN IF NOT EXISTS teaching_diagnosis JSONB
  `);
  await pool.query(`
    ALTER TABLE student_report_subject_class_insights
      ADD COLUMN IF NOT EXISTS class_overall_analysis TEXT
  `);
  await pool.query(`
    DO $widen$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'student_report_template_subjects'
          AND c.column_name = 'subject_name_zh' AND c.data_type = 'character varying'
      ) THEN
        ALTER TABLE student_report_template_subjects
          ALTER COLUMN subject_name TYPE TEXT,
          ALTER COLUMN subject_name_zh TYPE TEXT,
          ALTER COLUMN subject_name_en TYPE TEXT;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'student_report_template_subjects'
          AND c.column_name = 'subject_key' AND c.data_type = 'character varying'
          AND c.character_maximum_length IS NOT NULL AND c.character_maximum_length < 200
      ) THEN
        ALTER TABLE student_report_template_subjects
          ALTER COLUMN subject_key TYPE VARCHAR(255);
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'student_report_template_dimensions'
          AND c.column_name = 'dimension_label_zh' AND c.data_type = 'character varying'
      ) THEN
        ALTER TABLE student_report_template_dimensions
          ALTER COLUMN dimension_label TYPE TEXT,
          ALTER COLUMN dimension_label_zh TYPE TEXT,
          ALTER COLUMN dimension_label_en TYPE TEXT;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'student_report_template_dimensions'
          AND c.column_name = 'dimension_key' AND c.data_type = 'character varying'
          AND c.character_maximum_length IS NOT NULL AND c.character_maximum_length < 200
      ) THEN
        ALTER TABLE student_report_template_dimensions
          ALTER COLUMN dimension_key TYPE VARCHAR(255);
      END IF;
    END $widen$
  `);
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS grade');
  });
}

async function getUserRole(req: ReqWithUserId): Promise<string | null> {
  const userId = req.userId;
  if (!userId) return null;
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return (result.rows[0]?.role as string | undefined) ?? null;
}

async function isAdmin(req: ReqWithUserId): Promise<boolean> {
  const role = await getUserRole(req);
  return role === 'system-admin' || role === 'admin';
}

async function isSystemAdmin(req: ReqWithUserId): Promise<boolean> {
  const role = await getUserRole(req);
  return role === 'system-admin';
}

function requireAdmin(getHandler: (req: ReqWithUserId, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const ext = req as ReqWithUserId;
    const ok = await isAdmin(ext);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: admin only' });
      return;
    }
    return getHandler(ext, res);
  };
}

function requireSystemAdmin(getHandler: (req: ReqWithUserId, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const ext = req as ReqWithUserId;
    const ok = await isSystemAdmin(ext);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: system admin only' });
      return;
    }
    return getHandler(ext, res);
  };
}

async function canUserAccessStudent(req: ReqWithUserId, studentId: string, requireHomeroom: boolean): Promise<boolean> {
  const userId = req.userId;
  if (!userId) return false;
  const role = await getUserRole(req);
  if (role === 'system-admin' || role === 'admin') return true;
  if (role === 'student') {
    if (requireHomeroom) return false;
    const link = await pool.query('SELECT student_id FROM users WHERE id = $1', [userId]);
    const sid = link.rows[0]?.student_id as string | null | undefined;
    return !!sid && sid === studentId;
  }
  await ensureStaffingTables();
  const homeroomOnly = requireHomeroom ? "AND a.role = 'homeroom'" : '';
  const result = await pool.query(
    `SELECT 1
     FROM student_enrollments e
     WHERE e.student_id = $2
       AND (
         EXISTS (
           SELECT 1 FROM class_teacher_assignments a
           WHERE a.class_id = e.class_id
             AND a.teacher_id = $1
             AND a.unassigned_at IS NULL
             ${homeroomOnly}
         )
         OR (
           $3::boolean = false
           AND EXISTS (
             SELECT 1 FROM class_subject_teacher_assignments s
             WHERE s.academic_year_id = e.academic_year_id
               AND s.class_id = e.class_id
               AND s.teacher_id = $1
           )
         )
       )
     LIMIT 1`,
    [userId, studentId, requireHomeroom],
  );
  if ((result.rowCount ?? 0) > 0) return true;
  if (requireHomeroom || role !== 'teacher') return false;
  return teacherIsGradeHeadOfStudent(userId, studentId);
}

async function canHomeroomEditComment(req: ReqWithUserId, studentId: string): Promise<boolean> {
  const userId = req.userId;
  if (!userId) return false;
  const role = await getUserRole(req);
  if (role === 'system-admin' || role === 'admin') return true;
  if (role === 'student') return false;
  const result = await pool.query(
    `SELECT 1
     FROM student_enrollments e
     JOIN class_teacher_assignments a
       ON a.class_id = e.class_id
      AND a.teacher_id = $1
      AND a.role = 'homeroom'
      AND a.unassigned_at IS NULL
     WHERE e.student_id = $2
     LIMIT 1`,
    [userId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function assertTeacherUser(teacherId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM users
     WHERE id = $1 AND role = 'teacher'
     LIMIT 1`,
    [teacherId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function enrollmentClassForStudentYear(studentId: string, academicYearId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT class_id FROM student_enrollments WHERE student_id = $1 AND academic_year_id = $2 LIMIT 1`,
    [studentId, academicYearId],
  );
  return (r.rows[0]?.class_id as string | undefined) ?? null;
}

async function gradeCatalogIdForStudentEnrollment(
  studentId: string,
  academicYearId: string,
): Promise<string | null> {
  const classId = await enrollmentClassForStudentYear(studentId, academicYearId);
  if (!classId) return null;
  const row = (
    await pool.query(`SELECT grade, name FROM classes WHERE id = $1 LIMIT 1`, [classId])
  ).rows[0] as { grade: number; name: string } | undefined;
  if (!row) return null;
  const classGrade = Number(row.grade);
  if (!Number.isFinite(classGrade)) return null;
  const gradeConfig = await loadSchoolGradeStructure();
  return getGradeCatalogIdForClass(gradeConfig, classGrade, {
    className: String(row.name ?? ''),
  });
}

async function teacherTeachesSubjectInClass(
  teacherId: string,
  academicYearId: string,
  classId: string,
  subjectKey: string,
): Promise<boolean> {
  await ensureStaffingTables();
  const r = await pool.query(
    `SELECT 1 FROM class_subject_teacher_assignments
     WHERE academic_year_id = $1 AND class_id = $2 AND subject_key = $3 AND teacher_id = $4
     LIMIT 1`,
    [academicYearId, classId, subjectKey, teacherId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function teacherCanFillTemplateSubjectInClass(
  teacherId: string,
  academicYearId: string,
  classId: string,
  templateSubjectKey: string,
  templateSubjectKeys: string[],
  segmentId: string,
  ctx: ReportYearInclusionContext,
): Promise<boolean> {
  const classRow = (
    await pool.query(
      `SELECT grade, name FROM classes WHERE id = $1 AND academic_year_id = $2 LIMIT 1`,
      [classId, academicYearId],
    )
  ).rows[0] as { grade: number; name: string } | undefined;
  if (!classRow) return false;
  const gradeConfig = await loadSchoolGradeStructure();
  const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, Number(classRow.grade), {
    className: String(classRow.name ?? ''),
  });
  const segmentGradeIds = segmentId ? await loadSegmentGradeIds(segmentId) : [];
  const acceptableKeys = staffingSubjectKeysForTemplateSubjectAtGrade(
    templateSubjectKey,
    templateSubjectKeys,
    gradeCatalogId,
    segmentId,
    segmentGradeIds,
    ctx,
  );
  for (const sk of acceptableKeys) {
    if (await teacherTeachesSubjectInClass(teacherId, academicYearId, classId, sk)) return true;
  }
  return false;
}

async function teacherIsHomeroomOfClass(teacherId: string, classId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM class_teacher_assignments
     WHERE class_id = $1 AND teacher_id = $2 AND role = 'homeroom' AND unassigned_at IS NULL
     LIMIT 1`,
    [classId, teacherId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function getOrCreateTermReport(
  client: { query: typeof pool.query },
  studentId: string,
  academicYearId: string,
  term: Term,
  templateId: string | null,
  operatorId: string | null
): Promise<string> {
  // 同一学生+学年+学期+模板：多科教师并发写入时只创建一条 term report（事务级 advisory lock）
  await client.query(
    `SELECT pg_advisory_xact_lock(
      hashtextextended($1 || '|' || $2 || '|' || $3 || '|' || COALESCE($4, ''), 0)
    )`,
    [studentId, academicYearId, term, templateId],
  );
  const existing = await client.query(
    `SELECT id FROM student_term_reports
     WHERE student_id = $1 AND academic_year_id = $2 AND term = $3 AND COALESCE(template_id, '') = COALESCE($4, '')
     LIMIT 1`,
    [studentId, academicYearId, term, templateId]
  );
  if ((existing.rowCount ?? 0) > 0) {
    return existing.rows[0].id as string;
  }
  const id = createId('str');
  try {
    await client.query(
      `INSERT INTO student_term_reports (
        id, student_id, academic_year_id, term, template_id, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, studentId, academicYearId, term, templateId, operatorId, operatorId],
    );
    return id;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') {
      const again = await client.query(
        `SELECT id FROM student_term_reports
         WHERE student_id = $1 AND academic_year_id = $2 AND term = $3 AND COALESCE(template_id, '') = COALESCE($4, '')
         LIMIT 1`,
        [studentId, academicYearId, term, templateId],
      );
      if ((again.rowCount ?? 0) > 0) {
        return again.rows[0].id as string;
      }
    }
    throw e;
  }
}

async function loadScoreMinScoresForBand(
  academicYearId: string,
  term: Term,
  schoolSegmentId: string,
): Promise<Record<ReportScoreLetterGrade, number>> {
  const seg = String(schoolSegmentId ?? '').trim();
  const r = await pool.query(
    `SELECT min_scores FROM student_report_score_grade_bands
     WHERE academic_year_id = $1 AND term = $2 AND school_segment_id = $3`,
    [academicYearId, term, seg],
  );
  const raw = r.rows[0]?.min_scores;
  return mergeReportScoreGradeMinScores(raw as Partial<Record<string, number>> | null);
}

type ExamGradeCfgRow = {
  gradeId: string;
  fullScore?: number;
  percentBands: Partial<Record<ReportGrade, number>>;
  dimensionScores: Array<{ dimensionLabelZh: string; dimensionLabelEn: string; score: number }>;
};

function pickExamGradeConfig(gradeConfigs: ExamGradeCfgRow[], gradeCatalogId: string | null): ExamGradeCfgRow | null {
  if (gradeConfigs.length === 0) return null;
  if (gradeCatalogId) {
    const hit = gradeConfigs.find((g) => g.gradeId === gradeCatalogId);
    if (hit) return hit;
  }
  return gradeConfigs[0] ?? null;
}

function resolveSubjectAssessmentGradeFromDb(
  storedGrade: string | null,
  storedScore: number | null,
  subjectKey: string,
  template: { term: Term; schoolSegmentId: string | null; scoreGradeMinScores: Partial<Record<string, number>> | null },
  gradeCatalogId: string | null,
  examConfigs: ReturnType<typeof sanitizeExamConfigs>,
): ReportGrade | null {
  const trimmed = String(storedGrade ?? '').trim();
  if (trimmed) return trimmed as ReportGrade;
  if (storedScore == null || !Number.isFinite(storedScore)) return null;
  const examKey = `${template.term}::${String(template.schoolSegmentId ?? '').trim()}`;
  const examScope = examConfigs[examKey];
  const examSubject = examScope?.subjects?.find((s) => s.subjectKey === subjectKey);
  const examG = pickExamGradeConfig(examSubject?.gradeConfigs ?? [], gradeCatalogId);
  const configuredBands = configuredReportScoreGradeMins(examG?.percentBands ?? {});
  const hasExamBands = Object.keys(configuredBands).length > 0;
  if (hasExamBands) {
    return reportLetterGradeFromExamPercentBands(storedScore, examG?.fullScore, examG?.percentBands);
  }
  return toReportGrade(storedScore, template.scoreGradeMinScores);
}

function matchDimensionMaxByKey(
  templateDims: Array<{ dimensionKey: string; dimensionLabelZh: string; dimensionLabelEn: string }>,
  examDims: Array<{ dimensionLabelZh: string; dimensionLabelEn: string; score: number }>,
): Map<string, number> {
  const byLabel = new Map<string, number>();
  for (const e of examDims) {
    byLabel.set(`${e.dimensionLabelZh.trim()}\t${e.dimensionLabelEn.trim()}`, e.score);
  }
  const out = new Map<string, number>();
  for (let i = 0; i < templateDims.length; i += 1) {
    const d = templateDims[i];
    const key = String(d.dimensionKey ?? '').trim();
    if (!key) continue;
    const zh = String(d.dimensionLabelZh ?? '').trim();
    const en = String(d.dimensionLabelEn ?? '').trim();
    let max = zh && en ? byLabel.get(`${zh}\t${en}`) : undefined;
    if (max == null) max = examDims[i]?.score;
    if (max != null && Number.isFinite(max) && max > 0) out.set(key, max);
  }
  return out;
}

async function loadSanitizedExamConfigsForYear(academicYearId: string): Promise<ReturnType<typeof sanitizeExamConfigs>> {
  await ensureReportYearDimensionPresetTable();
  const effectiveYearId = await resolveConfigAcademicYearId(academicYearId);
  const row = (await pool.query(`SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`, [
    effectiveYearId,
  ])).rows[0] as { payload: unknown } | undefined;
  if (!row) return {};
  return sanitizeExamConfigs(row.payload);
}

function templateSubjectsForGradeCatalog<
  T extends {
    subjectKey?: string;
    dimensions?: Array<{
      id: string;
      dimensionKey: string;
      dimensionLabel: string;
      dimensionLabelZh?: string;
      dimensionLabelEn?: string;
      sortOrder: number;
      levelDescriptions?: Partial<Record<TargetLevel, string>>;
    }>;
    gradeDimensions?: ReportGradeDimensionSnapshot[];
  },
>(subjects: T[], gradeCatalogId: string | null): T[] {
  if (!gradeCatalogId) return subjects;
  return subjects.map((s) => ({
    ...s,
    dimensions: resolveTemplateDimensionsForGrade(s, gradeCatalogId) as T['dimensions'],
  }));
}

async function getTemplateById(templateId: string) {
  const template = (await pool.query(
    `SELECT id, academic_year_id, term, status, title, homeroom_comment_mode, template_type, is_active, published_at, released_at,
            COALESCE(school_segment_id, '') AS school_segment_id
     FROM student_report_templates
     WHERE id = $1
     LIMIT 1`,
    [templateId]
  )).rows[0] as {
    id: string;
    academic_year_id: string;
    term: Term;
    status: TemplateStatus;
    title: string | null;
    homeroom_comment_mode: HomeroomCommentMode | null;
    template_type: 'portrait-evaluation' | null;
    is_active: boolean | null;
    published_at: Date | null;
    released_at: Date | null;
    school_segment_id: string;
  } | undefined;
  if (!template) return null;
  const rows = (await pool.query(
    `SELECT s.id AS subject_id, s.subject_key, s.subject_name, s.subject_name_zh, s.subject_name_en,
            s.module_type, s.enable_score, s.enable_teacher_comment, s.enable_learning_quality, s.score_visibility, s.sort_order,
            s.grade_dimensions,
            d.id AS dimension_id, d.dimension_key, d.dimension_label, d.dimension_label_zh, d.dimension_label_en, d.sort_order AS dimension_sort,
            ld.level, ld.description
     FROM student_report_template_subjects s
     LEFT JOIN student_report_template_dimensions d ON d.template_subject_id = s.id
     LEFT JOIN student_report_template_level_descriptions ld ON ld.template_dimension_id = d.id
     WHERE s.template_id = $1
     ORDER BY s.sort_order ASC, d.sort_order ASC, ld.level ASC`,
    [template.id]
  )).rows as Array<{
    subject_id: string;
    subject_key: string;
    subject_name: string;
    subject_name_zh: string;
    subject_name_en: string;
    module_type: 'subject_score' | 'subject_comment' | 'non_score_comment' | null;
    enable_score: boolean | null;
    enable_teacher_comment: boolean | null;
    enable_learning_quality: boolean | null;
    score_visibility: 'teacher_homeroom_admin' | null;
    sort_order: number;
    grade_dimensions: unknown;
    dimension_id: string | null;
    dimension_key: string | null;
    dimension_label: string | null;
    dimension_label_zh: string | null;
    dimension_label_en: string | null;
    dimension_sort: number | null;
    level: TargetLevel | null;
    description: string | null;
  }>;

  const subjectMap = new Map<string, {
    id: string;
    subjectKey: string;
    subjectName: string;
    subjectNameZh: string;
    subjectNameEn: string;
    moduleType: 'subject_score' | 'subject_comment' | 'non_score_comment';
    enableScore: boolean;
    enableTeacherComment: boolean;
    enableLearningQuality: boolean;
    scoreVisibility: 'teacher_homeroom_admin';
    sortOrder: number;
    gradeDimensions: ReportGradeDimensionSnapshot[];
    dimensions: Array<{
      id: string;
      dimensionKey: string;
      dimensionLabel: string;
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      sortOrder: number;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>;
  }>();
  const dimMapBySubject = new Map<string, Map<string, {
    id: string;
    dimensionKey: string;
    dimensionLabel: string;
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    sortOrder: number;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>>();

  for (const row of rows) {
    const s = subjectMap.get(row.subject_id) ?? {
      id: row.subject_id,
      subjectKey: row.subject_key,
      subjectName: row.subject_name,
      subjectNameZh: row.subject_name_zh || row.subject_name,
      subjectNameEn: row.subject_name_en || row.subject_name,
      moduleType: (row.module_type ?? 'subject_score') as 'subject_score' | 'subject_comment' | 'non_score_comment',
      enableScore: row.enable_score !== false,
      enableTeacherComment: row.enable_teacher_comment !== false,
      enableLearningQuality: row.enable_learning_quality !== false,
      scoreVisibility: (row.score_visibility ?? 'teacher_homeroom_admin') as 'teacher_homeroom_admin',
      sortOrder: row.sort_order,
      gradeDimensions: parseReportGradeDimensionSnapshots(row.grade_dimensions),
      dimensions: [],
    };
    subjectMap.set(row.subject_id, s);
    if (!row.dimension_id) continue;
    const dimMap = dimMapBySubject.get(row.subject_id) ?? new Map();
    const d = dimMap.get(row.dimension_id) ?? {
      id: row.dimension_id,
      dimensionKey: row.dimension_key ?? '',
      dimensionLabel: row.dimension_label ?? '',
      dimensionLabelZh: row.dimension_label_zh ?? row.dimension_label ?? '',
      dimensionLabelEn: row.dimension_label_en ?? row.dimension_label ?? '',
      sortOrder: row.dimension_sort ?? 0,
      levelDescriptions: {},
    };
    if (row.level && row.description) d.levelDescriptions[row.level] = row.description;
    dimMap.set(row.dimension_id, d);
    dimMapBySubject.set(row.subject_id, dimMap);
  }
  for (const [subjectId, subject] of subjectMap.entries()) {
    subject.dimensions = Array.from((dimMapBySubject.get(subjectId) ?? new Map()).values())
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const schoolSegmentId = String(template.school_segment_id ?? '').trim();
  const scoreGradeMinScores = await loadScoreMinScoresForBand(template.academic_year_id, template.term, schoolSegmentId);
  return {
    id: template.id,
    academicYearId: template.academic_year_id,
    term: template.term,
    status: template.status,
    title: template.title ?? null,
    templateType: template.template_type ?? 'portrait-evaluation',
    isActive: template.is_active !== false,
    publishedAt: template.published_at?.toISOString() ?? null,
    releasedAt: template.released_at?.toISOString() ?? null,
    homeroomCommentMode: template.homeroom_comment_mode ?? 'optional',
    schoolSegmentId,
    scoreGradeMinScores,
    subjects: Array.from(subjectMap.values()).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

type ReportWorkflowTemplate = NonNullable<Awaited<ReturnType<typeof getTemplateForReportWorkflow>>>;

/** 学生报告详情接口下发的模板元数据（含学年/学期/学段，供前端判断测评成绩是否展示）。 */
function reportTemplateClientView(
  template: ReportWorkflowTemplate,
  subjects: ReportWorkflowTemplate['subjects'],
) {
  return {
    id: template.id,
    academicYearId: template.academicYearId,
    term: template.term,
    status: template.status,
    title: template.title,
    schoolSegmentId: template.schoolSegmentId,
    scoreGradeMinScores: template.scoreGradeMinScores,
    homeroomCommentMode: template.homeroomCommentMode,
    subjects,
  };
}

/** 报告读写流程：从学年模板库 + 参评设置合成有效学科（与课程管理 subject_key 一致）。 */
async function getTemplateForReportWorkflow(templateId: string) {
  const template = await getTemplateById(templateId);
  if (!template) return null;
  const inclusionCtx = await loadReportYearInclusionContext(template.academicYearId);
  const segmentId = String(template.schoolSegmentId ?? '').trim();
  const segmentGradeIds = segmentId ? await loadSegmentGradeIds(segmentId) : [];
  const subjects = await resolveReportTemplateSubjectsFromLibrary(
    template.subjects,
    segmentId,
    segmentGradeIds,
    inclusionCtx,
    template.academicYearId,
  );
  return { ...template, subjects };
}

async function listTemplatesForTerm(academicYearId: string, term: Term, schoolSegmentId?: string | null) {
  const params: unknown[] = [academicYearId, term];
  let segFilter = '';
  if (schoolSegmentId && String(schoolSegmentId).trim()) {
    params.push(String(schoolSegmentId).trim());
    segFilter = ` AND (COALESCE(school_segment_id, '') = '' OR school_segment_id = $${params.length})`;
  }
  const rows = (await pool.query(
    `SELECT id
     FROM student_report_templates
     WHERE academic_year_id = $1 AND term = $2${segFilter}
     ORDER BY updated_at DESC NULLS LAST`,
    params
  )).rows as Array<{ id: string }>;
  const templates: Array<Awaited<ReturnType<typeof getTemplateForReportWorkflow>>> = [];
  for (const row of rows) {
    const tpl = await getTemplateForReportWorkflow(row.id);
    if (tpl) templates.push(tpl);
  }
  return templates.filter((t): t is NonNullable<typeof t> => !!t);
}

function requireStudentProfileEditor(getHandler: (req: ReqWithUserId, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const ext = req as ReqWithUserId;
    const studentId = req.params.studentId as string | undefined;
    if (!studentId) {
      res.status(400).json({ error: 'studentId required' });
      return;
    }
    const ok = await canUserAccessStudent(ext, studentId, true);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: homeroom/admin only for student profile edit' });
      return;
    }
    return getHandler(ext, res);
  };
}

const router = express.Router();

/** 学生账号仅允许 GET：本校画像模块、本人学籍行、本人画像分值 */
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const ext = req as ReqWithUserId;
  const role = await getUserRole(ext);
  if (role !== 'student') {
    next();
    return;
  }
  if (req.method !== 'GET') {
    res.status(403).json({ error: 'Forbidden: student accounts are read-only on class APIs' });
    return;
  }
  const path = req.path;
  if (
    path === '/students' ||
    path === '/profile/modules' ||
    /^\/profile\/students\/[^/]+\/values$/.test(path) ||
    /^\/reports\/templates\/[^/]+\/[^/]+$/.test(path) ||
    /^\/reports\/templates\/[^/]+$/.test(path) ||
    /^\/reports\/students\/[^/]+$/.test(path) ||
    /^\/reports\/students\/[^/]+\/terms\/[^/]+\/[^/]+\/templates\/[^/]+$/.test(path)
  ) {
    next();
    return;
  }
  res.status(403).json({ error: 'Forbidden: students may only access their own portrait data' });
});

// ---------- 学年 ----------
router.get('/academic-years', async (req: ReqWithUserId, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, start_date, end_date, is_current FROM academic_years ORDER BY start_date DESC NULLS LAST, name ASC'
    );
    const years = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      startDate: r.start_date?.toISOString().slice(0, 10),
      endDate: r.end_date?.toISOString().slice(0, 10),
      isCurrent: !!r.is_current,
    }));
    res.json({ years });
  } catch (e) {
    console.error('get academic-years', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/current-year', async (_req: ReqWithUserId, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, start_date, end_date, is_current FROM academic_years WHERE is_current = TRUE LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.json({ year: null });
    }
    const r = result.rows[0];
    res.json({
      year: {
        id: r.id,
        name: r.name,
        startDate: r.start_date?.toISOString().slice(0, 10),
        endDate: r.end_date?.toISOString().slice(0, 10),
        isCurrent: true,
      },
    });
  } catch (e) {
    console.error('get current-year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/current-year', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { academicYearId } = req.body || {};
    if (!academicYearId) { res.status(400).json({ error: 'academicYearId required' }); return; }
    await pool.query('UPDATE academic_years SET is_current = FALSE');
    await pool.query('UPDATE academic_years SET is_current = TRUE WHERE id = $1', [academicYearId]);
    res.json({ success: true });
  } catch (e) {
    console.error('put current-year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post('/academic-years', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { id, name, startDate, endDate, isCurrent } = req.body || {};
    if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (isCurrent) {
      await pool.query('UPDATE academic_years SET is_current = FALSE');
    }
    await pool.query(
      'INSERT INTO academic_years (id, name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name = $2, start_date = $3, end_date = $4, is_current = $5, updated_at = CURRENT_TIMESTAMP',
      [id, name, start, end, !!isCurrent]
    );
    const row = (await pool.query('SELECT id, name, start_date, end_date, is_current FROM academic_years WHERE id = $1', [id])).rows[0];
    res.status(201).json({
      id: row.id,
      name: row.name,
      startDate: row.start_date?.toISOString().slice(0, 10),
      endDate: row.end_date?.toISOString().slice(0, 10),
      isCurrent: !!row.is_current,
    });
  } catch (e) {
    console.error('post academic-years', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/academic-years/:yearId', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { yearId } = req.params;
    if (!yearId) { res.status(400).json({ error: 'yearId required' }); return; }
    await pool.query('UPDATE academic_years SET is_current = FALSE WHERE id = $1', [yearId]);
    await pool.query('DELETE FROM student_enrollments WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = $1)', [yearId]);
    await pool.query('DELETE FROM classes WHERE academic_year_id = $1', [yearId]);
    const del = await pool.query('DELETE FROM academic_years WHERE id = $1 RETURNING id', [yearId]);
    if (del.rowCount === 0) { res.status(404).json({ error: 'Academic year not found' }); return; }
    res.json({ success: true });
  } catch (e) {
    console.error('delete academic-year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 班级 ----------
router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureClassArchiveColumns(pool);
    const academicYearId = req.query.academicYearId as string | undefined;
    const role = await getUserRole(req);
    const params: unknown[] = [];
    let sql = 'SELECT id, academic_year_id, grade, name, teacher_id, archived_at, archive_label FROM classes';
    const where: string[] = [];
    if (academicYearId) {
      params.push(academicYearId);
      where.push(`academic_year_id = $${params.length}`);
    }
    if (role !== 'system-admin' && role !== 'admin') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await ensureStaffingTables();
      params.push(req.userId);
      const tid = `$${params.length}`;
      const gradeHeadClassIds = await getGradeHeadClassIdsForTeacherQuery(req.userId, academicYearId);
      let teacherScopeSql = `(
        EXISTS (
          SELECT 1 FROM class_teacher_assignments a
          WHERE a.class_id = classes.id
            AND a.teacher_id = ${tid}
            AND a.unassigned_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM class_subject_teacher_assignments s
          WHERE s.class_id = classes.id
            AND s.academic_year_id = classes.academic_year_id
            AND s.teacher_id = ${tid}
        )`;
      if (gradeHeadClassIds.length > 0) {
        params.push(gradeHeadClassIds);
        teacherScopeSql += `
        OR classes.id = ANY($${params.length}::varchar[])`;
      }
      teacherScopeSql += ')';
      where.push(teacherScopeSql);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY grade ASC, name ASC';
    const result = await pool.query(sql, params.length ? params : undefined);
    const classIds = result.rows.map((r) => r.id as string);
    const teacherMap = new Map<string, string[]>();
    if (classIds.length) {
      const assigns = await pool.query(
        `SELECT class_id, teacher_id
         FROM class_teacher_assignments
         WHERE class_id = ANY($1::varchar[]) AND unassigned_at IS NULL`,
        [classIds]
      );
      for (const row of assigns.rows) {
        const cid = row.class_id as string;
        const tid = row.teacher_id as string;
        const arr = teacherMap.get(cid) ?? [];
        arr.push(tid);
        teacherMap.set(cid, arr);
      }
    }
    const classes = result.rows.map((r) => {
      const legacyTeacherId = (r.teacher_id as string | null) ?? null;
      const assigned = teacherMap.get(r.id as string) ?? [];
      const teacherIds = legacyTeacherId && !assigned.includes(legacyTeacherId) ? [legacyTeacherId, ...assigned] : assigned;
      return {
        id: r.id,
        academicYearId: r.academic_year_id,
        grade: r.grade,
        name: r.name,
        teacherId: legacyTeacherId,
        teacherIds,
        archivedAt: (r.archived_at as Date | null)?.toISOString() ?? null,
        archiveLabel: (r.archive_label as string | null) ?? null,
      };
    });
    res.json({ classes });
  } catch (e) {
    console.error('get classes', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 当前教师在某学年下的「班级 + 学科」任课岗位（用于学生画像学科报告权限） */
router.get('/me/subject-assignments', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStaffingTables();
    const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    if (!academicYearId) {
      return res.status(400).json({ error: 'academicYearId is required' });
    }
    const role = await getUserRole(req);
    if (role !== 'teacher' || !req.userId) {
      return res.json({ assignments: [] as Array<{ classId: string; subjectKey: string }> });
    }
    const rows = (await pool.query(
      `SELECT DISTINCT class_id, subject_key, subject_name
       FROM class_subject_teacher_assignments
       WHERE academic_year_id = $1 AND teacher_id = $2 AND subject_key <> $3`,
      [academicYearId, req.userId, STAFFING_HOMEROOM_SUBJECT_KEY],
    )).rows as Array<{ class_id: string; subject_key: string; subject_name: string }>;
    res.json({
      assignments: rows.map((r) => ({
        classId: r.class_id,
        subjectKey: r.subject_key,
        subjectName: r.subject_name,
      })),
    });
  } catch (e) {
    console.error('get me subject-assignments', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 当前教师在某学年下担任班主任的班级（用于学生中心「我的学生」班级筛选） */
router.get('/me/homeroom-classes', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    if (!academicYearId) {
      return res.status(400).json({ error: 'academicYearId is required' });
    }
    const role = await getUserRole(req);
    if (role !== 'teacher' || !req.userId) {
      return res.json({ classIds: [] as string[] });
    }
    const rows = (await pool.query(
      `SELECT DISTINCT c.id AS class_id
       FROM classes c
       JOIN class_teacher_assignments a
         ON a.class_id = c.id
        AND a.teacher_id = $1
        AND a.role = 'homeroom'
        AND a.unassigned_at IS NULL
       WHERE c.academic_year_id = $2`,
      [req.userId, academicYearId],
    )).rows as Array<{ class_id: string }>;
    res.json({ classIds: rows.map((r) => r.class_id) });
  } catch (e) {
    console.error('get me homeroom-classes', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 当前教师在某学年下担任年级组长的管理年级内全部班级（用于学生中心「我的学生」班级筛选与班级概览） */
router.get('/me/grade-head-classes', async (req: ReqWithUserId, res: Response) => {
  try {
    const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    if (!academicYearId) {
      return res.status(400).json({ error: 'academicYearId is required' });
    }
    const role = await getUserRole(req);
    if (role !== 'teacher' || !req.userId) {
      return res.json({ classIds: [] as string[] });
    }
    const classIds = await getGradeHeadClassIdsForTeacher(req.userId, academicYearId);
    res.json({ classIds });
  } catch (e) {
    console.error('get me grade-head-classes', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    const { id, academicYearId, grade, name, teacherId } = req.body || {};
    if (!id || !academicYearId || grade == null || !name || !teacherId) {
      res.status(400).json({ error: 'id, academicYearId, grade, name, teacherId required' });
      return;
    }
    const okTeacher = await assertTeacherUser(String(teacherId));
    if (!okTeacher) {
      res.status(400).json({ error: 'teacherId must reference an active teacher account' });
      return;
    }
    await pool.query(
      'INSERT INTO classes (id, academic_year_id, grade, name, teacher_id) VALUES ($1, $2, $3, $4, $5)',
      [id, academicYearId, Number(grade), name, teacherId]
    );
    await pool.query(
      `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [createId('cta'), id, teacherId, 'homeroom']
    );
    await ensureStaffingTables();
    await upsertHomeroomStaffingFromClassTables(pool, id);
    res.status(201).json({ id, academicYearId, grade: Number(grade), name, teacherId });
  } catch (e) {
    console.error('post class', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 班级-教师关联 ----------
router.get('/:classId/teachers', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    const { classId } = req.params;
    if (!classId) { res.status(400).json({ error: 'classId required' }); return; }
    const result = await pool.query(
      `SELECT a.teacher_id, a.role, u.display_name
       FROM class_teacher_assignments a
       JOIN users u ON u.id = a.teacher_id
       WHERE a.class_id = $1 AND a.unassigned_at IS NULL AND a.role = 'homeroom'
       ORDER BY u.display_name ASC`,
      [classId]
    );
    const teachers = result.rows.map((r) => ({
      teacherId: r.teacher_id,
      role: r.role,
      displayName: r.display_name,
    }));
    res.json({ teachers });
  } catch (e) {
    console.error('get class teachers', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:classId/teachers', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    const { classId } = req.params;
    const { teacherId, role } = req.body || {};
    if (!classId || !teacherId) { res.status(400).json({ error: 'classId, teacherId required' }); return; }
    const normalizedRole = (role as string | undefined) ?? 'homeroom';
    if (normalizedRole === 'co-teacher') {
      res.status(400).json({
        error:
          'Co-teachers are assigned under Admin → Staffing (岗位安排) only. Use class management for homeroom teacher only.',
      });
      return;
    }
    if (normalizedRole !== 'homeroom') {
      res.status(400).json({ error: 'role must be homeroom' });
      return;
    }
    const okTeacher = await assertTeacherUser(String(teacherId));
    if (!okTeacher) {
      res.status(400).json({ error: 'teacherId must reference an active teacher account' });
      return;
    }
    await pool.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL`,
      [classId, teacherId]
    );
    if (normalizedRole === 'homeroom') {
      await pool.query(
        `UPDATE class_teacher_assignments
         SET unassigned_at = CURRENT_TIMESTAMP
         WHERE class_id = $1 AND role = 'homeroom' AND unassigned_at IS NULL`,
        [classId]
      );
      await pool.query('UPDATE classes SET teacher_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [teacherId, classId]);
    }
    const id = createId('cta');
    await pool.query(
      `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role)
       VALUES ($1, $2, $3, $4)`,
      [id, classId, teacherId, normalizedRole]
    );
    await ensureStaffingTables();
    await upsertHomeroomStaffingFromClassTables(pool, classId);
    res.status(201).json({ id, classId, teacherId, role: normalizedRole });
  } catch (e) {
    console.error('post class teacher assignment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/:classId/teachers/:teacherId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    const { classId, teacherId } = req.params;
    if (!classId || !teacherId) { res.status(400).json({ error: 'classId, teacherId required' }); return; }
    const activeAssignment = (await pool.query(
      `SELECT role
       FROM class_teacher_assignments
       WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL
       LIMIT 1`,
      [classId, teacherId]
    )).rows[0] as { role: string } | undefined;
    if (!activeAssignment) {
      res.status(404).json({ error: 'Teacher assignment not found' });
      return;
    }
    if (activeAssignment.role === 'homeroom') {
      await pool.query(
        `UPDATE class_teacher_assignments
         SET unassigned_at = CURRENT_TIMESTAMP
         WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL`,
        [classId, teacherId],
      );
      await pool.query(
        `UPDATE classes SET teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND teacher_id = $2`,
        [classId, teacherId],
      );
      await ensureStaffingTables();
      await upsertHomeroomStaffingFromClassTables(pool, classId);
      res.json({ success: true });
      return;
    }
    await pool.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL`,
      [classId, teacherId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('delete class teacher assignment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/:classId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { classId } = req.params;
    await pool.query('DELETE FROM student_enrollments WHERE class_id = $1', [classId]);
    await pool.query('DELETE FROM classes WHERE id = $1', [classId]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete class', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 学生 ----------
router.get('/students', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const role = await getUserRole(req);
    const params: unknown[] = [];
    let sql = `
      SELECT
        id, name, name_zh, name_en, gender, current_grade, current_class_id,
        division, entry_date, status, student_number, date_of_birth
      FROM students
    `;
    if (role === 'student') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const link = await pool.query('SELECT student_id FROM users WHERE id = $1', [req.userId]);
      const sid = link.rows[0]?.student_id as string | null | undefined;
      if (!sid) {
        res.json({ students: [] });
        return;
      }
      params.push(sid);
      sql += ' WHERE id = $1';
    } else if (role !== 'system-admin' && role !== 'admin') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await ensureStaffingTables();
      params.push(req.userId);
      const tid = `$${params.length}`;
      const gradeHeadClassIds = await getGradeHeadClassIdsForTeacherQuery(req.userId);
      let studentScopeSql = `(
          EXISTS (
            SELECT 1
            FROM student_enrollments e
            JOIN class_teacher_assignments a
              ON a.class_id = e.class_id
             AND a.unassigned_at IS NULL
            WHERE e.student_id = students.id
              AND a.teacher_id = ${tid}
          )
          OR EXISTS (
            SELECT 1
            FROM student_enrollments e
            JOIN class_subject_teacher_assignments s
              ON s.class_id = e.class_id
             AND s.academic_year_id = e.academic_year_id
            WHERE e.student_id = students.id
              AND s.teacher_id = ${tid}
          )`;
      if (gradeHeadClassIds.length > 0) {
        params.push(gradeHeadClassIds);
        studentScopeSql += `
          OR EXISTS (
            SELECT 1
            FROM student_enrollments e
            WHERE e.student_id = students.id
              AND e.class_id = ANY($${params.length}::varchar[])
          )`;
      }
      studentScopeSql += `
        )`;
      sql += ` WHERE ${studentScopeSql}`;
    }
    sql += ' ORDER BY name ASC';
    const result = await pool.query(sql, params);
    const students = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameZh: r.name_zh ?? null,
      nameEn: r.name_en ?? null,
      gender: r.gender,
      currentGrade: r.current_grade ?? null,
      currentClassId: r.current_class_id ?? null,
      division: r.division ?? null,
      entryDate: r.entry_date?.toISOString().slice(0, 10),
      status: r.status ?? 'active',
      studentNumber: r.student_number,
      dateOfBirth: r.date_of_birth?.toISOString().slice(0, 10),
    }));
    res.json({ students });
  } catch (e) {
    console.error('get students', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/students', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const {
      id, name, nameZh, nameEn, gender, currentGrade, currentClassId,
      division, entryDate, status, studentNumber, dateOfBirth,
    } = req.body || {};
    const zh = typeof nameZh === 'string' ? nameZh.trim() : '';
    const en = typeof nameEn === 'string' ? nameEn.trim() : '';
    const fallback = typeof name === 'string' ? name.trim() : '';
    const displayName = zh || en || fallback;
    if (!id || !displayName || !gender) { res.status(400).json({ error: 'id, gender and at least one of nameZh/nameEn required' }); return; }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    const ent = entryDate ? new Date(entryDate) : null;
    const normalizedStatus = status || 'active';
    const normalizedCurrentGrade = currentGrade == null || currentGrade === '' ? null : Number(currentGrade);
    await pool.query(
      `INSERT INTO students (
        id, name, name_zh, name_en, gender, current_grade, current_class_id,
        division, entry_date, status, student_number, date_of_birth
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, displayName, zh || null, en || null, gender,
        normalizedCurrentGrade, currentClassId || null, division || null, ent, normalizedStatus, studentNumber || null, dob,
      ]
    );
    res.status(201).json({
      id,
      name: displayName,
      nameZh: zh || null,
      nameEn: en || null,
      gender,
      currentGrade: normalizedCurrentGrade,
      currentClassId: currentClassId || null,
      division: division || null,
      entryDate: entryDate || null,
      status: normalizedStatus,
      studentNumber: studentNumber || null,
      dateOfBirth: dateOfBirth || null,
    });
  } catch (e) {
    console.error('post student', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.patch('/students/:studentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { studentId } = req.params;
    const {
      name, nameZh, nameEn, gender, currentGrade, currentClassId,
      division, entryDate, status, studentNumber, dateOfBirth,
    } = req.body || {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const nextNameZh = nameZh !== undefined ? String(nameZh || '').trim() : undefined;
    const nextNameEn = nameEn !== undefined ? String(nameEn || '').trim() : undefined;
    const nextName = name !== undefined ? String(name || '').trim() : undefined;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(nextName || null); }
    if (nameZh !== undefined) { updates.push(`name_zh = $${idx++}`); values.push(nameZh || null); }
    if (nameEn !== undefined) { updates.push(`name_en = $${idx++}`); values.push(nameEn || null); }
    if (gender !== undefined) { updates.push(`gender = $${idx++}`); values.push(gender); }
    const parsedRawCurrentGrade = currentGrade !== undefined && currentGrade !== null && currentGrade !== ''
      ? Number(currentGrade)
      : null;
    const parsedCurrentGrade = parsedRawCurrentGrade != null && !Number.isNaN(parsedRawCurrentGrade)
      ? parsedRawCurrentGrade
      : null;
    if (currentGrade !== undefined) { updates.push(`current_grade = $${idx++}`); values.push(parsedCurrentGrade); }
    if (currentClassId !== undefined) { updates.push(`current_class_id = $${idx++}`); values.push(currentClassId || null); }
    if (division !== undefined) { updates.push(`division = $${idx++}`); values.push(division || null); }
    if (entryDate !== undefined) { updates.push(`entry_date = $${idx++}`); values.push(entryDate ? new Date(entryDate) : null); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
    if (studentNumber !== undefined) { updates.push(`student_number = $${idx++}`); values.push(studentNumber || null); }
    if (dateOfBirth !== undefined) { updates.push(`date_of_birth = $${idx++}`); values.push(dateOfBirth ? new Date(dateOfBirth) : null); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    values.push(studentId);
    await pool.query(
      `UPDATE students SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx}`,
      values
    );
    const row = (await pool.query(`
      SELECT
        id, name, name_zh, name_en, gender, current_grade, current_class_id,
        division, entry_date, status, student_number, date_of_birth
      FROM students WHERE id = $1
    `, [studentId])).rows[0];
    if (!row) { res.status(404).json({ error: 'Student not found' }); return; }
    const finalZh = nextNameZh ?? (row.name_zh ?? '');
    const finalEn = nextNameEn ?? (row.name_en ?? '');
    const finalName = nextName ?? (row.name ?? '');
    if (!String(finalZh).trim() && !String(finalEn).trim() && !String(finalName).trim()) {
      res.status(400).json({ error: 'At least one of nameZh/nameEn is required' });
      return;
    }
    const derived = String(finalZh).trim() || String(finalEn).trim() || String(finalName).trim();
    if (derived && derived !== row.name) {
      await pool.query('UPDATE students SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [derived, studentId]);
      row.name = derived;
    }
    res.json({
      id: row.id,
      name: row.name,
      nameZh: row.name_zh ?? null,
      nameEn: row.name_en ?? null,
      gender: row.gender,
      currentGrade: row.current_grade ?? null,
      currentClassId: row.current_class_id ?? null,
      division: row.division ?? null,
      entryDate: row.entry_date?.toISOString().slice(0, 10),
      status: row.status ?? 'active',
      studentNumber: row.student_number,
      dateOfBirth: row.date_of_birth?.toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error('patch student', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/students/:studentId', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { studentId } = req.params;
    await pool.query('DELETE FROM student_enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete student', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 学籍 ----------
router.get('/enrollments', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    const role = await getUserRole(req);
    const academicYearId = req.query.academicYearId as string | undefined;
    const params: unknown[] = [];
    const where: string[] = [];
    let sql = 'SELECT id, student_id, class_id, academic_year_id FROM student_enrollments';
    if (academicYearId) {
      params.push(academicYearId);
      where.push(`academic_year_id = $${params.length}`);
    }
    if (role !== 'system-admin' && role !== 'admin') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await ensureStaffingTables();
      params.push(req.userId);
      const tid = params.length;
      const gradeHeadClassIds = await getGradeHeadClassIdsForTeacherQuery(req.userId, academicYearId);
      let enrollmentScopeSql = `(
        EXISTS (
          SELECT 1 FROM class_teacher_assignments a
          WHERE a.class_id = student_enrollments.class_id
            AND a.teacher_id = $${tid}
            AND a.unassigned_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM class_subject_teacher_assignments s
          WHERE s.class_id = student_enrollments.class_id
            AND s.academic_year_id = student_enrollments.academic_year_id
            AND s.teacher_id = $${tid}
        )`;
      if (gradeHeadClassIds.length > 0) {
        params.push(gradeHeadClassIds);
        enrollmentScopeSql += `
        OR student_enrollments.class_id = ANY($${params.length}::varchar[])`;
      }
      enrollmentScopeSql += ')';
      where.push(enrollmentScopeSql);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY academic_year_id DESC, class_id ASC';
    const result = await pool.query(sql, params);
    const enrollments = result.rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      classId: r.class_id,
      academicYearId: r.academic_year_id,
    }));
    res.json({ enrollments });
  } catch (e) {
    console.error('get enrollments', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/enrollments', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { id, studentId, classId, academicYearId } = req.body || {};
    if (!id || !studentId || !classId || !academicYearId) { res.status(400).json({ error: 'id, studentId, classId, academicYearId required' }); return; }
    await pool.query(
      'INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id) VALUES ($1, $2, $3, $4)',
      [id, studentId, classId, academicYearId]
    );
    const cls = (await pool.query(
      'SELECT grade FROM classes WHERE id = $1 AND academic_year_id = $2',
      [classId, academicYearId]
    )).rows[0];
    const grade = cls?.grade ?? null;
    await pool.query(
      `UPDATE student_assignment_history
       SET effective_to = CURRENT_DATE
       WHERE student_id = $1 AND effective_to IS NULL`,
      [studentId]
    );
    await pool.query(
      `INSERT INTO student_assignment_history (
         id, student_id, academic_year_id, class_id, grade, effective_from, source
       ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'manual')`,
      [createId('sah'), studentId, academicYearId, classId, grade]
    );
    await pool.query(
      `UPDATE students
       SET current_class_id = $1, current_grade = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [classId, grade, studentId]
    );
    res.status(201).json({ id, studentId, classId, academicYearId });
  } catch (e) {
    console.error('post enrollment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/enrollments/:enrollmentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { enrollmentId } = req.params;
    const row = (await pool.query(
      'SELECT student_id, class_id, academic_year_id FROM student_enrollments WHERE id = $1',
      [enrollmentId]
    )).rows[0];
    await pool.query('DELETE FROM student_enrollments WHERE id = $1', [enrollmentId]);
    if (row?.student_id) {
      await pool.query(
        `UPDATE student_assignment_history
         SET effective_to = CURRENT_DATE
         WHERE student_id = $1 AND class_id = $2 AND academic_year_id = $3 AND effective_to IS NULL`,
        [row.student_id, row.class_id, row.academic_year_id]
      );
      await pool.query(
        `UPDATE students
         SET current_class_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.student_id]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('delete enrollment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 学生画像模块（可扩展） ----------
router.get('/profile/modules', async (_req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const modulesResult = await pool.query(
      `SELECT id, key, name, description, is_system, is_enabled
       FROM student_profile_modules
       ORDER BY is_system DESC, created_at ASC`
    );
    const moduleIds = modulesResult.rows.map((r) => r.id as string);
    let fieldsByModule = new Map<string, any[]>();
    if (moduleIds.length > 0) {
      const fieldsResult = await pool.query(
        `SELECT id, module_id, field_key, label, field_type, score_min, score_max, options, sort_order, is_required
         FROM student_profile_module_fields
         WHERE module_id = ANY($1::varchar[])
         ORDER BY sort_order ASC, created_at ASC`,
        [moduleIds]
      );
      for (const row of fieldsResult.rows) {
        const arr = fieldsByModule.get(row.module_id as string) ?? [];
        arr.push({
          id: row.id,
          fieldKey: row.field_key,
          label: row.label,
          fieldType: row.field_type,
          scoreMin: row.score_min == null ? null : Number(row.score_min),
          scoreMax: row.score_max == null ? null : Number(row.score_max),
          options: row.options ?? null,
          sortOrder: row.sort_order,
          required: !!row.is_required,
        });
        fieldsByModule.set(row.module_id as string, arr);
      }
    }
    const modules = modulesResult.rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description ?? null,
      isSystem: !!r.is_system,
      isEnabled: !!r.is_enabled,
      fields: fieldsByModule.get(r.id as string) ?? [],
    }));
    res.json({ modules });
  } catch (e) {
    console.error('get profile modules', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profile/modules', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { key, name, description, isEnabled } = req.body || {};
    if (!key || !name) { res.status(400).json({ error: 'key and name required' }); return; }
    const id = createId('spm');
    await pool.query(
      `INSERT INTO student_profile_modules (id, key, name, description, is_system, is_enabled, created_by)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
      [id, String(key), String(name), description ?? null, isEnabled !== false, req.userId ?? null]
    );
    res.status(201).json({ id, key: String(key), name: String(name), description: description ?? null, isEnabled: isEnabled !== false });
  } catch (e) {
    console.error('post profile module', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post('/profile/modules/:moduleId/fields', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { moduleId } = req.params;
    const { fieldKey, label, fieldType, scoreMin, scoreMax, options, sortOrder, required } = req.body || {};
    if (!moduleId || !fieldKey || !label || !fieldType) {
      res.status(400).json({ error: 'moduleId, fieldKey, label, fieldType required' });
      return;
    }
    const id = createId('spmf');
    await pool.query(
      `INSERT INTO student_profile_module_fields
        (id, module_id, field_key, label, field_type, score_min, score_max, options, sort_order, is_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        id, moduleId, String(fieldKey), String(label), String(fieldType),
        scoreMin == null ? null : Number(scoreMin),
        scoreMax == null ? null : Number(scoreMax),
        options == null ? null : JSON.stringify(options),
        Number(sortOrder ?? 0),
        !!required,
      ]
    );
    res.status(201).json({ id, moduleId, fieldKey, label, fieldType, scoreMin: scoreMin ?? null, scoreMax: scoreMax ?? null, options: options ?? null, sortOrder: Number(sortOrder ?? 0), required: !!required });
  } catch (e) {
    console.error('post profile module field', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.get('/profile/students/:studentId/values', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { studentId } = req.params;
    const canView = await canUserAccessStudent(req, studentId, false);
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: no access to this student profile' });
      return;
    }
    const rows = (await pool.query(
      `SELECT module_id, field_key, value_json
       FROM student_profile_values
       WHERE student_id = $1`,
      [studentId]
    )).rows;
    const values: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const moduleId = row.module_id as string;
      if (!values[moduleId]) values[moduleId] = {};
      values[moduleId][row.field_key as string] = row.value_json;
    }
    res.json({ studentId, values });
  } catch (e) {
    console.error('get student profile values', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profile/students/:studentId/modules/:moduleId/values', requireStudentProfileEditor(async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    const { studentId, moduleId } = req.params;
    const values = (req.body?.values ?? {}) as Record<string, unknown>;
    if (!studentId || !moduleId || typeof values !== 'object') {
      res.status(400).json({ error: 'studentId, moduleId, values required' });
      return;
    }
    const fieldRows = (await pool.query(
      `SELECT field_key, field_type, score_min, score_max
       FROM student_profile_module_fields
       WHERE module_id = $1`,
      [moduleId]
    )).rows as Array<{ field_key: string; field_type: string; score_min: string | null; score_max: string | null }>;
    const fieldMap = new Map(fieldRows.map((f) => [f.field_key, f]));
    await client.query('BEGIN');
    for (const [fieldKey, value] of Object.entries(values)) {
      const def = fieldMap.get(fieldKey);
      if (!def) continue;
      if (def.field_type === 'score' && value != null) {
        const score = Number(value);
        if (Number.isNaN(score)) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: `Field ${fieldKey} must be a number` });
          return;
        }
        const min = def.score_min == null ? 0 : Number(def.score_min);
        const max = def.score_max == null ? 10 : Number(def.score_max);
        if (score < min || score > max) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: `Field ${fieldKey} must be between ${min} and ${max}` });
          return;
        }
      }
      await client.query(
        `INSERT INTO student_profile_values (id, student_id, module_id, field_key, value_json, updated_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (student_id, module_id, field_key)
         DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [createId('spv'), studentId, moduleId, fieldKey, JSON.stringify(value), req.userId ?? null]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('put student profile values', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}));

// ---------- 学业报告（评价设计中心） ----------
// 必须先注册更具体的路径，否则 `/reports/templates/:id/my-progress` 会被 `/:academicYearId/:term`
// 误匹配为 academicYearId=id、term=my-progress，从而返回 “term must be Semester 1 or Semester 2”。

/**
 * 教师/管理员读取学年考试维度配置（满分与各档百分比），用于学业报告工作台换算等第。
 */
router.get('/reports/year-dimension-presets/:academicYearId', async (req: ReqWithUserId, res: Response) => {
  try {
    const role = await getUserRole(req);
    if (role !== 'teacher' && role !== 'admin' && role !== 'system-admin' && role !== 'student') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const academicYearId = String(req.params.academicYearId ?? '').trim();
    if (!academicYearId) {
      res.status(400).json({ error: 'academicYearId required' });
      return;
    }
    await ensureReportYearDimensionPresetTable();
    const row = (await pool.query(
      `SELECT academic_year_id, payload, updated_at
       FROM student_report_year_dimension_presets
       WHERE academic_year_id = $1
       LIMIT 1`,
      [academicYearId],
    )).rows[0] as
      | {
        academic_year_id: string;
        payload: unknown;
        updated_at: Date | null;
      }
      | undefined;
    if (!row) {
      res.json({ preset: null });
      return;
    }
    const inclusionCtx = await loadReportYearInclusionContext(academicYearId);
    const examConfigs = inclusionCtx.examConfigs;
    const subjectKeyToCourseId: Record<string, string> = {};
    for (const [sk, cid] of inclusionCtx.subjectKeyToCourseId.entries()) {
      subjectKeyToCourseId[sk] = cid;
    }
    res.json({
      preset: {
        academicYearId: row.academic_year_id,
        examConfigs,
        stageInclusion: inclusionCtx.stageInclusion,
        evaluationGradeInclusion: inclusionCtx.evaluationGradeInclusion,
        examGradeInclusion: inclusionCtx.examGradeInclusion,
        subjectKeyToCourseId,
        updatedAt: row.updated_at?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error('Get year dimension preset (classes) error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 教师侧学业报告入口进度（按“我负责的班级”聚合）：
 * - 学科评语暂视为选填，不纳入完成度阻塞项
 * - 班主任综合评价：模板未禁用且教师为该班班主任时，工作台展示该入口；**进度上视为每位学生均需填写**（与模板 optional/required 无关，保存接口仍按模板校验）
 * - 「整体完成」= 该班所负责学科全部达标且（若开启班主任模块）班主任评语已填
 */
/** 管理员查看指定教师的学业报告岗位范围（班级 + 学科） */
async function loadTeacherReportScopeForTemplate(
  academicYearId: string,
  teacherId: string,
  templateSubjectKeys: string[],
): Promise<{ classIds: string[]; homeroomClassIds: Set<string>; subjectByClass: Map<string, Set<string>> }> {
  const teacherHomeroomClassIds = new Set<string>();
  const teacherSubjectByClass = new Map<string, Set<string>>();
  const homeroomRows = (await pool.query(
    `SELECT c.id AS class_id
     FROM classes c
     JOIN class_teacher_assignments a
       ON a.class_id = c.id
      AND a.teacher_id = $1
      AND a.role = 'homeroom'
      AND a.unassigned_at IS NULL
     WHERE c.academic_year_id = $2`,
    [teacherId, academicYearId],
  )).rows as Array<{ class_id: string }>;
  for (const row of homeroomRows) teacherHomeroomClassIds.add(row.class_id);

  if (templateSubjectKeys.length > 0) {
    const subjectRows = (await pool.query(
      `SELECT class_id, subject_key
       FROM class_subject_teacher_assignments
       WHERE academic_year_id = $1
         AND teacher_id = $2
         AND subject_key = ANY($3::varchar[])`,
      [academicYearId, teacherId, templateSubjectKeys],
    )).rows as Array<{ class_id: string; subject_key: string }>;
    for (const row of subjectRows) {
      const set = teacherSubjectByClass.get(row.class_id) ?? new Set<string>();
      set.add(row.subject_key);
      teacherSubjectByClass.set(row.class_id, set);
    }
  }

  const classIds = Array.from(
    new Set([...Array.from(teacherHomeroomClassIds), ...Array.from(teacherSubjectByClass.keys())]),
  );
  return { classIds, homeroomClassIds: teacherHomeroomClassIds, subjectByClass: teacherSubjectByClass };
}

router.get('/reports/templates/:templateId/assigned-teachers', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) {
      res.status(400).json({ error: 'templateId required' });
      return;
    }
    const role = await getUserRole(req);
    if (role !== 'admin' && role !== 'system-admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const template = await getTemplateById(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const templateSubjectKeys = template.subjects.map((s) => s.subjectKey).filter((k) => !!k);
    const segmentId = String(template.schoolSegmentId ?? '').trim();
    const inclusionCtx = await loadReportYearInclusionContext(template.academicYearId);
    const segmentGradeIds = segmentId ? await loadSegmentGradeIds(segmentId) : [];
    const staffingSubjectKeys = resolveStaffingSubjectKeysForReportTemplate(
      templateSubjectKeys,
      segmentId,
      segmentGradeIds,
      inclusionCtx,
    );
    let segmentClassIds: string[] | null = null;
    if (segmentId) {
      const segmentGradeIds = await loadSegmentGradeIds(segmentId);
      if (segmentGradeIds.length > 0) {
        const gradeConfig = await loadSchoolGradeStructure();
        const classRows = (await pool.query(
          `SELECT id, grade, name FROM classes WHERE academic_year_id = $1`,
          [template.academicYearId],
        )).rows as Array<{ id: string; grade: number; name: string }>;
        segmentClassIds = classRows
          .filter((r) =>
            isClassInSegmentGrades(gradeConfig, { grade: Number(r.grade), name: String(r.name ?? '') }, segmentGradeIds),
          )
          .map((r) => r.id);
      }
    }
    if (segmentClassIds !== null && segmentClassIds.length === 0) {
      res.json({ teachers: [] });
      return;
    }
    const rows = (
      await pool.query(
        segmentClassIds !== null
          ? `SELECT DISTINCT u.id,
                    COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.display_name), ''), u.username) AS name
             FROM users u
             WHERE u.role = 'teacher'
               AND u.id IN (
                 SELECT a.teacher_id
                 FROM class_subject_teacher_assignments a
                 WHERE a.academic_year_id = $1
                   AND a.subject_key = ANY($2::varchar[])
                   AND a.class_id = ANY($3::varchar[])
                 UNION
                 SELECT a.teacher_id
                 FROM class_teacher_assignments a
                 JOIN classes c ON c.id = a.class_id
                 WHERE c.academic_year_id = $1
                   AND c.id = ANY($3::varchar[])
                   AND a.role = 'homeroom'
                   AND a.unassigned_at IS NULL
               )
             ORDER BY name ASC`
          : `SELECT DISTINCT u.id,
                    COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.display_name), ''), u.username) AS name
             FROM users u
             WHERE u.role = 'teacher'
               AND u.id IN (
                 SELECT a.teacher_id
                 FROM class_subject_teacher_assignments a
                 WHERE a.academic_year_id = $1
                   AND a.subject_key = ANY($2::varchar[])
                 UNION
                 SELECT a.teacher_id
                 FROM class_teacher_assignments a
                 JOIN classes c ON c.id = a.class_id
                 WHERE c.academic_year_id = $1
                   AND a.role = 'homeroom'
                   AND a.unassigned_at IS NULL
               )
             ORDER BY name ASC`,
        segmentClassIds !== null
          ? [template.academicYearId, staffingSubjectKeys, segmentClassIds]
          : [template.academicYearId, staffingSubjectKeys],
      )
    ).rows as Array<{ id: string; name: string }>;
    res.json({ teachers: rows });
  } catch (e) {
    console.error('assigned-teachers', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/templates/:templateId/my-progress', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) {
      res.status(400).json({ error: 'templateId required' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const role = await getUserRole(req);
    const userId = String(req.userId ?? '').trim();
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (role !== 'teacher' && role !== 'admin' && role !== 'system-admin') {
      res.status(403).json({ error: 'Forbidden: no access to report progress' });
      return;
    }

    const isAdminRole = role === 'system-admin' || role === 'admin';
    const viewAsTeacherId = String(req.query.teacherId ?? '').trim();
    let scopeTeacherId: string | null = role === 'teacher' ? userId : null;
    let viewingTeacherName: string | null = null;

    if (isAdminRole) {
      if (!viewAsTeacherId) {
        scopeTeacherId = null;
      } else {
        const teacherRow = (
          await pool.query(
            `SELECT id,
                    COALESCE(NULLIF(TRIM(name_zh), ''), NULLIF(TRIM(display_name), ''), username) AS name
             FROM users
             WHERE id = $1 AND role = 'teacher'
             LIMIT 1`,
            [viewAsTeacherId],
          )
        ).rows[0] as { id: string; name: string } | undefined;
        if (!teacherRow) {
          res.status(400).json({ error: 'teacherId must reference a teacher user' });
          return;
        }
        scopeTeacherId = teacherRow.id;
        viewingTeacherName = String(teacherRow.name ?? '').trim() || teacherRow.id;
      }
    }

    let classIds: string[] = [];
    const teacherHomeroomClassIds = new Set<string>();
    const teacherSubjectByClass = new Map<string, Set<string>>();
    const templateSubjectKeys = template.subjects.map((s) => s.subjectKey).filter((k) => !!k);

    const segmentId = String(template.schoolSegmentId ?? '').trim();
    const inclusionCtx = await loadReportYearInclusionContext(template.academicYearId);
    const segmentGradeIds = segmentId ? await loadSegmentGradeIds(segmentId) : [];
    const staffingSubjectKeys = resolveStaffingSubjectKeysForReportTemplate(
      templateSubjectKeys,
      segmentId,
      segmentGradeIds,
      inclusionCtx,
    );
    if (scopeTeacherId) {
      const scope = await loadTeacherReportScopeForTemplate(
        template.academicYearId,
        scopeTeacherId,
        staffingSubjectKeys,
      );
      classIds = scope.classIds;
      for (const cid of scope.homeroomClassIds) teacherHomeroomClassIds.add(cid);
      for (const [cid, keys] of scope.subjectByClass) teacherSubjectByClass.set(cid, keys);
      if (segmentId) {
        classIds = await filterClassIdsForReportSegment(template.academicYearId, classIds, segmentId);
        const allowed = new Set(classIds);
        for (const cid of Array.from(teacherHomeroomClassIds)) {
          if (!allowed.has(cid)) teacherHomeroomClassIds.delete(cid);
        }
        for (const cid of Array.from(teacherSubjectByClass.keys())) {
          if (!allowed.has(cid)) teacherSubjectByClass.delete(cid);
        }
      }
      const filteredSubjects = await filterTeacherSubjectByClassForReportTemplate(
        template.academicYearId,
        teacherSubjectByClass,
        templateSubjectKeys,
        segmentId,
        inclusionCtx,
      );
      teacherSubjectByClass.clear();
      for (const [cid, keys] of filteredSubjects) teacherSubjectByClass.set(cid, keys);
      classIds = Array.from(
        new Set([...Array.from(teacherHomeroomClassIds), ...Array.from(teacherSubjectByClass.keys())]),
      );
    }

    if (classIds.length === 0) {
      res.json({
        progress: {
          templateId: template.id,
          title: template.title ?? null,
          status: template.status,
          academicYearId: template.academicYearId,
          term: template.term,
          totalStudents: 0,
          completedStudents: 0,
          pendingStudents: 0,
          completionRate: 0,
          classes: [],
          viewingTeacherId: scopeTeacherId,
          viewingTeacherName,
        },
      });
      return;
    }

    const rosterRows = (await pool.query(
      `SELECT c.id AS class_id, c.grade, c.name AS class_name,
              s.id AS student_id, COALESCE(NULLIF(s.name_zh, ''), NULLIF(s.name_en, ''), s.name) AS student_name
       FROM classes c
       JOIN student_enrollments se ON se.class_id = c.id AND se.academic_year_id = c.academic_year_id
       JOIN students s ON s.id = se.student_id
       WHERE c.academic_year_id = $1
         AND c.id = ANY($2::varchar[])
       ORDER BY c.grade ASC, c.name ASC, student_name ASC`,
      [template.academicYearId, classIds],
    )).rows as Array<{
      class_id: string;
      grade: number;
      class_name: string;
      student_id: string;
      student_name: string;
    }>;

    const reportRows = (await pool.query(
      `SELECT r.id, r.student_id, r.homeroom_comment
       FROM student_term_reports r
       WHERE r.template_id = $1
         AND r.academic_year_id = $2
         AND r.term = $3`,
      [templateId, template.academicYearId, template.term],
    )).rows as Array<{
      id: string;
      student_id: string;
      homeroom_comment: string | null;
    }>;

    const subjectRows = (await pool.query(
      `SELECT sr.report_id, sr.subject_key,
              CASE WHEN sr.midterm_score IS NOT NULL OR sr.final_score IS NOT NULL THEN TRUE ELSE FALSE END AS has_score,
              CASE WHEN COALESCE(NULLIF(TRIM(sr.teacher_comment), ''), NULL) IS NULL THEN FALSE ELSE TRUE END AS has_comment,
              CASE WHEN sr.learning_quality_grade IN ('A','B','C','D') THEN TRUE ELSE FALSE END AS has_learning_quality
       FROM student_term_subject_reports sr
       JOIN student_term_reports r ON r.id = sr.report_id
       WHERE r.template_id = $1
         AND r.academic_year_id = $2
         AND r.term = $3`,
      [templateId, template.academicYearId, template.term],
    )).rows as Array<{
      report_id: string;
      subject_key: string;
      has_score: boolean;
      has_comment: boolean;
      has_learning_quality: boolean;
    }>;

    const ratingRows = (await pool.query(
      `SELECT sr.report_id, sr.subject_key, td.dimension_key
       FROM student_term_subject_reports sr
       JOIN student_term_reports r ON r.id = sr.report_id
       JOIN student_term_target_dimensions td ON td.subject_report_id = sr.id
       JOIN student_term_target_ratings tr ON tr.subject_report_id = sr.id AND tr.dimension_id = td.id
       WHERE r.template_id = $1
         AND r.academic_year_id = $2
         AND r.term = $3`,
      [templateId, template.academicYearId, template.term],
    )).rows as Array<{
      report_id: string;
      subject_key: string;
      dimension_key: string;
    }>;

    const reportByStudent = new Map<string, { reportId: string; hasHomeroom: boolean }>();
    for (const row of reportRows) {
      const hasHomeroom = !!String(row.homeroom_comment ?? '').trim();
      reportByStudent.set(row.student_id, { reportId: row.id, hasHomeroom });
    }

    const subjectByReportAndKey = new Map<string, { hasScore: boolean; hasComment: boolean; hasLearningQuality: boolean }>();
    for (const row of subjectRows) {
      subjectByReportAndKey.set(`${row.report_id}::${row.subject_key}`, {
        hasScore: row.has_score,
        hasComment: row.has_comment,
        hasLearningQuality: row.has_learning_quality,
      });
    }

    const ratingKeysByReportAndSubject = new Map<string, Set<string>>();
    for (const row of ratingRows) {
      const key = `${row.report_id}::${row.subject_key}`;
      const set = ratingKeysByReportAndSubject.get(key) ?? new Set<string>();
      if (row.dimension_key) set.add(row.dimension_key);
      ratingKeysByReportAndSubject.set(key, set);
    }

    const insightRows = (await pool.query(
      `SELECT class_id, subject_key,
              CASE WHEN NULLIF(TRIM(class_overall_analysis), '') IS NOT NULL THEN TRUE ELSE FALSE END AS has_reflection
       FROM student_report_subject_class_insights
       WHERE template_id = $1`,
      [templateId],
    )).rows as Array<{ class_id: string; subject_key: string; has_reflection: boolean }>;
    const teachingReflectionByClassSubject = new Map<string, boolean>();
    for (const row of insightRows) {
      teachingReflectionByClassSubject.set(`${row.class_id}::${row.subject_key}`, row.has_reflection);
    }

    const templateSubjectByKey = new Map(template.subjects.map((s) => [s.subjectKey, s] as const));
    const gradeConfig = await loadSchoolGradeStructure();
    const classMap = new Map<string, {
      classId: string;
      className: string;
      grade: number;
      students: Array<{ studentId: string; studentName: string }>;
    }>();
    for (const row of rosterRows) {
      const cls = classMap.get(row.class_id) ?? {
        classId: row.class_id,
        className: row.class_name,
        grade: row.grade,
        students: [],
      };
      cls.students.push({ studentId: row.student_id, studentName: row.student_name || row.student_id });
      classMap.set(row.class_id, cls);
    }

    const classes = Array.from(classMap.values())
      .sort((a, b) => (a.grade - b.grade) || a.className.localeCompare(b.className))
      .map((cls) => {
        const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, cls.grade, { className: cls.className });
        const requiredSubjectKeys = Array.from(teacherSubjectByClass.get(cls.classId) ?? new Set<string>()).filter(
          (subjectKey) => templateSubjectByKey.has(subjectKey),
        );
        const isHomeroomForClass = teacherHomeroomClassIds.has(cls.classId);
        /** 纳入完成度阻塞：仅模板要求且该班班主任为当前教师 */
        const requiresHomeroomComment = isHomeroomForClass && template.homeroomCommentMode === 'required';
        /** 学业报告工作台是否展示「班主任综合评价」入口：班主任 + 模板未关闭该模块 */
        const homeroomEvaluationAvailable =
          isHomeroomForClass && template.homeroomCommentMode !== 'disabled';
        const pendingStudentNames: string[] = [];
        let completedStudents = 0;
        let subjectCompletedStudents = 0;
        let homeroomCompletedStudents = 0;

        for (const stu of cls.students) {
          const reportMeta = reportByStudent.get(stu.studentId);

          let subjectOk = false;
          if (reportMeta) {
            subjectOk = true;
            for (const subjectKey of requiredSubjectKeys) {
              const tplSubject = templateSubjectByKey.get(subjectKey);
              if (!tplSubject) continue;
              const courseId = inclusionCtx.subjectKeyToCourseId.get(subjectKey);
              const effectiveEnableScore = effectiveTemplateSubjectEnableScore(
                template.term,
                segmentId,
                subjectKey,
                gradeCatalogId,
                segmentGradeIds,
                tplSubject.enableScore,
                inclusionCtx,
              );
              const key = `${reportMeta.reportId}::${subjectKey}`;
              const subjectData = subjectByReportAndKey.get(key);
              if (!subjectData) {
                subjectOk = false;
                break;
              }
              if (effectiveEnableScore && !subjectData.hasScore) {
                subjectOk = false;
                break;
              }
              if (tplSubject.enableLearningQuality && !subjectData.hasLearningQuality) {
                subjectOk = false;
                break;
              }
              const requiredDimensionKeys = resolveTemplateDimensionsForGrade(tplSubject, gradeCatalogId)
                .map((d) => d.dimensionKey)
                .filter((d) => !!d);
              if (requiredDimensionKeys.length > 0) {
                const ratedKeys = ratingKeysByReportAndSubject.get(key) ?? new Set<string>();
                if (requiredDimensionKeys.some((dk) => !ratedKeys.has(dk))) {
                  subjectOk = false;
                  break;
                }
              }
            }
          }

          if (subjectOk) subjectCompletedStudents += 1;

          if (homeroomEvaluationAvailable && reportMeta?.hasHomeroom === true) {
            homeroomCompletedStudents += 1;
          }

          /** 班主任综合评价开启时，每位学生均需填写班主任评语后才算完成 */
          const fullyComplete =
            subjectOk && (!homeroomEvaluationAvailable || reportMeta?.hasHomeroom === true);

          if (fullyComplete) completedStudents += 1;
          else pendingStudentNames.push(stu.studentName);
        }

        const totalStudents = cls.students.length;
        const pendingStudents = Math.max(totalStudents - completedStudents, 0);
        const completionRate = totalStudents > 0
          ? Number(((completedStudents / totalStudents) * 100).toFixed(1))
          : 0;
        return {
          classId: cls.classId,
          className: cls.className,
          grade: cls.grade,
          totalStudents,
          completedStudents,
          pendingStudents,
          completionRate,
          pendingStudentNames,
          requiredSubjectKeys,
          requiresHomeroomComment,
          homeroomEvaluationAvailable,
          subjectCompletedStudents,
          homeroomCompletedStudents,
        };
      })
      .filter(
        (cls) =>
          cls.totalStudents > 0
          && (cls.requiredSubjectKeys.length > 0 || cls.homeroomEvaluationAvailable),
      );

    const totalStudents = classes.reduce((sum, cls) => sum + cls.totalStudents, 0);
    const completedStudents = classes.reduce((sum, cls) => sum + cls.completedStudents, 0);
    const pendingStudents = Math.max(totalStudents - completedStudents, 0);
    const completionRate = totalStudents > 0 ? Number(((completedStudents / totalStudents) * 100).toFixed(1)) : 0;

    let subjectTrackTotal = 0;
    let subjectTrackDone = 0;
    let homeroomTrackTotal = 0;
    let homeroomTrackDone = 0;
    for (const cls of classes) {
      if (cls.requiredSubjectKeys.length > 0) {
        subjectTrackTotal += cls.totalStudents;
        const insightsOk = cls.requiredSubjectKeys.every(
          (sk) => teachingReflectionByClassSubject.get(`${cls.classId}::${sk}`) === true,
        );
        subjectTrackDone += insightsOk ? cls.subjectCompletedStudents : 0;
      }
      if (cls.homeroomEvaluationAvailable) {
        homeroomTrackTotal += cls.totalStudents;
        homeroomTrackDone += cls.homeroomCompletedStudents;
      }
    }
    const subjectProgress =
      subjectTrackTotal > 0
        ? {
            totalStudents: subjectTrackTotal,
            completedStudents: subjectTrackDone,
            pendingStudents: Math.max(0, subjectTrackTotal - subjectTrackDone),
            completionRate: Number(((subjectTrackDone / subjectTrackTotal) * 100).toFixed(1)),
          }
        : null;
    const homeroomProgress =
      homeroomTrackTotal > 0
        ? {
            totalStudents: homeroomTrackTotal,
            completedStudents: homeroomTrackDone,
            pendingStudents: Math.max(0, homeroomTrackTotal - homeroomTrackDone),
            completionRate: Number(((homeroomTrackDone / homeroomTrackTotal) * 100).toFixed(1)),
          }
        : null;

    res.json({
      progress: {
        templateId: template.id,
        title: template.title ?? null,
        status: template.status,
        academicYearId: template.academicYearId,
        term: template.term,
        totalStudents,
        completedStudents,
        pendingStudents,
        completionRate,
        subjectProgress,
        homeroomProgress,
        classes,
        viewingTeacherId: scopeTeacherId,
        viewingTeacherName,
      },
    });
  } catch (e) {
    console.error('get my report template progress', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/templates/:academicYearId/:term', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { academicYearId, term } = req.params;
    const normalizedTerm = term === 'Semester 1' || term === 'Semester 2' ? (term as Term) : null;
    if (!normalizedTerm) {
      res.status(400).json({ error: 'term must be Semester 1 or Semester 2' });
      return;
    }
    const schoolSegmentId =
      typeof req.query.schoolSegmentId === 'string' && req.query.schoolSegmentId.trim()
        ? req.query.schoolSegmentId.trim()
        : null;
    const viewerRole = await getUserRole(req);
    const templates = await listTemplatesForTerm(academicYearId, normalizedTerm, schoolSegmentId);
    const visibleTemplates = viewerRole === 'student'
      ? templates.filter((t) => !!t.releasedAt)
      : templates;
    res.json({ templates: visibleTemplates });
  } catch (e) {
    console.error('get report template', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/templates/:templateId', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) {
      res.status(400).json({ error: 'templateId required' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const viewerRole = await getUserRole(req);
    if (viewerRole === 'student' && !template.releasedAt) {
      res.status(403).json({ error: 'Report is not released to students yet' });
      return;
    }
    res.json({ template });
  } catch (e) {
    console.error('get report template by id', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/templates/:templateId/classes/:classId/class-insights-summary', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    const classId = String(req.params.classId ?? '').trim();
    if (!templateId || !classId) {
      res.status(400).json({ error: 'templateId, classId required' });
      return;
    }
    const role = await getUserRole(req);
    if (role === 'student' || !req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const classRow = (await pool.query(
      `SELECT id
       FROM classes
       WHERE id = $1 AND academic_year_id = $2
       LIMIT 1`,
      [classId, template.academicYearId],
    )).rows[0] as { id: string } | undefined;
    if (!classRow) {
      res.status(404).json({ error: 'Class not found in selected academic year' });
      return;
    }
    const isAdminRole = role === 'system-admin' || role === 'admin';
    if (!isAdminRole && role === 'teacher') {
      const canHomeroom = await teacherIsHomeroomOfClass(req.userId, classId);
      const canGradeHead = await teacherIsGradeHeadOfClass(req.userId, classId, template.academicYearId);
      if (!canHomeroom && !canGradeHead) {
        res.status(403).json({ error: 'Forbidden: homeroom or grade-head teacher access only' });
        return;
      }
    }
    const insightRows = (await pool.query(
      `SELECT subject_key, class_overall_analysis, updated_at
       FROM student_report_subject_class_insights
       WHERE template_id = $1 AND class_id = $2`,
      [templateId, classId],
    )).rows as Array<{ subject_key: string; class_overall_analysis: string | null; updated_at: Date | null }>;
    const teacherRows = (await pool.query(
      `SELECT a.subject_key,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM class_subject_teacher_assignments a
       JOIN users u ON u.id = a.teacher_id
       WHERE a.academic_year_id = $1 AND a.class_id = $2 AND COALESCE(a.teacher_slot, 0) = 0`,
      [template.academicYearId, classId],
    )).rows as Array<{ subject_key: string; teacher_name: string }>;
    const insightByKey = new Map(insightRows.map((r) => [r.subject_key, r] as const));
    const teacherByKey = new Map(teacherRows.map((r) => [r.subject_key, r.teacher_name] as const));
    const subjects = template.subjects
      .filter((s) => !!s.subjectKey)
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((s) => {
        const insight = insightByKey.get(s.subjectKey);
        return {
          subjectKey: s.subjectKey,
          subjectName: s.subjectName || s.subjectNameZh || s.subjectKey,
          teacherName: teacherByKey.get(s.subjectKey) ?? null,
          classOverallAnalysis: String(insight?.class_overall_analysis ?? '').trim() || null,
          updatedAt: insight?.updated_at?.toISOString() ?? null,
        };
      });
    res.json({ subjects });
  } catch (e) {
    console.error('get class insights summary', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 某学生在一次学业报告下，各学科教师填写的个别学情与支持计划（校内记录，不进学生报告） */
router.get('/reports/templates/:templateId/students/:studentId/subject-insights', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    const studentId = String(req.params.studentId ?? '').trim();
    if (!templateId || !studentId) {
      res.status(400).json({ error: 'templateId, studentId required' });
      return;
    }
    if (!req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const canView = await canUserAccessStudent(req, studentId, false);
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: no access to this student' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const classId = await enrollmentClassForStudentYear(studentId, template.academicYearId);
    if (!classId) {
      res.json({ insights: [] as Array<Record<string, unknown>> });
      return;
    }
    const insightRows = (await pool.query(
      `SELECT subject_key, student_analysis_rows
       FROM student_report_subject_class_insights
       WHERE template_id = $1 AND class_id = $2`,
      [templateId, classId],
    )).rows as Array<{ subject_key: string; student_analysis_rows: unknown }>;
    const teacherRows = (await pool.query(
      `SELECT a.subject_key,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM class_subject_teacher_assignments a
       JOIN users u ON u.id = a.teacher_id
       WHERE a.academic_year_id = $1 AND a.class_id = $2 AND COALESCE(a.teacher_slot, 0) = 0`,
      [template.academicYearId, classId],
    )).rows as Array<{ subject_key: string; teacher_name: string }>;
    const teacherByKey = new Map(teacherRows.map((r) => [r.subject_key, r.teacher_name] as const));
    const subjectNameByKey = new Map(
      template.subjects.filter((s) => s.subjectKey).map((s) => [s.subjectKey, s.subjectName || s.subjectNameZh || s.subjectKey] as const),
    );
    const insights: Array<{
      subjectKey: string;
      subjectName: string;
      teacherName: string | null;
      learningAnalysis: string | null;
      supportPlan: string | null;
    }> = [];
    for (const row of insightRows) {
      const parsed = parseStudentAnalysisRowsFromDb(row.student_analysis_rows);
      const match = parsed.find((r) => r.studentId === studentId);
      if (!match) continue;
      const learningAnalysis = String(match.learningAnalysis ?? '').trim() || null;
      const supportPlan = String(match.supportPlan ?? '').trim() || null;
      if (!learningAnalysis && !supportPlan) continue;
      const subjectKey = row.subject_key;
      insights.push({
        subjectKey,
        subjectName: subjectNameByKey.get(subjectKey) ?? subjectKey,
        teacherName: teacherByKey.get(subjectKey) ?? null,
        learningAnalysis,
        supportPlan,
      });
    }
    insights.sort((a, b) => {
      const ai = template.subjects.find((s) => s.subjectKey === a.subjectKey)?.sortOrder ?? 0;
      const bi = template.subjects.find((s) => s.subjectKey === b.subjectKey)?.sortOrder ?? 0;
      return ai - bi;
    });
    res.json({ insights });
  } catch (e) {
    console.error('get student subject insights', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/templates/:templateId/classes/:classId/subjects/:subjectKey/class-insights', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    const classId = String(req.params.classId ?? '').trim();
    const subjectKey = String(req.params.subjectKey ?? '').trim();
    if (!templateId || !classId || !subjectKey) {
      res.status(400).json({ error: 'templateId, classId, subjectKey required' });
      return;
    }
    const role = await getUserRole(req);
    if (role === 'student' || !req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const classRow = (await pool.query(
      `SELECT id
       FROM classes
       WHERE id = $1 AND academic_year_id = $2
       LIMIT 1`,
      [classId, template.academicYearId],
    )).rows[0] as { id: string } | undefined;
    if (!classRow) {
      res.status(404).json({ error: 'Class not found in selected academic year' });
      return;
    }
    const isAdminRole = role === 'system-admin' || role === 'admin';
    if (!isAdminRole && role === 'teacher') {
      const segmentId = String(template.schoolSegmentId ?? '').trim();
      const inclusionCtx = await loadReportYearInclusionContext(template.academicYearId);
      const templateSubjectKeys = template.subjects.map((s) => s.subjectKey).filter((k) => !!k);
      const canTeach = await teacherCanFillTemplateSubjectInClass(
        req.userId,
        template.academicYearId,
        classId,
        subjectKey,
        templateSubjectKeys,
        segmentId,
        inclusionCtx,
      );
      const canHomeroom = await teacherIsHomeroomOfClass(req.userId, classId);
      if (!canTeach && !canHomeroom) {
        res.status(403).json({ error: 'Forbidden: not assigned to this class subject' });
        return;
      }
    }
    const row = (await pool.query(
      `SELECT weakness_rows, student_analysis_rows, class_overall_analysis, teaching_diagnosis, teaching_reflection, updated_at
       FROM student_report_subject_class_insights
       WHERE template_id = $1 AND class_id = $2 AND subject_key = $3
       LIMIT 1`,
      [templateId, classId, subjectKey],
    )).rows[0] as {
      weakness_rows: unknown;
      student_analysis_rows: unknown;
      class_overall_analysis: string | null;
      teaching_diagnosis: unknown;
      teaching_reflection: string | null;
      updated_at: Date | null;
    } | undefined;
    const diagnosis = parseTeachingDiagnosisFromDb(row?.teaching_diagnosis, row?.teaching_reflection ?? null);
    res.json({
      insights: {
        weaknessRows: parseWeaknessRowsFromDb(row?.weakness_rows),
        classOverallAnalysis: String(row?.class_overall_analysis ?? '').trim() || null,
        studentAnalysisRows: parseStudentAnalysisRowsFromDb(row?.student_analysis_rows),
        teachingDiagnosis: teachingDiagnosisHasContent(diagnosis) ? diagnosis : null,
        teachingReflection: row?.teaching_reflection ?? null,
        updatedAt: row?.updated_at?.toISOString() ?? null,
      },
    });
  } catch (e) {
    console.error('get class insights', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/reports/templates/:templateId/classes/:classId/subjects/:subjectKey/class-insights', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    const classId = String(req.params.classId ?? '').trim();
    const subjectKey = String(req.params.subjectKey ?? '').trim();
    if (!templateId || !classId || !subjectKey) {
      res.status(400).json({ error: 'templateId, classId, subjectKey required' });
      return;
    }
    const role = await getUserRole(req);
    if (role === 'student' || !req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const isAdminRole = role === 'system-admin' || role === 'admin';
    if (!isAdminRole && template.status !== 'published') {
      res.status(403).json({ error: 'Report template is not published for teacher editing' });
      return;
    }
    if (!isAdminRole && role === 'teacher') {
      const segmentId = String(template.schoolSegmentId ?? '').trim();
      const inclusionCtx = await loadReportYearInclusionContext(template.academicYearId);
      const templateSubjectKeys = template.subjects.map((s) => s.subjectKey).filter((k) => !!k);
      const canTeach = await teacherCanFillTemplateSubjectInClass(
        req.userId,
        template.academicYearId,
        classId,
        subjectKey,
        templateSubjectKeys,
        segmentId,
        inclusionCtx,
      );
      if (!canTeach) {
        res.status(403).json({ error: 'Forbidden: not assigned to teach this subject for this class' });
        return;
      }
    }
    const classOverallAnalysis = String(req.body?.classOverallAnalysis ?? '').trim() || null;
    const studentAnalysisRowsRaw = Array.isArray(req.body?.studentAnalysisRows)
      ? (req.body.studentAnalysisRows as Array<unknown>)
      : [];
    const studentAnalysisRows = studentAnalysisRowsRaw
      .map((row) => row as Record<string, unknown>)
      .map((row) => ({
        studentId: String(row.studentId ?? '').trim(),
        learningAnalysis: String(row.learningAnalysis ?? '').trim(),
        supportPlan: String(row.supportPlan ?? '').trim(),
      }))
      .filter((row) => row.studentId);
    await pool.query(
      `INSERT INTO student_report_subject_class_insights
        (id, template_id, academic_year_id, term, class_id, subject_key, weakness_rows, class_overall_analysis, student_analysis_rows, teaching_reflection, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, $8::jsonb, NULL, $9, $10)
       ON CONFLICT (template_id, class_id, subject_key)
       DO UPDATE SET
         weakness_rows = '[]'::jsonb,
         class_overall_analysis = EXCLUDED.class_overall_analysis,
         student_analysis_rows = EXCLUDED.student_analysis_rows,
         teaching_reflection = NULL,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [
        createId('srci'),
        templateId,
        template.academicYearId,
        template.term,
        classId,
        subjectKey,
        classOverallAnalysis,
        JSON.stringify(studentAnalysisRows),
        req.userId,
        req.userId,
      ],
    );
    res.json({ success: true });
  } catch (e) {
    console.error('put class insights', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/students/:studentId', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { studentId } = req.params;
    const academicYearId = req.query.academicYearId as string | undefined;
    const canView = await canUserAccessStudent(req, studentId, false);
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: no access to this student report' });
      return;
    }
    const params: unknown[] = [studentId];
    const viewerRole = await getUserRole(req);
    const hideUnreleased = viewerRole === 'student' || viewerRole === 'teacher';
    let sql = `
      SELECT r.id, r.student_id, r.academic_year_id, r.term, r.template_id, t.title AS template_title,
             r.homeroom_comment, r.updated_at, t.released_at,
             ay.name AS academic_year_name
      FROM student_term_reports r
      JOIN academic_years ay ON ay.id = r.academic_year_id
      LEFT JOIN student_report_templates t ON t.id = r.template_id
      WHERE r.student_id = $1
    `;
    if (academicYearId) {
      params.push(academicYearId);
      sql += ` AND r.academic_year_id = $2`;
    }
    if (hideUnreleased) {
      sql += ` AND t.released_at IS NOT NULL`;
    }
    sql += ` ORDER BY ay.start_date DESC NULLS LAST, r.term ASC`;
    const result = await pool.query(sql, params);
    const reports = result.rows.map((r) => ({
      id: r.id as string,
      studentId: r.student_id as string,
      academicYearId: r.academic_year_id as string,
      academicYearName: r.academic_year_name as string,
      term: r.term as Term,
      templateId: (r.template_id as string | null) ?? null,
      templateTitle: (r.template_title as string | null) ?? null,
      homeroomComment: (r.homeroom_comment as string | null) ?? null,
      updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
      releasedAt: (r.released_at as Date | null)?.toISOString() ?? null,
    }));
    res.json({ reports });
  } catch (e) {
    console.error('get report list', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/students/:studentId/terms/:academicYearId/:term/templates/:templateId', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { studentId, academicYearId, term, templateId } = req.params;
    const normalizedTerm = term === 'Semester 1' || term === 'Semester 2' ? (term as Term) : null;
    if (!normalizedTerm) {
      res.status(400).json({ error: 'term must be Semester 1 or Semester 2' });
      return;
    }
    const canView = await canUserAccessStudent(req, studentId, false);
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: no access to this student report' });
      return;
    }
    const viewerRole = await getUserRole(req);
    const hideScores = viewerRole === 'student';
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template || template.academicYearId !== academicYearId || template.term !== normalizedTerm) {
      res.status(404).json({ error: 'Template not found for selected year/term' });
      return;
    }
    if (viewerRole === 'student' && !template.releasedAt) {
      res.status(403).json({ error: 'Report is not released to students yet' });
      return;
    }
    const segmentId = String(template.schoolSegmentId ?? '').trim();
    const inclusionCtx = await loadReportYearInclusionContext(academicYearId);
    const templateSubjectKeys = template.subjects.map((s) => s.subjectKey).filter((k) => !!k);
    const portraitScope = String(req.query.portraitScope ?? '').trim();
    const overviewPortrait = portraitScope === 'overview';
    /** 学业报告：任课教师仅看自己学科；学生画像概览：本班任课教师可看全科 */
    let filterTeacherSubjectsToStaffing = viewerRole === 'teacher' && !!req.userId && !overviewPortrait;
    if (filterTeacherSubjectsToStaffing) {
      await ensureClassTeacherAssignmentsTable(pool);
      const hm = await pool.query(
        `SELECT 1
         FROM student_enrollments e
         JOIN class_teacher_assignments a
           ON a.class_id = e.class_id
          AND a.teacher_id = $1
          AND a.role = 'homeroom'
          AND a.unassigned_at IS NULL
         WHERE e.student_id = $2 AND e.academic_year_id = $3
         LIMIT 1`,
        [req.userId, studentId, academicYearId],
      );
      if ((hm.rowCount ?? 0) > 0) {
        filterTeacherSubjectsToStaffing = false;
      } else {
        const cid = await enrollmentClassForStudentYear(studentId, academicYearId);
        if (cid && (await teacherIsGradeHeadOfClass(req.userId!, cid, academicYearId))) {
          filterTeacherSubjectsToStaffing = false;
        }
      }
    }
    const gradeCatalogIdForResolve = await gradeCatalogIdForStudentEnrollment(studentId, academicYearId);
    const segmentGradeIdsForFilter = segmentId ? await loadSegmentGradeIds(segmentId) : [];
    const reportRow = (await pool.query(
      `SELECT id, student_id, academic_year_id, term, template_id, homeroom_comment, created_at, updated_at
       FROM student_term_reports
       WHERE student_id = $1 AND academic_year_id = $2 AND term = $3 AND COALESCE(template_id, '') = COALESCE($4, '')
       LIMIT 1`,
      [studentId, academicYearId, normalizedTerm, templateId]
    )).rows[0] as
      | {
          id: string;
          student_id: string;
          academic_year_id: string;
          term: Term;
          template_id: string | null;
          homeroom_comment: string | null;
          created_at: Date | null;
          updated_at: Date | null;
        }
      | undefined;

    if (!reportRow) {
      let tplSubjectsEmpty = template?.subjects ?? [];
      if (filterTeacherSubjectsToStaffing && template) {
        const cid = await enrollmentClassForStudentYear(studentId, academicYearId);
        if (cid) {
          tplSubjectsEmpty = [];
          for (const s of template.subjects) {
            if (
              await teacherCanFillTemplateSubjectInClass(
                req.userId!,
                academicYearId,
                cid,
                s.subjectKey,
                templateSubjectKeys,
                segmentId,
                inclusionCtx,
              )
            ) {
              tplSubjectsEmpty.push(s);
            }
          }
        }
      } else if (gradeCatalogIdForResolve) {
        tplSubjectsEmpty = filterSubjectsForGradeCatalog(
          tplSubjectsEmpty,
          segmentId,
          gradeCatalogIdForResolve,
          segmentGradeIdsForFilter,
          inclusionCtx,
        );
      }
      tplSubjectsEmpty = templateSubjectsForGradeCatalog(tplSubjectsEmpty, gradeCatalogIdForResolve);
      res.json({
        report: {
          id: null,
          studentId,
          academicYearId,
          term: normalizedTerm,
          templateId,
          homeroomComment: null,
          subjectReports: [],
          createdAt: null,
          updatedAt: null,
        },
        template: template ? reportTemplateClientView(template, tplSubjectsEmpty) : null,
      });
      return;
    }

    const subjectRowsRaw = (await pool.query(
      `SELECT id, subject_key, subject_name, midterm_score, midterm_grade, final_score, final_grade,
              learning_quality_grade, exam_dimension_scores, teacher_comment, teacher_id, created_at, updated_at
       FROM student_term_subject_reports
       WHERE report_id = $1
       ORDER BY subject_name ASC`,
      [reportRow.id]
    )).rows as Array<{
      id: string;
      subject_key: string;
      subject_name: string;
      midterm_score: string | null;
      midterm_grade: string | null;
      final_score: string | null;
      final_grade: string | null;
      learning_quality_grade: string | null;
      exam_dimension_scores: unknown;
      teacher_comment: string | null;
      teacher_id: string | null;
      created_at: Date | null;
      updated_at: Date | null;
    }>;

    let subjectRows = subjectRowsRaw;
    let templateSubjectsOut = template.subjects;
    if (filterTeacherSubjectsToStaffing) {
      const cid = await enrollmentClassForStudentYear(studentId, academicYearId);
      if (cid) {
        subjectRows = [];
        for (const row of subjectRowsRaw) {
          if (
            await teacherCanFillTemplateSubjectInClass(
              req.userId!,
              academicYearId,
              cid,
              row.subject_key,
              templateSubjectKeys,
              segmentId,
              inclusionCtx,
            )
          ) {
            subjectRows.push(row);
          }
        }
        templateSubjectsOut = [];
        for (const s of template.subjects) {
          if (
            await teacherCanFillTemplateSubjectInClass(
              req.userId!,
              academicYearId,
              cid,
              s.subjectKey,
              templateSubjectKeys,
              segmentId,
              inclusionCtx,
            )
          ) {
            templateSubjectsOut.push(s);
          }
        }
      }
    } else if (gradeCatalogIdForResolve) {
      const applicableKeys = new Set(
        filterSubjectsForGradeCatalog(
          template.subjects,
          segmentId,
          gradeCatalogIdForResolve,
          segmentGradeIdsForFilter,
          inclusionCtx,
        ).map((s) => s.subjectKey),
      );
      subjectRows = subjectRows.filter((r) => applicableKeys.has(r.subject_key));
      templateSubjectsOut = filterSubjectsForGradeCatalog(
        templateSubjectsOut,
        segmentId,
        gradeCatalogIdForResolve,
        segmentGradeIdsForFilter,
        inclusionCtx,
      );
    }
    templateSubjectsOut = templateSubjectsForGradeCatalog(templateSubjectsOut, gradeCatalogIdForResolve);

    const subjectReportIds = subjectRows.map((s) => s.id);
    let dimensionsBySubject = new Map<
      string,
      Array<{
        id: string;
        dimensionKey: string;
        dimensionLabel: string;
        sortOrder: number;
        rating: TargetLevel | null;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }>
    >();

    if (subjectReportIds.length > 0) {
      const dimensionRows = (await pool.query(
        `SELECT d.id, d.subject_report_id, d.dimension_key, d.dimension_label, d.sort_order,
                ld.level, ld.description, r.rating
         FROM student_term_target_dimensions d
         LEFT JOIN student_term_target_level_descriptions ld ON ld.dimension_id = d.id
         LEFT JOIN student_term_target_ratings r
           ON r.dimension_id = d.id AND r.subject_report_id = d.subject_report_id
         WHERE d.subject_report_id = ANY($1::varchar[])
         ORDER BY d.sort_order ASC, d.created_at ASC`,
        [subjectReportIds]
      )).rows as Array<{
        id: string;
        subject_report_id: string;
        dimension_key: string;
        dimension_label: string;
        sort_order: number;
        level: TargetLevel | null;
        description: string | null;
        rating: TargetLevel | null;
      }>;

      const dimMap = new Map<
        string,
        {
          subjectReportId: string;
          id: string;
          dimensionKey: string;
          dimensionLabel: string;
          sortOrder: number;
          rating: TargetLevel | null;
          levelDescriptions: Partial<Record<TargetLevel, string>>;
        }
      >();
      for (const row of dimensionRows) {
        const key = row.id;
        const existing = dimMap.get(key) ?? {
          subjectReportId: row.subject_report_id,
          id: row.id,
          dimensionKey: row.dimension_key,
          dimensionLabel: row.dimension_label,
          sortOrder: row.sort_order,
          rating: row.rating ?? null,
          levelDescriptions: {},
        };
        if (row.level && row.description) {
          existing.levelDescriptions[row.level] = row.description;
        }
        if (row.rating) {
          existing.rating = row.rating;
        }
        dimMap.set(key, existing);
      }
      for (const d of dimMap.values()) {
        const arr = dimensionsBySubject.get(d.subjectReportId) ?? [];
        arr.push({
          id: d.id,
          dimensionKey: d.dimensionKey,
          dimensionLabel: d.dimensionLabel,
          sortOrder: d.sortOrder,
          rating: d.rating,
          levelDescriptions: d.levelDescriptions,
        });
        dimensionsBySubject.set(d.subjectReportId, arr);
      }
    }

    const examConfigsForResolve = await loadSanitizedExamConfigsForYear(academicYearId);

    const subjectReports = subjectRows.map((s) => {
      const tplSubject = template.subjects.find((t) => t.subjectKey === s.subject_key);
      const effectiveEnableScore = tplSubject
        ? effectiveTemplateSubjectEnableScore(
            normalizedTerm,
            segmentId,
            s.subject_key,
            gradeCatalogIdForResolve,
            segmentGradeIdsForFilter,
            tplSubject.enableScore,
            inclusionCtx,
          )
        : false;
      const lq = String(s.learning_quality_grade ?? '').trim();
      const learningQualityGrade =
        lq === 'A' || lq === 'B' || lq === 'C' || lq === 'D' ? (lq as TargetLevel) : null;
      const midtermScoreNum =
        hideScores || !effectiveEnableScore ? null : (s.midterm_score == null ? null : Number(s.midterm_score));
      const finalScoreNum =
        hideScores || !effectiveEnableScore ? null : (s.final_score == null ? null : Number(s.final_score));
      return {
        id: s.id,
        subjectKey: s.subject_key,
        subjectName: s.subject_name,
        midtermScore: midtermScoreNum,
        midtermGrade:
          hideScores || !effectiveEnableScore
            ? null
            : resolveSubjectAssessmentGradeFromDb(
                s.midterm_grade,
                midtermScoreNum,
                s.subject_key,
                template,
                gradeCatalogIdForResolve,
                examConfigsForResolve,
              ),
        finalScore: finalScoreNum,
        finalGrade:
          hideScores || !effectiveEnableScore
            ? null
            : resolveSubjectAssessmentGradeFromDb(
                s.final_grade,
                finalScoreNum,
                s.subject_key,
                template,
                gradeCatalogIdForResolve,
                examConfigsForResolve,
              ),
        learningQualityGrade,
        examDimensionScores:
          s.exam_dimension_scores && typeof s.exam_dimension_scores === 'object'
            ? (s.exam_dimension_scores as Record<string, number | null>)
            : null,
        teacherComment: s.teacher_comment ?? null,
        teacherId: s.teacher_id ?? null,
        dimensions: dimensionsBySubject.get(s.id) ?? [],
        createdAt: s.created_at?.toISOString() ?? null,
        updatedAt: s.updated_at?.toISOString() ?? null,
      };
    });

    res.json({
      report: {
        id: reportRow.id,
        studentId: reportRow.student_id,
        academicYearId: reportRow.academic_year_id,
        term: reportRow.term,
        templateId: reportRow.template_id ?? templateId,
        homeroomComment: reportRow.homeroom_comment ?? null,
        subjectReports,
        createdAt: reportRow.created_at?.toISOString() ?? null,
        updatedAt: reportRow.updated_at?.toISOString() ?? null,
      },
      template: template ? reportTemplateClientView(template, templateSubjectsOut) : null,
    });
  } catch (e) {
    console.error('get report detail', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/reports/students/:studentId/terms/:academicYearId/:term/templates/:templateId/homeroom-comment', async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    const { studentId, academicYearId, term, templateId } = req.params;
    const normalizedTerm = term === 'Semester 1' || term === 'Semester 2' ? (term as Term) : null;
    if (!normalizedTerm) {
      res.status(400).json({ error: 'term must be Semester 1 or Semester 2' });
      return;
    }
    const canEdit = await canHomeroomEditComment(req, studentId);
    if (!canEdit) {
      res.status(403).json({ error: 'Forbidden: homeroom or admin only' });
      return;
    }
    const role = await getUserRole(req);
    const template = await getTemplateById(templateId);
    if (!template || template.academicYearId !== academicYearId || template.term !== normalizedTerm) {
      res.status(409).json({ error: 'No report template configured for this term' });
      return;
    }
    if (template.homeroomCommentMode === 'disabled') {
      res.status(409).json({ error: 'Homeroom comment is disabled in current template' });
      return;
    }
    if (role !== 'system-admin' && role !== 'admin' && template.status !== 'published') {
      res.status(403).json({ error: 'Report template is not published for teacher editing' });
      return;
    }
    const comment = (req.body?.comment ?? null) as string | null;
    if (template.homeroomCommentMode === 'required' && !String(comment ?? '').trim()) {
      res.status(400).json({ error: 'Homeroom comment is required by template' });
      return;
    }
    await client.query('BEGIN');
    const reportId = await getOrCreateTermReport(client, studentId, academicYearId, normalizedTerm, templateId, req.userId ?? null);
    await client.query(
      `UPDATE student_term_reports
       SET homeroom_comment = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [comment, req.userId ?? null, reportId]
    );
    await client.query('COMMIT');
    res.json({ success: true, reportId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('put homeroom comment', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.put('/reports/students/:studentId/terms/:academicYearId/:term/templates/:templateId/subjects/:subjectKey', async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    const { studentId, academicYearId, term, templateId, subjectKey } = req.params;
    const normalizedTerm = term === 'Semester 1' || term === 'Semester 2' ? (term as Term) : null;
    if (!normalizedTerm) {
      res.status(400).json({ error: 'term must be Semester 1 or Semester 2' });
      return;
    }
    if (!subjectKey || !String(subjectKey).trim()) {
      res.status(400).json({ error: 'subjectKey required' });
      return;
    }
    const canAccess = await canUserAccessStudent(req, studentId, false);
    if (!canAccess) {
      res.status(403).json({ error: 'Forbidden: no access to this student report' });
      return;
    }
    const role = await getUserRole(req);
    if (role === 'student' || !req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const template = await getTemplateForReportWorkflow(templateId);
    if (!template || template.academicYearId !== academicYearId || template.term !== normalizedTerm) {
      res.status(409).json({ error: 'No report template configured for this term' });
      return;
    }
    const isAdminRole = role === 'system-admin' || role === 'admin';
    if (!isAdminRole && template.status !== 'published') {
      res.status(403).json({ error: 'Report template is not published for teacher editing' });
      return;
    }

    const subjectName = String(req.body?.subjectName ?? '').trim();
    if (!subjectName) {
      res.status(400).json({ error: 'subjectName required' });
      return;
    }
    const midtermScoreInput = req.body?.midtermScore;
    const finalScoreInput = req.body?.finalScore;
    const examDimensionScoresInput =
      req.body?.examDimensionScores && typeof req.body.examDimensionScores === 'object'
        ? (req.body.examDimensionScores as Record<string, unknown>)
        : null;
    const teacherComment = (req.body?.teacherComment ?? null) as string | null;
    const learningQualityInput = (req.body as { learningQualityGrade?: unknown })?.learningQualityGrade;
    const dimensions = Array.isArray(req.body?.dimensions) ? (req.body.dimensions as Array<{
      dimensionKey: string;
      dimensionLabel: string;
      rating: TargetLevel;
      levelDescriptions?: Partial<Record<TargetLevel, string>>;
    }>) : [];

    const templateSubject = template.subjects.find((s) => s.subjectKey === String(subjectKey).trim());
    if (!templateSubject) {
      res.status(400).json({ error: 'subjectKey is not configured in current template' });
      return;
    }

    const enrollmentClassId = await enrollmentClassForStudentYear(studentId, academicYearId);
    const gradeCatalogId = await gradeCatalogIdForStudentEnrollment(studentId, academicYearId);
    const activeTemplateDimensions = resolveTemplateDimensionsForGrade(templateSubject, gradeCatalogId);
    const segmentId = String(template.schoolSegmentId ?? '').trim();
    const segmentGradeIds = segmentId ? await loadSegmentGradeIds(segmentId) : [];
    const inclusionCtx = await loadReportYearInclusionContext(academicYearId);
    if (
      gradeCatalogId
      && segmentId
      && !isTemplateSubjectRequiredForGrade(
        String(subjectKey).trim(),
        segmentId,
        gradeCatalogId,
        segmentGradeIds,
        inclusionCtx,
      )
    ) {
      res.status(400).json({ error: 'This subject is not required for the student grade in this report' });
      return;
    }
    const effectiveEnableScore = effectiveTemplateSubjectEnableScore(
      normalizedTerm,
      segmentId,
      String(subjectKey).trim(),
      gradeCatalogId,
      segmentGradeIds,
      templateSubject.enableScore,
      inclusionCtx,
    );
    if (!isAdminRole && role === 'teacher') {
      if (!enrollmentClassId) {
        res.status(400).json({ error: 'Student has no class enrollment for this academic year' });
        return;
      }
      const templateSubjectKeys = template.subjects.map((s) => s.subjectKey).filter((k) => !!k);
      const canTeach = await teacherCanFillTemplateSubjectInClass(
        req.userId,
        academicYearId,
        enrollmentClassId,
        String(subjectKey).trim(),
        templateSubjectKeys,
        segmentId,
        inclusionCtx,
      );
      if (!canTeach) {
        res.status(403).json({ error: 'Forbidden: not assigned to teach this subject for this class' });
        return;
      }
    }

    const hasLegacyExamDimInput =
      Boolean(
        effectiveEnableScore &&
          examDimensionScoresInput &&
          activeTemplateDimensions.length > 0 &&
          Object.values(examDimensionScoresInput).some((v) => {
            if (v === '' || v == null) return false;
            const n = Number(v);
            return Number.isFinite(n);
          }),
      );

    const parseScore = (v: unknown): number | null => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : Number.NaN;
    };
    const midtermScore = effectiveEnableScore ? parseScore(midtermScoreInput) : null;
    let finalScore = effectiveEnableScore && !hasLegacyExamDimInput ? parseScore(finalScoreInput) : null;
    let learningQualityGrade: string | null = null;
    if (templateSubject.enableLearningQuality !== false) {
      const v = String(learningQualityInput ?? '').trim();
      if (v === 'A' || v === 'B' || v === 'C' || v === 'D') learningQualityGrade = v;
    }
    if (Number.isNaN(midtermScore)) {
      res.status(400).json({ error: 'Scores must be numbers' });
      return;
    }
    if (!hasLegacyExamDimInput && effectiveEnableScore && Number.isNaN(finalScore)) {
      res.status(400).json({ error: 'Scores must be numbers' });
      return;
    }
    if (midtermScore != null && (midtermScore < 0 || midtermScore > 100)) {
      res.status(400).json({ error: 'Scores must be between 0 and 100' });
      return;
    }
    let examFullMark = 100;
    if (!hasLegacyExamDimInput && effectiveEnableScore) {
      const examConfigsAllEarly = await loadSanitizedExamConfigsForYear(academicYearId);
      const examKeyEarly = `${normalizedTerm}::${String(template.schoolSegmentId ?? '').trim()}`;
      const examScopeEarly = examConfigsAllEarly[examKeyEarly];
      const examSubjectEarly = examScopeEarly?.subjects?.find((s) => s.subjectKey === String(subjectKey).trim());
      const examGEarly = pickExamGradeConfig(examSubjectEarly?.gradeConfigs ?? [], gradeCatalogId);
      examFullMark = examFullScoreFromGradeConfig(examGEarly?.fullScore, examGEarly?.percentBands);
    }
    if (!hasLegacyExamDimInput && finalScore != null && (finalScore < 0 || finalScore > examFullMark)) {
      res.status(400).json({ error: `Scores must be between 0 and ${examFullMark}` });
      return;
    }

    let examDimensionScores: Record<string, number | null> | null = null;
    let finalGradeForDb: ReportGrade | null = toReportGrade(finalScore, template.scoreGradeMinScores);
    let resolvedMaxByKey = new Map<string, number>();
    let resolvedLetterMins = template.scoreGradeMinScores;

    if (hasLegacyExamDimInput) {
      const examConfigsAll = await loadSanitizedExamConfigsForYear(academicYearId);
      const examKey = `${normalizedTerm}::${String(template.schoolSegmentId ?? '').trim()}`;
      const examScope = examConfigsAll[examKey];
      const examSubject = examScope?.subjects?.find((s) => s.subjectKey === String(subjectKey).trim());
      const examG = pickExamGradeConfig(examSubject?.gradeConfigs ?? [], gradeCatalogId);
      const dimsForMatch = activeTemplateDimensions.map((d) => ({
        dimensionKey: d.dimensionKey,
        dimensionLabelZh: d.dimensionLabelZh ?? d.dimensionLabel,
        dimensionLabelEn: d.dimensionLabelEn ?? d.dimensionLabel,
      }));
      const dimensionMaxByKey = matchDimensionMaxByKey(dimsForMatch, examG?.dimensionScores ?? []);
      resolvedMaxByKey = dimensionMaxByKey;
      const examHasBands =
        examG &&
        Object.values(examG.percentBands).some((v) => typeof v === 'number' && Number.isFinite(v));
      const letterGradeMins = examHasBands
        ? mergeReportScoreGradeMinScores(examG?.percentBands ?? {})
        : template.scoreGradeMinScores;
      resolvedLetterMins = letterGradeMins;

      const scoresOut: Record<string, number | null> = {};
      let allFilled = true;
      let sum = 0;
      let totalMax = 0;
      for (const dim of activeTemplateDimensions) {
        const key = String(dim.dimensionKey ?? '').trim();
        if (!key) continue;
        const maxPts = dimensionMaxByKey.get(key) ?? 100;
        totalMax += maxPts;
        const raw = examDimensionScoresInput![key];
        if (raw === '' || raw == null) {
          scoresOut[key] = null;
          allFilled = false;
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > maxPts) {
          res.status(400).json({ error: `Dimension ${key} score must be between 0 and ${maxPts}` });
          return;
        }
        scoresOut[key] = n;
        sum += n;
      }
      finalScore = allFilled ? Number(sum.toFixed(2)) : null;
      const totalPct = finalScore != null && totalMax > 0 ? (finalScore / totalMax) * 100 : null;
      finalGradeForDb = totalPct == null ? null : toReportGrade(totalPct, letterGradeMins);
      examDimensionScores = scoresOut;
    } else if (effectiveEnableScore) {
      examDimensionScores = null;
      if (finalScore != null) {
        const examConfigsAll = await loadSanitizedExamConfigsForYear(academicYearId);
        const examKey = `${normalizedTerm}::${String(template.schoolSegmentId ?? '').trim()}`;
        const examScope = examConfigsAll[examKey];
        const examSubject = examScope?.subjects?.find((s) => s.subjectKey === String(subjectKey).trim());
        const examG = pickExamGradeConfig(examSubject?.gradeConfigs ?? [], gradeCatalogId);
        const configuredBands = configuredReportScoreGradeMins(examG?.percentBands ?? {});
        const hasExamBands = Object.keys(configuredBands).length > 0;
        finalGradeForDb = hasExamBands
          ? reportLetterGradeFromExamPercentBands(finalScore, examG?.fullScore, examG?.percentBands)
          : toReportGrade(finalScore, template.scoreGradeMinScores);
      }
    }

    await client.query('BEGIN');
    const reportId = await getOrCreateTermReport(client, studentId, academicYearId, normalizedTerm, templateId, req.userId ?? null);
    const existingSubject = (await client.query(
      `SELECT id, teacher_id
       FROM student_term_subject_reports
       WHERE report_id = $1 AND subject_key = $2
       LIMIT 1`,
      [reportId, subjectKey]
    )).rows[0] as { id: string; teacher_id: string | null } | undefined;

    const subjectReportId = existingSubject?.id ?? createId('strs');
    const teacherIdForWrite = isAdminRole ? (existingSubject?.teacher_id ?? null) : req.userId;
    const teacherIdMergeSql = isAdminRole
      ? 'COALESCE(student_term_subject_reports.teacher_id, EXCLUDED.teacher_id)'
      : 'EXCLUDED.teacher_id';
    await client.query(
      `INSERT INTO student_term_subject_reports (
        id, report_id, subject_key, subject_name, midterm_score, midterm_grade, final_score, final_grade,
        learning_quality_grade, exam_dimension_scores, teacher_comment, teacher_id, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
      ON CONFLICT (report_id, subject_key)
      DO UPDATE SET
        subject_name = EXCLUDED.subject_name,
        midterm_score = EXCLUDED.midterm_score,
        midterm_grade = EXCLUDED.midterm_grade,
        final_score = EXCLUDED.final_score,
        final_grade = EXCLUDED.final_grade,
        learning_quality_grade = EXCLUDED.learning_quality_grade,
        exam_dimension_scores = EXCLUDED.exam_dimension_scores,
        teacher_comment = EXCLUDED.teacher_comment,
        teacher_id = ${teacherIdMergeSql},
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP`,
      [
        subjectReportId,
        reportId,
        String(subjectKey).trim(),
        templateSubject.subjectName || subjectName,
        midtermScore,
        toReportGrade(midtermScore, template.scoreGradeMinScores),
        finalScore,
        finalGradeForDb,
        learningQualityGrade,
        examDimensionScores ? JSON.stringify(examDimensionScores) : null,
        templateSubject.enableTeacherComment ? teacherComment : null,
        teacherIdForWrite,
        req.userId,
        req.userId,
      ]
    );

    await client.query(
      `UPDATE student_term_reports
       SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.userId, reportId]
    );

    await client.query(
      `DELETE FROM student_term_target_ratings
       WHERE subject_report_id = $1`,
      [subjectReportId]
    );
    await client.query(
      `DELETE FROM student_term_target_level_descriptions
       WHERE dimension_id IN (
         SELECT id FROM student_term_target_dimensions WHERE subject_report_id = $1
       )`,
      [subjectReportId]
    );
    await client.query(
      `DELETE FROM student_term_target_dimensions
       WHERE subject_report_id = $1`,
      [subjectReportId]
    );

    const ratingByKey = new Map<string, TargetLevel>();
    for (const dim of dimensions) {
      const key = String(dim.dimensionKey ?? '').trim();
      const rating = dim.rating;
      if (!key || !['A', 'B', 'C', 'D'].includes(String(rating))) continue;
      ratingByKey.set(key, rating);
    }

    for (let i = 0; i < activeTemplateDimensions.length; i += 1) {
      const dim = activeTemplateDimensions[i];
      const key = String(dim.dimensionKey ?? '').trim();
      const label = String(dim.dimensionLabel ?? '').trim();
      const dimScore = examDimensionScores?.[key];
      let autoRating: TargetLevel | null = null;
      if (dimScore != null) {
        if (resolvedMaxByKey.size > 0) {
          const maxPts = resolvedMaxByKey.get(key) ?? 100;
          const dimPct = maxPts > 0 ? (dimScore / maxPts) * 100 : null;
          autoRating =
            dimPct == null ? null : reportScoreLetterGradeToTargetLevel(toReportGrade(dimPct, resolvedLetterMins));
        } else {
          autoRating = reportScoreLetterGradeToTargetLevel(toReportGrade(dimScore, template.scoreGradeMinScores));
        }
      }
      /** 请求体中的维度等第优先（与教师工作台「最后一次修改」一致）；未传时再用得分自动换算 */
      const rating = ratingByKey.get(key) ?? autoRating ?? 'A';
      if (!key || !label) continue;
      const dimensionId = createId('strd');
      await client.query(
        `INSERT INTO student_term_target_dimensions
          (id, subject_report_id, dimension_key, dimension_label, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [dimensionId, subjectReportId, key, label, i]
      );
      for (const lv of ['A', 'B', 'C', 'D'] as const) {
        const desc = String((dim.levelDescriptions ?? {})[lv] ?? '').trim();
        if (!desc) continue;
        await client.query(
          `INSERT INTO student_term_target_level_descriptions
            (id, dimension_id, level, description)
           VALUES ($1, $2, $3, $4)`,
          [createId('strld'), dimensionId, lv, desc]
        );
      }
      await client.query(
        `INSERT INTO student_term_target_ratings
          (id, subject_report_id, dimension_id, rating, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [createId('strr'), subjectReportId, dimensionId, rating, req.userId, req.userId]
      );
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      reportId,
      subjectReport: {
        id: subjectReportId,
        subjectKey: String(subjectKey).trim(),
        subjectName,
        midtermScore,
        midtermGrade: toReportGrade(midtermScore, template.scoreGradeMinScores),
        finalScore,
        finalGrade: finalGradeForDb,
        examDimensionScores,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('put subject report', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ---------- 升入新学年（系统管理员：创建下一学年 + 升班/毕业归档 + 切换默认学年） ----------
router.get('/academic-years/promote-preview', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await prepareAcademicYearPromotionDependencies();
    let sourceYearId = typeof req.query.sourceYearId === 'string' ? req.query.sourceYearId.trim() : '';
    if (!sourceYearId) {
      const cur = (await pool.query(
        `SELECT id FROM academic_years WHERE is_current = TRUE ORDER BY updated_at DESC LIMIT 1`,
      )).rows[0] as { id: string } | undefined;
      sourceYearId = cur?.id ?? '';
    }
    if (!sourceYearId) {
      res.status(400).json({ error: 'No source academic year; set current year first' });
      return;
    }
    const preview = await buildAcademicYearPromotionPreview(sourceYearId);
    res.json({ preview });
  } catch (e) {
    console.error('promote-preview academic year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post('/academic-years/promote-to-next', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await prepareAcademicYearPromotionDependencies();
    const { sourceYearId: bodySourceYearId } = req.body || {};
    let sourceYearId = typeof bodySourceYearId === 'string' ? bodySourceYearId.trim() : '';
    if (!sourceYearId) {
      const cur = (await pool.query(
        `SELECT id FROM academic_years WHERE is_current = TRUE ORDER BY updated_at DESC LIMIT 1`,
      )).rows[0] as { id: string } | undefined;
      sourceYearId = cur?.id ?? '';
    }
    if (!sourceYearId) {
      res.status(400).json({ error: 'No source academic year; set current year first' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await promoteAcademicYearToNext(client, sourceYearId, req.userId ?? null);
      await client.query('COMMIT');
      await setCanonicalConfigAcademicYearId(sourceYearId);
      res.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'SOURCE_YEAR_NOT_FOUND') {
      res.status(404).json({ error: 'Source academic year not found' });
      return;
    }
    if (msg === 'TARGET_YEAR_EXISTS') {
      res.status(409).json({ error: 'Target academic year already exists' });
      return;
    }
    console.error('promote-to-next academic year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.get('/academic-years/undo-promotion-preview', requireSystemAdmin(async (_req: ReqWithUserId, res: Response) => {
  try {
    const preview = await buildAcademicYearUndoPreview();
    res.json({ preview });
  } catch (e) {
    console.error('undo-promotion-preview academic year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post('/academic-years/undo-promotion', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await undoAcademicYearPromotion(client);
    await client.query('COMMIT');
    await setCanonicalConfigAcademicYearId(result.sourceYearId);
    res.json(result);
  } catch (e) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NO_UNDOABLE_PROMOTION') {
      res.status(404).json({ error: 'No promotion available to undo' });
      return;
    }
    if (msg === 'TARGET_NOT_CURRENT' || msg === 'YEAR_NAME_MISMATCH' || msg === 'SOURCE_OR_TARGET_MISSING' || msg === 'CANNOT_UNDO') {
      res.status(409).json({ error: msg });
      return;
    }
    console.error('undo-promotion academic year', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}));

// 兼容旧接口：指定源/目标学年 ID 的升班（已由 promote-to-next 取代主流程）
router.post('/academic-years/:sourceYearId/promote', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable(pool);
    const { sourceYearId } = req.params;
    const { targetYearId, setTargetAsCurrent } = req.body || {};
    if (!sourceYearId || !targetYearId) {
      res.status(400).json({ error: 'sourceYearId and targetYearId required' });
      return;
    }
    await client.query('BEGIN');
    const sourceYear = (await client.query('SELECT id FROM academic_years WHERE id = $1', [sourceYearId])).rows[0];
    const targetYear = (await client.query('SELECT id FROM academic_years WHERE id = $1', [targetYearId])).rows[0];
    if (!sourceYear || !targetYear) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Source or target academic year not found' });
      return;
    }

    const sourceClasses = (await client.query(
      `SELECT id, grade, name FROM classes WHERE academic_year_id = $1`,
      [sourceYearId]
    )).rows as Array<{ id: string; grade: number; name: string }>;

    const targetClassMap = new Map<string, string>();
    for (const cls of sourceClasses) {
      const nextGrade = Math.min(12, Number(cls.grade) + 1);
      const existing = (await client.query(
        `SELECT id FROM classes WHERE academic_year_id = $1 AND grade = $2 AND name = $3 LIMIT 1`,
        [targetYearId, nextGrade, cls.name]
      )).rows[0];
      const targetClassId = existing?.id ?? createId('class');
      if (!existing) {
        await client.query(
          `INSERT INTO classes (id, academic_year_id, grade, name) VALUES ($1, $2, $3, $4)`,
          [targetClassId, targetYearId, nextGrade, cls.name]
        );
      }
      targetClassMap.set(cls.id, targetClassId);
    }

    const enrollments = (await client.query(
      `SELECT e.student_id, e.class_id, c.grade
       FROM student_enrollments e
       JOIN classes c ON c.id = e.class_id
       JOIN students s ON s.id = e.student_id
       WHERE e.academic_year_id = $1 AND s.status = 'active'`,
      [sourceYearId]
    )).rows as Array<{ student_id: string; class_id: string; grade: number }>;

    let promotedCount = 0;
    for (const enr of enrollments) {
      const targetClassId = targetClassMap.get(enr.class_id);
      if (!targetClassId) continue;
      const targetClass = (await client.query('SELECT grade FROM classes WHERE id = $1', [targetClassId])).rows[0];
      const nextGrade = Number(targetClass?.grade ?? Math.min(12, Number(enr.grade) + 1));
      await client.query(
        `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, academic_year_id)
         DO UPDATE SET class_id = EXCLUDED.class_id`,
        [createId('enr'), enr.student_id, targetClassId, targetYearId]
      );
      await client.query(
        `UPDATE student_assignment_history
         SET effective_to = CURRENT_DATE
         WHERE student_id = $1 AND effective_to IS NULL`,
        [enr.student_id]
      );
      await client.query(
        `INSERT INTO student_assignment_history (
           id, student_id, academic_year_id, class_id, grade, effective_from, source
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'promotion')`,
        [createId('sah'), enr.student_id, targetYearId, targetClassId, nextGrade]
      );
      await client.query(
        `UPDATE students
         SET current_grade = $1, current_class_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [nextGrade, targetClassId, enr.student_id]
      );
      promotedCount += 1;
    }

    if (setTargetAsCurrent) {
      await client.query('UPDATE academic_years SET is_current = FALSE');
      await client.query('UPDATE academic_years SET is_current = TRUE WHERE id = $1', [targetYearId]);
    }
    await client.query('COMMIT');
    res.json({
      success: true,
      sourceYearId,
      targetYearId,
      classesPrepared: targetClassMap.size,
      studentsPromoted: promotedCount,
      targetSetCurrent: !!setTargetAsCurrent,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('promote academic year', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}));

router.get('/teacher-portrait/collections', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureTeacherPortraitCollectionTables();
    const yearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    const term = req.query.term === 'Semester 1' || req.query.term === 'Semester 2' ? req.query.term : null;
    const role = await getUserRole(req);
    const isAdmin = role === 'system-admin' || role === 'admin';
    const where: string[] = [];
    const values: unknown[] = [];
    if (!isAdmin) {
      where.push(`t.status IN ('published', 'closed')`);
    }
    if (yearId) {
      const effectiveYearId = await resolveConfigAcademicYearId(yearId);
      values.push(effectiveYearId);
      where.push(`t.academic_year_id = $${values.length}`);
    }
    if (term) {
      values.push(term);
      where.push(`t.term = $${values.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT t.id, t.academic_year_id, t.term, t.title, t.collection_type, t.status,
              t.published_at, t.updated_at, t.target_departments, ay.name AS academic_year_name
       FROM teacher_portrait_collection_templates t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       ${whereSql}
       ORDER BY t.updated_at DESC NULLS LAST`,
      values,
    )).rows;
    const userId = req.userId;
    let teacherDepartment: string | null = null;
    if (userId && role === 'teacher') {
      teacherDepartment = await getTeacherDepartment(userId);
    }
    let mySubmissions: Array<{ templateId: string; hasContent: boolean; updatedAt: string | null }> = [];
    if (userId && role === 'teacher') {
      const subs = (await pool.query(
        `SELECT template_id, diagnosis, updated_at
         FROM teacher_portrait_collection_submissions
         WHERE teacher_id = $1`,
        [userId],
      )).rows;
      mySubmissions = subs.map((s) => {
        const d = parsePortraitDiagnosis(s.diagnosis);
        return {
          templateId: s.template_id as string,
          hasContent: portraitDiagnosisHasContent(d),
          updatedAt: (s.updated_at as Date | null)?.toISOString() ?? null,
        };
      });
    }
    const submissionByTemplate = new Map(mySubmissions.map((s) => [s.templateId, s]));
    const templates = rows
      .map((r) => {
        const id = r.id as string;
        const targetDepartments = parseTargetDepartments(r.target_departments);
        const mine = submissionByTemplate.get(id);
        return {
          id,
          academicYearId: r.academic_year_id as string,
          academicYearName: r.academic_year_name as string,
          term: r.term as string,
          title: (r.title as string | null) ?? null,
          collectionType: r.collection_type as string,
          status: r.status as string,
          targetDepartments,
          publishedAt: (r.published_at as Date | null)?.toISOString() ?? null,
          updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
          mySubmission: mine
            ? { hasContent: mine.hasContent, updatedAt: mine.updatedAt }
            : { hasContent: false, updatedAt: null },
        };
      })
      .filter((tpl) => {
        if (role !== 'teacher') return true;
        return teacherMatchesTargetDepartments(teacherDepartment, tpl.targetDepartments);
      });
    res.json({ templates });
  } catch (error) {
    console.error('List teacher portrait collections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teacher-portrait/collections/:templateId', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureTeacherPortraitCollectionTables();
    const templateId = String(req.params.templateId ?? '').trim();
    const userId = req.userId;
    if (!templateId || !userId) {
      return res.status(400).json({ error: 'templateId and authenticated user required' });
    }
    const role = await getUserRole(req);
    const template = await getTeacherPortraitTemplateById(templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const isAdmin = role === 'system-admin' || role === 'admin';
    if (!isAdmin && template.status === 'draft') {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (role === 'teacher') {
      const teacherDepartment = await getTeacherDepartment(userId);
      if (!teacherMatchesTargetDepartments(teacherDepartment, template.targetDepartments)) {
        return res.status(404).json({ error: 'Template not found' });
      }
    }
    let diagnosis = portraitEmptyDiagnosis();
    let updatedAt: string | null = null;
    if (role === 'teacher') {
      const row = (await pool.query(
        `SELECT diagnosis, updated_at FROM teacher_portrait_collection_submissions
         WHERE template_id = $1 AND teacher_id = $2 LIMIT 1`,
        [templateId, userId],
      )).rows[0];
      if (row) {
        diagnosis = parsePortraitDiagnosis(row.diagnosis);
        updatedAt = (row.updated_at as Date | null)?.toISOString() ?? null;
      }
    }
    res.json({
      template: {
        ...template,
        canEdit: role === 'teacher' && template.status === 'published',
      },
      submission: {
        diagnosis,
        hasContent: portraitDiagnosisHasContent(diagnosis),
        updatedAt,
      },
    });
  } catch (error) {
    console.error('Get teacher portrait collection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/teacher-portrait/collections/:templateId', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureTeacherPortraitCollectionTables();
    const templateId = String(req.params.templateId ?? '').trim();
    const userId = req.userId;
    if (!templateId || !userId) {
      return res.status(400).json({ error: 'templateId and authenticated user required' });
    }
    const role = await getUserRole(req);
    if (role !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can submit collection responses' });
    }
    const template = await getTeacherPortraitTemplateById(templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (template.status !== 'published') {
      return res.status(409).json({ error: 'Collection is not open for submission' });
    }
    const teacherDepartment = await getTeacherDepartment(userId);
    if (!teacherMatchesTargetDepartments(teacherDepartment, template.targetDepartments)) {
      return res.status(403).json({ error: 'You are not in the target audience for this collection' });
    }
    if (template.collectionType !== 'teaching-diagnosis-kiss') {
      return res.status(400).json({ error: 'Unsupported collection type' });
    }
    const raw = req.body?.diagnosis as PortraitDiagnosisPayload | undefined;
    const diagnosis: PortraitDiagnosisPayload = {
      keep: String(raw?.keep ?? '').trim(),
      improve: String(raw?.improve ?? '').trim(),
      stop: String(raw?.stop ?? '').trim(),
      start: String(raw?.start ?? '').trim(),
    };
    const submissionId = `tpcs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await pool.query(
      `INSERT INTO teacher_portrait_collection_submissions
         (id, template_id, teacher_id, diagnosis, created_by, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $5)
       ON CONFLICT (template_id, teacher_id)
       DO UPDATE SET diagnosis = EXCLUDED.diagnosis,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING updated_at`,
      [submissionId, templateId, userId, JSON.stringify(diagnosis), userId],
    );
    const updatedAt = (result.rows[0]?.updated_at as Date | null)?.toISOString() ?? null;
    res.json({
      success: true,
      submission: {
        diagnosis,
        hasContent: portraitDiagnosisHasContent(diagnosis),
        updatedAt,
      },
    });
  } catch (error) {
    console.error('Save teacher portrait collection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teacher-portrait/subject-groups', async (req: ReqWithUserId, res: Response) => {
  try {
    const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    if (!academicYearId) {
      res.status(400).json({ error: 'academicYearId is required' });
      return;
    }
    const role = await getUserRole(req);
    if (!req.userId || role === 'student') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const isAdmin = role === 'system-admin' || role === 'admin';
    const groups = await listPortraitSubjectGroups(academicYearId, req.userId, isAdmin);
    res.json({ groups, isAdmin });
  } catch (e) {
    console.error('list portrait subject groups', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teacher-portrait/subject-groups/:groupId/dashboard', async (req: ReqWithUserId, res: Response) => {
  try {
    const groupId = String(req.params.groupId ?? '').trim();
    const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    const term: Term =
      req.query.term === 'Semester 2' ? 'Semester 2' : 'Semester 1';
    const dataSource = req.query.dataSource === 'diagnosis' ? 'diagnosis' : 'report';
    const sourceId =
      typeof req.query.sourceId === 'string' && req.query.sourceId.trim()
        ? req.query.sourceId.trim()
        : null;
    if (!groupId || !academicYearId) {
      res.status(400).json({ error: 'groupId and academicYearId are required' });
      return;
    }
    const role = await getUserRole(req);
    if (!req.userId || role === 'student') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const isAdmin = role === 'system-admin' || role === 'admin';
    const dashboard = await buildSubjectGroupPortraitDashboard({
      groupId,
      academicYearId,
      term,
      userId: req.userId,
      isAdmin,
      dataSource,
      sourceId,
    });
    if (!dashboard) {
      res.status(403).json({ error: 'Forbidden or group not found' });
      return;
    }
    res.json({ dashboard });
  } catch (e) {
    console.error('subject group portrait dashboard', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;