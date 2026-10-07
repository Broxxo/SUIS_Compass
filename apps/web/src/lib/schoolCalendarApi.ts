import { getCurrentUserId, getToken } from './authUtils';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string) ?? '';

function getHeaders(): HeadersInit {
  const token = getToken();
  const userId = getCurrentUserId();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : import.meta.env.DEV && userId ? { 'X-User-Id': userId } : {}),
  };
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE_URL.replace(/\/$/, '');
  if (!base) return normalizedPath;
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) return `${base.slice(0, -4)}${normalizedPath}`;
  return `${base}${normalizedPath}`;
}

export type CalendarPhase = 'autumn_prep' | 'autumn' | 'winter' | 'spring_prep' | 'spring' | 'summer';
export type CalendarEventStatus = 'planned' | 'done' | 'cancelled';

export type SchoolCalendarModule = {
  id: string;
  nameZh: string;
  nameEn: string;
  color: string;
  sortOrder: number;
  segmentId: string | null;
};

export type SchoolCalendarWeek = {
  id: string;
  weekIndex: number;
  monday: string;
  friday: string;
  phase: CalendarPhase;
  theme: string;
  sharedFocus: string;
};

export type SchoolCalendarFocus = {
  id: string;
  weekId: string;
  moduleId: string;
  theme: string;
  focus: string;
};

export type SchoolCalendarEvent = {
  id: string;
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
};

export type SchoolCalendarBoard = {
  academicYearId: string;
  today: string;
  isAdmin: boolean;
  editableModuleIds: string[];
  settings: {
    firstSchoolDate: string;
    winterBreakStart: string;
    springTermStart: string;
    summerBreakStart: string;
  };
  segments: Array<{ id: string; label: string }>;
  modules: SchoolCalendarModule[];
  weeks: SchoolCalendarWeek[];
  focuses: SchoolCalendarFocus[];
  events: SchoolCalendarEvent[];
  overrides: Array<{ date: string; kind: 'makeup' | 'off' }>;
  staff: Array<{ id: string; nameZh: string; nameEn: string }>;
};

async function readError(response: Response): Promise<never> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error || 'internal');
}

export type PublicHolidayDay = {
  date: string;
  kind: 'off' | 'work' | 'festival';
  label: string;
  title: string;
};

export async function fetchPublicHolidays(): Promise<{ source: string; fetchedAt: string; days: PublicHolidayDay[] }> {
  const response = await fetch(apiUrl('/api/school-calendar/public-holidays'), { headers: getHeaders() });
  if (!response.ok) await readError(response);
  return response.json() as Promise<{ source: string; fetchedAt: string; days: PublicHolidayDay[] }>;
}

export async function fetchSchoolCalendar(academicYearId: string): Promise<SchoolCalendarBoard> {
  const q = new URLSearchParams({ academicYearId });
  const response = await fetch(apiUrl(`/api/school-calendar?${q}`), { headers: getHeaders() });
  if (!response.ok) await readError(response);
  return response.json() as Promise<SchoolCalendarBoard>;
}

export async function saveSchoolCalendarSettings(
  academicYearId: string,
  settings: SchoolCalendarBoard['settings'],
): Promise<void> {
  const response = await fetch(apiUrl('/api/school-calendar/settings'), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ academicYearId, ...settings }),
  });
  if (!response.ok) await readError(response);
}

export async function resetSchoolCalendarSettings(academicYearId: string): Promise<void> {
  const response = await fetch(apiUrl('/api/school-calendar/settings/reset'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ academicYearId }),
  });
  if (!response.ok) await readError(response);
}

export async function createSchoolCalendarModule(input: {
  nameZh: string;
  nameEn: string;
  segmentId: string | null;
}): Promise<void> {
  const response = await fetch(apiUrl('/api/school-calendar/modules'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
}

export async function updateSchoolCalendarModule(
  id: string,
  input: { nameZh: string; nameEn: string; segmentId: string | null },
): Promise<void> {
  const response = await fetch(apiUrl(`/api/school-calendar/modules/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
}

export async function deleteSchoolCalendarModule(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/school-calendar/modules/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) await readError(response);
}

export async function saveSchoolCalendarTheme(input: { weekId: string; theme: string }): Promise<void> {
  const response = await fetch(apiUrl('/api/school-calendar/theme'), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
}

export async function importSchoolCalendar(
  academicYearId: string,
  payload: {
    weeks: Array<{
      row: number;
      monday: string;
      theme: string;
      sharedFocus: string;
      focuses: Array<{ moduleName: string; focus: string }>;
    }>;
    events: Array<{
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
    }> | null;
  },
): Promise<{ weekCount: number; eventCount: number; eventsReplaced: boolean }> {
  const response = await fetch(apiUrl('/api/school-calendar/import'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ academicYearId, ...payload }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: Array<{ row: number; sheet: 'month' | 'week'; code: string; detail?: string }>;
    weekCount?: number;
    eventCount?: number;
    eventsReplaced?: boolean;
  };
  if (!response.ok) {
    const error = new Error(data.error || 'internal') as Error & {
      issues?: Array<{ row: number; sheet: 'month' | 'week'; code: string; detail?: string }>;
    };
    error.issues = data.issues;
    throw error;
  }
  return {
    weekCount: data.weekCount ?? 0,
    eventCount: data.eventCount ?? 0,
    eventsReplaced: Boolean(data.eventsReplaced),
  };
}

export async function saveSchoolCalendarFocus(input: {
  weekId: string;
  moduleId: string;
  focus: string;
  sharedFocus?: string;
}): Promise<void> {
  const response = await fetch(apiUrl('/api/school-calendar/focus'), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
}

export async function createSchoolCalendarEvent(
  academicYearId: string,
  input: Omit<SchoolCalendarEvent, 'id' | 'weekId' | 'status'> & { status?: CalendarEventStatus },
): Promise<void> {
  const response = await fetch(apiUrl('/api/school-calendar/events'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ academicYearId, ...input }),
  });
  if (!response.ok) await readError(response);
}

export async function setSchoolCalendarEventStatus(id: string, status: CalendarEventStatus): Promise<void> {
  const response = await fetch(apiUrl(`/api/school-calendar/events/${encodeURIComponent(id)}/status`), {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!response.ok) await readError(response);
}

export async function updateSchoolCalendarEvent(id: string, input: Omit<SchoolCalendarEvent, 'id' | 'weekId'>): Promise<void> {
  const response = await fetch(apiUrl(`/api/school-calendar/events/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
}
