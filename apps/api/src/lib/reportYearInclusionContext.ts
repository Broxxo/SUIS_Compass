import pool from '../config/database.js';
import { sanitizeExamConfigs } from './reportExamConfigSanitize.js';
import {
  loadGradeConfigItemsForReport,
  loadSegmentGradeIds,
} from './schoolGradeStructure.js';
import {
  extractEvaluationGradeInclusion,
  extractExamGradeInclusion,
  isEvaluationGradeIncluded,
  isExamGradeIncluded,
} from '@repo/shared';

export { loadGradeConfigItemsForReport, loadSegmentGradeIds };

export type ReportYearInclusionContext = {
  stageInclusion: Record<string, string[]>;
  evaluationGradeInclusion: ReturnType<typeof extractEvaluationGradeInclusion>;
  examGradeInclusion: ReturnType<typeof extractExamGradeInclusion>;
  examConfigs: ReturnType<typeof sanitizeExamConfigs>;
  subjectKeyToCourseId: Map<string, string>;
};

let ensuredReportYearDimensionPresetTable = false;

export async function ensureReportYearDimensionPresetTable(): Promise<void> {
  if (ensuredReportYearDimensionPresetTable) return;
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
  ensuredReportYearDimensionPresetTable = true;
}

export function gradeCatalogIdForClassLevel(items: Array<{ id: string; level: number }>, classGrade: number): string | null {
  const hit = items.find((i) => i.level === classGrade);
  return hit?.id ?? null;
}

function extractPresetSubjectsArrayForInclusion(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const subs = (raw as { subjects?: unknown }).subjects;
    if (Array.isArray(subs)) return subs;
  }
  return [];
}

function buildSubjectKeyToCourseIdFromPayload(payload: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of extractPresetSubjectsArrayForInclusion(payload)) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const sk = String(rec.subjectKey ?? '').trim();
    const cid = String(rec.courseId ?? '').trim();
    if (sk && cid) out.set(sk, cid);
  }
  return out;
}

export async function loadReportYearInclusionContext(academicYearId: string): Promise<ReportYearInclusionContext> {
  await ensureReportYearDimensionPresetTable();
  const row = (await pool.query(
    `SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`,
    [academicYearId],
  )).rows[0] as { payload: unknown } | undefined;
  const payload = row?.payload ?? {};
  const stageInclusion: Record<string, string[]> = {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const si = (payload as { stageInclusion?: unknown }).stageInclusion;
    if (si && typeof si === 'object' && !Array.isArray(si)) {
      for (const [k, v] of Object.entries(si)) {
        const key = String(k).trim();
        if (!key || !Array.isArray(v)) continue;
        stageInclusion[key] = v.map((x) => String(x).trim()).filter(Boolean);
      }
    }
  }
  return {
    stageInclusion,
    evaluationGradeInclusion: extractEvaluationGradeInclusion(payload),
    examGradeInclusion: extractExamGradeInclusion(payload),
    examConfigs: sanitizeExamConfigs(payload),
    subjectKeyToCourseId: buildSubjectKeyToCourseIdFromPayload(payload),
  };
}

/** Whether this template subject must be filled for students in a class at the given grade catalog id. */
export function isTemplateSubjectRequiredForGrade(
  subjectKey: string,
  segmentId: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  ctx: ReportYearInclusionContext,
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

export function effectiveTemplateSubjectEnableScore(
  term: string,
  segmentId: string,
  subjectKey: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  templateEnableScore: boolean,
  ctx: ReportYearInclusionContext,
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
