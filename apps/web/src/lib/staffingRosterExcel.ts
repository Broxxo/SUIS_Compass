/**
 * 岗位安排表 Excel 导入/导出（按学段分 sheet；课程列按课程名称匹配，顺序无关）
 */
import * as XLSX from 'xlsx';
import type { Course, GradeConfig } from '../types';
import type { ClassItem } from '../types/classManagement';
import { STAFFING_HOMEROOM_SUBJECT_KEY, staffingHomeroomSubjectName, staffingSubjectKeyFromCourse } from '@repo/shared';
import { normalizeGradeConfig, getGradeLabelByLevel } from './gradeConfig';
import { getCourseReportSubjectLabels, getSubjectCategoryText } from './utils';
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

const HOMEROOM_HEADERS = new Set(['班主任', 'homeroom', 'class teacher', '班主任教师']);
const GRADE_HEADERS = new Set(['年级', 'grade']);
const CLASS_HEADERS = new Set(['班级', 'class']);

function sanitizeExcelSheetName(name: string): string {
  const t = name.replace(/[\\/?*[\]:]/g, '_').trim().slice(0, 31);
  return t || 'Sheet';
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

/** 导入单元格：去掉导出后缀周课时（「桂春燕5」或旧版「桂春燕 5」） */
function parseTeacherNameFromExportCell(raw: string): string {
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
  isZh: boolean,
): string | null {
  const raw = parseTeacherNameFromExportCell(cellText);
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

function parseTeacherSlotsFromCell(cellText: string): string[] {
  const raw = cellText.trim();
  if (!raw || raw === '—' || raw === '-') return [];
  const segments = raw.includes('+') ? raw.split('+') : raw.split(/[/／|、;；\n]/);
  return segments.map((s) => parseTeacherNameFromExportCell(s)).filter(Boolean);
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

/** 独立授课：桂春燕5；合作授课片段：Zamran1、王超男1，单元格内用 + 连接 */
function exportTeacherCell(name: string, periods: number): string {
  if (!name) return '';
  if (periods <= 0) return name;
  return `${name}${formatWeeklyPeriodsForExcel(periods)}`;
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
 * 导出岗位安排：每学段一个 sheet；无任课数据时仍输出年级×班级×课程空表。
 */
export function downloadStaffingRosterExport(input: {
  academicYearLabel: string;
  sheets: readonly StaffingRosterSegmentSheet[];
  assignments: ReadonlyMap<string, { teacherId: string }>;
  teachers: readonly StaffingRosterTeacherRef[];
  gradeConfig: GradeConfig;
  isZh: boolean;
}): void {
  const wb = XLSX.utils.book_new();
  const gradeCol = input.isZh ? '年级' : 'Grade';
  const classCol = input.isZh ? '班级' : 'Class';
  const homeroomHeader = staffingHomeroomSubjectName(input.isZh);
  const gc = normalizeGradeConfig(input.gradeConfig);

  for (const sheet of input.sheets) {
    const courseCols = sheet.columns.filter((c): c is Extract<StaffingRosterColumn, { kind: 'course' }> => c.kind === 'course');
    const homeroomCol = sheet.columns.find((c) => c.kind === 'homeroom');
    const header = [gradeCol, classCol, homeroomHeader, ...courseCols.map((c) => c.header)];

    const body: (string | number)[][] = [];
    const classesSorted = [...sheet.classes].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const cls of classesSorted) {
      const row: (string | number)[] = [getGradeLabelByLevel(gc, cls.grade), cls.name];
      if (homeroomCol) {
        const hk = `${cls.id}::${homeroomCol.key}::0`;
        const tid = input.assignments.get(hk)?.teacherId;
        const t = tid ? input.teachers.find((x) => x.id === tid) : undefined;
        row.push(t ? teacherDisplayName(t, input.isZh) : '');
      }
      for (const col of courseCols) {
        const periods = courseAppliesToGrade(col.course, cls.grade, gc)
          ? getWeeklyPeriodsForGrade(col.course, cls.grade, gc)
          : 0;
        const slots: (0 | 1)[] = col.coTeaching ? [0, 1] : [0];
        const names: string[] = [];
        for (const slot of slots) {
          const key = `${cls.id}::${col.key}::${slot}`;
          const tid = input.assignments.get(key)?.teacherId;
          if (!tid) continue;
          const t = input.teachers.find((x) => x.id === tid);
          if (t) {
            names.push(exportTeacherCell(teacherDisplayName(t, input.isZh), periods));
          }
        }
        row.push(names.join('+'));
      }
      body.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(sheet.sheetName));
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
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const operations: StaffingRosterAssignmentOp[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const skippedUnknownCoursesAll = new Set<string>();
  const gc = normalizeGradeConfig(input.gradeConfig);

  for (const sheetName of wb.SheetNames) {
    const segmentSheet = matchSheetToSegment(sheetName, input.sheets);
    if (!segmentSheet) {
      warnings.push(
        input.isZh
          ? `已跳过工作表「${sheetName}」（与当前学段名称不一致）`
          : `Skipped sheet "${sheetName}" (no matching segment)`,
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
            ? `工作表「${sheetName}」第 ${ri + 1} 行：未找到班级「${getGradeLabelByLevel(gc, gradeLevel)} ${classCell}」`
            : `Sheet "${sheetName}" row ${ri + 1}: class not found (${gradeLevel} ${classCell})`,
        );
        continue;
      }

      if (colHomeroom >= 0) {
        const cell = String(row[colHomeroom] ?? '').trim();
        const tid = resolveStaffingTeacherId(cell, input.teachers, input.isZh);
        if (cell && !tid) {
          errors.push(
            input.isZh
              ? `工作表「${sheetName}」第 ${ri + 1} 行班主任：未找到教师「${cell}」`
              : `Sheet "${sheetName}" row ${ri + 1}: homeroom teacher not found "${cell}"`,
          );
        } else {
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
      }

      for (const meta of courseColMeta) {
        if (!courseAppliesToGrade(meta.course, cls.grade, gc)) continue;
        const cell = String(row[meta.colIdx] ?? '').trim();
        const names = parseTeacherSlotsFromCell(cell);
        const slots: (0 | 1)[] = meta.coTeaching ? [0, 1] : [0];
        for (let si = 0; si < slots.length; si += 1) {
          const slot = slots[si];
          const name = names[si] ?? '';
          const tid = name ? resolveStaffingTeacherId(name, input.teachers, input.isZh) : null;
          if (name && !tid) {
            errors.push(
              input.isZh
                ? `工作表「${sheetName}」第 ${ri + 1} 行「${meta.course.name}」：未找到教师「${name}」`
                : `Sheet "${sheetName}" row ${ri + 1} "${meta.course.name}": teacher not found "${name}"`,
            );
            continue;
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

  return {
    operations,
    errors,
    warnings,
    skippedUnknownCourses: [...skippedUnknownCoursesAll],
  };
}
