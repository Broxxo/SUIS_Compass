/**
 * 岗位安排 Excel 导入/导出（多模块分 sheet）
 *
 * Sheet 命名：
 * - 年级管理：年级、班级、班主任、年级组长（全校各学段合并在同一 sheet）
 * - 教学管理：学科组、学段、学科、学科组长、成员（、分隔）；导入时若学科组不存在则自动新建
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
import { createTeachingSubjectGroupId, type TeachingSubjectGroup } from '@repo/shared';
import type { Course, GradeConfig } from '../types';
import type { ClassItem } from '../types/classManagement';
import { STAFFING_HOMEROOM_SUBJECT_KEY, staffingHomeroomSubjectName, staffingSubjectKeyFromCourse } from '@repo/shared';
import { SELF_STUDY_WEEKDAY_LABELS, selfStudyWeekdayLabel } from '@repo/shared';
import { electiveDurationTypeLabel, parseElectiveDurationPeriods } from '@repo/shared';
import {
  getCurriculumGradeLevelForClass,
  getGradeCatalogIdForClass,
  getRoadmapSegmentsInDisplayOrder,
  getSchoolGradeLabelForClass,
  normalizeGradeConfig,
  getGradeLabelByLevel,
} from './gradeConfig';
import { getCourseReportSubjectLabels } from '@repo/shared';
import { getSubjectCategoryText } from './utils';
import { courseAppliesToGrade, getWeeklyPeriodsForGrade } from './courseGradeUtils';
import {
  formatTeachingGroupSegmentLabels,
  formatTeachingGroupSubjectLabels,
  type SubjectOption,
} from './teachingSubjectGroupUtils';

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
  newTeachingGroups: TeachingSubjectGroup[];
};

export type SelfStudySlotImportOp = {
  moduleName: string;
  grade: number;
  className: string;
  classId: string | null;
  weekday: number;
  teacherId: string | null;
};

export type ElectiveCourseImportOp = {
  name: string;
  applicableGrades: string[];
  durationPeriods: 1 | 2;
  teacherId: string | null;
  teacher2Id: string | null;
  capacity: number;
  location: string;
};

export type StaffingKeyRolesImportResult = {
  functionalRoleOps: FunctionalRoleImportOp[];
  teachingMemberOps: TeachingMembersImportOp[];
  /** 导入过程中自动新建的学科组（须先写入 school_settings 再应用组长/成员） */
  newTeachingGroups: TeachingSubjectGroup[];
  operations: StaffingRosterAssignmentOp[];
  errors: string[];
  warnings: string[];
};

export type StaffingCourseJobsImportResult = StaffingRosterImportResult & {
  selfStudySlotOps: SelfStudySlotImportOp[];
  electiveCourseOps: ElectiveCourseImportOp[];
};

const GRADE_HEAD_HEADERS = new Set(['年级组长', 'grade head', 'grade-head', 'grade leader']);
const GROUP_HEADERS = new Set(['学科组', 'group', 'subject group', 'teaching group']);
const LEAD_HEADERS = new Set(['学科组长', 'group lead', 'subject group lead', 'lead']);
const MEMBERS_HEADERS = new Set(['成员', 'members', 'teachers']);
const SEGMENT_HEADERS = new Set(['学段', 'segments', 'school segment', 'segment']);
const SUBJECTS_HEADERS = new Set(['学科', 'subjects', 'subject keys', 'subject']);

function splitTeachingMgmtListCell(raw: string): string[] {
  return raw
    .split(/[、;；,，\n/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTeachingSegmentIdsFromCell(
  cell: string,
  gradeConfig: GradeConfig,
  isZh: boolean,
): string[] {
  const labels = splitTeachingMgmtListCell(cell);
  if (labels.length === 0) return [];
  const wholeSchool = isZh ? '全校' : 'Whole school';
  if (labels.length === 1 && labels[0] === wholeSchool) return [];
  const segments = getRoadmapSegmentsInDisplayOrder(normalizeGradeConfig(gradeConfig));
  const byLabel = new Map(segments.map((s) => [s.label.trim(), s.id]));
  const ids: string[] = [];
  for (const label of labels) {
    const id = byLabel.get(label);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function parseTeachingSubjectKeysFromCell(
  cell: string,
  subjectOptions: readonly SubjectOption[],
): string[] {
  const labels = splitTeachingMgmtListCell(cell);
  if (labels.length === 0) return [];
  const byLabel = new Map(subjectOptions.map((o) => [o.label.trim(), o.key]));
  const byKey = new Map(subjectOptions.map((o) => [o.key.trim(), o.key]));
  const keys: string[] = [];
  for (const label of labels) {
    const key = byLabel.get(label) ?? byKey.get(label);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** 从组名推断学科（如「数学组」「小学数学组」→ 数学） */
function inferTeachingSubjectKeysFromGroupName(
  groupName: string,
  subjectOptions: readonly SubjectOption[],
): string[] {
  const trimmed = groupName.trim();
  if (!trimmed) return [];
  const candidates = [trimmed, trimmed.replace(/组$/u, '').trim()].filter(Boolean);
  const sorted = [...subjectOptions].sort((a, b) => b.label.length - a.label.length);
  for (const cand of candidates) {
    const keys: string[] = [];
    for (const opt of sorted) {
      const label = opt.label.trim();
      if (!label) continue;
      if (cand === label || cand.endsWith(label) || cand.includes(label)) {
        if (!keys.includes(opt.key)) keys.push(opt.key);
      }
    }
    if (keys.length > 0) return keys;
  }
  return [];
}

type TeachingGroupImportContext = {
  groupsByName: Map<string, TeachingSubjectGroup>;
  newGroups: TeachingSubjectGroup[];
  subjectOptions: readonly SubjectOption[];
  gradeConfig: GradeConfig;
  isZh: boolean;
};

function resolveOrCreateTeachingGroup(
  groupName: string,
  row: unknown[],
  colSegment: number,
  colSubjects: number,
  ctx: TeachingGroupImportContext,
  meta: { sheetName: string; rowIndex: number; warnings: string[] },
): TeachingSubjectGroup {
  const name = groupName.trim();
  const existing = ctx.groupsByName.get(name);
  if (existing) return existing;

  const segmentIds =
    colSegment >= 0
      ? parseTeachingSegmentIdsFromCell(String(row[colSegment] ?? ''), ctx.gradeConfig, ctx.isZh)
      : [];
  let subjectKeys =
    colSubjects >= 0
      ? parseTeachingSubjectKeysFromCell(String(row[colSubjects] ?? ''), ctx.subjectOptions)
      : [];
  if (subjectKeys.length === 0) {
    subjectKeys = inferTeachingSubjectKeysFromGroupName(name, ctx.subjectOptions);
  }

  const group: TeachingSubjectGroup = {
    id: createTeachingSubjectGroupId(),
    nameZh: name,
    segmentIds,
    subjectKeys,
    sortOrder: (ctx.groupsByName.size + 1) * 10,
  };
  ctx.groupsByName.set(name, group);
  ctx.newGroups.push(group);
  meta.warnings.push(
    ctx.isZh
      ? `工作表「${meta.sheetName}」第 ${meta.rowIndex + 1} 行：学科组「${name}」不存在，已自动新建`
      : `Sheet "${meta.sheetName}" row ${meta.rowIndex + 1}: created new group "${name}"`,
  );
  return group;
}

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

function selfStudySheetName(isZh: boolean): string {
  return isZh ? '自习' : 'Self-study';
}

function electiveCoursesSheetName(isZh: boolean): string {
  return isZh ? '选修' : 'Elective';
}

function writeWorkbookDownload(wb: XLSX.WorkBook, filename: string): void {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseSelfStudyWeekday(cell: string): number | null {
  const t = cell.trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= 7) return n;
  for (const [wd, labels] of Object.entries(SELF_STUDY_WEEKDAY_LABELS)) {
    if (labels.zh === t || labels.en === t || labels.en.toLowerCase() === t.toLowerCase()) {
      return Number(wd);
    }
  }
  return null;
}

function formatElectiveApplicableGradesForExcel(applicableGrades: readonly string[], gradeConfig: GradeConfig): string {
  const gc = normalizeGradeConfig(gradeConfig);
  const byId = new Map(gc.items.map((item) => [item.id, item.label]));
  return applicableGrades.map((id) => byId.get(id) ?? id).join('、');
}

function parseElectiveApplicableGradesFromExcel(cell: string, gradeConfig: GradeConfig): string[] {
  const raw = cell.trim();
  if (!raw) return [];
  const gc = normalizeGradeConfig(gradeConfig);
  const labels = raw.split(/[、;；,，\n]/).map((s) => s.trim()).filter(Boolean);
  const byLabel = new Map(gc.items.map((item) => [item.label.trim(), item.id]));
  const ids: string[] = [];
  for (const label of labels) {
    const id = byLabel.get(label);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
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
  | { kind: 'self-study' }
  | { kind: 'elective-config' }
  | { kind: 'elective-courses' }
  | { kind: 'unknown' };

function classifyStaffingSheet(sheetName: string, isZh: boolean): SheetKind {
  const sn = sheetName.trim();
  const gradePrefix = staffingSheetPrefix('grade', isZh);
  const coursePrefix = staffingSheetPrefix('course', isZh);
  const teachingName = staffingTeachingSheetName(isZh);
  const selfStudyName = selfStudySheetName(isZh);
  const electiveCoursesName = electiveCoursesSheetName(isZh);
  if (sn === teachingName || sn.toLowerCase() === 'teaching mgmt') return { kind: 'teaching' };
  if (sn === selfStudyName || sn.toLowerCase() === 'self-study') return { kind: 'self-study' };
  if (sn === (isZh ? '选修-周节数' : 'Elective-weekly') || sn.toLowerCase() === 'elective-weekly') {
    return { kind: 'elective-config' };
  }
  if (sn === electiveCoursesName || sn.toLowerCase() === 'elective') return { kind: 'elective-courses' };
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
 * 导出关键岗位：年级管理 + 教学管理。
 */
export function downloadStaffingKeyRolesExport(input: {
  academicYearLabel: string;
  isZh: boolean;
  gradeConfig: GradeConfig;
  subjectOptions: readonly SubjectOption[];
  teachers: readonly StaffingRosterTeacherRef[];
  gradeBlocks: readonly StaffingGradeMgmtBlock[];
  homeroomByClassId: ReadonlyMap<string, string>;
  gradeHeadByScopeKey: ReadonlyMap<string, string>;
  teachingGroups: readonly TeachingSubjectGroup[];
  subjectGroupLeadByGroupId: ReadonlyMap<string, string>;
  membersByGroupId: ReadonlyMap<string, string[]>;
}): void {
  const wb = XLSX.utils.book_new();
  appendGradeMgmtSheet(wb, input);
  appendTeachingMgmtSheet(wb, input);
  const stamp = new Date().toISOString().slice(0, 10);
  writeWorkbookDownload(
    wb,
    input.isZh
      ? `关键岗位-${input.academicYearLabel}-${stamp}.xlsx`
      : `key-roles-${input.academicYearLabel}-${stamp}.xlsx`,
  );
}

/**
 * 导出任课岗位：课程岗位 + 自习 + 选修（按学年）。
 */
export function downloadStaffingCourseJobsExport(input: {
  academicYearLabel: string;
  isZh: boolean;
  gradeConfig: GradeConfig;
  teachers: readonly StaffingRosterTeacherRef[];
  courseSheets: readonly StaffingRosterSegmentSheet[];
  courseAssignments: ReadonlyMap<string, { teacherId: string }>;
  selfStudyModules: ReadonlyArray<{ id: string; name: string }>;
  selfStudySlots: ReadonlyArray<{
    moduleId: string;
    classId: string;
    grade: number;
    weekday: number;
    teacherId: string | null;
  }>;
  allClasses: readonly ClassItem[];
  electiveCourses: ReadonlyArray<{
    name: string;
    applicableGrades: readonly string[];
    durationPeriods: 1 | 2;
    teacherId: string | null;
    teacher2Id?: string | null;
    capacity: number;
    location: string;
  }>;
}): void {
  const wb = XLSX.utils.book_new();
  appendCourseSegmentSheets(wb, input);
  appendSelfStudySheet(wb, input);
  appendElectiveSheets(wb, input);
  const stamp = new Date().toISOString().slice(0, 10);
  writeWorkbookDownload(
    wb,
    input.isZh
      ? `任课岗位-${input.academicYearLabel}-${stamp}.xlsx`
      : `course-jobs-${input.academicYearLabel}-${stamp}.xlsx`,
  );
}

/**
 * 导出岗位安排整包（兼容旧版）：年级管理 / 教学管理 / 课程岗位 分 sheet。
 */
export function downloadStaffingPackageExport(input: {
  academicYearLabel: string;
  isZh: boolean;
  gradeConfig: GradeConfig;
  subjectOptions: readonly SubjectOption[];
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
  appendGradeMgmtSheet(wb, input);
  appendTeachingMgmtSheet(wb, input);
  appendCourseSegmentSheets(wb, input);
  const stamp = new Date().toISOString().slice(0, 10);
  writeWorkbookDownload(
    wb,
    input.isZh
      ? `岗位安排-${input.academicYearLabel}-${stamp}.xlsx`
      : `staffing-roster-${input.academicYearLabel}-${stamp}.xlsx`,
  );
}

function appendGradeMgmtSheet(
  wb: XLSX.WorkBook,
  input: {
    isZh: boolean;
    gradeConfig: GradeConfig;
    teachers: readonly StaffingRosterTeacherRef[];
    gradeBlocks: readonly StaffingGradeMgmtBlock[];
    homeroomByClassId: ReadonlyMap<string, string>;
    gradeHeadByScopeKey: ReadonlyMap<string, string>;
  },
): void {
  const gc = normalizeGradeConfig(input.gradeConfig);
  const gradeCol = input.isZh ? '年级' : 'Grade';
  const classCol = input.isZh ? '班级' : 'Class';
  const homeroomHeader = staffingHomeroomSubjectName(input.isZh);
  const gradeHeadCol = input.isZh ? '年级组长' : 'Grade head';
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

function appendTeachingMgmtSheet(
  wb: XLSX.WorkBook,
  input: {
    isZh: boolean;
    gradeConfig: GradeConfig;
    subjectOptions: readonly SubjectOption[];
    teachers: readonly StaffingRosterTeacherRef[];
    teachingGroups: readonly TeachingSubjectGroup[];
    subjectGroupLeadByGroupId: ReadonlyMap<string, string>;
    membersByGroupId: ReadonlyMap<string, string[]>;
  },
): void {
  const groupCol = input.isZh ? '学科组' : 'Group';
  const segmentCol = input.isZh ? '学段' : 'Segments';
  const subjectsCol = input.isZh ? '学科' : 'Subjects';
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
      formatTeachingGroupSegmentLabels(g.segmentIds, input.gradeConfig, input.isZh),
      formatTeachingGroupSubjectLabels(g.subjectKeys, input.subjectOptions, input.isZh) ?? '',
      leadT ? teacherDisplayName(leadT, input.isZh) : '',
      memberNames.join(input.isZh ? '、' : '; '),
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([[groupCol, segmentCol, subjectsCol, leadCol, membersCol], ...teachingRows]);
  XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(staffingTeachingSheetName(input.isZh)));
}

function appendCourseSegmentSheets(
  wb: XLSX.WorkBook,
  input: {
    isZh: boolean;
    gradeConfig: GradeConfig;
    teachers: readonly StaffingRosterTeacherRef[];
    courseSheets: readonly StaffingRosterSegmentSheet[];
    courseAssignments: ReadonlyMap<string, { teacherId: string }>;
  },
): void {
  const gc = normalizeGradeConfig(input.gradeConfig);
  const gradeCol = input.isZh ? '年级' : 'Grade';
  const classCol = input.isZh ? '班级' : 'Class';
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
}

function appendSelfStudySheet(
  wb: XLSX.WorkBook,
  input: {
    isZh: boolean;
    gradeConfig: GradeConfig;
    teachers: readonly StaffingRosterTeacherRef[];
    selfStudyModules: ReadonlyArray<{ id: string; name: string }>;
    selfStudySlots: ReadonlyArray<{
      moduleId: string;
      classId: string;
      grade: number;
      weekday: number;
      teacherId: string | null;
    }>;
    allClasses: readonly ClassItem[];
  },
): void {
  const gc = normalizeGradeConfig(input.gradeConfig);
  const moduleCol = input.isZh ? '模块' : 'Module';
  const gradeCol = input.isZh ? '年级' : 'Grade';
  const classCol = input.isZh ? '班级' : 'Class';
  const weekdayCol = input.isZh ? '星期' : 'Weekday';
  const teacherCol = input.isZh ? '教师' : 'Teacher';
  const moduleNameById = new Map(input.selfStudyModules.map((m) => [m.id, m.name]));
  const classById = new Map(input.allClasses.map((c) => [c.id, c]));
  const rows = [...input.selfStudySlots]
    .sort((a, b) => {
      const clsA = classById.get(a.classId);
      const clsB = classById.get(b.classId);
      const ga = clsA?.grade ?? a.grade;
      const gb = clsB?.grade ?? b.grade;
      const na = clsA?.name ?? '';
      const nb = clsB?.name ?? '';
      return ga - gb || na.localeCompare(nb, undefined, { numeric: true }) || a.weekday - b.weekday;
    })
    .map((slot) => {
      const cls = classById.get(slot.classId);
      const grade = cls?.grade ?? slot.grade;
      const t = slot.teacherId ? input.teachers.find((x) => x.id === slot.teacherId) : undefined;
      return [
        moduleNameById.get(slot.moduleId) ?? '',
        getGradeLabelByLevel(gc, grade) || `G${grade}`,
        cls?.name ?? '',
        selfStudyWeekdayLabel(slot.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7, input.isZh),
        t ? teacherDisplayName(t, input.isZh) : '',
      ];
    });
  const ws = XLSX.utils.aoa_to_sheet([[moduleCol, gradeCol, classCol, weekdayCol, teacherCol], ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(selfStudySheetName(input.isZh)));
}

function appendElectiveSheets(
  wb: XLSX.WorkBook,
  input: {
    isZh: boolean;
    gradeConfig: GradeConfig;
    teachers: readonly StaffingRosterTeacherRef[];
    electiveCourses: ReadonlyArray<{
      name: string;
      applicableGrades: readonly string[];
      durationPeriods: 1 | 2;
      teacherId: string | null;
      teacher2Id?: string | null;
      capacity: number;
      location: string;
    }>;
  },
): void {
  const nameCol = input.isZh ? '课程' : 'Course';
  const gradesCol = input.isZh ? '开设年级' : 'Grades';
  const durationCol = input.isZh ? '时长类型' : 'Duration type';
  const teacherCol = input.isZh ? '教师1' : 'Teacher 1';
  const teacher2Col = input.isZh ? '教师2' : 'Teacher 2';
  const capacityCol = input.isZh ? '容量' : 'Capacity';
  const locationCol = input.isZh ? '地点' : 'Location';
  const courseRows = input.electiveCourses.map((course) => {
    const t1 = course.teacherId ? input.teachers.find((x) => x.id === course.teacherId) : undefined;
    const t2 = course.teacher2Id ? input.teachers.find((x) => x.id === course.teacher2Id) : undefined;
    return [
      course.name,
      formatElectiveApplicableGradesForExcel(course.applicableGrades ?? [], input.gradeConfig),
      electiveDurationTypeLabel(course.durationPeriods, input.isZh),
      t1 ? teacherDisplayName(t1, input.isZh) : '',
      t2 ? teacherDisplayName(t2, input.isZh) : '',
      course.capacity,
      course.location,
    ];
  });
  const coursesWs = XLSX.utils.aoa_to_sheet([
    [nameCol, gradesCol, durationCol, teacherCol, teacher2Col, capacityCol, locationCol],
    ...courseRows,
  ]);
  XLSX.utils.book_append_sheet(wb, coursesWs, sanitizeExcelSheetName(electiveCoursesSheetName(input.isZh)));
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
    subjectOptions: [],
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
    subjectOptions?: readonly SubjectOption[];
    allClasses: readonly ClassItem[];
    courses: readonly Course[];
    teachers: readonly StaffingRosterTeacherRef[];
    gradeConfig: GradeConfig;
    isZh: boolean;
    scope?: 'full' | 'key-roles' | 'course-jobs';
    selfStudyModules?: ReadonlyArray<{ id: string; name: string }>;
  },
): StaffingPackageImportResult & {
  selfStudySlotOps: SelfStudySlotImportOp[];
  electiveCourseOps: ElectiveCourseImportOp[];
} {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const operations: StaffingRosterAssignmentOp[] = [];
  const functionalRoleOps: FunctionalRoleImportOp[] = [];
  const teachingMemberOps: TeachingMembersImportOp[] = [];
  const newTeachingGroups: TeachingSubjectGroup[] = [];
  const selfStudySlotOps: SelfStudySlotImportOp[] = [];
  const electiveCourseOps: ElectiveCourseImportOp[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const skippedUnknownCoursesAll = new Set<string>();
  const gc = normalizeGradeConfig(input.gradeConfig);
  const gradeHeadWritten = new Set<string>();
  const scope = input.scope ?? 'full';
  const subjectOptions = input.subjectOptions ?? [];
  const teachingGroupCtx: TeachingGroupImportContext = {
    groupsByName: new Map(input.teachingGroups.map((g) => [g.nameZh.trim(), g])),
    newGroups: newTeachingGroups,
    subjectOptions,
    gradeConfig: input.gradeConfig,
    isZh: input.isZh,
  };

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
      if (scope === 'course-jobs') continue;
      const sh = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
        header: 1,
        defval: '',
      }) as string[][];
      if (data.length < 2) continue;
      const headers = (data[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colGroup = headers.findIndex((h) => GROUP_HEADERS.has(h) || GROUP_HEADERS.has(h.toLowerCase()));
      const colSegment = headers.findIndex(
        (h) => SEGMENT_HEADERS.has(h) || SEGMENT_HEADERS.has(h.toLowerCase()),
      );
      const colSubjects = headers.findIndex(
        (h) => SUBJECTS_HEADERS.has(h) || SUBJECTS_HEADERS.has(h.toLowerCase()),
      );
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
        const group = resolveOrCreateTeachingGroup(
          groupName,
          row,
          colSegment,
          colSubjects,
          teachingGroupCtx,
          { sheetName, rowIndex: ri, warnings },
        );
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
      if (scope === 'course-jobs') continue;
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
      if (scope === 'key-roles') continue;
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
      continue;
    }

    if (classified.kind === 'self-study') {
      if (scope === 'key-roles') continue;
      const sh = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
        header: 1,
        defval: '',
      }) as string[][];
      if (data.length < 2) continue;
      const headers = (data[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colModule = headers.findIndex((h) => h === '模块' || h.toLowerCase() === 'module');
      const colGrade = headers.findIndex((h) => GRADE_HEADERS.has(h) || h.toLowerCase() === 'grade');
      const colClass = headers.findIndex((h) => CLASS_HEADERS.has(h) || h.toLowerCase() === 'class');
      const colWeekday = headers.findIndex((h) => h === '星期' || h.toLowerCase() === 'weekday');
      const colTeacher = headers.findIndex((h) => h === '教师' || h.toLowerCase() === 'teacher');
      if (colModule < 0 || colGrade < 0 || colClass < 0 || colWeekday < 0) {
        errors.push(
          input.isZh
            ? `工作表「${sheetName}」缺少必要列（模块/年级/班级/星期）`
            : `Sheet "${sheetName}" missing required columns`,
        );
        continue;
      }
      for (let ri = 1; ri < data.length; ri += 1) {
        const row = data[ri] as unknown[];
        const moduleName = String(row[colModule] ?? '').trim();
        const gradeCell = String(row[colGrade] ?? '').trim();
        const classCell = String(row[colClass] ?? '').trim();
        const weekdayCell = String(row[colWeekday] ?? '').trim();
        if (!moduleName && !gradeCell && !classCell && !weekdayCell) continue;
        if (!moduleName || !gradeCell || !classCell || !weekdayCell) continue;
        const grade = parseGradeLevelFromCell(gradeCell, gc);
        const weekday = parseSelfStudyWeekday(weekdayCell);
        if (grade == null) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：无法识别年级「${gradeCell}」，已跳过`
              : `Sheet "${sheetName}" row ${ri + 1}: grade "${gradeCell}" not recognized, skipped`,
          );
          continue;
        }
        if (weekday == null) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：无法识别星期「${weekdayCell}」，已跳过`
              : `Sheet "${sheetName}" row ${ri + 1}: weekday "${weekdayCell}" not recognized, skipped`,
          );
          continue;
        }
        const cls = input.allClasses.find(
          (c) =>
            c.academicYearId === input.academicYearId &&
            c.grade === grade &&
            c.name.trim() === classCell,
        );
        if (!cls) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未找到班级「${gradeCell} ${classCell}」，已跳过`
              : `Sheet "${sheetName}" row ${ri + 1}: class "${gradeCell} ${classCell}" not found, skipped`,
          );
          continue;
        }
        const moduleHit = (input.selfStudyModules ?? []).find((m) => m.name.trim() === moduleName);
        if (!moduleHit) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未找到自习模块「${moduleName}」，已跳过（请先在界面创建模块）`
              : `Sheet "${sheetName}" row ${ri + 1}: self-study module "${moduleName}" not found, skipped`,
          );
          continue;
        }
        const teacherName =
          colTeacher >= 0 ? parseTeacherNameFromRosterCellSegment(String(row[colTeacher] ?? '').trim()) : '';
        const tid = teacherName ? resolveStaffingTeacherId(teacherName, input.teachers, input.isZh) : null;
        if (teacherName && !tid) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未登记教师「${teacherName}」，已留空`
              : `Sheet "${sheetName}" row ${ri + 1}: teacher "${teacherName}" not registered, left blank`,
          );
        }
        selfStudySlotOps.push({
          moduleName,
          grade,
          className: classCell,
          classId: cls.id,
          weekday,
          teacherId: tid,
        });
      }
      continue;
    }

    if (classified.kind === 'elective-config') {
      continue;
    }

    if (classified.kind === 'elective-courses') {
      if (scope === 'key-roles') continue;
      const sh = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
        header: 1,
        defval: '',
      }) as string[][];
      if (data.length < 2) continue;
      const headers = (data[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colName = headers.findIndex((h) => h === '课程' || h.toLowerCase() === 'course');
      const colGrades = headers.findIndex((h) => h === '开设年级' || h.toLowerCase() === 'grades');
      const colDuration = headers.findIndex(
        (h) => h.includes('时长') || h.toLowerCase().includes('duration'),
      );
      const colTeacher = headers.findIndex((h) => h === '教师1' || h.toLowerCase() === 'teacher 1');
      const colTeacher2 = headers.findIndex((h) => h === '教师2' || h.toLowerCase() === 'teacher 2');
      const colCapacity = headers.findIndex((h) => h === '容量' || h.toLowerCase() === 'capacity');
      const colLocation = headers.findIndex((h) => h === '地点' || h.toLowerCase() === 'location');
      if (colName < 0) {
        errors.push(
          input.isZh ? `工作表「${sheetName}」缺少「课程」列` : `Sheet "${sheetName}" missing course column`,
        );
        continue;
      }
      for (let ri = 1; ri < data.length; ri += 1) {
        const row = data[ri] as unknown[];
        const name = String(row[colName] ?? '').trim();
        if (!name) continue;
        const gradesCell = colGrades >= 0 ? String(row[colGrades] ?? '').trim() : '';
        const applicableGrades = parseElectiveApplicableGradesFromExcel(gradesCell, gc);
        if (colGrades >= 0 && gradesCell && applicableGrades.length === 0) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行开设年级：无法识别「${gradesCell}」，已跳过该行`
              : `Sheet "${sheetName}" row ${ri + 1}: grades "${gradesCell}" not recognized, row skipped`,
          );
          continue;
        }
        if (colGrades >= 0 && applicableGrades.length === 0) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行：未填写开设年级，已跳过`
              : `Sheet "${sheetName}" row ${ri + 1}: missing grades, skipped`,
          );
          continue;
        }
        const durationPeriods = parseElectiveDurationPeriods(colDuration >= 0 ? row[colDuration] : 1);
        const t1Name = colTeacher >= 0 ? parseTeacherNameFromRosterCellSegment(String(row[colTeacher] ?? '').trim()) : '';
        const t2Name =
          colTeacher2 >= 0 ? parseTeacherNameFromRosterCellSegment(String(row[colTeacher2] ?? '').trim()) : '';
        const teacherId = t1Name ? resolveStaffingTeacherId(t1Name, input.teachers, input.isZh) : null;
        const teacher2Id = t2Name ? resolveStaffingTeacherId(t2Name, input.teachers, input.isZh) : null;
        if (t1Name && !teacherId) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行教师1：未登记「${t1Name}」，已留空`
              : `Sheet "${sheetName}" row ${ri + 1}: teacher 1 "${t1Name}" not registered, left blank`,
          );
        }
        if (t2Name && !teacher2Id) {
          warnings.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行教师2：未登记「${t2Name}」，已留空`
              : `Sheet "${sheetName}" row ${ri + 1}: teacher 2 "${t2Name}" not registered, left blank`,
          );
        }
        electiveCourseOps.push({
          name,
          applicableGrades,
          durationPeriods,
          teacherId,
          teacher2Id,
          capacity: colCapacity >= 0 ? Number(row[colCapacity] ?? 0) || 0 : 0,
          location: colLocation >= 0 ? String(row[colLocation] ?? '').trim() : '',
        });
      }
    }
  }

  return {
    operations,
    functionalRoleOps,
    teachingMemberOps,
    newTeachingGroups,
    selfStudySlotOps,
    electiveCourseOps,
    errors,
    warnings,
    skippedUnknownCourses: [...skippedUnknownCoursesAll],
  };
}

export function parseStaffingKeyRolesWorkbook(
  arrayBuffer: ArrayBuffer,
  input: Omit<Parameters<typeof parseStaffingPackageWorkbook>[1], 'scope' | 'courseSheets' | 'courses'>,
): StaffingKeyRolesImportResult {
  const result = parseStaffingPackageWorkbook(arrayBuffer, {
    ...input,
    courseSheets: [],
    courses: [],
    scope: 'key-roles',
  });
  return {
    operations: result.operations,
    functionalRoleOps: result.functionalRoleOps,
    teachingMemberOps: result.teachingMemberOps,
    newTeachingGroups: result.newTeachingGroups,
    errors: result.errors,
    warnings: result.warnings,
  };
}

export function parseStaffingCourseJobsWorkbook(
  arrayBuffer: ArrayBuffer,
  input: {
    academicYearId: string;
    courseSheets: readonly StaffingRosterSegmentSheet[];
    allClasses: readonly ClassItem[];
    courses: readonly Course[];
    teachers: readonly StaffingRosterTeacherRef[];
    gradeConfig: GradeConfig;
    isZh: boolean;
    selfStudyModules: ReadonlyArray<{ id: string; name: string }>;
  },
): StaffingCourseJobsImportResult {
  const result = parseStaffingPackageWorkbook(arrayBuffer, {
    ...input,
    gradeBlocks: [],
    teachingGroups: [],
    scope: 'course-jobs',
  });
  return {
    operations: result.operations,
    selfStudySlotOps: result.selfStudySlotOps,
    electiveCourseOps: result.electiveCourseOps,
    errors: result.errors,
    warnings: result.warnings,
    skippedUnknownCourses: result.skippedUnknownCourses,
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
    courseDetail: string;
    electiveDetail: string;
    selfStudyDetail: string;
    total: number;
  }>;
}): void {
  const staffCol = input.isZh ? '教职工' : 'Staff';
  const primaryCol = input.isZh ? '主学科' : 'Primary subject';
  const courseCol = input.isZh ? '课程岗位' : 'Course staffing';
  const electiveCol = input.isZh ? '选修' : 'Elective';
  const selfStudyCol = input.isZh ? '自习' : 'Self-study';
  const totalCol = input.isZh ? '周课时（节/周）' : 'Periods / week';
  const header = [staffCol, primaryCol, courseCol, electiveCol, selfStudyCol, totalCol];
  const body = input.rows.map((r) => [
    r.teacherName,
    r.primarySubjectLabel,
    r.courseDetail,
    r.electiveDetail,
    r.selfStudyDetail,
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
