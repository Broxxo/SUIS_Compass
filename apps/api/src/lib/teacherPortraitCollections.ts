import pool from '../config/database.js';
import { createRunOnce } from './runOnce.js';

export type TeacherPortraitCollectionType = 'teaching-diagnosis-kiss';
export type TeacherPortraitTemplateStatus = 'draft' | 'published' | 'closed';
export type Term = 'Semester 1' | 'Semester 2';

export type TeachingDiagnosisPayload = {
  keep: string;
  improve: string;
  stop: string;
  start: string;
};

const ensureTablesOnce = createRunOnce();

export async function ensureTeacherPortraitCollectionTables(): Promise<void> {
  await ensureTablesOnce.run(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_portrait_collection_templates (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      title VARCHAR(200),
      collection_type VARCHAR(60) NOT NULL DEFAULT 'teaching-diagnosis-kiss',
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
      published_at TIMESTAMP,
      /** 目标部门（users.department 名称）；NULL 或空数组表示全体专任教师 */
      target_departments JSONB,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_teacher_portrait_collection_templates_year_term
      ON teacher_portrait_collection_templates(academic_year_id, term, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_portrait_collection_submissions (
      id VARCHAR(100) PRIMARY KEY,
      template_id VARCHAR(100) NOT NULL REFERENCES teacher_portrait_collection_templates(id) ON DELETE CASCADE,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      diagnosis JSONB NOT NULL DEFAULT '{"keep":"","improve":"","stop":"","start":""}'::jsonb,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(template_id, teacher_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_teacher_portrait_collection_submissions_template
      ON teacher_portrait_collection_submissions(template_id)
  `);
  await pool.query(`
    ALTER TABLE teacher_portrait_collection_templates
      ADD COLUMN IF NOT EXISTS target_departments JSONB
  `);
  });
}

/** 解析目标部门；NULL 或空数组表示不限制（全体专任教师） */
export function parseTargetDepartments(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const list = [...new Set(raw.map((d) => String(d ?? '').trim()).filter(Boolean))];
  return list.length > 0 ? list : null;
}

export function teacherMatchesTargetDepartments(
  teacherDepartment: string | null | undefined,
  targetDepartments: string[] | null | undefined,
): boolean {
  if (!targetDepartments || targetDepartments.length === 0) return true;
  const dept = (teacherDepartment ?? '').trim();
  return dept !== '' && targetDepartments.includes(dept);
}

function sqlTeacherInTargetDepartments(
  targetDepartments: string[] | null | undefined,
  userAlias: string,
  values: unknown[],
): string {
  if (!targetDepartments || targetDepartments.length === 0) return '';
  values.push(targetDepartments);
  return ` AND TRIM(COALESCE(${userAlias}.department, '')) = ANY($${values.length}::text[])`;
}

export async function getTeacherDepartment(teacherId: string): Promise<string | null> {
  const row = (
    await pool.query(`SELECT department FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`, [
      teacherId,
    ])
  ).rows[0] as { department: string | null } | undefined;
  const dept = (row?.department ?? '').trim();
  return dept || null;
}

export function emptyTeachingDiagnosis(): TeachingDiagnosisPayload {
  return { keep: '', improve: '', stop: '', start: '' };
}

export function parseTeachingDiagnosis(raw: unknown): TeachingDiagnosisPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyTeachingDiagnosis();
  const rec = raw as Record<string, unknown>;
  return {
    keep: String(rec.keep ?? '').trim(),
    improve: String(rec.improve ?? '').trim(),
    stop: String(rec.stop ?? '').trim(),
    start: String(rec.start ?? '').trim(),
  };
}

export function teachingDiagnosisHasContent(d: TeachingDiagnosisPayload): boolean {
  return Boolean(d.keep || d.improve || d.stop || d.start);
}

export type TeacherPortraitTemplateRow = {
  id: string;
  academicYearId: string;
  academicYearName: string;
  term: Term;
  title: string | null;
  collectionType: TeacherPortraitCollectionType;
  status: TeacherPortraitTemplateStatus;
  publishedAt: string | null;
  updatedAt: string | null;
  targetDepartments: string[] | null;
};

export async function listTeacherPortraitTemplates(filters: {
  academicYearId?: string;
  term?: Term;
  status?: TeacherPortraitTemplateStatus;
}): Promise<TeacherPortraitTemplateRow[]> {
  await ensureTeacherPortraitCollectionTables();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.academicYearId) {
    values.push(filters.academicYearId);
    where.push(`t.academic_year_id = $${values.length}`);
  }
  if (filters.term) {
    values.push(filters.term);
    where.push(`t.term = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`t.status = $${values.length}`);
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
  return rows.map((r) => ({
    id: r.id as string,
    academicYearId: r.academic_year_id as string,
    academicYearName: r.academic_year_name as string,
    term: r.term as Term,
    title: (r.title as string | null) ?? null,
    collectionType: (r.collection_type as TeacherPortraitCollectionType) ?? 'teaching-diagnosis-kiss',
    status: r.status as TeacherPortraitTemplateStatus,
    publishedAt: (r.published_at as Date | null)?.toISOString() ?? null,
    updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
    targetDepartments: parseTargetDepartments(r.target_departments),
  }));
}

export async function getTeacherPortraitTemplateById(
  templateId: string,
): Promise<TeacherPortraitTemplateRow | null> {
  await ensureTeacherPortraitCollectionTables();
  const row = (
    await pool.query(
      `SELECT t.id, t.academic_year_id, t.term, t.title, t.collection_type, t.status,
              t.published_at, t.updated_at, t.target_departments, ay.name AS academic_year_name
       FROM teacher_portrait_collection_templates t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE t.id = $1
       LIMIT 1`,
      [templateId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    academicYearId: row.academic_year_id as string,
    academicYearName: row.academic_year_name as string,
    term: row.term as Term,
    title: (row.title as string | null) ?? null,
    collectionType: (row.collection_type as TeacherPortraitCollectionType) ?? 'teaching-diagnosis-kiss',
    status: row.status as TeacherPortraitTemplateStatus,
    publishedAt: (row.published_at as Date | null)?.toISOString() ?? null,
    updatedAt: (row.updated_at as Date | null)?.toISOString() ?? null,
    targetDepartments: parseTargetDepartments(row.target_departments),
  };
}

export async function countTeachersInSchool(): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'teacher'`);
  return Number(r.rows[0]?.c ?? 0);
}

const SUBMISSION_HAS_CONTENT_SQL = `(
  COALESCE(NULLIF(TRIM(s.diagnosis->>'keep'), ''), '') <> ''
  OR COALESCE(NULLIF(TRIM(s.diagnosis->>'improve'), ''), '') <> ''
  OR COALESCE(NULLIF(TRIM(s.diagnosis->>'stop'), ''), '') <> ''
  OR COALESCE(NULLIF(TRIM(s.diagnosis->>'start'), ''), '') <> ''
)`;

export type TeacherPortraitProgressTeacher = {
  teacherId: string;
  teacherName: string;
  updatedAt: string | null;
};

export async function getTeacherPortraitTemplateProgress(templateId: string): Promise<{
  templateId: string;
  totalTeachers: number;
  completedTeachers: number;
  pendingTeachers: number;
  completionRate: number;
  completed: TeacherPortraitProgressTeacher[];
  pending: Array<{ teacherId: string; teacherName: string }>;
}> {
  await ensureTeacherPortraitCollectionTables();
  const template = await getTeacherPortraitTemplateById(templateId);
  const targetDepartments = template?.targetDepartments ?? null;
  const values: unknown[] = [templateId];
  const deptFilter = sqlTeacherInTargetDepartments(targetDepartments, 'u', values);
  const rows = (await pool.query(
    `SELECT u.id AS teacher_id,
            COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                     NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name,
            s.updated_at,
            CASE
              WHEN s.id IS NOT NULL AND ${SUBMISSION_HAS_CONTENT_SQL} THEN TRUE
              ELSE FALSE
            END AS has_content
     FROM users u
     LEFT JOIN teacher_portrait_collection_submissions s
       ON s.teacher_id = u.id AND s.template_id = $1
     WHERE u.role = 'teacher'${deptFilter}
     ORDER BY teacher_name ASC`,
    values,
  )).rows as Array<{
    teacher_id: string;
    teacher_name: string;
    updated_at: Date | null;
    has_content: boolean;
  }>;

  const completed: TeacherPortraitProgressTeacher[] = [];
  const pending: Array<{ teacherId: string; teacherName: string }> = [];
  for (const row of rows) {
    const teacherId = row.teacher_id;
    const teacherName = String(row.teacher_name ?? teacherId);
    if (row.has_content) {
      completed.push({
        teacherId,
        teacherName,
        updatedAt: row.updated_at?.toISOString() ?? null,
      });
    } else {
      pending.push({ teacherId, teacherName });
    }
  }

  const totalTeachers = rows.length;
  const completedTeachers = completed.length;
  const pendingTeachers = pending.length;
  const completionRate =
    totalTeachers > 0 ? Number(((completedTeachers / totalTeachers) * 100).toFixed(1)) : 0;

  return {
    templateId,
    totalTeachers,
    completedTeachers,
    pendingTeachers,
    completionRate,
    completed,
    pending,
  };
}

export type TeacherPortraitSubmissionRow = {
  teacherId: string;
  teacherName: string;
  diagnosis: TeachingDiagnosisPayload;
  updatedAt: string | null;
  hasContent: boolean;
};

export async function getTeacherPortraitSubmission(
  templateId: string,
  teacherId: string,
): Promise<TeacherPortraitSubmissionRow | null> {
  await ensureTeacherPortraitCollectionTables();
  const row = (
    await pool.query(
      `SELECT u.id AS teacher_id,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name,
              s.diagnosis, s.updated_at
       FROM users u
       LEFT JOIN teacher_portrait_collection_submissions s
         ON s.teacher_id = u.id AND s.template_id = $1
       WHERE u.id = $2 AND u.role = 'teacher'
       LIMIT 1`,
      [templateId, teacherId],
    )
  ).rows[0];
  if (!row) return null;
  const diagnosis = parseTeachingDiagnosis(row.diagnosis);
  return {
    teacherId: row.teacher_id as string,
    teacherName: String(row.teacher_name ?? teacherId),
    diagnosis,
    updatedAt: (row.updated_at as Date | null)?.toISOString() ?? null,
    hasContent: teachingDiagnosisHasContent(diagnosis),
  };
}

export async function listTeacherPortraitSubmissions(
  templateId: string,
): Promise<TeacherPortraitSubmissionRow[]> {
  await ensureTeacherPortraitCollectionTables();
  const template = await getTeacherPortraitTemplateById(templateId);
  const targetDepartments = template?.targetDepartments ?? null;
  const values: unknown[] = [templateId];
  const deptFilter = sqlTeacherInTargetDepartments(targetDepartments, 'u', values);
  const rows = (await pool.query(
    `SELECT u.id AS teacher_id,
            COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                     NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name,
            s.diagnosis, s.updated_at
     FROM users u
     LEFT JOIN teacher_portrait_collection_submissions s
       ON s.teacher_id = u.id AND s.template_id = $1
     WHERE u.role = 'teacher'${deptFilter}
     ORDER BY teacher_name ASC`,
    values,
  )).rows as Array<{
    teacher_id: string;
    teacher_name: string;
    diagnosis: unknown;
    updated_at: Date | null;
  }>;

  return rows.map((row) => {
    const diagnosis = parseTeachingDiagnosis(row.diagnosis);
    return {
      teacherId: row.teacher_id,
      teacherName: String(row.teacher_name ?? row.teacher_id),
      diagnosis,
      updatedAt: row.updated_at?.toISOString() ?? null,
      hasContent: teachingDiagnosisHasContent(diagnosis),
    };
  });
}
