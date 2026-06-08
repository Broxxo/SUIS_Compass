/** 学业报告学科成绩换算用等第（含 ±）；U 表示未达 D 档 */
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
  'U',
] as const;

export type ReportScoreLetterGrade = (typeof REPORT_SCORE_LETTER_GRADES)[number];

/** 考试学科未配置总分时使用的默认满分 */
export const DEFAULT_EXAM_GRADE_FULL_SCORE = 100;

/**
 * 默认等第得分率（%）：A+ 为 100%；其余每档递减 5 个百分点；D 从 35% 起，U 从 0% 起。
 * 换算：等第下限分 = 总分 × (得分率 / 100)。
 */
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
    D: 35,
    U: 0,
  };
}

/** 小学默认：A+ 100%，每档递减 5 个百分点至 C-60%，D35%，U0%（全部等第） */
export function defaultPrimarySchoolExamScoreGradeMins(): Record<ReportScoreLetterGrade, number> {
  return defaultReportScoreGradeMinScores();
}

/** 初中默认得分率（%）：仅 A+、A、B、C、D、U */
export function defaultJuniorHighExamScoreGradeMins(): Partial<Record<ReportScoreLetterGrade, number>> {
  return {
    'A+': 100,
    A: 85,
    B: 70,
    C: 60,
    D: 35,
    U: 0,
  };
}

function segmentLabelLooksJuniorHigh(label: string): boolean {
  const raw = label.trim();
  const lower = raw.toLowerCase();
  return raw.includes('初中') || lower.includes('middle') || lower.includes('junior');
}

function segmentLabelLooksPrimary(label: string): boolean {
  const raw = label.trim();
  const lower = raw.toLowerCase();
  return raw.includes('小学') || lower.includes('primary');
}

/**
 * 按学段名称返回考试学科等第默认得分率（%，含）。
 * 小学：全档；初中：A+100、A85、B70、C60、D35、U0；未识别学段时同小学全档。
 */
export function defaultExamScoreGradeMinsForSchoolSegment(
  segmentLabel: string | null | undefined,
): Partial<Record<ReportScoreLetterGrade, number>> {
  const label = String(segmentLabel ?? '').trim();
  if (!label) return defaultPrimarySchoolExamScoreGradeMins();
  if (segmentLabelLooksJuniorHigh(label)) return defaultJuniorHighExamScoreGradeMins();
  if (segmentLabelLooksPrimary(label)) return defaultPrimarySchoolExamScoreGradeMins();
  return defaultPrimarySchoolExamScoreGradeMins();
}

function isReportScoreLetterGrade(k: string): k is ReportScoreLetterGrade {
  return (REPORT_SCORE_LETTER_GRADES as readonly string[]).includes(k);
}

/** 仅提取已填写的等第下限（用于考试学科等第标准，不补全未填档位） */
export function configuredReportScoreGradeMins(
  custom: Partial<Record<string, number>> | null | undefined,
): Partial<Record<ReportScoreLetterGrade, number>> {
  if (!custom || typeof custom !== 'object') return {};
  const out: Partial<Record<ReportScoreLetterGrade, number>> = {};
  for (const g of REPORT_SCORE_LETTER_GRADES) {
    if (!Object.prototype.hasOwnProperty.call(custom, g)) continue;
    const n = Number(custom[g]);
    if (!Number.isFinite(n) || n < 0) continue;
    if (n === 0 && g !== 'U') continue;
    out[g] = Math.round(n * 100) / 100;
  }
  return out;
}

/**
 * 从表单字符串或已存数字提取「已填写」的等第下限。
 * 空字符串不参与（避免 Number('')===0）；未配置档位不参与顺序校验。
 */
export function parseConfiguredExamPercentBands(
  raw: Partial<Record<string, string | number | null | undefined>> | null | undefined,
): Partial<Record<ReportScoreLetterGrade, number>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<ReportScoreLetterGrade, number>> = {};
  for (const g of REPORT_SCORE_LETTER_GRADES) {
    if (!Object.prototype.hasOwnProperty.call(raw, g)) continue;
    const v = raw[g];
    if (v == null) continue;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) continue;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) continue;
      out[g] = Math.round(n * 100) / 100;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    if (n === 0 && g !== 'U') continue;
    out[g] = Math.round(n * 100) / 100;
  }
  return out;
}

/** 合并自定义下限与默认值（仅识别合法等第键；模板级等第仍用全量默认） */
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

/** 解析考试学科本年级满分；无效或未填时返回默认 100 */
export function examFullScoreFromGradeConfig(
  fullScore: number | null | undefined,
  _percentBands?: Partial<Record<string, number>> | null | undefined,
): number {
  const n = Number(fullScore);
  if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  return DEFAULT_EXAM_GRADE_FULL_SCORE;
}

/**
 * @deprecated 请使用 examFullScoreFromGradeConfig(fullScore)；旧数据无 fullScore 时默认 100。
 */
export function examFullScoreFromBands(
  configured: Partial<Record<string, number>> | null | undefined,
): number {
  return examFullScoreFromGradeConfig(undefined, configured);
}

/** 将得分率（%）换算为绝对分下限：下限分 = 总分 × (得分率 / 100) */
export function absoluteMinScoresFromPercentBands(
  fullScore: number,
  percentBands: Partial<Record<ReportScoreLetterGrade, number>>,
): Partial<Record<ReportScoreLetterGrade, number>> {
  const fs = fullScore > 0 ? fullScore : DEFAULT_EXAM_GRADE_FULL_SCORE;
  const out: Partial<Record<ReportScoreLetterGrade, number>> = {};
  for (const [g, pct] of Object.entries(percentBands)) {
    if (!isReportScoreLetterGrade(g)) continue;
    const p = Number(pct);
    if (!Number.isFinite(p) || p < 0) continue;
    if (p === 0 && g !== 'U') continue;
    out[g] = Math.round(((fs * p) / 100) * 100) / 100;
  }
  return out;
}

/**
 * 校验已配置等第：沿 A+→…→U，后一等第的下限不得高于前一等第。
 * @param asPercent 为 true 时表示校验的是得分率（%）
 * @returns 错误文案；通过则 null
 */
export function validateConfiguredScoreGradeMinOrder(
  configured: Partial<Record<string, number>>,
  isZh = true,
  asPercent = false,
): string | null {
  const ordered = REPORT_SCORE_LETTER_GRADES.filter(
    (g) => configured[g] != null && Number.isFinite(configured[g]),
  );
  if (ordered.length === 0) {
    return isZh
      ? asPercent
        ? '请至少填写一个等第的得分率。'
        : '请至少填写一个等第的分数下限。'
      : asPercent
        ? 'Configure at least one grade percent threshold.'
        : 'Configure at least one grade minimum score.';
  }
  for (let i = 1; i < ordered.length; i++) {
    const better = ordered[i - 1];
    const worse = ordered[i];
    const prev = configured[better] as number;
    const curr = configured[worse] as number;
    if (curr > prev) {
      return isZh
        ? asPercent
          ? `「${worse}」的得分率（${curr}%）不能高于「${better}」的得分率（${prev}%）。`
          : `「${worse}」的下限（${curr}）不能高于「${better}」的下限（${prev}）。`
        : asPercent
          ? `${worse} percent (${curr}%) cannot be greater than ${better} percent (${prev}%).`
          : `${worse} min (${curr}) cannot be greater than ${better} min (${prev}).`;
    }
    if (asPercent && curr > 100) {
      return isZh
        ? `「${worse}」的得分率（${curr}%）不能超过 100%。`
        : `${worse} percent (${curr}%) cannot exceed 100%.`;
    }
  }
  if (asPercent) {
    const top = ordered[0];
    const topVal = configured[top] as number;
    if (topVal > 100) {
      return isZh
        ? `「${top}」的得分率（${topVal}%）不能超过 100%。`
        : `${top} percent (${topVal}%) cannot exceed 100%.`;
    }
  }
  return null;
}

/**
 * 按考试设置中**已填写**的绝对分下限换算；未配置的档位不参与。
 */
export function reportLetterGradeFromExamScore(
  score: number | null | undefined,
  configured: Partial<Record<string, number>> | null | undefined,
): ReportScoreLetterGrade | null {
  if (score == null || Number.isNaN(score) || score < 0) return null;
  const mins = configuredReportScoreGradeMins(configured);
  const grades = REPORT_SCORE_LETTER_GRADES.filter(
    (g): g is ReportScoreLetterGrade => mins[g] != null && Number.isFinite(mins[g]),
  );
  if (grades.length === 0) return null;
  grades.sort((a, b) => (mins[b] as number) - (mins[a] as number));
  for (const g of grades) {
    if (score >= (mins[g] as number)) return g;
  }
  return null;
}

/**
 * 按总分与得分率（%）换算等第：得分 ≥ 总分×(得分率/100) 即落入该档。
 */
export function reportLetterGradeFromExamPercentBands(
  score: number | null | undefined,
  fullScore: number | null | undefined,
  percentBands: Partial<Record<string, number>> | null | undefined,
): ReportScoreLetterGrade | null {
  const fs = examFullScoreFromGradeConfig(fullScore, percentBands);
  const percents = configuredReportScoreGradeMins(percentBands);
  const absolutes = absoluteMinScoresFromPercentBands(fs, percents);
  return reportLetterGradeFromExamScore(score, absolutes);
}

/**
 * 按「得分下限（含）」从高到低匹配第一个满足的等第（合并默认值，用于模板默认档）。
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
  if (grade === 'U') return 'D';
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
