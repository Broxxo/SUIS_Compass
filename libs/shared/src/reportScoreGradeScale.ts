/** 学业报告学科成绩换算用等第（含 ±） */
export const REPORT_SCORE_LETTER_GRADES = [
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D',
] as const;

export type ReportScoreLetterGrade = (typeof REPORT_SCORE_LETTER_GRADES)[number];

/** 与历史硬编码一致的默认「得分下限（含）」；最高分档优先匹配 */
export function defaultReportScoreGradeMinScores(): Record<ReportScoreLetterGrade, number> {
  return {
    'A+': 100,
    A: 95,
    'A-': 90,
    'B+': 85,
    B: 80,
    'B-': 75,
    'C+': 70,
    C: 65,
    'C-': 60,
    D: 0,
  };
}

function isReportScoreLetterGrade(k: string): k is ReportScoreLetterGrade {
  return (REPORT_SCORE_LETTER_GRADES as readonly string[]).includes(k);
}

/** 合并自定义下限与默认值（仅识别合法等第键） */
export function mergeReportScoreGradeMinScores(
  custom: Partial<Record<string, number>> | null | undefined,
): Record<ReportScoreLetterGrade, number> {
  const base = defaultReportScoreGradeMinScores();
  if (!custom || typeof custom !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(custom)) {
    if (!isReportScoreLetterGrade(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = n;
  }
  return out;
}

/**
 * 按「得分下限（含）」从高到低匹配第一个满足的等第。
 * 例如默认下 100→A+，99→A，60→C-，0–59.99→D。
 */
export function reportLetterGradeFromScore(
  score: number | null | undefined,
  customMins: Partial<Record<string, number>> | null | undefined,
): ReportScoreLetterGrade | null {
  if (score == null || Number.isNaN(score) || score < 0) return null;
  const merged = mergeReportScoreGradeMinScores(customMins);
  const ordered = [...REPORT_SCORE_LETTER_GRADES] as ReportScoreLetterGrade[];
  ordered.sort((a, b) => merged[b] - merged[a]);
  for (const g of ordered) {
    if (score >= merged[g]) return g;
  }
  return null;
}

/** 将细粒度学业等第（A+/A- 等）折成与目标维度一致的四档 A–D */
export function reportScoreLetterGradeToTargetLevel(
  grade: ReportScoreLetterGrade | null,
): 'A' | 'B' | 'C' | 'D' | null {
  if (!grade) return null;
  if (grade.startsWith('A')) return 'A';
  if (grade.startsWith('B')) return 'B';
  if (grade.startsWith('C')) return 'C';
  return 'D';
}

/** 按得分率（0–100）与百分比档得到四档目标等第 */
export function reportPercentToTargetLevel(
  percent: number | null | undefined,
  mins: Partial<Record<string, number>> | null | undefined,
): 'A' | 'B' | 'C' | 'D' | null {
  return reportScoreLetterGradeToTargetLevel(reportLetterGradeFromScore(percent, mins));
}
