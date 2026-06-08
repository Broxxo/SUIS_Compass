export type TargetLevel = 'A' | 'B' | 'C' | 'D';

export type ReportGradeDimensionSnapshot = {
  gradeId: string;
  dimensions: Array<{
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    levelDescriptions?: Partial<Record<TargetLevel, string>>;
  }>;
};

export type ReportTemplateDimensionLike = {
  id?: string;
  dimensionKey: string;
  dimensionLabel: string;
  dimensionLabelZh?: string;
  dimensionLabelEn?: string;
  sortOrder: number;
  levelDescriptions?: Partial<Record<TargetLevel, string>>;
};

function normalizeDimensionKey(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || 'item';
}

export function parseReportGradeDimensionSnapshots(raw: unknown): ReportGradeDimensionSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportGradeDimensionSnapshot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const gradeId = String(rec.gradeId ?? '').trim();
    if (!gradeId) continue;
    const dimsRaw = Array.isArray(rec.dimensions) ? rec.dimensions : [];
    const dimensions: ReportGradeDimensionSnapshot['dimensions'] = [];
    const seen = new Set<string>();
    for (const dimRaw of dimsRaw) {
      if (!dimRaw || typeof dimRaw !== 'object') continue;
      const dim = dimRaw as Record<string, unknown>;
      const dimensionLabelZh = String(dim.dimensionLabelZh ?? '').trim();
      const dimensionLabelEn = String(dim.dimensionLabelEn ?? '').trim();
      if (!dimensionLabelZh && !dimensionLabelEn) continue;
      const key = `${dimensionLabelZh}\u0001${dimensionLabelEn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const levelDescriptions: Partial<Record<TargetLevel, string>> = {};
      if (dim.levelDescriptions && typeof dim.levelDescriptions === 'object') {
        for (const lv of ['A', 'B', 'C', 'D'] as const) {
          const v = String((dim.levelDescriptions as Record<string, unknown>)[lv] ?? '').trim();
          if (v) levelDescriptions[lv] = v;
        }
      }
      dimensions.push({
        dimensionLabelZh: dimensionLabelZh || dimensionLabelEn,
        dimensionLabelEn: dimensionLabelEn || dimensionLabelZh,
        levelDescriptions,
      });
    }
    if (dimensions.length > 0) out.push({ gradeId, dimensions });
  }
  return out;
}

export function buildDimensionRowsFromGradeSnapshot(
  snapshot: ReportGradeDimensionSnapshot['dimensions'],
  subjectKey: string,
  unifiedLevelDescriptions?: Partial<Record<TargetLevel, string>>,
): ReportTemplateDimensionLike[] {
  const usedKeys = new Set<string>();
  const rows: ReportTemplateDimensionLike[] = [];
  for (let i = 0; i < snapshot.length; i += 1) {
    const dim = snapshot[i];
    const dimensionLabelZh = dim.dimensionLabelZh.trim();
    const dimensionLabelEn = dim.dimensionLabelEn.trim();
    const dimensionLabel = dimensionLabelZh || dimensionLabelEn;
    if (!dimensionLabel) continue;
    const baseKey = normalizeDimensionKey(dimensionLabelEn || dimensionLabelZh);
    let dimensionKey = baseKey;
    let seq = 2;
    while (usedKeys.has(dimensionKey)) {
      dimensionKey = `${baseKey}_${seq}`;
      seq += 1;
    }
    usedKeys.add(dimensionKey);
    const levelDescriptions: Partial<Record<TargetLevel, string>> = { ...unifiedLevelDescriptions };
    for (const lv of ['A', 'B', 'C', 'D'] as const) {
      const v = String(dim.levelDescriptions?.[lv] ?? '').trim();
      if (v) levelDescriptions[lv] = v;
    }
    rows.push({
      id: `gd-${subjectKey}-${dimensionKey}`,
      dimensionKey,
      dimensionLabel,
      dimensionLabelZh: dimensionLabelZh || dimensionLabel,
      dimensionLabelEn: dimensionLabelEn || dimensionLabel,
      sortOrder: i,
      levelDescriptions,
    });
  }
  return rows;
}

/** 按班年级从学期报告学科快照（或旧版扁平 dimensions）解析评价维度列。 */
export function resolveTemplateDimensionsForGrade(
  subject: {
    subjectKey?: string;
    dimensions?: ReportTemplateDimensionLike[];
    gradeDimensions?: ReportGradeDimensionSnapshot[];
  },
  gradeCatalogId: string | null,
  unifiedLevelDescriptions?: Partial<Record<TargetLevel, string>>,
): ReportTemplateDimensionLike[] {
  const gid = String(gradeCatalogId ?? '').trim();
  const sk = String(subject.subjectKey ?? '').trim();
  if (gid && subject.gradeDimensions?.length) {
    const row = subject.gradeDimensions.find((g) => String(g.gradeId ?? '').trim() === gid);
    if (row?.dimensions?.length) {
      return buildDimensionRowsFromGradeSnapshot(row.dimensions, sk, unifiedLevelDescriptions);
    }
    return [];
  }
  return subject.dimensions ?? [];
}
