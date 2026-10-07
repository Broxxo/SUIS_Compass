/**
 * 中国大陆节假日。放假与调休来自苹果「中国大陆节假日」日历，
 * 地址 https://calendars.icloud.com/holidays/cn_zh.ics/
 * 只采用 X-APPLE-SPECIAL-DAY：WORK-HOLIDAY 为放假，ALTERNATE-WORKDAY 为调休上班。
 * 另外标出每年正月初一的春节。当年放假安排还没公布时，这一天仍然显示，但不因此改成放假。
 * 节气和其他传统节日名称不标。缓存 24 小时，源更新后下一次读取会换上新日期。
 */
import { gunzipSync } from 'zlib';
import pool from '../config/database.js';
import { ensureSchoolCalendarTables } from './schoolCalendar.js';

export const CN_HOLIDAY_ICS_URL = 'https://calendars.icloud.com/holidays/cn_zh.ics/';
const CACHE_SOURCE = `${CN_HOLIDAY_ICS_URL}#spring-festival`;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type PublicHolidayDay = {
  date: string;
  kind: 'off' | 'work' | 'festival';
  label: string;
  title: string;
};

export type PublicHolidayFeed = {
  source: string;
  fetchedAt: string;
  days: PublicHolidayDay[];
};

const SHORT_LABEL: Record<string, string> = {
  元旦: '元旦',
  春节: '春节',
  清明: '清明',
  清明节: '清明',
  劳动节: '劳动',
  端午节: '端午',
  中秋节: '中秋',
  国庆节: '国庆',
};

function shortLabel(name: string): string {
  return SHORT_LABEL[name] ?? name.replace(/节$/, '');
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compactToIso(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function unfold(ics: string): string {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function prop(block: string, name: string): string {
  const match = block.match(new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function expandDates(start: string, endExclusive: string): string[] {
  if (!endExclusive || endExclusive <= start) return [start];
  const dates: string[] = [];
  for (let iso = start; iso < endExclusive; iso = addDays(iso, 1)) dates.push(iso);
  return dates;
}

export function parseCnHolidayIcs(ics: string): PublicHolidayDay[] {
  const text = unfold(ics);
  const off = new Map<string, { name: string; span: number }>();
  const work = new Map<string, string>();
  const springFestival = new Set<string>();
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const special = prop(block, 'X-APPLE-SPECIAL-DAY');
    const startRaw = prop(block, 'DTSTART');
    if (!/^\d{8}$/.test(startRaw)) continue;
    const endRaw = prop(block, 'DTEND');
    const start = compactToIso(startRaw);
    const endExclusive = /^\d{8}$/.test(endRaw) ? compactToIso(endRaw) : '';
    const dates = expandDates(start, endExclusive);
    const name = prop(block, 'SUMMARY').replace(/（(?:休|班)）/g, '').trim();
    if (!name) continue;
    if (special !== 'WORK-HOLIDAY' && special !== 'ALTERNATE-WORKDAY') {
      if (name === '春节' && dates.length === 1) springFestival.add(dates[0]);
      continue;
    }
    if (special === 'WORK-HOLIDAY') {
      for (const date of dates) {
        const prev = off.get(date);
        if (!prev || dates.length < prev.span) off.set(date, { name, span: dates.length });
      }
    } else {
      for (const date of dates) {
        if (!work.has(date)) work.set(date, name);
      }
    }
  }
  const days: PublicHolidayDay[] = [];
  for (const [date, item] of off) {
    days.push({ date, kind: 'off', label: shortLabel(item.name), title: `${item.name}放假` });
  }
  for (const [date, name] of work) {
    if (off.has(date)) continue;
    days.push({ date, kind: 'work', label: '班', title: `调休上班（${name}）` });
  }
  for (const date of springFestival) {
    if (off.has(date) || work.has(date)) continue;
    days.push({ date, kind: 'festival', label: '春节', title: '春节' });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

async function readIcsBody(response: Response): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return gunzipSync(buffer).toString('utf8');
  }
  return buffer.toString('utf8');
}

async function downloadFeed(): Promise<PublicHolidayDay[]> {
  const response = await fetch(CN_HOLIDAY_ICS_URL, {
    headers: { 'User-Agent': 'SUIS-Compass/holiday-feed' },
  });
  if (!response.ok) throw new Error(`holiday feed ${response.status}`);
  const ics = await readIcsBody(response);
  if (!ics.includes('BEGIN:VCALENDAR')) throw new Error('holiday feed is not a calendar');
  const days = parseCnHolidayIcs(ics);
  if (days.length === 0) throw new Error('holiday feed has no rest or makeup days');
  return days;
}

type CacheRow = { fetched_at: Date | string; payload: { days?: PublicHolidayDay[] } };

function feedFromRow(row: CacheRow): PublicHolidayFeed | null {
  const days = Array.isArray(row.payload?.days) ? row.payload.days : null;
  if (!days) return null;
  const fetchedAt = row.fetched_at instanceof Date ? row.fetched_at.toISOString() : new Date(row.fetched_at).toISOString();
  return { source: CN_HOLIDAY_ICS_URL, fetchedAt, days };
}

async function readCache(): Promise<CacheRow | null> {
  const result = await pool.query<CacheRow>(
    'SELECT fetched_at, payload FROM school_calendar_holiday_cache WHERE source = $1',
    [CACHE_SOURCE],
  );
  return result.rows[0] ?? null;
}

async function writeCache(days: PublicHolidayDay[]): Promise<string> {
  const result = await pool.query<{ fetched_at: Date }>(
    `INSERT INTO school_calendar_holiday_cache (source, fetched_at, payload)
     VALUES ($1, NOW(), $2::jsonb)
     ON CONFLICT (source) DO UPDATE SET fetched_at = NOW(), payload = EXCLUDED.payload
     RETURNING fetched_at`,
    [CACHE_SOURCE, JSON.stringify({ days })],
  );
  return result.rows[0].fetched_at.toISOString();
}

let refreshing: Promise<PublicHolidayFeed> | null = null;

export async function getCnHolidayFeed(): Promise<PublicHolidayFeed> {
  await ensureSchoolCalendarTables();
  const cached = await readCache();
  const fresh = cached ? Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS : false;
  if (cached && fresh) {
    const feed = feedFromRow(cached);
    if (feed) return feed;
  }
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const days = await downloadFeed();
        const fetchedAt = await writeCache(days);
        return { source: CN_HOLIDAY_ICS_URL, fetchedAt, days };
      } catch (error) {
        const stale = feedFromRow(cached ?? (await readCache()) ?? { fetched_at: '', payload: {} });
        if (stale) return stale;
        throw error;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}
