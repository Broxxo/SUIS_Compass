export type TeachingSubjectGroup = {
  id: string;
  nameZh: string;
  nameEn?: string;
  /** 基础设置里配置的学段 id，可多选；空数组表示不按学段筛选（全校） */
  segmentIds: string[];
  /** 课程岗位中的学科显示名（如「数学」「英语」），可多选 */
  subjectKeys: string[];
  sortOrder?: number;
};

function normalizeSegmentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => String(id ?? '').trim()).filter(Boolean))];
}

function normalizeOne(raw: unknown, index: number): TeachingSubjectGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? '').trim();
  const nameZh = String(rec.nameZh ?? rec.labelZh ?? rec.label ?? rec.name ?? '').trim();
  if (!id || !nameZh) return null;
  const nameEn =
    typeof rec.nameEn === 'string' ? rec.nameEn.trim() || undefined : undefined;
  const segmentIds = normalizeSegmentIds(rec.segmentIds);
  const subjectKeys = Array.isArray(rec.subjectKeys)
    ? [...new Set(rec.subjectKeys.map((k) => String(k ?? '').trim()).filter(Boolean))]
    : [];
  const sortOrderRaw = rec.sortOrder;
  const sortOrder =
    typeof sortOrderRaw === 'number' && Number.isFinite(sortOrderRaw)
      ? Math.round(sortOrderRaw)
      : (index + 1) * 10;
  return { id, nameZh, nameEn, segmentIds, subjectKeys, sortOrder };
}

/** 校验并去重；空数组表示尚未建立学科组 */
export function normalizeTeachingSubjectGroups(input: unknown): TeachingSubjectGroup[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: TeachingSubjectGroup[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const row = normalizeOne(input[i], i);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  out.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.nameZh.localeCompare(b.nameZh));
  return out;
}

export function createTeachingSubjectGroupId(): string {
  return `tsg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
