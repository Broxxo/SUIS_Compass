import crypto from 'crypto';
import pool from '../config/database.js';
import { coordinatorSegmentIds } from './divisionCoordinators.js';
import { listFunctionalRoleAssignments } from './functionalRoleAssignments.js';
import { userHasModuleGrant } from './modulePermissionGrants.js';
import { loadSchoolGradeStructure, type GradeConfigSegment } from './schoolGradeStructure.js';

export type CalendarPhase = 'autumn_prep' | 'autumn' | 'winter' | 'spring_prep' | 'spring' | 'summer';
export type DayOverrideKind = 'makeup' | 'off';
export type CalendarEventStatus = 'planned' | 'done' | 'cancelled';
export type MeetingPeriod = 'morning' | 'noon' | 'afternoon';

export type CalendarSettings = {
  firstSchoolDate: string;
  winterBreakStart: string;
  springTermStart: string;
  summerBreakStart: string;
};

export type CalendarModule = {
  id: string;
  nameZh: string;
  nameEn: string;
  color: string;
  sortOrder: number;
  segmentId: string | null;
};

export type CalendarWeek = {
  id: string;
  weekIndex: number;
  monday: string;
  friday: string;
  phase: CalendarPhase;
  theme: string;
  sharedFocus: string;
};

export type CalendarFocus = {
  id: string;
  weekId: string;
  moduleId: string;
  theme: string;
  focus: string;
};

export type CalendarEvent = {
  id: string;
  moduleId: string;
  weekId: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  title: string;
  ownerUserId: string | null;
  participantIds: string[];
  status: CalendarEventStatus;
  location: string;
  note: string;
};

export type DayOverride = { date: string; kind: DayOverrideKind };

const SPRING_FESTIVAL: Record<number, string> = {
  2024: '2024-02-10',
  2025: '2025-01-29',
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
  2029: '2029-02-13',
  2030: '2030-02-03',
  2031: '2031-01-23',
  2032: '2032-02-11',
  2033: '2033-01-31',
  2034: '2034-02-19',
  2035: '2035-02-08',
  2036: '2036-01-28',
  2037: '2037-02-15',
  2038: '2038-02-04',
  2039: '2039-01-24',
  2040: '2040-02-12',
};

const MODULE_COLORS = ['#0284c7', '#7c3aed', '#d97706', '#475569', '#0f766e', '#be123c'];

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function parseISO(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = parseISO(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatISO(date);
}

/** 0 周日 … 6 周六 */
export function weekday(value: string): number {
  return parseISO(value).getUTCDay();
}

export function mondayOnOrBefore(value: string): string {
  const day = weekday(value);
  const delta = day === 0 ? 6 : day - 1;
  return addDays(value, -delta);
}

/** 非管理员：仅锁定「早于本周一」的日期；本周已过工作日仍可改。 */
export function isCalendarDatePastLocked(eventDate: string, today = todayShanghai()): boolean {
  if (!isDate(eventDate)) return true;
  return mondayOnOrBefore(eventDate) < mondayOnOrBefore(today);
}

function shiftWeekendToMonday(value: string): string {
  const day = weekday(value);
  if (day === 6) return addDays(value, 2);
  if (day === 0) return addDays(value, 1);
  return value;
}

export function todayShanghai(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime());
}

export function isTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59;
}

/** 义务教育常见安排：9 月 1 日开学；春节前约 12 天放寒假；正月十五前后开学；7 月 1 日放暑假。 */
export function defaultCalendarSettings(startYear: number): CalendarSettings {
  const endYear = startYear + 1;
  const firstSchoolDate = shiftWeekendToMonday(`${startYear}-09-01`);
  const cny = SPRING_FESTIVAL[endYear] ?? `${endYear}-02-05`;
  const winterBreakStart = addDays(cny, -12);
  const springTermStart = shiftWeekendToMonday(addDays(cny, 15));
  const summerBreakStart = `${endYear}-07-01`;
  return { firstSchoolDate, winterBreakStart, springTermStart, summerBreakStart };
}

export function startYearFromAcademicYear(name: string, startDate: string | null): number {
  const fromDate = startDate?.slice(0, 4);
  if (fromDate && /^\d{4}$/.test(fromDate)) return Number(fromDate);
  const match = name.match(/(20\d{2})/);
  if (match) return Number(match[1]);
  return new Date().getFullYear();
}

function pushWeek(
  weeks: Array<Omit<CalendarWeek, 'id' | 'theme' | 'sharedFocus'>>,
  monday: string,
  phase: CalendarPhase,
  weekIndex: number,
): void {
  weeks.push({ weekIndex, monday, friday: addDays(monday, 4), phase });
}

/**
 * 上学期、下学期各自从第 1 周起算。正式开学前各有一周返岗周。
 * 寒假、暑假整周列入月历，不占教学周编号。暑假收到当年 8 月最后一周。
 */
export function buildWeeks(settings: CalendarSettings): Array<Omit<CalendarWeek, 'id' | 'theme' | 'sharedFocus'>> {
  const weeks: Array<Omit<CalendarWeek, 'id' | 'theme' | 'sharedFocus'>> = [];
  const autumnMonday = mondayOnOrBefore(settings.firstSchoolDate);
  const springMonday = mondayOnOrBefore(settings.springTermStart);
  const springPrep = addDays(springMonday, -7);
  const summerYear = Number(settings.summerBreakStart.slice(0, 4));
  const lastSummerMonday = mondayOnOrBefore(`${summerYear}-08-31`);

  pushWeek(weeks, addDays(autumnMonday, -7), 'autumn_prep', 0);

  let autumnIndex = 1;
  for (let monday = autumnMonday; monday < springPrep && autumnIndex < 40; monday = addDays(monday, 7)) {
    if (monday < settings.winterBreakStart) {
      pushWeek(weeks, monday, 'autumn', autumnIndex);
      autumnIndex += 1;
    } else {
      pushWeek(weeks, monday, 'winter', 0);
    }
  }

  pushWeek(weeks, springPrep, 'spring_prep', 0);

  let springIndex = 1;
  for (let monday = springMonday; monday < settings.summerBreakStart && springIndex < 40; monday = addDays(monday, 7)) {
    pushWeek(weeks, monday, 'spring', springIndex);
    springIndex += 1;
  }
  const summerMonday = mondayOnOrBefore(settings.summerBreakStart);
  const firstSummerMonday = summerMonday < settings.summerBreakStart ? addDays(summerMonday, 7) : summerMonday;
  for (let monday = firstSummerMonday; monday <= lastSummerMonday; monday = addDays(monday, 7)) {
    pushWeek(weeks, monday, 'summer', 0);
  }
  return weeks;
}

let ensured = false;

export async function ensureSchoolCalendarTables(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_calendar_modules (
      id VARCHAR(50) PRIMARY KEY,
      name_zh VARCHAR(80) NOT NULL,
      name_en VARCHAR(80) NOT NULL,
      color VARCHAR(20) NOT NULL,
      sort_order INTEGER NOT NULL,
      segment_id VARCHAR(80),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS school_calendar_settings (
      academic_year_id VARCHAR(50) PRIMARY KEY REFERENCES academic_years(id) ON DELETE CASCADE,
      first_school_date DATE NOT NULL,
      winter_break_start DATE NOT NULL,
      spring_term_start DATE NOT NULL,
      summer_break_start DATE NOT NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS school_calendar_weeks (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      week_index INTEGER NOT NULL,
      monday DATE NOT NULL,
      friday DATE NOT NULL,
      phase VARCHAR(20) NOT NULL CHECK (phase IN ('autumn_prep', 'autumn', 'winter', 'spring_prep', 'spring', 'summer')),
      UNIQUE (academic_year_id, monday)
    );
    CREATE TABLE IF NOT EXISTS school_calendar_day_overrides (
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('makeup', 'off')),
      PRIMARY KEY (academic_year_id, day)
    );
    CREATE TABLE IF NOT EXISTS school_calendar_focuses (
      id VARCHAR(50) PRIMARY KEY,
      week_id VARCHAR(50) NOT NULL REFERENCES school_calendar_weeks(id) ON DELETE CASCADE,
      module_id VARCHAR(50) NOT NULL REFERENCES school_calendar_modules(id) ON DELETE CASCADE,
      theme VARCHAR(200) NOT NULL DEFAULT '',
      focus TEXT NOT NULL DEFAULT '',
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (week_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS school_calendar_events (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      module_id VARCHAR(50) NOT NULL REFERENCES school_calendar_modules(id) ON DELETE CASCADE,
      week_id VARCHAR(50) NOT NULL REFERENCES school_calendar_weeks(id) ON DELETE CASCADE,
      event_date DATE NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      title VARCHAR(200) NOT NULL,
      location VARCHAR(200) NOT NULL DEFAULT '',
      owner_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      participant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
      note TEXT NOT NULL DEFAULT '',
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS school_calendar_holiday_cache (
      source TEXT PRIMARY KEY,
      fetched_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS school_calendar_meetings (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
      period VARCHAR(20) NOT NULL CHECK (period IN ('morning', 'noon', 'afternoon')),
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      title VARCHAR(200) NOT NULL,
      location VARCHAR(200) NOT NULL DEFAULT '',
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE school_calendar_settings
      ADD COLUMN IF NOT EXISTS meetings_initialized BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'school_calendar_weeks'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%phase%'
      LOOP
        EXECUTE format('ALTER TABLE school_calendar_weeks DROP CONSTRAINT %I', r.conname);
      END LOOP;
      FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'school_calendar_weeks'
          AND con.contype = 'u'
          AND pg_get_constraintdef(con.oid) ILIKE '%week_index%'
      LOOP
        EXECUTE format('ALTER TABLE school_calendar_weeks DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$;
    ALTER TABLE school_calendar_weeks ADD CONSTRAINT school_calendar_weeks_phase_check
      CHECK (phase IN ('autumn_prep', 'autumn', 'winter', 'spring_prep', 'spring', 'summer'));
    ALTER TABLE school_calendar_events ADD COLUMN IF NOT EXISTS location VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE school_calendar_events ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE school_calendar_weeks ADD COLUMN IF NOT EXISTS theme VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE school_calendar_weeks ADD COLUMN IF NOT EXISTS shared_focus TEXT NOT NULL DEFAULT '';
    UPDATE school_calendar_weeks w
    SET theme = src.theme
    FROM (
      SELECT DISTINCT ON (week_id) week_id, theme
      FROM school_calendar_focuses
      WHERE btrim(theme) <> ''
      ORDER BY week_id, updated_at DESC
    ) src
    WHERE w.id = src.week_id AND w.theme = '';
    UPDATE school_calendar_focuses SET theme = '' WHERE theme <> '';
  `);
  ensured = true;
}

async function yearRow(academicYearId: string): Promise<{ id: string; name: string; start_date: string | null } | null> {
  const row = (
    await pool.query(`SELECT id, name, start_date::text FROM academic_years WHERE id = $1`, [academicYearId])
  ).rows[0] as { id: string; name: string; start_date: string | null } | undefined;
  return row ?? null;
}

async function callerIsAdmin(userId: string): Promise<boolean> {
  const row = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0] as { role: string } | undefined;
  return row?.role === 'admin' || row?.role === 'system-admin';
}

/** 真正的年级组长、学科组长（不含协调员岗位换算）。 */
async function actualLeaderIds(academicYearId: string): Promise<Set<string>> {
  const roles = await listFunctionalRoleAssignments(academicYearId);
  const ids = new Set<string>();
  for (const role of roles) {
    if (!role.teacherId) continue;
    if (role.roleType === 'grade-head' || role.roleType === 'subject-group-head') ids.add(role.teacherId);
  }
  return ids;
}

async function isActualGroupLeader(userId: string, academicYearId: string): Promise<boolean> {
  return (await actualLeaderIds(academicYearId)).has(userId);
}

/** 协调员分管的校历模块：绑定其学部的模块。教师发展、行政后勤不因协调员身份放开。 */
async function coordinatorModuleIds(
  userId: string,
  academicYearId: string,
  modules: CalendarModule[],
): Promise<string[]> {
  const segments = await coordinatorSegmentIds(userId, academicYearId);
  if (segments.size === 0) return [];
  return modules.filter((mod) => mod.segmentId && segments.has(mod.segmentId)).map((mod) => mod.id);
}

/** 周历新建：管理员与额外授权可写全部模块；组长不限模块；协调员只写分管学部模块。 */
async function editableEventModuleIdsFor(
  userId: string,
  academicYearId: string,
  modules: CalendarModule[],
): Promise<string[]> {
  if (await callerIsAdmin(userId)) return modules.map((m) => m.id);
  if (await userHasModuleGrant(userId, 'calendar-week')) return modules.map((m) => m.id);
  if (await isActualGroupLeader(userId, academicYearId)) return modules.map((m) => m.id);
  return coordinatorModuleIds(userId, academicYearId, modules);
}

async function canWritePastWeekEvents(userId: string, academicYearId: string): Promise<boolean> {
  if (await callerIsAdmin(userId)) return true;
  if (await isActualGroupLeader(userId, academicYearId)) return true;
  return (await coordinatorSegmentIds(userId, academicYearId)).size > 0;
}

type EventPeople = {
  moduleId: string;
  ownerUserId: string | null;
  participantIds: string[];
  createdBy: string | null;
};

/**
 * 修改已有周历事项：管理员与周历额外授权可改全部。
 * 组长可改自己创建的事项（不限模块，含过往）。
 * 协调员可改自己创建的，以及分管模块里组长创建的事项。
 */
async function canEditExistingCalendarEvent(
  userId: string,
  academicYearId: string,
  event: EventPeople,
): Promise<boolean> {
  if (await callerIsAdmin(userId)) return true;
  if (await userHasModuleGrant(userId, 'calendar-week')) return true;
  const leaders = await actualLeaderIds(academicYearId);
  if (leaders.has(userId) && event.createdBy === userId) return true;
  const modules = await calendarModules();
  const coordModules = new Set(await coordinatorModuleIds(userId, academicYearId, modules));
  if (coordModules.size === 0) return false;
  if (event.createdBy === userId) return true;
  return Boolean(event.createdBy && leaders.has(event.createdBy) && coordModules.has(event.moduleId));
}

async function assertCanEditExistingCalendarEvent(
  userId: string,
  academicYearId: string,
  event: EventPeople,
): Promise<{ ok: true } | { error: 'forbidden' }> {
  if (await canEditExistingCalendarEvent(userId, academicYearId, event)) return { ok: true };
  return { error: 'forbidden' as const };
}

/** 月历：管理员、协调员、月历额外授权可改全部模块。 */
async function canManageMonthCalendar(userId: string, academicYearId: string): Promise<boolean> {
  if (await callerIsAdmin(userId)) return true;
  if (await userHasModuleGrant(userId, 'calendar-month')) return true;
  return (await coordinatorSegmentIds(userId, academicYearId)).size > 0;
}

async function editableFocusModuleIdsFor(
  userId: string,
  academicYearId: string,
  modules: CalendarModule[],
): Promise<string[]> {
  if (await canManageMonthCalendar(userId, academicYearId)) return modules.map((m) => m.id);
  return [];
}

async function seedModules(segments: GradeConfigSegment[]): Promise<void> {
  const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM school_calendar_modules`)).rows[0] as { n: number };
  if (count.n > 0) return;
  const primary = segments.find((s) => /小学|primary/i.test(s.label));
  const middle = segments.find((s) => /初中|middle/i.test(s.label));
  const defaults = [
    { nameZh: '小学部', nameEn: 'Primary School', segmentId: primary?.id ?? null },
    { nameZh: '中学部', nameEn: 'Middle School', segmentId: middle?.id ?? null },
    { nameZh: '教师发展', nameEn: 'Teacher Development', segmentId: null },
    { nameZh: '行政后勤', nameEn: 'Admin & Logistics', segmentId: null },
  ];
  for (let i = 0; i < defaults.length; i += 1) {
    const item = defaults[i];
    await pool.query(
      `INSERT INTO school_calendar_modules (id, name_zh, name_en, color, sort_order, segment_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [newId('scm'), item.nameZh, item.nameEn, MODULE_COLORS[i], i, item.segmentId],
    );
  }
}

async function loadSettings(academicYearId: string, startYear: number): Promise<CalendarSettings> {
  const row = (
    await pool.query(
      `SELECT first_school_date::text, winter_break_start::text, spring_term_start::text, summer_break_start::text
       FROM school_calendar_settings WHERE academic_year_id = $1`,
      [academicYearId],
    )
  ).rows[0] as
    | {
        first_school_date: string;
        winter_break_start: string;
        spring_term_start: string;
        summer_break_start: string;
      }
    | undefined;
  if (!row) {
    const defaults = defaultCalendarSettings(startYear);
    await pool.query(
      `INSERT INTO school_calendar_settings
         (academic_year_id, first_school_date, winter_break_start, spring_term_start, summer_break_start)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (academic_year_id) DO NOTHING`,
      [
        academicYearId,
        defaults.firstSchoolDate,
        defaults.winterBreakStart,
        defaults.springTermStart,
        defaults.summerBreakStart,
      ],
    );
    return defaults;
  }
  return {
    firstSchoolDate: row.first_school_date,
    winterBreakStart: row.winter_break_start,
    springTermStart: row.spring_term_start,
    summerBreakStart: row.summer_break_start,
  };
}

/** 合肥协和每周固定例会。只在该学年第一次打开校历时写入，之后删除不会再自动补回。 */
const DEFAULT_STANDING_MEETINGS: Array<{
  weekday: number;
  period: MeetingPeriod;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
}> = [
  { weekday: 1, period: 'morning', startTime: '08:30', endTime: '09:10', title: 'PE 体育', location: 'PS Music 1' },
  { weekday: 1, period: 'morning', startTime: '09:00', endTime: '10:00', title: '中学人文', location: 'MS C103 一楼办公室' },
  { weekday: 1, period: 'afternoon', startTime: '13:40', endTime: '16:00', title: '校协调会', location: 'Meeting Room 1 会议室1' },
  { weekday: 1, period: 'afternoon', startTime: '16:10', endTime: '16:50', title: '学部协调会', location: 'PS 308' },
  { weekday: 2, period: 'morning', startTime: '08:30', endTime: '10:05', title: 'Music 音乐', location: 'PS Music 2' },
  { weekday: 2, period: 'noon', startTime: '12:40', endTime: '13:20', title: 'MS All 中学全员会', location: 'C207' },
  { weekday: 2, period: 'afternoon', startTime: '13:25', endTime: '15:00', title: 'PS English 小英', location: 'PS P2G' },
  { weekday: 2, period: 'afternoon', startTime: '13:30', endTime: '16:00', title: 'MS Chinese 中语', location: 'MS C206' },
  { weekday: 3, period: 'morning', startTime: '08:30', endTime: '10:05', title: 'Art 美术', location: 'PS Carpentry 木工' },
  { weekday: 3, period: 'morning', startTime: '10:35', endTime: '12:10', title: 'PS Math 小数', location: 'PS STEAM' },
  { weekday: 3, period: 'afternoon', startTime: '16:20', endTime: '17:20', title: 'All Staff 全员会', location: 'PS 308' },
  { weekday: 4, period: 'morning', startTime: '10:50', endTime: '12:10', title: 'PS Chinese 小语', location: 'PS STEAM' },
  { weekday: 4, period: 'afternoon', startTime: '13:30', endTime: '15:00', title: 'MS Math 中数', location: 'MS C301' },
  { weekday: 4, period: 'afternoon', startTime: '13:30', endTime: '15:30', title: 'MS English 中英', location: 'MS English Classroom' },
];

async function ensureDefaultMeetings(academicYearId: string): Promise<void> {
  const claimed = await pool.query(
    `UPDATE school_calendar_settings
     SET meetings_initialized = true
     WHERE academic_year_id = $1 AND meetings_initialized = false
     RETURNING academic_year_id`,
    [academicYearId],
  );
  if ((claimed.rowCount ?? 0) === 0) return;
  const count = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM school_calendar_meetings WHERE academic_year_id = $1`,
    [academicYearId],
  );
  if (Number(count.rows[0]?.n ?? 0) > 0) return;
  for (const item of DEFAULT_STANDING_MEETINGS) {
    await pool.query(
      `INSERT INTO school_calendar_meetings
         (id, academic_year_id, weekday, period, start_time, end_time, title, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [newId('scm'), academicYearId, item.weekday, item.period, item.startTime, item.endTime, item.title, item.location],
    );
  }
}

async function syncWeeks(academicYearId: string, settings: CalendarSettings): Promise<CalendarWeek[]> {
  const built = buildWeeks(settings);
  await pool.query(
    `UPDATE school_calendar_weeks SET week_index = week_index + 1000 WHERE academic_year_id = $1`,
    [academicYearId],
  );
  const existing = (
    await pool.query(
      `SELECT id, monday::text, week_index, theme, shared_focus FROM school_calendar_weeks WHERE academic_year_id = $1`,
      [academicYearId],
    )
  ).rows as Array<{ id: string; monday: string; week_index: number; theme: string; shared_focus: string | null }>;
  const byMonday = new Map(existing.map((row) => [row.monday, row]));
  const keep = new Set<string>();
  const weeks: CalendarWeek[] = [];
  for (const week of built) {
    const found = byMonday.get(week.monday);
    if (found) {
      await pool.query(
        `UPDATE school_calendar_weeks SET week_index = $2, friday = $3, phase = $4 WHERE id = $1`,
        [found.id, week.weekIndex, week.friday, week.phase],
      );
      keep.add(found.id);
      weeks.push({ id: found.id, ...week, theme: found.theme, sharedFocus: found.shared_focus ?? '' });
    } else {
      const id = newId('scw');
      await pool.query(
        `INSERT INTO school_calendar_weeks (id, academic_year_id, week_index, monday, friday, phase)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, academicYearId, week.weekIndex, week.monday, week.friday, week.phase],
      );
      keep.add(id);
      weeks.push({ id, ...week, theme: '', sharedFocus: '' });
    }
  }
  const stale = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (stale.length > 0) {
    await pool.query(`DELETE FROM school_calendar_weeks WHERE id = ANY($1::varchar[])`, [stale]);
  }
  return weeks;
}

function mapModule(row: {
  id: string;
  name_zh: string;
  name_en: string;
  color: string;
  sort_order: number;
  segment_id: string | null;
}): CalendarModule {
  return {
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    color: row.color,
    sortOrder: row.sort_order,
    segmentId: row.segment_id,
  };
}

export async function getSchoolCalendarBoard(userId: string, academicYearId: string) {
  await ensureSchoolCalendarTables();
  const year = await yearRow(academicYearId);
  if (!year) return { error: 'year_not_found' as const };
  const gradeConfig = await loadSchoolGradeStructure();
  const segments = (gradeConfig.segments ?? []).map((s) => ({ id: s.id, label: s.label }));
  await seedModules(gradeConfig.segments ?? []);
  const settings = await loadSettings(academicYearId, startYearFromAcademicYear(year.name, year.start_date));
  const weeks = await syncWeeks(academicYearId, settings);
  const modules = (
    await pool.query(
      `SELECT id, name_zh, name_en, color, sort_order, segment_id
       FROM school_calendar_modules ORDER BY sort_order ASC, name_zh ASC`,
    )
  ).rows.map((row) => mapModule(row as Parameters<typeof mapModule>[0]));
  const focuses = (
    await pool.query(
      `SELECT f.id, f.week_id, f.module_id, f.theme, f.focus
       FROM school_calendar_focuses f
       JOIN school_calendar_weeks w ON w.id = f.week_id
       WHERE w.academic_year_id = $1`,
      [academicYearId],
    )
  ).rows as Array<{ id: string; week_id: string; module_id: string; theme: string; focus: string }>;
  const events = (
    await pool.query(
      `SELECT id, module_id, week_id, event_date::text, start_time, end_time, title, location, owner_user_id,
              participant_ids, status, note, shared, created_by
       FROM school_calendar_events WHERE academic_year_id = $1
       ORDER BY event_date ASC, start_time ASC`,
      [academicYearId],
    )
  ).rows as Array<{
    id: string;
    module_id: string;
    week_id: string;
    event_date: string;
    start_time: string;
    end_time: string;
    title: string;
    location: string;
    owner_user_id: string | null;
    participant_ids: unknown;
    status: CalendarEventStatus;
    note: string;
    shared: boolean;
    created_by: string | null;
  }>;
  const overrides = (
    await pool.query(
      `SELECT day::text, kind FROM school_calendar_day_overrides WHERE academic_year_id = $1 ORDER BY day ASC`,
      [academicYearId],
    )
  ).rows as Array<{ day: string; kind: DayOverrideKind }>;
  const staff = (
    await pool.query(
      `SELECT id, COALESCE(NULLIF(name_zh, ''), display_name) AS name_zh, COALESCE(name_en, '') AS name_en
       FROM users WHERE role IN ('teacher', 'admin', 'system-admin')
       ORDER BY name_zh ASC, name_en ASC`,
    )
  ).rows as Array<{ id: string; name_zh: string; name_en: string }>;
  await ensureDefaultMeetings(academicYearId);
  const meetings = (
    await pool.query(
      `SELECT id, weekday, period, start_time, end_time, title, location
       FROM school_calendar_meetings
       WHERE academic_year_id = $1
       ORDER BY weekday,
         CASE period WHEN 'morning' THEN 1 WHEN 'noon' THEN 2 ELSE 3 END,
         start_time, end_time, title`,
      [academicYearId],
    )
  ).rows as Array<{
    id: string;
    weekday: number;
    period: MeetingPeriod;
    start_time: string;
    end_time: string;
    title: string;
    location: string;
  }>;
  const isAdmin = await callerIsAdmin(userId);
  const canManageMonth = await canManageMonthCalendar(userId, academicYearId);
  const editableModuleIds = await editableEventModuleIdsFor(userId, academicYearId, modules);
  const editableFocusModuleIds = await editableFocusModuleIdsFor(userId, academicYearId, modules);
  const weekGrant = isAdmin || (await userHasModuleGrant(userId, 'calendar-week'));
  const leaderIds = await actualLeaderIds(academicYearId);
  const coordModules = new Set(await coordinatorModuleIds(userId, academicYearId, modules));
  const viewerIsLeader = leaderIds.has(userId);
  const canWritePastWeek = await canWritePastWeekEvents(userId, academicYearId);
  return {
    academicYearId,
    today: todayShanghai(),
    isAdmin,
    canManageMonth,
    canWritePastWeek,
    editableModuleIds,
    editableFocusModuleIds,
    settings,
    segments,
    modules,
    weeks,
    focuses: focuses.map((row) => ({
      id: row.id,
      weekId: row.week_id,
      moduleId: row.module_id,
      theme: row.theme,
      focus: row.focus,
    })),
    events: events.map((row) => {
      const participantIds = Array.isArray(row.participant_ids) ? row.participant_ids.map(String) : [];
      const createdBy = row.created_by;
      const canEdit =
        weekGrant ||
        (viewerIsLeader && createdBy === userId) ||
        (coordModules.size > 0 &&
          (createdBy === userId ||
            (Boolean(createdBy) && leaderIds.has(createdBy as string) && coordModules.has(row.module_id))));
      return {
        id: row.id,
        moduleId: row.module_id,
        weekId: row.week_id,
        eventDate: row.event_date,
        startTime: row.start_time,
        endTime: row.end_time,
        title: row.title,
        location: row.location ?? '',
        ownerUserId: row.owner_user_id,
        participantIds,
        status: row.status,
        note: row.note,
        shared: Boolean(row.shared),
        canEdit,
      };
    }),
    overrides: overrides.map((row) => ({ date: row.day, kind: row.kind })),
    staff: staff.map((row) => ({ id: row.id, nameZh: row.name_zh, nameEn: row.name_en })),
    canEditMeetings: weekGrant,
    meetings: meetings.map((row) => ({
      id: row.id,
      weekday: row.weekday,
      period: row.period,
      startTime: row.start_time,
      endTime: row.end_time,
      title: row.title,
      location: row.location ?? '',
    })),
  };
}

function settingsValid(settings: CalendarSettings): boolean {
  return (
    isDate(settings.firstSchoolDate) &&
    isDate(settings.winterBreakStart) &&
    isDate(settings.springTermStart) &&
    isDate(settings.summerBreakStart) &&
    settings.firstSchoolDate < settings.winterBreakStart &&
    settings.winterBreakStart < settings.springTermStart &&
    settings.springTermStart < settings.summerBreakStart
  );
}

export async function saveCalendarSettings(userId: string, academicYearId: string, settings: CalendarSettings) {
  await ensureSchoolCalendarTables();
  if (!(await callerIsAdmin(userId))) return { error: 'forbidden' as const };
  if (!(await yearRow(academicYearId))) return { error: 'year_not_found' as const };
  if (!settingsValid(settings)) return { error: 'invalid_bounds' as const };
  await pool.query(
    `INSERT INTO school_calendar_settings
       (academic_year_id, first_school_date, winter_break_start, spring_term_start, summer_break_start, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
     ON CONFLICT (academic_year_id) DO UPDATE SET
       first_school_date = EXCLUDED.first_school_date,
       winter_break_start = EXCLUDED.winter_break_start,
       spring_term_start = EXCLUDED.spring_term_start,
       summer_break_start = EXCLUDED.summer_break_start,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
    [academicYearId, settings.firstSchoolDate, settings.winterBreakStart, settings.springTermStart, settings.summerBreakStart, userId],
  );
  await syncWeeks(academicYearId, settings);
  return { ok: true as const };
}

export async function resetCalendarSettings(userId: string, academicYearId: string) {
  const year = await yearRow(academicYearId);
  if (!year) return { error: 'year_not_found' as const };
  const settings = defaultCalendarSettings(startYearFromAcademicYear(year.name, year.start_date));
  return saveCalendarSettings(userId, academicYearId, settings);
}

export async function saveDayOverride(
  userId: string,
  academicYearId: string,
  date: string,
  kind: DayOverrideKind | null,
) {
  await ensureSchoolCalendarTables();
  if (!(await callerIsAdmin(userId))) return { error: 'forbidden' as const };
  if (!isDate(date)) return { error: 'invalid_date' as const };
  if (kind === null) {
    await pool.query(`DELETE FROM school_calendar_day_overrides WHERE academic_year_id = $1 AND day = $2`, [
      academicYearId,
      date,
    ]);
  } else {
    await pool.query(
      `INSERT INTO school_calendar_day_overrides (academic_year_id, day, kind) VALUES ($1,$2,$3)
       ON CONFLICT (academic_year_id, day) DO UPDATE SET kind = EXCLUDED.kind`,
      [academicYearId, date, kind],
    );
  }
  return { ok: true as const };
}

export async function createCalendarModule(
  userId: string,
  input: { nameZh: string; nameEn: string; segmentId: string | null },
) {
  await ensureSchoolCalendarTables();
  if (!(await callerIsAdmin(userId))) return { error: 'forbidden' as const };
  const nameZh = input.nameZh.trim();
  const nameEn = input.nameEn.trim() || nameZh;
  if (!nameZh) return { error: 'name_required' as const };
  const sort = (await pool.query(`SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM school_calendar_modules`)).rows[0] as {
    n: number;
  };
  const id = newId('scm');
  await pool.query(
    `INSERT INTO school_calendar_modules (id, name_zh, name_en, color, sort_order, segment_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, nameZh, nameEn, MODULE_COLORS[(sort.n + 1) % MODULE_COLORS.length], sort.n + 1, input.segmentId],
  );
  return { id };
}

export async function updateCalendarModule(
  userId: string,
  id: string,
  input: { nameZh: string; nameEn: string; segmentId: string | null },
) {
  await ensureSchoolCalendarTables();
  if (!(await callerIsAdmin(userId))) return { error: 'forbidden' as const };
  const nameZh = input.nameZh.trim();
  const nameEn = input.nameEn.trim() || nameZh;
  if (!nameZh) return { error: 'name_required' as const };
  const result = await pool.query(
    `UPDATE school_calendar_modules
     SET name_zh = $2, name_en = $3, segment_id = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, nameZh, nameEn, input.segmentId],
  );
  if (result.rowCount === 0) return { error: 'not_found' as const };
  return { ok: true as const };
}

export async function deleteCalendarModule(userId: string, id: string) {
  await ensureSchoolCalendarTables();
  if (!(await callerIsAdmin(userId))) return { error: 'forbidden' as const };
  const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM school_calendar_modules`)).rows[0] as { n: number };
  if (count.n <= 1) return { error: 'last_module' as const };
  const result = await pool.query(`DELETE FROM school_calendar_modules WHERE id = $1`, [id]);
  if (result.rowCount === 0) return { error: 'not_found' as const };
  return { ok: true as const };
}

async function calendarModules(): Promise<CalendarModule[]> {
  return (
    await pool.query(`SELECT id, name_zh, name_en, color, sort_order, segment_id FROM school_calendar_modules`)
  ).rows.map((row) => mapModule(row as Parameters<typeof mapModule>[0]));
}

async function assertCanWriteEventModule(
  userId: string,
  academicYearId: string,
  moduleId: string,
  eventDate: string | null,
) {
  const modules = await calendarModules();
  const editable = new Set(await editableEventModuleIdsFor(userId, academicYearId, modules));
  if (!editable.has(moduleId)) return { error: 'forbidden' as const };
  if (eventDate && isCalendarDatePastLocked(eventDate) && !(await canWritePastWeekEvents(userId, academicYearId))) {
    return { error: 'past_locked' as const };
  }
  return { ok: true as const };
}

async function assertCanWriteFocusModule(
  userId: string,
  academicYearId: string,
  moduleId: string,
  eventDate: string | null,
) {
  const modules = await calendarModules();
  const editable = new Set(await editableFocusModuleIdsFor(userId, academicYearId, modules));
  if (!editable.has(moduleId)) return { error: 'forbidden' as const };
  if (eventDate && isCalendarDatePastLocked(eventDate) && !(await canManageMonthCalendar(userId, academicYearId))) {
    return { error: 'past_locked' as const };
  }
  return { ok: true as const };
}

/** 全学部事项：能写小学部或中学部任一模块即可改。 */
async function assertCanWriteAnyDivision(userId: string, academicYearId: string, eventDate: string | null) {
  const modules = await calendarModules();
  const editable = new Set(await editableEventModuleIdsFor(userId, academicYearId, modules));
  if (!modules.some((mod) => mod.segmentId && editable.has(mod.id))) return { error: 'forbidden' as const };
  if (eventDate && isCalendarDatePastLocked(eventDate) && !(await canWritePastWeekEvents(userId, academicYearId))) {
    return { error: 'past_locked' as const };
  }
  return { ok: true as const };
}

export async function saveWeekTheme(userId: string, input: { weekId: string; theme: string }) {
  await ensureSchoolCalendarTables();
  const allowed =
    (await callerIsAdmin(userId)) || (await userHasModuleGrant(userId, 'calendar-month'));
  if (!allowed) return { error: 'forbidden' as const };
  const theme = input.theme.trim().slice(0, 200);
  const result = await pool.query(`UPDATE school_calendar_weeks SET theme = $2 WHERE id = $1`, [input.weekId, theme]);
  if (result.rowCount === 0) return { error: 'not_found' as const };
  return { ok: true as const };
}

export async function saveWeekFocus(
  userId: string,
  input: { weekId: string; moduleId: string; focus: string; sharedFocus?: string },
) {
  await ensureSchoolCalendarTables();
  const week = (
    await pool.query(
      `SELECT w.academic_year_id, w.friday::text, m.segment_id
       FROM school_calendar_weeks w
       JOIN school_calendar_modules m ON m.id = $2
       WHERE w.id = $1`,
      [input.weekId, input.moduleId],
    )
  ).rows[0] as { academic_year_id: string; friday: string; segment_id: string | null } | undefined;
  if (!week) return { error: 'not_found' as const };
  const gate = await assertCanWriteFocusModule(userId, week.academic_year_id, input.moduleId, week.friday);
  if ('error' in gate) return gate;
  const focus = input.focus.trim().slice(0, 2000);
  await pool.query(
    `INSERT INTO school_calendar_focuses (id, week_id, module_id, theme, focus, updated_by, updated_at)
     VALUES ($1,$2,$3,'',$4,$5,CURRENT_TIMESTAMP)
     ON CONFLICT (week_id, module_id) DO UPDATE SET
       focus = EXCLUDED.focus, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [newId('scf'), input.weekId, input.moduleId, focus, userId],
  );
  if (week.segment_id && input.sharedFocus !== undefined) {
    await pool.query(`UPDATE school_calendar_weeks SET shared_focus = $2 WHERE id = $1`, [
      input.weekId,
      input.sharedFocus.trim().slice(0, 2000),
    ]);
  }
  return { ok: true as const };
}

function weekForDate(weeks: CalendarWeek[], date: string): CalendarWeek | undefined {
  const sunday = (monday: string) => addDays(monday, 6);
  return weeks.find((week) => date >= week.monday && date <= sunday(week.monday));
}

export async function createCalendarEvent(
  userId: string,
  academicYearId: string,
  input: {
    moduleId: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    title: string;
    location: string;
    ownerUserId: string | null;
    participantIds: string[];
    note: string;
    shared?: boolean;
  },
) {
  await ensureSchoolCalendarTables();
  if (!isDate(input.eventDate) || !isTime(input.startTime) || !isTime(input.endTime) || input.startTime >= input.endTime) {
    return { error: 'invalid_time' as const };
  }
  const title = input.title.trim();
  if (!title) return { error: 'title_required' as const };
  const shared = Boolean(input.shared);
  const module = (await calendarModules()).find((item) => item.id === input.moduleId);
  if (!module) return { error: 'not_found' as const };
  if (shared && !module.segmentId) return { error: 'shared_module' as const };
  const gate = shared
    ? await assertCanWriteAnyDivision(userId, academicYearId, input.eventDate)
    : await assertCanWriteEventModule(userId, academicYearId, input.moduleId, input.eventDate);
  if ('error' in gate) return gate;
  const weeks = (
    await pool.query(
      `SELECT id, week_index, monday::text, friday::text, phase FROM school_calendar_weeks WHERE academic_year_id = $1`,
      [academicYearId],
    )
  ).rows as Array<{ id: string; week_index: number; monday: string; friday: string; phase: CalendarPhase }>;
  const mapped: CalendarWeek[] = weeks.map((row) => ({
    id: row.id,
    weekIndex: row.week_index,
    monday: row.monday,
    friday: row.friday,
    phase: row.phase,
    theme: '',
    sharedFocus: '',
  }));
  const week = weekForDate(mapped, input.eventDate);
  if (!week) return { error: 'invalid_date' as const };
  const id = newId('sce');
  await pool.query(
    `INSERT INTO school_calendar_events
       (id, academic_year_id, module_id, week_id, event_date, start_time, end_time, title, location, owner_user_id, participant_ids, note, shared, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$14)`,
    [
      id,
      academicYearId,
      input.moduleId,
      week.id,
      input.eventDate,
      input.startTime,
      input.endTime,
      title.slice(0, 200),
      input.location.trim().slice(0, 200),
      input.ownerUserId,
      JSON.stringify(input.participantIds),
      input.note.trim().slice(0, 2000),
      shared,
      userId,
    ],
  );
  return { id };
}

export async function updateCalendarEvent(
  userId: string,
  id: string,
  input: {
    moduleId: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    title: string;
    location: string;
    ownerUserId: string | null;
    participantIds: string[];
    status: CalendarEventStatus;
    note: string;
    shared?: boolean;
  },
) {
  await ensureSchoolCalendarTables();
  const existing = (
    await pool.query(
      `SELECT academic_year_id, module_id, event_date::text, owner_user_id, participant_ids, created_by
       FROM school_calendar_events WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    academic_year_id: string;
    module_id: string;
    event_date: string;
    owner_user_id: string | null;
    participant_ids: unknown;
    created_by: string | null;
  } | undefined;
  if (!existing) return { error: 'not_found' as const };
  if (!isDate(input.eventDate) || !isTime(input.startTime) || !isTime(input.endTime) || input.startTime >= input.endTime) {
    return { error: 'invalid_time' as const };
  }
  const title = input.title.trim();
  if (!title) return { error: 'title_required' as const };
  const people: EventPeople = {
    moduleId: existing.module_id,
    ownerUserId: existing.owner_user_id,
    participantIds: Array.isArray(existing.participant_ids) ? existing.participant_ids.map(String) : [],
    createdBy: existing.created_by,
  };
  const gate = await assertCanEditExistingCalendarEvent(userId, existing.academic_year_id, people);
  if ('error' in gate) return gate;
  const shared = Boolean(input.shared);
  const module = (await calendarModules()).find((item) => item.id === input.moduleId);
  if (!module) return { error: 'not_found' as const };
  if (shared && !module.segmentId) return { error: 'shared_module' as const };
  const weeks = (
    await pool.query(
      `SELECT id, week_index, monday::text, friday::text, phase FROM school_calendar_weeks WHERE academic_year_id = $1`,
      [existing.academic_year_id],
    )
  ).rows as Array<{ id: string; week_index: number; monday: string; friday: string; phase: CalendarPhase }>;
  const week = weekForDate(
    weeks.map((row) => ({
      id: row.id,
      weekIndex: row.week_index,
      monday: row.monday,
      friday: row.friday,
      phase: row.phase,
      theme: '',
      sharedFocus: '',
    })),
    input.eventDate,
  );
  if (!week) return { error: 'invalid_date' as const };
  await pool.query(
    `UPDATE school_calendar_events SET
       module_id = $2, week_id = $3, event_date = $4, start_time = $5, end_time = $6, title = $7,
       owner_user_id = $8, participant_ids = $9::jsonb, status = $10, note = $11, location = $12, shared = $13,
       updated_by = $14, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      id,
      input.moduleId,
      week.id,
      input.eventDate,
      input.startTime,
      input.endTime,
      title.slice(0, 200),
      input.ownerUserId,
      JSON.stringify(input.participantIds),
      input.status,
      input.note.trim().slice(0, 2000),
      input.location.trim().slice(0, 200),
      shared,
      userId,
    ],
  );
  return { ok: true as const };
}

export async function deleteCalendarEvent(userId: string, id: string) {
  await ensureSchoolCalendarTables();
  const existing = (
    await pool.query(
      `SELECT academic_year_id, module_id, owner_user_id, participant_ids, created_by
       FROM school_calendar_events WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    academic_year_id: string;
    module_id: string;
    owner_user_id: string | null;
    participant_ids: unknown;
    created_by: string | null;
  } | undefined;
  if (!existing) return { error: 'not_found' as const };
  const gate = await assertCanEditExistingCalendarEvent(userId, existing.academic_year_id, {
    moduleId: existing.module_id,
    ownerUserId: existing.owner_user_id,
    participantIds: Array.isArray(existing.participant_ids) ? existing.participant_ids.map(String) : [],
    createdBy: existing.created_by,
  });
  if ('error' in gate) return gate;
  await pool.query(`DELETE FROM school_calendar_events WHERE id = $1`, [id]);
  return { ok: true as const };
}

/** 只改完成状态；权限与修改事项内容相同。 */
export async function setCalendarEventStatus(userId: string, id: string, status: CalendarEventStatus) {
  await ensureSchoolCalendarTables();
  if (status !== 'planned' && status !== 'done' && status !== 'cancelled') return { error: 'invalid_status' as const };
  const existing = (
    await pool.query(
      `SELECT academic_year_id, module_id, owner_user_id, participant_ids, created_by
       FROM school_calendar_events WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    academic_year_id: string;
    module_id: string;
    owner_user_id: string | null;
    participant_ids: unknown;
    created_by: string | null;
  } | undefined;
  if (!existing) return { error: 'not_found' as const };
  const gate = await assertCanEditExistingCalendarEvent(userId, existing.academic_year_id, {
    moduleId: existing.module_id,
    ownerUserId: existing.owner_user_id,
    participantIds: Array.isArray(existing.participant_ids) ? existing.participant_ids.map(String) : [],
    createdBy: existing.created_by,
  });
  if ('error' in gate) return gate;
  await pool.query(
    `UPDATE school_calendar_events SET status = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, status, userId],
  );
  return { ok: true as const };
}

export type MeetingInput = {
  weekday: number;
  period: MeetingPeriod;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
};

async function assertCanEditMeetings(userId: string): Promise<{ error: 'forbidden' } | null> {
  if (await callerIsAdmin(userId)) return null;
  if (await userHasModuleGrant(userId, 'calendar-week')) return null;
  return { error: 'forbidden' };
}

function meetingInputError(input: MeetingInput): string | null {
  if (![1, 2, 3, 4, 5].includes(input.weekday)) return 'invalid_weekday';
  if (input.period !== 'morning' && input.period !== 'noon' && input.period !== 'afternoon') return 'invalid_period';
  if (!isTime(input.startTime) || !isTime(input.endTime) || input.startTime >= input.endTime) return 'invalid_time';
  const title = input.title.trim();
  if (!title) return 'title_required';
  if (title.length > 200) return 'title_too_long';
  if (input.location.trim().length > 200) return 'location_too_long';
  return null;
}

export async function createCalendarMeeting(userId: string, academicYearId: string, input: MeetingInput) {
  await ensureSchoolCalendarTables();
  const denied = await assertCanEditMeetings(userId);
  if (denied) return denied;
  if (!(await yearRow(academicYearId))) return { error: 'year_not_found' as const };
  const invalid = meetingInputError(input);
  if (invalid) return { error: invalid };
  const id = newId('scm');
  await pool.query(
    `INSERT INTO school_calendar_meetings
       (id, academic_year_id, weekday, period, start_time, end_time, title, location, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [id, academicYearId, input.weekday, input.period, input.startTime, input.endTime, input.title.trim(), input.location.trim(), userId],
  );
  await pool.query(
    `UPDATE school_calendar_settings SET meetings_initialized = true WHERE academic_year_id = $1`,
    [academicYearId],
  );
  return { id };
}

export async function updateCalendarMeeting(userId: string, id: string, input: MeetingInput) {
  await ensureSchoolCalendarTables();
  const denied = await assertCanEditMeetings(userId);
  if (denied) return denied;
  const invalid = meetingInputError(input);
  if (invalid) return { error: invalid };
  const updated = await pool.query(
    `UPDATE school_calendar_meetings
     SET weekday = $2, period = $3, start_time = $4, end_time = $5, title = $6, location = $7,
         updated_by = $8, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, input.weekday, input.period, input.startTime, input.endTime, input.title.trim(), input.location.trim(), userId],
  );
  if ((updated.rowCount ?? 0) === 0) return { error: 'not_found' as const };
  return { ok: true as const };
}

export async function deleteCalendarMeeting(userId: string, id: string) {
  await ensureSchoolCalendarTables();
  const denied = await assertCanEditMeetings(userId);
  if (denied) return denied;
  const removed = await pool.query(`DELETE FROM school_calendar_meetings WHERE id = $1`, [id]);
  if ((removed.rowCount ?? 0) === 0) return { error: 'not_found' as const };
  return { ok: true as const };
}

export type CalendarImportIssue = {
  row: number;
  sheet: 'month' | 'week' | 'meeting';
  code: string;
  detail?: string;
};

export type CalendarImportWeek = {
  row: number;
  monday: string;
  theme: string;
  sharedFocus: string;
  focuses: Array<{ moduleName: string; focus: string }>;
};

export type CalendarImportEvent = {
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

export type CalendarImportMeeting = {
  row: number;
  weekday: number;
  period: string;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
};

function normName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

function wholeSchoolName(value: string): boolean {
  const key = normName(value);
  return key === '全学部' || key === 'wholeschool' || key === 'both' || key === 'bothdivisions';
}

function anchorDivision(modules: CalendarModule[]): CalendarModule | undefined {
  return (
    modules.find((mod) => mod.segmentId && /小学|primary/i.test(`${mod.nameZh}${mod.nameEn}`)) ??
    modules.find((mod) => mod.segmentId)
  );
}

function matchModule(modules: CalendarModule[], header: string): { id: string } | { error: 'module_not_found' | 'module_ambiguous' } {
  const lines = header.split(/\n/).map((line) => normName(line)).filter(Boolean);
  const ids = new Set<string>();
  for (const line of lines) {
    for (const mod of modules) {
      if (normName(mod.nameZh) === line || (mod.nameEn && normName(mod.nameEn) === line)) ids.add(mod.id);
    }
  }
  if (ids.size === 1) return { id: [...ids][0] };
  if (ids.size > 1) return { error: 'module_ambiguous' };
  return { error: 'module_not_found' };
}

function matchStaff(
  staff: Array<{ id: string; nameZh: string; nameEn: string }>,
  name: string,
): { id: string } | { error: 'not_found' | 'ambiguous' } {
  const key = normName(name);
  const ids = [...new Set(staff.filter((person) => normName(person.nameZh) === key || normName(person.nameEn) === key).map((person) => person.id))];
  if (ids.length === 1) return { id: ids[0] };
  if (ids.length === 0) return { error: 'not_found' };
  return { error: 'ambiguous' };
}

const STATUS_FROM_LABEL: Record<string, CalendarEventStatus> = {
  planned: 'planned',
  done: 'done',
  cancelled: 'cancelled',
  计划中: 'planned',
  待完成: 'planned',
  已完成: 'done',
  已取消: 'cancelled',
};

export async function importSchoolCalendar(
  userId: string,
  academicYearId: string,
  input: { weeks: CalendarImportWeek[]; events: CalendarImportEvent[] | null; meetings: CalendarImportMeeting[] | null },
): Promise<
  | { weekCount: number; eventCount: number; eventsReplaced: boolean; meetingCount: number; meetingsReplaced: boolean }
  | { error: string; issues?: CalendarImportIssue[] }
> {
  const board = await getSchoolCalendarBoard(userId, academicYearId);
  if (board.error) return { error: board.error };
  if (!board.isAdmin) return { error: 'forbidden' };
  if (input.weeks.length === 0) return { error: 'no_rows' };

  const issues: CalendarImportIssue[] = [];
  const weekByMonday = new Map(board.weeks.map((week) => [week.monday, week]));
  const usedWeek = new Set<string>();
  const resolvedWeeks: Array<{
    weekId: string;
    theme: string;
    sharedFocus: string;
    focuses: Array<{ moduleId: string; focus: string }>;
  }> = [];

  for (const item of input.weeks) {
    if (!isDate(item.monday)) {
      issues.push({ row: item.row, sheet: 'month', code: 'invalid_date', detail: item.monday });
      continue;
    }
    const direct = weekByMonday.get(item.monday);
    const containing = direct ?? board.weeks.find((week) => item.monday >= week.monday && item.monday <= addDays(week.monday, 6));
    if (!containing) {
      issues.push({ row: item.row, sheet: 'month', code: 'invalid_date', detail: item.monday });
      continue;
    }
    if (usedWeek.has(containing.id)) issues.push({ row: item.row, sheet: 'month', code: 'duplicate_monday', detail: item.monday });
    usedWeek.add(containing.id);
    if (item.theme.trim().length > 200) issues.push({ row: item.row, sheet: 'month', code: 'theme_too_long' });
    if (item.sharedFocus.trim().length > 2000) issues.push({ row: item.row, sheet: 'month', code: 'focus_too_long', detail: '全学部' });
    const focuses: Array<{ moduleId: string; focus: string }> = [];
    for (const cell of item.focuses) {
      const matched = matchModule(board.modules, cell.moduleName);
      if ('error' in matched) {
        issues.push({ row: item.row, sheet: 'month', code: matched.error, detail: cell.moduleName.split('\n')[0] });
        continue;
      }
      if (cell.focus.trim().length > 2000) {
        issues.push({ row: item.row, sheet: 'month', code: 'focus_too_long', detail: cell.moduleName.split('\n')[0] });
        continue;
      }
      if (cell.focus.trim()) focuses.push({ moduleId: matched.id, focus: cell.focus.trim() });
    }
    resolvedWeeks.push({
      weekId: containing.id,
      theme: item.theme.trim().slice(0, 200),
      sharedFocus: item.sharedFocus.trim().slice(0, 2000),
      focuses,
    });
  }

  const resolvedEvents: Array<{
    moduleId: string;
    weekId: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    title: string;
    location: string;
    ownerUserId: string | null;
    participantIds: string[];
    status: CalendarEventStatus;
    note: string;
    shared: boolean;
  }> = [];
  if (input.events) {
    for (const item of input.events) {
      if (!isDate(item.eventDate)) {
        issues.push({ row: item.row, sheet: 'week', code: 'invalid_date', detail: item.eventDate });
        continue;
      }
      const week = board.weeks.find((entry) => item.eventDate >= entry.monday && item.eventDate <= addDays(entry.monday, 6));
      if (!week) issues.push({ row: item.row, sheet: 'week', code: 'invalid_date', detail: item.eventDate });
      const shared = wholeSchoolName(item.moduleName);
      const division = shared ? anchorDivision(board.modules) : undefined;
      const matched = shared
        ? division
          ? { id: division.id }
          : { error: 'module_not_found' as const }
        : matchModule(board.modules, item.moduleName);
      if ('error' in matched) issues.push({ row: item.row, sheet: 'week', code: matched.error, detail: item.moduleName });
      const title = item.title.trim();
      if (!title) issues.push({ row: item.row, sheet: 'week', code: 'title_required' });
      if (title.length > 200) issues.push({ row: item.row, sheet: 'week', code: 'title_too_long' });
      if (!isTime(item.startTime) || !isTime(item.endTime) || item.startTime >= item.endTime) {
        issues.push({ row: item.row, sheet: 'week', code: 'invalid_time' });
      }
      if (item.location.trim().length > 200) issues.push({ row: item.row, sheet: 'week', code: 'location_too_long' });
      if (item.note.trim().length > 2000) issues.push({ row: item.row, sheet: 'week', code: 'note_too_long' });
      const statusKey = normName(item.status);
      const status = item.status.trim() ? STATUS_FROM_LABEL[item.status.trim()] ?? STATUS_FROM_LABEL[statusKey] : 'planned';
      if (!status) issues.push({ row: item.row, sheet: 'week', code: 'invalid_status', detail: item.status });
      let ownerUserId: string | null = null;
      if (item.ownerName.trim()) {
        const owner = matchStaff(board.staff, item.ownerName);
        if ('error' in owner) {
          issues.push({
            row: item.row,
            sheet: 'week',
            code: owner.error === 'ambiguous' ? 'owner_ambiguous' : 'owner_not_found',
            detail: item.ownerName,
          });
        } else ownerUserId = owner.id;
      }
      const participantIds: string[] = [];
      for (const name of item.participantNames) {
        const person = matchStaff(board.staff, name);
        if ('error' in person) {
          issues.push({
            row: item.row,
            sheet: 'week',
            code: person.error === 'ambiguous' ? 'participant_ambiguous' : 'participant_not_found',
            detail: name,
          });
        } else if (!participantIds.includes(person.id)) participantIds.push(person.id);
      }
      if (!week || 'error' in matched || !status || !title) continue;
      resolvedEvents.push({
        moduleId: matched.id,
        weekId: week.id,
        eventDate: item.eventDate,
        startTime: item.startTime,
        endTime: item.endTime,
        title: title.slice(0, 200),
        location: item.location.trim().slice(0, 200),
        ownerUserId,
        participantIds,
        status,
        note: item.note.trim().slice(0, 2000),
        shared,
      });
    }
  }

  const resolvedMeetings: Array<{
    weekday: number;
    period: MeetingPeriod;
    startTime: string;
    endTime: string;
    title: string;
    location: string;
  }> = [];
  if (input.meetings) {
    for (const item of input.meetings) {
      const period = item.period === 'morning' || item.period === 'noon' || item.period === 'afternoon' ? item.period : null;
      const title = item.title.trim();
      if (![1, 2, 3, 4, 5].includes(item.weekday)) {
        issues.push({ row: item.row, sheet: 'meeting', code: 'invalid_weekday', detail: String(item.weekday) });
      }
      if (!period) issues.push({ row: item.row, sheet: 'meeting', code: 'invalid_period', detail: item.period });
      if (!title) issues.push({ row: item.row, sheet: 'meeting', code: 'title_required' });
      if (title.length > 200) issues.push({ row: item.row, sheet: 'meeting', code: 'title_too_long' });
      if (!isTime(item.startTime) || !isTime(item.endTime) || item.startTime >= item.endTime) {
        issues.push({ row: item.row, sheet: 'meeting', code: 'invalid_time', detail: `${item.startTime}-${item.endTime}` });
      }
      if (item.location.trim().length > 200) issues.push({ row: item.row, sheet: 'meeting', code: 'location_too_long' });
      if (![1, 2, 3, 4, 5].includes(item.weekday) || !period || !title) continue;
      if (!isTime(item.startTime) || !isTime(item.endTime) || item.startTime >= item.endTime) continue;
      resolvedMeetings.push({
        weekday: item.weekday,
        period,
        startTime: item.startTime,
        endTime: item.endTime,
        title: title.slice(0, 200),
        location: item.location.trim().slice(0, 200),
      });
    }
  }

  if (issues.length > 0) return { error: 'import_invalid', issues };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const listed = new Set(resolvedWeeks.map((week) => week.weekId));
    for (const week of board.weeks) {
      if (listed.has(week.id)) continue;
      await client.query(`UPDATE school_calendar_weeks SET theme = '', shared_focus = '' WHERE id = $1`, [week.id]);
    }
    for (const week of resolvedWeeks) {
      await client.query(`UPDATE school_calendar_weeks SET theme = $2, shared_focus = $3 WHERE id = $1`, [
        week.weekId,
        week.theme,
        week.sharedFocus,
      ]);
    }
    await client.query(
      `DELETE FROM school_calendar_focuses
       WHERE week_id IN (SELECT id FROM school_calendar_weeks WHERE academic_year_id = $1)`,
      [academicYearId],
    );
    for (const week of resolvedWeeks) {
      for (const cell of week.focuses) {
        await client.query(
          `INSERT INTO school_calendar_focuses (id, week_id, module_id, theme, focus, updated_by, updated_at)
           VALUES ($1,$2,$3,'',$4,$5,CURRENT_TIMESTAMP)`,
          [newId('scf'), week.weekId, cell.moduleId, cell.focus, userId],
        );
      }
    }
    const eventsReplaced = input.events != null;
    if (eventsReplaced) {
      await client.query(`DELETE FROM school_calendar_events WHERE academic_year_id = $1`, [academicYearId]);
      for (const event of resolvedEvents) {
        await client.query(
          `INSERT INTO school_calendar_events
             (id, academic_year_id, module_id, week_id, event_date, start_time, end_time, title, location, owner_user_id, participant_ids, status, note, shared, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$15)`,
          [
            newId('sce'),
            academicYearId,
            event.moduleId,
            event.weekId,
            event.eventDate,
            event.startTime,
            event.endTime,
            event.title,
            event.location,
            event.ownerUserId,
            JSON.stringify(event.participantIds),
            event.status,
            event.note,
            event.shared,
            userId,
          ],
        );
      }
    }
    const meetingsReplaced = input.meetings != null;
    if (meetingsReplaced) {
      await client.query(`DELETE FROM school_calendar_meetings WHERE academic_year_id = $1`, [academicYearId]);
      for (const meeting of resolvedMeetings) {
        await client.query(
          `INSERT INTO school_calendar_meetings
             (id, academic_year_id, weekday, period, start_time, end_time, title, location, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
          [
            newId('scm'),
            academicYearId,
            meeting.weekday,
            meeting.period,
            meeting.startTime,
            meeting.endTime,
            meeting.title,
            meeting.location,
            userId,
          ],
        );
      }
      await client.query(
        `UPDATE school_calendar_settings SET meetings_initialized = true WHERE academic_year_id = $1`,
        [academicYearId],
      );
    }
    await client.query('COMMIT');
    return {
      weekCount: resolvedWeeks.length,
      eventCount: eventsReplaced ? resolvedEvents.length : 0,
      eventsReplaced,
      meetingCount: meetingsReplaced ? resolvedMeetings.length : 0,
      meetingsReplaced,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
