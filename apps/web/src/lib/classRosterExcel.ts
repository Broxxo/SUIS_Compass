/**
 * 班级管理 Excel 导入/导出（按学年）
 *
 * 列：年级、班级名称、班主任
 */
import * as XLSX from 'xlsx';
import type { ClassItem } from '../types/classManagement';
import type { GradeConfig } from '../types';
import { normalizeGradeConfig, getGradeLabelByLevel } from './gradeConfig';
import {
  parseTeacherNameFromRosterCellSegment,
  resolveStaffingTeacherId,
  type StaffingRosterTeacherRef,
} from './staffingRosterExcel';

export type ClassImportParsedRow = {
  grade: number;
  className: string;
  homeroomTeacherName: string;
};

export type ClassImportParseResult = {
  rows: ClassImportParsedRow[];
  errors: string[];
  warnings: string[];
};

const HEADER_ZH = ['年级', '班级名称', '班主任'] as const;
const HEADER_EN = ['Grade', 'Class name', 'Homeroom teacher'] as const;

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

function isLikelyHeaderRow(row: unknown[], isZh: boolean): boolean {
  const c0 = String(row[0] ?? '').trim();
  const c1 = String(row[1] ?? '').trim();
  if (isZh) return /年级/.test(c0) || /班级/.test(c1);
  return /^grade$/i.test(c0) || /class\s*name/i.test(c1);
}

function teacherDisplayName(t: StaffingRosterTeacherRef, isZh: boolean): string {
  const zh = (t.nameZh ?? '').trim();
  const en = (t.nameEn ?? '').trim();
  if (isZh) return zh || en || t.displayName || t.username;
  return en || zh || t.displayName || t.username;
}

function classToRow(
  cls: ClassItem,
  homeroomName: string,
  gradeConfig: GradeConfig,
): (string | number)[] {
  return [getGradeLabelByLevel(gradeConfig, cls.grade), cls.name, homeroomName];
}

export function downloadClassImportTemplate(isZh: boolean, yearLabel?: string): void {
  const header = [isZh ? [...HEADER_ZH] : [...HEADER_EN]];
  const example = isZh ? [['G5', '5A', '张老师']] : [['G5', '5A', 'Ms Zhang']];
  const ws = XLSX.utils.aoa_to_sheet([...header, ...example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isZh ? '班级' : 'Classes');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  const suffix = yearLabel ? `-${yearLabel.replace(/\s+/g, '')}` : '';
  a.download = isZh ? `班级导入模板${suffix}.xlsx` : `class-import-template${suffix}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadClassesExport(input: {
  classes: readonly ClassItem[];
  homeroomByClassId: ReadonlyMap<string, string>;
  gradeConfig: GradeConfig;
  academicYearLabel: string;
  isZh: boolean;
}): void {
  const { classes, homeroomByClassId, gradeConfig, academicYearLabel, isZh } = input;
  if (classes.length === 0) {
    downloadClassImportTemplate(isZh, academicYearLabel || undefined);
    return;
  }
  const sorted = [...classes].sort(
    (a, b) => a.grade - b.grade || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const header = [isZh ? [...HEADER_ZH] : [...HEADER_EN]];
  const body = sorted.map((c) => classToRow(c, homeroomByClassId.get(c.id) ?? '', gradeConfig));
  const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isZh ? '班级' : 'Classes');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const yearPart = academicYearLabel ? `-${academicYearLabel.replace(/\s+/g, '')}` : '';
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = isZh ? `班级导出${yearPart}-${stamp}.xlsx` : `classes-export${yearPart}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseClassImportWorkbook(
  arrayBuffer: ArrayBuffer,
  gradeConfig: GradeConfig,
  isZh: boolean,
): ClassImportParseResult {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: [isZh ? '工作簿为空。' : 'Workbook is empty.'], warnings: [] };
  }
  const sh = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
    header: 1,
    defval: '',
  }) as string[][];
  if (data.length === 0) {
    return { rows: [], errors: [isZh ? '工作表无数据。' : 'Sheet has no data.'], warnings: [] };
  }
  let start = 0;
  if (isLikelyHeaderRow(data[0] as unknown[], isZh)) start = 1;

  const rows: ClassImportParsedRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let lastGradeLevel: number | null = null;

  for (let i = start; i < data.length; i += 1) {
    const r = data[i] as unknown[];
    const rowNo = i + 1;
    const gradeCell = String(r[0] ?? '').trim();
    const className = String(r[1] ?? '').trim();
    const homeroomTeacherName = parseTeacherNameFromRosterCellSegment(String(r[2] ?? '').trim());
    if (!className && !gradeCell) continue;
    if (!className) {
      errors.push(isZh ? `第 ${rowNo} 行：班级名称为空。` : `Row ${rowNo}: class name is empty.`);
      continue;
    }
    const parsedGrade = parseGradeLevelFromCell(gradeCell, gradeConfig);
    if (parsedGrade != null) lastGradeLevel = parsedGrade;
    const grade = lastGradeLevel;
    if (grade == null) {
      errors.push(isZh ? `第 ${rowNo} 行：年级无效或为空。` : `Row ${rowNo}: invalid or missing grade.`);
      continue;
    }
    rows.push({ grade, className, homeroomTeacherName });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push(
      isZh
        ? '未解析到有效数据行，请确认首行为表头且填写年级与班级名称。'
        : 'No data rows. Use the template header; grade and class name are required.',
    );
  }

  return { rows, errors, warnings };
}

export function resolveHomeroomTeacherId(
  homeroomName: string,
  teachers: readonly StaffingRosterTeacherRef[],
  isZh: boolean,
): string | null {
  if (!homeroomName) return null;
  return resolveStaffingTeacherId(homeroomName, teachers, isZh);
}

export function adminUserToStaffingTeacherRef(u: {
  id: string;
  username: string;
  displayName: string;
  nameZh?: string | null;
  nameEn?: string | null;
}): StaffingRosterTeacherRef {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    nameZh: u.nameZh ?? '',
    nameEn: u.nameEn ?? '',
  };
}

export function homeroomDisplayName(
  teacherId: string | null | undefined,
  teachers: readonly StaffingRosterTeacherRef[],
  isZh: boolean,
): string {
  if (!teacherId) return '';
  const t = teachers.find((x) => x.id === teacherId);
  return t ? teacherDisplayName(t, isZh) : '';
}
