import type { CourseColor } from '@repo/shared';
import {
  GRADES,
  SEMESTERS,
  GRADE_LABELS,
  SEMESTER_LABELS,
  KEY_CONCEPTS_OPTIONS as SHARED_KEY_CONCEPTS,
} from '@repo/shared';

export { GRADES, SEMESTERS, GRADE_LABELS, SEMESTER_LABELS };
export const KEY_CONCEPTS_OPTIONS = SHARED_KEY_CONCEPTS;

// 课程颜色配置
export const COURSE_COLORS: { value: CourseColor; label: string; light: string; standard: string }[] = [
  { value: 'light-blue', label: '淡蓝', light: 'bg-blue-100', standard: 'bg-blue-300' },
  { value: 'light-green', label: '淡绿', light: 'bg-green-100', standard: 'bg-green-300' },
  { value: 'light-yellow', label: '淡黄', light: 'bg-yellow-100', standard: 'bg-yellow-300' },
  { value: 'light-red', label: '淡红', light: 'bg-red-100', standard: 'bg-red-300' },
  { value: 'light-purple', label: '淡紫', light: 'bg-purple-100', standard: 'bg-purple-300' },
  { value: 'light-orange', label: '淡橙', light: 'bg-orange-100', standard: 'bg-orange-300' },
  { value: 'light-cyan', label: '淡青', light: 'bg-cyan-100', standard: 'bg-cyan-300' },
  { value: 'light-pink', label: '淡粉', light: 'bg-pink-100', standard: 'bg-pink-300' },
  { value: 'light-indigo', label: '淡靛', light: 'bg-indigo-100', standard: 'bg-indigo-300' },
];

// 颜色值映射（用于渐变效果）
export const COLOR_VALUES: Record<string, string> = {
  'bg-blue-100': '#dbeafe',
  'bg-blue-300': '#93c5fd',
  'bg-green-100': '#dcfce7',
  'bg-green-300': '#86efac',
  'bg-yellow-100': '#fef9c3',
  'bg-yellow-300': '#fde047',
  'bg-red-100': '#fee2e2',
  'bg-red-300': '#fca5a5',
  'bg-purple-100': '#f3e8ff',
  'bg-purple-300': '#c4b5fd',
  'bg-orange-100': '#ffedd5',
  'bg-orange-300': '#fdba74',
  'bg-cyan-100': '#cffafe',
  'bg-cyan-300': '#67e8f9',
  'bg-pink-100': '#fce7f3',
  'bg-pink-300': '#f9a8d4',
  'bg-indigo-100': '#e0e7ff',
  'bg-indigo-300': '#a5b4fc',
};

// 颜色渐变配置（用于课程河流显示）
export const COLOR_GRADIENTS: Record<CourseColor, { light: string; medium: string; dark: string }> = {
  'light-blue': { light: '#dbeafe', medium: '#93c5fd', dark: '#60a5fa' },
  'light-green': { light: '#dcfce7', medium: '#86efac', dark: '#4ade80' },
  'light-yellow': { light: '#fef9c3', medium: '#fde047', dark: '#facc15' },
  'light-red': { light: '#fee2e2', medium: '#fca5a5', dark: '#f87171' },
  'light-purple': { light: '#f3e8ff', medium: '#c4b5fd', dark: '#a78bfa' },
  'light-orange': { light: '#ffedd5', medium: '#fdba74', dark: '#fb923c' },
  'light-cyan': { light: '#cffafe', medium: '#67e8f9', dark: '#22d3ee' },
  'light-pink': { light: '#fce7f3', medium: '#f9a8d4', dark: '#f472b6' },
  'light-indigo': { light: '#e0e7ff', medium: '#a5b4fc', dark: '#818cf8' },
};

// 存储键常量
export const STORAGE_KEYS = {
  COURSES: 'curriculum-roadmap-courses',
  SEMESTER_PREFIX: 'semester-data-',
  CATEGORY_ORDER: 'curriculum-roadmap-category-order',
  KEY_CONCEPTS: 'curriculum-roadmap-key-concepts',
  // 班级管理（1.3）
  ACADEMIC_YEARS: 'class-mgmt-academic-years',
  CURRENT_ACADEMIC_YEAR_ID: 'class-mgmt-current-year-id',
  CLASSES: 'class-mgmt-classes',
  STUDENTS: 'class-mgmt-students',
  ENROLLMENTS: 'class-mgmt-enrollments',
  // 后台用户管理（本地测试）
  ADMIN_USERS: 'admin-panel-users',
} as const;
