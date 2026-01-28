import { Course } from '../types';
import { COLOR_VALUES, COLOR_GRADIENTS } from './constants';

/**
 * 将 Tailwind 类名转换为 CSS 颜色值
 */
export function getColorValue(tailwindClass: string): string {
  return COLOR_VALUES[tailwindClass] || '#ffffff';
}

/**
 * 获取课程颜色的渐变配置
 */
export function getColorGradient(color: Course['color']) {
  return COLOR_GRADIENTS[color];
}

/**
 * 迁移旧格式的课程数据（向后兼容）
 * 将字符串格式的 subjectCategory 转换为对象格式
 */
export function migrateCourseData(course: Course): Course {
  let subjectCategory = course.subjectCategory;
  
  // 处理向后兼容：如果 subjectCategory 是字符串，转换为对象格式
  if (typeof subjectCategory === 'string') {
    subjectCategory = { zh: subjectCategory, en: subjectCategory };
  } else if (!subjectCategory) {
    subjectCategory = { zh: course.name, en: course.name };
  }
  
  return {
    ...course,
    subjectCategory: subjectCategory,
    gradeRange: course.gradeRange || undefined,
    textbookVersion: course.textbookVersion || '人教版',
    color: course.color || 'light-blue',
    weeklyPeriods: course.weeklyPeriods || 2,
  };
}

/**
 * 迁移课程列表数据
 */
export function migrateCoursesData(courses: Course[]): Course[] {
  return courses.map(migrateCourseData);
}
