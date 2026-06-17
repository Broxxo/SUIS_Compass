import express, { Request } from 'express';
import pool from '../config/database.js';
import { exportCurriculumFromDatabase, importCurriculumToDatabase } from '../lib/curriculumData.js';

const router = express.Router();

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
}

async function requireSystemAdmin(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const uid = userId(req);
  if (!uid) return { ok: false, status: 401, error: 'Unauthorized' };
  const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
  const role = roleResult.rows[0]?.role as string | undefined;
  if (role !== 'system-admin') {
    return { ok: false, status: 403, error: 'Forbidden: system-admin required' };
  }
  return { ok: true };
}

/** 从数据库导出全校课程管理数据（全量） */
router.get('/export', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const data = await exportCurriculumFromDatabase();
    res.json(data);
  } catch (error) {
    console.error('Curriculum export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 将课程管理数据写入数据库（覆盖全校课程与相关设置） */
router.post('/import', async (req, res) => {
  try {
    const auth = await requireSystemAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const uid = userId(req);
    const result = await importCurriculumToDatabase(req.body, uid);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Curriculum import error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.startsWith('Invalid import') || message.startsWith('Import payload') || message.startsWith('Import courses')) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
