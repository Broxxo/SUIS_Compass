import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CourseDomainsConfig } from "@repo/shared"
import { sortCoursesLikeCourseSettings } from "@repo/shared"
import type { Course, SubjectCategory } from "../types"
import { Language } from "../types/language"
import { KEY_CONCEPTS_OPTIONS } from "./constants"
import { loadCourseDomainsSync, loadKeyConceptsSync } from "./storage"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 获取课程类别的显示文本（根据当前语言）
 * @param subjectCategory 课程类别（可能是对象或字符串，向后兼容）
 * @param language 当前语言
 * @returns 显示文本
 */
export function getSubjectCategoryText(subjectCategory: SubjectCategory | string | undefined, language: Language): string {
  if (!subjectCategory) {
    return '';
  }
  
  // 如果是对象类型（新格式）
  if (typeof subjectCategory === 'object' && 'zh' in subjectCategory && 'en' in subjectCategory) {
    return language === 'zh' ? subjectCategory.zh : subjectCategory.en;
  }
  
  // 如果是字符串类型（旧格式，向后兼容）
  return subjectCategory;
}

/**
 * 获取课程类别的规范键（用于排序等，语言无关；优先使用 zh）
 */
export function getCategoryCanonicalKey(subjectCategory: SubjectCategory | string | undefined): string {
  if (!subjectCategory) return '';
  if (typeof subjectCategory === 'object' && 'zh' in subjectCategory) return subjectCategory.zh;
  return String(subjectCategory);
}

/** 从「语文－语文－人教版」类合成名取首段，避免把版本号整串用作展示 */
function firstSegmentOfCompoundCourseName(name: string): string {
  const t = (name || '').trim();
  if (!t) return '';
  const parts = t.split(/[－\-–—]/u).map((s) => s.trim()).filter(Boolean);
  return parts[0] ?? t;
}

function parseCourseCategoryZhEn(course: Course): { zh: string; en: string } {
  let zh = '';
  let en = '';
  const sc = course.subjectCategory;
  if (sc && typeof sc === 'object' && 'zh' in sc) {
    zh = (sc.zh ?? '').trim();
    en = (sc.en ?? '').trim();
  } else if (typeof sc === 'string') {
    zh = sc.trim();
  }
  return { zh, en };
}

/**
 * 课程下拉等：双语「中文 英文」，例如「语文 Chinese」；仅有中文时只显示中文。
 */
export function formatCourseBilingualDisplayName(course: Course): string {
  const { zh, en } = parseCourseCategoryZhEn(course);
  const fb = firstSegmentOfCompoundCourseName(course.name);
  const nameTrim = (course.name || '').trim();
  const zhOut = zh || fb || nameTrim;
  const enOut = en;
  if (zhOut && enOut && zhOut !== enOut) {
    return `${zhOut} ${enOut}`;
  }
  return zhOut || enOut;
}

/**
 * 与后台课程设置 / Hub 课程河流整体视图一致：
 * 先按领域顺序（领域内按 courseIds），再按 categoryOrder 排列未归属领域的学科列。
 */
export function sortCoursesLikeCurriculumRoadmap(
  courses: Course[],
  categoryOrder: string[],
  domainsConfig: CourseDomainsConfig = loadCourseDomainsSync(),
): Course[] {
  return sortCoursesLikeCourseSettings(courses, categoryOrder, domainsConfig);
}

/**
 * 获取关键概念列表（从存储中读取，如果没有则使用默认值）
 */
export function getKeyConcepts(): string[] {
  const loaded = loadKeyConceptsSync();
  return loaded.length > 0 ? loaded : KEY_CONCEPTS_OPTIONS;
}
