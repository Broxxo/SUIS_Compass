/** 学年 */
export interface AcademicYear {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}

/** 班级（属于某学年） */
export interface ClassItem {
  id: string;
  academicYearId: string;
  grade: number;
  name: string;
  teacherId?: string | null;
  teacherIds?: string[];
}

/** 学生（独立于学年，跨学年存在） */
export interface Student {
  id: string;
  name: string;
  nameZh?: string | null;
  nameEn?: string | null;
  gender: 'male' | 'female' | 'other';
  currentGrade?: number | null;
  currentClassId?: string | null;
  division?: string | null;
  entryDate?: string | null;
  status?: 'active' | 'graduated' | 'leave' | 'withdrawn';
  studentNumber?: string | null;
  dateOfBirth?: string | null;
}

/** 学籍：学生在某学年某班的归属 */
export interface Enrollment {
  id: string;
  studentId: string;
  classId: string;
  academicYearId: string;
}

/** 分组方案：一个班级下可有多套平行分组 */
export interface ClassGroupScheme {
  id: string;
  classId: string;
  name: string;
  scope: 'class-default' | 'subject' | 'project';
  subject?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 班级小组（暂时主要用 scope='class-default'） */
export interface ClassGroup {
  id: string;
  classId: string;
  schemeId: string;
  name: string;
  scope: 'class-default' | 'subject' | 'project';
  subject?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 小组成员：带加入/退出时间，支持换组历史 */
export interface ClassGroupMembership {
  id: string;
  classId: string;
  schemeId: string;
  groupId: string;
  studentId: string;
  joinedAt: string;
  leftAt?: string | null;
}

/** 课堂积分事件（个人 / 小组） */
export interface ClassPointEvent {
  id: string;
  classId: string;
  schemeId?: string | null; // 小组事件用；旧数据兼容
  type: 'individual' | 'group';
  studentId?: string | null; // type='individual' 时使用
  groupId?: string | null; // type='group' 时使用
  delta: number; // +1 / -1 / +5 ...
  reason?: string | null;
  createdAt: string;
}
