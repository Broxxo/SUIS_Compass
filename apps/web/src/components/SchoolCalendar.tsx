/**
 * 校历：月历看每周主题。周历只列出这一周真正上课的日子，和月历里的放假、调休对齐。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ChevronLeft, ChevronRight, GripVertical, Plus, X } from 'lucide-react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { SegmentTabButton, SegmentTabGroup, SegmentTabStrip } from './ui/segment-tab-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { MenuSelect } from './MenuSelect';
import { AcademicYearSelect } from './academicPeriodSelectors';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../lib/api';
import { latestAcademicYear } from '../lib/academicPeriodDefault';
import type { AcademicYear } from '../types/classManagement';
import {
  createSchoolCalendarEvent,
  createSchoolCalendarModule,
  deleteSchoolCalendarModule,
  fetchPublicHolidays,
  fetchSchoolCalendar,
  importSchoolCalendar,
  resetSchoolCalendarSettings,
  saveSchoolCalendarFocus,
  saveSchoolCalendarTheme,
  saveSchoolCalendarSettings,
  updateSchoolCalendarEvent,
  updateSchoolCalendarModule,
  type PublicHolidayDay,
  type SchoolCalendarBoard,
  type SchoolCalendarEvent,
  type SchoolCalendarModule,
  type SchoolCalendarWeek,
} from '../lib/schoolCalendarApi';
import { downloadSchoolCalendarWorkbook, parseSchoolCalendarWorkbook, type SchoolCalendarImportIssue } from '../lib/schoolCalendarExcel';

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function md(value: string): string {
  const [, month, day] = value.split('-');
  return `${month}/${day}`;
}

function yearMonthParts(key: string): { year: string; month: string } {
  const [year, month] = key.split('-');
  return { year, month };
}

function importIssueText(issue: SchoolCalendarImportIssue, isZh: boolean): string {
  const where = isZh
    ? `${issue.sheet === 'week' ? '周历' : '月历'}第 ${issue.row} 行`
    : `${issue.sheet === 'week' ? 'Week' : 'Month'} row ${issue.row}`;
  const zh: Record<string, string> = {
    file_unreadable: '读不了这个文件，请使用导出的 xlsx 表格。',
    empty_sheet: '没有找到月历表。请使用导出的表格。',
    missing_columns: '表头缺了必要的列。',
    no_rows: '月历里没有可导入的周。',
    invalid_date: '日期要写成 2026-09-01，并且落在本学年的某一周里。',
    duplicate_monday: '这一周重复了。',
    module_not_found: '找不到这个模块。',
    module_ambiguous: '模块名称对应了不止一个模块。',
    module_required: '请填写模块。',
    title_required: '请填写事项。',
    title_too_long: '事项太长了。',
    invalid_time: '结束时间要晚于开始时间。',
    invalid_status: '状态只能是计划中、已完成或已取消。',
    theme_too_long: '周主题太长了。',
    focus_too_long: '关键工作太长了。',
    location_too_long: '地点太长了。',
    note_too_long: '备注太长了。',
    owner_not_found: '找不到这位负责人。',
    owner_ambiguous: '负责人对应了不止一位老师。',
    participant_not_found: '找不到这位参与人。',
    participant_ambiguous: '参与人对应了不止一位老师。',
  };
  const en: Record<string, string> = {
    file_unreadable: 'This file could not be read. Use the exported xlsx workbook.',
    empty_sheet: 'No month sheet was found. Use the exported workbook.',
    missing_columns: 'The header is missing required columns.',
    no_rows: 'The month sheet has no weeks to import.',
    invalid_date: 'Use a date like 2026-09-01 that falls in this academic year.',
    duplicate_monday: 'This week appears more than once.',
    module_not_found: 'This module was not found.',
    module_ambiguous: 'This module name matches more than one module.',
    module_required: 'Choose a module.',
    title_required: 'Enter a title.',
    title_too_long: 'The title is too long.',
    invalid_time: 'The end time has to be later than the start time.',
    invalid_status: 'Status must be Planned, Done, or Cancelled.',
    theme_too_long: 'The theme is too long.',
    focus_too_long: 'The key work is too long.',
    location_too_long: 'The location is too long.',
    note_too_long: 'The note is too long.',
    owner_not_found: 'This owner was not found.',
    owner_ambiguous: 'This owner matches more than one person.',
    participant_not_found: 'This participant was not found.',
    participant_ambiguous: 'This participant matches more than one person.',
  };
  const text = (isZh ? zh : en)[issue.code] ?? issue.code;
  const detail = issue.detail ? `（${issue.detail}）` : '';
  return `${where}：${text}${detail}`;
}

function errorText(code: string, isZh: boolean): string {
  const zh: Record<string, string> = {
    past_locked: '已经过去的内容只有管理员可以改。',
    forbidden: '没有修改这个模块的权限。',
    invalid_bounds: '日期顺序需要是：开学，然后寒假，然后春季开学，然后暑假。',
    invalid_time: '结束时间要晚于开始时间。',
    invalid_date: '这一天不在本学年的周次里。',
    last_module: '至少保留一个模块。',
    name_required: '请填写模块名称。',
    internal: '保存没有成功，请稍后再试。',
  };
  if (isZh) return zh[code] ?? zh.internal;
  return code;
}

function mondayOnOrBefore(value: string): string {
  const day = weekday(value);
  const delta = day === 0 ? 6 : day - 1;
  return addDays(value, -delta);
}

function isAutoOff(date: string, settings: SchoolCalendarBoard['settings']): boolean {
  const prepMonday = addDays(mondayOnOrBefore(settings.springTermStart), -7);
  const prepFriday = addDays(prepMonday, 4);
  if (date >= prepMonday && date <= prepFriday) return false;
  return (date >= settings.winterBreakStart && date < settings.springTermStart) || date >= settings.summerBreakStart;
}

function isBreakPhase(phase: SchoolCalendarWeek['phase']): boolean {
  return phase === 'winter' || phase === 'summer';
}

function weekLabel(week: SchoolCalendarWeek, isZh: boolean): string {
  if (week.phase === 'autumn_prep' || week.phase === 'spring_prep') return isZh ? '第0周' : 'W0';
  if (week.phase === 'winter') return isZh ? '寒假' : 'Winter';
  if (week.phase === 'summer') return isZh ? '暑假' : 'Summer';
  return isZh ? `第${week.weekIndex}周` : `W${week.weekIndex}`;
}

function dayIsOff(date: string, board: SchoolCalendarBoard): boolean {
  return isAutoOff(date, board.settings);
}

function isSchoolWorkDay(
  date: string,
  board: SchoolCalendarBoard,
  holidayByDate: Map<string, PublicHolidayDay>,
): boolean {
  const mark = holidayByDate.get(date);
  if (mark?.kind === 'off') return false;
  if (isAutoOff(date, board.settings)) return false;
  if (mark?.kind === 'work') return true;
  const day = weekday(date);
  return day >= 1 && day <= 5;
}

function weekDays(
  week: SchoolCalendarWeek,
  board: SchoolCalendarBoard,
  holidayByDate: Map<string, PublicHolidayDay>,
): string[] {
  return [0, 1, 2, 3, 4, 5, 6]
    .map((offset) => addDays(week.monday, offset))
    .filter((date) => isSchoolWorkDay(date, board, holidayByDate));
}

function formatDaySpan(days: string[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return md(days[0]);
  return `${md(days[0])}–${md(days[days.length - 1])}`;
}

function staffName(board: SchoolCalendarBoard, id: string | null, isZh: boolean): string {
  if (!id) return '';
  const person = board.staff.find((item) => item.id === id);
  if (!person) return '';
  return isZh ? person.nameZh || person.nameEn : person.nameEn || person.nameZh;
}

function timesOverlap(a: SchoolCalendarEvent, b: SchoolCalendarEvent): boolean {
  return (
    a.id !== b.id &&
    a.eventDate === b.eventDate &&
    a.status !== 'cancelled' &&
    b.status !== 'cancelled' &&
    a.startTime < b.endTime &&
    b.startTime < a.endTime
  );
}

export default function SchoolCalendar({ onBackToHub }: { onBackToHub?: () => void }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const canManageCalendar = user?.role === 'admin' || user?.role === 'system-admin';
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState('');
  const [board, setBoard] = useState<SchoolCalendarBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [weekId, setWeekId] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusEdit, setFocusEdit] = useState<{ weekId: string; moduleId: string } | null>(null);
  const [themeEditWeekId, setThemeEditWeekId] = useState<string | null>(null);
  const [eventEdit, setEventEdit] = useState<SchoolCalendarEvent | 'new' | null>(null);
  const [eventDate, setEventDate] = useState('');
  const [eventWeekId, setEventWeekId] = useState('');
  const [eventModuleId, setEventModuleId] = useState('');
  const [holidayDays, setHolidayDays] = useState<PublicHolidayDay[]>([]);
  const [excelBusy, setExcelBusy] = useState<'export' | 'import' | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const reload = async (nextYear = yearId) => {
    if (!nextYear) return;
    setLoading(true);
    setPageError('');
    try {
      const next = await fetchSchoolCalendar(nextYear);
      setBoard(next);
      setWeekId((current) => {
        if (current && next.weeks.some((week) => week.id === current)) return current;
        const hit =
          next.weeks.find((week) => next.today >= week.monday && next.today <= addDays(week.monday, 6)) ??
          next.weeks[0];
        return hit?.id ?? '';
      });
    } catch (error) {
      setPageError(errorText(error instanceof Error ? error.message : 'internal', isZh));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.getAcademicYears()
      .then((list) => {
        setYears(list);
        const current = list.find((year) => year.isCurrent) ?? latestAcademicYear(list);
        setYearId(current?.id ?? '');
      })
      .catch(() => setPageError(isZh ? '学年没有读出来。' : 'Could not load years.'));
  }, [isZh]);

  useEffect(() => {
    fetchPublicHolidays()
      .then((feed) => setHolidayDays(feed.days))
      .catch(() => setHolidayDays([]));
  }, []);

  useEffect(() => {
    if (!yearId) return;
    void reload(yearId);
    // reload identity changes with yearId only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId]);

  const week = board?.weeks.find((item) => item.id === weekId) ?? null;
  const visibleModules = useMemo(() => {
    if (!board) return [];
    if (moduleFilter === 'all') return board.modules;
    return board.modules.filter((item) => item.id === moduleFilter);
  }, [board, moduleFilter]);

  const holidayByDate = useMemo(() => {
    const marks = new Map<string, PublicHolidayDay>();
    for (const day of holidayDays) marks.set(day.date, day);
    return marks;
  }, [holidayDays]);

  const months = useMemo(() => {
    if (!board) return [];
    const groups = new Map<string, SchoolCalendarWeek[]>();
    for (const item of board.weeks) {
      const key = item.monday.slice(0, 7);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [board]);

  const canEditModule = (moduleId: string, boundaryDate: string) => {
    if (!board) return false;
    if (!board.editableModuleIds.includes(moduleId)) return false;
    if (boundaryDate < board.today) return board.isAdmin;
    return true;
  };

  const showImportProblems = (issues: SchoolCalendarImportIssue[]) => {
    const lines = issues.slice(0, 12).map((issue) => importIssueText(issue, isZh));
    if (issues.length > 12) lines.push(isZh ? `…还有 ${issues.length - 12} 条` : `…${issues.length - 12} more`);
    const text = lines.join('\n');
    setPageError(text);
    window.alert(text);
  };

  const exportExcel = async () => {
    if (!board || !yearId || excelBusy) return;
    setExcelBusy('export');
    setPageError('');
    try {
      const yearLabel = years.find((year) => year.id === yearId)?.name ?? '';
      await downloadSchoolCalendarWorkbook({ board, academicYearLabel: yearLabel, isZh });
    } catch (error) {
      setPageError(errorText(error instanceof Error ? error.message : 'internal', isZh));
    } finally {
      setExcelBusy(null);
    }
  };

  const importExcel = async (file: File) => {
    if (!board || !yearId || excelBusy) return;
    setExcelBusy('import');
    setPageError('');
    try {
      const parsed = await parseSchoolCalendarWorkbook(await file.arrayBuffer());
      if (parsed.issues.length > 0) {
        showImportProblems(parsed.issues);
        return;
      }
      const yearLabel = years.find((year) => year.id === yearId)?.name ?? '';
      const ok = window.confirm(
        parsed.events
          ? isZh
            ? `将用这个表格替换 ${yearLabel} 的月历和周历。表格里没有的周会清空，没有的事项会删除。`
            : `This replaces the ${yearLabel} month and week calendars. Weeks and events missing from the file will be cleared.`
          : isZh
            ? `将用这个表格替换 ${yearLabel} 的月历。表格里没有的周会清空。周历事项保持不变。`
            : `This replaces the ${yearLabel} month calendar. Weeks missing from the file will be cleared. Week events stay as they are.`,
      );
      if (!ok) return;
      const result = await importSchoolCalendar(yearId, { weeks: parsed.weeks, events: parsed.events });
      await reload();
      window.alert(
        result.eventsReplaced
          ? isZh
            ? `已导入月历 ${result.weekCount} 周，周历 ${result.eventCount} 条事项。`
            : `Imported ${result.weekCount} weeks and ${result.eventCount} events.`
          : isZh
            ? `已导入月历 ${result.weekCount} 周。`
            : `Imported ${result.weekCount} weeks.`,
      );
    } catch (error) {
      const issues = error && typeof error === 'object' && 'issues' in error
        ? (error as { issues?: SchoolCalendarImportIssue[] }).issues
        : undefined;
      if (issues && issues.length > 0) showImportProblems(issues);
      else setPageError(errorText(error instanceof Error ? error.message : 'internal', isZh));
    } finally {
      setExcelBusy(null);
    }
  };

  const run = async (task: () => Promise<void>) => {
    setPageError('');
    try {
      await task();
      await reload();
    } catch (error) {
      setPageError(errorText(error instanceof Error ? error.message : 'internal', isZh));
    }
  };

  return (
    <div className="min-h-dvh w-full max-w-[100%] overflow-x-auto bg-slate-50 pt-[calc(var(--app-topbar-height)+0.5rem)]">
      <AppTopBar title={isZh ? '校历' : 'School Calendar'} showBack={!!onBackToHub} onBack={onBackToHub} />
      <div className="mx-auto w-[85%] min-w-0 px-3 py-4 sm:px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <AcademicYearSelect years={years} value={yearId} isZh={isZh} onChange={setYearId} />
            <SegmentTabStrip aria-label={isZh ? '校历视图' : 'Calendar view'}>
              <SegmentTabGroup>
                <SegmentTabButton grouped active={mode === 'week'} onClick={() => setMode('week')}>
                  {isZh ? '周历' : 'Week'}
                </SegmentTabButton>
                <SegmentTabButton grouped active={mode === 'month'} onClick={() => setMode('month')}>
                  {isZh ? '月历' : 'Month'}
                </SegmentTabButton>
              </SegmentTabGroup>
              {board ? (
                <SegmentTabGroup>
                  <SegmentTabButton grouped active={moduleFilter === 'all'} onClick={() => setModuleFilter('all')}>
                    {isZh ? '全部模块' : 'All'}
                  </SegmentTabButton>
                  {board.modules.map((mod) => (
                    <SegmentTabButton
                      key={mod.id}
                      grouped
                      active={moduleFilter === mod.id}
                      onClick={() => setModuleFilter(mod.id)}
                    >
                      {isZh ? mod.nameZh : mod.nameEn}
                    </SegmentTabButton>
                  ))}
                </SegmentTabGroup>
              ) : null}
            </SegmentTabStrip>
          </div>
          {canManageCalendar && board ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={excelBusy !== null} onClick={() => void exportExcel()}>
                {excelBusy === 'export' ? (isZh ? '导出中…' : 'Exporting…') : isZh ? '导出 Excel' : 'Export Excel'}
              </Button>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importExcel(file);
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={excelBusy !== null} onClick={() => excelInputRef.current?.click()}>
                {excelBusy === 'import' ? (isZh ? '导入中…' : 'Importing…') : isZh ? '导入 Excel' : 'Import Excel'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                {isZh ? '校历设置' : 'Calendar settings'}
              </Button>
            </div>
          ) : null}
        </div>

        {pageError ? <p className="mt-3 whitespace-pre-line text-sm text-red-600">{pageError}</p> : null}
        {loading || !board ? (
          <p className="mt-6 text-sm text-slate-500">{isZh ? '正在读取校历…' : 'Loading calendar…'}</p>
        ) : mode === 'month' ? (
          <MonthTable
            board={board}
            months={months}
            modules={visibleModules}
            isZh={isZh}
            canEditModule={canEditModule}
            holidayByDate={holidayByDate}
            onOpenWeek={(id) => {
              setWeekId(id);
              setMode('week');
            }}
            onTheme={(targetWeekId) => setThemeEditWeekId(targetWeekId)}
            onFocus={(targetWeekId, moduleId) => setFocusEdit({ weekId: targetWeekId, moduleId })}
          />
        ) : week ? (
          <WeekBoard
            board={board}
            week={week}
            modules={visibleModules}
            isZh={isZh}
            holidayByDate={holidayByDate}
            canEditModule={canEditModule}
            onPrev={() => {
              const index = board.weeks.findIndex((item) => item.id === week.id);
              const prev = board.weeks[index - 1];
              if (prev) setWeekId(prev.id);
            }}
            onNext={() => {
              const index = board.weeks.findIndex((item) => item.id === week.id);
              const next = board.weeks[index + 1];
              if (next) setWeekId(next.id);
            }}
            onAdd={(targetWeekId, date, moduleId) => {
              setEventWeekId(targetWeekId);
              setEventDate(date);
              setEventModuleId(moduleId);
              setEventEdit('new');
            }}
            onOpen={(event) => {
              setEventWeekId(event.weekId);
              setEventDate(event.eventDate);
              setEventModuleId(event.moduleId);
              setEventEdit(event);
            }}
          />
        ) : null}
      </div>

      {canManageCalendar && board && settingsOpen ? (
        <SettingsDialog
          board={board}
          isZh={isZh}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => void reload()}
        />
      ) : null}
      {board && themeEditWeekId ? (
        <ThemeDialog
          board={board}
          weekId={themeEditWeekId}
          isZh={isZh}
          onClose={() => setThemeEditWeekId(null)}
          onSaved={() => void run(async () => setThemeEditWeekId(null))}
        />
      ) : null}
      {board && focusEdit ? (
        <FocusDialog
          board={board}
          weekId={focusEdit.weekId}
          moduleId={focusEdit.moduleId}
          isZh={isZh}
          onClose={() => setFocusEdit(null)}
          onSaved={() => void run(async () => setFocusEdit(null))}
        />
      ) : null}
      {board && eventEdit && (board.weeks.find((item) => item.id === eventWeekId) ?? week) ? (
        <EventDialog
          board={board}
          week={(board.weeks.find((item) => item.id === eventWeekId) ?? week)!}
          event={eventEdit === 'new' ? null : eventEdit}
          initialModuleId={eventModuleId}
          initialDate={eventDate || week?.monday || ''}
          isZh={isZh}
          holidayByDate={holidayByDate}
          canEditModule={canEditModule}
          onClose={() => setEventEdit(null)}
          onSaved={() => void run(async () => setEventEdit(null))}
        />
      ) : null}
    </div>
  );
}

const MONTH_WEEKDAY_HEAD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthWeekDates(monday: string): string[] {
  const sunday = addDays(monday, -1);
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(sunday, offset));
}

function calendarDayText(iso: string, monthKey: string): string {
  const [, month, day] = iso.split('-');
  if (iso.slice(0, 7) === monthKey) return String(Number(day));
  return `${Number(month)}/${Number(day)}`;
}

const cellBorder = 'border border-slate-200 align-top';
const cellHover = 'hover:shadow-[inset_0_0_0_999px_rgba(15,23,42,0.03)]';
const headCell = `border border-slate-200 align-middle sticky top-[var(--app-topbar-height)] z-20 bg-slate-100 px-2 py-1.5 text-center text-base font-semibold text-slate-700`;

function MonthTable({
  board,
  months,
  modules,
  isZh,
  canEditModule,
  holidayByDate,
  onOpenWeek,
  onTheme,
  onFocus,
}: {
  board: SchoolCalendarBoard;
  months: Array<[string, SchoolCalendarWeek[]]>;
  modules: SchoolCalendarModule[];
  isZh: boolean;
  canEditModule: (moduleId: string, boundaryDate: string) => boolean;
  holidayByDate: Map<string, PublicHolidayDay>;
  onOpenWeek: (weekId: string) => void;
  onTheme: (weekId: string) => void;
  onFocus: (weekId: string, moduleId: string) => void;
}) {
  const stripedWeek = new Map<string, boolean>();
  let rowOrdinal = 0;
  for (const [, weeks] of months) {
    for (const item of weeks) {
      stripedWeek.set(item.id, rowOrdinal % 2 === 1);
      rowOrdinal += 1;
    }
  }
  return (
    <div className="mt-4">
      <div className="border border-slate-200 bg-white">
      <table className="w-full min-w-[784px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-10" />
          {MONTH_WEEKDAY_HEAD.map((label, index) => (
            <col key={`${label}-${index}`} className="w-[2.475rem]" />
          ))}
          <col className="w-[9.9rem]" />
          {modules.map((mod) => (
            <col key={mod.id} style={{ width: `calc((100% - 29.725rem) / ${Math.max(modules.length, 1)})` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={`${headCell} w-10 px-0 text-center`}>{isZh ? '月' : 'M'}</th>
            {MONTH_WEEKDAY_HEAD.map((label, index) => (
              <th key={`${label}-${index}`} className={`${headCell} w-[2.475rem] px-0`} style={{ textAlign: 'center' }}>
                {label}
              </th>
            ))}
            <th className={`${headCell} w-[9.9rem]`}>{isZh ? '周' : 'Week'}</th>
            {modules.map((mod) => (
              <th key={mod.id} className={`${headCell} overflow-hidden`} style={{ boxShadow: `inset 0 3px 0 ${mod.color}` }}>
                <span className="block truncate">{isZh ? mod.nameZh : mod.nameEn}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map(([key, weeks]) =>
            weeks.map((item, index) => {
              const current = board.today >= item.monday && board.today <= item.friday;
              const breakWeek = isBreakPhase(item.phase);
              const trackBg = breakWeek ? 'bg-sky-100' : stripedWeek.get(item.id) ? 'bg-slate-50' : 'bg-white';
              const dateBg = breakWeek ? 'bg-sky-100' : current ? 'bg-sky-50' : 'bg-white';
              const { year, month } = yearMonthParts(key);
              const themeNode = item.theme
                ? board.isAdmin
                  ? (
                    <button type="button" className="relative z-10 inline hover:underline" onClick={() => onTheme(item.id)}>
                      ：<span className="text-slate-800">{item.theme}</span>
                    </button>
                  )
                  : <span>：{item.theme}</span>
                : null;
              return (
                <tr key={item.id}>
                  {index === 0 ? (
                    <td
                      rowSpan={weeks.length}
                      className={`${cellBorder} ${cellHover} w-10 bg-slate-50 px-0 py-1 text-center align-middle text-[11px] font-semibold leading-tight text-slate-800`}
                      style={{ verticalAlign: 'middle' }}
                    >
                      <span className="block tabular-nums">{year}</span>
                      <span className="block">{isZh ? `${Number(month)}月` : month}</span>
                    </td>
                  ) : null}
                  {monthWeekDates(item.monday).map((date) => {
                    const mark = holidayByDate.get(date);
                    const weekend = weekday(date) === 0 || weekday(date) === 6;
                    const today = date === board.today;
                    const rest = mark?.kind === 'off' || isAutoOff(date, board.settings);
                    const school = isSchoolWorkDay(date, board, holidayByDate);
                    return (
                      <td
                        key={date}
                        title={mark ? `${date} ${mark.title}` : date}
                        className={`border border-slate-200 align-middle ${cellHover} p-0 text-center ${rest ? 'bg-rose-100' : school ? 'bg-emerald-100' : dateBg} ${today ? 'outline outline-1 -outline-offset-1 outline-sky-400' : ''}`}
                        style={{ verticalAlign: 'middle' }}
                      >
                        <div className="flex flex-col items-center justify-center px-0.5 py-1">
                          <span className={`text-[11px] tabular-nums leading-none ${rest ? 'font-semibold text-rose-700' : weekend && !school ? 'text-slate-400' : 'text-slate-700'}`}>
                            {calendarDayText(date, key)}
                          </span>
                          {mark ? (
                            <span className={`mt-0.5 text-[10px] leading-none ${rest ? 'text-rose-600' : 'text-emerald-800'}`}>{mark.label}</span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                  <td className={`${cellBorder} ${cellHover} ${trackBg} relative overflow-hidden px-2 py-1.5 text-center`}>
                    {board.isAdmin && !item.theme ? (
                      <button
                        type="button"
                        className="absolute inset-0"
                        aria-label={isZh ? '填写主题' : 'Theme'}
                        onClick={() => onTheme(item.id)}
                      />
                    ) : null}
                    <button type="button" className="relative z-10 inline break-words text-sm font-semibold leading-snug text-slate-900 hover:underline" onClick={() => onOpenWeek(item.id)}>{weekLabel(item, isZh)}</button>
                    {themeNode}
                    {current ? <span className="relative z-10 ml-1 text-[11px] font-medium text-sky-700">{isZh ? '本周' : 'Now'}</span> : null}
                  </td>
                  {monthFocusCells({
                    modules,
                    week: item,
                    isZh,
                    surfaceClass: trackBg,
                    canEdit: (moduleId) => canEditModule(moduleId, item.friday),
                    focusOf: (moduleId) => board.focuses.find((row) => row.weekId === item.id && row.moduleId === moduleId)?.focus ?? '',
                    onOpen: (moduleId) => onFocus(item.id, moduleId),
                  })}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-100" />
          {isZh ? '寒暑假、法定放假' : 'Breaks and holidays'}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-100" />
          {isZh ? '上学日' : 'School day'}
        </span>
      </div>
    </div>
  );
}

function focusText(raw: string): string {
  return raw.replace(/^(\d+)、/gm, '$1. ');
}

function FocusBlock({
  raw,
  editable,
  isZh,
  onOpen,
  className = '',
}: {
  raw: string;
  editable: boolean;
  isZh: boolean;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <div className={`relative min-h-8 ${className}`}>
      <button
        type="button"
        disabled={!editable}
        aria-label={isZh ? '编辑关键工作' : 'Edit key work'}
        className="absolute inset-0 z-0 disabled:cursor-default enabled:cursor-pointer"
        onClick={() => editable && onOpen()}
      />
      <div className="pointer-events-none relative z-10 min-h-8 whitespace-pre-wrap break-words px-2 py-1.5 text-sm leading-snug text-slate-800">
        {focusText(raw)}
      </div>
    </div>
  );
}

function monthFocusCells({
  modules,
  week,
  isZh,
  surfaceClass,
  canEdit,
  focusOf,
  onOpen,
}: {
  modules: SchoolCalendarModule[];
  week: SchoolCalendarWeek;
  isZh: boolean;
  surfaceClass: string;
  canEdit: (moduleId: string) => boolean;
  focusOf: (moduleId: string) => string;
  onOpen: (moduleId: string) => void;
}) {
  const shared = (week.sharedFocus ?? '').trim();
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < modules.length) {
    const mod = modules[index];
    const next = modules[index + 1];
    if (mod.segmentId && next?.segmentId && shared) {
      const editableSide = [mod, next].find((item) => canEdit(item.id)) ?? mod;
      const split = Boolean(focusOf(mod.id).trim() || focusOf(next.id).trim());
      nodes.push(
        <td key={`${mod.id}-${next.id}`} colSpan={2} className={`${cellBorder} ${cellHover} ${surfaceClass} h-px p-0 align-top`}>
          <FocusBlock className={split ? '' : 'h-full'} raw={shared} editable={canEdit(editableSide.id)} isZh={isZh} onOpen={() => onOpen(editableSide.id)} />
          {split ? (
            <div className="grid grid-cols-2 items-stretch border-t border-slate-200">
              <FocusBlock
                className="h-full border-r border-slate-200"
                raw={focusOf(mod.id)}
                editable={canEdit(mod.id)}
                isZh={isZh}
                onOpen={() => onOpen(mod.id)}
              />
              <FocusBlock className="h-full" raw={focusOf(next.id)} editable={canEdit(next.id)} isZh={isZh} onOpen={() => onOpen(next.id)} />
            </div>
          ) : null}
        </td>,
      );
      index += 2;
      continue;
    }
    const partnerVisible = modules.some((item, itemIndex) => itemIndex !== index && Boolean(item.segmentId));
    const banner = mod.segmentId && !partnerVisible ? shared : '';
    const local = focusOf(mod.id).trim();
    nodes.push(
      <td key={mod.id} className={`${cellBorder} ${cellHover} ${surfaceClass} relative h-px p-0`}>
        {banner && local ? (
          <>
            <FocusBlock raw={shared} editable={canEdit(mod.id)} isZh={isZh} onOpen={() => onOpen(mod.id)} />
            <div className="border-t border-slate-200">
              <FocusBlock className="h-full" raw={focusOf(mod.id)} editable={canEdit(mod.id)} isZh={isZh} onOpen={() => onOpen(mod.id)} />
            </div>
          </>
        ) : (
          <FocusBlock className="h-full" raw={banner ? shared : focusOf(mod.id)} editable={canEdit(mod.id)} isZh={isZh} onOpen={() => onOpen(mod.id)} />
        )}
      </td>,
    );
    index += 1;
  }
  return nodes;
}

function WeekBoard({
  board,
  week,
  modules,
  isZh,
  holidayByDate,
  canEditModule,
  onPrev,
  onNext,
  onAdd,
  onOpen,
}: {
  board: SchoolCalendarBoard;
  week: SchoolCalendarWeek;
  modules: SchoolCalendarModule[];
  isZh: boolean;
  holidayByDate: Map<string, PublicHolidayDay>;
  canEditModule: (moduleId: string, boundaryDate: string) => boolean;
  onPrev: () => void;
  onNext: () => void;
  onAdd: (weekId: string, date: string, moduleId: string) => void;
  onOpen: (event: SchoolCalendarEvent) => void;
}) {
  const index = board.weeks.findIndex((item) => item.id === week.id);
  const visible = [index - 1, index, index + 1]
    .filter((i) => i >= 0 && i < board.weeks.length)
    .map((i) => board.weeks[i]);
  const coveredDates = new Set(visible.flatMap((item) => weekDays(item, board, holidayByDate)));
  const selectedSpan = formatDaySpan(weekDays(week, board, holidayByDate));
  const events = board.events.filter(
    (event) => modules.some((mod) => mod.id === event.moduleId) && coveredDates.has(event.eventDate),
  );
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-center gap-1">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300"
          aria-label={isZh ? '上一周' : 'Previous week'}
          onClick={onPrev}
          disabled={index <= 0}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="px-1 text-sm text-slate-600">
          {weekLabel(week, isZh)}
          <span className="ml-2 text-slate-400">{selectedSpan || `${md(week.monday)}–${md(week.friday)}`}</span>
        </p>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300"
          aria-label={isZh ? '下一周' : 'Next week'}
          onClick={onNext}
          disabled={index < 0 || index >= board.weeks.length - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="border border-slate-200 bg-white">
        <table className="w-full min-w-[646px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[5.95rem]" />
            <col className="w-16" />
            {modules.map((mod) => (
              <col key={mod.id} style={{ width: `calc((100% - 9.95rem) / ${Math.max(modules.length, 1)})` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={`${headCell} w-[5.95rem]`}>{isZh ? '周' : 'Week'}</th>
              <th className={`${headCell} w-16`}>{isZh ? '星期' : 'Day'}</th>
              {modules.map((mod) => (
                <th key={mod.id} className={`${headCell} overflow-hidden`} style={{ boxShadow: `inset 0 3px 0 ${mod.color}` }}>
                  <span className="block truncate">{isZh ? mod.nameZh : mod.nameEn}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const days = weekDays(item, board, holidayByDate);
              const selected = item.id === week.id;
              const rowBg = selected ? 'bg-sky-50' : isBreakPhase(item.phase) ? 'bg-slate-50' : 'bg-white';
              const span = formatDaySpan(days) || `${md(item.monday)}–${md(item.friday)}`;
              const weekCell = (
                <td rowSpan={Math.max(days.length, 1)} className={`${cellBorder} ${cellHover} ${rowBg} px-1 py-1.5 text-center align-middle`} style={{ verticalAlign: 'middle' }}>
                  <span className="block text-sm font-semibold text-slate-900">
                    {weekLabel(item, isZh)}
                  </span>
                  <span className="block text-xs text-slate-500">{span}</span>
                </td>
              );
              if (days.length === 0) {
                return (
                  <tr key={item.id} className={rowBg}>
                    {weekCell}
                    <td className={`${cellBorder} ${cellHover} ${rowBg} px-1 py-1 text-center text-xs text-slate-400`}>{isZh ? '放假' : 'Off'}</td>
                    <td colSpan={modules.length} className={`${cellBorder} ${cellHover} ${rowBg}`} />
                  </tr>
                );
              }
              return days.map((date, dayIndex) => {
                const off = dayIsOff(date, board);
                const makeup = holidayByDate.get(date)?.kind === 'work';
                const today = date === board.today;
                return (
                  <tr key={`${item.id}-${date}`} className={rowBg}>
                    {dayIndex === 0 ? weekCell : null}
                    <td className={`${cellBorder} ${cellHover} ${today ? 'bg-sky-100' : rowBg} px-1 py-1 text-center`}>
                      <span className={`block text-xs font-medium ${off ? 'text-slate-400' : 'text-slate-800'}`}>
                        {isZh ? WEEKDAY_ZH[weekday(date)] : WEEKDAY_EN[weekday(date)]}
                      </span>
                      <span className="block text-sm text-slate-500">{md(date)}</span>
                      {off ? <span className="block text-[11px] text-slate-400">{isZh ? '放假' : 'Off'}</span> : null}
                      {makeup ? <span className="block text-[11px] text-slate-400">{isZh ? '补班' : 'Makeup'}</span> : null}
                    </td>
                    {modules.map((mod) => {
                      const dayEvents = events
                        .filter((event) => event.eventDate === date && event.moduleId === mod.id)
                        .sort((a, b) => a.startTime.localeCompare(b.startTime));
                      const canAdd = canEditModule(mod.id, date);
                      return (
                        <td key={mod.id} className={`group/cell relative ${cellBorder} ${cellHover} overflow-hidden ${off ? 'bg-slate-50/80' : rowBg} p-1`}>
                          <div className="flex min-h-8 min-w-0 flex-col gap-1">
                            {dayEvents.map((event) => {
                              const clash = events.some((other) => timesOverlap(event, other));
                              const parts = [
                                { text: `${event.startTime}–${event.endTime}`, className: 'tabular-nums text-slate-500' },
                                { text: event.title, className: 'text-slate-800' },
                                { text: event.location, className: 'text-slate-500' },
                                { text: staffName(board, event.ownerUserId, isZh), className: 'text-slate-600' },
                              ].filter((part) => part.text.trim());
                              return (
                                <button
                                  key={event.id}
                                  type="button"
                                  className={`relative z-10 block w-full min-w-0 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50 ${clash ? 'bg-amber-50 hover:bg-amber-100/50' : ''} ${event.status === 'cancelled' ? 'opacity-50 line-through' : ''}`}
                                  onClick={() => onOpen(event)}
                                >
                                  {parts.map((part, partIndex) => (
                                    <span key={partIndex} className={part.className}>
                                      {partIndex > 0 ? ' ' : ''}
                                      {part.text}
                                    </span>
                                  ))}
                                </button>
                              );
                            })}
                          </div>
                          {canAdd && dayEvents.length === 0 ? (
                            <button
                              type="button"
                              aria-label={isZh ? '添加事项' : 'Add event'}
                              className="absolute inset-0"
                              onClick={() => onAdd(item.id, date, mod.id)}
                            >
                              <Plus className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-slate-300 opacity-0 group-hover/cell:opacity-100" />
                            </button>
                          ) : null}
                          {canAdd && dayEvents.length > 0 ? (
                            <button
                              type="button"
                              aria-label={isZh ? '添加事项' : 'Add event'}
                              className="pointer-events-none absolute right-0.5 top-0.5 z-20 flex h-5 w-5 items-center justify-center rounded bg-white/90 text-slate-400 opacity-0 shadow-sm hover:text-slate-700 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/cell:pointer-events-auto group-hover/cell:opacity-100"
                              onClick={() => onAdd(item.id, date, mod.id)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThemeDialog({
  board,
  weekId,
  isZh,
  onClose,
  onSaved,
}: {
  board: SchoolCalendarBoard;
  weekId: string;
  isZh: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const week = board.weeks.find((item) => item.id === weekId);
  const [theme, setTheme] = useState(week?.theme ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {week ? weekLabel(week, isZh) : ''}
            {isZh ? ' 周主题' : ' theme'}
          </DialogTitle>
        </DialogHeader>
        <label className="block text-sm text-slate-600">
          {isZh ? '全校共用，各模块都是这个主题' : 'Shared by every module'}
          <Input className="mt-1" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder={isZh ? '例如：开学适应周' : 'e.g. Settling-in week'} />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              saveSchoolCalendarTheme({ weekId, theme })
                .then(onSaved)
                .catch((err: unknown) => setError(errorText(err instanceof Error ? err.message : 'internal', isZh)))
                .finally(() => setBusy(false));
            }}
          >
            {isZh ? '保存' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FocusChild = { id: string; text: string };
type FocusItem = { id: string; text: string; children: FocusChild[]; shared: boolean };

let focusItemSeq = 0;
function nextFocusId(): string {
  focusItemSeq += 1;
  return `focus-${focusItemSeq}`;
}

function parseFocusItems(raw: string): FocusItem[] {
  const items: FocusItem[] = [];
  let current: FocusItem | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const top = trimmed.match(/^(\d+)(?:、|\.)\s*(.*)$/);
    const sub = trimmed.match(/^\((\d+)\)\s*(.*)$/);
    if (top) {
      current = { id: nextFocusId(), text: top[2], children: [], shared: false };
      items.push(current);
    } else if (sub && current) {
      current.children.push({ id: nextFocusId(), text: sub[2] });
    } else {
      current = { id: nextFocusId(), text: trimmed, children: [], shared: false };
      items.push(current);
    }
  }
  return items;
}

function blankFocusItem(): FocusItem {
  return { id: nextFocusId(), text: '', children: [], shared: false };
}

function withShared(items: FocusItem[], shared: boolean): FocusItem[] {
  return items.map((item) => ({ ...item, shared }));
}

function groupSharedFirst(items: FocusItem[]): FocusItem[] {
  return [...items.filter((item) => item.shared), ...items.filter((item) => !item.shared)];
}

function formatFocusItems(items: FocusItem[]): string {
  const lines: string[] = [];
  let index = 0;
  for (const item of items) {
    const text = item.text.trim();
    const children = item.children.map((child) => child.text.trim()).filter(Boolean);
    if (!text && children.length === 0) continue;
    index += 1;
    lines.push(`${index}. ${text}`);
    children.forEach((child, childIndex) => lines.push(`(${childIndex + 1}) ${child}`));
  }
  return lines.join('\n');
}

function FocusDialogRow({ id, isZh, children }: { id: string; isZh: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-1 ${isDragging ? 'relative z-20 bg-white' : ''}`}
    >
      <span
        className="mt-2 inline-flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-slate-400 hover:text-slate-600 active:cursor-grabbing"
        aria-label={isZh ? '拖动调整顺序' : 'Drag to reorder'}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </div>
  );
}

function FocusDialog({
  board,
  weekId,
  moduleId,
  isZh,
  onClose,
  onSaved,
}: {
  board: SchoolCalendarBoard;
  weekId: string;
  moduleId: string;
  isZh: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = board.focuses.find((row) => row.weekId === weekId && row.moduleId === moduleId);
  const mod = board.modules.find((item) => item.id === moduleId);
  const division = Boolean(mod?.segmentId);
  const week = board.weeks.find((item) => item.id === weekId);
  const [items, setItems] = useState<FocusItem[]>(() => {
    const local = withShared(parseFocusItems(existing?.focus ?? ''), false);
    const shared = division ? withShared(parseFocusItems(week?.sharedFocus ?? ''), true) : [];
    const next = groupSharedFirst([...shared, ...local]);
    return next.length > 0 ? next : [blankFocusItem()];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const updateItem = (id: string, text: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, text } : item)));
  };
  const updateChild = (itemId: string, childId: string, text: string) => {
    setItems((current) => current.map((item) => (
      item.id === itemId
        ? { ...item, children: item.children.map((child) => (child.id === childId ? { ...child, text } : child)) }
        : item
    )));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isZh ? `${mod?.nameZh ?? ''} 关键工作` : `${mod?.nameEn ?? ''} key work`}</DialogTitle>
        </DialogHeader>
        <div className={`max-h-[60vh] space-y-3 overflow-y-auto pr-1 ${division ? 'pt-4' : ''}`}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={(event) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              setItems((current) => {
                const oldIndex = current.findIndex((row) => row.id === active.id);
                const newIndex = current.findIndex((row) => row.id === over.id);
                if (oldIndex < 0 || newIndex < 0) return current;
                return groupSharedFirst(arrayMove(current, oldIndex, newIndex));
              });
            }}
          >
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          {items.map((item, index) => {
            const number = items.slice(0, index).filter((row) => row.shared === item.shared).length + 1;
            return (
            <FocusDialogRow key={item.id} id={item.id} isZh={isZh}>
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-sm font-medium text-slate-500">{number}. </span>
                <Input value={item.text} onChange={(e) => updateItem(item.id, e.target.value)} placeholder={isZh ? '项目' : 'Item'} />
                <div className="flex shrink-0 items-center gap-[0.425rem]">
                <button
                  type="button"
                  className="inline-flex h-[1.7rem] w-[1.7rem] shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
                  aria-label={isZh ? '添加子项目' : 'Add sub-item'}
                  onClick={() => setItems((current) => current.map((row) => (
                    row.id === item.id ? { ...row, children: [...row.children, { id: nextFocusId(), text: '' }] } : row
                  )))}
                >
                  <Plus className="h-4 w-4" />
                </button>
                {division ? (
                  <span className="relative inline-flex h-[1.7rem] w-[1.7rem] shrink-0 items-center justify-center">
                    {index === 0 ? (
                      <span className="pointer-events-none absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] leading-none text-slate-400">
                        {isZh ? '全学部' : 'Both'}
                      </span>
                    ) : null}
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      aria-label={isZh ? '全学部' : 'Both divisions'}
                      checked={item.shared}
                      onChange={() => setItems((current) => groupSharedFirst(current.map((row) => (
                        row.id === item.id ? { ...row, shared: !row.shared } : row
                      ))))}
                    />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="inline-flex h-[1.7rem] w-[1.7rem] shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={isZh ? '删除项目' : 'Remove item'}
                  onClick={() => setItems((current) => {
                    const next = current.filter((row) => row.id !== item.id);
                    return next.length > 0 ? next : [blankFocusItem()];
                  })}
                >
                  <X className="h-4 w-4" />
                </button>
                </div>
              </div>
              {item.children.map((child, childIndex) => (
                <div key={child.id} className="flex items-center gap-2 pl-8">
                  <span className="w-8 shrink-0 text-sm text-slate-400">({childIndex + 1})</span>
                  <Input value={child.text} onChange={(e) => updateChild(item.id, child.id, e.target.value)} placeholder={isZh ? '子项目' : 'Sub-item'} />
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={isZh ? '删除子项目' : 'Remove sub-item'}
                    onClick={() => setItems((current) => current.map((row) => (
                      row.id === item.id ? { ...row, children: row.children.filter((entry) => entry.id !== child.id) } : row
                    )))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </FocusDialogRow>
            );
          })}
          </SortableContext>
          </DndContext>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setItems((current) => [...current, blankFocusItem()])}
        >
          <Plus className="h-4 w-4" />
          {isZh ? '添加项目' : 'Add item'}
        </Button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              saveSchoolCalendarFocus({
                weekId,
                moduleId,
                focus: formatFocusItems(items.filter((item) => !item.shared)),
                ...(division ? { sharedFocus: formatFocusItems(items.filter((item) => item.shared)) } : {}),
              })
                .then(onSaved)
                .catch((err: unknown) => setError(errorText(err instanceof Error ? err.message : 'internal', isZh)))
                .finally(() => setBusy(false));
            }}
          >
            {isZh ? '保存' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventDialog({
  board,
  week,
  event,
  initialModuleId,
  initialDate,
  isZh,
  holidayByDate,
  canEditModule,
  onClose,
  onSaved,
}: {
  board: SchoolCalendarBoard;
  week: SchoolCalendarWeek;
  event: SchoolCalendarEvent | null;
  initialModuleId: string;
  initialDate: string;
  isZh: boolean;
  holidayByDate: Map<string, PublicHolidayDay>;
  canEditModule: (moduleId: string, boundaryDate: string) => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editableModules = board.modules.filter((mod) => board.editableModuleIds.includes(mod.id));
  const [moduleId, setModuleId] = useState(event?.moduleId ?? (initialModuleId || editableModules[0]?.id || ''));
  const [date, setDate] = useState(event?.eventDate ?? initialDate);
  const [startTime, setStartTime] = useState(event?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(event?.endTime ?? '09:00');
  const [title, setTitle] = useState(event?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [ownerUserId, setOwnerUserId] = useState(event?.ownerUserId ?? '');
  const [participantIds, setParticipantIds] = useState<string[]>(event?.participantIds ?? []);
  const [status, setStatus] = useState<SchoolCalendarEvent['status']>(event?.status ?? 'planned');
  const [note, setNote] = useState(event?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = event ? !canEditModule(event.moduleId, event.eventDate) : !canEditModule(moduleId, date);
  const workDays = weekDays(week, board, holidayByDate);
  const days = date && !workDays.includes(date) ? [...workDays, date].sort() : workDays;
  const save = () => {
    setBusy(true);
    const payload = {
      moduleId,
      eventDate: date,
      startTime,
      endTime,
      title,
      location,
      ownerUserId: ownerUserId || null,
      participantIds,
      status,
      note,
    };
    const task = event ? updateSchoolCalendarEvent(event.id, payload) : createSchoolCalendarEvent(board.academicYearId, payload);
    task
      .then(onSaved)
      .catch((err: unknown) => setError(errorText(err instanceof Error ? err.message : 'internal', isZh)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event ? (isZh ? '事项' : 'Event') : isZh ? '添加事项' : 'Add event'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block text-slate-600">
            {isZh ? '模块' : 'Module'}
            <MenuSelect className="mt-1 w-full" value={moduleId} disabled={locked} onChange={(e) => setModuleId(e.target.value)}>
              {board.modules.map((mod) => (
                <option key={mod.id} value={mod.id}>{isZh ? mod.nameZh : mod.nameEn}</option>
              ))}
            </MenuSelect>
          </label>
          <label className="block text-slate-600">
            {isZh ? '日期' : 'Date'}
            <MenuSelect className="mt-1 w-full" value={date} disabled={locked} onChange={(e) => setDate(e.target.value)}>
              {days.map((day) => (
                <option key={day} value={day}>
                  {(isZh ? WEEKDAY_ZH : WEEKDAY_EN)[weekday(day)]} {md(day)}
                </option>
              ))}
            </MenuSelect>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-slate-600">
              {isZh ? '开始' : 'Start'}
              <Input className="mt-1" value={startTime} disabled={locked} onChange={(e) => setStartTime(e.target.value)} placeholder="10:30" />
            </label>
            <label className="text-slate-600">
              {isZh ? '结束' : 'End'}
              <Input className="mt-1" value={endTime} disabled={locked} onChange={(e) => setEndTime(e.target.value)} placeholder="11:10" />
            </label>
          </div>
          <label className="block text-slate-600">
            {isZh ? '事项' : 'Event'}
            <Input className="mt-1" value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-slate-600">
            {isZh ? '地点' : 'Place'}
            <Input className="mt-1" value={location} disabled={locked} onChange={(e) => setLocation(e.target.value)} placeholder={isZh ? '例如：阶梯教室' : 'e.g. Lecture hall'} />
          </label>
          <label className="block text-slate-600">
            {isZh ? '责任人' : 'Owner'}
            <MenuSelect className="mt-1 w-full" value={ownerUserId} disabled={locked} onChange={(e) => setOwnerUserId(e.target.value)}>
              <option value="">{isZh ? '未指定' : 'None'}</option>
              {board.staff.map((person) => (
                <option key={person.id} value={person.id}>{isZh ? person.nameZh || person.nameEn : person.nameEn || person.nameZh}</option>
              ))}
            </MenuSelect>
          </label>
          <label className="block text-slate-600">
            {isZh ? '参与人' : 'Participants'}
            <MenuSelect
              className="mt-1 w-full"
              value=""
              disabled={locked}
              onChange={(e) => {
                const id = e.target.value;
                if (id && !participantIds.includes(id)) setParticipantIds((prev) => [...prev, id]);
              }}
            >
              <option value="">{isZh ? '添加参与人' : 'Add'}</option>
              {board.staff.map((person) => (
                <option key={person.id} value={person.id}>{isZh ? person.nameZh || person.nameEn : person.nameEn || person.nameZh}</option>
              ))}
            </MenuSelect>
            <span className="mt-1 block text-xs text-slate-500">
              {participantIds.map((id) => staffName(board, id, isZh)).filter(Boolean).join('、') || (isZh ? '还没有参与人' : 'None')}
            </span>
          </label>
          {event ? (
            <label className="block text-slate-600">
              {isZh ? '状态' : 'Status'}
              <MenuSelect className="mt-1 w-full" value={status} disabled={locked} onChange={(e) => setStatus(e.target.value as SchoolCalendarEvent['status'])}>
                <option value="planned">{isZh ? '计划中' : 'Planned'}</option>
                <option value="done">{isZh ? '已完成' : 'Done'}</option>
                <option value="cancelled">{isZh ? '已取消' : 'Cancelled'}</option>
              </MenuSelect>
            </label>
          ) : null}
          <label className="block text-slate-600">
            {isZh ? '备注' : 'Note'}
            <textarea className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" rows={3} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {locked ? <p className="text-xs text-slate-500">{isZh ? '已经过去的事项只有管理员可以改。' : 'Past events can only be changed by an admin.'}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{isZh ? '关闭' : 'Close'}</Button>
          {!locked ? (
            <Button type="button" disabled={busy || !title.trim()} onClick={save}>{isZh ? '保存' : 'Save'}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  board,
  isZh,
  onClose,
  onSaved,
}: {
  board: SchoolCalendarBoard;
  isZh: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState(board.settings);
  const [modules, setModules] = useState(board.modules);
  useEffect(() => {
    setSettings(board.settings);
    setModules(board.modules);
  }, [board]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saveAll = async () => {
    setBusy(true);
    setError('');
    try {
      await saveSchoolCalendarSettings(board.academicYearId, settings);
      for (const mod of modules) {
        await updateSchoolCalendarModule(mod.id, { nameZh: mod.nameZh, nameEn: mod.nameEn, segmentId: mod.segmentId });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err instanceof Error ? err.message : 'internal', isZh));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isZh ? '校历设置' : 'Calendar settings'}</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-slate-500">
          {isZh
            ? '默认按义务教育常见安排：9 月 1 日开学，春节前约 12 天放寒假，正月十五前后开学，7 月 1 日放暑假。这四个日期都可以改。'
            : 'Defaults follow a typical compulsory-school year and can all be changed.'}
        </p>
        <div className="mt-3 grid gap-2 text-sm">
          <DateField label={isZh ? '开学日' : 'First day'} value={settings.firstSchoolDate} onChange={(value) => setSettings({ ...settings, firstSchoolDate: value })} />
          <DateField label={isZh ? '寒假开始' : 'Winter break'} value={settings.winterBreakStart} onChange={(value) => setSettings({ ...settings, winterBreakStart: value })} />
          <DateField label={isZh ? '春季开学' : 'Spring start'} value={settings.springTermStart} onChange={(value) => setSettings({ ...settings, springTermStart: value })} />
          <DateField label={isZh ? '暑假开始' : 'Summer break'} value={settings.summerBreakStart} onChange={(value) => setSettings({ ...settings, summerBreakStart: value })} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            resetSchoolCalendarSettings(board.academicYearId)
              .then(onSaved)
              .catch((err: unknown) => setError(errorText(err instanceof Error ? err.message : 'internal', isZh)));
          }}
        >
          {isZh ? '按春节重新推算' : 'Reset from Spring Festival'}
        </Button>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-800">{isZh ? '模块' : 'Modules'}</p>
          <div className="mt-2 space-y-2">
            {modules.map((mod) => (
              <div key={mod.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input value={mod.nameZh} onChange={(e) => setModules((prev) => prev.map((item) => item.id === mod.id ? { ...item, nameZh: e.target.value } : item))} />
                <MenuSelect value={mod.segmentId ?? ''} onChange={(e) => setModules((prev) => prev.map((item) => item.id === mod.id ? { ...item, segmentId: e.target.value || null } : item))}>
                  <option value="">{isZh ? '不绑定学段' : 'No stage'}</option>
                  {board.segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.label}</option>
                  ))}
                </MenuSelect>
                <Button type="button" variant="outline" size="sm" onClick={() => deleteSchoolCalendarModule(mod.id).then(onSaved).catch((err: unknown) => setError(errorText(err instanceof Error ? err.message : 'internal', isZh)))}>
                  {isZh ? '删除' : 'Delete'}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={newName} placeholder={isZh ? '新模块名称' : 'New module'} onChange={(e) => setNewName(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              disabled={!newName.trim()}
              onClick={() => createSchoolCalendarModule({ nameZh: newName.trim(), nameEn: newName.trim(), segmentId: null }).then(() => { setNewName(''); onSaved(); }).catch((err: unknown) => setError(errorText(err instanceof Error ? err.message : 'internal', isZh)))}
            >
              {isZh ? '添加' : 'Add'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">{isZh ? '绑定学段后，该学段的年级组长可以填写这个模块。教师发展和行政后勤不绑定学段，只有管理员能改。' : 'Grade heads can edit a module bound to their stage.'}</p>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{isZh ? '关闭' : 'Close'}</Button>
          <Button type="button" disabled={busy} onClick={() => void saveAll()}>{isZh ? '保存边界和模块' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-slate-600">
      <span>{label}</span>
      <Input type="date" className="w-40" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
