import type { StaffingSemesterTerm } from './selfStudyStaffing.js';

/** 全校选修固定为每周 2 节（第 1、第 2 走班时段） */
export const ELECTIVE_PERIODS_PER_WEEK = 2 as const;

export type ElectiveScheduleConfig = {
  academicYearId: string;
  term: StaffingSemesterTerm;
  periodsPerWeek: number;
};

/** 1 = 每周两次、各 1 课时（重复排课）；2 = 一次连堂 2 课时 */
export type ElectiveDurationPeriods = 1 | 2;

export type ElectiveScheduleMode = 'repeat' | 'block';

export type ElectiveCourse = {
  id: string;
  academicYearId: string;
  term: StaffingSemesterTerm;
  name: string;
  /** 开设年级（年级配置 catalog id，与课程管理一致） */
  applicableGrades: string[];
  durationPeriods: ElectiveDurationPeriods;
  teacherId: string | null;
  teacher2Id?: string | null;
  teacherName?: string | null;
  teacher2Name?: string | null;
  capacity: number;
  location: string;
  sortOrder: number;
};

export function electiveScheduleMode(
  course: Pick<ElectiveCourse, 'durationPeriods'>,
): ElectiveScheduleMode {
  return course.durationPeriods === 2 ? 'block' : 'repeat';
}

export function electiveDurationTypeLabel(
  durationPeriods: ElectiveDurationPeriods,
  isZh: boolean,
): string {
  if (durationPeriods === 2) {
    return isZh ? '2课时（连堂）' : '2 periods (block)';
  }
  return isZh ? '1课时（重复）' : '1 period (repeat)';
}

/** 卡片展示用（与 electiveDurationTypeLabel 一致，保留别名便于 UI 引用） */
export function electiveDurationTypeLabelCompact(
  durationPeriods: ElectiveDurationPeriods,
  isZh: boolean,
): string {
  return electiveDurationTypeLabel(durationPeriods, isZh);
}

export function electiveDurationTypeHint(durationPeriods: ElectiveDurationPeriods, isZh: boolean): string {
  if (durationPeriods === 2) {
    return isZh
      ? '一次连上 2 课时，占用全校第 1、第 2 走班时段；任课教师不能再排任何其他选修课。'
      : 'One double block using both school-wide elective sessions; assigned teachers cannot take any other elective.';
  }
  return isZh
    ? '每周上 2 次、每次 1 课时（面向不同批次）；请分别指定第 1、第 2 课时教师。同一教师连上两次时，两格可填同一人。'
    : 'Two weekly sessions of 1 period each; assign teachers per session. Use the same person in both slots if one teacher teaches both.';
}

/** 解析导入/表单中的时长类型 */
export function parseElectiveDurationPeriods(raw: unknown): ElectiveDurationPeriods {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '2' || s.includes('连堂') || s.includes('block') || s.includes('double')) return 2;
  return 1;
}

/** 每位教师的选修周课时明细（重复课：各 1 节；连堂：各 2 节） */
export function electiveTeacherWeeklyLoads(
  course: Pick<ElectiveCourse, 'durationPeriods' | 'teacherId' | 'teacher2Id'>,
): Array<{ teacherId: string; periods: number }> {
  const perSession = course.durationPeriods === 2 ? 2 : 1;
  const loads: Array<{ teacherId: string; periods: number }> = [];
  for (const tid of [course.teacherId, course.teacher2Id]) {
    if (!tid) continue;
    loads.push({ teacherId: tid, periods: perSession });
  }
  return loads;
}

/** @deprecated 请使用 electiveTeacherWeeklyLoads */
export function electiveTeacherWeeklyPeriods(course: Pick<ElectiveCourse, 'durationPeriods'>): number {
  return course.durationPeriods === 2 ? 2 : 1;
}

export function formatElectiveTeachersDisplay(
  course: Pick<
    ElectiveCourse,
    'durationPeriods' | 'teacherId' | 'teacher2Id' | 'teacherName' | 'teacher2Name'
  >,
  isZh: boolean,
): string {
  return formatElectiveTeachersCompact(course, isZh);
}

/** 课程卡片：重复课同师只显示一次；异师逗号；连堂双师用 + */
export function formatElectiveTeachersCompact(
  course: Pick<
    ElectiveCourse,
    'durationPeriods' | 'teacherId' | 'teacher2Id' | 'teacherName' | 'teacher2Name'
  >,
  isZh: boolean,
): string {
  const t1 = (course.teacherName ?? '').trim();
  const t2 = (course.teacher2Name ?? '').trim();
  const id1 = (course.teacherId ?? '').trim();
  const id2 = (course.teacher2Id ?? '').trim();

  if (electiveScheduleMode(course) === 'block') {
    if (t1 && t2) return `${t1}+${t2}`;
    return t1 || t2 || (isZh ? '未指定' : 'Unassigned');
  }

  if (t1 && t2) {
    if (id1 && id2 && id1 === id2) return t1;
    if (t1 === t2) return t1;
    return isZh ? `${t1}，${t2}` : `${t1}, ${t2}`;
  }
  return t1 || t2 || (isZh ? '未指定' : 'Unassigned');
}

export function formatElectiveCourseCardTitle(
  course: Pick<ElectiveCourse, 'name' | 'applicableGrades'>,
  gradeItems: readonly { id: string; label: string; level?: number }[],
  isZh: boolean,
): string {
  const name = course.name.trim();
  const ids = course.applicableGrades ?? [];
  if (ids.length === 0) return name;
  const byId = new Map(gradeItems.map((g) => [g.id, g]));
  const labels = ids
    .map((id) => byId.get(id))
    .filter((g): g is { id: string; label: string; level?: number } => Boolean(g))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
    .map((g) => g.label);
  if (labels.length === 0) return name;
  return `${name}(${labels.join(isZh ? '、' : ', ')})`;
}
