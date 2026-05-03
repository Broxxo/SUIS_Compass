import express, { type Request, type Response, type NextFunction } from 'express';
import pool from '../config/database.js';

type ReqWithUserId = Request & { userId?: string };
type Term = 'Semester 1' | 'Semester 2';
type ReportGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D';
type TargetLevel = 'A' | 'B' | 'C' | 'D';
type TemplateStatus = 'draft' | 'published' | 'closed';
type HomeroomCommentMode = 'disabled' | 'optional' | 'required';

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toReportGrade(score: number | null | undefined): ReportGrade | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score === 100) return 'A+';
  if (score >= 95 && score < 100) return 'A';
  if (score >= 90 && score < 95) return 'A-';
  if (score >= 85 && score < 90) return 'B+';
  if (score >= 80 && score < 85) return 'B';
  if (score >= 75 && score < 80) return 'B-';
  if (score >= 70 && score < 75) return 'C+';
  if (score >= 65 && score < 70) return 'C';
  if (score >= 60 && score < 65) return 'C-';
  if (score >= 0 && score < 60) return 'D';
  return null;
}

let ensuredClassTeacherAssignments = false;
let ensuredPortraitTables = false;
async function ensureClassTeacherAssignmentsTable(): Promise<void> {
  if (ensuredClassTeacherAssignments) return;
  // Local dev DB may not have run the latest migration yet; keep endpoints functional.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_teacher_assignments (
      id VARCHAR(80) PRIMARY KEY,
      class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(30) NOT NULL DEFAULT 'co-teacher',
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unassigned_at TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_class_active
      ON class_teacher_assignments(class_id) WHERE unassigned_at IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher_active
      ON class_teacher_assignments(teacher_id) WHERE unassigned_at IS NULL;
  `);
  ensuredClassTeacherAssignments = true;
}

async function ensureStudentPortraitTables(): Promise<void> {
  if (ensuredPortraitTables) return;
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
      teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(report_id, subject_key)
    );
  `);
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
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS grade');
  ensuredPortraitTables = true;
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
  const result = await pool.query(
    `SELECT 1
     FROM student_enrollments e
     JOIN class_teacher_assignments a
       ON a.class_id = e.class_id
      AND a.teacher_id = $1
      AND a.unassigned_at IS NULL
     WHERE e.student_id = $2
       ${requireHomeroom ? "AND a.role = 'homeroom'" : ''}
     LIMIT 1`,
    [userId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
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

async function getOrCreateTermReport(
  client: { query: typeof pool.query },
  studentId: string,
  academicYearId: string,
  term: Term,
  templateId: string | null,
  operatorId: string | null
): Promise<string> {
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
  await client.query(
    `INSERT INTO student_term_reports (
      id, student_id, academic_year_id, term, template_id, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, studentId, academicYearId, term, templateId, operatorId, operatorId]
  );
  return id;
}

async function getTemplateById(templateId: string) {
  const template = (await pool.query(
    `SELECT id, academic_year_id, term, status, title, homeroom_comment_mode, template_type, is_active, published_at, released_at
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
  } | undefined;
  if (!template) return null;
  const rows = (await pool.query(
    `SELECT s.id AS subject_id, s.subject_key, s.subject_name, s.subject_name_zh, s.subject_name_en,
            s.module_type, s.enable_score, s.enable_teacher_comment, s.score_visibility, s.sort_order,
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
    score_visibility: 'teacher_homeroom_admin' | null;
    sort_order: number;
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
    scoreVisibility: 'teacher_homeroom_admin';
    sortOrder: number;
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
      scoreVisibility: (row.score_visibility ?? 'teacher_homeroom_admin') as 'teacher_homeroom_admin',
      sortOrder: row.sort_order,
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
    subjects: Array.from(subjectMap.values()).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

async function listTemplatesForTerm(academicYearId: string, term: Term) {
  const rows = (await pool.query(
    `SELECT id
     FROM student_report_templates
     WHERE academic_year_id = $1 AND term = $2
     ORDER BY updated_at DESC NULLS LAST`,
    [academicYearId, term]
  )).rows as Array<{ id: string }>;
  const templates: Array<Awaited<ReturnType<typeof getTemplateById>>> = [];
  for (const row of rows) {
    const tpl = await getTemplateById(row.id);
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
    await ensureClassTeacherAssignmentsTable();
    const academicYearId = req.query.academicYearId as string | undefined;
    const role = await getUserRole(req);
    const params: string[] = [];
    let sql = 'SELECT id, academic_year_id, grade, name, teacher_id FROM classes';
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
      params.push(req.userId);
      where.push(`EXISTS (
        SELECT 1 FROM class_teacher_assignments a
        WHERE a.class_id = classes.id
          AND a.teacher_id = $${params.length}
          AND a.unassigned_at IS NULL
      )`);
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
      };
    });
    res.json({ classes });
  } catch (e) {
    console.error('get classes', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
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
    res.status(201).json({ id, academicYearId, grade: Number(grade), name, teacherId });
  } catch (e) {
    console.error('post class', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 班级-教师关联 ----------
router.get('/:classId/teachers', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
    const { classId } = req.params;
    if (!classId) { res.status(400).json({ error: 'classId required' }); return; }
    const result = await pool.query(
      `SELECT a.teacher_id, a.role, u.display_name
       FROM class_teacher_assignments a
       JOIN users u ON u.id = a.teacher_id
       WHERE a.class_id = $1 AND a.unassigned_at IS NULL
       ORDER BY CASE WHEN a.role = 'homeroom' THEN 0 ELSE 1 END, u.display_name ASC`,
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
    await ensureClassTeacherAssignmentsTable();
    const { classId } = req.params;
    const { teacherId, role } = req.body || {};
    if (!classId || !teacherId) { res.status(400).json({ error: 'classId, teacherId required' }); return; }
    const normalizedRole = (role as string | undefined) ?? 'co-teacher';
    if (normalizedRole !== 'homeroom' && normalizedRole !== 'co-teacher') {
      res.status(400).json({ error: 'role must be homeroom or co-teacher' });
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
    res.status(201).json({ id, classId, teacherId, role: normalizedRole });
  } catch (e) {
    console.error('post class teacher assignment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/:classId/teachers/:teacherId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
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
      const replacement = await pool.query(
        `SELECT teacher_id
         FROM class_teacher_assignments
         WHERE class_id = $1
           AND teacher_id <> $2
           AND unassigned_at IS NULL
         ORDER BY CASE WHEN role = 'homeroom' THEN 0 ELSE 1 END, assigned_at ASC
         LIMIT 1`,
        [classId, teacherId]
      );
      if ((replacement.rowCount ?? 0) === 0) {
        res.status(400).json({ error: 'Each class must keep one primary responsible teacher' });
        return;
      }
      const replacementTeacherId = replacement.rows[0].teacher_id as string;
      await pool.query(
        `UPDATE class_teacher_assignments
         SET unassigned_at = CURRENT_TIMESTAMP
         WHERE class_id = $1 AND role = 'homeroom' AND unassigned_at IS NULL`,
        [classId]
      );
      await pool.query(
        `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role)
         VALUES ($1, $2, $3, 'homeroom')`,
        [createId('cta'), classId, replacementTeacherId]
      );
      await pool.query(
        'UPDATE classes SET teacher_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [replacementTeacherId, classId]
      );
      res.json({ success: true, reassignedTo: replacementTeacherId });
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
      params.push(req.userId);
      sql += `
        WHERE EXISTS (
          SELECT 1
          FROM student_enrollments e
          JOIN class_teacher_assignments a
            ON a.class_id = e.class_id
           AND a.unassigned_at IS NULL
          WHERE e.student_id = students.id
            AND a.teacher_id = $1
        )
      `;
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

router.delete('/students/:studentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
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
    await ensureClassTeacherAssignmentsTable();
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
      params.push(req.userId);
      where.push(`EXISTS (
        SELECT 1 FROM class_teacher_assignments a
        WHERE a.class_id = student_enrollments.class_id
          AND a.teacher_id = $${params.length}
          AND a.unassigned_at IS NULL
      )`);
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
router.get('/reports/templates/:academicYearId/:term', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { academicYearId, term } = req.params;
    const normalizedTerm = term === 'Semester 1' || term === 'Semester 2' ? (term as Term) : null;
    if (!normalizedTerm) {
      res.status(400).json({ error: 'term must be Semester 1 or Semester 2' });
      return;
    }
    const viewerRole = await getUserRole(req);
    const templates = await listTemplatesForTerm(academicYearId, normalizedTerm);
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
    const template = await getTemplateById(templateId);
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
    const hideUnreleased = viewerRole === 'student';
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
    const template = await getTemplateById(templateId);
    if (!template || template.academicYearId !== academicYearId || template.term !== normalizedTerm) {
      res.status(404).json({ error: 'Template not found for selected year/term' });
      return;
    }
    if (viewerRole === 'student' && !template.releasedAt) {
      res.status(403).json({ error: 'Report is not released to students yet' });
      return;
    }
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
        template: template
          ? { id: template.id, status: template.status, title: template.title, homeroomCommentMode: template.homeroomCommentMode, subjects: template.subjects }
          : null,
      });
      return;
    }

    const subjectRows = (await pool.query(
      `SELECT id, subject_key, subject_name, midterm_score, midterm_grade, final_score, final_grade,
              teacher_comment, teacher_id, created_at, updated_at
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
      teacher_comment: string | null;
      teacher_id: string | null;
      created_at: Date | null;
      updated_at: Date | null;
    }>;

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

    const subjectReports = subjectRows.map((s) => ({
      id: s.id,
      subjectKey: s.subject_key,
      subjectName: s.subject_name,
      midtermScore: hideScores ? null : (s.midterm_score == null ? null : Number(s.midterm_score)),
      midtermGrade: (s.midterm_grade as ReportGrade | null) ?? null,
      finalScore: hideScores ? null : (s.final_score == null ? null : Number(s.final_score)),
      finalGrade: (s.final_grade as ReportGrade | null) ?? null,
      teacherComment: s.teacher_comment ?? null,
      teacherId: s.teacher_id ?? null,
      dimensions: dimensionsBySubject.get(s.id) ?? [],
      createdAt: s.created_at?.toISOString() ?? null,
      updatedAt: s.updated_at?.toISOString() ?? null,
    }));

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
      template: template
        ? { id: template.id, status: template.status, title: template.title, homeroomCommentMode: template.homeroomCommentMode, subjects: template.subjects }
        : null,
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
    const template = await getTemplateById(templateId);
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
    const teacherComment = (req.body?.teacherComment ?? null) as string | null;
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

    const parseScore = (v: unknown): number | null => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : Number.NaN;
    };
    const midtermScore = templateSubject.enableScore ? parseScore(midtermScoreInput) : null;
    const finalScore = templateSubject.enableScore ? parseScore(finalScoreInput) : null;
    if (Number.isNaN(midtermScore) || Number.isNaN(finalScore)) {
      res.status(400).json({ error: 'Scores must be numbers' });
      return;
    }
    if ((midtermScore != null && (midtermScore < 0 || midtermScore > 100)) || (finalScore != null && (finalScore < 0 || finalScore > 100))) {
      res.status(400).json({ error: 'Scores must be between 0 and 100' });
      return;
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

    if (!isAdminRole && existingSubject?.teacher_id && existingSubject.teacher_id !== req.userId) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Forbidden: subject report is owned by another teacher' });
      return;
    }

    const subjectReportId = existingSubject?.id ?? createId('strs');
    const teacherIdForWrite = isAdminRole ? (existingSubject?.teacher_id ?? null) : req.userId;
    await client.query(
      `INSERT INTO student_term_subject_reports (
        id, report_id, subject_key, subject_name, midterm_score, midterm_grade, final_score, final_grade,
        teacher_comment, teacher_id, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (report_id, subject_key)
      DO UPDATE SET
        subject_name = EXCLUDED.subject_name,
        midterm_score = EXCLUDED.midterm_score,
        midterm_grade = EXCLUDED.midterm_grade,
        final_score = EXCLUDED.final_score,
        final_grade = EXCLUDED.final_grade,
        teacher_comment = EXCLUDED.teacher_comment,
        teacher_id = COALESCE(student_term_subject_reports.teacher_id, EXCLUDED.teacher_id),
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP`,
      [
        subjectReportId,
        reportId,
        String(subjectKey).trim(),
        templateSubject.subjectName || subjectName,
        midtermScore,
        toReportGrade(midtermScore),
        finalScore,
        toReportGrade(finalScore),
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

    for (let i = 0; i < templateSubject.dimensions.length; i += 1) {
      const dim = templateSubject.dimensions[i];
      const key = String(dim.dimensionKey ?? '').trim();
      const label = String(dim.dimensionLabel ?? '').trim();
      const rating = ratingByKey.get(key) ?? 'A';
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
        midtermGrade: toReportGrade(midtermScore),
        finalScore,
        finalGrade: toReportGrade(finalScore),
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

// ---------- 学年升级（策略 A：一键全校升一级） ----------
router.post('/academic-years/:sourceYearId/promote', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable();
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

export default router;