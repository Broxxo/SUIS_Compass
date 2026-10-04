import express, { type Request, type Response } from 'express';
import { getCnHolidayFeed } from '../lib/cnHolidayFeed.js';
import {
  createCalendarEvent,
  createCalendarModule,
  deleteCalendarModule,
  getSchoolCalendarBoard,
  importSchoolCalendar,
  isDate,
  resetCalendarSettings,
  saveCalendarSettings,
  saveDayOverride,
  saveWeekFocus,
  saveWeekTheme,
  updateCalendarEvent,
  updateCalendarModule,
  type CalendarEventStatus,
  type CalendarImportEvent,
  type CalendarImportWeek,
  type DayOverrideKind,
} from '../lib/schoolCalendar.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function statusFor(error: string | undefined): number {
  if (error === 'year_not_found' || error === 'not_found') return 404;
  if (error === 'forbidden' || error === 'past_locked') return 403;
  return 400;
}

function reject(res: Response, result: { error?: string }): boolean {
  if (!result.error) return false;
  fail(res, statusFor(result.error), result.error);
  return true;
}

router.get('/public-holidays', async (_req: ReqWithUserId, res: Response) => {
  try {
    return res.json(await getCnHolidayFeed());
  } catch (error) {
    console.error('school calendar holiday feed', error);
    return fail(res, 500, 'internal');
  }
});

router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const academicYearId = String(req.query.academicYearId ?? '').trim();
    if (!academicYearId) return fail(res, 400, 'year_required');
    const board = await getSchoolCalendarBoard(userId, academicYearId);
    if (reject(res, board)) return;
    return res.json(board);
  } catch (error) {
    console.error('school calendar board', error);
    return fail(res, 500, 'internal');
  }
});

router.put('/settings', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const academicYearId = String(body.academicYearId ?? '').trim();
    const saved = await saveCalendarSettings(userId, academicYearId, {
      firstSchoolDate: String(body.firstSchoolDate ?? ''),
      winterBreakStart: String(body.winterBreakStart ?? ''),
      springTermStart: String(body.springTermStart ?? ''),
      summerBreakStart: String(body.summerBreakStart ?? ''),
    });
    if (reject(res, saved)) return;
    return res.json(saved);
  } catch (error) {
    console.error('school calendar settings', error);
    return fail(res, 500, 'internal');
  }
});

router.post('/settings/reset', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const academicYearId = String((req.body as { academicYearId?: string } | undefined)?.academicYearId ?? '').trim();
    const saved = await resetCalendarSettings(userId, academicYearId);
    if (reject(res, saved)) return;
    return res.json(saved);
  } catch (error) {
    console.error('school calendar reset', error);
    return fail(res, 500, 'internal');
  }
});

router.put('/overrides', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as { academicYearId?: string; date?: string; kind?: string | null };
    const kindRaw = body.kind;
    const kind = kindRaw === 'makeup' || kindRaw === 'off' ? (kindRaw as DayOverrideKind) : null;
    if (kindRaw != null && kindRaw !== '' && kind == null) return fail(res, 400, 'invalid_date');
    const saved = await saveDayOverride(userId, String(body.academicYearId ?? '').trim(), String(body.date ?? ''), kind);
    if (reject(res, saved)) return;
    return res.json(saved);
  } catch (error) {
    console.error('school calendar override', error);
    return fail(res, 500, 'internal');
  }
});

router.post('/modules', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as { nameZh?: string; nameEn?: string; segmentId?: string | null };
    const created = await createCalendarModule(userId, {
      nameZh: String(body.nameZh ?? ''),
      nameEn: String(body.nameEn ?? ''),
      segmentId: body.segmentId ? String(body.segmentId) : null,
    });
    if (reject(res, created)) return;
    return res.json(created);
  } catch (error) {
    console.error('school calendar module create', error);
    return fail(res, 500, 'internal');
  }
});

router.patch('/modules/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as { nameZh?: string; nameEn?: string; segmentId?: string | null };
    const updated = await updateCalendarModule(userId, req.params.id, {
      nameZh: String(body.nameZh ?? ''),
      nameEn: String(body.nameEn ?? ''),
      segmentId: body.segmentId ? String(body.segmentId) : null,
    });
    if (reject(res, updated)) return;
    return res.json(updated);
  } catch (error) {
    console.error('school calendar module update', error);
    return fail(res, 500, 'internal');
  }
});

router.delete('/modules/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const deleted = await deleteCalendarModule(userId, req.params.id);
    if (reject(res, deleted)) return;
    return res.json(deleted);
  } catch (error) {
    console.error('school calendar module delete', error);
    return fail(res, 500, 'internal');
  }
});

router.put('/theme', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as { weekId?: string; theme?: string };
    const saved = await saveWeekTheme(userId, {
      weekId: String(body.weekId ?? ''),
      theme: String(body.theme ?? ''),
    });
    if (reject(res, saved)) return;
    return res.json(saved);
  } catch (error) {
    console.error('school calendar theme', error);
    return fail(res, 500, 'internal');
  }
});

router.post('/import', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as { academicYearId?: string; weeks?: unknown; events?: unknown };
    const academicYearId = String(body.academicYearId ?? '').trim();
    const weeks: CalendarImportWeek[] = Array.isArray(body.weeks)
      ? body.weeks.map((item, index) => {
          const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
          const focuses = Array.isArray(rec.focuses) ? rec.focuses : [];
          return {
            row: Number(rec.row) > 0 ? Number(rec.row) : index + 3,
            monday: String(rec.monday ?? ''),
            theme: String(rec.theme ?? ''),
            sharedFocus: String(rec.sharedFocus ?? ''),
            focuses: focuses.map((cell) => {
              const focus = cell && typeof cell === 'object' ? (cell as Record<string, unknown>) : {};
              return { moduleName: String(focus.moduleName ?? ''), focus: String(focus.focus ?? '') };
            }),
          };
        })
      : [];
    const events: CalendarImportEvent[] | null = body.events == null
      ? null
      : Array.isArray(body.events)
        ? body.events.map((item, index) => {
            const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            const names = Array.isArray(rec.participantNames) ? rec.participantNames.map(String) : [];
            return {
              row: Number(rec.row) > 0 ? Number(rec.row) : index + 3,
              eventDate: String(rec.eventDate ?? ''),
              moduleName: String(rec.moduleName ?? ''),
              startTime: String(rec.startTime ?? ''),
              endTime: String(rec.endTime ?? ''),
              title: String(rec.title ?? ''),
              location: String(rec.location ?? ''),
              ownerName: String(rec.ownerName ?? ''),
              participantNames: names,
              status: String(rec.status ?? ''),
              note: String(rec.note ?? ''),
            };
          })
        : null;
    const result = await importSchoolCalendar(userId, academicYearId, { weeks, events });
    if ('error' in result) {
      const status = result.error === 'year_not_found' ? 404 : result.error === 'forbidden' ? 403 : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('school calendar import', error);
    return fail(res, 500, 'internal');
  }
});

router.put('/focus', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as { weekId?: string; moduleId?: string; focus?: string; sharedFocus?: string };
    const saved = await saveWeekFocus(userId, {
      weekId: String(body.weekId ?? ''),
      moduleId: String(body.moduleId ?? ''),
      focus: String(body.focus ?? ''),
      ...(body.sharedFocus === undefined ? {} : { sharedFocus: String(body.sharedFocus) }),
    });
    if (reject(res, saved)) return;
    return res.json(saved);
  } catch (error) {
    console.error('school calendar focus', error);
    return fail(res, 500, 'internal');
  }
});

function readEventBody(body: Record<string, unknown>) {
  const participants = Array.isArray(body.participantIds) ? body.participantIds.map(String) : [];
  const statusRaw = String(body.status ?? 'planned');
  const status: CalendarEventStatus =
    statusRaw === 'done' || statusRaw === 'cancelled' || statusRaw === 'planned' ? statusRaw : 'planned';
  return {
    moduleId: String(body.moduleId ?? ''),
    eventDate: String(body.eventDate ?? ''),
    startTime: String(body.startTime ?? ''),
    endTime: String(body.endTime ?? ''),
    title: String(body.title ?? ''),
    location: String(body.location ?? ''),
    ownerUserId: body.ownerUserId ? String(body.ownerUserId) : null,
    participantIds: participants,
    status,
    note: String(body.note ?? ''),
  };
}

router.post('/events', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const academicYearId = String(body.academicYearId ?? '').trim();
    const input = readEventBody(body);
    if (!isDate(input.eventDate)) return fail(res, 400, 'invalid_date');
    const created = await createCalendarEvent(userId, academicYearId, input);
    if (reject(res, created)) return;
    return res.json(created);
  } catch (error) {
    console.error('school calendar event create', error);
    return fail(res, 500, 'internal');
  }
});

router.patch('/events/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const input = readEventBody((req.body ?? {}) as Record<string, unknown>);
    const updated = await updateCalendarEvent(userId, req.params.id, input);
    if (reject(res, updated)) return;
    return res.json(updated);
  } catch (error) {
    console.error('school calendar event update', error);
    return fail(res, 500, 'internal');
  }
});

export default router;
