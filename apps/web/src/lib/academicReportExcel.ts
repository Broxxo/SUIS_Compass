import * as XLSX from 'xlsx';

export type AcademicReportExchangePayload = {
  meta: {
    academicYearName: string;
    term: string;
    templateTitle: string;
  };
  students: Array<{
    studentNumber: string;
    nameZh: string;
    nameEn: string;
    className: string;
    homeroomComment: string;
  }>;
  subjects: Array<{
    studentNumber: string;
    className: string;
    subjectKey: string;
    subjectName: string;
    learningQualityGrade: string;
    midtermScore: number | null;
    midtermGrade: string;
    finalScore: number | null;
    finalGrade: string;
    teacherComment: string;
    examDimensionScores: Record<string, number | null> | null;
  }>;
  dimensions: Array<{
    studentNumber: string;
    subjectKey: string;
    dimensionKey: string;
    dimensionLabel: string;
    rating: string;
  }>;
  classInsights: Array<{
    className: string;
    subjectKey: string;
    classOverallAnalysis: string;
    studentNumber: string;
    learningAnalysis: string;
    supportPlan: string;
  }>;
};

export type AcademicReportExcelParseResult = {
  payload: AcademicReportExchangePayload | null;
  errors: string[];
};

const STUDENT_HEADERS = ['学号', '中文名', '英文名', '班级', '班主任评语'] as const;
const SUBJECT_HEADERS = ['学号', '班级', '学科键', '学科名称', '学习品质', '期中成绩', '期中等第', '期末成绩', '期末等第', '学科评语', '测评维度分'] as const;
const DIMENSION_HEADERS = ['学号', '学科键', '维度键', '维度名称', '等第'] as const;
const INSIGHT_HEADERS = ['班级', '学科键', '班级整体分析', '学号', '学习分析', '支持计划'] as const;

function text(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function score(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

function sheetMatrix(workbook: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
}

function indexOfHeader(header: unknown[], name: string): number {
  return header.findIndex((cell) => text(cell) === name);
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

export function buildAcademicReportWorkbook(payload: AcademicReportExchangePayload): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const termLabel = payload.meta.term === 'Semester 2' ? '下学期' : payload.meta.term === 'Semester 1' ? '上学期' : payload.meta.term;
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['字段', '内容'],
      ['学年', payload.meta.academicYearName],
      ['学期', termLabel],
      ['学期代码', payload.meta.term],
      ['报告名称', payload.meta.templateTitle],
    ]),
    '说明',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...STUDENT_HEADERS],
      ...payload.students.map((row) => [row.studentNumber, row.nameZh, row.nameEn, row.className, row.homeroomComment]),
    ]),
    '学生',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...SUBJECT_HEADERS],
      ...payload.subjects.map((row) => [
        row.studentNumber,
        row.className,
        row.subjectKey,
        row.subjectName,
        row.learningQualityGrade,
        row.midtermScore ?? '',
        row.midtermGrade,
        row.finalScore ?? '',
        row.finalGrade,
        row.teacherComment,
        row.examDimensionScores ? JSON.stringify(row.examDimensionScores) : '',
      ]),
    ]),
    '学科评价',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...DIMENSION_HEADERS],
      ...payload.dimensions.map((row) => [row.studentNumber, row.subjectKey, row.dimensionKey, row.dimensionLabel, row.rating]),
    ]),
    '目标维度',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...INSIGHT_HEADERS],
      ...payload.classInsights.map((row) => [
        row.className,
        row.subjectKey,
        row.classOverallAnalysis,
        row.studentNumber,
        row.learningAnalysis,
        row.supportPlan,
      ]),
    ]),
    '班级分析',
  );
  return workbook;
}

export function downloadAcademicReportWorkbook(payload: AcademicReportExchangePayload): void {
  const workbook = buildAcademicReportWorkbook(payload);
  const termLabel = payload.meta.term === 'Semester 2' ? '下学期' : payload.meta.term === 'Semester 1' ? '上学期' : payload.meta.term;
  const safeTitle = (payload.meta.templateTitle || '学业报告').replace(/[\\/:*?"<>|]/g, '-');
  const safeYear = (payload.meta.academicYearName || '学年').replace(/[\\/:*?"<>|]/g, '-');
  downloadWorkbook(workbook, `学业报告-${safeYear}-${termLabel}-${safeTitle}.xlsx`);
}

export function parseAcademicReportWorkbook(arrayBuffer: ArrayBuffer): AcademicReportExcelParseResult {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const errors: string[] = [];
  const metaRows = sheetMatrix(workbook, '说明');
  const meta = { academicYearName: '', term: '', templateTitle: '' };
  for (const row of metaRows.slice(1)) {
    const key = text(row[0]);
    const value = text(row[1]);
    if (key === '学年') meta.academicYearName = value;
    if (key === '学期代码') meta.term = value;
    if (key === '报告名称') meta.templateTitle = value;
  }
  if (!meta.term) {
    const label = metaRows.map((row) => text(row[1])).join(' ');
    if (label.includes('下学期') || /semester\s*2/i.test(label)) meta.term = 'Semester 2';
    else if (label.includes('上学期') || /semester\s*1/i.test(label)) meta.term = 'Semester 1';
  }

  const studentMatrix = sheetMatrix(workbook, '学生');
  if (studentMatrix.length === 0) errors.push('缺少「学生」工作表。');
  const studentHeader = studentMatrix[0] ?? [];
  const studentCol = Object.fromEntries(STUDENT_HEADERS.map((name) => [name, indexOfHeader(studentHeader, name)]));
  if (studentMatrix.length > 0 && studentCol['学号'] < 0) errors.push('「学生」表需要「学号」列。');

  const subjectMatrix = sheetMatrix(workbook, '学科评价');
  const subjectHeader = subjectMatrix[0] ?? [];
  const subjectCol = Object.fromEntries(SUBJECT_HEADERS.map((name) => [name, indexOfHeader(subjectHeader, name)]));

  const dimensionMatrix = sheetMatrix(workbook, '目标维度');
  const dimensionHeader = dimensionMatrix[0] ?? [];
  const dimensionCol = Object.fromEntries(DIMENSION_HEADERS.map((name) => [name, indexOfHeader(dimensionHeader, name)]));

  const insightMatrix = sheetMatrix(workbook, '班级分析');
  const insightHeader = insightMatrix[0] ?? [];
  const insightCol = Object.fromEntries(INSIGHT_HEADERS.map((name) => [name, indexOfHeader(insightHeader, name)]));

  if (errors.length > 0) return { payload: null, errors };

  const cell = (row: unknown[], index: number) => (index >= 0 ? text(row[index]) : '');
  const students = studentMatrix.slice(1).map((row) => ({
    studentNumber: cell(row, studentCol['学号']),
    nameZh: cell(row, studentCol['中文名']),
    nameEn: cell(row, studentCol['英文名']),
    className: cell(row, studentCol['班级']),
    homeroomComment: cell(row, studentCol['班主任评语']),
  })).filter((row) => row.studentNumber);

  const subjects = subjectMatrix.slice(1).flatMap((row) => {
    const studentNumber = cell(row, subjectCol['学号']);
    const subjectKey = cell(row, subjectCol['学科键']);
    if (!studentNumber || !subjectKey) return [];
    const midterm = score(subjectCol['期中成绩'] >= 0 ? row[subjectCol['期中成绩']] : '');
    const finalScore = score(subjectCol['期末成绩'] >= 0 ? row[subjectCol['期末成绩']] : '');
    if (Number.isNaN(midterm) || Number.isNaN(finalScore)) {
      errors.push(`学号 ${studentNumber} 的学科「${subjectKey}」成绩不是数字。`);
      return [];
    }
    let examDimensionScores: Record<string, number | null> | null = null;
    const examRaw = cell(row, subjectCol['测评维度分']);
    if (examRaw) {
      try {
        const parsed = JSON.parse(examRaw) as Record<string, number | null>;
        if (parsed && typeof parsed === 'object') examDimensionScores = parsed;
      } catch {
        errors.push(`学号 ${studentNumber} 的学科「${subjectKey}」测评维度分无法读取。`);
      }
    }
    return [{
      studentNumber,
      className: cell(row, subjectCol['班级']),
      subjectKey,
      subjectName: cell(row, subjectCol['学科名称']),
      learningQualityGrade: cell(row, subjectCol['学习品质']),
      midtermScore: midterm,
      midtermGrade: cell(row, subjectCol['期中等第']),
      finalScore,
      finalGrade: cell(row, subjectCol['期末等第']),
      teacherComment: cell(row, subjectCol['学科评语']),
      examDimensionScores,
    }];
  });

  const dimensions = dimensionMatrix.slice(1).map((row) => ({
    studentNumber: cell(row, dimensionCol['学号']),
    subjectKey: cell(row, dimensionCol['学科键']),
    dimensionKey: cell(row, dimensionCol['维度键']),
    dimensionLabel: cell(row, dimensionCol['维度名称']),
    rating: cell(row, dimensionCol['等第']),
  })).filter((row) => row.studentNumber && row.subjectKey && row.dimensionKey);

  const classInsights = insightMatrix.slice(1).map((row) => ({
    className: cell(row, insightCol['班级']),
    subjectKey: cell(row, insightCol['学科键']),
    classOverallAnalysis: cell(row, insightCol['班级整体分析']),
    studentNumber: cell(row, insightCol['学号']),
    learningAnalysis: cell(row, insightCol['学习分析']),
    supportPlan: cell(row, insightCol['支持计划']),
  })).filter((row) => row.className && row.subjectKey);

  if (errors.length > 0) return { payload: null, errors };
  return { payload: { meta, students, subjects, dimensions, classInsights }, errors: [] };
}
