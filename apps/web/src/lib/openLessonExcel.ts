/**
 * 公开课 Excel：版式跟页面表格一致，并多一列类型，因为一份表包含本学期全部类别。
 * 第一行是学年学期标题，蓝底白字，中英两行。第二行表头中英两行，淡灰底黑字。
 */
import type { Term } from '../types/classManagement';
import type { OpenLesson, OpenLessonImportIssue, OpenLessonImportRow, OpenLessonKind } from '../types/openLesson';

export const OPEN_LESSON_SCHOOL_TITLE = '合肥市包河区协和双语学校';

const TITLE_FILL = 'FF0041A3';
const TITLE_FONT = 'FFFFFFFF';
const HEADER_FILL = 'FFE5E7EB';
const HEADER_FONT = 'FF000000';

const COLUMNS = [
  { key: 'kind', zh: '类型', en: 'Type', width: 16 },
  { key: 'subject', zh: '学科', en: 'Subject', width: 18 },
  { key: 'teacher', zh: '教师', en: 'Teacher', width: 14 },
  { key: 'class', zh: '班级', en: 'Class', width: 12 },
  { key: 'date', zh: '日期', en: 'Date', width: 14 },
  { key: 'time', zh: '时间', en: 'Time', width: 16 },
  { key: 'topic', zh: '学期-单元-课题', en: 'Term-Unit-Topic', width: 36 },
  { key: 'location', zh: '上课地点', en: 'Location', width: 16 },
  { key: 'remarks', zh: '备注', en: 'Remarks', width: 24 },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

const HEADER_KEY: Record<string, ColumnKey> = {};
for (const column of COLUMNS) {
  HEADER_KEY[normHeader(column.zh)] = column.key;
  HEADER_KEY[normHeader(column.en)] = column.key;
}
HEADER_KEY[normHeader('年级-单元-课题')] = 'topic';
HEADER_KEY[normHeader('Grade-Unit-Topic')] = 'topic';
HEADER_KEY[normHeader('组别')] = 'subject';
HEADER_KEY[normHeader('Group')] = 'subject';

const KIND_LABEL: Record<OpenLessonKind, [string, string]> = {
  group: ['组内公开课', 'Group open lesson'],
  routine: ['日常课', 'Daily lesson'],
  school: ['校级公开课', 'School open lesson'],
};

function normHeader(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

function personLabel(isZh: boolean, zh: string, en: string): string {
  const primary = (isZh ? zh : en).trim();
  const fallback = (isZh ? en : zh).trim();
  return primary || fallback;
}

function termLabel(term: Term, isZh: boolean): string {
  if (term === 'Semester 1') return isZh ? '上学期' : 'Semester 1';
  return isZh ? '下学期' : 'Semester 2';
}

function scheduleTitle(yearLabel: string, term: Term): { zh: string; en: string } {
  const year = yearLabel.trim() || '202x-202x';
  const semester = term === 'Semester 1' ? '1' : '2';
  return {
    zh: `${year} 第${semester}学期 合肥协和公开课安排表`,
    en: `${year} Semester ${semester} Hefei SUIS Open Lesson Schedule`,
  };
}

function headerKeyFromCell(value: unknown): ColumnKey | null {
  const text = cellText(value);
  const parts = text.split(/[\r\n]+/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts.length > 0 ? parts : [text]) {
    const key = HEADER_KEY[normHeader(part)];
    if (key) return key;
  }
  return null;
}

type ExcelModule = typeof import('exceljs');

async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as ExcelModule & { default?: ExcelModule };
  return mod.Workbook ? mod : (mod.default as ExcelModule);
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    const rec = value as { richText?: Array<{ text?: string }>; text?: string; result?: unknown; hyperlink?: string };
    if (Array.isArray(rec.richText)) return rec.richText.map((part) => part.text ?? '').join('').trim();
    if (typeof rec.text === 'string') return rec.text.trim();
    if ('result' in rec) return cellText(rec.result);
  }
  return '';
}

function formatDateCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = cellText(value);
  const match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function formatClock(totalMinutes: number): string {
  const minutes = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTimeCell(value: unknown): string {
  if (typeof value === 'number' && value >= 0 && value < 1) return formatClock(value * 24 * 60);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatClock(value.getHours() * 60 + value.getMinutes());
  }
  return cellText(value)
    .replace(/[–—−~～]/g, '-')
    .replace(/：/g, ':')
    .replace(/\s+/g, '');
}

function paintTitle(cell: {
  value?: unknown;
  font?: unknown;
  fill?: unknown;
  alignment?: unknown;
}, title: { zh: string; en: string } | null) {
  if (title) {
    cell.value = {
      richText: [
        { font: { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: TITLE_FONT } }, text: `${title.zh}\n` },
        { font: { name: 'Microsoft YaHei', size: 11, color: { argb: TITLE_FONT } }, text: title.en },
      ],
    };
  }
  cell.font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: TITLE_FONT } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function paintHeader(cell: {
  value?: unknown;
  font?: unknown;
  fill?: unknown;
  alignment?: unknown;
}, column: (typeof COLUMNS)[number]) {
  cell.value = {
    richText: [
      { font: { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: HEADER_FONT } }, text: `${column.zh}\n` },
      { font: { name: 'Microsoft YaHei', size: 9, color: { argb: HEADER_FONT } }, text: column.en },
    ],
  };
  cell.font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: HEADER_FONT } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

export async function buildOpenLessonWorkbook(input: {
  lessons: readonly OpenLesson[];
  academicYearLabel: string;
  term: Term;
  isZh: boolean;
}): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = OPEN_LESSON_SCHOOL_TITLE;
  const sheet = workbook.addWorksheet(input.isZh ? '公开课' : 'Open lessons');
  const title = scheduleTitle(input.academicYearLabel, input.term);
  sheet.columns = COLUMNS.map((column) => ({ width: column.width }));
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getRow(1).height = 48;
  for (let col = 1; col <= COLUMNS.length; col += 1) {
    paintTitle(sheet.getCell(1, col), col === 1 ? title : null);
  }
  sheet.getRow(2).height = 36;
  COLUMNS.forEach((column, index) => {
    paintHeader(sheet.getCell(2, index + 1), column);
  });
  const dateCol = COLUMNS.findIndex((column) => column.key === 'date') + 1;
  const timeCol = COLUMNS.findIndex((column) => column.key === 'time') + 1;
  input.lessons.forEach((lesson, index) => {
    const excelRow = sheet.getRow(index + 3);
    excelRow.height = 22;
    const values: Record<ColumnKey, string> = {
      kind: personLabel(input.isZh, KIND_LABEL[lesson.lessonKind][0], KIND_LABEL[lesson.lessonKind][1]),
      teacher: personLabel(input.isZh, lesson.teacherNameZh, lesson.teacherNameEn),
      subject: lesson.subject,
      class: lesson.className,
      date: lesson.lessonDate,
      time: lesson.timeText,
      topic: lesson.gradeUnitTopic,
      location: lesson.location,
      remarks: lesson.remarks,
    };
    COLUMNS.forEach((column, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = values[column.key];
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { name: 'Microsoft YaHei', size: 11, color: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
    excelRow.getCell(dateCol).numFmt = '@';
    excelRow.getCell(timeCol).numFmt = '@';
  });
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  const buf = await workbook.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export async function downloadOpenLessonWorkbook(input: {
  lessons: readonly OpenLesson[];
  academicYearLabel: string;
  term: Term;
  isZh: boolean;
}): Promise<void> {
  const buf = await buildOpenLessonWorkbook(input);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const yearPart = input.academicYearLabel.replace(/\s+/g, '') || 'year';
  const name = input.isZh
    ? `公开课-${yearPart}-${termLabel(input.term, true)}-${stamp}.xlsx`
    : `open-lessons-${yearPart}-${input.term === 'Semester 1' ? 'S1' : 'S2'}-${stamp}.xlsx`;
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseOpenLessonWorkbook(
  arrayBuffer: ArrayBuffer,
): Promise<{ rows: OpenLessonImportRow[]; issues: OpenLessonImportIssue[] }> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    return { rows: [], issues: [{ row: 1, code: 'file_unreadable' }] };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], issues: [{ row: 1, code: 'empty_sheet' }] };

  let headerRow = 0;
  const columnAt = new Map<ColumnKey, number>();
  const maxScan = Math.min(sheet.rowCount || 8, 8);
  for (let rowNumber = 1; rowNumber <= Math.max(maxScan, 1); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const found = new Map<ColumnKey, number>();
    const lastCol = Math.max(row.cellCount, COLUMNS.length);
    for (let col = 1; col <= lastCol; col += 1) {
      const key = headerKeyFromCell(row.getCell(col).value);
      if (key && !found.has(key)) found.set(key, col);
    }
    if (found.size >= 4 && found.has('subject') && found.has('kind')) {
      headerRow = rowNumber;
      found.forEach((col, key) => columnAt.set(key, col));
      break;
    }
  }
  if (!headerRow) return { rows: [], issues: [{ row: 2, code: 'header_missing' }] };
  const missing = COLUMNS.filter((column) => !columnAt.has(column.key)).map((column) => column.zh);
  if (missing.length > 0) return { rows: [], issues: [{ row: headerRow, code: 'header_missing', detail: missing.join('、') }] };

  const rows: OpenLessonImportRow[] = [];
  const lastRow = sheet.rowCount;
  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const read = (key: ColumnKey) => row.getCell(columnAt.get(key) ?? 1).value;
    const lessonKind = cellText(read('kind'));
    const subject = cellText(read('subject'));
    const teacherName = cellText(read('teacher'));
    const className = cellText(read('class'));
    const lessonDate = formatDateCell(read('date'));
    const timeText = formatTimeCell(read('time'));
    const gradeUnitTopic = cellText(read('topic'));
    const location = cellText(read('location'));
    const remarks = cellText(read('remarks'));
    if (![lessonKind, subject, teacherName, className, lessonDate, timeText, gradeUnitTopic, location, remarks].some(Boolean)) {
      continue;
    }
    rows.push({
      row: rowNumber,
      lessonKind,
      subject,
      teacherName,
      className,
      lessonDate,
      timeText,
      gradeUnitTopic,
      location,
      remarks,
    });
  }
  return { rows, issues: [] };
}
