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
}

/** 学生（独立于学年，跨学年存在） */
export interface Student {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'other';
  grade?: string | null; /** 年级，如 "一年级"、"1"、"G9" */
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
