/** 教研共同体：职能岗位「学科组长」的配置单元，与课程岗位任课列无必然一一对应 */
export type TeachingResearchGroup = {
  id: string;
  labelZh: string;
  labelEn: string;
  scopeNoteZh?: string;
  scopeNoteEn?: string;
  sortOrder?: number;
};

export const DEFAULT_TEACHING_RESEARCH_GROUPS: TeachingResearchGroup[] = [
  {
    id: 'chinese',
    labelZh: '语文组',
    labelEn: 'Chinese',
    scopeNoteZh: '小学、初中语文',
    scopeNoteEn: 'Primary & middle school Chinese',
    sortOrder: 10,
  },
  {
    id: 'math',
    labelZh: '数学组',
    labelEn: 'Mathematics',
    scopeNoteZh: '小学、初中数学',
    scopeNoteEn: 'Primary & middle school mathematics',
    sortOrder: 20,
  },
  {
    id: 'english',
    labelZh: '英语组',
    labelEn: 'English',
    scopeNoteZh: '小学、初中英语',
    scopeNoteEn: 'Primary & middle school English',
    sortOrder: 30,
  },
  {
    id: 'arts-pe',
    labelZh: '艺体组',
    labelEn: 'Arts & PE',
    scopeNoteZh: '音乐、美术、体育（小初一体）',
    scopeNoteEn: 'Music, art & PE (primary & middle integrated)',
    sortOrder: 40,
  },
  {
    id: 'integrated-science',
    labelZh: '理综组',
    labelEn: 'Integrated sciences',
    scopeNoteZh: '初中物理、化学、生物',
    scopeNoteEn: 'Middle school physics, chemistry & biology',
    sortOrder: 50,
  },
  {
    id: 'general',
    labelZh: '综合组',
    labelEn: 'General subjects',
    scopeNoteZh: '小学科学、信息等单师或跨科教研',
    scopeNoteEn: 'Primary science, IT & other small cross-subject teams',
    sortOrder: 60,
  },
];

function normalizeOne(raw: unknown, index: number): TeachingResearchGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? '').trim();
  const labelZh = String(rec.labelZh ?? rec.label ?? '').trim();
  const labelEn = String(rec.labelEn ?? rec.label ?? labelZh).trim();
  if (!id || !labelZh) return null;
  const scopeNoteZh =
    typeof rec.scopeNoteZh === 'string' ? rec.scopeNoteZh.trim() || undefined : undefined;
  const scopeNoteEn =
    typeof rec.scopeNoteEn === 'string' ? rec.scopeNoteEn.trim() || undefined : undefined;
  const sortOrderRaw = rec.sortOrder;
  const sortOrder =
    typeof sortOrderRaw === 'number' && Number.isFinite(sortOrderRaw)
      ? Math.round(sortOrderRaw)
      : (index + 1) * 10;
  return { id, labelZh, labelEn: labelEn || labelZh, scopeNoteZh, scopeNoteEn, sortOrder };
}

/** 校验并去重；空数组时回退默认教研共同体列表 */
export function normalizeTeachingResearchGroups(input: unknown): TeachingResearchGroup[] {
  if (!Array.isArray(input) || input.length === 0) {
    return DEFAULT_TEACHING_RESEARCH_GROUPS.map((g) => ({ ...g }));
  }
  const seen = new Set<string>();
  const out: TeachingResearchGroup[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const row = normalizeOne(input[i], i);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  if (out.length === 0) return DEFAULT_TEACHING_RESEARCH_GROUPS.map((g) => ({ ...g }));
  out.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.labelZh.localeCompare(b.labelZh));
  return out;
}
