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

export type Term = 'Semester 1' | 'Semester 2';
export type ReportGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D';
export type TargetLevel = 'A' | 'B' | 'C' | 'D';

export interface StudentTermTargetDimension {
  id: string;
  dimensionKey: string;
  dimensionLabel: string;
  sortOrder: number;
  rating: TargetLevel | null;
  levelDescriptions: Partial<Record<TargetLevel, string>>;
}

export interface StudentTermSubjectReport {
  id: string;
  subjectKey: string;
  subjectName: string;
  midtermScore: number | null;
  midtermGrade: ReportGrade | null;
  finalScore: number | null;
  finalGrade: ReportGrade | null;
  teacherComment: string | null;
  teacherId: string | null;
  dimensions: StudentTermTargetDimension[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StudentTermReport {
  id: string | null;
  studentId: string;
  academicYearId: string;
  term: Term;
  templateId?: string | null;
  homeroomComment: string | null;
  subjectReports: StudentTermSubjectReport[];
  createdAt: string | null;
  updatedAt: string | null;
}

export type ReportTemplateStatus = 'draft' | 'published' | 'closed';
export type HomeroomCommentMode = 'disabled' | 'optional' | 'required';
export type EvaluationModuleType = 'subject_score' | 'subject_comment' | 'non_score_comment';
export type ScoreVisibility = 'teacher_homeroom_admin';

export interface ReportTemplateDimension {
  id: string;
  dimensionKey: string;
  dimensionLabel: string;
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  sortOrder: number;
  levelDescriptions: Partial<Record<TargetLevel, string>>;
}

export interface ReportTemplateSubject {
  id: string;
  subjectKey: string;
  subjectName: string;
  subjectNameZh: string;
  subjectNameEn: string;
  moduleType: EvaluationModuleType;
  enableScore: boolean;
  enableTeacherComment: boolean;
  scoreVisibility: ScoreVisibility;
  sortOrder: number;
  dimensions: ReportTemplateDimension[];
}

export interface ReportTemplate {
  id: string | null;
  academicYearId: string;
  term: Term;
  title: string | null;
  templateType?: 'portrait-evaluation';
  isActive?: boolean;
  publishedAt?: string | null;
  releasedAt?: string | null;
  status: ReportTemplateStatus;
  homeroomCommentMode: HomeroomCommentMode;
  subjects: ReportTemplateSubject[];
}

export interface EvaluationTemplateSummary {
  id: string;
  academicYearId: string;
  academicYearName: string;
  term: Term;
  title: string | null;
  status: ReportTemplateStatus;
  templateType: 'portrait-evaluation';
  isActive: boolean;
  publishedAt: string | null;
  releasedAt: string | null;
  updatedAt: string | null;
}

export interface ReportTemplateProgressTeacher {
  teacherId: string;
  teacherName: string;
}

export interface ReportTemplateProgressClassItem {
  classId: string;
  className: string;
  grade: number;
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
  pendingStudentNames: string[];
  teachers: ReportTemplateProgressTeacher[];
  reminderMessage: string;
}

export interface ReportTemplateProgress {
  templateId: string;
  title: string | null;
  status: ReportTemplateStatus;
  academicYearId: string;
  term: Term;
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
  classes: ReportTemplateProgressClassItem[];
}

export interface StaffingAssignment {
  id: string;
  academicYearId: string;
  classId: string;
  className: string;
  classGrade: number;
  subjectKey: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  updatedAt: string | null;
}
