import type { GradeConfig, GradeConfigItem, GradeConfigSegment } from './types.js';

/** 解析学年名称中的起止年份，如「2025-2026」「2025–2026」 */
export function parseAcademicYearSpan(name: string): { start: number; end: number } | null {
  const m = String(name ?? '').trim().match(/(\d{4})\s*[-–—/]\s*(\d{4})/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

/** 由当前学年名称推导下一学年名称，如 2025-2026 → 2026-2027 */
export function suggestNextAcademicYearName(currentName: string): string {
  const span = parseAcademicYearSpan(currentName);
  if (span) return `${span.start + 1}-${span.end + 1}`;
  const year = new Date().getFullYear();
  return `${year}-${year + 1}`;
}

export function bumpIsoDateByYears(iso: string | null | undefined, years = 1): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** 与前后端 gradeConfig.getGradeCatalogIdForClass 对齐 */
export function getGradeCatalogIdForClass(
  config: GradeConfig,
  classGrade: number,
  opts?: { className?: string; division?: string | null },
): string {
  const name = String(opts?.className ?? '').trim().toUpperCase();
  const div = String(opts?.division ?? '').trim().toUpperCase();
  if (name === 'S9A' || div === 'G9I') {
    const hit = config.items.find((i) => i.label === 'G9I');
    if (hit) return hit.id;
  }
  if (name === 'S9B' || div === 'G9C') {
    const hit = config.items.find((i) => i.label === 'G9C');
    if (hit) return hit.id;
  }
  return getGradeIdByLevel(config, classGrade);
}

/** 各学段最高年级 level（无学段时全校一个「虚拟学段」） */
export function getSegmentGraduationLevels(config: GradeConfig): Array<{
  segmentId: string | null;
  segmentLabel: string;
  maxLevel: number;
  catalogIds: string[];
}> {
  const itemById = new Map(config.items.map((it) => [it.id, it]));
  const segments = config.segments?.filter((s) => s.gradeIds.length > 0);
  if (!segments?.length) {
    const maxLevel = Math.max(...config.items.map((it) => it.level), 0);
    return [
      {
        segmentId: null,
        segmentLabel: '全校',
        maxLevel,
        catalogIds: config.items.filter((it) => it.level === maxLevel).map((it) => it.id),
      },
    ];
  }
  return segments.map((seg) => {
    const levels = seg.gradeIds
      .map((id) => itemById.get(id)?.level)
      .filter((lv): lv is number => typeof lv === 'number');
    const maxLevel = levels.length ? Math.max(...levels) : 0;
    const catalogIds = seg.gradeIds.filter((id) => itemById.get(id)?.level === maxLevel);
    return {
      segmentId: seg.id,
      segmentLabel: seg.label,
      maxLevel,
      catalogIds,
    };
  });
}

export function getSchoolSegmentForCatalog(config: GradeConfig, catalogId: string): GradeConfigSegment | null {
  const segs = config.segments;
  if (!segs?.length) return null;
  return segs.find((s) => s.gradeIds.includes(catalogId)) ?? null;
}

/** 班级是否处于所属学段的毕业年级 */
export function isGraduatingClass(
  config: GradeConfig,
  cls: { grade: number; name: string },
): { graduating: boolean; segmentLabel: string; catalogId: string } {
  const catalogId = getGradeCatalogIdForClass(config, cls.grade, { className: cls.name });
  const level = getGradeLevelById(config, catalogId);
  const graduations = getSegmentGraduationLevels(config);
  const segment = getSchoolSegmentForCatalog(config, catalogId);
  const hit = graduations.find((g) =>
    segment ? g.segmentId === segment.id : g.segmentId === null,
  );
  if (!hit || level !== hit.maxLevel) {
    return { graduating: false, segmentLabel: '', catalogId };
  }
  return { graduating: true, segmentLabel: hit.segmentLabel, catalogId };
}

export function graduateArchiveLabel(segmentLabel: string, isZh = true): string {
  const label = String(segmentLabel ?? '').trim() || (isZh ? '全校' : 'School');
  return isZh ? `${label}毕业生` : `${label} graduates`;
}

/** 升班后班名：学段字母前缀后的年级数字 +1（P1A→P2A、S7A→S8A）；其他格式回退为年级 label 替换 */
export function bumpClassNameForPromotion(
  className: string,
  fromLevel: number,
  toLevel: number,
  config: GradeConfig,
): string {
  const trimmed = String(className ?? '').trim();
  if (!trimmed) return className;

  const psMatch = trimmed.match(/^([PS])(\d+)(.*)$/i);
  if (psMatch) {
    const prefix = psMatch[1].toUpperCase();
    const gradeNum = Number(psMatch[2]);
    const suffix = psMatch[3];
    if (Number.isFinite(gradeNum)) {
      return `${prefix}${gradeNum + 1}${suffix}`;
    }
  }

  const fromLabel = getGradeLabelByLevel(config, fromLevel);
  const toLabel = getGradeLabelByLevel(config, toLevel);
  if (!fromLabel || !toLabel || fromLabel === toLabel) return className;
  const re = new RegExp(escapeRegExp(fromLabel), 'i');
  if (re.test(trimmed)) return trimmed.replace(re, toLabel);
  return className;
}
