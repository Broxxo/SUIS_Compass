import express, { type Request, type Response } from 'express';
import {
  claimSchoolProjectItem,
  createSchoolProject,
  createSchoolProjectItem,
  deleteSchoolProject,
  deleteSchoolProjectItem,
  listProjectStaff,
  listSchoolProjects,
  parseItemInput,
  parseProjectInput,
  updateSchoolProject,
  updateSchoolProjectItem,
  userCanEditItems,
  userLeadsProject,
} from '../lib/schoolProjects.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

function fail(res: Response, error: unknown, label: string) {
  const status = (error as { status?: number }).status;
  if (status === 400) return res.status(400).json({ error: (error as Error).message });
  console.error(label, error);
  return res.status(500).json({ error: 'internal' });
}

function requireUser(req: ReqWithUserId, res: Response): string | null {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return userId;
}

router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const [projects, staff] = await Promise.all([listSchoolProjects(userId), listProjectStaff()]);
    return res.json({ projects, staff });
  } catch (error) {
    return fail(res, error, 'projects list');
  }
});

router.post('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    await createSchoolProject(userId, parseProjectInput(req.body));
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'projects create');
  }
});

router.put('/:projectId', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    if (!(await userLeadsProject(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const ok = await updateSchoolProject(projectId, userId, parseProjectInput(req.body));
    if (!ok) return res.status(404).json({ error: 'not_found' });
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'projects update');
  }
});

router.delete('/:projectId', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    const ok = await deleteSchoolProject(projectId, userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'projects delete');
  }
});

router.post('/:projectId/items', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const ok = await createSchoolProjectItem(projectId, userId, parseItemInput(req.body));
    if (!ok) return res.status(404).json({ error: 'not_found' });
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'project item create');
  }
});

router.post('/:projectId/items/:itemId/claim', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const ok = await claimSchoolProjectItem(
      String(req.params.projectId ?? '').trim(),
      String(req.params.itemId ?? '').trim(),
      userId,
    );
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'project item claim');
  }
});

router.put('/:projectId/items/:itemId', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const ok = await updateSchoolProjectItem(projectId, String(req.params.itemId ?? '').trim(), userId, parseItemInput(req.body));
    if (!ok) return res.status(404).json({ error: 'not_found' });
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'project item update');
  }
});

router.delete('/:projectId/items/:itemId', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const ok = await deleteSchoolProjectItem(
      String(req.params.projectId ?? '').trim(),
      String(req.params.itemId ?? '').trim(),
      userId,
    );
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    return res.json({ projects: await listSchoolProjects(userId) });
  } catch (error) {
    return fail(res, error, 'project item delete');
  }
});

export default router;
