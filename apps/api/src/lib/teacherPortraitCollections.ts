import {
  parseTeacherCollectionBlocks,
  type TeacherCollectionBlock,
} from '@repo/shared';
import pool from '../config/database.js';
import { createRunOnce } from './runOnce.js';

export type TeacherPortraitCollectionType = 'teaching-diagnosis-kiss' | 'custom-form';
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
  await pool.query(`
    ALTER TABLE teacher_portrait_collection_templates
      ADD COLUMN IF NOT EXISTS form_blocks JSONB
  `);
  await pool.query(`
    ALTER TABLE teacher_portrait_collection_submissions
      ADD COLUMN IF NOT EXISTS text_answers JSONB NOT NULL DEFAULT '{}'::jsonb
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

export function parseTextAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key) || typeof value !== 'string') continue;
    const text = value.trim().slice(0, 20000);
    if (text) out[key] = text;
  }
  return out;
}

export function textAnswersForBlocks(
  raw: unknown,
  blocks: TeacherCollectionBlock[] | null,
): Record<string, string> {
  if (!blocks) return {};
  const parsed = parseTextAnswers(raw);
  const out: Record<string, string> = {};
  for (const block of blocks) {
    if (block.kind !== 'text') continue;
    out[block.id] = parsed[block.id] ?? '';
  }
  return out;
}

export function submissionHasContent(
  diagnosis: TeachingDiagnosisPayload,
  textAnswers: Record<string, string>,
): boolean {
  return teachingDiagnosisHasContent(diagnosis) || Object.values(textAnswers).some((value) => value.trim().length > 0);
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
  /** NULL 表示已发布的旧 KISS 任务，题目结构不变。 */
  formBlocks: TeacherCollectionBlock[] | null;
};

function mapTemplateRow(r: Record<string, unknown>): TeacherPortraitTemplateRow {
  const collectionType = (r.collection_type as TeacherPortraitCollectionType) ?? 'teaching-diagnosis-kiss';
  return {
    id: r.id as string,
    academicYearId: r.academic_year_id as string,
    academicYearName: r.academic_year_name as string,
    term: r.term as Term,
    title: (r.title as string | null) ?? null,
    collectionType,
    status: r.status as TeacherPortraitTemplateStatus,
    publishedAt: (r.published_at as Date | null)?.toISOString() ?? null,
    updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
    targetDepartments: parseTargetDepartments(r.target_departments),
    formBlocks: parseTeacherCollectionBlocks(r.form_blocks),
  };
}

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
            t.published_at, t.updated_at, t.target_departments, t.form_blocks,
            ay.name AS academic_year_name
     FROM teacher_portrait_collection_templates t
     JOIN academic_years ay ON ay.id = t.academic_year_id
     ${whereSql}
     ORDER BY t.updated_at DESC NULLS LAST`,
    values,
  )).rows;
  return rows.map((r) => mapTemplateRow(r as Record<string, unknown>));
}

export async function getTeacherPortraitTemplateById(
  templateId: string,
): Promise<TeacherPortraitTemplateRow | null> {
  await ensureTeacherPortraitCollectionTables();
  const row = (
    await pool.query(
      `SELECT t.id, t.academic_year_id, t.term, t.title, t.collection_type, t.status,
              t.published_at, t.updated_at, t.target_departments, t.form_blocks,
              ay.name AS academic_year_name
       FROM teacher_portrait_collection_templates t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE t.id = $1
       LIMIT 1`,
      [templateId],
    )
  ).rows[0];
  if (!row) return null;
  return mapTemplateRow(row as Record<string, unknown>);
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
  OR EXISTS (
    SELECT 1
    FROM jsonb_each_text(COALESCE(s.text_answers, '{}'::jsonb)) AS kv(key, value)
    WHERE btrim(kv.value) <> ''
  )
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
  textAnswers: Record<string, string>;
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
              s.diagnosis, s.text_answers, s.updated_at
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
  const textAnswers = parseTextAnswers(row.text_answers);
  return {
    teacherId: row.teacher_id as string,
    teacherName: String(row.teacher_name ?? teacherId),
    diagnosis,
    textAnswers,
    updatedAt: (row.updated_at as Date | null)?.toISOString() ?? null,
    hasContent: submissionHasContent(diagnosis, textAnswers),
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
            s.diagnosis, s.text_answers, s.updated_at
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
    text_answers: unknown;
    updated_at: Date | null;
  }>;

  return rows.map((row) => {
    const diagnosis = parseTeachingDiagnosis(row.diagnosis);
    const textAnswers = parseTextAnswers(row.text_answers);
    return {
      teacherId: row.teacher_id,
      teacherName: String(row.teacher_name ?? row.teacher_id),
      diagnosis,
      textAnswers,
      updatedAt: row.updated_at?.toISOString() ?? null,
      hasContent: submissionHasContent(diagnosis, textAnswers),
    };
  });
}

export type TeacherCollectionExchangeTeacher = {
  username: string;
  nameZh: string;
  nameEn: string;
  department: string;
  diagnosis: TeachingDiagnosisPayload;
  textAnswers: Record<string, string>;
};

export type TeacherCollectionExchangePayload = {
  meta: {
    academicYearName: string;
    term: string;
    title: string;
    departments: string[];
    formBlocks: TeacherCollectionBlock[] | null;
  };
  teachers: TeacherCollectionExchangeTeacher[];
};

export async function exportTeacherPortraitCollection(
  templateId: string,
): Promise<TeacherCollectionExchangePayload | null> {
  await ensureTeacherPortraitCollectionTables();
  const template = await getTeacherPortraitTemplateById(templateId);
  if (!template) return null;
  const values: unknown[] = [templateId];
  const deptFilter = sqlTeacherInTargetDepartments(template.targetDepartments, 'u', values);
  const rows = (await pool.query(
    `SELECT u.username,
            COALESCE(u.name_zh, '') AS name_zh,
            COALESCE(u.name_en, '') AS name_en,
            COALESCE(u.department, '') AS department,
            s.diagnosis,
            s.text_answers
     FROM users u
     LEFT JOIN teacher_portrait_collection_submissions s
       ON s.teacher_id = u.id AND s.template_id = $1
     WHERE u.role = 'teacher'${deptFilter}
     ORDER BY COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''), u.username) ASC`,
    values,
  )).rows as Array<{
    username: string;
    name_zh: string;
    name_en: string;
    department: string;
    diagnosis: unknown;
    text_answers: unknown;
  }>;
  return {
    meta: {
      academicYearName: template.academicYearName,
      term: template.term,
      title: template.title ?? '',
      departments: template.targetDepartments ?? [],
      formBlocks: template.formBlocks,
    },
    teachers: rows.map((row) => ({
      username: row.username,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      department: row.department,
      diagnosis: parseTeachingDiagnosis(row.diagnosis),
      textAnswers: textAnswersForBlocks(row.text_answers, template.formBlocks),
    })),
  };
}

export async function importTeacherPortraitCollection(
  templateId: string,
  teachers: TeacherCollectionExchangeTeacher[],
  userId: string | null,
): Promise<{ importedTeachers: number; warnings: string[] }> {
  await ensureTeacherPortraitCollectionTables();
  const template = await getTeacherPortraitTemplateById(templateId);
  if (!template) {
    const error = new Error('template_not_found');
    throw error;
  }
  const includesKiss = !template.formBlocks || template.formBlocks.some((block) => block.kind === 'kiss');
  const warnings: string[] = [];
  let importedTeachers = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const teacher of teachers) {
      if (!teacher || typeof teacher !== 'object') continue;
      const username = String(teacher.username ?? '').trim();
      if (!username) continue;
      const user = (await client.query(
        `SELECT id, department FROM users
         WHERE role = 'teacher' AND lower(username) = lower($1)
         LIMIT 1`,
        [username],
      )).rows[0] as { id: string; department: string | null } | undefined;
      if (!user) {
        warnings.push(`未找到登录名「${username}」的教师`);
        continue;
      }
      if (!teacherMatchesTargetDepartments(user.department, template.targetDepartments)) {
        warnings.push(`「${username}」不在这份任务的部门范围内，已跳过`);
        continue;
      }
      const diagnosis = includesKiss ? parseTeachingDiagnosis(teacher.diagnosis) : emptyTeachingDiagnosis();
      const textAnswers = textAnswersForBlocks(teacher.textAnswers, template.formBlocks);
      const submissionId = `tpcs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      await client.query(
        `INSERT INTO teacher_portrait_collection_submissions
           (id, template_id, teacher_id, diagnosis, text_answers, created_by, updated_by)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $6)
         ON CONFLICT (template_id, teacher_id)
         DO UPDATE SET diagnosis = EXCLUDED.diagnosis,
                       text_answers = EXCLUDED.text_answers,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = CURRENT_TIMESTAMP`,
        [submissionId, templateId, user.id, JSON.stringify(diagnosis), JSON.stringify(textAnswers), userId],
      );
      importedTeachers += 1;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { importedTeachers, warnings };
}
