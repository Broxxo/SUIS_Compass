import type { TeacherCollectionBlock } from '@repo/shared';
import * as XLSX from 'xlsx';

export type TeacherCollectionExchangePayload = {
  meta: {
    academicYearName: string;
    term: string;
    title: string;
    departments: string[];
    formBlocks: TeacherCollectionBlock[] | null;
  };
  teachers: Array<{
    username: string;
    nameZh: string;
    nameEn: string;
    department: string;
    diagnosis: { keep: string; improve: string; stop: string; start: string };
    textAnswers: Record<string, string>;
  }>;
};

export type TeacherCollectionExcelParseResult = {
  payload: TeacherCollectionExchangePayload | null;
  errors: string[];
};

const FIXED_HEADERS = ['登录名', '中文名', '英文名', '部门'] as const;
const KISS_COLUMNS = [
  { id: 'keep', header: 'Keep' },
  { id: 'improve', header: 'Improve' },
  { id: 'stop', header: 'Stop' },
  { id: 'start', header: 'Start' },
] as const;

function text(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function sheetMatrix(workbook: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
}

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string): void {
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function uniqueHeader(label: string, used: Set<string>): string {
  const base = label.trim() || '未命名';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base} (${index})`)) index += 1;
  const next = `${base} (${index})`;
  used.add(next);
  return next;
}

function answerColumns(blocks: TeacherCollectionBlock[] | null): Array<{ header: string; kind: 'kiss' | 'text'; id: string }> {
  const resolved: TeacherCollectionBlock[] = blocks && blocks.length > 0 ? blocks : [{ id: 'kiss', kind: 'kiss' }];
  const used = new Set<string>(FIXED_HEADERS);
  const columns: Array<{ header: string; kind: 'kiss' | 'text'; id: string }> = [];
  for (const block of resolved) {
    if (block.kind === 'kiss') {
      for (const field of KISS_COLUMNS) {
        columns.push({ header: uniqueHeader(field.header, used), kind: 'kiss', id: field.id });
      }
      continue;
    }
    columns.push({ header: uniqueHeader(block.label, used), kind: 'text', id: block.id });
  }
  return columns;
}

export function downloadTeacherCollectionWorkbook(payload: TeacherCollectionExchangePayload): void {
  const columns = answerColumns(payload.meta.formBlocks);
  const workbook = XLSX.utils.book_new();
  const termLabel = payload.meta.term === 'Semester 2' ? '下学期' : payload.meta.term === 'Semester 1' ? '上学期' : payload.meta.term;
  const departments = payload.meta.departments.length > 0 ? payload.meta.departments.join('、') : '全部部门';
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['字段', '内容'],
      ['学年', payload.meta.academicYearName],
      ['学期', termLabel],
      ['学期代码', payload.meta.term],
      ['任务名称', payload.meta.title],
      ['部门', departments],
    ]),
    '说明',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['列名', '题目编号', '类型'],
      ...columns.map((column) => [column.header, column.id, column.kind]),
    ]),
    '题目',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...FIXED_HEADERS, ...columns.map((column) => column.header)],
      ...payload.teachers.map((teacher) => [
        teacher.username,
        teacher.nameZh,
        teacher.nameEn,
        teacher.department,
        ...columns.map((column) =>
          column.kind === 'kiss'
            ? teacher.diagnosis[column.id as keyof typeof teacher.diagnosis] ?? ''
            : teacher.textAnswers[column.id] ?? '',
        ),
      ]),
    ]),
    '教师',
  );
  const safeTitle = (payload.meta.title || '教师收集').replace(/[\\/:*?"<>|]/g, '-');
  const safeYear = (payload.meta.academicYearName || '学年').replace(/[\\/:*?"<>|]/g, '-');
  downloadWorkbook(workbook, `教师收集-${safeYear}-${termLabel}-${safeTitle}.xlsx`);
}

export function parseTeacherCollectionWorkbook(arrayBuffer: ArrayBuffer): TeacherCollectionExcelParseResult {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const errors: string[] = [];
  const metaRows = sheetMatrix(workbook, '说明');
  const meta = { academicYearName: '', term: '', title: '', departments: '' };
  for (const row of metaRows.slice(1)) {
    const key = text(row[0]);
    const value = text(row[1]);
    if (key === '学年') meta.academicYearName = value;
    if (key === '学期代码') meta.term = value;
    if (key === '任务名称') meta.title = value;
    if (key === '部门') meta.departments = value;
  }
  const questionRows = sheetMatrix(workbook, '题目').slice(1);
  const questions = questionRows
    .map((row) => ({ header: text(row[0]), id: text(row[1]), kind: text(row[2]) }))
    .filter((row) => row.header && row.id && (row.kind === 'kiss' || row.kind === 'text'));
  if (questions.length === 0) errors.push('缺少「题目」工作表，无法对应填写栏。');

  const teacherMatrix = sheetMatrix(workbook, '教师');
  if (teacherMatrix.length === 0) errors.push('缺少「教师」工作表。');
  const header = teacherMatrix[0] ?? [];
  const columnIndex = new Map<string, number>();
  header.forEach((cell, index) => {
    const name = text(cell);
    if (name && !columnIndex.has(name)) columnIndex.set(name, index);
  });
  if (teacherMatrix.length > 0 && !columnIndex.has('登录名')) errors.push('「教师」表需要「登录名」列。');
  if (errors.length > 0) return { payload: null, errors };

  const cell = (row: unknown[], name: string) => {
    const index = columnIndex.get(name);
    return index == null ? '' : text(row[index]);
  };
  const teachers = teacherMatrix.slice(1).flatMap((row) => {
    const username = cell(row, '登录名');
    if (!username) return [];
    const diagnosis = { keep: '', improve: '', stop: '', start: '' };
    const textAnswers: Record<string, string> = {};
    for (const question of questions) {
      const value = cell(row, question.header);
      if (question.kind === 'kiss' && question.id in diagnosis) {
        diagnosis[question.id as keyof typeof diagnosis] = value;
      } else if (question.kind === 'text') {
        textAnswers[question.id] = value;
      }
    }
    return [{
      username,
      nameZh: cell(row, '中文名'),
      nameEn: cell(row, '英文名'),
      department: cell(row, '部门'),
      diagnosis,
      textAnswers,
    }];
  });

  return {
    payload: {
      meta: {
        academicYearName: meta.academicYearName,
        term: meta.term,
        title: meta.title,
        departments: meta.departments ? meta.departments.split(/[、,，]/).map((item) => item.trim()).filter((item) => item && item !== '全部部门') : [],
        formBlocks: null,
      },
      teachers,
    },
    errors,
  };
}
