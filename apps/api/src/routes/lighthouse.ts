import express, { type Request, type Response } from 'express';
import { loadLighthouseBoard, saveLighthouseBoard } from '../lib/lighthouse.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'unauthorized' });
    const board = await loadLighthouseBoard();
    return res.json({ board });
  } catch (error) {
    console.error('lighthouse get', error);
    return res.status(500).json({ error: 'internal' });
  }
});

router.put('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const board = await saveLighthouseBoard(userId, req.body?.board ?? req.body);
    return res.json({ board });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 403) return res.status(403).json({ error: 'forbidden' });
    console.error('lighthouse save', error);
    return res.status(500).json({ error: 'internal' });
  }
});

export default router;
