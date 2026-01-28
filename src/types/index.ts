export type CourseColor = 'light-blue' | 'light-green' | 'light-yellow' | 'light-red' | 'light-purple' | 'light-orange' | 'light-cyan' | 'light-pink' | 'light-indigo';

export type SubjectCategory = {
  zh: string; // 中文课程类别
  en: string; // 英文课程类别
};

export type Course = {
  id: string;
  name: string;
  subjectCategory: SubjectCategory | string; // 课程类别，支持中英文对象或字符串（向后兼容）
  gradeRange?: string; // 年级跨度，如"1"或"1-6"或"3-5"，用于标识课程适用的年级范围
  textbookVersion?: string; // 教材版本，如"人教版"、"北师大版"等，默认为"人教版"
  color: CourseColor;
  weeklyPeriods?: number; // 周课时数，默认值为2
};

export type Semester = {
  grade: number; // 1-9
  semester: 'Semester 1' | 'Semester 2'; // 上学期/下学期
};

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// Unit (单元) - 学期总览中的基本单元
export type Unit = {
  id: string;
  title: string; // 主题
  focus: string; // 核心内容
  keyConcepts: string[]; // 核心概念列表
  week: string; // 周次，如 "1" 或 "1-3"
  periods: number; // 课时数
  order: number; // 排序顺序
};

// SemesterData - 一个课程一个学期的所有数据
export type SemesterData = {
  courseId: string;
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  units: Unit[];
  weeklyPeriods?: number; // 该学期该课程的周课时数，如果未设置则从 course.weeklyPeriods 继承
};

// User - 用户信息
export type User = {
  id: string;
  username: string;
  password: string; // 实际应用中应该存储哈希值，这里简化处理
  role: 'admin' | 'hf-admin' | 'wx-admin';
  displayName: string;
};
