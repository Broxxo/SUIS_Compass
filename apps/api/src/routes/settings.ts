import express, { Request } from 'express';
import pool from '../config/database.js';

const router = express.Router();

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
}

router.get('/key-concepts', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query('SELECT key_concepts FROM user_settings WHERE user_id = $1', [uid]);
    if (result.rows.length === 0) return res.json([]);
    const keyConcepts = (result.rows[0] as Record<string, unknown>).key_concepts || [];
    res.json(keyConcepts);
  } catch (error) {
    console.error('Get key concepts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/key-concepts', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const { keyConcepts } = req.body;
    if (!Array.isArray(keyConcepts)) return res.status(400).json({ error: 'keyConcepts must be an array' });

    await pool.query(
      `INSERT INTO user_settings (user_id, key_concepts, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET key_concepts = $2, updated_at = CURRENT_TIMESTAMP`,
      [uid, JSON.stringify(keyConcepts)]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Save key concepts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
