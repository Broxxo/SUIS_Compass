import pool from '../config/database.js';
import {
  parseReportGradeDimensionSnapshots,
  type ReportGradeDimensionSnapshot,
} from '@repo/shared';
import { ensureReportYearDimensionPresetTable } from './reportYearInclusionContext.js';

function extractPresetSubjectsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const subs = (raw as { subjects?: unknown }).subjects;
    if (Array.isArray(subs)) return subs;
  }
  return [];
}

function presetSubjectMergeKey(row: { courseId?: string; subjectKey?: string }): string {
  const courseId = String(row.courseId ?? '').trim();
  if (courseId) return `course:${courseId}`;
  const subjectKey = String(row.subjectKey ?? '').trim();
  return subjectKey ? `key:${subjectKey}` : '';
}

/** 从学年模板库读取某学科的分年级维度快照（仅限本学段年级）。 */
export async function loadPresetGradeDimensionsSnapshot(
  academicYearId: string,
  segmentGradeIds: string[],
  subjectKey: string,
  courseId?: string | null,
): Promise<ReportGradeDimensionSnapshot[]> {
  await ensureReportYearDimensionPresetTable();
  const row = (
    await pool.query(
      `SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`,
      [academicYearId],
    )
  ).rows[0] as { payload: unknown } | undefined;
  const payload = row?.payload ?? {};
  const allowed = new Set(segmentGradeIds.map((g) => String(g).trim()).filter(Boolean));
  const wantKey = presetSubjectMergeKey({ courseId: courseId ?? '', subjectKey });
  for (const raw of extractPresetSubjectsArray(payload)) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const key = presetSubjectMergeKey({
      courseId: String(rec.courseId ?? ''),
      subjectKey: String(rec.subjectKey ?? ''),
    });
    if (key !== wantKey) continue;
    const all = parseReportGradeDimensionSnapshots(rec.gradeDimensions);
    if (allowed.size === 0) return all;
    return all.filter((g) => allowed.has(g.gradeId));
  }
  return [];
}
