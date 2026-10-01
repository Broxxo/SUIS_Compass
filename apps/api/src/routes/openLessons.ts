/**
 * 公开课登记：全校教职工可读本学期表格。
 * 写权限：教职工只能登记自己所在学科组的课；学科组长还可登记本组组员；管理员可登记任何人。
 */
import express, { type Request, type Response } from 'express';
import {
  createOpenLesson,
  deleteOpenLesson,
  getOpenLessonBoard,
  isOpenLessonTerm,
  parseOpenLessonInput,
  updateOpenLesson,
} from '../lib/openLessons.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const academicYearId = String(req.query.academicYearId ?? '').trim();
    const term = String(req.query.term ?? '').trim();
    if (!academicYearId) return fail(res, 400, 'year_required');
    if (!isOpenLessonTerm(term)) return fail(res, 400, 'term_invalid');
    const board = await getOpenLessonBoard(userId, academicYearId, term);
    if ('error' in board) {
      const status = board.error === 'year_not_found' ? 404 : 403;
      return fail(res, status, board.error);
    }
    return res.json(board);
  } catch (error) {
    console.error('List open lessons error:', error);
    return fail(res, 500, 'internal');
  }
});

router.post('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const parsed = parseOpenLessonInput(req.body);
    if ('error' in parsed) return fail(res, 400, parsed.error);
    const created = await createOpenLesson(userId, parsed);
    if ('error' in created) {
      const status = created.error === 'year_not_found' ? 404 : created.error === 'assign_forbidden' ? 403 : 400;
      return fail(res, status, created.error);
    }
    return res.status(201).json({ lesson: created });
  } catch (error) {
    console.error('Create open lesson error:', error);
    return fail(res, 500, 'internal');
  }
});

router.put('/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const id = String(req.params.id ?? '').trim();
    if (!id) return fail(res, 400, 'not_found');
    const parsed = parseOpenLessonInput(req.body);
    if ('error' in parsed) return fail(res, 400, parsed.error);
    const updated = await updateOpenLesson(userId, id, parsed);
    if ('error' in updated) {
      const status =
        updated.error === 'not_found' ? 404 : updated.error === 'assign_forbidden' || updated.error === 'forbidden' ? 403 : 400;
      return fail(res, status, updated.error);
    }
    return res.json({ lesson: updated });
  } catch (error) {
    console.error('Update open lesson error:', error);
    return fail(res, 500, 'internal');
  }
});

router.delete('/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return fail(res, 401, 'unauthorized');
    const id = String(req.params.id ?? '').trim();
    if (!id) return fail(res, 400, 'not_found');
    const result = await deleteOpenLesson(userId, id);
    if ('error' in result) {
      const status = result.error === 'not_found' ? 404 : 403;
      return fail(res, status, result.error);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete open lesson error:', error);
    return fail(res, 500, 'internal');
  }
});

export default router;
