/**
 * 学生管理 Excel 导入/导出
 *
 * 列：中文名、英文名、当前年级、性别、学号、出生日期、学部、状态、班级（所选学年下的班级名）
 */
import * as XLSX from 'xlsx';
import type { ClassItem, Enrollment, Student } from '../types/classManagement';

export type StudentImportParsedRow = {
  nameZh: string;
  nameEn: string;
  currentGrade: number;
  gender: Student['gender'];
  studentNumber: string;
  dateOfBirth: string;
  division: string;
  status: Student['status'];
  className: string;
};

export type StudentImportParseResult = {
  rows: StudentImportParsedRow[];
  errors: string[];
  warnings: string[];
};

const HEADER_ZH = ['中文名', '英文名', '当前年级', '性别', '学号', '出生日期', '学部', '状态', '班级'] as const;
const HEADER_EN = ['Name (ZH)', 'Name (EN)', 'Current grade', 'Gender', 'Student no.', 'DOB', 'Division', 'Status', 'Class'] as const;

function isLikelyHeaderRow(row: unknown[], isZh: boolean): boolean {
  const c0 = String(row[0] ?? '').trim();
  const c2 = String(row[2] ?? '').trim();
  if (isZh) return /中文名/.test(c0) || /当前年级/.test(c2);
  return /name\s*\(zh\)/i.test(c0) || /current\s*grade/i.test(c2);
}

function parseGenderCell(raw: string): Student['gender'] | null {
  const t = raw.trim();
  if (!t) return 'male';
  if (/^男$|^m$|^male$/i.test(t)) return 'male';
  if (/^女$|^f$|^female$/i.test(t)) return 'female';
  if (/其他|other/i.test(t)) return 'other';
  return null;
}

function parseStatusCell(raw: string): Student['status'] {
  const t = raw.trim();
  if (!t) return 'active';
  if (/毕业|graduated/i.test(t)) return 'graduated';
  if (/休学|leave/i.test(t)) return 'leave';
  if (/离校|withdrawn/i.test(t)) return 'withdrawn';
  if (/在读|active/i.test(t)) return 'active';
  return 'active';
}

function parseGradeCell(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function genderLabel(gender: Student['gender'], isZh: boolean): string {
  if (isZh) {
    if (gender === 'male') return '男';
    if (gender === 'female') return '女';
    return '其他';
  }
  if (gender === 'male') return 'M';
  if (gender === 'female') return 'F';
  return 'Other';
}

function statusLabel(status: Student['status'] | undefined, isZh: boolean): string {
  const s = status ?? 'active';
  if (isZh) {
    if (s === 'graduated') return '毕业';
    if (s === 'leave') return '休学';
    if (s === 'withdrawn') return '离校';
    return '在读';
  }
  if (s === 'graduated') return 'Graduated';
  if (s === 'leave') return 'Leave';
  if (s === 'withdrawn') return 'Withdrawn';
  return 'Active';
}

function studentToRow(
  student: Student,
  className: string,
  isZh: boolean,
): (string | number)[] {
  return [
    student.nameZh ?? '',
    student.nameEn ?? '',
    student.currentGrade != null ? student.currentGrade : '',
    genderLabel(student.gender, isZh),
    student.studentNumber ?? '',
    student.dateOfBirth ?? '',
    student.division ?? '',
    statusLabel(student.status, isZh),
    className,
  ];
}

export function downloadStudentImportTemplate(isZh: boolean, yearLabel?: string): void {
  const header = [isZh ? [...HEADER_ZH] : [...HEADER_EN]];
  const example = isZh
    ? [['张三', 'San Zhang', 5, '男', '20250001', '2015-03-01', '小学部', '在读', '5A']]
    : [['Zhang San', 'San Zhang', 5, 'M', '20250001', '2015-03-01', 'Primary', 'Active', '5A']];
  const ws = XLSX.utils.aoa_to_sheet([...header, ...example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isZh ? '学生' : 'Students');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  const suffix = yearLabel ? `-${yearLabel.replace(/\s+/g, '')}` : '';
  a.download = isZh ? `学生导入模板${suffix}.xlsx` : `student-import-template${suffix}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadStudentsExport(input: {
  students: readonly Student[];
  enrollments: readonly Enrollment[];
  academicYearId: string | null;
  academicYearLabel: string;
  classes: readonly ClassItem[];
  isZh: boolean;
}): void {
  const { students, enrollments, academicYearId, academicYearLabel, classes, isZh } = input;
  if (students.length === 0) {
    downloadStudentImportTemplate(isZh, academicYearLabel || undefined);
    return;
  }
  const classById = new Map(classes.map((c) => [c.id, c]));
  const enrollmentByStudent = new Map<string, string>();
  if (academicYearId) {
    for (const e of enrollments) {
      if (e.academicYearId !== academicYearId) continue;
      const cls = classById.get(e.classId);
      if (cls) enrollmentByStudent.set(e.studentId, cls.name);
    }
  }
  const header = [isZh ? [...HEADER_ZH] : [...HEADER_EN]];
  const body = students.map((s) => studentToRow(s, enrollmentByStudent.get(s.id) ?? '', isZh));
  const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isZh ? '学生' : 'Students');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const yearPart = academicYearLabel ? `-${academicYearLabel.replace(/\s+/g, '')}` : '';
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = isZh ? `学生导出${yearPart}-${stamp}.xlsx` : `students-export${yearPart}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseStudentImportWorkbook(arrayBuffer: ArrayBuffer, isZh: boolean): StudentImportParseResult {
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

  const rows: StudentImportParsedRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenNumbers = new Set<string>();

  for (let i = start; i < data.length; i += 1) {
    const r = data[i] as unknown[];
    const rowNo = i + 1;
    const nameZh = String(r[0] ?? '').trim();
    const nameEn = String(r[1] ?? '').trim();
    if (!nameZh && !nameEn) continue;

    const grade = parseGradeCell(String(r[2] ?? ''));
    if (grade == null) {
      errors.push(isZh ? `第 ${rowNo} 行：当前年级无效或为空。` : `Row ${rowNo}: invalid or missing current grade.`);
      continue;
    }

    const gender = parseGenderCell(String(r[3] ?? ''));
    if (!gender) {
      errors.push(isZh ? `第 ${rowNo} 行：性别无效（男/女/其他）。` : `Row ${rowNo}: invalid gender (M/F/Other).`);
      continue;
    }

    const studentNumber = String(r[4] ?? '').trim();
    if (studentNumber) {
      const key = studentNumber.toLowerCase();
      if (seenNumbers.has(key)) {
        errors.push(isZh ? `第 ${rowNo} 行：学号「${studentNumber}」在文件中重复。` : `Row ${rowNo}: duplicate student no. "${studentNumber}".`);
        continue;
      }
      seenNumbers.add(key);
    }

    rows.push({
      nameZh,
      nameEn,
      currentGrade: grade,
      gender,
      studentNumber,
      dateOfBirth: String(r[5] ?? '').trim(),
      division: String(r[6] ?? '').trim(),
      status: parseStatusCell(String(r[7] ?? '')),
      className: String(r[8] ?? '').trim(),
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push(
      isZh
        ? '未解析到有效数据行，请确认首行为表头且中文名与英文名至少填其一、当前年级为数字。'
        : 'No data rows. Use the template header; at least one name and a numeric grade are required.',
    );
  }

  return { rows, errors, warnings };
}
