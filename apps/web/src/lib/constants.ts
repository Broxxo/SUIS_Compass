import type { CourseColor } from '@repo/shared';
import {
  COURSE_PALETTE,
  GRADES,
  SEMESTERS,
  GRADE_LABELS,
  SEMESTER_LABELS,
  DEFAULT_GRADE_CONFIG,
  createDefaultGradeConfig,
  KEY_CONCEPTS_OPTIONS as SHARED_KEY_CONCEPTS,
} from '@repo/shared';

export { GRADES, SEMESTERS, GRADE_LABELS, SEMESTER_LABELS };
export { DEFAULT_GRADE_CONFIG, createDefaultGradeConfig };
export const KEY_CONCEPTS_OPTIONS = SHARED_KEY_CONCEPTS;

/** 选课 / 设置弹窗色块（与 @repo/shared COURSE_PALETTE 一致） */
export const COURSE_COLORS: {
  value: CourseColor;
  label: string;
  labelEn: string;
  light: string;
  standard: string;
}[] = COURSE_PALETTE.map((p) => ({
  value: p.id,
  label: p.labelZh,
  labelEn: p.labelEn,
  light: p.hexLight,
  standard: p.hexMedium,
}));

/** 兼容旧代码：tailwind 类名 → hex；若已是 # 开头则原样返回 */
export const COLOR_VALUES: Record<string, string> = Object.fromEntries(
  COURSE_COLORS.flatMap((c) => [
    [c.light, c.light],
    [c.standard, c.standard],
  ]),
);

export const COLOR_GRADIENTS: Record<CourseColor, { light: string; medium: string; dark: string }> =
  Object.fromEntries(
    COURSE_PALETTE.map((p) => [p.id, { light: p.hexLight, medium: p.hexMedium, dark: p.hexDark }]),
  ) as Record<CourseColor, { light: string; medium: string; dark: string }>;

export const STORAGE_KEYS = {
  COURSES: 'curriculum-roadmap-courses',
  SEMESTER_PREFIX: 'semester-data-',
  CATEGORY_ORDER: 'curriculum-roadmap-category-order',
  COURSE_DOMAINS: 'curriculum-roadmap-course-domains',
  KEY_CONCEPTS: 'curriculum-roadmap-key-concepts',
  /** @deprecated 旧 key，读取时自动迁移 */
  GRADE_CONFIG_LEGACY: 'curriculum-roadmap-grade-config',
  SCHOOL_GRADE_STRUCTURE: 'suis-school-grade-structure',
  // 班级管理（1.3）
  ACADEMIC_YEARS: 'class-mgmt-academic-years',
  CURRENT_ACADEMIC_YEAR_ID: 'class-mgmt-current-year-id',
  CLASSES: 'class-mgmt-classes',
  STUDENTS: 'class-mgmt-students',
  ENROLLMENTS: 'class-mgmt-enrollments',
  CLASS_TEACHER_ASSIGNMENTS: 'class-mgmt-class-teacher-assignments',
  // 课堂助手：小组与积分事件（全校共享）
  CLASS_GROUP_SCHEMES: 'class-assistant-group-schemes',
  LAST_SELECTED_CLASS_ID: 'class-assistant-last-selected-class-id',
  CLASS_GROUPS: 'class-assistant-groups',
  CLASS_GROUP_MEMBERS: 'class-assistant-group-members',
  CLASS_POINT_EVENTS: 'class-assistant-point-events',
  // 后台用户管理（本地测试）
  ADMIN_USERS: 'admin-panel-users',
} as const;
