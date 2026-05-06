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
