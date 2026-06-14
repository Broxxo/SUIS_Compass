import {
  groupCoursesByRoadmapDisplayKey,
  staffingSubjectKeyFromCourse,
} from '@repo/shared';
import pool from '../config/database.js';
import {
  getGradeCatalogIdForClass,
  normalizeGradeConfig,
  type GradeConfig,
} from './schoolGradeStructure.js';

export type StaffingAssignmentRow = {
  classId: string;
  className: string;
  classGrade: number;
  subjectKey: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
};

export type ClassRow = {
  id: string;
  name: string;
  grade: number;
};

function mapCourseRow(row: Record<string, unknown>) {
  const zh = String(row.subject_category_zh ?? '').trim();
  const en = String(row.subject_category_en ?? '').trim();
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    subjectCategory: zh || en ? { zh, en } : { zh: '', en: '' },
    applicableGrades: [] as string[],
    weeklyPeriodsByGrade: {} as Record<string, number>,
    coTeaching: Boolean(row.co_teaching),
    color: 'light-blue' as const,
  };
}

export async function loadDisplayKeyToStaffingSubjectKeys(): Promise<Map<string, Set<string>>> {
  const rows = (await pool.query(
    `SELECT id, name, subject_category_zh, subject_category_en, co_teaching, color FROM courses ORDER BY name ASC`,
  )).rows as Record<string, unknown>[];
  const courses = rows.map(mapCourseRow);
  const columns = groupCoursesByRoadmapDisplayKey(courses, 'zh');
  const map = new Map<string, Set<string>>();
  for (const col of columns) {
    const keys = new Set<string>();
    for (const course of col.courses) {
      keys.add(staffingSubjectKeyFromCourse(course.id, course.name));
    }
    map.set(col.displayKey, keys);
  }
  return map;
}

export function resolveGroupStaffingSubjectKeys(
  groupSubjectKeys: string[],
  displayMap: Map<string, Set<string>>,
): Set<string> {
  const allowed = new Set<string>();
  for (const dk of groupSubjectKeys) {
    const mapped = displayMap.get(dk);
    if (mapped) {
      for (const k of mapped) allowed.add(k);
    } else {
      allowed.add(dk);
    }
  }
  return allowed;
}

export async function loadReportTemplateSubjectKeys(
  templateId: string,
): Promise<Array<{ subjectKey: string; subjectNameZh: string }>> {
  const rows = (
    await pool.query(
      `SELECT subject_key, subject_name_zh
       FROM student_report_template_subjects
       WHERE template_id = $1 AND enable_score = TRUE
       ORDER BY sort_order ASC`,
      [templateId],
    )
  ).rows;
  return rows.map((r) => ({
    subjectKey: r.subject_key as string,
    subjectNameZh: String(r.subject_name_zh ?? '').trim(),
  }));
}

export function reportSubjectKeysForGroup(
  groupSubjectKeys: string[],
  reportSubjects: Array<{ subjectKey: string; subjectNameZh: string }>,
  staffingKeys: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const dk of groupSubjectKeys) {
    for (const rs of reportSubjects) {
      const name = rs.subjectNameZh;
      if (
        name === dk ||
        name.includes(dk) ||
        dk.includes(name) ||
        staffingKeys.has(rs.subjectKey)
      ) {
        out.add(rs.subjectKey);
      }
    }
  }
  if (out.size === 0) {
    for (const k of staffingKeys) out.add(k);
  }
  return out;
}

export function classInGroupSegments(
  classGrade: number,
  className: string,
  segmentIds: string[],
  gradeConfig: GradeConfig,
): boolean {
  const segments = normalizeGradeConfig(gradeConfig).segments ?? [];
  if (segmentIds.length === 0 || segments.length === 0) return true;
  const targetIds = new Set(segmentIds);
  const catalogId = getGradeCatalogIdForClass(gradeConfig, classGrade, { className });
  return segments.some((seg) => targetIds.has(seg.id) && seg.gradeIds.includes(catalogId));
}

export async function loadClassesForYear(academicYearId: string): Promise<ClassRow[]> {
  const rows = (
    await pool.query(
      `SELECT id, name, grade FROM classes WHERE academic_year_id = $1 ORDER BY grade ASC, name ASC`,
      [academicYearId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    grade: Number(r.grade ?? 0),
  }));
}

export function filterClassesInGroupSegments(
  classes: ClassRow[],
  segmentIds: string[],
  gradeConfig: GradeConfig,
): ClassRow[] {
  return classes.filter((c) => classInGroupSegments(c.grade, c.name, segmentIds, gradeConfig));
}

export function filterAssignmentsForGroup(input: {
  assignments: StaffingAssignmentRow[];
  memberIds: string[];
  segmentIds: string[];
  groupSubjectKeys: string[];
  gradeConfig: GradeConfig;
  allowedStaffingKeys: Set<string>;
}): StaffingAssignmentRow[] {
  const { assignments, memberIds, segmentIds, gradeConfig, allowedStaffingKeys } = input;
  const inScope = (a: StaffingAssignmentRow) =>
    classInGroupSegments(a.classGrade, a.className, segmentIds, gradeConfig) &&
    allowedStaffingKeys.has(a.subjectKey);

  const scoped = assignments.filter(inScope);
  if (memberIds.length === 0) return scoped;

  const memberScoped = scoped.filter((a) => memberIds.includes(a.teacherId));
  return memberScoped.length > 0 ? memberScoped : scoped;
}
