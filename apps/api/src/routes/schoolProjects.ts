import express, { type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import {
  claimSchoolProjectItem,
  createSchoolProject,
  createSchoolProjectItem,
  deleteSchoolProject,
  deleteSchoolProjectItem,
  importSchoolProjects,
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
  BINARY_UPLOAD_LIMITS,
  PROJECT_MODULE_KEY,
  absolutePathForStoredFile,
  createBinaryAsset,
  createTextAsset,
  deleteStoredFile,
  detectBinaryKind,
  getStoredFile,
  isBinaryStoredFileKind,
  listEntityFiles,
  updateTextAsset,
} from '../lib/storedFiles.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

/** multer 上限取各类别最大值；具体类型再按 BINARY_UPLOAD_LIMITS 校验 */
const UPLOAD_MAX_BYTES = Math.max(...Object.values(BINARY_UPLOAD_LIMITS));

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const kind = detectBinaryKind(file.originalname || '', file.mimetype || '');
    if (!kind) {
      cb(new Error('invalid_file_type'));
      return;
    }
    cb(null, true);
  },
});

function fail(res: Response, error: unknown, label: string) {
  const status = (error as { status?: number }).status;
  if (status === 400 || status === 403) return res.status(status).json({ error: (error as Error).message });
  const message = (error as Error).message;
  if (message === 'invalid_pdf' || message === 'invalid_file_type') {
    return res.status(400).json({ error: 'invalid_file_type' });
  }
  if (message === 'File too large' || message === 'file_too_large') {
    return res.status(400).json({ error: 'file_too_large' });
  }
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

/** 一次性导入多个项目（含子项目）。须放在 /:projectId 之前。 */
router.post('/import', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const projects = Array.isArray(body.projects) ? body.projects : Array.isArray(req.body) ? req.body : null;
    if (!projects) return res.status(400).json({ error: 'invalid_import' });
    const result = await importSchoolProjects(userId, projects);
    return res.json({
      ...result,
      projects: await listSchoolProjects(userId),
      staff: await listProjectStaff(),
    });
  } catch (error) {
    return fail(res, error, 'projects import');
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

/** 上传 PDF / DOC / DOCX（路径名保留 /pdf 以兼容旧前端） */
router.post('/:projectId/preview/pdf', (req: ReqWithUserId, res: Response) => {
  fileUpload.single('file')(req, res, async (err: unknown) => {
    try {
      if (err) return fail(res, err, 'project file upload');
      const userId = requireUser(req, res);
      if (!userId) return;
      const projectId = String(req.params.projectId ?? '').trim();
      if (!(await userCanEditItems(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
      const file = (req as ReqWithUserId & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: 'missing_file' });
      const { decodeUploadFilename } = await import('../lib/uploadFilename.js');
      const originalName = decodeUploadFilename(file.originalname);
      const kind = detectBinaryKind(originalName, file.mimetype || '');
      if (!kind) return res.status(400).json({ error: 'invalid_file_type' });
      if (file.buffer.length > BINARY_UPLOAD_LIMITS[kind]) {
        return res.status(400).json({ error: 'file_too_large' });
      }
      const asset = await createBinaryAsset({
        moduleKey: PROJECT_MODULE_KEY,
        entityId: projectId,
        userId,
        originalName,
        mimeType: file.mimetype || '',
        buffer: file.buffer,
        title: decodeUploadFilename(String(req.body?.title ?? '')),
        kind,
      });
      return res.json({ asset, assets: await listEntityFiles(PROJECT_MODULE_KEY, projectId) });
    } catch (error) {
      return fail(res, error, 'project file create');
    }
  });
});

/** Word 在线阅读：返回 HTML（docx 用 mammoth；doc 抽正文） */
router.get('/:projectId/preview/:assetId/html', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    const assetId = String(req.params.assetId ?? '').trim();
    if (!(await userCanViewProject(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const existing = await getStoredFile(assetId);
    if (
      !existing ||
      existing.moduleKey !== PROJECT_MODULE_KEY ||
      existing.entityId !== projectId ||
      (existing.kind !== 'doc' && existing.kind !== 'docx')
    ) {
      return res.status(404).json({ error: 'not_found' });
    }
    const abs = absolutePathForStoredFile(existing);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'file_missing' });
    const buffer = fs.readFileSync(abs);
    const { renderWordBufferToHtml } = await import('../lib/wordPreview.js');
    const preview = await renderWordBufferToHtml(existing.kind, buffer);
    return res.json({
      id: existing.id,
      title: existing.title,
      originalName: existing.originalName,
      ...preview,
    });
  } catch (error) {
    return fail(res, error, 'project word html');
  }
});

router.get('/:projectId/preview/:assetId/file', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = String(req.params.projectId ?? '').trim();
    const assetId = String(req.params.assetId ?? '').trim();
    if (!(await userCanViewProject(projectId, userId))) return res.status(403).json({ error: 'forbidden' });
    const existing = await getStoredFile(assetId);
    if (
      !existing ||
      existing.moduleKey !== PROJECT_MODULE_KEY ||
      existing.entityId !== projectId ||
      !isBinaryStoredFileKind(existing.kind)
    ) {
      return res.status(404).json({ error: 'not_found' });
    }
    const abs = absolutePathForStoredFile(existing);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'file_missing' });
    const fallbackName =
      existing.kind === 'pdf' ? 'document.pdf' : existing.kind === 'docx' ? 'document.docx' : 'document.doc';
    res.setHeader('Content-Type', existing.mimeType || 'application/octet-stream');
    // PDF 可内嵌预览；Word 下载用附件，在线阅读走 /html 或前端 docx-preview
    const disposition = existing.kind === 'pdf' ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(existing.originalName || fallbackName)}`,
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
