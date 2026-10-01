import type { Term } from './classManagement';

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

export interface OpenLesson {
  id: string;
  academicYearId: string;
  term: Term;
  groupId: string;
  groupNameZh: string;
  groupNameEn: string;
  teacherId: string;
  teacherNameZh: string;
  teacherNameEn: string;
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
  viewerId: string;
  isAdmin: boolean;
  ledGroupIds: string[];
  memberGroupIds: string[];
  groups: OpenLessonGroupOption[];
  staff: OpenLessonStaffOption[];
  memberships: OpenLessonMembership[];
  lessons: OpenLesson[];
}

export interface OpenLessonInput {
  academicYearId: string;
  term: Term;
  groupId: string;
  teacherId: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
}
