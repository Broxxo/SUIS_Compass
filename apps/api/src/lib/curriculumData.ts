import type { CourseDomainsConfig } from '@repo/shared';
import { normalizeCourseDomainsConfig } from '@repo/shared';
import pool from '../config/database.js';
import {
  mapDbCourseRowToLibrarySync,
  removeCourseFromAllYearPresetLibraries,
  syncCourseToAllYearPresetLibraries,
} from './courseReportLibrarySync.js';
import {
  getSchoolSettingsHolderUserId,
  loadSchoolGradeStructure,
  saveSchoolGradeStructure,
  type GradeConfig,
} from './schoolGradeStructure.js';

export const CURRICULUM_EXPORT_VERSION = '1.2';

export type CurriculumSemesterData = {
  courseId: string;
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  units: unknown[];
};

export type CurriculumExportPayload = {
  courses: Array<Record<string, unknown>>;
  semesterData: Record<string, CurriculumSemesterData>;
  keyConcepts: string[];
  categoryOrder: string[];
  courseDomains: CourseDomainsConfig;
  gradeConfig: GradeConfig;
  exportDate: string;
  version: string;
  source: 'database';
};

export type CurriculumImportPayload = {
  courses?: unknown;
  semesterData?: unknown;
  keyConcepts?: unknown;
  categoryOrder?: unknown;
  courseDomains?: unknown;
  gradeConfig?: unknown;
};

let ensuredCoursesCoTeachingColumn = false;

async function ensureCoursesCoTeachingColumn(): Promise<void> {
  if (ensuredCoursesCoTeachingColumn) return;
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS co_teaching BOOLEAN NOT NULL DEFAULT FALSE');
  ensuredCoursesCoTeachingColumn = true;
}

let ensuredCourseDomainsColumn = false;

async function ensureCourseDomainsColumn(): Promise<void> {
  if (ensuredCourseDomainsColumn) return;
  await pool.query(
    `ALTER TABLE user_settings
     ADD COLUMN IF NOT EXISTS course_domains JSONB DEFAULT '{"domains":[],"domainOrder":[]}'::jsonb`,
  );
  ensuredCourseDomainsColumn = true;
}

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val
      .map((x) => {
        if (typeof x === 'number' && Number.isFinite(x)) return `g${Math.round(x)}`;
        const s = String(x ?? '').trim();
        if (!s) return '';
        const n = Number(s);
        if (Number.isFinite(n)) return `g${Math.round(n)}`;
        return s;
      })
      .filter((x) => !!x);
  }
  if (typeof val === 'string') {
    try {
      return parseJsonArray(JSON.parse(val));
    } catch {
      return [];
    }
  }
  return [];
}

const PERIODS_MIN = 0.5;
const PERIODS_MAX = 99;
const PERIODS_STEP = 0.5;

function normalizeWeeklyPeriodsFromDb(raw: number): number {
  if (!Number.isFinite(raw)) return 2;
  const clamped = Math.max(PERIODS_MIN, Math.min(PERIODS_MAX, raw));
  const stepped = Math.round(clamped / PERIODS_STEP) * PERIODS_STEP;
  return Math.round(stepped * 100) / 100;
}

function parsePeriodsMap(val: unknown): Record<string, number> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (Number.isFinite(n)) out[k] = normalizeWeeklyPeriodsFromDb(n);
    }
    return out;
  }
  return {};
}

function mapCourseRow(row: Record<string, unknown>) {
  const applicableGrades = parseJsonArray(row.applicable_grades).filter(
    (id, i, arr) => arr.indexOf(id) === i,
  );
  return {
    id: row.id,
    name: row.name,
    subjectCategory:
      row.subject_category_zh && row.subject_category_en
        ? { zh: row.subject_category_zh, en: row.subject_category_en }
        : row.subject_category_zh || row.subject_category_en || '',
    applicableGrades,
    weeklyPeriodsByGrade: parsePeriodsMap(row.weekly_periods_by_grade),
    coTeaching: Boolean(row.co_teaching),
    textbookVersion: row.textbook_version,
    color: row.color,
  };
}

export function getSemesterExportKey(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2',
): string {
  return `semester-data-${courseId}-${grade}-${semester}`;
}

async function getSchoolCategoryOrderHolderId(fallbackUserId: string): Promise<string> {
  const holder = await getSchoolSettingsHolderUserId();
  return holder ?? fallbackUserId;
}

export async function exportCurriculumFromDatabase(): Promise<CurriculumExportPayload> {
  await ensureCoursesCoTeachingColumn();
  await ensureCourseDomainsColumn();

  const coursesResult = await pool.query('SELECT * FROM courses ORDER BY created_at ASC');
  const courses = coursesResult.rows.map((row: Record<string, unknown>) => mapCourseRow(row));

  const semesterResult = await pool.query(
    'SELECT course_id, grade, semester, units FROM semester_data ORDER BY course_id, grade, semester',
  );
  const semesterData: Record<string, CurriculumSemesterData> = {};
  for (const row of semesterResult.rows as Array<Record<string, unknown>>) {
    const courseId = String(row.course_id);
    const grade = Number(row.grade);
    const semester = row.semester as 'Semester 1' | 'Semester 2';
    const key = getSemesterExportKey(courseId, grade, semester);
    const units = row.units;
    semesterData[key] = {
      courseId,
      grade,
      semester,
      units: Array.isArray(units) ? units : [],
    };
  }

  const keyConceptsResult = await pool.query(
    `SELECT s.key_concepts
     FROM user_settings s
     INNER JOIN users u ON u.id = s.user_id AND u.role = 'system-admin'
     WHERE s.key_concepts IS NOT NULL
     ORDER BY s.updated_at DESC NULLS LAST
     LIMIT 1`,
  );
  const keyConceptsRaw = (keyConceptsResult.rows[0] as { key_concepts?: unknown } | undefined)?.key_concepts;
  const keyConcepts = Array.isArray(keyConceptsRaw) ? keyConceptsRaw.map(String) : [];

  const holderId = (await getSchoolSettingsHolderUserId()) ?? '';
  let categoryOrder: string[] = [];
  let courseDomains = normalizeCourseDomainsConfig(null);
  if (holderId) {
    const settingsResult = await pool.query(
      `SELECT category_order, course_domains FROM user_settings WHERE user_id = $1`,
      [holderId],
    );
    if (settingsResult.rows.length > 0) {
      const settingsRow = settingsResult.rows[0] as Record<string, unknown>;
      const rawOrder = settingsRow.category_order;
      if (rawOrder != null) {
        const parsed = typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder;
        categoryOrder = Array.isArray(parsed) ? parsed.map(String) : [];
      }
      const rawDomains = settingsRow.course_domains;
      if (rawDomains != null) {
        const parsed = typeof rawDomains === 'string' ? JSON.parse(rawDomains) : rawDomains;
        courseDomains = normalizeCourseDomainsConfig(parsed);
      }
    }
  }

  const gradeConfig = await loadSchoolGradeStructure();

  return {
    courses,
    semesterData,
    keyConcepts,
    categoryOrder,
    courseDomains,
    gradeConfig,
    exportDate: new Date().toISOString(),
    version: CURRICULUM_EXPORT_VERSION,
    source: 'database',
  };
}

function normalizeImportPayload(body: unknown): {
  courses: Array<Record<string, unknown>>;
  semesterData: Record<string, CurriculumSemesterData>;
  keyConcepts: string[];
  categoryOrder: string[];
  courseDomains: CourseDomainsConfig;
  gradeConfig: GradeConfig | null;
  hasKeyConcepts: boolean;
  hasCategoryOrder: boolean;
  hasCourseDomains: boolean;
  hasGradeConfig: boolean;
} {
  const root =
    body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
      ? (body as { data: unknown }).data
      : body;
  if (!root || typeof root !== 'object') {
    throw new Error('Invalid import payload');
  }
  const rec = root as CurriculumImportPayload;

  const coursesRaw = rec.courses;
  if (!Array.isArray(coursesRaw)) {
    throw new Error('Import payload must include courses array');
  }

  const semesterRaw = rec.semesterData;
  const semesterData: Record<string, CurriculumSemesterData> = {};
  if (semesterRaw && typeof semesterRaw === 'object' && !Array.isArray(semesterRaw)) {
    for (const [key, value] of Object.entries(semesterRaw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const sd = value as Record<string, unknown>;
      const courseId = String(sd.courseId ?? '').trim();
      const grade = Number(sd.grade);
      const semester = sd.semester;
      if (!courseId || !Number.isFinite(grade)) continue;
      if (semester !== 'Semester 1' && semester !== 'Semester 2') continue;
      semesterData[key] = {
        courseId,
        grade: Math.round(grade),
        semester,
        units: Array.isArray(sd.units) ? sd.units : [],
      };
    }
  }

  const keyConcepts = Array.isArray(rec.keyConcepts) ? rec.keyConcepts.map(String) : [];
  const categoryOrder = Array.isArray(rec.categoryOrder) ? rec.categoryOrder.map(String) : [];
  const courseDomains = normalizeCourseDomainsConfig(rec.courseDomains ?? null);
  const gradeConfig =
    rec.gradeConfig != null && typeof rec.gradeConfig === 'object'
      ? (rec.gradeConfig as GradeConfig)
      : null;

  return {
    courses: coursesRaw as Array<Record<string, unknown>>,
    semesterData,
    keyConcepts,
    categoryOrder,
    courseDomains,
    gradeConfig,
    hasKeyConcepts: Array.isArray(rec.keyConcepts),
    hasCategoryOrder: Array.isArray(rec.categoryOrder),
    hasCourseDomains: rec.courseDomains != null,
    hasGradeConfig: rec.gradeConfig != null,
  };
}

async function upsertCourseRow(
  client: { query: typeof pool.query },
  holderId: string,
  course: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = String(course.id ?? '').trim();
  const name = String(course.name ?? '').trim();
  if (!id || !name) throw new Error('Each course must have id and name');

  const subjectCategory = course.subjectCategory;
  const subjectCategoryZh =
    typeof subjectCategory === 'object' && subjectCategory && 'zh' in (subjectCategory as object)
      ? String((subjectCategory as { zh?: unknown }).zh ?? '')
      : String(subjectCategory ?? '');
  const subjectCategoryEn =
    typeof subjectCategory === 'object' && subjectCategory && 'en' in (subjectCategory as object)
      ? String((subjectCategory as { en?: unknown }).en ?? '')
      : '';

  const applicableGrades = JSON.stringify(
    Array.isArray(course.applicableGrades) ? course.applicableGrades : [],
  );
  const weeklyPeriodsByGrade = JSON.stringify(
    course.weeklyPeriodsByGrade && typeof course.weeklyPeriodsByGrade === 'object'
      ? course.weeklyPeriodsByGrade
      : {},
  );
  const coTeaching = Boolean(course.coTeaching);
  const textbookVersion = course.textbookVersion != null ? String(course.textbookVersion) : null;
  const color = course.color != null ? String(course.color) : 'blue';

  const result = await client.query(
    `INSERT INTO courses (id, user_id, name, subject_category_zh, subject_category_en, applicable_grades, weekly_periods_by_grade, co_teaching, textbook_version, color)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       subject_category_zh = EXCLUDED.subject_category_zh,
       subject_category_en = EXCLUDED.subject_category_en,
       applicable_grades = EXCLUDED.applicable_grades,
       weekly_periods_by_grade = EXCLUDED.weekly_periods_by_grade,
       co_teaching = EXCLUDED.co_teaching,
       textbook_version = EXCLUDED.textbook_version,
       color = EXCLUDED.color,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [id, holderId, name, subjectCategoryZh, subjectCategoryEn, applicableGrades, weeklyPeriodsByGrade, coTeaching, textbookVersion, color],
  );
  return result.rows[0] as Record<string, unknown>;
}

export async function importCurriculumToDatabase(
  body: unknown,
  actorUserId: string,
): Promise<{ coursesImported: number; semesterRowsImported: number }> {
  const payload = normalizeImportPayload(body);
  await ensureCoursesCoTeachingColumn();
  await ensureCourseDomainsColumn();

  const holderId = (await getSchoolSettingsHolderUserId()) ?? actorUserId;
  const importCourseIds = payload.courses
    .map((c) => String(c.id ?? '').trim())
    .filter(Boolean);

  if (importCourseIds.length === 0 && payload.courses.length > 0) {
    throw new Error('Import courses must include valid id fields');
  }

  const client = await pool.connect();
  const deletedCourseIds: string[] = [];
  const upsertedCourseRows: Record<string, unknown>[] = [];

  try {
    await client.query('BEGIN');

    const existingCourses = await client.query('SELECT id FROM courses');
    const existingIds = (existingCourses.rows as Array<{ id: string }>).map((r) => r.id);
    for (const existingId of existingIds) {
      if (!importCourseIds.includes(existingId)) {
        deletedCourseIds.push(existingId);
      }
    }
    if (deletedCourseIds.length > 0) {
      await client.query('DELETE FROM courses WHERE id = ANY($1::varchar[])', [deletedCourseIds]);
    }

    for (const course of payload.courses) {
      const row = await upsertCourseRow(client, holderId, course);
      upsertedCourseRows.push(row);
    }

    if (importCourseIds.length > 0) {
      await client.query('DELETE FROM semester_data WHERE course_id = ANY($1::varchar[])', [
        importCourseIds,
      ]);
    }

    const importCourseIdSet = new Set(importCourseIds);
    let semesterRowsImported = 0;
    for (const semesterData of Object.values(payload.semesterData)) {
      if (!importCourseIdSet.has(semesterData.courseId)) continue;
      await client.query(
        `INSERT INTO semester_data (user_id, course_id, grade, semester, units, weekly_periods)
         VALUES ($1, $2, $3, $4, $5::jsonb, NULL)
         ON CONFLICT (course_id, grade, semester)
         DO UPDATE SET units = EXCLUDED.units, user_id = EXCLUDED.user_id, updated_at = CURRENT_TIMESTAMP`,
        [
          holderId,
          semesterData.courseId,
          semesterData.grade,
          semesterData.semester,
          JSON.stringify(semesterData.units ?? []),
        ],
      );
      semesterRowsImported += 1;
    }

    if (payload.hasKeyConcepts) {
      await client.query(
        `INSERT INTO user_settings (user_id, key_concepts, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id)
         DO UPDATE SET key_concepts = EXCLUDED.key_concepts, updated_at = CURRENT_TIMESTAMP`,
        [actorUserId, JSON.stringify(payload.keyConcepts)],
      );
    }

    const categoryHolderId = await getSchoolCategoryOrderHolderId(actorUserId);
    if (payload.hasCategoryOrder) {
      await client.query(
        `INSERT INTO user_settings (user_id, category_order, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id)
         DO UPDATE SET category_order = EXCLUDED.category_order, updated_at = CURRENT_TIMESTAMP`,
        [categoryHolderId, JSON.stringify(payload.categoryOrder)],
      );
    }

    if (payload.hasCourseDomains) {
      await client.query(
        `INSERT INTO user_settings (user_id, course_domains, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id)
         DO UPDATE SET course_domains = EXCLUDED.course_domains, updated_at = CURRENT_TIMESTAMP`,
        [categoryHolderId, JSON.stringify(payload.courseDomains)],
      );
    }

    await client.query('COMMIT');

    if (payload.hasGradeConfig && payload.gradeConfig) {
      await saveSchoolGradeStructure(payload.gradeConfig, actorUserId);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  for (const deletedId of deletedCourseIds) {
    try {
      await removeCourseFromAllYearPresetLibraries(deletedId);
    } catch {
      // non-critical
    }
  }
  for (const row of upsertedCourseRows) {
    try {
      await syncCourseToAllYearPresetLibraries(mapDbCourseRowToLibrarySync(row), actorUserId);
    } catch {
      // non-critical
    }
  }

  return {
    coursesImported: upsertedCourseRows.length,
    semesterRowsImported: Object.values(payload.semesterData).filter((sd) =>
      importCourseIds.includes(sd.courseId),
    ).length,
  };
}
