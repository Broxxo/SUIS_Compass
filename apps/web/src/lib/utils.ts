import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Course, SubjectCategory } from "../types"
import { Language } from "../types/language"
import { KEY_CONCEPTS_OPTIONS } from "./constants"
import { loadKeyConceptsSync } from "./storage"

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

/**
 * 与课程管理 / 课程河流「整体视图」列顺序一致：先按 categoryOrder 中的学科键，
 * 再补上未出现在顺序里的类别；同一类别内保持当前 courses 数组中的先后。
 */
export function sortCoursesLikeCurriculumRoadmap(courses: Course[], categoryOrder: string[]): Course[] {
  const grouped: Record<string, Course[]> = {};
  courses.forEach((c) => {
    const canonical = getCategoryCanonicalKey(c.subjectCategory) || c.name;
    if (!grouped[canonical]) grouped[canonical] = [];
    grouped[canonical].push(c);
  });
  const orderedKeys = categoryOrder.filter((k) => grouped[k]?.length);
  const keys: string[] = [...orderedKeys];
  Object.keys(grouped).forEach((k) => {
    if (!keys.includes(k)) keys.push(k);
  });
  const out: Course[] = [];
  for (const k of keys) {
    const list = grouped[k];
    if (list?.length) out.push(...list);
  }
  return out;
}

/**
 * 获取关键概念列表（从存储中读取，如果没有则使用默认值）
 */
export function getKeyConcepts(): string[] {
  const loaded = loadKeyConceptsSync();
  return loaded.length > 0 ? loaded : KEY_CONCEPTS_OPTIONS;
}
