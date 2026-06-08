import { STAFFING_HOMEROOM_SUBJECT_KEY } from '@repo/shared';
import type { GradeConfig } from '../types';
import { getRoadmapSegmentsInDisplayOrder, getSchoolSegmentIdForStudentGradeLevel } from './gradeConfig';
import type { ClassItem, ReportTemplateProgress, StaffingAssignment } from '../types/classManagement';

export type SubjectDistributionRow = {
  subjectKey: string;
  subjectName: string;
  classSlots: number;
  teacherIds: Set<string>;
  teacherCount: number;
};

export type TeacherWorkloadRow = {
  teacherId: string;
  teacherName: string;
  slots: number;
  primarySubject: string | null;
};

export type ClassCompletionRow = {
  classId: string;
  className: string;
  grade: number;
  completionRate: number;
  pendingStudents: number;
  totalStudents: number;
};

export function isHomeroomStaffingSubject(subjectKey: string): boolean {
  return subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY;
}

export function buildSubjectDistribution(assignments: StaffingAssignment[]): SubjectDistributionRow[] {
  const map = new Map<string, SubjectDistributionRow>();
  for (const a of assignments) {
    if (!a.teacherId || isHomeroomStaffingSubject(a.subjectKey)) continue;
    const key = a.subjectKey;
    const row =
      map.get(key) ??
      ({
        subjectKey: key,
        subjectName: a.subjectName || key,
        classSlots: 0,
        teacherIds: new Set<string>(),
        teacherCount: 0,
      } as SubjectDistributionRow);
    row.classSlots += 1;
    row.teacherIds.add(a.teacherId);
    map.set(key, row);
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, teacherCount: r.teacherIds.size }))
    .sort((a, b) => b.classSlots - a.classSlots);
}

export function buildTeacherWorkload(
  assignments: StaffingAssignment[],
  primarySubjectByTeacher: Map<string, string | null>,
): TeacherWorkloadRow[] {
  const map = new Map<string, TeacherWorkloadRow>();
  for (const a of assignments) {
    if (!a.teacherId || isHomeroomStaffingSubject(a.subjectKey)) continue;
    const row =
      map.get(a.teacherId) ??
      ({
        teacherId: a.teacherId,
        teacherName: a.teacherName || a.teacherId,
        slots: 0,
        primarySubject: primarySubjectByTeacher.get(a.teacherId) ?? null,
      } as TeacherWorkloadRow);
    row.slots += 1;
    map.set(a.teacherId, row);
  }
  return Array.from(map.values()).sort((a, b) => b.slots - a.slots);
}

export function buildClassCompletionRows(progress: ReportTemplateProgress | null): ClassCompletionRow[] {
  if (!progress) return [];
  return progress.classes
    .map((c) => ({
      classId: c.classId,
      className: c.className,
      grade: c.grade,
      completionRate: c.completionRate,
      pendingStudents: c.pendingStudents,
      totalStudents: c.totalStudents,
    }))
    .sort((a, b) => a.completionRate - b.completionRate);
}

export type SegmentTeacherCountRow = {
  segmentId: string;
  segmentLabel: string;
  teacherCount: number;
};

/** 按学段统计有任课岗位的教师人数（同一教师可在多学段重复计数） */
export function buildTeachersBySegment(
  assignments: StaffingAssignment[],
  classById: Map<string, ClassItem>,
  gradeConfig: GradeConfig,
): SegmentTeacherCountRow[] {
  const segments = getRoadmapSegmentsInDisplayOrder(gradeConfig);
  if (segments.length === 0) return [];

  const teacherIdsBySegment = new Map<string, Set<string>>();
  for (const seg of segments) {
    teacherIdsBySegment.set(seg.id, new Set());
  }

  for (const a of assignments) {
    if (!a.teacherId || isHomeroomStaffingSubject(a.subjectKey)) continue;
    const cls = classById.get(a.classId);
    const gradeLevel = a.classGrade ?? cls?.grade;
    const segmentId = getSchoolSegmentIdForStudentGradeLevel(gradeConfig, gradeLevel);
    if (!segmentId) continue;
    const set = teacherIdsBySegment.get(segmentId);
    if (set) set.add(a.teacherId);
  }

  return segments.map((seg) => ({
    segmentId: seg.id,
    segmentLabel: seg.label,
    teacherCount: teacherIdsBySegment.get(seg.id)?.size ?? 0,
  }));
}

export function teachersFromStaffing(assignments: StaffingAssignment[]): Set<string> {
  const ids = new Set<string>();
  for (const a of assignments) {
    if (a.teacherId) ids.add(a.teacherId);
  }
  return ids;
}

export type TeacherAssignmentGroup = {
  subjectKey: string;
  subjectName: string;
  isHomeroom: boolean;
  classes: Array<{ classId: string; className: string; grade: number }>;
};

export function buildTeacherPersonalAssignments(
  teacherId: string,
  assignments: StaffingAssignment[],
  classById: Map<string, ClassItem>,
): TeacherAssignmentGroup[] {
  const map = new Map<string, TeacherAssignmentGroup>();
  for (const a of assignments) {
    if (a.teacherId !== teacherId) continue;
    const isHomeroom = isHomeroomStaffingSubject(a.subjectKey);
    const cls = classById.get(a.classId);
    const subjectName = isHomeroom
      ? '班主任'
      : a.subjectName?.trim() || a.subjectKey;
    const key = isHomeroom ? STAFFING_HOMEROOM_SUBJECT_KEY : a.subjectKey;
    const existing = map.get(key);
    const classes = existing?.classes ?? [];
    if (!classes.some((x) => x.classId === a.classId)) {
      classes.push({
        classId: a.classId,
        className: a.className || cls?.name || a.classId,
        grade: a.classGrade ?? cls?.grade ?? 0,
      });
    }
    map.set(key, {
      subjectKey: key,
      subjectName: existing?.subjectName || subjectName,
      isHomeroom,
      classes,
    });
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      classes: g.classes.sort((a, b) => a.grade - b.grade || a.className.localeCompare(b.className)),
    }))
    .sort((a, b) => {
      if (a.isHomeroom !== b.isHomeroom) return a.isHomeroom ? -1 : 1;
      return a.subjectName.localeCompare(b.subjectName);
    });
}

export function buildMyPersonalAssignments(
  myAssignments: Array<{ classId: string; subjectKey: string; subjectName?: string }>,
  classById: Map<string, ClassItem>,
): TeacherAssignmentGroup[] {
  const map = new Map<string, TeacherAssignmentGroup>();
  for (const a of myAssignments) {
    if (isHomeroomStaffingSubject(a.subjectKey)) continue;
    const cls = classById.get(a.classId);
    const existing = map.get(a.subjectKey);
    const subjectName = a.subjectName?.trim() || existing?.subjectName || a.subjectKey;
    const classes = existing?.classes ?? [];
    if (!classes.some((x) => x.classId === a.classId)) {
      classes.push({
        classId: a.classId,
        className: cls?.name ?? a.classId,
        grade: cls?.grade ?? 0,
      });
    }
    map.set(a.subjectKey, {
      subjectKey: a.subjectKey,
      subjectName,
      isHomeroom: false,
      classes,
    });
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      classes: g.classes.sort((a, b) => a.grade - b.grade || a.className.localeCompare(b.className)),
    }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

export type SubjectDetailTeacher = {
  teacherId: string;
  teacherName: string;
  classes: Array<{ classId: string; className: string; grade: number }>;
  slotCount: number;
};

export function buildSubjectDetail(
  subjectKey: string,
  assignments: StaffingAssignment[],
  classById: Map<string, ClassItem>,
): { subjectName: string; teachers: SubjectDetailTeacher[]; classCount: number } {
  const filtered = assignments.filter((a) => a.subjectKey === subjectKey && a.teacherId);
  const subjectName = filtered[0]?.subjectName || subjectKey;
  const byTeacher = new Map<string, SubjectDetailTeacher>();
  const classIds = new Set<string>();
  for (const a of filtered) {
    classIds.add(a.classId);
    const cls = classById.get(a.classId);
    const row =
      byTeacher.get(a.teacherId) ??
      ({
        teacherId: a.teacherId,
        teacherName: a.teacherName || a.teacherId,
        classes: [],
        slotCount: 0,
      } as SubjectDetailTeacher);
    row.slotCount += 1;
    if (!row.classes.some((c) => c.classId === a.classId)) {
      row.classes.push({
        classId: a.classId,
        className: a.className || cls?.name || a.classId,
        grade: a.classGrade ?? cls?.grade ?? 0,
      });
    }
    byTeacher.set(a.teacherId, row);
  }
  const teachers = Array.from(byTeacher.values()).sort((a, b) => b.slotCount - a.slotCount);
  for (const t of teachers) {
    t.classes.sort((a, b) => a.grade - b.grade || a.className.localeCompare(b.className));
  }
  return { subjectName, teachers, classCount: classIds.size };
}

export function maxCountForBars<T>(rows: T[], pick: (r: T) => number): number {
  let max = 1;
  for (const r of rows) {
    max = Math.max(max, pick(r));
  }
  return max;
}
