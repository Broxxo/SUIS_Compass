import pool from '../config/database.js';
import {
  parseReportGradeDimensionSnapshots,
  type ReportGradeDimensionSnapshot,
} from '@repo/shared';
import { sanitizeExamConfigs } from './reportExamConfigSanitize.js';
import {
  getGradeCatalogIdForClass,
  isClassInSegmentGrades,
  loadGradeConfigItemsForReport,
  loadSchoolGradeStructure,
  loadSegmentGradeIds,
  type GradeConfig,
} from './schoolGradeStructure.js';
import {
  buildSubjectKeyToCourseIdFromPresetPayload,
  effectiveTemplateSubjectEnableScore as sharedEffectiveTemplateSubjectEnableScore,
  extractEvaluationGradeInclusion,
  extractExamGradeInclusion,
  isEvaluationGradeIncluded,
  resolveEvaluationGradesForCourse,
} from '@repo/shared';

export {
  getGradeCatalogIdForClass,
  isClassInSegmentGrades,
  loadGradeConfigItemsForReport,
  loadSchoolGradeStructure,
  loadSegmentGradeIds,
  type GradeConfig,
};

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

/** 仅保留属于报告学段（schoolSegmentId）的班级 id */
export async function filterClassIdsForReportSegment(
  academicYearId: string,
  classIds: string[],
  segmentId: string,
): Promise<string[]> {
  const sid = String(segmentId ?? '').trim();
  if (!sid || classIds.length === 0) return classIds;
  const segmentGradeIds = await loadSegmentGradeIds(sid);
  if (!segmentGradeIds.length) return classIds;
  const gradeConfig = await loadSchoolGradeStructure();
  const rows = (await pool.query(
    `SELECT id, grade, name FROM classes WHERE academic_year_id = $1 AND id = ANY($2::varchar[])`,
    [academicYearId, classIds],
  )).rows as Array<{ id: string; grade: number; name: string }>;
  const allowed = new Set(
    rows
      .filter((r) =>
        isClassInSegmentGrades(gradeConfig, { grade: Number(r.grade), name: String(r.name ?? '') }, segmentGradeIds),
      )
      .map((r) => r.id),
  );
  return classIds.filter((id) => allowed.has(id));
}

function buildSubjectKeyToCourseIdFromPayload(payload: unknown): Map<string, string> {
  const record = buildSubjectKeyToCourseIdFromPresetPayload(payload);
  return new Map(Object.entries(record));
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

/**
 * 岗位查询用学科：模板学科 + 本学段 stageInclusion 中在本学段有参评年级的课程（如 G5-6 双语美术）。
 */
export function resolveStaffingSubjectKeysForReportTemplate(
  templateSubjectKeys: string[],
  segmentId: string,
  segmentGradeIds: string[],
  ctx: ReportYearInclusionContext,
): string[] {
  const out = new Set(templateSubjectKeys.map((k) => String(k).trim()).filter(Boolean));
  const seg = String(segmentId ?? '').trim();
  if (!seg) return [...out];
  const courseToSubjectKey = new Map<string, string>();
  for (const [sk, cid] of ctx.subjectKeyToCourseId) {
    if (cid) courseToSubjectKey.set(cid, sk);
  }
  for (const courseId of ctx.stageInclusion[seg] ?? []) {
    const cid = String(courseId ?? '').trim();
    if (!cid) continue;
    const grades = resolveEvaluationGradesForCourse(
      seg,
      cid,
      segmentGradeIds,
      ctx.stageInclusion,
      ctx.evaluationGradeInclusion,
    );
    if (grades.length === 0) continue;
    const sk = courseToSubjectKey.get(cid);
    if (sk) out.add(sk);
  }
  return [...out];
}

/** 某班某模板学科行可由哪些岗位 subject_key 填写（与参评课程 subject_key 一致，不做跨课程映射）。 */
export function staffingSubjectKeysForTemplateSubjectAtGrade(
  templateSubjectKey: string,
  _templateSubjectKeys: string[],
  gradeCatalogId: string | null,
  segmentId: string,
  segmentGradeIds: string[],
  ctx: ReportYearInclusionContext,
): string[] {
  const tpl = String(templateSubjectKey ?? '').trim();
  if (!tpl) return [];
  if (isTemplateSubjectRequiredForGrade(tpl, segmentId, gradeCatalogId, segmentGradeIds, ctx)) {
    return [tpl];
  }
  return [];
}

/** 按本次学业报告模板 + 学年评价年级，剔除教师任课但当前班年级未参评的班级/学科。 */
export async function filterTeacherSubjectByClassForReportTemplate(
  academicYearId: string,
  subjectByClass: Map<string, Set<string>>,
  templateSubjectKeys: string[],
  segmentId: string,
  ctx: ReportYearInclusionContext,
): Promise<Map<string, Set<string>>> {
  if (subjectByClass.size === 0) return subjectByClass;
  const seg = String(segmentId ?? '').trim();
  const segmentGradeIds = seg ? await loadSegmentGradeIds(seg) : [];
  const staffingKeys = resolveStaffingSubjectKeysForReportTemplate(templateSubjectKeys, seg, segmentGradeIds, ctx);
  const staffingSet = new Set(staffingKeys);
  const classIds = Array.from(subjectByClass.keys());
  const rows = (await pool.query(
    `SELECT id, grade, name FROM classes WHERE academic_year_id = $1 AND id = ANY($2::varchar[])`,
    [academicYearId, classIds],
  )).rows as Array<{ id: string; grade: number; name: string }>;
  const classMetaById = new Map(rows.map((r) => [r.id, { grade: Number(r.grade), name: String(r.name ?? '') }] as const));
  const gradeConfig = await loadSchoolGradeStructure();
  const out = new Map<string, Set<string>>();
  for (const [classId, keys] of subjectByClass) {
    const meta = classMetaById.get(classId);
    if (!meta) continue;
    const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, meta.grade, { className: meta.name });
    const subjectKeysForClass = new Set<string>();
    for (const subjectKey of keys) {
      if (!staffingSet.has(subjectKey)) continue;
      if (!isTemplateSubjectRequiredForGrade(subjectKey, seg, gradeCatalogId, segmentGradeIds, ctx)) continue;
      subjectKeysForClass.add(subjectKey);
    }
    if (subjectKeysForClass.size > 0) out.set(classId, subjectKeysForClass);
  }
  return out;
}

export function effectiveTemplateSubjectEnableScoreForContext(
  term: string,
  segmentId: string,
  subjectKey: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  templateEnableScore: boolean,
  ctx: ReportYearInclusionContext,
): boolean {
  return sharedEffectiveTemplateSubjectEnableScore(
    term,
    segmentId,
    subjectKey,
    gradeCatalogId,
    segmentGradeIds,
    templateEnableScore,
    {
      stageInclusion: ctx.stageInclusion,
      evaluationGradeInclusion: ctx.evaluationGradeInclusion,
      examGradeInclusion: ctx.examGradeInclusion,
      examConfigs: ctx.examConfigs,
      subjectKeyToCourseId: ctx.subjectKeyToCourseId,
    },
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
  return effectiveTemplateSubjectEnableScoreForContext(
    term,
    segmentId,
    subjectKey,
    gradeCatalogId,
    segmentGradeIds,
    templateEnableScore,
    ctx,
  );
}

type TargetLevel = 'A' | 'B' | 'C' | 'D';

export type YearPresetSubjectRow = {
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  enableScore: boolean;
  enableTeacherComment: boolean;
  enableTarget: boolean;
  gradeDimensions: ReportGradeDimensionSnapshot[];
  dimensions: Array<{
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>;
};

function extractPresetSubjectsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const subs = (raw as { subjects?: unknown }).subjects;
    if (Array.isArray(subs)) return subs;
  }
  return [];
}

function normalizeDimensionIdentifier(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || 'item';
}

function parsePresetDimensionLabels(
  zhRaw: unknown,
  enRaw: unknown,
): { dimensionLabelZh: string; dimensionLabelEn: string } | null {
  const dimensionLabelZh = String(zhRaw ?? '').trim();
  const dimensionLabelEn = String(enRaw ?? '').trim();
  if (!dimensionLabelZh && !dimensionLabelEn) return null;
  return {
    dimensionLabelZh: dimensionLabelZh || dimensionLabelEn,
    dimensionLabelEn: dimensionLabelEn || dimensionLabelZh,
  };
}

/** 学年学业报告模板库学科行（来自课程管理同步的学年预设）。 */
export async function loadYearPresetSubjectRows(academicYearId: string): Promise<YearPresetSubjectRow[]> {
  await ensureReportYearDimensionPresetTable();
  const row = (await pool.query(
    `SELECT payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`,
    [academicYearId],
  )).rows[0] as { payload: unknown } | undefined;
  const payload = row?.payload ?? {};
  const out: YearPresetSubjectRow[] = [];
  const usedKeys = new Set<string>();
  for (const raw of extractPresetSubjectsArray(payload)) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const subjectNameZh = String(rec.subjectNameZh ?? '').trim();
    const subjectNameEn = String(rec.subjectNameEn ?? '').trim();
    if (!subjectNameZh && !subjectNameEn) continue;
    const subjectKey = String(rec.subjectKey ?? '').trim();
    if (!subjectKey || usedKeys.has(subjectKey)) continue;
    usedKeys.add(subjectKey);
    const dimsRaw = Array.isArray(rec.dimensions) ? rec.dimensions : [];
    const usedDimKeys = new Set<string>();
    const dimensions: YearPresetSubjectRow['dimensions'] = [];
    for (const dimRaw of dimsRaw) {
      if (!dimRaw || typeof dimRaw !== 'object') continue;
      const dim = dimRaw as Record<string, unknown>;
      const labels = parsePresetDimensionLabels(dim.dimensionLabelZh, dim.dimensionLabelEn);
      if (!labels) continue;
      const key = `${labels.dimensionLabelZh}\u0001${labels.dimensionLabelEn}`;
      if (usedDimKeys.has(key)) continue;
      usedDimKeys.add(key);
      dimensions.push({ ...labels, levelDescriptions: {} });
    }
    const gradeDimensions = parseReportGradeDimensionSnapshots(rec.gradeDimensions);
    out.push({
      subjectKey,
      subjectNameZh: subjectNameZh || subjectNameEn,
      subjectNameEn: subjectNameEn || subjectNameZh,
      enableScore: rec.enableScore !== false,
      enableTeacherComment: rec.enableTeacherComment !== false,
      enableTarget:
        rec.enableTarget === false
          ? false
          : gradeDimensions.length > 0 || dimensions.length > 0,
      gradeDimensions,
      dimensions,
    });
  }
  return out;
}

export type ReportTemplateSubjectShape = {
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
};

function buildDimensionsFromLibrary(
  subjectKey: string,
  sourceDims: YearPresetSubjectRow['dimensions'],
): ReportTemplateSubjectShape['dimensions'] {
  const usedDimKeys = new Set<string>();
  const dimensions: ReportTemplateSubjectShape['dimensions'] = [];
  for (let i = 0; i < sourceDims.length; i += 1) {
    const dim = sourceDims[i];
    const dimensionLabelZh = String(dim.dimensionLabelZh ?? '').trim();
    const dimensionLabelEn = String(dim.dimensionLabelEn ?? '').trim();
    const dimensionLabel = dimensionLabelZh || dimensionLabelEn;
    if (!dimensionLabel) continue;
    const baseDimKey = normalizeDimensionIdentifier(dimensionLabelEn || dimensionLabelZh);
    let dimensionKey = baseDimKey;
    let seq = 2;
    while (usedDimKeys.has(dimensionKey)) {
      dimensionKey = `${baseDimKey}_${seq}`;
      seq += 1;
    }
    usedDimKeys.add(dimensionKey);
    dimensions.push({
      id: `lib-dim-${subjectKey}-${dimensionKey}`,
      dimensionKey,
      dimensionLabel,
      dimensionLabelZh: dimensionLabelZh || dimensionLabel,
      dimensionLabelEn: dimensionLabelEn || dimensionLabel,
      sortOrder: i,
      levelDescriptions: dim.levelDescriptions ?? {},
    });
  }
  return dimensions;
}

function buildTemplateSubjectFromLibraryRow(
  library: YearPresetSubjectRow,
  sortOrder: number,
  saved?: ReportTemplateSubjectShape,
): ReportTemplateSubjectShape {
  const gradeDimensions =
    saved?.gradeDimensions?.length
      ? saved.gradeDimensions
      : library.gradeDimensions;
  const savedDims = saved?.dimensions ?? [];
  const legacyDims =
    gradeDimensions.length > 0
      ? []
      : savedDims.length > 0
        ? savedDims
        : library.enableTarget !== false
          ? buildDimensionsFromLibrary(library.subjectKey, library.dimensions)
          : [];
  return {
    id: saved?.id ?? `lib-sub-${library.subjectKey}`,
    subjectKey: library.subjectKey,
    subjectName: library.subjectNameZh || library.subjectNameEn,
    subjectNameZh: library.subjectNameZh,
    subjectNameEn: library.subjectNameEn,
    moduleType: saved?.moduleType ?? 'subject_score',
    enableScore: saved?.enableScore ?? library.enableScore,
    enableTeacherComment: saved?.enableTeacherComment ?? library.enableTeacherComment,
    enableLearningQuality: saved?.enableLearningQuality ?? true,
    scoreVisibility: saved?.scoreVisibility ?? 'teacher_homeroom_admin',
    sortOrder,
    gradeDimensions,
    dimensions: legacyDims,
  };
}

/**
 * 从学年模板库 + 参评设置合成学期报告的有效学科列表（不再临时克隆其它学科行）。
 */
export async function resolveReportTemplateSubjectsFromLibrary(
  templateSubjects: ReportTemplateSubjectShape[],
  segmentId: string,
  segmentGradeIds: string[],
  ctx: ReportYearInclusionContext,
  academicYearId: string,
): Promise<ReportTemplateSubjectShape[]> {
  const libraryRows = await loadYearPresetSubjectRows(academicYearId);
  const libraryByKey = new Map(libraryRows.map((r) => [r.subjectKey, r] as const));
  const savedByKey = new Map(templateSubjects.map((s) => [s.subjectKey, s] as const));
  const evaluationKeys = resolveStaffingSubjectKeysForReportTemplate(
    templateSubjects.map((s) => s.subjectKey).filter((k) => !!k),
    segmentId,
    segmentGradeIds,
    ctx,
  );
  const out: ReportTemplateSubjectShape[] = [];
  for (let i = 0; i < evaluationKeys.length; i += 1) {
    const subjectKey = evaluationKeys[i];
    const saved = savedByKey.get(subjectKey);
    const library = libraryByKey.get(subjectKey);
    if (library) {
      out.push(buildTemplateSubjectFromLibraryRow(library, i, saved));
      continue;
    }
    if (saved) {
      out.push({
        ...saved,
        gradeDimensions: saved.gradeDimensions?.length ? saved.gradeDimensions : [],
        sortOrder: i,
      });
    }
  }
  return out;
}

/** 仅保留该班年级需参评的模板/报告学科。 */
export function filterSubjectsForGradeCatalog<T extends { subjectKey: string }>(
  subjects: T[],
  segmentId: string,
  gradeCatalogId: string | null,
  segmentGradeIds: string[],
  ctx: ReportYearInclusionContext,
): T[] {
  return subjects.filter((s) =>
    isTemplateSubjectRequiredForGrade(s.subjectKey, segmentId, gradeCatalogId, segmentGradeIds, ctx),
  );
}
