/**
 * 公开课：按学年学期的全校登记表。能改的行直接在格子里改。
 */
import { MenuSelect } from './MenuSelect';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ListFilter, Trash2 } from 'lucide-react';
import AppTopBar from './AppTopBar';
import { useAIContext } from '../contexts/AIContext';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import {
  AcademicYearSelect,
  FilterField,
  FilterSelect,
  FilterToolbar,
  TermSelect,
} from './academicPeriodSelectors';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../lib/api';
import { downloadOpenLessonWorkbook, parseOpenLessonWorkbook } from '../lib/openLessonExcel';
import { latestAcademicYear, useTermForYear } from '../lib/academicPeriodDefault';
import { sortAcademicYearsByYear } from '../lib/classStorage';
import type { AcademicYear, Term } from '../types/classManagement';
import type {
  OpenLesson,
  OpenLessonBoard,
  OpenLessonClassOption,
  OpenLessonImportIssue,
  OpenLessonKind,
  OpenLessonStaffOption,
} from '../types/openLesson';

interface OpenLessonsProps {
  onBackToHub?: () => void;
  initialYearId?: string;
  initialTerm?: Term;
  initialLessonKind?: OpenLessonKind;
  initialLessonId?: string;
  isAIOpen?: boolean;
  onToggleAI?: () => void;
}

type SheetRow = {
  key: string;
  id: string | null;
  teacherId: string;
  subject: string;
  classId: string;
  className: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
  canEdit: boolean;
  teacherNameZh: string;
  teacherNameEn: string;
};

const cellInput =
  'w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-800 ' +
  'hover:border-primary/25 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary/30';

const headCell = 'border-b border-r border-white/25 px-2 py-2.5 text-center font-medium last:border-r-0';
const bodyCell = 'border-b border-r border-slate-200 px-2 py-1 align-top last:border-r-0';

type SortKey = 'date' | 'subject';
type SortDir = 'asc' | 'desc';
type LessonSort = { key: SortKey; dir: SortDir };

type SavedFields = Pick<
  SheetRow,
  'teacherId' | 'subject' | 'classId' | 'lessonDate' | 'timeText' | 'gradeUnitTopic' | 'location' | 'remarks'
>;

/** 取时间段的开始时刻。08:20–09:00 按 08:20 排，早的在上面。 */
function timeStartMinutes(text: string): number {
  const match = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return Number.POSITIVE_INFINITY;
  return hour * 60 + minute;
}

function openLessonDayParts(date: string, isZh: boolean): { date: string; weekday: string } {
  if (!date) return { date: isZh ? '未填' : '—', weekday: '' };
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { date, weekday: '' };
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const weekdays = isZh
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${match[2]}/${match[3]}`,
    weekday: weekdays[parsed.getDay()] ?? '',
  };
}

function groupRowsByDate(rows: SheetRow[]): Array<{ date: string; rows: SheetRow[] }> {
  const sorted = [...rows].sort((a, b) => {
    if (a.lessonDate !== b.lessonDate) {
      if (!a.lessonDate) return 1;
      if (!b.lessonDate) return -1;
      return a.lessonDate < b.lessonDate ? -1 : 1;
    }
    const byTime = timeStartMinutes(a.timeText) - timeStartMinutes(b.timeText);
    if (byTime !== 0) return byTime;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const order: string[] = [];
  const map = new Map<string, SheetRow[]>();
  for (const row of sorted) {
    const date = row.lessonDate;
    const list = map.get(date);
    if (list) list.push(row);
    else {
      map.set(date, [row]);
      order.push(date);
    }
  }
  return order.map((date) => ({ date, rows: map.get(date) ?? [] }));
}

function compareLessons(a: SheetRow, b: SheetRow, sort: LessonSort, isZh: boolean): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'subject') {
    const bySubject = a.subject.localeCompare(b.subject, isZh ? 'zh-CN' : 'en');
    if (bySubject !== 0) return bySubject * dir;
  }
  if (a.lessonDate !== b.lessonDate) {
    if (!a.lessonDate) return 1;
    if (!b.lessonDate) return -1;
    const byDate = a.lessonDate < b.lessonDate ? -1 : 1;
    if (sort.key === 'date') return byDate * dir;
    return byDate;
  }
  const byTime = timeStartMinutes(a.timeText) - timeStartMinutes(b.timeText);
  if (byTime !== 0) return byTime;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function rowSnapshot(row: SheetRow): SavedFields {
  return {
    teacherId: row.teacherId,
    subject: row.subject.trim(),
    classId: row.classId,
    lessonDate: row.lessonDate,
    timeText: row.timeText.trim(),
    gradeUnitTopic: row.gradeUnitTopic.trim(),
    location: row.location.trim(),
    remarks: row.remarks.trim(),
  };
}

function sameSnapshot(a: SavedFields, b: SavedFields): boolean {
  return (
    a.teacherId === b.teacherId &&
    a.subject === b.subject &&
    a.classId === b.classId &&
    a.lessonDate === b.lessonDate &&
    a.timeText === b.timeText &&
    a.gradeUnitTopic === b.gradeUnitTopic &&
    a.location === b.location &&
    a.remarks === b.remarks
  );
}

function personLabel(isZh: boolean, zh: string, en: string) {
  return (isZh ? zh || en : en || zh).trim();
}

function lessonToRow(lesson: OpenLesson): SheetRow {
  return {
    key: lesson.id,
    id: lesson.id,
    teacherId: lesson.teacherId,
    subject: lesson.subject,
    classId: lesson.classId,
    className: lesson.className,
    lessonDate: lesson.lessonDate,
    timeText: lesson.timeText,
    gradeUnitTopic: lesson.gradeUnitTopic,
    location: lesson.location,
    remarks: lesson.remarks,
    canEdit: lesson.canEdit,
    teacherNameZh: lesson.teacherNameZh,
    teacherNameEn: lesson.teacherNameEn,
  };
}

function assignableTeachers(board: OpenLessonBoard): OpenLessonStaffOption[] {
  return board.staff;
}

function withCurrentOption<T extends { id: string }>(options: T[], current: T | null): T[] {
  if (!current || options.some((option) => option.id === current.id)) return options;
  return [current, ...options];
}

function rowReady(row: SheetRow): boolean {
  return Boolean(
    row.teacherId &&
      row.subject.trim() &&
      row.classId &&
      row.lessonDate &&
      row.timeText.trim() &&
      row.gradeUnitTopic.trim() &&
      row.location.trim(),
  );
}

const LESSON_KIND_OPTIONS: OpenLessonKind[] = ['group', 'routine', 'school'];

function lessonKindLabel(kind: OpenLessonKind, isZh: boolean): string {
  const copy: Record<OpenLessonKind, [string, string]> = {
    group: ['组内公开课', 'Group open lesson'],
    routine: ['日常课', 'Daily lesson'],
    school: ['校级公开课', 'School open lesson'],
  };
  return isZh ? copy[kind][0] : copy[kind][1];
}

function errorText(code: string, isZh: boolean): string {
  const copy: Record<string, [string, string]> = {
    unauthorized: ['请重新登录', 'Please sign in again'],
    year_required: ['请选择学年', 'Choose an academic year'],
    year_not_found: ['找不到这个学年', 'Academic year not found'],
    term_invalid: ['请选择学期', 'Choose a term'],
    kind_invalid: ['请选择公开课类型', 'Choose a lesson type'],
    subject_required: ['请填写学科', 'Enter a subject'],
    teacher_required: ['请选择教师', 'Choose a teacher'],
    class_required: ['请选择班级', 'Choose a class'],
    class_not_found: ['这个班级不在本学年的班级管理里', 'This class is not in class management for this year'],
    date_required: ['请填写日期', 'Enter a date'],
    time_required: ['请填写时间', 'Enter a time'],
    topic_required: ['请填写学期-单元-课题', 'Enter the term, unit and topic'],
    location_required: ['请填写上课地点', 'Enter a location'],
    field_too_long: ['有一项内容太长', 'One of the fields is too long'],
    assign_forbidden: ['不能把这节课登记给这位教师', 'You cannot assign this lesson to that teacher'],
    school_add_forbidden: ['只有学科组长和管理员可以添加校级公开课', 'Only subject heads and admins can add a school open lesson'],
    forbidden: ['没有权限修改这条公开课', 'You cannot change this open lesson'],
    import_forbidden: ['本学期还有你不能修改的公开课，所以不能整表导入', 'This term includes lessons you cannot change, so the sheet cannot replace them'],
    no_rows: ['表格里没有可导入的公开课', 'The sheet has no open lessons to import'],
    empty_sheet: ['这个表格是空的', 'This workbook is empty'],
    file_unreadable: ['读不了这个文件，请使用导出的 xlsx 表格', 'This file could not be read. Use the exported xlsx workbook'],
    header_missing: ['表头需要包含：类型、学科、教师、班级、日期、时间、学期-单元-课题、上课地点、备注', 'The header must include type, subject, teacher, class, date, time, topic, location and remarks'],
    teacher_not_found: ['找不到这位教师', 'Teacher not found'],
    teacher_ambiguous: ['这个姓名对应了多位教师', 'This teacher name matches more than one person'],
    class_ambiguous: ['这个班级名称对应了多个班', 'This class name matches more than one class'],
    not_found: ['这条公开课已经不在了', 'This open lesson no longer exists'],
    internal: ['保存失败，请稍后再试', 'Could not save. Try again.'],
  };
  const pair = copy[code];
  if (pair) return isZh ? pair[0] : pair[1];
  return code;
}

function formatImportIssue(issue: OpenLessonImportIssue, isZh: boolean): string {
  const where = issue.row > 0 ? (isZh ? `第${issue.row}行：` : `Row ${issue.row}: `) : '';
  const detail = issue.detail?.trim();
  if (issue.code === 'header_missing' && detail) {
    return isZh ? `表头缺少：${detail}` : `Missing columns: ${detail}`;
  }
  const text = errorText(issue.code, isZh);
  return detail ? `${where}${text}（${detail}）` : `${where}${text}`;
}

function blankDraft(board: OpenLessonBoard): SheetRow {
  const teachers = assignableTeachers(board);
  let teacherId = '';
  if (teachers.some((teacher) => teacher.id === board.viewerId)) teacherId = board.viewerId;
  else if (teachers.length === 1) teacherId = teachers[0].id;
  const teacher = teachers.find((item) => item.id === teacherId);
  return {
    key: `draft-${crypto.randomUUID()}`,
    id: null,
    teacherId,
    subject: '',
    classId: '',
    className: '',
    lessonDate: '',
    timeText: '',
    gradeUnitTopic: '',
    location: '',
    remarks: '',
    canEdit: true,
    teacherNameZh: teacher?.nameZh ?? '',
    teacherNameEn: teacher?.nameEn ?? '',
  };
}

export default function OpenLessons({
  onBackToHub,
  initialYearId,
  initialTerm,
  initialLessonKind,
  initialLessonId,
  isAIOpen,
  onToggleAI,
}: OpenLessonsProps) {
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState('');
  const { term, setTerm, ready: termReady } = useTermForYear(yearId, initialYearId, initialTerm);
  const [lessonKind, setLessonKind] = useState<OpenLessonKind>(initialLessonKind ?? 'group');
  const [board, setBoard] = useState<OpenLessonBoard | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [sort, setSort] = useState<LessonSort>({ key: 'date', dir: 'asc' });
  const [subjectFilter, setSubjectFilter] = useState<string[] | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileTable, setMobileTable] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [excelBusy, setExcelBusy] = useState<'export' | 'import' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<SheetRow[]>([]);
  const boardRef = useRef<OpenLessonBoard | null>(null);
  const savedRows = useRef<Map<string, SavedFields>>(new Map());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const saveSeq = useRef<Map<string, number>>(new Map());
  const rowNodes = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const filterRootRef = useRef<HTMLDivElement>(null);
  rowsRef.current = rows;
  boardRef.current = board;

  useEffect(() => {
    let cancelled = false;
    api.getAcademicYears()
      .then((list) => {
        if (cancelled) return;
        const sorted = sortAcademicYearsByYear(list);
        setYears(sorted);
        const pinned = initialYearId && sorted.some((year) => year.id === initialYearId) ? initialYearId : '';
        const nextYearId = pinned || latestAcademicYear(sorted)?.id || '';
        setYearId(nextYearId);
        if (!nextYearId) setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPageError(error instanceof Error ? error.message : 'internal');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!yearId || !termReady) return;
    let cancelled = false;
    for (const [key, timer] of saveTimers.current) {
      clearTimeout(timer);
      saveTimers.current.delete(key);
      void persistRow(key);
    }
    setLoading(true);
    setPageError('');
    setSubjectFilter(null);
    setFilterOpen(false);
    api
      .getOpenLessonBoard(yearId, term, lessonKind)
      .then((next) => {
        if (cancelled) return;
        const nextRows = next.lessons.map(lessonToRow);
        const saved = new Map<string, SavedFields>();
        for (const row of nextRows) saved.set(row.key, rowSnapshot(row));
        savedRows.current = saved;
        setBoard(next);
        setRows(nextRows);
        setRowError({});
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPageError(error instanceof Error ? error.message : 'internal');
        setBoard(null);
        setRows([]);
        savedRows.current = new Map();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [yearId, term, termReady, lessonKind, reloadToken]);

  useEffect(() => {
    if (!initialLessonId || loading) return;
    const lessonId = initialLessonId;
    const frame = window.requestAnimationFrame(() => {
      rowNodes.current.get(lessonId)?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialLessonId, loading, rows]);

  const { setContextFromApp } = useAIContext();
  useEffect(() => {
    if (!onToggleAI) return;
    const yearLabel = years.find((y) => y.id === yearId)?.name ?? '';
    const summary = isZh
      ? `${yearLabel} ${term} · ${lessonKind === 'school' ? '校级公开课' : '组内公开课'} · 共 ${rows.length} 节`
      : `${yearLabel} ${term} · ${lessonKind === 'school' ? 'School-wide' : 'Group'} · ${rows.length} lessons`;
    setContextFromApp('open-lessons', { view: 'open-lessons', summary });
  }, [onToggleAI, setContextFromApp, years, yearId, term, lessonKind, rows.length, isZh]);

  const canAdd = useMemo(() => {
    if (!board || board.staff.length === 0) return false;
    if (lessonKind === 'school' && !board.isAdmin && board.ledGroupIds.length === 0) return false;
    return true;
  }, [board, lessonKind]);

  const filterSubjects = useMemo(() => {
    return [...new Set(rows.map((row) => row.subject.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, isZh ? 'zh-CN' : 'en'),
    );
  }, [rows, isZh]);

  const visibleRows = useMemo(() => {
    const filtered = subjectFilter ? rows.filter((row) => subjectFilter.includes(row.subject.trim())) : rows;
    return [...filtered].sort((a, b) => compareLessons(a, b, sort, isZh));
  }, [rows, subjectFilter, sort, isZh]);

  const rememberRow = (row: SheetRow) => {
    savedRows.current.set(row.key, rowSnapshot(row));
  };

  const writeRows = (next: SheetRow[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const clearRowError = (key: string) => {
    setRowError((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const persistRow = async (key: string) => {
    const row = rowsRef.current.find((item) => item.key === key);
    const currentBoard = boardRef.current;
    if (!row?.id || !row.canEdit || !currentBoard || !rowReady(row)) return;
    const period = { yearId: currentBoard.academicYearId, term: currentBoard.term };
    const snapshot = rowSnapshot(row);
    const saved = savedRows.current.get(key);
    if (saved && sameSnapshot(saved, snapshot)) return;
    const seq = (saveSeq.current.get(key) ?? 0) + 1;
    saveSeq.current.set(key, seq);
    clearRowError(key);
    try {
      const lesson = await api.updateOpenLesson(row.id, {
        academicYearId: currentBoard.academicYearId,
        term: currentBoard.term,
        lessonKind: currentBoard.lessonKind,
        ...snapshot,
      });
      if (saveSeq.current.get(key) !== seq) return;
      const stillViewing =
        boardRef.current?.academicYearId === period.yearId && boardRef.current?.term === period.term;
      if (!stillViewing) return;
      const latest = rowsRef.current.find((item) => item.key === key);
      if (!latest || !sameSnapshot(rowSnapshot(latest), snapshot)) return;
      const stored = lessonToRow(lesson);
      rememberRow(stored);
      writeRows(rowsRef.current.map((item) => (item.key === key ? stored : item)));
    } catch (error: unknown) {
      if (saveSeq.current.get(key) !== seq) return;
      const code = error instanceof Error ? error.message : 'internal';
      setRowError((prev) => ({ ...prev, [key]: code }));
    }
  };

  const queueSave = (key: string, immediate: boolean) => {
    const timer = saveTimers.current.get(key);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(key);
    if (immediate) {
      void persistRow(key);
      return;
    }
    saveTimers.current.set(
      key,
      setTimeout(() => {
        saveTimers.current.delete(key);
        void persistRow(key);
      }, 450),
    );
  };

  const updateRow = (key: string, patch: Partial<SheetRow>, immediate: boolean) => {
    const currentBoard = boardRef.current;
    const next = rowsRef.current.map((row) => {
      if (row.key !== key || !row.canEdit) return row;
      const updated = { ...row, ...patch };
      if (patch.classId !== undefined && currentBoard) {
        updated.className = currentBoard.classes.find((item) => item.id === updated.classId)?.name ?? '';
      }
      return updated;
    });
    writeRows(next);
    clearRowError(key);
    queueSave(key, immediate);
  };

  const commitRow = (key: string) => {
    const timer = saveTimers.current.get(key);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(key);
    const row = rowsRef.current.find((item) => item.key === key);
    const saved = savedRows.current.get(key);
    if (!row || !saved) return;
    let patched: SheetRow = {
      ...row,
      timeText: row.timeText.trim() || saved.timeText,
      gradeUnitTopic: row.gradeUnitTopic.trim() || saved.gradeUnitTopic,
      location: row.location.trim() || saved.location,
      remarks: row.remarks.trim(),
    };
    if (!patched.subject.trim() || !patched.teacherId) {
      patched = { ...patched, subject: patched.subject.trim() || saved.subject, teacherId: patched.teacherId || saved.teacherId };
    }
    if (!patched.classId) {
      const known = boardRef.current?.classes.find((item) => item.id === saved.classId);
      patched = { ...patched, classId: saved.classId, className: known?.name || row.className };
    }
    if (!sameSnapshot(rowSnapshot(row), rowSnapshot(patched))) writeRows(rowsRef.current.map((item) => (item.key === key ? patched : item)));
    if (!rowReady(patched)) return;
    void persistRow(key);
  };

  const removeRow = async (row: SheetRow) => {
    if (!row.canEdit || !row.id || savingKey) return;
    const ok = window.confirm(isZh ? '删除这节公开课？' : 'Delete this open lesson?');
    if (!ok) return;
    const timer = saveTimers.current.get(row.key);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(row.key);
    saveSeq.current.set(row.key, (saveSeq.current.get(row.key) ?? 0) + 1);
    setSavingKey(row.key);
    try {
      await api.deleteOpenLesson(row.id);
      savedRows.current.delete(row.key);
      writeRows(rowsRef.current.filter((item) => item.key !== row.key));
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : 'internal';
      setRowError((prev) => ({ ...prev, [row.key]: code }));
    } finally {
      setSavingKey(null);
    }
  };

  const showImportProblems = (issues: OpenLessonImportIssue[]) => {
    const lines = issues.slice(0, 12).map((issue) => formatImportIssue(issue, isZh));
    if (issues.length > 12) lines.push(isZh ? `…还有 ${issues.length - 12} 条` : `…${issues.length - 12} more`);
    const text = lines.join('\n');
    setPageError(text);
    window.alert(text);
  };

  const exportExcel = async () => {
    if (!yearId || !termReady || excelBusy) return;
    setExcelBusy('export');
    setPageError('');
    try {
      const pending = [...saveTimers.current.keys()];
      for (const key of pending) {
        const timer = saveTimers.current.get(key);
        if (timer) clearTimeout(timer);
        saveTimers.current.delete(key);
      }
      await Promise.all(pending.map((key) => persistRow(key)));
      const lessons = await api.listOpenLessonsForTerm(yearId, term);
      const yearLabel = years.find((year) => year.id === yearId)?.name ?? '';
      await downloadOpenLessonWorkbook({ lessons, academicYearLabel: yearLabel, term, isZh });
    } catch (error: unknown) {
      setPageError(error instanceof Error ? error.message : 'internal');
    } finally {
      setExcelBusy(null);
    }
  };

  const importExcel = async (file: File) => {
    if (!yearId || !termReady || excelBusy) return;
    setExcelBusy('import');
    setPageError('');
    try {
      const parsed = await parseOpenLessonWorkbook(await file.arrayBuffer());
      if (parsed.issues.length > 0) {
        showImportProblems(parsed.issues);
        return;
      }
      if (parsed.rows.length === 0) {
        setPageError('no_rows');
        window.alert(errorText('no_rows', isZh));
        return;
      }
      const yearLabel = years.find((year) => year.id === yearId)?.name ?? '';
      const termText = term === 'Semester 1' ? (isZh ? '上学期' : 'Semester 1') : isZh ? '下学期' : 'Semester 2';
      const ok = window.confirm(
        isZh
          ? `将用这个表格替换 ${yearLabel} ${termText} 的全部公开课，包含组内公开课、日常课和校级公开课。表格里没有的课会被删除。`
          : `This replaces every open lesson in ${yearLabel} ${termText}, including group, daily and school lessons. Lessons missing from the file will be deleted.`,
      );
      if (!ok) return;
      const result = await api.importOpenLessons(yearId, term, parsed.rows);
      setReloadToken((token) => token + 1);
      window.alert(isZh ? `已导入 ${result.count} 条公开课。` : `Imported ${result.count} open lessons.`);
    } catch (error: unknown) {
      const issues = error && typeof error === 'object' && 'issues' in error ? (error as { issues?: OpenLessonImportIssue[] }).issues : undefined;
      if (issues && issues.length > 0) showImportProblems(issues);
      else setPageError(error instanceof Error ? error.message : 'internal');
    } finally {
      setExcelBusy(null);
    }
  };

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  useEffect(() => {
    if (!filterOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (filterRootRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [filterOpen]);

  const placeCreated = (lesson: OpenLesson) => {
    const row = lessonToRow(lesson);
    rememberRow(row);
    writeRows([...rowsRef.current, row]);
    setSubjectFilter((prev) => (prev && row.subject.trim() && !prev.includes(row.subject.trim()) ? [...prev, row.subject.trim()] : prev));
    requestAnimationFrame(() => {
      rowNodes.current.get(row.key)?.scrollIntoView({ block: 'nearest' });
    });
  };

  return (
    <div className={`${onToggleAI ? 'h-full min-h-0 overflow-auto max-md:h-auto max-md:min-h-dvh' : 'min-h-dvh overflow-x-auto'} w-full max-w-[100%] bg-slate-50 pt-[calc(var(--app-topbar-height)+0.5rem)]`}>
      <AppTopBar title={isZh ? '公开课' : 'Open Lessons'} showBack={!!onBackToHub} onBack={onBackToHub} onToggleAI={onToggleAI} isAIOpen={isAIOpen} />
      <div className="mx-auto w-[90%] max-w-[1296px] px-3 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <FilterToolbar>
            <FilterField label={isZh ? '学年' : 'Year'} htmlFor="open-lesson-year">
              <AcademicYearSelect
                id="open-lesson-year"
                years={years}
                value={yearId}
                isZh={isZh}
                disabled={years.length === 0}
                onChange={setYearId}
              />
            </FilterField>
            <FilterField label={isZh ? '学期' : 'Term'} htmlFor="open-lesson-term">
              <TermSelect id="open-lesson-term" isZh={isZh} value={term} onChange={setTerm} />
            </FilterField>
            <FilterField label={isZh ? '类型' : 'Type'} htmlFor="open-lesson-kind">
              <FilterSelect
                id="open-lesson-kind"
                width="md"
                className="min-w-0 sm:min-w-[9.5rem]"
                value={lessonKind}
                onChange={(e) => setLessonKind(e.target.value as OpenLessonKind)}
              >
                {LESSON_KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {lessonKindLabel(kind, isZh)}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>
          </FilterToolbar>
          <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 md:flex">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!yearId || !termReady || excelBusy !== null}
              onClick={() => void exportExcel()}
            >
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!yearId || !termReady || excelBusy !== null}
              onClick={() => excelInputRef.current?.click()}
            >
              {excelBusy === 'import' ? (isZh ? '导入中…' : 'Importing…') : isZh ? '导入 Excel' : 'Import Excel'}
            </Button>
            {canAdd ? (
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                {isZh ? '添加公开课' : 'Add open lesson'}
              </Button>
            ) : null}
          </div>
        </div>

        {pageError ? <p className="mt-3 whitespace-pre-line text-sm text-red-600">{errorText(pageError, isZh)}</p> : null}

        <div className="mt-3 md:hidden">
          <div className="flex flex-nowrap items-center justify-between gap-2">
            <button
              type="button"
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
              onClick={() => setMobileTable((open) => !open)}
            >
              {mobileTable ? (isZh ? '卡片' : 'Cards') : isZh ? '表格' : 'Sheet'}
            </button>
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                disabled={!yearId || !termReady || excelBusy !== null}
                onClick={() => void exportExcel()}
              >
                {excelBusy === 'export' ? (isZh ? '导出中…' : 'Exporting…') : isZh ? '导出' : 'Export'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                disabled={!yearId || !termReady || excelBusy !== null}
                onClick={() => excelInputRef.current?.click()}
              >
                {excelBusy === 'import' ? (isZh ? '导入中…' : 'Importing…') : isZh ? '导入' : 'Import'}
              </Button>
              {canAdd ? (
                <Button type="button" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={() => setAddOpen(true)}>
                  {isZh ? '添加公开课' : 'Add'}
                </Button>
              ) : null}
            </div>
          </div>
          {!mobileTable ? (
            <div className="mt-3 space-y-2">
              {loading ? (
                <p className="text-sm text-slate-500">{isZh ? '正在读取本学期公开课…' : 'Loading open lessons…'}</p>
              ) : visibleRows.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                  {rows.length === 0
                    ? isZh
                      ? `本学期还没有${lessonKindLabel(lessonKind, true)}。`
                      : `No ${lessonKindLabel(lessonKind, false).toLowerCase()}s this term.`
                    : isZh
                      ? '没有符合筛选的公开课。'
                      : 'No open lessons match this filter.'}
                </p>
              ) : (
                groupRowsByDate(visibleRows).map((day) => {
                  const parts = openLessonDayParts(day.date, isZh);
                  return (
                    <section key={day.date || 'undated'} className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="flex w-14 shrink-0 flex-col items-center justify-center border-r border-slate-100 bg-slate-50 px-1 py-2 text-center">
                        <span className="text-sm font-semibold leading-tight text-slate-800">{parts.date}</span>
                        {parts.weekday ? (
                          <span className="text-[11px] leading-tight text-slate-500">{parts.weekday}</span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 divide-y divide-slate-100">
                        {day.rows.map((row) => (
                          <article key={row.key} className="px-3 py-2.5">
                            <p className="text-sm font-medium leading-snug text-slate-800">
                              {[row.timeText, row.subject, personLabel(isZh, row.teacherNameZh, row.teacherNameEn)]
                                .filter((part) => part.trim())
                                .join(' ')}
                              {row.className || row.location
                                ? ` ${row.className}${row.location ? `(${row.location})` : ''}`
                                : ''}
                            </p>
                            {row.gradeUnitTopic ? (
                              <p className="mt-1 text-xs leading-snug text-slate-500">{row.gradeUnitTopic}</p>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          ) : null}
        </div>

        <div className={`${mobileTable ? '' : 'hidden'} -mr-11 mt-3 max-h-[calc(100vh-11rem)] overflow-auto pr-11 max-md:mr-0 max-md:max-h-none max-md:overflow-visible max-md:pr-0 md:block`}>
          <div className="overflow-visible rounded-xl border border-primary/25 bg-white shadow-sm">
          <table className="w-full min-w-[71rem] table-fixed border-collapse text-left">
            <colgroup>
              <col style={{ width: '9rem' }} />
              <col style={{ width: '8rem' }} />
              <col style={{ width: '6.5rem' }} />
              <col style={{ width: '8.5rem' }} />
              <col style={{ width: '9rem' }} />
              <col />
              <col style={{ width: '8rem' }} />
              <col style={{ width: '11rem' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
              <tr>
                <th className={`${headCell} relative`} aria-sort={sort.key === 'subject' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <div ref={filterRootRef}>
                    <div className="flex justify-center">
                      <div className="relative">
                        <SortHeader
                          zh="学科"
                          en="Subject"
                          active={sort.key === 'subject'}
                          dir={sort.dir}
                          label={sortLabel(isZh, '学科', sort.key === 'subject', sort.dir)}
                          onClick={() => toggleSort('subject')}
                        />
                        <button
                          type="button"
                          aria-expanded={filterOpen}
                          aria-label={isZh ? '筛选学科' : 'Filter subjects'}
                          className={`absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 rounded-md border p-1 ${
                            subjectFilter
                              ? 'border-amber-200 bg-amber-300 text-amber-950'
                              : 'border-white/70 bg-white/25 text-white hover:bg-white/40'
                          }`}
                          onClick={() => setFilterOpen((open) => !open)}
                        >
                          <ListFilter className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                        </button>
                      </div>
                    </div>
                    {filterOpen ? (
                      <SubjectFilterMenu
                        subjects={filterSubjects}
                        selected={subjectFilter}
                        isZh={isZh}
                        onChange={setSubjectFilter}
                      />
                    ) : null}
                  </div>
                </th>
                <th className={headCell}><Header zh="教师" en="Teacher" /></th>
                <th className={headCell}><Header zh="班级" en="Class" /></th>
                <th className={headCell} aria-sort={sort.key === 'date' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <SortHeader
                    zh="日期"
                    en="Date"
                    active={sort.key === 'date'}
                    dir={sort.dir}
                    label={sortLabel(isZh, '日期', sort.key === 'date', sort.dir)}
                    onClick={() => toggleSort('date')}
                  />
                </th>
                <th className={headCell}><Header zh="时间" en="Time" /></th>
                <th className={headCell}><Header zh="学期-单元-课题" en="Term-Unit-Topic" /></th>
                <th className={headCell}><Header zh="上课地点" en="Location" /></th>
                <th className={headCell}><Header zh="备注" en="Remarks" /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                    {isZh ? '正在读取本学期公开课…' : 'Loading open lessons…'}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                    {isZh
                      ? `本学期还没有${lessonKindLabel(lessonKind, true)}。`
                      : `No ${lessonKindLabel(lessonKind, false).toLowerCase()}s this term.`}
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                    {isZh ? '没有符合筛选的公开课。' : 'No open lessons match this filter.'}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <LessonRow
                    key={row.key}
                    row={row}
                    board={board}
                    isZh={isZh}
                    saving={savingKey === row.key}
                    error={rowError[row.key] ? errorText(rowError[row.key], isZh) : ''}
                    onChange={(patch, immediate) => updateRow(row.key, patch, immediate)}
                    onCommit={() => commitRow(row.key)}
                    onRemove={() => void removeRow(row)}
                    rowRef={(node) => {
                      if (node) rowNodes.current.set(row.key, node);
                      else rowNodes.current.delete(row.key);
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
      {board ? (
        <AddLessonDialog
          open={addOpen}
          board={board}
          isZh={isZh}
          onOpenChange={setAddOpen}
          onCreated={placeCreated}
        />
      ) : null}
    </div>
  );
}

function Header({ zh, en }: { zh: string; en: string }) {
  return (
    <span className="block leading-tight text-center">
      <span className="block text-sm">{zh}</span>
      <span className="block text-[11px] font-normal text-primary-foreground/75">{en}</span>
    </span>
  );
}

function sortLabel(isZh: boolean, column: string, active: boolean, dir: SortDir): string {
  if (!active) return isZh ? `按${column}排序` : `Sort by ${column}`;
  if (dir === 'asc') return isZh ? `${column}正序，再点一次改为反序` : `${column} ascending, click again to reverse`;
  return isZh ? `${column}反序，再点一次改为正序` : `${column} descending, click again to reverse`;
}

function SortHeader({
  zh,
  en,
  active,
  dir,
  label,
  onClick,
}: {
  zh: string;
  en: string;
  active: boolean;
  dir: SortDir;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" title={label} aria-label={label} className="inline-flex items-center gap-0.5 rounded-sm" onClick={onClick}>
      <Header zh={zh} en={en} />
      {active ? (
        dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : null}
    </button>
  );
}

function SubjectFilterMenu({
  subjects,
  selected,
  isZh,
  onChange,
}: {
  subjects: string[];
  selected: string[] | null;
  isZh: boolean;
  onChange: (next: string[] | null) => void;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  const selectedIds = selected ?? subjects;
  const allChecked = subjects.length > 0 && selectedIds.length === subjects.length;
  const someChecked = selectedIds.length > 0 && !allChecked;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked;
  }, [someChecked]);

  return (
    <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 text-left font-normal text-slate-800 shadow-sm">
      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
        <input
          ref={allRef}
          type="checkbox"
          checked={allChecked}
          onChange={() => onChange(allChecked ? [] : null)}
        />
        {isZh ? '全选' : 'Select all'}
      </label>
      <div className="max-h-56 overflow-auto">
        {subjects.map((subject) => {
          const checked = selectedIds.includes(subject);
          return (
            <label key={subject} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked ? selectedIds.filter((item) => item !== subject) : [...selectedIds, subject];
                  onChange(next.length === subjects.length ? null : next);
                }}
              />
              <span className="truncate">{subject}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function LessonRow({
  row,
  board,
  isZh,
  saving,
  error,
  onChange,
  onCommit,
  onRemove,
  rowRef,
}: {
  row: SheetRow;
  board: OpenLessonBoard | null;
  isZh: boolean;
  saving: boolean;
  error: string;
  onChange: (patch: Partial<SheetRow>, immediate: boolean) => void;
  onCommit: () => void;
  onRemove: () => void;
  rowRef: (node: HTMLTableRowElement | null) => void;
}) {
  const readOnly = !row.canEdit || !board;
  const teacherOptions = board
    ? withCurrentOption(
        assignableTeachers(board),
        row.teacherId
          ? {
              id: row.teacherId,
              nameZh: row.teacherNameZh || row.teacherId,
              nameEn: row.teacherNameEn || row.teacherNameZh || row.teacherId,
            }
          : null,
      )
    : [];
  const classOptions: OpenLessonClassOption[] = board
    ? withCurrentOption(
        board.classes,
        row.classId ? { id: row.classId, grade: 0, name: row.className || row.classId } : null,
      )
    : [];

  return (
    <>
      <tr ref={rowRef} className="group">
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={row.subject} />
          ) : (
            <input
              className={cellInput}
              value={row.subject}
              placeholder={isZh ? '例如：数学' : 'e.g. Maths'}
              onChange={(e) => onChange({ subject: e.target.value }, false)}
              onBlur={onCommit}
            />
          )}
        </td>
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={personLabel(isZh, row.teacherNameZh, row.teacherNameEn)} />
          ) : (
            <MenuSelect
              searchable
              className={cellInput}
              value={row.teacherId}
              onChange={(e) => onChange({ teacherId: e.target.value }, true)}
              onBlur={onCommit}
            >
              <option value="">{isZh ? '选择教师' : 'Teacher'}</option>
              {teacherOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {personLabel(isZh, teacher.nameZh, teacher.nameEn)}
                </option>
              ))}
            </MenuSelect>
          )}
        </td>
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={row.className} />
          ) : (
            <MenuSelect
              className={cellInput}
              value={row.classId}
              onChange={(e) => onChange({ classId: e.target.value }, true)}
              onBlur={onCommit}
            >
              <option value="">{isZh ? '选择班级' : 'Class'}</option>
              {classOptions.filter((item) => item.id).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </MenuSelect>
          )}
        </td>
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={row.lessonDate} />
          ) : (
            <input
              type="date"
              className={cellInput}
              value={row.lessonDate}
              onChange={(e) => onChange({ lessonDate: e.target.value }, true)}
            />
          )}
        </td>
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={row.timeText} />
          ) : (
            <input
              className={cellInput}
              value={row.timeText}
              placeholder="10:00–10:40"
              onChange={(e) => onChange({ timeText: e.target.value }, false)}
              onBlur={onCommit}
            />
          )}
        </td>
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={row.gradeUnitTopic} />
          ) : (
            <input
              className={cellInput}
              value={row.gradeUnitTopic}
              placeholder={isZh ? 'G5 · 第二单元 · 分数' : 'G5 · Unit 2 · Fractions'}
              onChange={(e) => onChange({ gradeUnitTopic: e.target.value }, false)}
              onBlur={onCommit}
            />
          )}
        </td>
        <td className={bodyCell}>
          {readOnly ? (
            <ReadCell value={row.location} />
          ) : (
            <input
              className={cellInput}
              value={row.location}
              placeholder={isZh ? '教室或场馆' : 'Room'}
              onChange={(e) => onChange({ location: e.target.value }, false)}
              onBlur={onCommit}
            />
          )}
        </td>
        <td className={`${bodyCell} relative overflow-visible`}>
          {readOnly ? (
            <ReadCell value={row.remarks} />
          ) : (
            <input
              className={cellInput}
              value={row.remarks}
              onChange={(e) => onChange({ remarks: e.target.value }, false)}
              onBlur={onCommit}
            />
          )}
          {row.canEdit && row.id ? (
            <div className="absolute left-full top-0 z-20 flex h-full w-11 items-center pl-2">
              <button
                type="button"
                title={isZh ? '删除这节公开课' : 'Delete this open lesson'}
                className="flex h-8 w-8 items-center justify-center rounded-md text-red-600 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100 disabled:opacity-40"
                disabled={saving}
                onClick={onRemove}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={8} className="border-b border-slate-100 px-3 py-1 text-xs text-red-600">
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ReadCell({ value }: { value: string }) {
  return <span className="block whitespace-pre-wrap px-1.5 py-1 text-sm text-slate-800">{value || '—'}</span>;
}

const formControl =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function AddLessonDialog({
  open,
  board,
  isZh,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  board: OpenLessonBoard;
  isZh: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (lesson: OpenLesson) => void;
}) {
  const [form, setForm] = useState<SheetRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(blankDraft(board));
    setError('');
    setSaving(false);
  }, [open, board]);

  const teachers = assignableTeachers(board);

  const patch = (next: Partial<SheetRow>) => {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
  };

  const submit = async () => {
    if (!form || !rowReady(form) || saving) return;
    setSaving(true);
    setError('');
    try {
      const lesson = await api.createOpenLesson({
        academicYearId: board.academicYearId,
        term: board.term,
        lessonKind: board.lessonKind,
        subject: form.subject.trim(),
        teacherId: form.teacherId,
        classId: form.classId,
        lessonDate: form.lessonDate,
        timeText: form.timeText.trim(),
        gradeUnitTopic: form.gradeUnitTopic.trim(),
        location: form.location.trim(),
        remarks: form.remarks.trim(),
      });
      onCreated(lesson);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(errorText(err instanceof Error ? err.message : 'internal', isZh));
      setSaving(false);
    }
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isZh ? '添加公开课' : 'Add open lesson'}</DialogTitle>
          <DialogDescription>
            {isZh
              ? `登记后出现在本学期的${lessonKindLabel(board.lessonKind, true)}里。`
              : `It appears in this term’s ${lessonKindLabel(board.lessonKind, false).toLowerCase()} list.`}
          </DialogDescription>
        </DialogHeader>
        {form ? (
          <div className="grid gap-3">
            <Field label={isZh ? '学科' : 'Subject'}>
              <Input value={form.subject} placeholder={isZh ? '例如：数学' : 'e.g. Maths'} onChange={(e) => patch({ subject: e.target.value })} />
            </Field>
            <Field label={isZh ? '教师' : 'Teacher'}>
              <MenuSelect
                searchable
                className={formControl}
                value={form.teacherId}
                onChange={(e) => patch({ teacherId: e.target.value })}
              >
                <option value="">{isZh ? '选择教师' : 'Teacher'}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {personLabel(isZh, teacher.nameZh, teacher.nameEn)}
                  </option>
                ))}
              </MenuSelect>
            </Field>
            <Field label={isZh ? '班级' : 'Class'}>
              <MenuSelect className={formControl} value={form.classId} onChange={(e) => patch({ classId: e.target.value })}>
                <option value="">{isZh ? '选择班级' : 'Class'}</option>
                {board.classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </MenuSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isZh ? '日期' : 'Date'}>
                <Input type="date" value={form.lessonDate} onChange={(e) => patch({ lessonDate: e.target.value })} />
              </Field>
              <Field label={isZh ? '时间' : 'Time'}>
                <Input
                  value={form.timeText}
                  placeholder="10:00–10:40"
                  onChange={(e) => patch({ timeText: e.target.value })}
                />
              </Field>
            </div>
            <Field label={isZh ? '学期-单元-课题' : 'Term-Unit-Topic'}>
              <Input
                value={form.gradeUnitTopic}
                placeholder={isZh ? 'G5 · 第二单元 · 分数' : 'G5 · Unit 2 · Fractions'}
                onChange={(e) => patch({ gradeUnitTopic: e.target.value })}
              />
            </Field>
            <Field label={isZh ? '上课地点' : 'Location'}>
              <Input
                value={form.location}
                placeholder={isZh ? '教室或场馆' : 'Room'}
                onChange={(e) => patch({ location: e.target.value })}
              />
            </Field>
            <Field label={isZh ? '备注' : 'Remarks'}>
              <Input value={form.remarks} onChange={(e) => patch({ remarks: e.target.value })} />
            </Field>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button type="button" disabled={!form || !rowReady(form) || saving} onClick={() => void submit()}>
            {saving ? (isZh ? '登记中' : 'Adding') : isZh ? '登记' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
