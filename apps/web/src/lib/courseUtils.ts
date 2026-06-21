import { courseColorOrDefault } from '@repo/shared';
import { Course } from '../types';
import { COLOR_VALUES, COLOR_GRADIENTS } from './constants';
import { getApplicableGrades, normalizeWeeklyPeriodsValue } from './courseGradeUtils';

/**
 * 将 Tailwind 类名转换为 CSS 颜色值
 */
export function getColorValue(token: string): string {
  if (token.startsWith('#')) return token;
  return COLOR_VALUES[token] || '#ffffff';
}

/**
 * 获取课程颜色的渐变配置
 */
export function getColorGradient(color: Course['color']) {
  return COLOR_GRADIENTS[color];
}

/** 课程标签/表头：平铺深色底 + 轻阴影（与河流平行四边形、单元视图左侧课程条一致） */
export function getCourseTagChrome(color: Course['color']): {
  backgroundColor: string;
  boxShadow: string;
  labelTextShadow: string;
} {
  const { dark } = getColorGradient(color);
  return {
    backgroundColor: dark,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.18)',
    labelTextShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
  };
}

/**
 * 规范化课程数据（学科格式、年级与周课时字段）
 */
export function migrateCourseData(course: Course): Course {
  let subjectCategory = course.subjectCategory;

  if (typeof subjectCategory === 'string') {
    subjectCategory = { zh: subjectCategory, en: subjectCategory };
  } else if (!subjectCategory) {
    subjectCategory = { zh: course.name, en: course.name };
  }

  const applicableGrades = getApplicableGrades(course);
  const weeklyPeriodsByGrade =
    course.weeklyPeriodsByGrade && typeof course.weeklyPeriodsByGrade === 'object'
      ? { ...course.weeklyPeriodsByGrade }
      : {};
  // 兼容旧数据：weeklyPeriodsByGrade 用数字字符串键时，补一份 g{n} 键
  Object.entries({ ...weeklyPeriodsByGrade }).forEach(([k, v]) => {
    const n = Number(k);
    if (Number.isFinite(n) && weeklyPeriodsByGrade[`g${Math.round(n)}`] === undefined) {
      weeklyPeriodsByGrade[`g${Math.round(n)}`] = v;
    }
  });
  Object.keys(weeklyPeriodsByGrade).forEach((k) => {
    const v = weeklyPeriodsByGrade[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      weeklyPeriodsByGrade[k] = normalizeWeeklyPeriodsValue(v);
    }
  });

  return {
    ...course,
    subjectCategory,
    applicableGrades,
    weeklyPeriodsByGrade,
    coTeaching: Boolean(course.coTeaching),
    excludeFromStaffing: Boolean(course.excludeFromStaffing),
    textbookVersion: course.textbookVersion || '人教版',
    color: courseColorOrDefault(course.color),
  };
}

/**
 * 迁移课程列表数据
 */
export function migrateCoursesData(courses: Course[]): Course[] {
  return courses.map(migrateCourseData);
}
