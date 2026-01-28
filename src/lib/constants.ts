import { CourseColor } from '../types';

// 年级和学期常量
export const GRADES: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const SEMESTERS: ('Semester 1' | 'Semester 2')[] = ['Semester 1', 'Semester 2'];

// 年级标签（中文）
export const GRADE_LABELS: Record<number, string> = {
  1: '一年级',
  2: '二年级',
  3: '三年级',
  4: '四年级',
  5: '五年级',
  6: '六年级',
  7: '七年级',
  8: '八年级',
  9: '九年级',
};

// 学期标签（中文）
export const SEMESTER_LABELS: Record<'Semester 1' | 'Semester 2', string> = {
  'Semester 1': '上学期',
  'Semester 2': '下学期',
};

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

// IB PYP 16个关键概念
export const KEY_CONCEPTS_OPTIONS = [
  '审美 Aesthetics',
  '变化 Change',
  '交流 Communication',
  '社区 Communities',
  '关联 Connections',
  '创造力 Creativity',
  '文化 Culture',
  '发展 Development',
  '形式 Form',
  '全球互动 Global interactions',
  '身份认同 Identity',
  '逻辑 Logic',
  '视角 Perspective',
  '关系 Relationships',
  '时间/地点/空间 Time/place/space',
  '系统 Systems'
];

// 存储键常量
export const STORAGE_KEYS = {
  COURSES: 'curriculum-roadmap-courses',
  SEMESTER_PREFIX: 'semester-data-',
  CATEGORY_ORDER: 'curriculum-roadmap-category-order',
  KEY_CONCEPTS: 'curriculum-roadmap-key-concepts',
} as const;
