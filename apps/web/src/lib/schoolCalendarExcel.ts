/**
 * 校历 Excel：版式跟公开课表一致。第一行是学校和学年标题，蓝底白字，中英两行。
 * 第二行表头中英两行，淡灰底黑字。一份工作簿里有月历和周历两张表。
 */
import type { SchoolCalendarBoard } from './schoolCalendarApi';

export const SCHOOL_CALENDAR_TITLE = '合肥市包河区协和双语学校';

const TITLE_FILL = 'FF0041A3';
const TITLE_FONT = 'FFFFFFFF';
const HEADER_FILL = 'FFE5E7EB';
const HEADER_FONT = 'FF000000';

const MONTH_FIXED = [
  { key: 'monday', zh: '周一', en: 'Monday', width: 14 },
  { key: 'week', zh: '周次', en: 'Week', width: 12 },
  { key: 'theme', zh: '周主题', en: 'Theme', width: 18 },
  { key: 'shared', zh: '全学部', en: 'Whole school', width: 36 },
] as const;

const WEEK_COLUMNS = [
  { key: 'date', zh: '日期', en: 'Date', width: 14 },
  { key: 'module', zh: '模块', en: 'Module', width: 16 },
  { key: 'start', zh: '开始', en: 'Start', width: 10 },
  { key: 'end', zh: '结束', en: 'End', width: 10 },
  { key: 'title', zh: '事项', en: 'Title', width: 28 },
  { key: 'location', zh: '地点', en: 'Location', width: 16 },
  { key: 'owner', zh: '负责人', en: 'Owner', width: 14 },
  { key: 'participants', zh: '参与人', en: 'Participants', width: 24 },
  { key: 'status', zh: '状态', en: 'Status', width: 12 },
  { key: 'note', zh: '备注', en: 'Note', width: 24 },
] as const;

type MonthFixedKey = (typeof MONTH_FIXED)[number]['key'];
type WeekColumnKey = (typeof WEEK_COLUMNS)[number]['key'];

export type SchoolCalendarImportIssue = {
  row: number;
  sheet: 'month' | 'week';
  code: string;
  detail?: string;
};

export type SchoolCalendarImportWeek = {
  row: number;
  monday: string;
  theme: string;
  sharedFocus: string;
  focuses: Array<{ moduleName: string; focus: string }>;
};

export type SchoolCalendarImportEvent = {
  row: number;
  eventDate: string;
  moduleName: string;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  ownerName: string;
  participantNames: string[];
  status: string;
  note: string;
};

export type SchoolCalendarWorkbookData = {
  weeks: SchoolCalendarImportWeek[];
  events: SchoolCalendarImportEvent[] | null;
  issues: SchoolCalendarImportIssue[];
};

const MONTH_HEADER: Record<string, MonthFixedKey> = {};
for (const column of MONTH_FIXED) {
  MONTH_HEADER[normHeader(column.zh)] = column.key;
  MONTH_HEADER[normHeader(column.en)] = column.key;
}

const WEEK_HEADER: Record<string, WeekColumnKey> = {};
for (const column of WEEK_COLUMNS) {
  WEEK_HEADER[normHeader(column.zh)] = column.key;
  WEEK_HEADER[normHeader(column.en)] = column.key;
}

const STATUS_LABEL: Record<string, [string, string]> = {
  planned: ['待完成', 'To do'],
  done: ['已完成', 'Done'],
  cancelled: ['已取消', 'Cancelled'],
};

function normHeader(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

function calendarTitle(yearLabel: string): { zh: string; en: string } {
  const year = yearLabel.trim() || '202x-202x';
  return {
    zh: `${year} ${SCHOOL_CALENDAR_TITLE}校历`,
    en: `${year} Hefei SUIS School Calendar`,
  };
}

function weekLabel(week: { phase: string; weekIndex: number }, isZh: boolean): string {
  if (week.phase === 'autumn_prep' || week.phase === 'spring_prep') return isZh ? '第0周' : 'W0';
  if (week.phase === 'winter') return isZh ? '寒假' : 'Winter';
  if (week.phase === 'summer') return isZh ? '暑假' : 'Summer';
  return isZh ? `第${week.weekIndex}周` : `W${week.weekIndex}`;
}

function personLabel(isZh: boolean, zh: string, en: string): string {
  const primary = (isZh ? zh : en).trim();
  const fallback = (isZh ? en : zh).trim();
  return primary || fallback;
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
    const rec = value as { richText?: Array<{ text?: string }>; text?: string; result?: unknown };
    if (Array.isArray(rec.richText)) return rec.richText.map((part) => part.text ?? '').join('').trim();
    if (typeof rec.text === 'string') return rec.text.trim();
    if ('result' in rec) return cellText(rec.result);
  }
  return '';
}

function headerLines(value: unknown): string[] {
  const text = cellText(value);
  const parts = text.split(/[\r\n]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [];
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

function normalizeTime(value: unknown): string {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const total = Math.round(value * 24 * 60);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  const text = cellText(value).replace(/：/g, ':').replace(/\s+/g, '');
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return text;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
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
}, column: { zh: string; en: string }) {
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

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
};

function writeBodyCell(cell: {
  value?: unknown;
  font?: unknown;
  alignment?: unknown;
  border?: unknown;
  numFmt?: string;
}, value: string, align: 'left' | 'center') {
  cell.value = value;
  cell.numFmt = '@';
  cell.alignment = { horizontal: align, vertical: align === 'left' ? 'top' : 'middle', wrapText: true };
  cell.font = { name: 'Microsoft YaHei', size: 11, color: { argb: 'FF1E293B' } };
  cell.border = thinBorder;
}

function sheetByName(sheets: Array<{ name: string }>, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return sheets.find((sheet) => wanted.has(sheet.name.trim().toLowerCase()));
}

export async function buildSchoolCalendarWorkbook(input: {
  board: SchoolCalendarBoard;
  academicYearLabel: string;
  isZh: boolean;
}): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = SCHOOL_CALENDAR_TITLE;
  const title = calendarTitle(input.academicYearLabel);
  const modules = input.board.modules;
  const monthColumns = [
    ...MONTH_FIXED.map((column) => ({ ...column })),
    ...modules.map((mod) => ({
      key: mod.id,
      zh: mod.nameZh || mod.nameEn || mod.id,
      en: mod.nameEn || mod.nameZh || mod.id,
      width: 36,
    })),
  ];
  const month = workbook.addWorksheet('月历');
  month.columns = monthColumns.map((column) => ({ width: column.width }));
  month.mergeCells(1, 1, 1, monthColumns.length);
  month.getRow(1).height = 48;
  for (let col = 1; col <= monthColumns.length; col += 1) {
    paintTitle(month.getCell(1, col), col === 1 ? title : null);
  }
  month.getRow(2).height = 36;
  monthColumns.forEach((column, index) => paintHeader(month.getCell(2, index + 1), column));

  const focusAt = new Map<string, string>();
  for (const row of input.board.focuses) focusAt.set(`${row.weekId}:${row.moduleId}`, row.focus);
  const staffAt = new Map(input.board.staff.map((person) => [person.id, person]));
  const moduleAt = new Map(modules.map((mod) => [mod.id, mod]));
  const weeks = [...input.board.weeks].sort((a, b) => a.monday.localeCompare(b.monday));
  weeks.forEach((week, index) => {
    const excelRow = month.getRow(index + 3);
    const values = [
      week.monday,
      weekLabel(week, input.isZh),
      week.theme,
      week.sharedFocus,
      ...modules.map((mod) => focusAt.get(`${week.id}:${mod.id}`) ?? ''),
    ];
    const lines = Math.max(1, ...values.map((value) => value.split(/\n/).length));
    excelRow.height = Math.min(140, Math.max(22, lines * 16));
    values.forEach((value, colIndex) => {
      writeBodyCell(excelRow.getCell(colIndex + 1), value, colIndex <= 1 ? 'center' : 'left');
    });
  });
  month.views = [{ state: 'frozen', ySplit: 2 }];

  const weekSheet = workbook.addWorksheet('周历');
  weekSheet.columns = WEEK_COLUMNS.map((column) => ({ width: column.width }));
  weekSheet.mergeCells(1, 1, 1, WEEK_COLUMNS.length);
  weekSheet.getRow(1).height = 48;
  for (let col = 1; col <= WEEK_COLUMNS.length; col += 1) {
    paintTitle(weekSheet.getCell(1, col), col === 1 ? title : null);
  }
  weekSheet.getRow(2).height = 36;
  WEEK_COLUMNS.forEach((column, index) => paintHeader(weekSheet.getCell(2, index + 1), column));
  const events = [...input.board.events].sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime));
  events.forEach((event, index) => {
    const excelRow = weekSheet.getRow(index + 3);
    const mod = moduleAt.get(event.moduleId);
    const owner = event.ownerUserId ? staffAt.get(event.ownerUserId) : undefined;
    const participants = event.participantIds
      .map((id) => staffAt.get(id))
      .filter((person): person is NonNullable<typeof person> => Boolean(person))
      .map((person) => personLabel(input.isZh, person.nameZh, person.nameEn))
      .filter(Boolean)
      .join('、');
    const status = STATUS_LABEL[event.status] ?? STATUS_LABEL.planned;
    const values = [
      event.eventDate,
      mod ? personLabel(input.isZh, mod.nameZh, mod.nameEn) : '',
      event.startTime,
      event.endTime,
      event.title,
      event.location,
      owner ? personLabel(input.isZh, owner.nameZh, owner.nameEn) : '',
      participants,
      personLabel(input.isZh, status[0], status[1]),
      event.note,
    ];
    const lines = Math.max(1, ...values.map((value) => value.split(/\n/).length));
    excelRow.height = Math.min(80, Math.max(22, lines * 16));
    values.forEach((value, colIndex) => {
      const key = WEEK_COLUMNS[colIndex].key;
      const align = key === 'title' || key === 'location' || key === 'participants' || key === 'note' ? 'left' : 'center';
      writeBodyCell(excelRow.getCell(colIndex + 1), value, align);
    });
  });
  weekSheet.views = [{ state: 'frozen', ySplit: 2 }];
  const buf = await workbook.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export async function downloadSchoolCalendarWorkbook(input: {
  board: SchoolCalendarBoard;
  academicYearLabel: string;
  isZh: boolean;
}): Promise<void> {
  const buf = await buildSchoolCalendarWorkbook(input);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const yearPart = input.academicYearLabel.replace(/\s+/g, '') || 'year';
  const name = input.isZh ? `校历-${yearPart}-${stamp}.xlsx` : `school-calendar-${yearPart}-${stamp}.xlsx`;
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function findHeaderRow(
  sheet: { rowCount?: number; getRow: (row: number) => { cellCount: number; getCell: (col: number) => { value?: unknown } } },
  lookup: Record<string, string>,
  required: string[],
): { headerRow: number; columns: Map<string, number> } | null {
  const maxScan = Math.min(sheet.rowCount || 8, 8);
  for (let rowNumber = 1; rowNumber <= Math.max(maxScan, 1); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const found = new Map<string, number>();
    const lastCol = Math.max(row.cellCount, required.length);
    for (let col = 1; col <= lastCol; col += 1) {
      for (const line of headerLines(row.getCell(col).value)) {
        const key = lookup[normHeader(line)];
        if (key && !found.has(key)) found.set(key, col);
      }
    }
    if (required.every((key) => found.has(key))) return { headerRow: rowNumber, columns: found };
  }
  return null;
}

function sheetLooksLike(
  sheet: { rowCount?: number; getRow: (row: number) => { cellCount: number; getCell: (col: number) => { value?: unknown } } },
  lookup: Record<string, string>,
  required: string[],
): boolean {
  return findHeaderRow(sheet, lookup, required) != null;
}

export async function parseSchoolCalendarWorkbook(arrayBuffer: ArrayBuffer): Promise<SchoolCalendarWorkbookData> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    return { weeks: [], events: null, issues: [{ row: 1, sheet: 'month', code: 'file_unreadable' }] };
  }
  const sheets = workbook.worksheets;
  if (sheets.length === 0) return { weeks: [], events: null, issues: [{ row: 1, sheet: 'month', code: 'empty_sheet' }] };

  const namedMonth = sheetByName(sheets, ['月历', 'Month']);
  const namedWeek = sheetByName(sheets, ['周历', 'Week']);
  const monthSheet = namedMonth ?? sheets.find((sheet) => sheetLooksLike(sheet, MONTH_HEADER, ['monday', 'theme', 'shared']));
  const weekSheet = namedWeek ?? sheets.find((sheet) => sheet !== monthSheet && sheetLooksLike(sheet, WEEK_HEADER, ['date', 'module', 'title']));
  if (!monthSheet) return { weeks: [], events: null, issues: [{ row: 1, sheet: 'month', code: 'empty_sheet' }] };

  const monthHeader = findHeaderRow(monthSheet, MONTH_HEADER, ['monday', 'theme', 'shared']);
  if (!monthHeader) {
    return { weeks: [], events: null, issues: [{ row: 2, sheet: 'month', code: 'missing_columns' }] };
  }
  const issues: SchoolCalendarImportIssue[] = [];
  const weeks: SchoolCalendarImportWeek[] = [];
  const seenMonday = new Set<string>();
  const moduleCols: Array<{ col: number; moduleName: string }> = [];
  const headerRow = monthSheet.getRow(monthHeader.headerRow);
  const lastCol = Math.max(headerRow.cellCount, MONTH_FIXED.length);
  const used = new Set(monthHeader.columns.values());
  for (let col = 1; col <= lastCol; col += 1) {
    if (used.has(col)) continue;
    const lines = headerLines(headerRow.getCell(col).value);
    if (lines.length === 0) continue;
    moduleCols.push({ col, moduleName: lines.join('\n') });
  }
  for (let rowNumber = monthHeader.headerRow + 1; rowNumber <= (monthSheet.rowCount || monthHeader.headerRow); rowNumber += 1) {
    const row = monthSheet.getRow(rowNumber);
    const monday = formatDateCell(row.getCell(monthHeader.columns.get('monday') ?? 1).value);
    const theme = cellText(row.getCell(monthHeader.columns.get('theme') ?? 1).value).replace(/\r\n/g, '\n');
    const sharedFocus = cellText(row.getCell(monthHeader.columns.get('shared') ?? 1).value).replace(/\r\n/g, '\n');
    const focuses = moduleCols
      .map((column) => ({
        moduleName: column.moduleName,
        focus: cellText(row.getCell(column.col).value).replace(/\r\n/g, '\n'),
      }))
      .filter((item) => item.focus.trim());
    if (!monday && !theme && !sharedFocus && focuses.length === 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) {
      issues.push({ row: rowNumber, sheet: 'month', code: 'invalid_date', detail: monday });
      continue;
    }
    if (seenMonday.has(monday)) issues.push({ row: rowNumber, sheet: 'month', code: 'duplicate_monday', detail: monday });
    seenMonday.add(monday);
    weeks.push({ row: rowNumber, monday, theme, sharedFocus, focuses });
  }
  if (weeks.length === 0) issues.push({ row: monthHeader.headerRow, sheet: 'month', code: 'no_rows' });

  let events: SchoolCalendarImportEvent[] | null = null;
  if (weekSheet) {
    events = [];
    const weekHeader = findHeaderRow(weekSheet, WEEK_HEADER, ['date', 'module', 'title']);
    if (!weekHeader) {
      issues.push({ row: 2, sheet: 'week', code: 'missing_columns' });
    } else {
      const col = (key: WeekColumnKey) => weekHeader.columns.get(key) ?? 0;
      for (let rowNumber = weekHeader.headerRow + 1; rowNumber <= (weekSheet.rowCount || weekHeader.headerRow); rowNumber += 1) {
        const row = weekSheet.getRow(rowNumber);
        const eventDate = col('date') ? formatDateCell(row.getCell(col('date')).value) : '';
        const moduleName = col('module') ? cellText(row.getCell(col('module')).value) : '';
        const startTime = col('start') ? normalizeTime(row.getCell(col('start')).value) : '';
        const endTime = col('end') ? normalizeTime(row.getCell(col('end')).value) : '';
        const title = col('title') ? cellText(row.getCell(col('title')).value) : '';
        const location = col('location') ? cellText(row.getCell(col('location')).value) : '';
        const ownerName = col('owner') ? cellText(row.getCell(col('owner')).value) : '';
        const participantText = col('participants') ? cellText(row.getCell(col('participants')).value) : '';
        const status = col('status') ? cellText(row.getCell(col('status')).value) : '';
        const note = col('note') ? cellText(row.getCell(col('note')).value).replace(/\r\n/g, '\n') : '';
        if (!eventDate && !moduleName && !title && !startTime && !endTime && !location && !ownerName && !participantText && !note) continue;
        const rowIssues: SchoolCalendarImportIssue[] = [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) rowIssues.push({ row: rowNumber, sheet: 'week', code: 'invalid_date', detail: eventDate });
        if (!moduleName.trim()) rowIssues.push({ row: rowNumber, sheet: 'week', code: 'module_required' });
        if (!title.trim()) rowIssues.push({ row: rowNumber, sheet: 'week', code: 'title_required' });
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) {
          rowIssues.push({ row: rowNumber, sheet: 'week', code: 'invalid_time', detail: `${startTime}-${endTime}` });
        }
        issues.push(...rowIssues);
        events.push({
          row: rowNumber,
          eventDate,
          moduleName,
          startTime,
          endTime,
          title,
          location,
          ownerName,
          participantNames: participantText.split(/[、,，;；\n]+/).map((part) => part.trim()).filter(Boolean),
          status,
          note,
        });
      }
    }
  }
  return { weeks, events, issues };
}
