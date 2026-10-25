import express, { type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
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
  userCanEditProject,
  userCanViewProject,
} from '../lib/schoolProjects.js';
import {
  PROJECT_MODULE_KEY,
  absolutePathForStoredFile,
  createPdfAsset,
  createTextAsset,
  deleteStoredFile,
  getStoredFile,
  listEntityFiles,
  updateTextAsset,
} from '../lib/storedFiles.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

const PDF_MAX_BYTES = 50 * 1024 * 1024;

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf' ||
      name.endsWith('.pdf');
    if (!ok) {
      cb(new Error('invalid_pdf'));
      return;
    }
    cb(null, true);
  },
});

function fail(res: Response, error: unknown, label: string) {
  const status = (error as { status?: number }).status;
  if (status === 400 || status === 403) return res.status(status).json({ error: (error as Error).message });
  if ((error as Error).message === 'invalid_pdf') return res.status(400).json({ error: 'invalid_pdf' });
  if ((error as Error).message === 'File too large') return res.status(400).json({ error: 'file_too_large' });
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
    if (!(await userCanEditProject(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
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

router.get('/:projectId/preview', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    if (!(await userCanViewProject(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const assets = await listEntityFiles(PROJECT_MODULE_KEY, projectId);
    return res.json({
      assets,
      canEdit: await userCanEditItems(projectId, userId),
    });
  } catch (error) {
    return fail(res, error, 'project preview list');
  }
});

router.post('/:projectId/preview/text', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const asset = await createTextAsset({
      moduleKey: PROJECT_MODULE_KEY,
      entityId: projectId,
      title: String(req.body?.title ?? ''),
      bodyText: String(req.body?.bodyText ?? req.body?.text ?? ''),
      userId,
    });
    return res.json({ asset, assets: await listEntityFiles(PROJECT_MODULE_KEY, projectId) });
  } catch (error) {
    return fail(res, error, 'project preview text create');
  }
});

router.put('/:projectId/preview/:assetId', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    const assetId = String(req.params.assetId ?? '').trim();
    if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const existing = await getStoredFile(assetId);
    if (!existing || existing.moduleKey !== PROJECT_MODULE_KEY || existing.entityId !== projectId) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (existing.kind !== 'text') return res.status(400).json({ error: 'not_text' });
    const asset = await updateTextAsset(assetId, userId, {
      title: String(req.body?.title ?? ''),
      bodyText: String(req.body?.bodyText ?? req.body?.text ?? ''),
    });
    return res.json({ asset, assets: await listEntityFiles(PROJECT_MODULE_KEY, projectId) });
  } catch (error) {
    return fail(res, error, 'project preview text update');
  }
});

router.post('/:projectId/preview/pdf', (req: ReqWithUserId, res: Response) => {
  pdfUpload.single('file')(req, res, async (err: unknown) => {
    try {
      if (err) return fail(res, err, 'project preview pdf upload');
      const userId = requireUser(req, res);
      if (!userId) return;
      const projectId = String(req.params.projectId ?? '').trim();
      if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
      const file = (req as ReqWithUserId & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: 'missing_file' });
      const { decodeUploadFilename } = await import('../lib/uploadFilename.js');
      const asset = await createPdfAsset({
        moduleKey: PROJECT_MODULE_KEY,
        entityId: projectId,
        userId,
        originalName: decodeUploadFilename(file.originalname),
        mimeType: file.mimetype || 'application/pdf',
        buffer: file.buffer,
        title: decodeUploadFilename(String(req.body?.title ?? '')),
      });
      return res.json({ asset, assets: await listEntityFiles(PROJECT_MODULE_KEY, projectId) });
    } catch (error) {
      return fail(res, error, 'project preview pdf create');
    }
  });
});

router.get('/:projectId/preview/:assetId/file', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    const assetId = String(req.params.assetId ?? '').trim();
    if (!(await userCanViewProject(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const existing = await getStoredFile(assetId);
    if (!existing || existing.moduleKey !== PROJECT_MODULE_KEY || existing.entityId !== projectId || existing.kind !== 'pdf') {
      return res.status(404).json({ error: 'not_found' });
    }
    const abs = absolutePathForStoredFile(existing);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'file_missing' });
    res.setHeader('Content-Type', existing.mimeType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(existing.originalName || 'document.pdf')}`,
    );
    return fs.createReadStream(abs).pipe(res);
  } catch (error) {
    return fail(res, error, 'project preview file');
  }
});

router.delete('/:projectId/preview/:assetId', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    const assetId = String(req.params.assetId ?? '').trim();
    if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const existing = await getStoredFile(assetId);
    if (!existing || existing.moduleKey !== PROJECT_MODULE_KEY || existing.entityId !== projectId) {
      return res.status(404).json({ error: 'not_found' });
    }
    await deleteStoredFile(assetId);
    return res.json({ assets: await listEntityFiles(PROJECT_MODULE_KEY, projectId) });
  } catch (error) {
    return fail(res, error, 'project preview delete');
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
