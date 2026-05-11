import type { CourseColor } from './courseColors.js';
export type { CourseColor } from './courseColors.js';

export type SubjectCategory = {
  zh: string;
  en: string;
};

/** 学校年级配置项：id 稳定，label 可变，level 用于排序和学期数据映射 */
export type GradeConfigItem = {
  id: string; // 例如 g1
  label: string; // 例如 G1 / G9国际
  level: number; // 例如 1..12
};

/** 学段：整体视图可按学段 Tab 筛选；课程仍用全局 items 的 id / level */
export type GradeConfigSegment = {
  id: string;
  label: string;
  /** 该学段包含的年级 id，顺序即显示顺序 */
  gradeIds: string[];
};

export type GradeConfig = {
  items: GradeConfigItem[];
  /** 有内容时整体视图显示「各学段 + 全学段」筛选 */
  segments?: GradeConfigSegment[];
};

export type Course = {
  id: string;
  name: string;
  subjectCategory: SubjectCategory | string;
  /** 开设年级（可非连续），按年级配置 id 关联 */
  applicableGrades: string[];
  /** 各年级周课时，键为年级 id（如 g1） */
  weeklyPeriodsByGrade: Record<string, number>;
  /** 合作教学：岗位安排需填两位教师，周课时统计时两人各计该课全周课时 */
  coTeaching?: boolean;
  textbookVersion?: string;
  color: CourseColor;
};

export type Semester = {
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
};

/** 为兼容班级/学期等模块，Grade 保持 number */
export type Grade = number;

export type Unit = {
  id: string;
  title: string;
  focus: string;
  keyConcepts: string[];
  week: string;
  periods: number;
  order: number;
};

export type SemesterData = {
  courseId: string;
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  units: Unit[];
};

/** 用户信息（API 返回不含 password）. 角色：系统管理员 > 管理员 > 教师；学生账号仅用于学生本人登录 */
export type User = {
  id: string;
  username: string;
  role: 'system-admin' | 'admin' | 'teacher' | 'student';
  /** 展示用：优先中文名，否则英文名，否则兼容旧库的 display_name */
  displayName: string;
  /** 教职工等：中文名（与 nameEn 至少其一有值时用于展示与导入） */
  nameZh?: string | null;
  /** 英文名 */
  nameEn?: string | null;
  /** 学籍 students.id，仅学生登录账号有值，用于画像等自有数据接口 */
  studentId?: string | null;
};
