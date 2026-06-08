import pool from '../config/database.js';
import {
  getCourseReportSubjectLabels,
  presetSubjectKeyFromCourse,
  type CourseLabelSource,
} from '@repo/shared';
import { ensureReportYearDimensionPresetTable } from './reportYearInclusionContext.js';

export type CourseForLibrarySync = CourseLabelSource;

function presetSubjectMergeKey(row: { courseId?: string; subjectKey?: string }): string {
  const courseId = String(row.courseId ?? '').trim();
  if (courseId) return `course:${courseId}`;
  const subjectKey = String(row.subjectKey ?? '').trim();
  return subjectKey ? `key:${subjectKey}` : '';
}

function extractPresetSubjectsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const subs = (raw as { subjects?: unknown }).subjects;
    if (Array.isArray(subs)) return subs;
  }
  return [];
}

function normalizePayloadObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (Array.isArray(raw)) {
    return { subjects: raw };
  }
  return {};
}

/** 从课程管理行构建模板库（学年预设）学科存根 */
export function buildPresetSubjectStubFromCourse(course: CourseForLibrarySync): Record<string, unknown> {
  const { subjectNameZh, subjectNameEn } = getCourseReportSubjectLabels(course);
  const subjectKey = presetSubjectKeyFromCourse(course);
  return {
    courseId: course.id,
    subjectKey,
    subjectNameZh,
    subjectNameEn,
    enableScore: true,
    enableTeacherComment: false,
    enableTarget: false,
    dimensions: [],
    gradeDimensions: [],
  };
}

function mergeCourseStubIntoSubjects(
  subjects: unknown[],
  stub: Record<string, unknown>,
): unknown[] {
  const key = presetSubjectMergeKey({
    courseId: String(stub.courseId ?? ''),
    subjectKey: String(stub.subjectKey ?? ''),
  });
  if (!key) return subjects;
  const out = [...subjects];
  const idx = out.findIndex((row) => {
    if (!row || typeof row !== 'object') return false;
    const rec = row as Record<string, unknown>;
    return presetSubjectMergeKey({
      courseId: String(rec.courseId ?? ''),
      subjectKey: String(rec.subjectKey ?? ''),
    }) === key;
  });
  if (idx < 0) {
    out.push(stub);
    return out;
  }
  const existing = out[idx] as Record<string, unknown>;
  out[idx] = {
    ...existing,
    courseId: stub.courseId,
    subjectKey: stub.subjectKey,
    subjectNameZh: stub.subjectNameZh,
    subjectNameEn: stub.subjectNameEn,
    enableScore: existing.enableScore !== false,
    enableTeacherComment: existing.enableTeacherComment !== false,
    enableTarget: existing.enableTarget,
    dimensions: existing.dimensions ?? [],
    gradeDimensions: existing.gradeDimensions ?? [],
  };
  return out;
}

/** 将一门课程写入指定学年的学业报告模板库（学年预设 subjects） */
export async function upsertCourseInYearPresetLibrary(
  academicYearId: string,
  course: CourseForLibrarySync,
  updatedBy?: string | null,
): Promise<void> {
  await ensureReportYearDimensionPresetTable();
  const stub = buildPresetSubjectStubFromCourse(course);
  const row = (
    await pool.query(
      `SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`,
      [academicYearId],
    )
  ).rows[0] as { payload: unknown } | undefined;
  const payload = normalizePayloadObject(row?.payload ?? {});
  const subjects = mergeCourseStubIntoSubjects(extractPresetSubjectsArray(payload), stub);
  const nextPayload = { ...payload, subjects };
  await pool.query(
    `INSERT INTO student_report_year_dimension_presets
      (academic_year_id, payload, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (academic_year_id)
     DO UPDATE SET payload = EXCLUDED.payload, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [academicYearId, JSON.stringify(nextPayload), updatedBy ?? null],
  );
}

/** 将课程同步到所有学年的模板库 */
export async function syncCourseToAllYearPresetLibraries(
  course: CourseForLibrarySync,
  updatedBy?: string | null,
): Promise<void> {
  const years = (await pool.query(`SELECT id FROM academic_years ORDER BY start_date DESC`)).rows as Array<{
    id: string;
  }>;
  for (const y of years) {
    await upsertCourseInYearPresetLibrary(y.id, course, updatedBy);
  }
}

/** 从所有学年模板库移除课程 */
export async function removeCourseFromAllYearPresetLibraries(courseId: string): Promise<void> {
  await ensureReportYearDimensionPresetTable();
  const cid = String(courseId ?? '').trim();
  if (!cid) return;
  const rows = (await pool.query(`SELECT academic_year_id, payload FROM student_report_year_dimension_presets`))
    .rows as Array<{ academic_year_id: string; payload: unknown }>;
  for (const row of rows) {
    const payload = normalizePayloadObject(row.payload);
    const subjects = extractPresetSubjectsArray(payload).filter((item) => {
      if (!item || typeof item !== 'object') return true;
      return String((item as Record<string, unknown>).courseId ?? '').trim() !== cid;
    });
    const stageInclusion = { ...((payload.stageInclusion as Record<string, string[]>) ?? {}) };
    for (const [seg, list] of Object.entries(stageInclusion)) {
      stageInclusion[seg] = (list ?? []).filter((x) => String(x).trim() !== cid);
    }
    const evalInc = { ...((payload.evaluationGradeInclusion as Record<string, Record<string, string[]>>) ?? {}) };
    for (const [seg, courses] of Object.entries(evalInc)) {
      if (courses && typeof courses === 'object') {
        const next = { ...courses };
        delete next[cid];
        evalInc[seg] = next;
      }
    }
    await pool.query(
      `UPDATE student_report_year_dimension_presets
       SET payload = $1::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE academic_year_id = $2`,
      [JSON.stringify({ ...payload, subjects, stageInclusion, evaluationGradeInclusion: evalInc }), row.academic_year_id],
    );
  }
}

/** 将 courses 表中尚未入库的课程补写入指定学年模板库（一次性对齐历史数据） */
export async function ensureAllCoursesInYearPresetLibrary(academicYearId: string): Promise<void> {
  const courseRows = (await pool.query(
    `SELECT id, name, subject_category_zh, subject_category_en FROM courses ORDER BY created_at ASC`,
  )).rows as Array<{
    id: string;
    name: string;
    subject_category_zh: string | null;
    subject_category_en: string | null;
  }>;
  for (const c of courseRows) {
    await upsertCourseInYearPresetLibrary(academicYearId, {
      id: c.id,
      name: c.name,
      subjectCategory: { zh: c.subject_category_zh ?? '', en: c.subject_category_en ?? '' },
    });
  }
}

export function mapDbCourseRowToLibrarySync(row: Record<string, unknown>): CourseForLibrarySync {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    subjectCategory: {
      zh: String(row.subject_category_zh ?? ''),
      en: String(row.subject_category_en ?? ''),
    },
  };
}
