import type { ElectiveCourse } from './electiveStaffing.js';
import { electiveScheduleMode } from './electiveStaffing.js';

/** 选修走班年龄段：G1 / G2-3 / G4-6 */
export type ElectiveAgeBandId = 'g1' | 'g2-3' | 'g4-6';

export type ElectiveAgeBandDef = {
  id: ElectiveAgeBandId;
  labelZh: string;
  labelEn: string;
  /** 课程年级 level（与班级 grade 字段一致） */
  gradeLevels: readonly number[];
};

export const ELECTIVE_AGE_BANDS: readonly ElectiveAgeBandDef[] = [
  { id: 'g1', labelZh: 'G1', labelEn: 'G1', gradeLevels: [1] },
  { id: 'g2-3', labelZh: 'G2-3', labelEn: 'G2-3', gradeLevels: [2, 3] },
  { id: 'g4-6', labelZh: 'G4-6', labelEn: 'G4-6', gradeLevels: [4, 5, 6] },
] as const;

export function electiveAgeBandLabel(bandId: ElectiveAgeBandId, isZh: boolean): string {
  const row = ELECTIVE_AGE_BANDS.find((b) => b.id === bandId);
  return row ? (isZh ? row.labelZh : row.labelEn) : bandId;
}

export function gradeLevelToElectiveBand(level: number): ElectiveAgeBandId | null {
  for (const band of ELECTIVE_AGE_BANDS) {
    if (band.gradeLevels.includes(level)) return band.id;
  }
  return null;
}

export function electiveBandGradeLevels(bandId: ElectiveAgeBandId): readonly number[] {
  return ELECTIVE_AGE_BANDS.find((b) => b.id === bandId)?.gradeLevels ?? [];
}

export type GradeCatalogRef = { id: string; level: number };

/** 课程所属选修学段：年级须落在同一学段内 */
export function resolveCourseElectiveBand(
  applicableGradeIds: readonly string[],
  gradeItems: readonly GradeCatalogRef[],
): ElectiveAgeBandId | 'unset' | 'cross-band' {
  const ids = applicableGradeIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return 'unset';
  const byId = new Map(gradeItems.map((g) => [g.id, g.level]));
  const bands = new Set<ElectiveAgeBandId>();
  for (const gid of ids) {
    const level = byId.get(gid);
    if (level == null) continue;
    const band = gradeLevelToElectiveBand(level);
    if (band) bands.add(band);
  }
  if (bands.size === 0) return 'unset';
  if (bands.size > 1) return 'cross-band';
  return [...bands][0];
}

export type ElectiveBandEnrollmentStats = {
  bandId: ElectiveAgeBandId;
  classCount: number;
  studentCount: number;
};

/** 按选修学段统计在籍学生（学籍去重）与班级数 */
export function countElectiveBandEnrollment(input: {
  classes: readonly { id: string; grade: number }[];
  enrollments: readonly { classId: string; studentId: string }[];
}): ElectiveBandEnrollmentStats[] {
  const classBand = new Map<string, ElectiveAgeBandId>();
  const classCount = new Map<ElectiveAgeBandId, number>();
  for (const cls of input.classes) {
    const band = gradeLevelToElectiveBand(cls.grade);
    if (!band) continue;
    classBand.set(cls.id, band);
    classCount.set(band, (classCount.get(band) ?? 0) + 1);
  }
  const studentsByBand = new Map<ElectiveAgeBandId, Set<string>>();
  for (const e of input.enrollments) {
    const band = classBand.get(e.classId);
    if (!band) continue;
    let set = studentsByBand.get(band);
    if (!set) {
      set = new Set();
      studentsByBand.set(band, set);
    }
    set.add(e.studentId);
  }
  return ELECTIVE_AGE_BANDS.map((band) => ({
    bandId: band.id,
    classCount: classCount.get(band.id) ?? 0,
    studentCount: studentsByBand.get(band.id)?.size ?? 0,
  }));
}

export type ElectiveBandCapacitySummary = ElectiveBandEnrollmentStats & {
  courseCount: number;
  capacityTotal: number;
  /** 正数 = 尚缺名额；0 = 刚好；负数 = 超额 */
  deficit: number;
  surplus: number;
};

export function summarizeElectiveBandCapacity(input: {
  bandId: ElectiveAgeBandId;
  studentCount: number;
  classCount: number;
  courses: readonly ElectiveCourse[];
  gradeItems: readonly GradeCatalogRef[];
}): ElectiveBandCapacitySummary {
  const bandCourses = input.courses.filter(
    (c) => resolveCourseElectiveBand(c.applicableGrades ?? [], input.gradeItems) === input.bandId,
  );
  const capacityTotal = bandCourses.reduce((sum, c) => sum + Math.max(0, c.capacity), 0);
  const gap = input.studentCount - capacityTotal;
  return {
    bandId: input.bandId,
    classCount: input.classCount,
    studentCount: input.studentCount,
    courseCount: bandCourses.length,
    capacityTotal,
    deficit: gap > 0 ? gap : 0,
    surplus: gap < 0 ? -gap : 0,
  };
}

export type ElectiveSessionSlot = 1 | 2;

export type ElectiveTeacherSlotAssignment = {
  courseId: string;
  courseName: string;
  bandId: ElectiveAgeBandId | 'cross-band' | 'unset';
  session: ElectiveSessionSlot;
  teacherId: string;
};

/** 提取课程在各走班课时的教师安排（全校同时走班：课时1/课时2 各只有一个时间段） */
export function listElectiveTeacherSlotAssignments(
  courses: readonly ElectiveCourse[],
  gradeItems: readonly GradeCatalogRef[],
): ElectiveTeacherSlotAssignment[] {
  const out: ElectiveTeacherSlotAssignment[] = [];
  for (const course of courses) {
    const band = resolveCourseElectiveBand(course.applicableGrades ?? [], gradeItems);
    const mode = electiveScheduleMode(course);
    const push = (teacherId: string | null | undefined, session: ElectiveSessionSlot) => {
      const tid = (teacherId ?? '').trim();
      if (!tid) return;
      out.push({
        courseId: course.id,
        courseName: course.name,
        bandId: band,
        session,
        teacherId: tid,
      });
    };
    if (mode === 'repeat') {
      push(course.teacherId, 1);
      push(course.teacher2Id, 2);
    } else {
      // 连堂：连续 2 课时，占用全校第 1、第 2 走班时段，两节均不可再排其他选修
      for (const tid of [course.teacherId, course.teacher2Id]) {
        push(tid, 1);
        push(tid, 2);
      }
    }
  }
  return out;
}

export type ElectiveTeacherConflict = {
  teacherId: string;
  session: ElectiveSessionSlot;
  entries: Array<{
    courseId: string;
    courseName: string;
    bandId: ElectiveAgeBandId | 'cross-band' | 'unset';
  }>;
};

/** 全校同时走班：同一教师不能在同一课时出现在多个学段 */
export function findElectiveTeacherConflicts(
  courses: readonly ElectiveCourse[],
  gradeItems: readonly GradeCatalogRef[],
): ElectiveTeacherConflict[] {
  const assignments = listElectiveTeacherSlotAssignments(courses, gradeItems);
  const byKey = new Map<string, ElectiveTeacherConflict>();
  for (const a of assignments) {
    const key = `${a.teacherId}::${a.session}`;
    let row = byKey.get(key);
    if (!row) {
      row = { teacherId: a.teacherId, session: a.session, entries: [] };
      byKey.set(key, row);
    }
    if (!row.entries.some((e) => e.courseId === a.courseId && e.bandId === a.bandId)) {
      row.entries.push({
        courseId: a.courseId,
        courseName: a.courseName,
        bandId: a.bandId,
      });
    }
  }
  return [...byKey.values()].filter((row) => new Set(row.entries.map((e) => e.courseId)).size > 1);
}

export function groupElectiveCoursesByBand(
  courses: readonly ElectiveCourse[],
  gradeItems: readonly GradeCatalogRef[],
): {
  byBand: Record<ElectiveAgeBandId, ElectiveCourse[]>;
  unclassified: ElectiveCourse[];
} {
  const byBand: Record<ElectiveAgeBandId, ElectiveCourse[]> = {
    g1: [],
    'g2-3': [],
    'g4-6': [],
  };
  const unclassified: ElectiveCourse[] = [];
  for (const course of courses) {
    const band = resolveCourseElectiveBand(course.applicableGrades ?? [], gradeItems);
    if (band === 'g1' || band === 'g2-3' || band === 'g4-6') {
      byBand[band].push(course);
    } else {
      unclassified.push(course);
    }
  }
  return { byBand, unclassified };
}
