import { REPORT_SCORE_LETTER_GRADES, type ReportScoreLetterGrade } from '@repo/shared';

export type SanitizedExamConfigScope = {
  subjectInclusion: string[];
  subjects: Array<{
    courseId: string;
    subjectKey: string;
    subjectNameZh: string;
    subjectNameEn: string;
    gradeConfigs: Array<{
      gradeId: string;
      percentBands: Partial<Record<ReportScoreLetterGrade, number>>;
      dimensionScores: Array<{ dimensionLabelZh: string; dimensionLabelEn: string; score: number }>;
    }>;
  }>;
};

export function sanitizeExamPercentBands(raw: unknown): Partial<Record<ReportScoreLetterGrade, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  const out: Partial<Record<ReportScoreLetterGrade, number>> = {};
  for (const g of REPORT_SCORE_LETTER_GRADES) {
    const v = Number(rec[g]);
    if (!Number.isFinite(v)) continue;
    out[g] = Math.max(0, Math.min(100, Math.round(v * 100) / 100));
  }
  return out;
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
