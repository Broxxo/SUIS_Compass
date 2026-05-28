import express, { type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/database.js';
import {
  mergeReportScoreGradeMinScores,
  REPORT_SCORE_LETTER_GRADES,
  STAFFING_HOMEROOM_SUBJECT_KEY,
  extractEvaluationGradeInclusion,
  extractExamGradeInclusion,
  type ReportScoreLetterGrade,
} from '@repo/shared';
import { ensureStaffingTables } from '../lib/ensureStaffingTables.js';
import { sanitizeExamConfigs } from '../lib/reportExamConfigSanitize.js';
import { ensureClassTeacherAssignmentsTable } from '../lib/ensureClassTeacherAssignmentsTable.js';
import {
  effectiveTemplateSubjectEnableScore,
  gradeCatalogIdForClassLevel,
  isTemplateSubjectRequiredForGrade,
  loadGradeConfigItemsForReport,
  loadReportYearInclusionContext,
  loadSegmentGradeIds,
} from '../lib/reportYearInclusionContext.js';
import {
  applyHomeroomFromStaffingToClassTables,
  backfillHomeroomStaffingForAcademicYear,
} from '../lib/homeroomStaffingSync.js';
import { createRunOnce } from '../lib/runOnce.js';

const router = express.Router();

interface AuthedRequest extends Request {
  userId?: string;
}

const VALID_ROLES = ['system-admin', 'admin', 'teacher'] as const;
type Term = 'Semester 1' | 'Semester 2';
type TemplateStatus = 'draft' | 'published' | 'closed';
type HomeroomCommentMode = 'disabled' | 'optional' | 'required';
type ModuleType = 'subject_score' | 'subject_comment' | 'non_score_comment';
type ScoreVisibility = 'teacher_homeroom_admin';
type TargetLevel = 'A' | 'B' | 'C' | 'D';

const ensureUsersStudentIdOnce = createRunOnce();
const ensureUsersPrimarySubjectOnce = createRunOnce();
const ensureUsersNameZhEnOnce = createRunOnce();
let ensuredReportTemplateTables = false;
let ensuredOrgDepartmentsTable = false;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
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

function sanitizePresetSubjects(raw: unknown): Array<{
  courseId: string;
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  enableScore: boolean;
  enableTeacherComment: boolean;
  enableTarget: boolean;
  gradeDimensions: Array<{
    gradeId: string;
    dimensions: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>;
  }>;
  dimensions: Array<{
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>;
}> {
  if (!Array.isArray(raw)) return [];
  const usedSubjectKeys = new Set<string>();
  const out: Array<{
    courseId: string;
    subjectKey: string;
    subjectNameZh: string;
    subjectNameEn: string;
    enableScore: boolean;
    enableTeacherComment: boolean;
    enableTarget: boolean;
    gradeDimensions: Array<{
      gradeId: string;
      dimensions: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }>;
    }>;
    dimensions: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>;
  }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i] as Record<string, unknown>;
    const subjectNameZh = String(row.subjectNameZh ?? '').trim();
    const subjectNameEn = String(row.subjectNameEn ?? '').trim();
    if (!subjectNameZh || !subjectNameEn) continue;
    const courseId = String(row.courseId ?? '').trim();
    const requestedKey = String(row.subjectKey ?? '').trim();
    const baseKey = normalizeIdentifier(requestedKey || subjectNameEn);
    let subjectKey = baseKey;
    let seq = 2;
    while (usedSubjectKeys.has(subjectKey)) {
      subjectKey = `${baseKey}_${seq}`;
      seq += 1;
    }
    usedSubjectKeys.add(subjectKey);
    const dimsRaw = Array.isArray(row.dimensions) ? row.dimensions : [];
    const gradeDimsRaw = Array.isArray(row.gradeDimensions) ? row.gradeDimensions : [];
    const usedDimKeys = new Set<string>();
    const dimensions: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }> = [];
    for (let j = 0; j < dimsRaw.length; j += 1) {
      const dim = dimsRaw[j] as Record<string, unknown>;
      const dimensionLabelZh = String(dim.dimensionLabelZh ?? '').trim();
      const dimensionLabelEn = String(dim.dimensionLabelEn ?? '').trim();
      if (!dimensionLabelZh || !dimensionLabelEn) continue;
      // 不能仅用 normalizeIdentifier(en)：纯中文等标签会被压成同一 key「item」，导致只保留第一列
      const key = `${dimensionLabelZh}\u0001${dimensionLabelEn}`;
      if (usedDimKeys.has(key)) continue;
      usedDimKeys.add(key);
      dimensions.push({
        dimensionLabelZh,
        dimensionLabelEn,
        levelDescriptions: {},
      });
    }
    const gradeDimensions: Array<{
      gradeId: string;
      dimensions: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }>;
    }> = [];
    for (let j = 0; j < gradeDimsRaw.length; j += 1) {
      const rowGrade = gradeDimsRaw[j] as Record<string, unknown>;
      const gradeId = String(rowGrade.gradeId ?? '').trim();
      if (!gradeId) continue;
      const eachDimsRaw = Array.isArray(rowGrade.dimensions) ? rowGrade.dimensions : [];
      const usedEachDimKeys = new Set<string>();
      const eachDimensions: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }> = [];
      for (let k = 0; k < eachDimsRaw.length; k += 1) {
        const dim = eachDimsRaw[k] as Record<string, unknown>;
        const dimensionLabelZh = String(dim.dimensionLabelZh ?? '').trim();
        const dimensionLabelEn = String(dim.dimensionLabelEn ?? '').trim();
        if (!dimensionLabelZh || !dimensionLabelEn) continue;
        const key = `${dimensionLabelZh}\u0001${dimensionLabelEn}`;
        if (usedEachDimKeys.has(key)) continue;
        usedEachDimKeys.add(key);
        eachDimensions.push({
          dimensionLabelZh,
          dimensionLabelEn,
          levelDescriptions: {},
        });
      }
      gradeDimensions.push({ gradeId, dimensions: eachDimensions });
    }
    const fallbackDimensions =
      gradeDimensions.find((g) => g.dimensions.length > 0)?.dimensions ?? dimensions;
    const enableTarget =
      row.enableTarget === false
        ? false
        : (gradeDimensions.some((g) => g.dimensions.length > 0) || fallbackDimensions.length > 0);
    out.push({
      courseId,
      subjectKey,
      subjectNameZh,
      subjectNameEn,
      enableScore: row.enableScore !== false,
      enableTeacherComment: row.enableTeacherComment !== false,
      enableTarget,
      gradeDimensions,
      dimensions: enableTarget ? fallbackDimensions : [],
    });
  }
  return out;
}

function extractPresetSubjectsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const subs = (raw as { subjects?: unknown }).subjects;
    if (Array.isArray(subs)) return subs;
  }
  return [];
}

function extractStageInclusion(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const si = (raw as { stageInclusion?: unknown }).stageInclusion;
  if (!si || typeof si !== 'object' || Array.isArray(si)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(si)) {
    const key = String(k).trim();
    if (!key) continue;
    if (!Array.isArray(v)) continue;
    out[key] = v.map((x) => String(x).trim()).filter(Boolean);
  }
  return out;
}

function sanitizeUnifiedLevelDescriptions(raw: unknown): Partial<Record<TargetLevel, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  const out: Partial<Record<TargetLevel, string>> = {};
  for (const lv of ['A', 'B', 'C', 'D'] as const) {
    const v = String(rec[lv] ?? '').trim();
    if (v) out[lv] = v;
  }
  return out;
}

function extractUnifiedLevelDescriptions(raw: unknown): Partial<Record<TargetLevel, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const ul = (raw as { unifiedLevelDescriptions?: unknown }).unifiedLevelDescriptions;
  return sanitizeUnifiedLevelDescriptions(ul);
}

function parsePresetPayload(payload: unknown): {
  subjects: ReturnType<typeof sanitizePresetSubjects>;
  stageInclusion: Record<string, string[]>;
  evaluationGradeInclusion: ReturnType<typeof extractEvaluationGradeInclusion>;
  examGradeInclusion: ReturnType<typeof extractExamGradeInclusion>;
  examConfigs: ReturnType<typeof sanitizeExamConfigs>;
  unifiedLevelDescriptions: Partial<Record<TargetLevel, string>>;
} {
  return {
    subjects: sanitizePresetSubjects(extractPresetSubjectsArray(payload)),
    stageInclusion: extractStageInclusion(payload),
    evaluationGradeInclusion: extractEvaluationGradeInclusion(payload),
    examGradeInclusion: extractExamGradeInclusion(payload),
    examConfigs: sanitizeExamConfigs(payload),
    unifiedLevelDescriptions: extractUnifiedLevelDescriptions(payload),
  };
}

async function getCallerRole(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return (result.rows[0]?.role as string | undefined) ?? null;
}

function normalizePageLimit(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 20;
  const intNum = Math.floor(num);
  if (intNum < 1) return 1;
  if (intNum > 100) return 100;
  return intNum;
}

function normalizePageOffset(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  const intNum = Math.floor(num);
  if (intNum < 0) return 0;
  return intNum;
}
async function ensureUsersStudentIdColumn(): Promise<void> {
  await ensureUsersStudentIdOnce.run(async () => {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(50)');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id_unique ON users(student_id) WHERE student_id IS NOT NULL',
  );
  try {
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
    `);
  } catch {
    /* constraint may already exist */
  }
  });
}

async function ensureUsersPrimarySubjectColumn(): Promise<void> {
  await ensureUsersPrimarySubjectOnce.run(async () => {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_subject VARCHAR(120)');
  });
}

async function ensureUsersNameZhEn(): Promise<void> {
  await ensureUsersNameZhEnOnce.run(async () => {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name_zh VARCHAR(100)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name_en VARCHAR(100)');
  });
}

function resolveUserDisplayLabel(row: {
  name_zh?: string | null;
  name_en?: string | null;
  display_name?: string | null;
  username?: string | null;
}): string {
  const z = (row.name_zh ?? '').toString().trim();
  const e = (row.name_en ?? '').toString().trim();
  if (z || e) return z || e;
  const d = (row.display_name ?? '').toString().trim();
  if (d) return d;
  return (row.username ?? '').toString().trim() || '';
}

async function ensureReportTemplateTables(): Promise<void> {
  if (ensuredReportTemplateTables) return;
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
    )
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
    CREATE INDEX IF NOT EXISTS idx_report_score_grade_bands_year_admin
      ON student_report_score_grade_bands(academic_year_id)
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
    )
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
    )
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
    )
  `);
  // 历史库为 VARCHAR(120)：双语维度名、等第说明、长课程名保存时会触发 value too long → 500
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_report_year_dimension_presets (
      academic_year_id VARCHAR(50) PRIMARY KEY REFERENCES academic_years(id) ON DELETE CASCADE,
      homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK (homeroom_comment_mode IN ('disabled', 'optional', 'required')),
      payload JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    ALTER TABLE student_report_year_dimension_presets
    ADD COLUMN IF NOT EXISTS homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional'
  `);
  await pool.query(`
    ALTER TABLE student_report_year_dimension_presets
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '[]'::jsonb
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
  ensuredReportTemplateTables = true;
}

async function ensureOrgDepartmentsTable(): Promise<void> {
  if (ensuredOrgDepartmentsTable) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_departments (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      parent_id VARCHAR(50) REFERENCES org_departments(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_org_departments_parent ON org_departments(parent_id)');
  ensuredOrgDepartmentsTable = true;
}

/** 从 nodeId 沿 parent 链向上走，若遇到 ancestorId 则 nodeId 在 ancestorId 子树内 */
async function isOrgDeptUnderAncestor(ancestorId: string, nodeId: string): Promise<boolean> {
  let cur: string | null = nodeId;
  const guard: Set<string> = new Set();
  for (;;) {
    if (cur == null) break;
    if (cur === ancestorId) return true;
    if (guard.has(cur)) break;
    guard.add(cur);
    const thisId: string = cur;
    const res: { rows: Array<{ parent_id: string | null }> } = await pool.query(
      'SELECT parent_id FROM org_departments WHERE id = $1',
      [thisId],
    );
    const nextParent: string | null = res.rows[0]?.parent_id ?? null;
    cur = nextParent;
  }
  return false;
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

function randomSixDigitPassword(): string {
  return String(crypto.randomInt(100000, 1000000));
}

// 仅允许 system-admin 或 admin 访问本路由
async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const role = await getCallerRole(req.userId);
    if (!role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin panel access required' });
    }
    return next();
  } catch (error) {
    console.error('requireAdmin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

router.use(requireAdmin);

// 数据库浏览（只读）：仅 system-admin 可见
router.get('/database/tables', async (req: AuthedRequest, res: Response) => {
  try {
    const callerRole = await getCallerRole(req.userId);
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: system-admin required' });
    }

    const tableRows = (await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name ASC`
    )).rows as Array<{ table_name: string }>;

    const tables: Array<{ tableName: string; rowCount: number }> = [];
    for (const row of tableRows) {
      const tableName = row.table_name;
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM ${quoteIdentifier('public')}.${quoteIdentifier(tableName)}`
      );
      tables.push({
        tableName,
        rowCount: Number(countResult.rows[0]?.count ?? 0),
      });
    }

    return res.json({ tables });
  } catch (error) {
    console.error('Get database tables error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/database/tables/:tableName/rows', async (req: AuthedRequest, res: Response) => {
  try {
    const callerRole = await getCallerRole(req.userId);
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: system-admin required' });
    }

    const tableName = String(req.params.tableName ?? '').trim();
    if (!tableName) {
      return res.status(400).json({ error: 'tableName is required' });
    }

    const tableExists = ((await pool.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = $1
       LIMIT 1`,
      [tableName]
    )).rowCount ?? 0) > 0;
    if (!tableExists) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const columnsResult = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position ASC`,
      [tableName]
    );
    const columns = columnsResult.rows.map((r) => r.column_name as string);

    const pkResult = await pool.query(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
       WHERE i.indisprimary = true
         AND n.nspname = 'public'
         AND c.relname = $1
       ORDER BY a.attnum ASC
       LIMIT 1`,
      [tableName]
    );
    const primaryKey = (pkResult.rows[0]?.column_name as string | undefined) ?? null;

    const limit = normalizePageLimit(req.query.limit);
    const offset = normalizePageOffset(req.query.offset);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ${quoteIdentifier('public')}.${quoteIdentifier(tableName)}`
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const orderSql = primaryKey ? ` ORDER BY ${quoteIdentifier(primaryKey)} ASC` : '';
    const rowsResult = await pool.query(
      `SELECT *
       FROM ${quoteIdentifier('public')}.${quoteIdentifier(tableName)}${orderSql}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      tableName,
      columns,
      primaryKey,
      page: {
        limit,
        offset,
        total,
      },
      rows: rowsResult.rows as Array<Record<string, unknown>>,
    });
  } catch (error) {
    console.error('Get table rows error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取用户列表：scope=staff（默认）| students；学生账号列表供管理员与系统管理员查看
router.get('/users', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureUsersStudentIdColumn();
    await ensureUsersPrimarySubjectColumn();
    await ensureUsersNameZhEn();
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;
    const scope = (req.query.scope as string) === 'students' ? 'students' : 'staff';

    if (scope === 'students') {
      const result = await pool.query(
        `SELECT u.id, u.username, u.role, u.display_name, u.name_zh AS user_name_zh, u.name_en AS user_name_en,
                u.password, u.department, u.primary_subject, u.student_id, u.created_at,
                s.name_zh, s.name_en
         FROM users u
         LEFT JOIN students s ON s.id = u.student_id
         WHERE u.role = 'student'
         ORDER BY u.created_at DESC NULLS LAST, u.username ASC`,
      );
      const users = result.rows.map((row) => {
        const userNameZh = (row.user_name_zh as string | null) ?? null;
        const userNameEn = (row.user_name_en as string | null) ?? null;
        return {
          id: row.id as string,
          username: row.username as string,
          role: row.role as string,
          displayName: resolveUserDisplayLabel({
            name_zh: userNameZh,
            name_en: userNameEn,
            display_name: row.display_name as string | null,
            username: row.username as string,
          }),
          nameZh: userNameZh,
          nameEn: userNameEn,
          password: (row.password as string | null) ?? null,
          department: (row.department as string | null) ?? null,
          primarySubject: (row.primary_subject as string | null) ?? null,
          studentId: (row.student_id as string | null) ?? null,
          studentNameZh: (row.name_zh as string | null) ?? null,
          studentNameEn: (row.name_en as string | null) ?? null,
          createdAt: (row.created_at as Date | null)?.toISOString() ?? undefined,
        };
      });
      return res.json({ users });
    }

    let result;
    if (callerRole === 'system-admin') {
      result = await pool.query(
        "SELECT id, username, role, display_name, name_zh, name_en, password, department, primary_subject, created_at FROM users WHERE role IN ('admin', 'teacher') ORDER BY created_at DESC, username ASC",
      );
    } else {
      result = await pool.query(
        "SELECT id, username, role, display_name, name_zh, name_en, password, department, primary_subject, created_at FROM users WHERE role = 'teacher' ORDER BY created_at DESC, username ASC",
      );
    }
    const users = result.rows.map((row) => ({
      id: row.id as string,
      username: row.username as string,
      role: row.role as string,
      displayName: resolveUserDisplayLabel({
        name_zh: row.name_zh as string | null,
        name_en: row.name_en as string | null,
        display_name: row.display_name as string | null,
        username: row.username as string,
      }),
      nameZh: (row.name_zh as string | null) ?? null,
      nameEn: (row.name_en as string | null) ?? null,
      password: (row.password as string | null) ?? null,
      department: (row.department as string | null) ?? null,
      primarySubject: (row.primary_subject as string | null) ?? null,
      createdAt: (row.created_at as Date | null)?.toISOString() ?? undefined,
    }));
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 批量开通学生登录：学号作 username，随机6 位数字密码（bcrypt 存储）
router.post('/users/import-student-accounts', async (req: AuthedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureUsersStudentIdColumn();
    await ensureUsersNameZhEn();
    const body = req.body as {
      items?: Array<{ studentId: string; password: string }>;
    };
    const items = Array.isArray(body.items) ? body.items : [];

    const created: Array<{ studentId: string; username: string; password: string; displayName: string; userId: string }> = [];
    const skipped: Array<{ studentId: string; reason: string }> = [];

    let rows: Array<{ id: string; student_number: string; name: string; name_zh: string | null; name_en: string | null }>;
    if (items.length === 0) {
      const r = await client.query(
        `SELECT id, student_number, name, name_zh, name_en FROM students
         WHERE student_number IS NOT NULL AND TRIM(student_number) <> ''`,
      );
      rows = r.rows as typeof rows;
    } else {
      const idSet = new Set(items.map((i) => i.studentId));
      const r = await client.query(
        `SELECT id, student_number, name, name_zh, name_en FROM students
         WHERE id = ANY($1::varchar[])`,
        [Array.from(idSet)],
      );
      rows = r.rows as typeof rows;
      for (const it of items) {
        if (!rows.some((row) => row.id === it.studentId)) {
          skipped.push({ studentId: it.studentId, reason: 'student_not_found' });
        }
      }
    }

    await client.query('BEGIN');
    for (const s of rows) {
      const uname = String(s.student_number).trim();
      if (!uname) {
        skipped.push({ studentId: s.id, reason: 'empty_student_number' });
        continue;
      }
      const dup = await client.query(
        `SELECT id FROM users WHERE student_id = $1 OR LOWER(TRIM(username)) = LOWER(TRIM($2)) LIMIT 1`,
        [s.id, uname],
      );
      if (dup.rows.length > 0) {
        skipped.push({ studentId: s.id, reason: 'account_or_username_exists' });
        continue;
      }
      let plain: string;
      if (items.length > 0) {
        const it = items.find((x) => x.studentId === s.id);
        if (!it?.password || !/^\d{6}$/.test(it.password)) {
          skipped.push({ studentId: s.id, reason: 'invalid_password' });
          continue;
        }
        plain = it.password;
      } else {
        plain = randomSixDigitPassword();
      }
      const hash = await bcrypt.hash(plain, 10);
      const displayName = String(s.name_zh || s.name_en || s.name || uname).trim() || uname;
      const nmZh = String(s.name_zh || '').trim() || null;
      const nmEn = String(s.name_en || '').trim() || null;
      const newId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await client.query(
        `INSERT INTO users (id, username, display_name, name_zh, name_en, role, password_hash, password, student_id, department, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'student', $6, $7, $8, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [newId, uname, displayName, nmZh, nmEn, hash, plain, s.id],
      );
      created.push({ studentId: s.id, username: uname, password: plain, displayName, userId: newId });
    }
    await client.query('COMMIT');
    res.status(201).json({ created, skipped });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import student accounts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 创建新用户：system-admin 可创建管理员或教师，admin 仅可创建教师
router.post('/users', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureUsersPrimarySubjectColumn();
    await ensureUsersNameZhEn();
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { username, displayName, nameZh, nameEn, role, password, department, primarySubject } = req.body as {
      username?: string;
      displayName?: string;
      nameZh?: string | null;
      nameEn?: string | null;
      role?: string;
      password?: string;
      department?: string | null;
      primarySubject?: string | null;
    };

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password and role are required' });
    }

    const nz = nameZh !== undefined && nameZh !== null ? String(nameZh).trim() : '';
    const ne = nameEn !== undefined && nameEn !== null ? String(nameEn).trim() : '';
    const legacyDisp = displayName !== undefined && displayName !== null ? String(displayName).trim() : '';
    let nameZhVal = nz;
    let nameEnVal = ne;
    if (!nameZhVal && !nameEnVal && legacyDisp) {
      nameZhVal = legacyDisp;
    }
    if (!nameZhVal && !nameEnVal) {
      return res.status(400).json({ error: 'At least one of nameZh or nameEn is required' });
    }
    const displayLabel = (nameZhVal || nameEnVal || username.trim()).trim();
    const nameZhDb = nameZhVal.length > 0 ? nameZhVal : null;
    const nameEnDb = nameEnVal.length > 0 ? nameEnVal : null;

    if (!VALID_ROLES.includes(role as any)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (callerRole === 'system-admin' && role === 'system-admin') {
      return res.status(403).json({ error: 'Cannot create system-admin via panel' });
    }
    if (callerRole === 'admin' && role !== 'teacher') {
      return res.status(403).json({ error: 'Admin can only create teacher accounts' });
    }

    const existing = await pool.query('SELECT 1 FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const dept = department && String(department).trim() ? String(department).trim() : null;
    const subjRaw = primarySubject === undefined || primarySubject === null ? '' : String(primarySubject).trim();
    const subj = subjRaw === '' ? null : subjRaw;
    const newId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const result = await pool.query(
      'INSERT INTO users (id, username, display_name, name_zh, name_en, role, password_hash, password, department, primary_subject, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id, username, role, display_name, name_zh, name_en, password, department, primary_subject, created_at',
      [newId, username.trim(), displayLabel, nameZhDb, nameEnDb, role, hash, password, dept, subj],
    );

    const row = result.rows[0] as {
      id: string;
      username: string;
      role: string;
      display_name: string | null;
      name_zh: string | null;
      name_en: string | null;
      password: string | null;
      department: string | null;
      primary_subject: string | null;
      created_at: Date | null;
    };

    res.status(201).json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        displayName: resolveUserDisplayLabel({
          name_zh: row.name_zh,
          name_en: row.name_en,
          display_name: row.display_name,
          username: row.username,
        }),
        nameZh: row.name_zh ?? null,
        nameEn: row.name_en ?? null,
        password: row.password ?? password,
        department: row.department ?? null,
        primarySubject: row.primary_subject ?? null,
        createdAt: row.created_at?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 删除用户：system-admin 可删管理员/教师，admin 仅可删教师；需 body 中 confirmUsername
router.delete('/users/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { id } = req.params;
    const { confirmUsername } = req.body as { confirmUsername?: string };
    if (!confirmUsername || typeof confirmUsername !== 'string') {
      return res.status(400).json({ error: 'confirmUsername is required in body' });
    }
    const getResult = await pool.query('SELECT username, role FROM users WHERE id = $1', [id]);
    if (getResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = getResult.rows[0] as { username: string; role: string };
    if (row.username !== confirmUsername) {
      return res.status(400).json({ error: 'Username does not match' });
    }
    if (row.role === 'system-admin') {
      return res.status(403).json({ error: 'Cannot delete system-admin' });
    }
    if (callerRole === 'admin' && row.role !== 'teacher' && row.role !== 'student') {
      return res.status(403).json({ error: 'Admin can only delete teacher or student accounts' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新单个用户部门、主学科与/或姓名（至少传一项可写字段）
router.patch('/users/:id', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureUsersPrimarySubjectColumn();
    await ensureUsersNameZhEn();
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { id } = req.params;
    const body = req.body as {
      department?: string | null;
      primarySubject?: string | null;
      nameZh?: string | null;
      nameEn?: string | null;
    };
    const hasDept = Object.prototype.hasOwnProperty.call(body, 'department');
    const hasSubj = Object.prototype.hasOwnProperty.call(body, 'primarySubject');
    const hasNameZh = Object.prototype.hasOwnProperty.call(body, 'nameZh');
    const hasNameEn = Object.prototype.hasOwnProperty.call(body, 'nameEn');

    const normNameField = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      const t = String(v).trim();
      return t === '' ? null : t;
    };

    const dept = hasDept
      ? body.department == null || String(body.department).trim() === ''
        ? null
        : String(body.department).trim()
      : undefined;
    const subj = hasSubj
      ? body.primarySubject == null || String(body.primarySubject).trim() === ''
        ? null
        : String(body.primarySubject).trim()
      : undefined;

    if (!hasDept && !hasSubj && !hasNameZh && !hasNameEn) {
      return res.status(400).json({ error: 'At least one of department, primarySubject, nameZh, nameEn is required' });
    }

    const targetResult = await pool.query(
      'SELECT role, name_zh, name_en, username, display_name FROM users WHERE id = $1',
      [id],
    );
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const cur = targetResult.rows[0] as {
      role: string;
      name_zh: string | null;
      name_en: string | null;
      username: string;
      display_name: string | null;
    };
    const targetRole = cur.role as string;
    if (targetRole === 'student') {
      return res.status(403).json({ error: 'Student accounts cannot be updated here; remove the login account to revoke access' });
    }
    if (callerRole === 'admin' && targetRole !== 'teacher') {
      return res.status(403).json({ error: 'Admin can only update teacher accounts' });
    }

    let nextZh = normNameField(cur.name_zh);
    let nextEn = normNameField(cur.name_en);
    if (hasNameZh) nextZh = normNameField(body.nameZh);
    if (hasNameEn) nextEn = normNameField(body.nameEn);
    if (hasNameZh || hasNameEn) {
      if (!nextZh && !nextEn) {
        return res.status(400).json({ error: 'At least one of nameZh or nameEn is required' });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (dept !== undefined) {
      sets.push(`department = $${i}`);
      params.push(dept);
      i += 1;
    }
    if (subj !== undefined) {
      sets.push(`primary_subject = $${i}`);
      params.push(subj);
      i += 1;
    }
    if (hasNameZh || hasNameEn) {
      const displayLabel = resolveUserDisplayLabel({
        name_zh: nextZh,
        name_en: nextEn,
        display_name: cur.display_name,
        username: cur.username,
      });
      sets.push(`name_zh = $${i}`);
      params.push(nextZh);
      i += 1;
      sets.push(`name_en = $${i}`);
      params.push(nextEn);
      i += 1;
      sets.push(`display_name = $${i}`);
      params.push(displayLabel);
      i += 1;
    }
    params.push(id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING id, username, role, display_name, name_zh, name_en, department, primary_subject, created_at`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = result.rows[0] as {
      id: string;
      username: string;
      role: string;
      display_name: string | null;
      name_zh: string | null;
      name_en: string | null;
      department: string | null;
      primary_subject: string | null;
      created_at: Date | null;
    };
    res.json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        displayName: resolveUserDisplayLabel({
          name_zh: row.name_zh,
          name_en: row.name_en,
          display_name: row.display_name,
          username: row.username,
        }),
        nameZh: row.name_zh ?? null,
        nameEn: row.name_en ?? null,
        department: row.department ?? null,
        primarySubject: row.primary_subject ?? null,
        createdAt: row.created_at?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Patch user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新用户角色：仅系统管理员可操作，可将管理员与教师互改
router.put('/users/:id/role', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Only system admin can change roles' });
    }

    const { id } = req.params;
    const { role: newRole } = req.body as { role?: string };
    if (!newRole || !['admin', 'teacher'].includes(newRole)) {
      return res.status(400).json({ error: 'role must be admin or teacher' });
    }

    const targetResult = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const targetRole = targetResult.rows[0].role as string;
    if (targetRole === 'system-admin') {
      return res.status(403).json({ error: 'Cannot change system-admin role' });
    }
    if (targetRole === 'student') {
      return res.status(403).json({ error: 'Cannot change student role via this endpoint' });
    }

    await pool.query('UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newRole, id]);
    res.json({ success: true, role: newRole });
  } catch (error) {
    console.error('Put role error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 批量设置用户部门
router.post('/users/batch-department', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { userIds, department } = req.body as { userIds?: string[]; department?: string | null };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required and non-empty' });
    }
    let idsToUpdate = userIds;
    if (callerRole === 'admin') {
      const roleResult = await pool.query(
        "SELECT id FROM users WHERE id = ANY($1) AND role = 'teacher'",
        [userIds],
      );
      idsToUpdate = roleResult.rows.map((r) => r.id as string);
    }
    if (idsToUpdate.length === 0) {
      return res.status(403).json({ error: 'Admin can only update teacher accounts' });
    }
    const dept = department == null || String(department).trim() === '' ? null : String(department).trim();
    await pool.query(
      'UPDATE users SET department = $1, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($2)',
      [dept, idsToUpdate],
    );
    res.json({ success: true, count: idsToUpdate.length });
  } catch (error) {
    console.error('Batch department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function loadAdminScoreMinScores(
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
  return mergeReportScoreGradeMinScores(r.rows[0]?.min_scores as Partial<Record<string, number>> | undefined);
}

async function loadTemplateDetail(templateId: string) {
  const tpl = (await pool.query(
    `SELECT id, academic_year_id, term, title, status, homeroom_comment_mode,
            template_type, is_active, published_at, released_at,
            COALESCE(school_segment_id, '') AS school_segment_id
     FROM student_report_templates
     WHERE id = $1
     LIMIT 1`,
    [templateId]
  )).rows[0] as
    | {
      id: string;
      academic_year_id: string;
      term: Term;
      title: string | null;
      status: TemplateStatus;
      homeroom_comment_mode: HomeroomCommentMode | null;
      template_type: 'portrait-evaluation' | null;
      is_active: boolean | null;
      published_at: Date | null;
      released_at: Date | null;
      school_segment_id: string;
    }
    | undefined;
  if (!tpl) return null;
  const rows = (await pool.query(
    `SELECT s.id AS subject_id, s.subject_key, s.subject_name, s.subject_name_zh, s.subject_name_en,
            s.module_type, s.enable_score, s.enable_teacher_comment, s.enable_learning_quality, s.score_visibility, s.sort_order,
            d.id AS dimension_id, d.dimension_key, d.dimension_label, d.dimension_label_zh, d.dimension_label_en, d.sort_order AS dimension_sort,
            ld.level, ld.description
     FROM student_report_template_subjects s
     LEFT JOIN student_report_template_dimensions d ON d.template_subject_id = s.id
     LEFT JOIN student_report_template_level_descriptions ld ON ld.template_dimension_id = d.id
     WHERE s.template_id = $1
     ORDER BY s.sort_order ASC, d.sort_order ASC, ld.level ASC`,
    [tpl.id]
  )).rows as Array<{
    subject_id: string;
    subject_key: string;
    subject_name: string;
    subject_name_zh: string;
    subject_name_en: string;
    module_type: ModuleType | null;
    enable_score: boolean | null;
    enable_teacher_comment: boolean | null;
    enable_learning_quality: boolean | null;
    score_visibility: ScoreVisibility | null;
    sort_order: number;
    dimension_id: string | null;
    dimension_key: string | null;
    dimension_label: string | null;
    dimension_label_zh: string | null;
    dimension_label_en: string | null;
    dimension_sort: number | null;
    level: 'A' | 'B' | 'C' | 'D' | null;
    description: string | null;
  }>;
  const subjectMap = new Map<string, {
    id: string;
    subjectKey: string;
    subjectName: string;
    subjectNameZh: string;
    subjectNameEn: string;
    moduleType: ModuleType;
    enableScore: boolean;
    enableTeacherComment: boolean;
    enableLearningQuality: boolean;
    scoreVisibility: ScoreVisibility;
    sortOrder: number;
    dimensions: Array<{
      id: string;
      dimensionKey: string;
      dimensionLabel: string;
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      sortOrder: number;
      levelDescriptions: Partial<Record<'A' | 'B' | 'C' | 'D', string>>;
    }>;
  }>();
  const dimensionBySubject = new Map<string, Map<string, {
    id: string;
    dimensionKey: string;
    dimensionLabel: string;
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    sortOrder: number;
    levelDescriptions: Partial<Record<'A' | 'B' | 'C' | 'D', string>>;
  }>>();
  for (const row of rows) {
    const subject = subjectMap.get(row.subject_id) ?? {
      id: row.subject_id,
      subjectKey: row.subject_key,
      subjectName: row.subject_name,
      subjectNameZh: row.subject_name_zh || row.subject_name,
      subjectNameEn: row.subject_name_en || row.subject_name,
      moduleType: (row.module_type ?? 'subject_score') as ModuleType,
      enableScore: row.enable_score !== false,
      enableTeacherComment: row.enable_teacher_comment !== false,
      enableLearningQuality: row.enable_learning_quality !== false,
      scoreVisibility: (row.score_visibility ?? 'teacher_homeroom_admin') as ScoreVisibility,
      sortOrder: row.sort_order,
      dimensions: [],
    };
    subjectMap.set(row.subject_id, subject);
    if (!row.dimension_id) continue;
    const dimMap = dimensionBySubject.get(row.subject_id) ?? new Map();
    const dim = dimMap.get(row.dimension_id) ?? {
      id: row.dimension_id,
      dimensionKey: row.dimension_key ?? '',
      dimensionLabel: row.dimension_label ?? '',
      dimensionLabelZh: row.dimension_label_zh ?? row.dimension_label ?? '',
      dimensionLabelEn: row.dimension_label_en ?? row.dimension_label ?? '',
      sortOrder: row.dimension_sort ?? 0,
      levelDescriptions: {},
    };
    if (row.level && row.description) dim.levelDescriptions[row.level] = row.description;
    dimMap.set(row.dimension_id, dim);
    dimensionBySubject.set(row.subject_id, dimMap);
  }
  for (const [subjectId, subject] of subjectMap.entries()) {
    subject.dimensions = Array.from((dimensionBySubject.get(subjectId) ?? new Map()).values())
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  const schoolSegmentId = String(tpl.school_segment_id ?? '').trim();
  const scoreGradeMinScores = await loadAdminScoreMinScores(tpl.academic_year_id, tpl.term, schoolSegmentId);
  return {
    id: tpl.id,
    academicYearId: tpl.academic_year_id,
    term: tpl.term,
    title: tpl.title ?? null,
    status: tpl.status,
    templateType: tpl.template_type ?? 'portrait-evaluation',
    isActive: tpl.is_active !== false,
    publishedAt: tpl.published_at?.toISOString() ?? null,
    releasedAt: tpl.released_at?.toISOString() ?? null,
    homeroomCommentMode: tpl.homeroom_comment_mode ?? 'optional',
    schoolSegmentId,
    scoreGradeMinScores,
    subjects,
  };
}

// 学生画像评价模板列表
router.get('/report-templates', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const yearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    const term = req.query.term === 'Semester 1' || req.query.term === 'Semester 2' ? req.query.term : null;
    const where: string[] = [];
    const values: string[] = [];
    if (yearId) {
      values.push(yearId);
      where.push(`t.academic_year_id = $${values.length}`);
    }
    if (term) {
      values.push(term);
      where.push(`t.term = $${values.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT t.id, t.academic_year_id, t.term, t.title, t.status, t.homeroom_comment_mode,
              t.template_type, t.is_active, t.published_at, t.released_at, t.updated_at,
              COALESCE(t.school_segment_id, '') AS school_segment_id, ay.name AS academic_year_name
       FROM student_report_templates t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       ${whereSql}
       ORDER BY ay.start_date DESC NULLS LAST, t.term ASC, t.updated_at DESC NULLS LAST`,
      values
    )).rows;
    const templates = rows.map((r) => ({
      id: r.id as string,
      academicYearId: r.academic_year_id as string,
      academicYearName: r.academic_year_name as string,
      term: r.term as Term,
      title: (r.title as string | null) ?? null,
      status: r.status as TemplateStatus,
      templateType: ((r.template_type as string | null) ?? 'portrait-evaluation') as 'portrait-evaluation',
      isActive: (r.is_active as boolean | null) !== false,
      publishedAt: (r.published_at as Date | null)?.toISOString() ?? null,
      releasedAt: (r.released_at as Date | null)?.toISOString() ?? null,
      homeroomCommentMode: (r.homeroom_comment_mode as HomeroomCommentMode | null) ?? 'optional',
      schoolSegmentId: String(r.school_segment_id ?? '').trim(),
      updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
    }));
    res.json({ templates });
  } catch (error) {
    console.error('Get report templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 学年学科目标维度框架（用于期中/期末模板快速复用）
router.get('/report-dimension-presets/:academicYearId', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const academicYearId = String(req.params.academicYearId ?? '').trim();
    if (!academicYearId) return res.status(400).json({ error: 'academicYearId required' });
    const row = (await pool.query(
      `SELECT academic_year_id, homeroom_comment_mode, payload, updated_at
       FROM student_report_year_dimension_presets
       WHERE academic_year_id = $1
       LIMIT 1`,
      [academicYearId]
    )).rows[0] as
      | {
        academic_year_id: string;
        homeroom_comment_mode: HomeroomCommentMode | null;
        payload: unknown;
        updated_at: Date | null;
      }
      | undefined;
    if (!row) return res.json({ preset: null });
    const parsed = parsePresetPayload(row.payload);
    const preset = {
      academicYearId: row.academic_year_id,
      homeroomCommentMode: row.homeroom_comment_mode ?? 'optional',
      subjects: parsed.subjects,
      stageInclusion: parsed.stageInclusion,
      evaluationGradeInclusion: parsed.evaluationGradeInclusion,
      examGradeInclusion: parsed.examGradeInclusion,
      examConfigs: parsed.examConfigs,
      unifiedLevelDescriptions: parsed.unifiedLevelDescriptions,
      updatedAt: row.updated_at?.toISOString() ?? null,
    };
    return res.json({ preset });
  } catch (error) {
    console.error('Get report dimension preset error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/report-dimension-presets/:academicYearId', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const academicYearId = String(req.params.academicYearId ?? '').trim();
    if (!academicYearId) return res.status(400).json({ error: 'academicYearId required' });
    const homeroomCommentMode = (req.body?.homeroomCommentMode ?? 'optional') as HomeroomCommentMode;
    if (!['disabled', 'optional', 'required'].includes(homeroomCommentMode)) {
      return res.status(400).json({ error: 'homeroomCommentMode must be disabled|optional|required' });
    }
    const existingRow = (
      await pool.query(`SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`, [academicYearId])
    ).rows[0] as { payload: unknown } | undefined;
    const existing = existingRow
      ? parsePresetPayload(existingRow.payload)
      : {
          subjects: [] as ReturnType<typeof sanitizePresetSubjects>,
          stageInclusion: {} as Record<string, string[]>,
          evaluationGradeInclusion: {} as ReturnType<typeof extractEvaluationGradeInclusion>,
          examGradeInclusion: {} as ReturnType<typeof extractExamGradeInclusion>,
          examConfigs: {} as ReturnType<typeof sanitizeExamConfigs>,
          unifiedLevelDescriptions: {} as Partial<Record<TargetLevel, string>>,
        };
    const newSubjects = sanitizePresetSubjects(req.body?.subjects);
    const subjectsToStore = newSubjects.length > 0 ? newSubjects : existing.subjects;
    const stageInclusion =
      req.body?.stageInclusion !== undefined && req.body?.stageInclusion !== null
        ? extractStageInclusion({ stageInclusion: req.body.stageInclusion })
        : existing.stageInclusion;
    const evaluationGradeInclusion =
      req.body?.evaluationGradeInclusion !== undefined && req.body?.evaluationGradeInclusion !== null
        ? extractEvaluationGradeInclusion({ evaluationGradeInclusion: req.body.evaluationGradeInclusion })
        : existing.evaluationGradeInclusion;
    const examGradeInclusion =
      req.body?.examGradeInclusion !== undefined && req.body?.examGradeInclusion !== null
        ? extractExamGradeInclusion({ examGradeInclusion: req.body.examGradeInclusion })
        : existing.examGradeInclusion;
    const examConfigs =
      req.body?.examConfigs !== undefined && req.body?.examConfigs !== null
        ? sanitizeExamConfigs({ examConfigs: req.body.examConfigs })
        : existing.examConfigs;
    const unifiedLevelDescriptions =
      req.body?.unifiedLevelDescriptions !== undefined && req.body?.unifiedLevelDescriptions !== null
        ? sanitizeUnifiedLevelDescriptions(req.body.unifiedLevelDescriptions)
        : existing.unifiedLevelDescriptions;
    const payload = JSON.stringify({
      subjects: subjectsToStore,
      stageInclusion,
      evaluationGradeInclusion,
      examGradeInclusion,
      examConfigs,
      unifiedLevelDescriptions,
    });
    await pool.query(
      `INSERT INTO student_report_year_dimension_presets
        (academic_year_id, homeroom_comment_mode, payload, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id) DO UPDATE
       SET homeroom_comment_mode = EXCLUDED.homeroom_comment_mode,
           payload = EXCLUDED.payload,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
      [academicYearId, homeroomCommentMode, payload, req.userId ?? null]
    );
    return res.json({
      success: true,
      preset: {
        academicYearId,
        homeroomCommentMode,
        subjects: subjectsToStore,
        stageInclusion,
        evaluationGradeInclusion,
        examGradeInclusion,
        examConfigs,
        unifiedLevelDescriptions,
      },
    });
  } catch (error) {
    console.error('Upsert report dimension preset error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/report-score-grade-bands', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const academicYearId = String(req.query.academicYearId ?? '').trim();
    const term = req.query.term === 'Semester 1' || req.query.term === 'Semester 2' ? (req.query.term as Term) : null;
    const schoolSegmentId = String(req.query.schoolSegmentId ?? '').trim();
    if (!academicYearId || !term) {
      return res.status(400).json({ error: 'academicYearId and term are required' });
    }
    const minScores = await loadAdminScoreMinScores(academicYearId, term, schoolSegmentId);
    return res.json({ academicYearId, term, schoolSegmentId, minScores });
  } catch (error) {
    console.error('Get report score grade bands error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/report-score-grade-bands', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const academicYearId = String(req.body?.academicYearId ?? '').trim();
    const term = req.body?.term === 'Semester 1' || req.body?.term === 'Semester 2' ? (req.body.term as Term) : null;
    const schoolSegmentId = String(req.body?.schoolSegmentId ?? '').trim();
    const raw = req.body?.minScores;
    if (!academicYearId || !term) {
      return res.status(400).json({ error: 'academicYearId and term are required' });
    }
    if (!schoolSegmentId) {
      return res.status(400).json({ error: 'schoolSegmentId is required' });
    }
    if (!raw || typeof raw !== 'object') {
      return res.status(400).json({ error: 'minScores object is required' });
    }
    const merged = mergeReportScoreGradeMinScores(raw as Partial<Record<string, number>>);
    for (const g of REPORT_SCORE_LETTER_GRADES) {
      const n = merged[g];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: `Invalid min score for ${g}` });
      }
    }
    for (let i = 0; i < REPORT_SCORE_LETTER_GRADES.length - 1; i += 1) {
      const hi = REPORT_SCORE_LETTER_GRADES[i];
      const lo = REPORT_SCORE_LETTER_GRADES[i + 1];
      if (merged[hi] < merged[lo]) {
        return res.status(400).json({ error: 'Each grade must have a min score ≥ the next grade (A+ down to D)' });
      }
    }
    await pool.query(
      `INSERT INTO student_report_score_grade_bands
        (academic_year_id, term, school_segment_id, min_scores, updated_by, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id, term, school_segment_id)
       DO UPDATE SET min_scores = EXCLUDED.min_scores, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [academicYearId, term, schoolSegmentId, JSON.stringify(merged), req.userId ?? null],
    );
    return res.json({ success: true, academicYearId, term, schoolSegmentId, minScores: merged });
  } catch (error) {
    console.error('Put report score grade bands error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 新建模板
router.post('/report-templates', async (req: AuthedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureReportTemplateTables();
    const academicYearId = String(req.body?.academicYearId ?? '').trim();
    const term = req.body?.term === 'Semester 1' || req.body?.term === 'Semester 2' ? req.body.term as Term : null;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : null;
    const sourceTemplateId = typeof req.body?.sourceTemplateId === 'string' ? req.body.sourceTemplateId.trim() : '';
    let schoolSegmentId = typeof req.body?.schoolSegmentId === 'string' ? req.body.schoolSegmentId.trim() : '';
    if (!academicYearId || !term) {
      return res.status(400).json({ error: 'academicYearId and term are required' });
    }
    const templateId = `srt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await client.query('BEGIN');
    let homeroomCommentMode: HomeroomCommentMode = 'optional';
    let sourceTemplate: Awaited<ReturnType<typeof loadTemplateDetail>> = null;
    if (sourceTemplateId) {
      sourceTemplate = await loadTemplateDetail(sourceTemplateId);
      if (!sourceTemplate) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'sourceTemplateId not found' });
      }
      homeroomCommentMode = sourceTemplate.homeroomCommentMode;
      if (!schoolSegmentId) schoolSegmentId = sourceTemplate.schoolSegmentId ?? '';
    }
    await client.query(
      `INSERT INTO student_report_templates
        (id, academic_year_id, term, title, status, template_type, is_active, homeroom_comment_mode, school_segment_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'draft', 'portrait-evaluation', TRUE, $5, $6, $7, $8)`,
      [templateId, academicYearId, term, title || null, homeroomCommentMode, schoolSegmentId, req.userId ?? null, req.userId ?? null]
    );
    if (sourceTemplateId && sourceTemplate) {
        const usedSubjectKeys = new Set<string>();
        for (let i = 0; i < sourceTemplate.subjects.length; i += 1) {
          const s = sourceTemplate.subjects[i];
          const baseSubjectKey = normalizeIdentifier(
            String((s as { subjectKey?: string }).subjectKey ?? s.subjectNameEn ?? s.subjectName ?? '').trim(),
          );
          let subjectKey = baseSubjectKey || `subject_${i + 1}`;
          let seq = 2;
          while (usedSubjectKeys.has(subjectKey)) {
            subjectKey = `${baseSubjectKey}_${seq}`;
            seq += 1;
          }
          usedSubjectKeys.add(subjectKey);
          const subjectId = `srts-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
          await client.query(
            `INSERT INTO student_report_template_subjects
              (id, template_id, subject_key, subject_name, subject_name_zh, subject_name_en, module_type, enable_score, enable_teacher_comment, enable_learning_quality, score_visibility, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              subjectId,
              templateId,
              subjectKey,
              s.subjectNameZh || s.subjectName,
              s.subjectNameZh || s.subjectName,
              s.subjectNameEn || s.subjectName,
              s.moduleType ?? 'subject_score',
              s.enableScore !== false,
              s.enableTeacherComment !== false,
              s.enableLearningQuality !== false,
              s.scoreVisibility ?? 'teacher_homeroom_admin',
              i,
            ],
          );
          const usedDimensionKeys = new Set<string>();
          for (let j = 0; j < (s.dimensions ?? []).length; j += 1) {
            const d = s.dimensions[j];
            const baseDimKey = normalizeIdentifier(String(d.dimensionLabelEn ?? d.dimensionLabel ?? '').trim());
            let dimKey = baseDimKey || `dimension_${j + 1}`;
            let dimSeq = 2;
            while (usedDimensionKeys.has(dimKey)) {
              dimKey = `${baseDimKey}_${dimSeq}`;
              dimSeq += 1;
            }
            usedDimensionKeys.add(dimKey);
            const dimId = `srtd-${Date.now()}-${i}-${j}-${Math.random().toString(36).slice(2, 6)}`;
            await client.query(
              `INSERT INTO student_report_template_dimensions
                (id, template_subject_id, dimension_key, dimension_label, dimension_label_zh, dimension_label_en, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                dimId,
                subjectId,
                dimKey,
                d.dimensionLabelZh || d.dimensionLabel,
                d.dimensionLabelZh || d.dimensionLabel,
                d.dimensionLabelEn || d.dimensionLabel,
                j,
              ],
            );
            for (const lv of ['A', 'B', 'C', 'D'] as const) {
              const text = String((d.levelDescriptions ?? {})[lv] ?? '').trim();
              if (!text) continue;
              await client.query(
                `INSERT INTO student_report_template_level_descriptions
                  (id, template_dimension_id, level, description)
                 VALUES ($1, $2, $3, $4)`,
                [`srtdl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dimId, lv, text],
              );
            }
          }
        }
    }
    await client.query('COMMIT');
    const template = await loadTemplateDetail(templateId);
    res.status(201).json({ template });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create report template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 模板详情
router.get('/report-templates/:templateId', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const template = await loadTemplateDetail(templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (error) {
    console.error('Get report template detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新模板结构
router.put('/report-templates/:templateId', async (req: AuthedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureReportTemplateTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const existingTpl = (await client.query(
      `SELECT id FROM student_report_templates WHERE id = $1 LIMIT 1`,
      [templateId]
    )).rows[0] as { id: string } | undefined;
    if (!existingTpl) return res.status(404).json({ error: 'Template not found' });
    const status = (req.body?.status ?? 'draft') as TemplateStatus;
    if (!['draft', 'published', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'status must be draft|published|closed' });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : null;
    const homeroomCommentMode = (req.body?.homeroomCommentMode ?? 'optional') as HomeroomCommentMode;
    if (!['disabled', 'optional', 'required'].includes(homeroomCommentMode)) {
      return res.status(400).json({ error: 'homeroomCommentMode must be disabled|optional|required' });
    }
    const subjects = Array.isArray(req.body?.subjects) ? req.body.subjects as Array<{
      subjectKey?: string;
      subjectNameZh: string;
      subjectNameEn: string;
      moduleType?: ModuleType;
      enableScore?: boolean;
      enableTeacherComment?: boolean;
      enableLearningQuality?: boolean;
      scoreVisibility?: ScoreVisibility;
      dimensions?: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions?: Partial<Record<'A' | 'B' | 'C' | 'D', string>>;
      }>;
    }> : [];

    await client.query('BEGIN');
    await client.query(
      `UPDATE student_report_templates
       SET title = $1,
           status = $2,
           released_at = CASE WHEN $6 THEN NULL ELSE released_at END,
           homeroom_comment_mode = $3,
           updated_by = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [
        title || null,
        status,
        homeroomCommentMode,
        req.userId ?? null,
        templateId,
        status === 'draft' || status === 'published',
      ]
    );

    await client.query(
      `DELETE FROM student_report_template_level_descriptions
       WHERE template_dimension_id IN (
         SELECT d.id
         FROM student_report_template_dimensions d
         JOIN student_report_template_subjects s ON s.id = d.template_subject_id
         WHERE s.template_id = $1
       )`,
      [templateId]
    );
    await client.query(
      `DELETE FROM student_report_template_dimensions
       WHERE template_subject_id IN (SELECT id FROM student_report_template_subjects WHERE template_id = $1)`,
      [templateId]
    );
    await client.query(`DELETE FROM student_report_template_subjects WHERE template_id = $1`, [templateId]);

    const usedSubjectKeys = new Set<string>();
    for (let i = 0; i < subjects.length; i += 1) {
      const s = subjects[i];
      const subjectNameZh = String(s.subjectNameZh ?? '').trim();
      const subjectNameEn = String(s.subjectNameEn ?? '').trim();
      if (!subjectNameZh || !subjectNameEn) continue;
      const moduleType = (s.moduleType ?? 'subject_score') as ModuleType;
      const enableScore = s.enableScore ?? moduleType === 'subject_score';
      const enableTeacherComment = s.enableTeacherComment ?? true;
      const enableLearningQuality = s.enableLearningQuality !== false;
      const scoreVisibility = (s.scoreVisibility ?? 'teacher_homeroom_admin') as ScoreVisibility;
      const clientKeyRaw = String(s.subjectKey ?? '').trim();
      const baseSubjectKey = clientKeyRaw
        ? normalizeIdentifier(clientKeyRaw)
        : normalizeIdentifier(subjectNameEn);
      let subjectKey = baseSubjectKey;
      let subjectSeq = 2;
      while (usedSubjectKeys.has(subjectKey)) {
        subjectKey = `${baseSubjectKey}_${subjectSeq}`;
        subjectSeq += 1;
      }
      usedSubjectKeys.add(subjectKey);
      const subjectName = subjectNameZh;
      const subjectId = `srts-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
      await client.query(
        `INSERT INTO student_report_template_subjects
          (id, template_id, subject_key, subject_name, subject_name_zh, subject_name_en, module_type, enable_score, enable_teacher_comment, enable_learning_quality, score_visibility, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          subjectId,
          templateId,
          subjectKey,
          subjectName,
          subjectNameZh,
          subjectNameEn,
          moduleType,
          enableScore,
          enableTeacherComment,
          enableLearningQuality,
          scoreVisibility,
          i,
        ],
      );
      const dimensions = Array.isArray(s.dimensions) ? s.dimensions : [];
      const usedDimensionKeys = new Set<string>();
      for (let j = 0; j < dimensions.length; j += 1) {
        const d = dimensions[j];
        const dimLabelZh = String(d.dimensionLabelZh ?? '').trim();
        const dimLabelEn = String(d.dimensionLabelEn ?? '').trim();
        if (!dimLabelZh || !dimLabelEn) continue;
        const baseDimKey = normalizeIdentifier(dimLabelEn);
        let dimKey = baseDimKey;
        let dimSeq = 2;
        while (usedDimensionKeys.has(dimKey)) {
          dimKey = `${baseDimKey}_${dimSeq}`;
          dimSeq += 1;
        }
        usedDimensionKeys.add(dimKey);
        const dimLabel = dimLabelZh;
        const dimId = `srtd-${Date.now()}-${i}-${j}-${Math.random().toString(36).slice(2, 6)}`;
        await client.query(
          `INSERT INTO student_report_template_dimensions
            (id, template_subject_id, dimension_key, dimension_label, dimension_label_zh, dimension_label_en, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [dimId, subjectId, dimKey, dimLabel, dimLabelZh, dimLabelEn, j]
        );
        const desc = d.levelDescriptions ?? {};
        for (const lv of ['A', 'B', 'C', 'D'] as const) {
          const text = String(desc[lv] ?? '').trim();
          if (!text) continue;
          await client.query(
            `INSERT INTO student_report_template_level_descriptions
              (id, template_dimension_id, level, description)
             VALUES ($1, $2, $3, $4)`,
            [`srtdl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dimId, lv, text]
          );
        }
      }
    }
    await client.query('COMMIT');
    const template = await loadTemplateDetail(templateId);
    res.json({ success: true, templateId, template });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upsert report template error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    const isPgLen =
      /value too long|character varying|text data.*would be truncated/i.test(msg) ||
      String((error as { code?: string })?.code) === '22001';
    res.status(500).json({
      error: isPgLen
        ? 'Save failed: a name or description exceeds database limits. Try shortening dimension or subject text, then save again.'
        : 'Internal server error',
      detail: process.env.NODE_ENV !== 'production' ? msg : undefined,
    });
  } finally {
    client.release();
  }
});

router.post('/report-templates/:templateId/publish', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const result = await pool.query(
      `UPDATE student_report_templates
       SET status = 'published',
           published_at = CURRENT_TIMESTAMP,
           released_at = NULL,
           updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id`,
      [req.userId ?? null, templateId]
    );
    if ((result.rowCount ?? 0) === 0) return res.status(404).json({ error: 'Template not found' });
    const template = await loadTemplateDetail(templateId);
    res.json({ success: true, template });
  } catch (error) {
    console.error('Publish report template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/report-templates/:templateId/close', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const result = await pool.query(
      `UPDATE student_report_templates
       SET status = 'closed',
           updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id`,
      [req.userId ?? null, templateId]
    );
    if ((result.rowCount ?? 0) === 0) return res.status(404).json({ error: 'Template not found' });
    const template = await loadTemplateDetail(templateId);
    res.json({ success: true, template });
  } catch (error) {
    console.error('Close report template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/report-templates/:templateId/release', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const current = (await pool.query(
      `SELECT id, status
       FROM student_report_templates
       WHERE id = $1
       LIMIT 1`,
      [templateId]
    )).rows[0] as { id: string; status: TemplateStatus } | undefined;
    if (!current) return res.status(404).json({ error: 'Template not found' });
    if (current.status !== 'closed') {
      return res.status(409).json({ error: 'Template must be closed before release' });
    }
    await pool.query(
      `UPDATE student_report_templates
       SET released_at = CURRENT_TIMESTAMP,
           updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.userId ?? null, templateId]
    );
    const template = await loadTemplateDetail(templateId);
    res.json({ success: true, template });
  } catch (error) {
    console.error('Release report template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/report-templates/:templateId/progress', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureReportTemplateTables();
    await ensureClassTeacherAssignmentsTable(pool);
    await ensureStaffingTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const template = await loadTemplateDetail(templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const homeroomModuleActive = template.homeroomCommentMode !== 'disabled';
    const segmentId = String(template.schoolSegmentId ?? '').trim();
    const inclusionCtx = await loadReportYearInclusionContext(template.academicYearId);
    const segmentGradeIds = segmentId ? await loadSegmentGradeIds(segmentId) : [];
    const gradeCatalogItems = await loadGradeConfigItemsForReport();

    const rosterRows = (await pool.query(
      `SELECT c.id AS class_id, c.grade, c.name AS class_name,
              s.id AS student_id, COALESCE(NULLIF(s.name_zh, ''), NULLIF(s.name_en, ''), s.name) AS student_name
       FROM classes c
       JOIN student_enrollments se ON se.class_id = c.id AND se.academic_year_id = c.academic_year_id
       JOIN students s ON s.id = se.student_id
       WHERE c.academic_year_id = $1
       ORDER BY c.grade ASC, c.name ASC, student_name ASC`,
      [template.academicYearId]
    )).rows as Array<{
      class_id: string;
      grade: number;
      class_name: string;
      student_id: string;
      student_name: string;
    }>;

    const teacherRows = (await pool.query(
      `SELECT class_id, teacher_id, teacher_name
       FROM (
         SELECT c.id AS class_id, u.id AS teacher_id,
                COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
         FROM classes c
         JOIN class_teacher_assignments a ON a.class_id = c.id AND a.unassigned_at IS NULL
         JOIN users u ON u.id = a.teacher_id
         WHERE c.academic_year_id = $1
         UNION ALL
         SELECT c.id AS class_id, u.id AS teacher_id,
                COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
         FROM classes c
         JOIN users u ON u.id = c.teacher_id
         WHERE c.academic_year_id = $1 AND c.teacher_id IS NOT NULL
       ) x`,
      [template.academicYearId]
    )).rows as Array<{ class_id: string; teacher_id: string; teacher_name: string }>;

    const reportRows = (await pool.query(
      `SELECT id, student_id,
              CASE WHEN COALESCE(NULLIF(TRIM(homeroom_comment), ''), NULL) IS NULL THEN FALSE ELSE TRUE END AS has_homeroom
       FROM student_term_reports
       WHERE template_id = $1 AND academic_year_id = $2 AND term = $3`,
      [templateId, template.academicYearId, template.term]
    )).rows as Array<{ id: string; student_id: string; has_homeroom: boolean }>;

    const subjectRows = (await pool.query(
      `SELECT sr.report_id, sr.subject_key,
              CASE WHEN sr.midterm_score IS NOT NULL OR sr.final_score IS NOT NULL THEN TRUE ELSE FALSE END AS has_score,
              CASE WHEN COALESCE(NULLIF(TRIM(sr.teacher_comment), ''), NULL) IS NULL THEN FALSE ELSE TRUE END AS has_comment,
              CASE WHEN sr.learning_quality_grade IN ('A','B','C','D') THEN TRUE ELSE FALSE END AS has_learning_quality
       FROM student_term_subject_reports sr
       JOIN student_term_reports r ON r.id = sr.report_id
       WHERE r.template_id = $1 AND r.academic_year_id = $2 AND r.term = $3`,
      [templateId, template.academicYearId, template.term]
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
       WHERE r.template_id = $1 AND r.academic_year_id = $2 AND r.term = $3`,
      [templateId, template.academicYearId, template.term]
    )).rows as Array<{
      report_id: string;
      subject_key: string;
      dimension_key: string;
    }>;

    const reportByStudent = new Map<string, { reportId: string; hasHomeroom: boolean }>();
    for (const row of reportRows) {
      reportByStudent.set(row.student_id, { reportId: row.id, hasHomeroom: row.has_homeroom });
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

    const homeroomTeacherRows = (await pool.query(
      `SELECT c.id AS class_id,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM classes c
       JOIN class_teacher_assignments a ON a.class_id = c.id AND a.unassigned_at IS NULL AND a.role = 'homeroom'
       JOIN users u ON u.id = a.teacher_id
       WHERE c.academic_year_id = $1`,
      [template.academicYearId]
    )).rows as Array<{ class_id: string; teacher_name: string }>;

    const staffingTeacherRows = (await pool.query(
      `SELECT a.class_id, a.subject_key,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM class_subject_teacher_assignments a
       JOIN classes c ON c.id = a.class_id
       JOIN users u ON u.id = a.teacher_id
       WHERE a.academic_year_id = $1`,
      [template.academicYearId]
    )).rows as Array<{ class_id: string; subject_key: string; teacher_name: string }>;

    const homeroomNamesByClass = new Map<string, string[]>();
    for (const row of homeroomTeacherRows) {
      const arr = homeroomNamesByClass.get(row.class_id) ?? [];
      if (!arr.includes(row.teacher_name)) arr.push(row.teacher_name);
      homeroomNamesByClass.set(row.class_id, arr);
    }
    const staffingNamesByClassSubject = new Map<string, string[]>();
    for (const row of staffingTeacherRows) {
      const key = `${row.class_id}::${row.subject_key}`;
      const arr = staffingNamesByClassSubject.get(key) ?? [];
      if (!arr.includes(row.teacher_name)) arr.push(row.teacher_name);
      staffingNamesByClassSubject.set(key, arr);
    }

    const classMap = new Map<string, {
      classId: string;
      className: string;
      grade: number;
      students: Array<{ studentId: string; studentName: string }>;
      teachers: Array<{ teacherId: string; teacherName: string }>;
    }>();
    for (const row of rosterRows) {
      const cls = classMap.get(row.class_id) ?? {
        classId: row.class_id,
        className: row.class_name,
        grade: row.grade,
        students: [],
        teachers: [],
      };
      cls.students.push({ studentId: row.student_id, studentName: row.student_name || row.student_id });
      classMap.set(row.class_id, cls);
    }
    for (const row of teacherRows) {
      const cls = classMap.get(row.class_id);
      if (!cls) continue;
      if (!cls.teachers.some((t) => t.teacherId === row.teacher_id)) {
        cls.teachers.push({ teacherId: row.teacher_id, teacherName: row.teacher_name || row.teacher_id });
      }
    }

    const classes = Array.from(classMap.values())
      .sort((a, b) => (a.grade - b.grade) || a.className.localeCompare(b.className))
      .map((cls) => {
        const gradeCatalogId = gradeCatalogIdForClassLevel(gradeCatalogItems, cls.grade);
        const requiredSubjects = template.subjects.filter((subject) =>
          isTemplateSubjectRequiredForGrade(
            subject.subjectKey,
            segmentId,
            gradeCatalogId,
            segmentGradeIds,
            inclusionCtx,
          ),
        );

        const pendingStudentNames: string[] = [];
        let completedStudents = 0;
        let homeroomFilledStudents = 0;
        const subjectFailedByKey = new Map<string, Set<string>>();

        const checkSubjectData = (reportId: string, subject: (typeof template.subjects)[number]) => {
          const sk = `${reportId}::${subject.subjectKey}`;
          const subjectData = subjectByReportAndKey.get(sk);
          if (!subjectData) return false;
          const effectiveEnableScore = effectiveTemplateSubjectEnableScore(
            template.term,
            segmentId,
            subject.subjectKey,
            gradeCatalogId,
            segmentGradeIds,
            subject.enableScore,
            inclusionCtx,
          );
          if (effectiveEnableScore && !subjectData.hasScore) return false;
          if (subject.enableLearningQuality && !subjectData.hasLearningQuality) return false;
          const requiredDimensionKeys = subject.dimensions.map((d) => d.dimensionKey).filter((d) => !!d);
          if (requiredDimensionKeys.length > 0) {
            const ratedKeys = ratingKeysByReportAndSubject.get(sk) ?? new Set<string>();
            if (requiredDimensionKeys.some((dk) => !ratedKeys.has(dk))) return false;
          }
          return true;
        };

        for (const stu of cls.students) {
          const reportMeta = reportByStudent.get(stu.studentId);
          if (homeroomModuleActive && reportMeta?.hasHomeroom === true) homeroomFilledStudents += 1;

          let subjectOk = false;
          if (reportMeta) {
            subjectOk = true;
            for (const subject of requiredSubjects) {
              if (!checkSubjectData(reportMeta.reportId, subject)) {
                subjectOk = false;
                const set = subjectFailedByKey.get(subject.subjectKey) ?? new Set();
                set.add(stu.studentId);
                subjectFailedByKey.set(subject.subjectKey, set);
              }
            }
          }

          const fullyComplete =
            subjectOk && (!homeroomModuleActive || reportMeta?.hasHomeroom === true);

          if (fullyComplete) completedStudents += 1;
          else pendingStudentNames.push(stu.studentName);
        }

        const totalStudents = cls.students.length;
        const pendingStudents = totalStudents - completedStudents;
        const completionRate = totalStudents > 0
          ? Number(((completedStudents / totalStudents) * 100).toFixed(1))
          : 0;
        const pendingPreview = pendingStudentNames.slice(0, 8).join('、');
        const reminderMessage = pendingStudents > 0
          ? `【学业报告提醒】${template.title ?? '本次评价报告'} - ${cls.className} 还有 ${pendingStudents} 位学生未完成填写，请尽快在系统中补齐。${pendingPreview ? ` 待完成：${pendingPreview}${pendingStudentNames.length > 8 ? '等' : ''}。` : ''}`
          : `【学业报告提醒】${template.title ?? '本次评价报告'} - ${cls.className} 已全部完成，辛苦老师。`;

        const homeroomPending = homeroomModuleActive && homeroomFilledStudents < totalStudents;
        const homeroomTeacherNames = homeroomNamesByClass.get(cls.classId) ?? [];

        const subjectGaps = requiredSubjects
          .map((subject) => {
            const set = subjectFailedByKey.get(subject.subjectKey);
            const pendingStudentCount = set?.size ?? 0;
            if (pendingStudentCount === 0) return null;
            const label =
              (subject.subjectNameZh || '').trim() ||
              (subject.subjectNameEn || '').trim() ||
              subject.subjectName ||
              subject.subjectKey;
            const names = staffingNamesByClassSubject.get(`${cls.classId}::${subject.subjectKey}`) ?? [];
            return {
              subjectKey: subject.subjectKey,
              subjectLabel: label,
              teacherNames: names.join('、'),
              pendingStudentCount,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null);

        return {
          classId: cls.classId,
          className: cls.className,
          grade: cls.grade,
          totalStudents,
          completedStudents,
          pendingStudents,
          completionRate,
          pendingStudentNames,
          teachers: cls.teachers,
          reminderMessage,
          homeroomTeacherNames,
          homeroomPending,
          subjectGaps,
        };
      });

    const classesSorted = [...classes].sort(
      (a, b) => a.completionRate - b.completionRate || a.grade - b.grade || a.className.localeCompare(b.className),
    );

    const totalStudents = classesSorted.reduce((sum, cls) => sum + cls.totalStudents, 0);
    const completedStudents = classesSorted.reduce((sum, cls) => sum + cls.completedStudents, 0);
    const pendingStudents = Math.max(totalStudents - completedStudents, 0);
    const completionRate = totalStudents > 0 ? Number(((completedStudents / totalStudents) * 100).toFixed(1)) : 0;

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
        classes: classesSorted,
      },
    });
  } catch (error) {
    console.error('Get report template progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/staffing/assignments', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureStaffingTables();
    await ensureClassTeacherAssignmentsTable(pool);
    const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
    if (!academicYearId) {
      return res.status(400).json({ error: 'academicYearId is required' });
    }
    await backfillHomeroomStaffingForAcademicYear(pool, academicYearId);
    const rows = (await pool.query(
      `SELECT a.id, a.academic_year_id, a.class_id, a.subject_key, a.subject_name, a.teacher_id,
              COALESCE(a.teacher_slot, 0)::int AS teacher_slot, a.updated_at,
              c.name AS class_name, c.grade AS class_grade,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM class_subject_teacher_assignments a
       JOIN classes c ON c.id = a.class_id
       JOIN users u ON u.id = a.teacher_id
       WHERE a.academic_year_id = $1
       ORDER BY c.grade ASC, c.name ASC, a.subject_name ASC, a.teacher_slot ASC`,
      [academicYearId]
    )).rows;
    const assignments = rows.map((r) => ({
      id: r.id as string,
      academicYearId: r.academic_year_id as string,
      classId: r.class_id as string,
      className: r.class_name as string,
      classGrade: Number(r.class_grade ?? 0),
      subjectKey: r.subject_key as string,
      subjectName: r.subject_name as string,
      teacherId: r.teacher_id as string,
      teacherName: r.teacher_name as string,
      teacherSlot: Number(r.teacher_slot ?? 0) === 1 ? 1 : 0,
      updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
    }));
    return res.json({ assignments });
  } catch (error) {
    console.error('Get staffing assignments error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/staffing/assignments', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureStaffingTables();
    const academicYearId = String(req.body?.academicYearId ?? '').trim();
    const classId = String(req.body?.classId ?? '').trim();
    const subjectKey = String(req.body?.subjectKey ?? '').trim();
    const subjectName = String(req.body?.subjectName ?? '').trim();
    const teacherId = String(req.body?.teacherId ?? '').trim();
    const teacherSlot = req.body?.teacherSlot === 1 ? 1 : 0;
    if (!academicYearId || !classId || !subjectKey || !subjectName || !teacherId) {
      return res.status(400).json({ error: 'academicYearId, classId, subjectKey, subjectName, teacherId are required' });
    }
    const classRow = (await pool.query(
      `SELECT id
       FROM classes
       WHERE id = $1 AND academic_year_id = $2
       LIMIT 1`,
      [classId, academicYearId]
    )).rows[0] as { id: string } | undefined;
    if (!classRow) {
      return res.status(400).json({ error: 'classId does not belong to the selected academic year' });
    }
    const okTeacher = await assertTeacherUser(teacherId);
    if (!okTeacher) {
      return res.status(400).json({ error: 'teacherId must reference an active teacher account' });
    }
    const id = `csta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await pool.query(
      `INSERT INTO class_subject_teacher_assignments
        (id, academic_year_id, class_id, subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (academic_year_id, class_id, subject_key, teacher_slot)
       DO UPDATE SET
         subject_name = EXCLUDED.subject_name,
         teacher_id = EXCLUDED.teacher_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [id, academicYearId, classId, subjectKey, subjectName, teacherId, teacherSlot, req.userId ?? null]
    );
    if (subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY) {
      if (teacherSlot !== 0) {
        return res.status(400).json({ error: 'Homeroom staffing uses teacher slot 0 only' });
      }
      await ensureClassTeacherAssignmentsTable(pool);
      await applyHomeroomFromStaffingToClassTables(pool, classId, teacherId);
    }
    return res.json({ success: true, id: result.rows[0]?.id ?? id });
  } catch (error) {
    console.error('Upsert staffing assignment error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/staffing/assignments/:academicYearId/:classId/:subjectKey', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureStaffingTables();
    const academicYearId = String(req.params.academicYearId ?? '').trim();
    const classId = String(req.params.classId ?? '').trim();
    const subjectKey = String(req.params.subjectKey ?? '').trim();
    if (!academicYearId || !classId || !subjectKey) {
      return res.status(400).json({ error: 'academicYearId, classId, subjectKey are required' });
    }
    const slotQ = typeof req.query.slot === 'string' ? req.query.slot.trim() : '';
    const teacherSlot = slotQ === '0' || slotQ === '1' ? Number(slotQ) : null;
    if (teacherSlot === 0 || teacherSlot === 1) {
      await pool.query(
        `DELETE FROM class_subject_teacher_assignments
         WHERE academic_year_id = $1 AND class_id = $2 AND subject_key = $3 AND teacher_slot = $4`,
        [academicYearId, classId, subjectKey, teacherSlot],
      );
    } else {
      await pool.query(
        `DELETE FROM class_subject_teacher_assignments
         WHERE academic_year_id = $1 AND class_id = $2 AND subject_key = $3`,
        [academicYearId, classId, subjectKey],
      );
    }
    if (subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY) {
      await ensureClassTeacherAssignmentsTable(pool);
      await applyHomeroomFromStaffingToClassTables(pool, classId, null);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete staffing assignment error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/report-templates/:templateId', async (req: AuthedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureReportTemplateTables();
    const templateId = String(req.params.templateId ?? '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

    // FK is ON DELETE SET NULL, but idx_student_term_reports_student_term_template_unique
    // uses COALESCE(template_id,''). Multiple rows per student/term with different templates
    // would both become '' and violate the unique index — delete filled reports first.
    await client.query('BEGIN');
    await client.query(`DELETE FROM student_term_reports WHERE template_id = $1`, [templateId]);
    const result = await client.query(
      `DELETE FROM student_report_templates
       WHERE id = $1
       RETURNING id`,
      [templateId],
    );
    if ((result.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Template not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    console.error('Delete report template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// —— 组织架构：部门树（全校共享；仅 system-admin 可写） ——
router.get('/org-departments', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureOrgDepartmentsTable();
    const result = await pool.query(
      `SELECT id, name, parent_id AS "parentId", sort_order AS "sortOrder"
       FROM org_departments
       ORDER BY parent_id NULLS FIRST, sort_order ASC, name ASC`
    );
    return res.json({ departments: result.rows });
  } catch (error) {
    console.error('List org departments error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/org-departments', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureOrgDepartmentsTable();
    const callerRole = await getCallerRole(req.userId);
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: only system-admin can modify org structure' });
    }
    const name = String((req.body as { name?: string })?.name ?? '').trim();
    if (!name || name.length > 160) {
      return res.status(400).json({ error: 'name is required (max 160 chars)' });
    }
    const parentIdRaw = (req.body as { parentId?: string | null })?.parentId;
    const parentId = parentIdRaw == null || parentIdRaw === '' ? null : String(parentIdRaw).trim();
    if (!parentId) {
      const existingRoot = await pool.query('SELECT id FROM org_departments WHERE parent_id IS NULL LIMIT 1');
      if ((existingRoot.rowCount ?? 0) > 0) {
        return res.status(400).json({ error: 'School root already exists; add departments under it or delete the root first.' });
      }
    }
    if (parentId) {
      const p = await pool.query('SELECT id FROM org_departments WHERE id = $1', [parentId]);
      if ((p.rowCount ?? 0) === 0) return res.status(400).json({ error: 'parentId not found' });
    }
    const sortResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n
       FROM org_departments
       WHERE parent_id IS NOT DISTINCT FROM $1`,
      [parentId]
    );
    const sortOrder = Number(sortResult.rows[0]?.n ?? 0);
    const id = `orgd-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO org_departments (id, name, parent_id, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [id, name, parentId, sortOrder]
    );
    const row = (await pool.query(
      `SELECT id, name, parent_id AS "parentId", sort_order AS "sortOrder"
       FROM org_departments WHERE id = $1`,
      [id]
    )).rows[0];
    return res.status(201).json({ department: row });
  } catch (error) {
    console.error('Create org department error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/org-departments/:id', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureOrgDepartmentsTable();
    const callerRole = await getCallerRole(req.userId);
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: only system-admin can modify org structure' });
    }
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    const exists = await pool.query('SELECT id FROM org_departments WHERE id = $1', [id]);
    if ((exists.rowCount ?? 0) === 0) return res.status(404).json({ error: 'Department not found' });

    const body = req.body as { name?: string; parentId?: string | null; sortOrder?: number };
    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name || name.length > 160) return res.status(400).json({ error: 'invalid name' });
      await pool.query(
        `UPDATE org_departments SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [name, id]
      );
    }
    if (body.parentId !== undefined) {
      let newParent: string | null = body.parentId == null || body.parentId === ''
        ? null
        : String(body.parentId).trim();
      if (newParent === id) {
        return res.status(400).json({ error: 'Cannot set parent to self' });
      }
      if (newParent) {
        const p = await pool.query('SELECT id FROM org_departments WHERE id = $1', [newParent]);
        if ((p.rowCount ?? 0) === 0) return res.status(400).json({ error: 'parentId not found' });
        const cycle = await isOrgDeptUnderAncestor(id, newParent);
        if (cycle) {
          return res.status(400).json({ error: 'Cannot move under own descendant' });
        }
      }
      await pool.query(
        `UPDATE org_departments SET parent_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newParent, id]
      );
    }
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid sortOrder' });
      await pool.query(
        `UPDATE org_departments SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [Math.floor(n), id]
      );
    }
    const row = (await pool.query(
      `SELECT id, name, parent_id AS "parentId", sort_order AS "sortOrder"
       FROM org_departments WHERE id = $1`,
      [id]
    )).rows[0];
    return res.json({ department: row });
  } catch (error) {
    console.error('Patch org department error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/org-departments/:id', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureOrgDepartmentsTable();
    const callerRole = await getCallerRole(req.userId);
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: only system-admin can modify org structure' });
    }
    const id = String(req.params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    const result = await pool.query('DELETE FROM org_departments WHERE id = $1 RETURNING id', [id]);
    if ((result.rowCount ?? 0) === 0) return res.status(404).json({ error: 'Department not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete org department error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

