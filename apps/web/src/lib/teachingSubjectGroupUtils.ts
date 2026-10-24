import { STAFFING_HOMEROOM_SUBJECT_KEY, getSubjectCategoryTextForLayout, staffingSubjectKeyFromCourse } from '@repo/shared';
import type { TeachingSubjectGroup } from '@repo/shared';
import type { Course, GradeConfig } from '../types';
import type { ClassItem, StaffingAssignment } from '../types/classManagement';
import type { AdminUser } from './adminStorage';
import {
  getGradeCatalogIdForClass,
  getRoadmapSegmentsInDisplayOrder,
  normalizeGradeConfig,
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
  subjectOptions: readonly SubjectOption[],
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

/** 学科组「相关学科」可用来和教职工主学科比对的名称（列名、中英文分类、课程名） */
export function buildSubjectDisplayKeyToMatchTexts(
  columnGroups: Array<{ key: string; name?: string; courses: Course[] }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of columnGroups) {
    const texts = new Set<string>();
    if (group.key.trim()) texts.add(group.key.trim());
    if (group.name?.trim()) texts.add(group.name.trim());
    for (const course of group.courses) {
      if (course.name.trim()) texts.add(course.name.trim());
      const zh = getSubjectCategoryTextForLayout(course.subjectCategory, 'zh').trim();
      const en = getSubjectCategoryTextForLayout(course.subjectCategory, 'en').trim();
      if (zh) texts.add(zh);
      if (en) texts.add(en);
    }
    map.set(group.key, [...texts]);
  }
  return map;
}

function normalizeSubjectText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/** 主学科与学科组学科名称相同，或一方完整包含另一方（至少两个字） */
export function subjectTextsOverlap(left: string, right: string): boolean {
  const a = normalizeSubjectText(left);
  const b = normalizeSubjectText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  if (shorter.length < 2) return false;
  return a.includes(b) || b.includes(a);
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
  subjectMatchTexts?: Map<string, string[]>,
): AdminUser[] {
  if (group.subjectKeys.length === 0) return [];
  const scopedClassIds = new Set(
    classesInSelectedSegments(classes, group.segmentIds, gradeConfig).map((c) => c.id),
  );
  const allowedSubjectKeys = new Set<string>();
  const matchTexts: string[] = [];
  for (const dk of group.subjectKeys) {
    const keys = displayKeyToSubjectKeys.get(dk);
    if (keys) keys.forEach((k) => allowedSubjectKeys.add(k));
    else allowedSubjectKeys.add(dk);
    const texts = subjectMatchTexts?.get(dk);
    if (texts && texts.length > 0) matchTexts.push(...texts);
    else matchTexts.push(dk);
  }
  const teacherIds = new Set<string>();
  for (const a of assignments) {
    if (a.subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY) continue;
    if (!scopedClassIds.has(a.classId)) continue;
    if (!allowedSubjectKeys.has(a.subjectKey)) continue;
    if (a.teacherId) teacherIds.add(a.teacherId);
  }
  for (const teacher of teachers) {
    const subject = (teacher.primarySubject ?? '').trim();
    if (!subject) continue;
    if (matchTexts.some((text) => subjectTextsOverlap(subject, text))) teacherIds.add(teacher.id);
  }
  return teachers.filter((t) => teacherIds.has(t.id));
}

function teacherNameSortKey(teacher: AdminUser): string {
  return (
    (teacher.nameZh ?? '').trim() ||
    (teacher.nameEn ?? '').trim() ||
    teacher.displayName ||
    teacher.username ||
    teacher.id
  );
}

/**
 * 学科组组员候选顺序：
 * 1. 已进本组
 * 2. 岗位/主学科与相关学科重叠
 * 3. 尚未加入任何学科组
 */
export function listTeachersForSubjectGroupPicker(
  group: Pick<TeachingSubjectGroup, 'segmentIds' | 'subjectKeys'>,
  teachers: AdminUser[],
  assignments: StaffingAssignment[],
  classes: ClassItem[],
  gradeConfig: GradeConfig,
  displayKeyToSubjectKeys: Map<string, Set<string>>,
  subjectMatchTexts: Map<string, string[]> | undefined,
  selectedMemberIds: readonly string[],
  membersByGroupId: Map<string, string[]>,
): AdminUser[] {
  const related = filterTeachersForSubjectGroup(
    group,
    teachers,
    assignments,
    classes,
    gradeConfig,
    displayKeyToSubjectKeys,
    subjectMatchTexts,
  );
  const relatedIds = new Set(related.map((teacher) => teacher.id));
  const selectedIds = new Set(selectedMemberIds);
  const inAnyGroup = new Set<string>();
  for (const ids of membersByGroupId.values()) {
    for (const id of ids) inAnyGroup.add(id);
  }

  const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  const sortByName = (left: AdminUser, right: AdminUser) =>
    teacherNameSortKey(left).localeCompare(teacherNameSortKey(right), 'zh');

  const inGroup: AdminUser[] = [];
  for (const id of selectedMemberIds) {
    const teacher = byId.get(id);
    if (teacher) inGroup.push(teacher);
  }
  const relatedNotInGroup = related.filter((teacher) => !selectedIds.has(teacher.id)).sort(sortByName);
  const ungrouped = teachers
    .filter(
      (teacher) =>
        !selectedIds.has(teacher.id) && !relatedIds.has(teacher.id) && !inAnyGroup.has(teacher.id),
    )
    .sort(sortByName);

  return [...inGroup, ...relatedNotInGroup, ...ungrouped];
}
