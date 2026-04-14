export type CourseColor =
  | 'light-blue'
  | 'light-green'
  | 'light-yellow'
  | 'light-red'
  | 'light-purple'
  | 'light-orange'
  | 'light-cyan'
  | 'light-pink'
  | 'light-indigo';

export type SubjectCategory = {
  zh: string;
  en: string;
};

export type Course = {
  id: string;
  name: string;
  subjectCategory: SubjectCategory | string;
  gradeRange?: string;
  textbookVersion?: string;
  color: CourseColor;
  weeklyPeriods?: number;
};

export type Semester = {
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
};

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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
  weeklyPeriods?: number;
};

/** 用户信息（API 返回不含 password）. 角色：系统管理员 > 管理员 > 教师；学生账号仅用于学生本人登录 */
export type User = {
  id: string;
  username: string;
  role: 'system-admin' | 'admin' | 'teacher' | 'student';
  displayName: string;
  /** 学籍 students.id，仅学生登录账号有值，用于画像等自有数据接口 */
  studentId?: string | null;
};
