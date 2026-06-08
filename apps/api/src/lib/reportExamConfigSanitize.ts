import {
  examFullScoreFromGradeConfig,
  parseConfiguredExamPercentBands,
  validateConfiguredScoreGradeMinOrder,
  type ReportScoreLetterGrade,
} from '@repo/shared';

export type SanitizedExamConfigScope = {
  subjectInclusion: string[];
  subjects: Array<{
    courseId: string;
    subjectKey: string;
    subjectNameZh: string;
    subjectNameEn: string;
    gradeConfigs: Array<{
      gradeId: string;
      fullScore: number;
      percentBands: Partial<Record<ReportScoreLetterGrade, number>>;
      /** 已废弃，新配置恒为空 */
      dimensionScores: Array<{ dimensionLabelZh: string; dimensionLabelEn: string; score: number }>;
    }>;
  }>;
};

export function sanitizeExamPercentBands(raw: unknown): Partial<Record<ReportScoreLetterGrade, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return parseConfiguredExamPercentBands(raw as Partial<Record<string, string | number | null | undefined>>);
}

export function sanitizeExamFullScore(raw: unknown): number {
  return examFullScoreFromGradeConfig(typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : undefined);
}

/** key = `${term}::${schoolSegmentId}` */
export function sanitizeExamConfigs(raw: unknown): Record<string, SanitizedExamConfigScope> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = (raw as { examConfigs?: unknown }).examConfigs;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const out: Record<string, SanitizedExamConfigScope> = {};
  for (const [rawKey, rawScope] of Object.entries(source as Record<string, unknown>)) {
    const key = String(rawKey ?? '').trim();
    if (!key) continue;
    const scope = rawScope && typeof rawScope === 'object' && !Array.isArray(rawScope) ? (rawScope as Record<string, unknown>) : {};
    const subjectInclusion = Array.isArray(scope.subjectInclusion)
      ? scope.subjectInclusion.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const usedCourses = new Set<string>();
    const subjectsRaw = Array.isArray(scope.subjects) ? scope.subjects : [];
    const subjects: SanitizedExamConfigScope['subjects'] = [];
    for (const row of subjectsRaw) {
      const rec = row as Record<string, unknown>;
      const courseId = String(rec.courseId ?? '').trim();
      if (!courseId || usedCourses.has(courseId)) continue;
      usedCourses.add(courseId);
      const subjectKey = String(rec.subjectKey ?? '').trim();
      const subjectNameZh = String(rec.subjectNameZh ?? '').trim();
      const subjectNameEn = String(rec.subjectNameEn ?? '').trim();
      const gradeConfigsRaw = Array.isArray(rec.gradeConfigs) ? rec.gradeConfigs : [];
      const usedGrades = new Set<string>();
      const gradeConfigs: SanitizedExamConfigScope['subjects'][number]['gradeConfigs'] = [];
      for (const g of gradeConfigsRaw) {
        const gRec = g as Record<string, unknown>;
        const gradeId = String(gRec.gradeId ?? '').trim();
        if (!gradeId || usedGrades.has(gradeId)) continue;
        usedGrades.add(gradeId);
        const dimsRaw = Array.isArray(gRec.dimensionScores) ? gRec.dimensionScores : [];
        const dimensionScores: Array<{ dimensionLabelZh: string; dimensionLabelEn: string; score: number }> = [];
        for (const dim of dimsRaw) {
          const d = dim as Record<string, unknown>;
          const dimensionLabelZh = String(d.dimensionLabelZh ?? '').trim();
          const dimensionLabelEn = String(d.dimensionLabelEn ?? '').trim();
          const score = Number(d.score);
          if (!dimensionLabelZh || !dimensionLabelEn || !Number.isFinite(score) || score < 0) continue;
          dimensionScores.push({
            dimensionLabelZh,
            dimensionLabelEn,
            score: Math.round(score * 100) / 100,
          });
        }
        gradeConfigs.push({
          gradeId,
          fullScore: sanitizeExamFullScore(gRec.fullScore ?? gRec.totalScore ?? gRec.maxScore),
          percentBands: sanitizeExamPercentBands(gRec.percentBands),
          dimensionScores,
        });
      }
      subjects.push({
        courseId,
        subjectKey,
        subjectNameZh,
        subjectNameEn,
        gradeConfigs,
      });
    }
    out[key] = { subjectInclusion, subjects };
  }
  return out;
}

/** 校验所有考试学科等第下限顺序；返回首条错误文案 */
export function validateSanitizedExamConfigs(
  configs: Record<string, SanitizedExamConfigScope>,
): string | null {
  for (const scope of Object.values(configs)) {
    for (const sub of scope.subjects) {
      for (const gc of sub.gradeConfigs) {
        if (Object.keys(gc.percentBands).length === 0) continue;
        const err = validateConfiguredScoreGradeMinOrder(gc.percentBands, true, true);
        if (err) return err;
      }
    }
  }
  return null;
}
