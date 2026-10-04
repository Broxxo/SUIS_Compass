import express, { type Request, type Response } from 'express';
import {
  createMailboxMessage,
  deleteMailboxMessage,
  listMailboxMessages,
  replyToMailboxMessage,
  setMailboxStatus,
  updateMailboxMessage,
} from '../lib/mailbox.js';

type ReqWithUserId = Request & { userId?: string };

const router = express.Router();

router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    return res.json(await listMailboxMessages(userId));
  } catch (error) {
    console.error('mailbox list', error);
    return res.status(500).json({ error: 'internal' });
  }
});

router.post('/', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const body = String((req.body as { body?: unknown } | undefined)?.body ?? '');
    const created = await createMailboxMessage(userId, body);
    if ('error' in created) return res.status(400).json({ error: created.error });
    return res.status(201).json(created.message);
  } catch (error) {
    console.error('mailbox create', error);
    return res.status(500).json({ error: 'internal' });
  }
});

router.put('/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const body = String((req.body as { body?: unknown } | undefined)?.body ?? '');
    const saved = await updateMailboxMessage(userId, req.params.id, body);
    if ('error' in saved) {
      const status = saved.error === 'not_found' ? 404 : saved.error === 'forbidden' ? 403 : 400;
      return res.status(status).json({ error: saved.error });
    }
    return res.json(saved);
  } catch (error) {
    console.error('mailbox update', error);
    return res.status(500).json({ error: 'internal' });
  }
});

router.delete('/:id', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const removed = await deleteMailboxMessage(userId, req.params.id);
    if ('error' in removed) {
      const status = removed.error === 'not_found' ? 404 : 403;
      return res.status(status).json({ error: removed.error });
    }
    return res.json(removed);
  } catch (error) {
    console.error('mailbox delete', error);
    return res.status(500).json({ error: 'internal' });
  }
});

router.post('/:id/replies', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const body = String((req.body as { body?: unknown } | undefined)?.body ?? '');
    const created = await replyToMailboxMessage(userId, req.params.id, body);
    if ('error' in created) {
      const status = created.error === 'not_found' ? 404 : created.error === 'forbidden' ? 403 : 400;
      return res.status(status).json({ error: created.error });
    }
    return res.status(201).json(created.reply);
  } catch (error) {
    console.error('mailbox reply', error);
    return res.status(500).json({ error: 'internal' });
  }
});

router.put('/:id/status', async (req: ReqWithUserId, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const status = String((req.body as { status?: unknown } | undefined)?.status ?? '');
    const saved = await setMailboxStatus(userId, req.params.id, status);
    if ('error' in saved) {
      const code = saved.error === 'not_found' ? 404 : saved.error === 'forbidden' ? 403 : 400;
      return res.status(code).json({ error: saved.error });
    }
    return res.json(saved);
  } catch (error) {
    console.error('mailbox status', error);
    return res.status(500).json({ error: 'internal' });
  }
});

export default router;
