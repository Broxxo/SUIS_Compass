/** 1=周一 … 7=周日 */
export type SelfStudyWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type StaffingSemesterTerm = 'Semester 1' | 'Semester 2';

export type SelfStudyModule = {
  id: string;
  academicYearId: string;
  term: StaffingSemesterTerm;
  name: string;
  sortOrder: number;
};

export type SelfStudyGradeConfig = {
  id: string;
  academicYearId: string;
  term: StaffingSemesterTerm;
  moduleId: string;
  grade: number;
  sessionsPerWeek: number;
};

export type SelfStudySlot = {
  id: string;
  academicYearId: string;
  term: StaffingSemesterTerm;
  moduleId: string;
  /** 班级 id */
  classId: string;
  /** 课程年级 level（与班级 grade 字段一致，便于排序与展示） */
  grade: number;
  weekday: SelfStudyWeekday;
  teacherId: string | null;
  teacherName?: string | null;
  sortOrder: number;
};

export const SELF_STUDY_WEEKDAY_LABELS: Record<SelfStudyWeekday, { zh: string; en: string }> = {
  1: { zh: '周一', en: 'Mon' },
  2: { zh: '周二', en: 'Tue' },
  3: { zh: '周三', en: 'Wed' },
  4: { zh: '周四', en: 'Thu' },
  5: { zh: '周五', en: 'Fri' },
  6: { zh: '周六', en: 'Sat' },
  7: { zh: '周日', en: 'Sun' },
};

export function selfStudyWeekdayLabel(weekday: SelfStudyWeekday, isZh: boolean): string {
  const row = SELF_STUDY_WEEKDAY_LABELS[weekday];
  return isZh ? row.zh : row.en;
}

export function parseStaffingSemesterTerm(val: unknown): StaffingSemesterTerm | null {
  return val === 'Semester 1' || val === 'Semester 2' ? val : null;
}
