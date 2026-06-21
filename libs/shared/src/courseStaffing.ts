import type { Course } from './types.js';

/** 是否出现在岗位安排 / 周课时统计（任课列）中 */
export function isCourseIncludedInStaffing(
  course: Pick<Course, 'excludeFromStaffing'>,
): boolean {
  return !course.excludeFromStaffing;
}
