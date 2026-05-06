import type { Course, GradeConfig, GradeConfigItem } from '../types';
import { DEFAULT_GRADE_CONFIG } from './constants';
import { getGradeIdByLevel, normalizeGradeConfig } from './gradeConfig';

/** 整体视图 Tab：课程是否至少覆盖一个可见年级（与 applicableGrades 规范化一致） */
export function courseVisibleInRoadmapTab(
  course: Course,
  visibleLevels: number[],
  gradeConfig?: GradeConfig,
): boolean {
  if (visibleLevels.length === 0) return false;
  const norm = normalizeGradeConfig(gradeConfig ?? DEFAULT_GRADE_CONFIG);
  const applicable = new Set(getApplicableGrades(course));
  return visibleLevels.some((lv) => applicable.has(getGradeIdByLevel(norm, lv)));
}

/** 单年级周课时上限（节/周） */
export const MAX_WEEKLY_PERIODS_PER_GRADE = 99;
/** 下限 0.5：支持单双周隔周一节等 */
export const MIN_WEEKLY_PERIODS_PER_GRADE = 0.5;
/** 周课时仅允许 0.5 的倍数（如 1、1.5、2） */
export const WEEKLY_PERIODS_STEP = 0.5;

/** 将原始值限制在合法范围并对齐到 0.5 节 */
export function normalizeWeeklyPeriodsValue(raw: number): number {
  if (!Number.isFinite(raw)) return 2;
  const clamped = Math.max(
    MIN_WEEKLY_PERIODS_PER_GRADE,
    Math.min(MAX_WEEKLY_PERIODS_PER_GRADE, raw),
  );
  const stepped = Math.round(clamped / WEEKLY_PERIODS_STEP) * WEEKLY_PERIODS_STEP;
  return Math.round(stepped * 100) / 100;
}

/** 规范化并返回去重后的开设年级 id */
export function getApplicableGrades(course: Course): string[] {
  const raw = course.applicableGrades;
  if (!raw || !Array.isArray(raw)) return [];
  const set = new Set<string>();
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      const s = item.trim();
      const n = Number(s);
      if (Number.isFinite(n) && n >= 1 && n <= 20) {
        set.add(`g${Math.round(n)}`);
      } else {
        set.add(s);
      }
      continue;
    }
    const n = typeof item === 'number' ? item : parseInt(String(item), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 20) {
      set.add(`g${Math.round(n)}`);
    }
  }
  return Array.from(set);
}

export function getGradeItems(config?: GradeConfig): GradeConfigItem[] {
  return normalizeGradeConfig(config ?? DEFAULT_GRADE_CONFIG).items;
}

/** 该年级是否开设此课程 */
export function courseAppliesToGrade(course: Course, gradeLevel: number, gradeConfig?: GradeConfig): boolean {
  const id = getGradeIdByLevel(normalizeGradeConfig(gradeConfig ?? DEFAULT_GRADE_CONFIG), gradeLevel);
  return getApplicableGrades(course).includes(id);
}

/** 某年级周课时（缺省为 2） */
export function getWeeklyPeriodsForGrade(course: Course, gradeLevel: number, gradeConfig?: GradeConfig): number {
  const key = getGradeIdByLevel(normalizeGradeConfig(gradeConfig ?? DEFAULT_GRADE_CONFIG), gradeLevel);
  const v = course.weeklyPeriodsByGrade?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) {
    return normalizeWeeklyPeriodsValue(v);
  }
  return 2;
}

export function emptyCourseGradeFields(): {
  applicableGrades: string[];
  weeklyPeriodsByGrade: Record<string, number>;
} {
  return { applicableGrades: [], weeklyPeriodsByGrade: {} };
}

/** 勾选年级时合并默认课时 */
export function toggleGradeSelection(
  applicableGrades: string[],
  weeklyPeriodsByGrade: Record<string, number>,
  gradeId: string,
  defaultPeriods = 2,
): { applicableGrades: string[]; weeklyPeriodsByGrade: Record<string, number> } {
  const key = gradeId;
  const set = new Set(applicableGrades);
  const nextPeriods = { ...weeklyPeriodsByGrade };
  if (set.has(gradeId)) {
    set.delete(gradeId);
    delete nextPeriods[key];
  } else {
    set.add(gradeId);
    if (nextPeriods[key] === undefined) {
      nextPeriods[key] = defaultPeriods;
    }
  }
  return {
    applicableGrades: Array.from(set),
    weeklyPeriodsByGrade: nextPeriods,
  };
}

/**
 * 拖拽连续区间：将 [start,end] 内所有年级并入当前选择；新区年级写入默认周课时。
 */
export function mergeGradeRangeIntoSelection(
  applicableGrades: string[],
  weeklyPeriodsByGrade: Record<string, number>,
  start: number,
  end: number,
  gradeItems: GradeConfigItem[],
  defaultPeriods = 2,
): { applicableGrades: string[]; weeklyPeriodsByGrade: Record<string, number> } {
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const range = gradeItems
    .filter((item) => item.level >= low && item.level <= high)
    .map((item) => item.id);
  const set = new Set([...applicableGrades, ...range]);
  const nextPeriods = { ...weeklyPeriodsByGrade };
  for (const key of range) {
    if (nextPeriods[key] === undefined) {
      nextPeriods[key] = defaultPeriods;
    }
  }
  return {
    applicableGrades: Array.from(set),
    weeklyPeriodsByGrade: nextPeriods,
  };
}

export function setPeriodForGrade(
  weeklyPeriodsByGrade: Record<string, number>,
  gradeId: string,
  periods: number,
): Record<string, number> {
  const key = gradeId;
  const n = normalizeWeeklyPeriodsValue(periods);
  return { ...weeklyPeriodsByGrade, [key]: n };
}
