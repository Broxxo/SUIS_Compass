import type { Term } from './classManagement';

export const OPEN_LESSON_KINDS = ['group', 'routine', 'school'] as const;
export type OpenLessonKind = (typeof OPEN_LESSON_KINDS)[number];

export interface OpenLessonGroupOption {
  id: string;
  nameZh: string;
  nameEn: string;
}

export interface OpenLessonStaffOption {
  id: string;
  nameZh: string;
  nameEn: string;
}

export interface OpenLessonMembership {
  groupId: string;
  teacherId: string;
}

export interface OpenLessonClassOption {
  id: string;
  grade: number;
  name: string;
}

export interface OpenLesson {
  id: string;
  academicYearId: string;
  term: Term;
  lessonKind: OpenLessonKind;
  groupId: string;
  groupNameZh: string;
  groupNameEn: string;
  teacherId: string;
  teacherNameZh: string;
  teacherNameEn: string;
  classId: string;
  className: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
  canEdit: boolean;
}

export interface OpenLessonBoard {
  academicYearId: string;
  term: Term;
  lessonKind: OpenLessonKind;
  viewerId: string;
  isAdmin: boolean;
  ledGroupIds: string[];
  memberGroupIds: string[];
  groups: OpenLessonGroupOption[];
  staff: OpenLessonStaffOption[];
  memberships: OpenLessonMembership[];
  classes: OpenLessonClassOption[];
  lessons: OpenLesson[];
}

export interface OpenLessonInput {
  academicYearId: string;
  term: Term;
  lessonKind: OpenLessonKind;
  groupId: string;
  teacherId: string;
  classId: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
}

/** 导入表格里的一行。姓名和班级按页面上的文字匹配，不带内部 id。 */
export interface OpenLessonImportRow {
  row: number;
  lessonKind: string;
  groupName: string;
  teacherName: string;
  className: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
}

export interface OpenLessonImportIssue {
  row: number;
  code: string;
  detail?: string;
}
