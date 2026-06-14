/**
 * 岗位安排 Excel 导入/导出（多模块分 sheet）
 *
 * Sheet 命名：
 * - 年级管理：年级、班级、班主任、年级组长（全校各学段合并在同一 sheet）
 * - 教学管理：学科组、学科组长、成员（、分隔）
 * - 课程岗位-{学段}：年级、班级、班主任、各课程列（兼容旧版仅学段名的 sheet）
 *
 * 任课单元格格式（导入/导出一致）：
 * - 独立授课：`姓名` + 周课时数字，无空格，如 `Wendy1`、`王琪6`
 * - 合作授课：`姓名1+姓名2` + 周课时数字（仅写在末段），如 `Morné+白雪豆1`、`陈予琪+Rebecca1`
 * - 班主任列：仅教师姓名（不含课时后缀）
 *
 * 导入规则：系统中不存在的课程列整列跳过；未登记教师留空并给出提示，不阻断导入。
 */
import * as XLSX from 'xlsx';
import type { TeachingSubjectGroup } from '@repo/shared';
import type { Course, GradeConfig } from '../types';
import type { ClassItem } from '../types/classManagement';
import { STAFFING_HOMEROOM_SUBJECT_KEY, staffingHomeroomSubjectName, staffingSubjectKeyFromCourse } from '@repo/shared';
import {
  getCurriculumGradeLevelForClass,
  getGradeCatalogIdForClass,
  getSchoolGradeLabelForClass,
  normalizeGradeConfig,
} from './gradeConfig';
import { getCourseReportSubjectLabels } from '@repo/shared';
import { getSubjectCategoryText } from './utils';
import { courseAppliesToGrade, getWeeklyPeriodsForGrade } from './courseGradeUtils';

export type StaffingRosterColumn =
  | { kind: 'homeroom'; key: string; header: string }
  | { kind: 'course'; course: Course; key: string; header: string; coTeaching: boolean };

export type StaffingRosterSegmentSheet = {
  sheetName: string;
  segmentKey: string;
  classes: ClassItem[];
  columns: StaffingRosterColumn[];
};

export type StaffingRosterTeacherRef = {
  id: string;
  nameZh: string;
  nameEn: string;
  displayName: string;
  username: string;
};

export type StaffingRosterAssignmentOp = {
  academicYearId: string;
  classId: string;
  subjectKey: string;
  subjectName: string;
  teacherId: string | null;
  teacherSlot: 0 | 1;
  coTeaching: boolean;
};

export type StaffingRosterImportResult = {
  operations: StaffingRosterAssignmentOp[];
  errors: string[];
  warnings: string[];
  skippedUnknownCourses: string[];
};

export type FunctionalRoleImportOp = {
  academicYearId: string;
  roleType: 'grade-head' | 'subject-group-head';
  scopeKey: string;
  scopeLabel: string;
  teacherId: string | null;
};

export type TeachingMembersImportOp = {
  groupId: string;
  groupLabel: string;
  teacherIds: string[];
};

export type StaffingGradeMgmtBlock = {
  sheetName: string;
  segmentKey: string;
  classes: ClassItem[];
};

export type StaffingPackageImportResult = StaffingRosterImportResult & {
  functionalRoleOps: FunctionalRoleImportOp[];
  teachingMemberOps: TeachingMembersImportOp[];
};

const GRADE_HEAD_HEADERS = new Set(['年级组长', 'grade head', 'grade-head', 'grade leader']);
const GROUP_HEADERS = new Set(['学科组', 'group', 'subject group', 'teaching group']);
const LEAD_HEADERS = new Set(['学科组长', 'group lead', 'subject group lead', 'lead']);
const MEMBERS_HEADERS = new Set(['成员', 'members', 'teachers']);

const HOMEROOM_HEADERS = new Set(['班主任', 'homeroom', 'class teacher', '班主任教师']);
const GRADE_HEADERS = new Set(['年级', 'grade']);
const CLASS_HEADERS = new Set(['班级', 'class']);

function sanitizeExcelSheetName(name: string): string {
  const t = name.replace(/[\\/?*[\]:]/g, '_').trim().slice(0, 31);
  return t || 'Sheet';
}

function staffingSheetPrefix(kind: 'grade' | 'course', isZh: boolean): string {
  if (kind === 'grade') return isZh ? '年级管理' : 'Grade mgmt';
  return isZh ? '课程岗位' : 'Course jobs';
}

function staffingTeachingSheetName(isZh: boolean): string {
  return isZh ? '教学管理' : 'Teaching mgmt';
}

function buildPrefixedSheetName(kind: 'grade' | 'course', segmentLabel: string, isZh: boolean): string {
  const prefix = staffingSheetPrefix(kind, isZh);
  const label = segmentLabel.trim();
  return sanitizeExcelSheetName(label ? `${prefix}-${label}` : prefix);
}

function splitTeachingMemberNames(cell: string): string[] {
  const raw = cell.trim();
  if (!raw || raw === '—' || raw === '-' || raw === '–') return [];
  return raw
    .split(/[、;；,，\n]/)
    .map((s) => parseTeacherNameFromRosterCellSegment(s.trim()))
    .filter(Boolean);
}

type SheetKind =
  | { kind: 'grade'; segmentLabel: string }
  | { kind: 'course'; segmentLabel: string }
  | { kind: 'teaching' }
  | { kind: 'unknown' };

function classifyStaffingSheet(sheetName: string, isZh: boolean): SheetKind {
  const sn = sheetName.trim();
  const gradePrefix = staffingSheetPrefix('grade', isZh);
  const coursePrefix = staffingSheetPrefix('course', isZh);
  const teachingName = staffingTeachingSheetName(isZh);
  if (sn === teachingName || sn.toLowerCase() === 'teaching mgmt') return { kind: 'teaching' };
  if (sn.startsWith(`${gradePrefix}-`) || sn === gradePrefix) {
    return {
      kind: 'grade',
      segmentLabel: sn === gradePrefix ? '' : sn.slice(gradePrefix.length + 1).trim(),
    };
  }
  if (sn.startsWith(`${coursePrefix}-`) || sn === coursePrefix) {
    return {
      kind: 'course',
      segmentLabel: sn === coursePrefix ? '' : sn.slice(coursePrefix.length + 1).trim(),
    };
  }
  return { kind: 'course', segmentLabel: sn };
}

function mergeGradeMgmtClasses(blocks: readonly StaffingGradeMgmtBlock[]): ClassItem[] {
  const seen = new Set<string>();
  const merged: ClassItem[] = [];
  for (const block of blocks) {
    for (const cls of block.classes) {
      if (seen.has(cls.id)) continue;
      seen.add(cls.id);
      merged.push(cls);
    }
  }
  return merged;
}

/** 表头：学科名（不含教材版本），与岗位表列名一致 */
export function staffingCourseExcelHeader(course: Course, isZh: boolean): string {
  const { subjectNameZh, subjectNameEn } = getCourseReportSubjectLabels(course);
  return (isZh ? subjectNameZh : subjectNameEn).trim() || course.name.trim();
}

function formatWeeklyPeriodsForExcel(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return v.toFixed(1);
}

/** 从任课单元格片段解析教师姓名（去掉末尾周课时：「王琪6」「桂春燕 5」；无数字则原样） */
export function parseTeacherNameFromRosterCellSegment(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const withSpace = t.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
  if (withSpace) return withSpace[1].trim();
  const compact = t.match(/^(.+?)(\d+(?:\.\d+)?)$/);
  if (compact && compact[1].trim()) return compact[1].trim();
  return t;
}

function teacherDisplayName(t: StaffingRosterTeacherRef, isZh: boolean): string {
  const zh = (t.nameZh ?? '').trim();
  const en = (t.nameEn ?? '').trim();
  if (isZh) return zh || en || t.displayName || t.username;
  return en || zh || t.displayName || t.username;
}

export function resolveStaffingTeacherId(
  cellText: string,
  teachers: readonly StaffingRosterTeacherRef[],
  _isZh: boolean,
): string | null {
  const raw = parseTeacherNameFromRosterCellSegment(cellText);
  if (!raw || raw === '—' || raw === '-' || raw === '–') return null;
  const lower = raw.toLowerCase();
  for (const t of teachers) {
    const zh = (t.nameZh ?? '').trim();
    const en = (t.nameEn ?? '').trim();
    const disp = (t.displayName ?? '').trim();
    const user = (t.username ?? '').trim();
    if (raw === zh || raw === en || raw === disp || raw === user) return t.id;
    if (lower === user.toLowerCase()) return t.id;
  }
  return null;
}

/** 任课单元格 → 各 slot 教师姓名（合作课按 + 拆分；兼容旧版 /、| 分隔） */
export function parseTeacherSlotsFromRosterCell(cellText: string): string[] {
  const raw = cellText.trim();
  if (!raw || raw === '—' || raw === '-' || raw === '–') return [];
  const segments = raw.includes('+') ? raw.split('+') : raw.split(/[/／|、;；\n]/);
  return segments.map((s) => parseTeacherNameFromRosterCellSegment(s)).filter(Boolean);
}

function parseTeacherSlotsFromCell(cellText: string): string[] {
  return parseTeacherSlotsFromRosterCell(cellText);
}

function parseGradeLevelFromCell(text: string, gc: GradeConfig): number | null {
  const t = text.trim();
  if (!t) return null;
  const norm = normalizeGradeConfig(gc);
  for (const item of norm.items) {
    if (item.label === t || item.id === t) return item.level;
    if (new RegExp(`^G?${item.level}$`, 'i').test(t)) return item.level;
  }
  const m = t.match(/(\d{1,2})/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) return n;
  }
  return null;
}

function findCourseByHeader(header: string, courses: readonly Course[], isZh: boolean): Course | undefined {
  const h = header.trim();
  if (!h) return undefined;
  for (const c of courses) {
    if (staffingCourseExcelHeader(c, isZh) === h) return c;
  }
  const exact = courses.find((c) => c.name.trim() === h);
  if (exact) return exact;
  const lower = h.toLowerCase();
  const ci = courses.find((c) => c.name.trim().toLowerCase() === lower);
  if (ci) return ci;
  for (const c of courses) {
    const cat = getSubjectCategoryText(c.subjectCategory, isZh ? 'zh' : 'en');
    if (cat && cat.trim() === h) return c;
  }
  return undefined;
}

/** 独立授课单元格：姓名 + 周课时，如「王琪6」 */
function exportSoloTeacherCell(name: string, periods: number): string {
  if (!name) return '';
  if (periods <= 0) return name;
  return `${name}${formatWeeklyPeriodsForExcel(periods)}`;
}

/** 合作授课单元格：姓名1+姓名2+课时（课时仅写在最后一段），如「陈予琪+Rebecca1」 */
function exportCoTeachingTeacherCell(names: string[], periods: number): string {
  const parts = names.map((n) => n.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return exportSoloTeacherCell(parts[0], periods);
  const last = parts.length - 1;
  return parts
    .map((n, i) => (i === last ? exportSoloTeacherCell(n, periods) : n))
    .join('+');
}

function isHeaderRow(row: unknown[]): boolean {
  const c0 = String(row[0] ?? '').trim();
  const c1 = String(row[1] ?? '').trim();
  return GRADE_HEADERS.has(c0) || GRADE_HEADERS.has(String(row[0] ?? '').trim()) || CLASS_HEADERS.has(c1);
}

function matchSheetToSegment(
  sheetName: string,
  sheets: readonly StaffingRosterSegmentSheet[],
): StaffingRosterSegmentSheet | undefined {
  const sn = sheetName.trim();
  return sheets.find((s) => s.sheetName === sn || s.segmentKey === sn);
}

/**
 * 导出岗位安排整包：年级管理 / 教学管理 / 课程岗位 分 sheet。
 */
export function downloadStaffingPackageExport(input: {
  academicYearLabel: string;
  isZh: boolean;
  gradeConfig: GradeConfig;
  teachers: readonly StaffingRosterTeacherRef[];
  gradeBlocks: readonly StaffingGradeMgmtBlock[];
  homeroomByClassId: ReadonlyMap<string, string>;
  gradeHeadByScopeKey: ReadonlyMap<string, string>;
  teachingGroups: readonly TeachingSubjectGroup[];
  subjectGroupLeadByGroupId: ReadonlyMap<string, string>;
  membersByGroupId: ReadonlyMap<string, string[]>;
  courseSheets: readonly StaffingRosterSegmentSheet[];
  courseAssignments: ReadonlyMap<string, { teacherId: string }>;
}): void {
  const wb = XLSX.utils.book_new();
  const gc = normalizeGradeConfig(input.gradeConfig);
  const gradeCol = input.isZh ? '年级' : 'Grade';
  const classCol = input.isZh ? '班级' : 'Class';
  const homeroomHeader = staffingHomeroomSubjectName(input.isZh);
  const gradeHeadCol = input.isZh ? '年级组长' : 'Grade head';

  {
    const header = [gradeCol, classCol, homeroomHeader, gradeHeadCol];
    const body: string[][] = [];
    const classesSorted = mergeGradeMgmtClasses(input.gradeBlocks).sort(
      (a, b) => a.grade - b.grade || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    for (const cls of classesSorted) {
      const scopeKey = getGradeCatalogIdForClass(gc, cls.grade, { className: cls.name });
      const headId = input.gradeHeadByScopeKey.get(scopeKey);
      const headT = headId ? input.teachers.find((x) => x.id === headId) : undefined;
      const homeroomId = input.homeroomByClassId.get(cls.id);
      const homeroomT = homeroomId ? input.teachers.find((x) => x.id === homeroomId) : undefined;
      body.push([
        getSchoolGradeLabelForClass(cls),
        cls.name,
        homeroomT ? teacherDisplayName(homeroomT, input.isZh) : '',
        headT ? teacherDisplayName(headT, input.isZh) : '',
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(staffingSheetPrefix('grade', input.isZh)));
  }

  {
    const groupCol = input.isZh ? '学科组' : 'Group';
    const leadCol = input.isZh ? '学科组长' : 'Lead';
    const membersCol = input.isZh ? '成员' : 'Members';
    const teachingRows = input.teachingGroups.map((g) => {
      const leadId = input.subjectGroupLeadByGroupId.get(g.id);
      const leadT = leadId ? input.teachers.find((x) => x.id === leadId) : undefined;
      const memberIds = input.membersByGroupId.get(g.id) ?? [];
      const memberNames = memberIds
        .map((id) => input.teachers.find((x) => x.id === id))
        .filter((t): t is StaffingRosterTeacherRef => Boolean(t))
        .map((t) => teacherDisplayName(t, input.isZh));
      return [
        g.nameZh,
        leadT ? teacherDisplayName(leadT, input.isZh) : '',
        memberNames.join(input.isZh ? '、' : '; '),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([[groupCol, leadCol, membersCol], ...teachingRows]);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(staffingTeachingSheetName(input.isZh)));
  }

  const homeroomHeaderCourse = staffingHomeroomSubjectName(input.isZh);
  for (const sheet of input.courseSheets) {
    const courseCols = sheet.columns.filter((c): c is Extract<StaffingRosterColumn, { kind: 'course' }> => c.kind === 'course');
    const homeroomCol = sheet.columns.find((c) => c.kind === 'homeroom');
    const header = [gradeCol, classCol, homeroomHeaderCourse, ...courseCols.map((c) => c.header)];
    const body: (string | number)[][] = [];
    const classesSorted = [...sheet.classes].sort(
      (a, b) => a.grade - b.grade || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    for (const cls of classesSorted) {
      const curriculumLevel = getCurriculumGradeLevelForClass(gc, cls);
      const row: (string | number)[] = [getSchoolGradeLabelForClass(cls), cls.name];
      if (homeroomCol) {
        const hk = `${cls.id}::${homeroomCol.key}::0`;
        const tid = input.courseAssignments.get(hk)?.teacherId;
        const t = tid ? input.teachers.find((x) => x.id === tid) : undefined;
        row.push(t ? teacherDisplayName(t, input.isZh) : '');
      }
      for (const col of courseCols) {
        const periods = courseAppliesToGrade(col.course, curriculumLevel, gc)
          ? getWeeklyPeriodsForGrade(col.course, curriculumLevel, gc)
          : 0;
        const slots: (0 | 1)[] = col.coTeaching ? [0, 1] : [0];
        const names: string[] = [];
        for (const slot of slots) {
          const key = `${cls.id}::${col.key}::${slot}`;
          const tid = input.courseAssignments.get(key)?.teacherId;
          if (!tid) continue;
          const t = input.teachers.find((x) => x.id === tid);
          if (t) names.push(teacherDisplayName(t, input.isZh));
        }
        row.push(
          col.coTeaching
            ? exportCoTeachingTeacherCell(names, periods)
            : exportSoloTeacherCell(names[0] ?? '', periods),
        );
      }
      body.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const segLabel = sheet.sheetName.trim() || (input.isZh ? '全校' : 'All');
    XLSX.utils.book_append_sheet(wb, ws, buildPrefixedSheetName('course', segLabel, input.isZh));
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = input.isZh
    ? `岗位安排-${input.academicYearLabel}-${stamp}.xlsx`
    : `staffing-roster-${input.academicYearLabel}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** @deprecated 请使用 downloadStaffingPackageExport */
export function downloadStaffingRosterExport(input: {
  academicYearLabel: string;
  sheets: readonly StaffingRosterSegmentSheet[];
  assignments: ReadonlyMap<string, { teacherId: string }>;
  teachers: readonly StaffingRosterTeacherRef[];
  gradeConfig: GradeConfig;
  isZh: boolean;
}): void {
  downloadStaffingPackageExport({
    academicYearLabel: input.academicYearLabel,
    isZh: input.isZh,
    gradeConfig: input.gradeConfig,
    teachers: input.teachers,
    gradeBlocks: input.sheets.map((s) => ({
      sheetName: s.sheetName,
      segmentKey: s.segmentKey,
      classes: s.classes,
    })),
    homeroomByClassId: new Map(
      [...input.assignments.entries()]
        .filter(([k]) => k.includes(`::${STAFFING_HOMEROOM_SUBJECT_KEY}::`))
        .map(([k, v]) => [k.split('::')[0], v.teacherId]),
    ),
    gradeHeadByScopeKey: new Map(),
    teachingGroups: [],
    subjectGroupLeadByGroupId: new Map(),
    membersByGroupId: new Map(),
    courseSheets: input.sheets,
    courseAssignments: input.assignments,
  });
}

export function buildStaffingRosterSheetsFromBlocks(
  blocks: Array<{
    key: string;
    title: string;
    classes: ClassItem[];
    columns: Array<
      | { kind: 'homeroom'; key: string; name: string }
      | { kind: 'course'; course: Course; key: string; name: string }
    >;
  }>,
  isZh: boolean,
): StaffingRosterSegmentSheet[] {
  return blocks.map((block) => ({
    sheetName: block.title.trim() || (isZh ? '全校' : 'All'),
    segmentKey: String(block.key),
    classes: block.classes,
    columns: block.columns.map((col) => {
      if (col.kind === 'homeroom') {
        return { kind: 'homeroom' as const, key: col.key, header: col.name };
      }
      const course = col.course;
      return {
        kind: 'course' as const,
        course,
        key: col.key,
        header: staffingCourseExcelHeader(course, isZh),
        coTeaching: Boolean(course.coTeaching),
      };
    }),
  }));
}

export function parseStaffingPackageWorkbook(
  arrayBuffer: ArrayBuffer,
  input: {
    academicYearId: string;
    courseSheets: readonly StaffingRosterSegmentSheet[];
    gradeBlocks: readonly StaffingGradeMgmtBlock[];
    teachingGroups: readonly TeachingSubjectGroup[];
    allClasses: readonly ClassItem[];
    courses: readonly Course[];
    teachers: readonly StaffingRosterTeacherRef[];
    gradeConfig: GradeConfig;
    isZh: boolean;
  },
): StaffingPackageImportResult {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const operations: StaffingRosterAssignmentOp[] = [];
  const functionalRoleOps: FunctionalRoleImportOp[] = [];
  const teachingMemberOps: TeachingMembersImportOp[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const skippedUnknownCoursesAll = new Set<string>();
  const gc = normalizeGradeConfig(input.gradeConfig);
  const gradeHeadWritten = new Set<string>();

  const resolveCourseSheet = (segmentLabel: string, rawName: string) => {
    const label = segmentLabel.trim();
    if (label) {
      const hit = matchSheetToSegment(label, input.courseSheets);
      if (hit) return hit;
    }
    return matchSheetToSegment(rawName, input.courseSheets);
  };

  for (const sheetName of wb.SheetNames) {
    const classified = classifyStaffingSheet(sheetName, input.isZh);

    if (classified.kind === 'teaching') {
      const sh = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
        header: 1,
        defval: '',
      }) as string[][];
      if (data.length < 2) continue;
      const headers = (data[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colGroup = headers.findIndex((h) => GROUP_HEADERS.has(h) || GROUP_HEADERS.has(h.toLowerCase()));
      const colLead = headers.findIndex((h) => LEAD_HEADERS.has(h) || LEAD_HEADERS.has(h.toLowerCase()));
      const colMembers = headers.findIndex((h) => MEMBERS_HEADERS.has(h) || MEMBERS_HEADERS.has(h.toLowerCase()));
      if (colGroup < 0) {
        errors.push(
          input.isZh
            ? `工作表「${sheetName}」缺少「学科组」列`
            : `Sheet "${sheetName}" missing group column`,
        );
        continue;
      }
      for (let ri = 1; ri < data.length; ri += 1) {
        const row = data[ri] as unknown[];
        const groupName = String(row[colGroup] ?? '').trim();
        if (!groupName) continue;
        const group = input.teachingGroups.find((g) => g.nameZh.trim() === groupName);
        if (!group) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未找到学科组「${groupName}」，已跳过`
              : `Sheet "${sheetName}" row ${ri + 1}: group "${groupName}" not found, skipped`,
          );
          continue;
        }
        if (colLead >= 0) {
          const leadName = parseTeacherNameFromRosterCellSegment(String(row[colLead] ?? '').trim());
          const leadId = leadName ? resolveStaffingTeacherId(leadName, input.teachers, input.isZh) : null;
          if (leadName && !leadId) {
            warnings.push(
              input.isZh
                ? `工作表「${sheetName}」第 ${ri + 1} 行学科组长：未登记教师「${leadName}」，已留空`
                : `Sheet "${sheetName}" row ${ri + 1}: lead "${leadName}" not registered, left blank`,
            );
          }
          functionalRoleOps.push({
            academicYearId: input.academicYearId,
            roleType: 'subject-group-head',
            scopeKey: group.id,
            scopeLabel: group.nameZh,
            teacherId: leadId,
          });
        }
        if (colMembers >= 0) {
          const memberNames = splitTeachingMemberNames(String(row[colMembers] ?? ''));
          const memberIds: string[] = [];
          for (const name of memberNames) {
            const tid = resolveStaffingTeacherId(name, input.teachers, input.isZh);
            if (!tid) {
              warnings.push(
                input.isZh
                  ? `工作表「${sheetName}」第 ${ri + 1} 行成员：未登记教师「${name}」，已跳过`
                  : `Sheet "${sheetName}" row ${ri + 1}: member "${name}" not registered, skipped`,
              );
              continue;
            }
            if (!memberIds.includes(tid)) memberIds.push(tid);
          }
          teachingMemberOps.push({
            groupId: group.id,
            groupLabel: group.nameZh,
            teacherIds: memberIds,
          });
        }
      }
      continue;
    }

    if (classified.kind === 'grade') {
      const sh = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
        header: 1,
        defval: '',
      }) as string[][];
      if (data.length < 2) continue;
      if (!isHeaderRow(data[0] as unknown[])) {
        errors.push(
          input.isZh
            ? `工作表「${sheetName}」缺少表头（首列应为「年级」）`
            : `Sheet "${sheetName}" missing header row`,
        );
        continue;
      }
      const headers = (data[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colHomeroom = headers.findIndex((h) => HOMEROOM_HEADERS.has(h) || HOMEROOM_HEADERS.has(h.toLowerCase()));
      const colGradeHead = headers.findIndex(
        (h) => GRADE_HEAD_HEADERS.has(h) || GRADE_HEAD_HEADERS.has(h.toLowerCase()),
      );
      let lastGradeLevel: number | null = null;
      for (let ri = 1; ri < data.length; ri += 1) {
        const row = data[ri] as unknown[];
        const gradeCell = String(row[0] ?? '').trim();
        const classCell = String(row[1] ?? '').trim();
        if (!classCell && !gradeCell) continue;
        if (!classCell) continue;
        const parsedGrade = parseGradeLevelFromCell(gradeCell, gc);
        if (parsedGrade != null) lastGradeLevel = parsedGrade;
        const gradeLevel = lastGradeLevel;
        if (gradeLevel == null) continue;
        const cls = input.allClasses.find(
          (c) =>
            c.academicYearId === input.academicYearId &&
            c.grade === gradeLevel &&
            c.name.trim() === classCell,
        );
        if (!cls) {
          errors.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未找到班级「G${gradeLevel} ${classCell}」`
              : `Sheet "${sheetName}" row ${ri + 1}: class not found (${gradeLevel} ${classCell})`,
          );
          continue;
        }
        if (colHomeroom >= 0) {
          const homeroomName = parseTeacherNameFromRosterCellSegment(String(row[colHomeroom] ?? '').trim());
          const tid = homeroomName ? resolveStaffingTeacherId(homeroomName, input.teachers, input.isZh) : null;
          if (homeroomName && !tid) {
            warnings.push(
              input.isZh
                ? `工作表「${sheetName}」第 ${ri + 1} 行班主任：未登记教师「${homeroomName}」，已留空`
                : `Sheet "${sheetName}" row ${ri + 1}: homeroom "${homeroomName}" not registered, left blank`,
            );
          }
          operations.push({
            academicYearId: input.academicYearId,
            classId: cls.id,
            subjectKey: STAFFING_HOMEROOM_SUBJECT_KEY,
            subjectName: staffingHomeroomSubjectName(input.isZh),
            teacherId: tid,
            teacherSlot: 0,
            coTeaching: false,
          });
        }
        if (colGradeHead >= 0) {
          const scopeKey = getGradeCatalogIdForClass(gc, cls.grade, { className: cls.name });
          const scopeLabel = getSchoolGradeLabelForClass(cls);
          if (!gradeHeadWritten.has(scopeKey)) {
            gradeHeadWritten.add(scopeKey);
            const headName = parseTeacherNameFromRosterCellSegment(String(row[colGradeHead] ?? '').trim());
            const headId = headName ? resolveStaffingTeacherId(headName, input.teachers, input.isZh) : null;
            if (headName && !headId) {
              warnings.push(
                input.isZh
                  ? `工作表「${sheetName}」第 ${ri + 1} 行年级组长：未登记教师「${headName}」，已留空`
                  : `Sheet "${sheetName}" row ${ri + 1}: grade head "${headName}" not registered, left blank`,
              );
            }
            functionalRoleOps.push({
              academicYearId: input.academicYearId,
              roleType: 'grade-head',
              scopeKey,
              scopeLabel,
              teacherId: headId,
            });
          }
        }
      }
      continue;
    }

    if (classified.kind === 'course') {
      const segmentSheet = resolveCourseSheet(classified.segmentLabel, sheetName);
      if (!segmentSheet) {
        warnings.push(
          input.isZh
            ? `已跳过工作表「${sheetName}」（与当前课程岗位学段不一致）`
            : `Skipped sheet "${sheetName}" (no matching course segment)`,
        );
        continue;
      }

      const sh = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
        header: 1,
        defval: '',
      }) as string[][];
      if (data.length < 2) continue;

      if (!isHeaderRow(data[0] as unknown[])) {
        errors.push(
          input.isZh
            ? `工作表「${sheetName}」缺少表头（首列应为「年级」）`
            : `Sheet "${sheetName}" missing header row`,
        );
        continue;
      }

      const headers = (data[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colHomeroom = headers.findIndex((h) => HOMEROOM_HEADERS.has(h) || HOMEROOM_HEADERS.has(h.toLowerCase()));
      const courseColMeta: Array<{ colIdx: number; course: Course; key: string; coTeaching: boolean }> = [];
      const skippedInSheet = new Set<string>();

      for (let ci = 0; ci < headers.length; ci += 1) {
        if (ci < 2) continue;
        if (ci === colHomeroom) continue;
        const h = headers[ci];
        if (!h) continue;
        if (GRADE_HEAD_HEADERS.has(h) || GRADE_HEAD_HEADERS.has(h.toLowerCase())) continue;
        const course = findCourseByHeader(h, input.courses, input.isZh);
        if (!course) {
          skippedInSheet.add(h);
          skippedUnknownCoursesAll.add(h);
          continue;
        }
        courseColMeta.push({
          colIdx: ci,
          course,
          key: staffingSubjectKeyFromCourse(course.id, course.name),
          coTeaching: Boolean(course.coTeaching),
        });
      }

      for (const name of skippedInSheet) {
        warnings.push(
          input.isZh
            ? `工作表「${sheetName}」：课程「${name}」在系统中不存在，已跳过该列（请先在课程管理中创建）`
            : `Sheet "${sheetName}": course "${name}" not found, column skipped`,
        );
      }

      let lastGradeLevel: number | null = null;
      for (let ri = 1; ri < data.length; ri += 1) {
        const row = data[ri] as unknown[];
        const gradeCell = String(row[0] ?? '').trim();
        const classCell = String(row[1] ?? '').trim();
        if (!classCell && !gradeCell) continue;
        if (!classCell) continue;

        const parsedGrade = parseGradeLevelFromCell(gradeCell, gc);
        if (parsedGrade != null) lastGradeLevel = parsedGrade;
        const gradeLevel = lastGradeLevel;
        if (gradeLevel == null) {
          errors.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：无法识别年级「${gradeCell}」`
              : `Sheet "${sheetName}" row ${ri + 1}: unknown grade "${gradeCell}"`,
          );
          continue;
        }

        const cls = input.allClasses.find(
          (c) =>
            c.academicYearId === input.academicYearId &&
            c.grade === gradeLevel &&
            c.name.trim() === classCell,
        );
        if (!cls) {
          errors.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未找到班级「G${gradeLevel} ${classCell}」`
              : `Sheet "${sheetName}" row ${ri + 1}: class not found (${gradeLevel} ${classCell})`,
          );
          continue;
        }

        if (colHomeroom >= 0) {
          const cell = String(row[colHomeroom] ?? '').trim();
          const homeroomName = parseTeacherNameFromRosterCellSegment(cell);
          const tid = homeroomName ? resolveStaffingTeacherId(homeroomName, input.teachers, input.isZh) : null;
          if (homeroomName && !tid) {
            warnings.push(
              input.isZh
                ? `工作表「${sheetName}」第 ${ri + 1} 行班主任：未登记教师「${homeroomName}」，已留空`
                : `Sheet "${sheetName}" row ${ri + 1}: homeroom teacher "${homeroomName}" not registered, left blank`,
            );
          }
          operations.push({
            academicYearId: input.academicYearId,
            classId: cls.id,
            subjectKey: STAFFING_HOMEROOM_SUBJECT_KEY,
            subjectName: staffingHomeroomSubjectName(input.isZh),
            teacherId: tid,
            teacherSlot: 0,
            coTeaching: false,
          });
        }

        for (const meta of courseColMeta) {
          const curriculumLevel = getCurriculumGradeLevelForClass(gc, cls);
          if (!courseAppliesToGrade(meta.course, curriculumLevel, gc)) continue;
          const cell = String(row[meta.colIdx] ?? '').trim();
          const names = parseTeacherSlotsFromCell(cell);
          const slots: (0 | 1)[] = meta.coTeaching ? [0, 1] : [0];
          const colLabel = staffingCourseExcelHeader(meta.course, input.isZh);
          for (let si = 0; si < slots.length; si += 1) {
            const slot = slots[si];
            const name = names[si] ?? '';
            const tid = name ? resolveStaffingTeacherId(name, input.teachers, input.isZh) : null;
            if (name && !tid) {
              warnings.push(
                input.isZh
                  ? `工作表「${sheetName}」第 ${ri + 1} 行「${colLabel}」：未登记教师「${name}」，已留空`
                  : `Sheet "${sheetName}" row ${ri + 1} "${colLabel}": teacher "${name}" not registered, left blank`,
              );
            }
            const subjectName =
              getSubjectCategoryText(meta.course.subjectCategory, input.isZh ? 'zh' : 'en') || meta.course.name;
            operations.push({
              academicYearId: input.academicYearId,
              classId: cls.id,
              subjectKey: meta.key,
              subjectName,
              teacherId: tid,
              teacherSlot: slot,
              coTeaching: meta.coTeaching,
            });
          }
        }
      }
    }
  }

  return {
    operations,
    functionalRoleOps,
    teachingMemberOps,
    errors,
    warnings,
    skippedUnknownCourses: [...skippedUnknownCoursesAll],
  };
}

export function parseStaffingRosterWorkbook(
  arrayBuffer: ArrayBuffer,
  input: {
    academicYearId: string;
    sheets: readonly StaffingRosterSegmentSheet[];
    allClasses: readonly ClassItem[];
    courses: readonly Course[];
    teachers: readonly StaffingRosterTeacherRef[];
    gradeConfig: GradeConfig;
    isZh: boolean;
  },
): StaffingRosterImportResult {
  const result = parseStaffingPackageWorkbook(arrayBuffer, {
    ...input,
    courseSheets: input.sheets,
    gradeBlocks: [],
    teachingGroups: [],
  });
  return {
    operations: result.operations,
    errors: result.errors,
    warnings: result.warnings,
    skippedUnknownCourses: result.skippedUnknownCourses,
  };
}

export function downloadWeeklyLoadExport(input: {
  academicYearLabel: string;
  isZh: boolean;
  rows: ReadonlyArray<{
    teacherName: string;
    primarySubjectLabel: string;
    detail: string;
    total: number;
  }>;
}): void {
  const staffCol = input.isZh ? '教职工' : 'Staff';
  const primaryCol = input.isZh ? '主学科' : 'Primary subject';
  const detailCol = input.isZh ? '课时构成' : 'Breakdown';
  const totalCol = input.isZh ? '周课时（节/周）' : 'Periods / week';
  const header = [staffCol, primaryCol, detailCol, totalCol];
  const body = input.rows.map((r) => [
    r.teacherName,
    r.primarySubjectLabel,
    r.detail,
    String(r.total),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  const sheetName = input.isZh ? '周课时统计' : 'Weekly load';
  XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(sheetName));
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = input.isZh
    ? `周课时统计-${input.academicYearLabel}-${stamp}.xlsx`
    : `weekly-load-${input.academicYearLabel}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
