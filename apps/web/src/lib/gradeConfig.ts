import type { GradeConfig, GradeConfigItem, GradeConfigSegment } from '../types';
import { DEFAULT_GRADE_CONFIG } from './constants';

/** 整体视图「全学段」Tab 的固定 id（不与学段 id 冲突） */
export const ROADMAP_OVERVIEW_TAB_ALL = '__all_stages__';

function normalizeSegments(
  rawSegments: unknown,
  itemById: Map<string, GradeConfigItem>,
): GradeConfigSegment[] | undefined {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return undefined;
  const usedGradeIds = new Set<string>();
  const out: GradeConfigSegment[] = [];
  for (const seg of rawSegments) {
    if (!seg || typeof seg !== 'object') continue;
    const rec = seg as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const label = String(rec.label ?? '').trim();
    if (!id || !label) continue;
    const rawIds = Array.isArray(rec.gradeIds) ? rec.gradeIds : [];
    const gradeIds: string[] = [];
    for (const g of rawIds) {
      const gid = String(g ?? '').trim();
      if (!gid || !itemById.has(gid) || usedGradeIds.has(gid)) continue;
      usedGradeIds.add(gid);
      gradeIds.push(gid);
    }
    out.push({ id, label, gradeIds });
  }
  if (out.length === 0) return undefined;
  const cleaned = out.filter((s) => s.gradeIds.length > 0);
  if (cleaned.length === 0) return undefined;
  const used = new Set(cleaned.flatMap((s) => s.gradeIds));
  const allIds = new Set(itemById.keys());
  for (const id of allIds) {
    if (!used.has(id)) {
      const last = cleaned[cleaned.length - 1];
      last.gradeIds.push(id);
      used.add(id);
    }
  }
  return cleaned;
}

export function normalizeGradeConfig(input: unknown): GradeConfig {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { items?: unknown }).items)) {
    return DEFAULT_GRADE_CONFIG;
  }
  const rawItems = (input as { items: unknown[] }).items;
  const seen = new Set<string>();
  const items: GradeConfigItem[] = [];
  rawItems.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const label = String(rec.label ?? '').trim();
    const level = Number(rec.level);
    if (!id || !label || !Number.isFinite(level)) return;
    const lv = Math.round(level);
    if (lv < 1 || lv > 20) return;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({ id, label, level: lv });
  });
  if (items.length === 0) return DEFAULT_GRADE_CONFIG;
  items.sort((a, b) => a.level - b.level);
  const itemById = new Map(items.map((it) => [it.id, it]));
  const rawSeg = (input as { segments?: unknown }).segments;
  const segments = normalizeSegments(rawSeg, itemById);
  return segments ? { items, segments } : { items };
}

/** 配置了学段时在整体类下显示各学段 Tab（低年级段在前，按学段内最低年级 level 排序） */
export function gradeConfigHasSegments(config: GradeConfig): boolean {
  const s = normalizeGradeConfig(config).segments;
  return Array.isArray(s) && s.length >= 1;
}

/** 学段 Tab 显示顺序：按各学段所含年级的最低 level 升序 */
export function getRoadmapSegmentsInDisplayOrder(config: GradeConfig): GradeConfigSegment[] {
  const norm = normalizeGradeConfig(config);
  const segs = norm.segments;
  if (!segs?.length) return [];
  const byId = new Map(norm.items.map((it) => [it.id, it]));
  const minLevel = (seg: GradeConfigSegment) => {
    let m = 99;
    for (const id of seg.gradeIds) {
      const lv = byId.get(id)?.level;
      if (typeof lv === 'number' && lv < m) m = lv;
    }
    return m;
  };
  return [...segs].sort((a, b) => minLevel(a) - minLevel(b));
}

/** 当前 Tab 下要展示的年级 level 列表（顺序与学段内年级顺序或全局 items 一致） */
export function getRoadmapVisibleGradeLevels(
  config: GradeConfig,
  tabId: string,
): number[] {
  const norm = normalizeGradeConfig(config);
  if (tabId === ROADMAP_OVERVIEW_TAB_ALL || !norm.segments?.length) {
    return norm.items.map((it) => it.level);
  }
  const seg = norm.segments.find((s) => s.id === tabId);
  if (!seg) return norm.items.map((it) => it.level);
  const byId = new Map(norm.items.map((it) => [it.id, it]));
  return seg.gradeIds.map((id) => byId.get(id)?.level).filter((lv): lv is number => typeof lv === 'number');
}

export function getGradeIds(config: GradeConfig): string[] {
  return config.items.map((item) => item.id);
}

/** 学段所含年级 catalog id；无学段配置或找不到学段时退回全部年级 id（避免考试学科判定失败） */
export function getSegmentGradeIds(config: GradeConfig, segmentId: string): string[] {
  const norm = normalizeGradeConfig(config);
  const seg = norm.segments?.find((s) => s.id === segmentId);
  if (seg?.gradeIds?.length) return [...seg.gradeIds];
  if (norm.segments?.length) return [];
  return norm.items.map((item) => item.id);
}

export function getGradeLevels(config: GradeConfig): number[] {
  return config.items.map((item) => item.level);
}

export function getGradeItemByLevel(config: GradeConfig, level: number): GradeConfigItem | undefined {
  return config.items.find((item) => item.level === level);
}

export function getGradeItemById(config: GradeConfig, id: string): GradeConfigItem | undefined {
  return config.items.find((item) => item.id === id);
}

export function getGradeIdByLevel(config: GradeConfig, level: number): string {
  return getGradeItemByLevel(config, level)?.id ?? `g${level}`;
}

export function getGradeLevelById(config: GradeConfig, id: string): number {
  return getGradeItemById(config, id)?.level ?? (Number(String(id).replace(/\D/g, '')) || 1);
}

export function getGradeLabelByLevel(config: GradeConfig, level: number): string {
  return getGradeItemByLevel(config, level)?.label ?? `G${level}`;
}

/** G9 国际/课程分班：班名或学部与年级设置 catalog 对齐 */
export function getGradeCatalogIdForClass(
  config: GradeConfig,
  classGrade: number,
  opts?: { className?: string; division?: string | null },
): string {
  const norm = normalizeGradeConfig(config);
  const name = String(opts?.className ?? '').trim().toUpperCase();
  const div = String(opts?.division ?? '').trim().toUpperCase();
  if (name === 'S9A' || div === 'G9I') {
    const hit = norm.items.find((i) => i.label === 'G9I');
    if (hit) return hit.id;
  }
  if (name === 'S9B' || div === 'G9C') {
    const hit = norm.items.find((i) => i.label === 'G9C');
    if (hit) return hit.id;
  }
  return getGradeIdByLevel(config, classGrade);
}

/** 班级名义年级标签（G7、G8、G9…），与 classes.grade 一致 */
export function getSchoolGradeLabelForClass(cls: { grade: number }): string {
  return `G${cls.grade}`;
}

/** 课程/排课用 catalog level（G9I 与 G9C 可同为 grade 9 但 level 不同） */
export function getCurriculumGradeLevelForClass(
  config: GradeConfig,
  cls: { grade: number; name: string },
  opts?: { division?: string | null },
): number {
  const catalogId = getGradeCatalogIdForClass(config, cls.grade, {
    className: cls.name,
    division: opts?.division,
  });
  return getGradeLevelById(config, catalogId);
}

/** G9 等分轨年级：9I / 9C；无分轨时返回 null */
export function getCurriculumTrackLabelForClass(
  config: GradeConfig,
  cls: { grade: number; name: string },
  opts?: { division?: string | null },
): string | null {
  const catalogId = getGradeCatalogIdForClass(config, cls.grade, {
    className: cls.name,
    division: opts?.division,
  });
  const catalogLabel = getGradeItemById(config, catalogId)?.label;
  if (!catalogLabel) return null;
  const schoolLabel = getSchoolGradeLabelForClass(cls);
  if (catalogLabel === schoolLabel) return null;
  if (catalogLabel === 'G9I') return '9I';
  if (catalogLabel === 'G9C') return '9C';
  if (catalogLabel.startsWith(schoolLabel)) {
    return catalogLabel.slice(schoolLabel.length) || null;
  }
  return catalogLabel.replace(/^G/, '') || null;
}

export function getGradeLabelForClass(
  config: GradeConfig,
  cls: { grade: number; name: string },
  opts?: { division?: string | null },
): string {
  const track = getCurriculumTrackLabelForClass(config, cls, opts);
  if (track) return `${getSchoolGradeLabelForClass(cls)} · ${track}`;
  return getSchoolGradeLabelForClass(cls);
}

export type GradeCatalogClassGroup<T extends { grade: number; name: string }> = {
  catalogId: string;
  label: string;
  sortLevel: number;
  classes: T[];
};

/** 岗位安排等：按课程设置 catalog 分组（G9I / G9C 分行） */
export function groupClassesByGradeCatalog<T extends { grade: number; name: string }>(
  config: GradeConfig,
  classes: T[],
): Array<GradeCatalogClassGroup<T>> {
  const map = new Map<string, GradeCatalogClassGroup<T>>();
  for (const c of classes) {
    const catalogId = getGradeCatalogIdForClass(config, c.grade, { className: c.name });
    const item = getGradeItemById(config, catalogId);
    const existing = map.get(catalogId);
    if (existing) {
      existing.classes.push(c);
    } else {
      map.set(catalogId, {
        catalogId,
        label: item?.label ?? `G${c.grade}`,
        sortLevel: item?.level ?? c.grade,
        classes: [c],
      });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => a.sortLevel - b.sortLevel || a.label.localeCompare(b.label))
    .map((g) => ({
      ...g,
      classes: g.classes.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
}

export type ClassManagementTrackGroup<T extends { grade: number; name: string }> = {
  trackKey: string;
  trackLabel: string;
  classes: T[];
};

export type ClassManagementGradeSection<T extends { grade: number; name: string }> = {
  sectionKey: string;
  parentLabel: string;
  sortLevel: number;
  /** 同名义年级下按课程轨分块（如 G9 下 9I / 9C） */
  tracks: Array<ClassManagementTrackGroup<T>> | null;
  classList: T[];
};

const TRACK_SORT: Record<string, number> = { '9I': 0, '9C': 1 };

function sortClassNames<T extends { name: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** 班级列表：先按名义年级 G9 聚合，再按 9I / 9C 分轨 */
export function groupClassesForClassManagement<T extends { grade: number; name: string }>(
  config: GradeConfig,
  classes: T[],
): Array<ClassManagementGradeSection<T>> {
  const bySchoolGrade = new Map<number, T[]>();
  for (const c of classes) {
    const bucket = bySchoolGrade.get(c.grade) ?? [];
    bucket.push(c);
    bySchoolGrade.set(c.grade, bucket);
  }
  return Array.from(bySchoolGrade.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([grade, classList]) => {
      const trackMap = new Map<string, ClassManagementTrackGroup<T>>();
      const flat: T[] = [];
      for (const c of classList) {
        const trackLabel = getCurriculumTrackLabelForClass(config, c);
        if (trackLabel) {
          const trackKey = trackLabel;
          const existing = trackMap.get(trackKey);
          if (existing) existing.classes.push(c);
          else trackMap.set(trackKey, { trackKey, trackLabel, classes: [c] });
        } else {
          flat.push(c);
        }
      }
      const tracks =
        trackMap.size > 0
          ? Array.from(trackMap.values())
              .sort(
                (a, b) =>
                  (TRACK_SORT[a.trackLabel] ?? 99) - (TRACK_SORT[b.trackLabel] ?? 99) ||
                  a.trackLabel.localeCompare(b.trackLabel),
              )
              .map((t) => ({ ...t, classes: sortClassNames(t.classes) }))
          : null;
      return {
        sectionKey: `school-g${grade}`,
        parentLabel: `G${grade}`,
        sortLevel: grade,
        tracks,
        classList: sortClassNames(flat),
      };
    });
}

/** 根据学生年级 level 解析所属学段 id（与课程管理中学段 Tab 一致）；无学段配置时返回 null */
export function getSchoolSegmentIdForStudentGradeLevel(
  config: GradeConfig,
  gradeLevel: number | null | undefined,
): string | null {
  if (gradeLevel == null || !Number.isFinite(gradeLevel)) return null;
  const norm = normalizeGradeConfig(config);
  const lv = Math.round(Number(gradeLevel));
  const gradeItem = norm.items.find((it) => it.level === lv);
  if (!gradeItem) return null;
  const segs = norm.segments;
  if (!segs?.length) return null;
  const found = segs.find((s) => s.gradeIds.includes(gradeItem.id));
  return found?.id ?? null;
}

/** 班级所属学段（按年级 catalog + 班名/学部分配，与岗位安排学段划分一致） */
export function getSchoolSegmentIdForClass(
  config: GradeConfig,
  cls: { grade: number; name: string },
  opts?: { division?: string | null },
): string | null {
  const norm = normalizeGradeConfig(config);
  const segs = norm.segments;
  if (!segs?.length) return null;
  const catalogId = getGradeCatalogIdForClass(config, cls.grade, {
    className: cls.name,
    division: opts?.division,
  });
  return segs.find((s) => s.gradeIds.includes(catalogId))?.id ?? null;
}

/** 按后台学段设置统计学生人数（管理员学校看板「学部分布」） */
export function countStudentsBySchoolSegment(
  config: GradeConfig,
  students: Array<{ id: string; currentGrade?: number | null; division?: string | null }>,
  resolveClass: (studentId: string) => { grade: number; name: string } | null | undefined,
  isZh: boolean,
): Array<{ label: string; count: number }> {
  const norm = normalizeGradeConfig(config);
  const segments = getRoadmapSegmentsInDisplayOrder(norm);
  if (segments.length === 0) {
    const byDivision = new Map<string, number>();
    for (const s of students) {
      const div = (s.division ?? '').trim() || (isZh ? '未设置' : 'Not set');
      byDivision.set(div, (byDivision.get(div) ?? 0) + 1);
    }
    return Array.from(byDivision.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }

  const counts = new Map<string, number>();
  for (const seg of segments) counts.set(seg.id, 0);
  let unassigned = 0;

  for (const s of students) {
    const cls = resolveClass(s.id);
    let segmentId: string | null = null;
    if (cls) {
      segmentId = getSchoolSegmentIdForClass(norm, cls, { division: s.division });
    } else if (s.currentGrade != null && Number.isFinite(s.currentGrade)) {
      const catalogId = getGradeCatalogIdForClass(norm, s.currentGrade, { division: s.division });
      segmentId = segments.find((seg) => seg.gradeIds.includes(catalogId))?.id ?? null;
    }
    if (segmentId && counts.has(segmentId)) {
      counts.set(segmentId, (counts.get(segmentId) ?? 0) + 1);
    } else {
      unassigned += 1;
    }
  }

  const rows = segments.map((seg) => ({ label: seg.label, count: counts.get(seg.id) ?? 0 }));
  if (unassigned > 0) {
    rows.push({ label: isZh ? '未分配学段' : 'Unassigned segment', count: unassigned });
  }
  return rows;
}

/** 班级管理学段筛选：全部班级或指定学段 */
export function filterClassesBySchoolSegment<T extends { grade: number; name: string }>(
  config: GradeConfig,
  classes: T[],
  segmentTabId: string,
): T[] {
  if (!segmentTabId || segmentTabId === ROADMAP_OVERVIEW_TAB_ALL) return classes;
  const norm = normalizeGradeConfig(config);
  const seg = norm.segments?.find((s) => s.id === segmentTabId);
  if (!seg) return classes;
  return classes.filter((cls) => {
    const catalogId = getGradeCatalogIdForClass(config, cls.grade, { className: cls.name });
    return seg.gradeIds.includes(catalogId);
  });
}
