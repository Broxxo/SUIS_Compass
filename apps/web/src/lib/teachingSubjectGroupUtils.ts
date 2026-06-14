import { STAFFING_HOMEROOM_SUBJECT_KEY, staffingSubjectKeyFromCourse } from '@repo/shared';
import type { TeachingSubjectGroup } from '@repo/shared';
import type { Course } from '../types';
import type { ClassItem, StaffingAssignment } from '../types/classManagement';
import type { AdminUser } from './adminStorage';
import {
  getGradeCatalogIdForClass,
  getRoadmapSegmentsInDisplayOrder,
  normalizeGradeConfig,
  type GradeConfig,
} from './gradeConfig';

export type SubjectOption = { key: string; label: string };

export function formatTeachingGroupSegmentLabels(
  segmentIds: string[],
  gradeConfig: GradeConfig,
  isZh: boolean,
): string {
  const segments = getRoadmapSegmentsInDisplayOrder(normalizeGradeConfig(gradeConfig));
  if (segments.length === 0) {
    return isZh ? '全校' : 'Whole school';
  }
  if (segmentIds.length === 0) {
    return isZh ? '全校' : 'Whole school';
  }
  const labels = segmentIds
    .map((id) => segments.find((s) => s.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(isZh ? '、' : ', ') : isZh ? '未选学段' : 'No segments';
}

export function formatTeachingGroupSubjectLabels(
  subjectKeys: string[],
  subjectOptions: SubjectOption[],
  isZh: boolean,
): string | null {
  const labels = subjectKeys
    .map((key) => subjectOptions.find((o) => o.key === key)?.label ?? key)
    .filter((label) => label.trim().length > 0);
  return labels.length > 0 ? labels.join(isZh ? '、' : ', ') : null;
}

export function getTeachingGroupDisplayParts(
  group: Pick<TeachingSubjectGroup, 'nameZh' | 'nameEn' | 'segmentIds' | 'subjectKeys'>,
  gradeConfig: GradeConfig,
  isZh: boolean,
): { name: string; meta: string | null } {
  const name = isZh ? group.nameZh : group.nameEn || group.nameZh;
  const segmentPart = formatTeachingGroupSegmentLabels(group.segmentIds, gradeConfig, isZh);
  const subjectPart = group.subjectKeys.join(isZh ? '、' : ', ');
  const skipSegment =
    segmentPart === (isZh ? '全校' : 'Whole school') ||
    segmentPart === (isZh ? '未选学段' : 'No segments');
  let meta: string | null = null;
  if (!skipSegment && subjectPart) {
    meta = `${segmentPart} · ${subjectPart}`;
  } else if (!skipSegment) {
    meta = segmentPart;
  } else if (subjectPart) {
    meta = subjectPart;
  }
  return { name, meta };
}

/** 列表展示：组名（学段 · 学科），如「小学数学组（先锋小学 · 数学）」 */
export function formatTeachingGroupDisplayTitle(
  group: Pick<TeachingSubjectGroup, 'nameZh' | 'nameEn' | 'segmentIds' | 'subjectKeys'>,
  gradeConfig: GradeConfig,
  isZh: boolean,
): string {
  const { name, meta } = getTeachingGroupDisplayParts(group, gradeConfig, isZh);
  return meta ? `${name}（${meta}）` : name;
}

export function classesInSelectedSegments(
  classes: ClassItem[],
  segmentIds: string[],
  gradeConfig: GradeConfig,
): ClassItem[] {
  const norm = normalizeGradeConfig(gradeConfig);
  const segments = getRoadmapSegmentsInDisplayOrder(norm);
  if (segments.length === 0 || segmentIds.length === 0) return classes;
  const targetIds = new Set(segmentIds);
  return classes.filter((cls) => {
    const gid = getGradeCatalogIdForClass(norm, cls.grade, { className: cls.name });
    return segments.some((seg) => targetIds.has(seg.id) && seg.gradeIds.includes(gid));
  });
}

export function buildSubjectDisplayKeyToStaffingKeys(
  columnGroups: Array<{ key: string; courses: Course[] }>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const g of columnGroups) {
    const keys = new Set<string>();
    for (const course of g.courses) {
      keys.add(staffingSubjectKeyFromCourse(course.id, course.name));
    }
    map.set(g.key, keys);
  }
  return map;
}

export function buildSubjectOptionsFromColumnGroups(
  columnGroups: Array<{ key: string; name: string }>,
): SubjectOption[] {
  return columnGroups.map((g) => ({ key: g.key, label: g.name }));
}

export function filterTeachersForSubjectGroup(
  group: Pick<TeachingSubjectGroup, 'segmentIds' | 'subjectKeys'>,
  teachers: AdminUser[],
  assignments: StaffingAssignment[],
  classes: ClassItem[],
  gradeConfig: GradeConfig,
  displayKeyToSubjectKeys: Map<string, Set<string>>,
): AdminUser[] {
  if (group.subjectKeys.length === 0) return [];
  const scopedClassIds = new Set(
    classesInSelectedSegments(classes, group.segmentIds, gradeConfig).map((c) => c.id),
  );
  const allowedSubjectKeys = new Set<string>();
  for (const dk of group.subjectKeys) {
    const keys = displayKeyToSubjectKeys.get(dk);
    if (keys) keys.forEach((k) => allowedSubjectKeys.add(k));
    else allowedSubjectKeys.add(dk);
  }
  const teacherIds = new Set<string>();
  for (const a of assignments) {
    if (a.subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY) continue;
    if (!scopedClassIds.has(a.classId)) continue;
    if (!allowedSubjectKeys.has(a.subjectKey)) continue;
    if (a.teacherId) teacherIds.add(a.teacherId);
  }
  return teachers.filter((t) => teacherIds.has(t.id));
}
