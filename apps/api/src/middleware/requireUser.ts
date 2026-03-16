import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { JWT_SECRET } from '../config/auth.js';

type ReqWithUserId = Request & { userId?: string };

/**
 * 校验用户：优先 Authorization Bearer (JWT)，其次 X-User-Id（兼容过渡期）
 */
export async function requireValidUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const extendedReq = req as ReqWithUserId;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const legacyUserId = req.headers['x-user-id'] as string | undefined;

  if (token && JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      const result = await pool.query('SELECT id FROM users WHERE id = $1', [decoded.userId]);
      if (result.rows.length > 0) {
        extendedReq.userId = decoded.userId;
        next();
        return;
      }
    } catch {
      // token 无效，尝试 X-User-Id
    }
  }

  if (legacyUserId) {
    try {
      const result = await pool.query('SELECT id FROM users WHERE id = $1', [legacyUserId]);
      if (result.rows.length > 0) {
        extendedReq.userId = legacyUserId;
        next();
        return;
      }
    } catch (err) {
      console.error('requireValidUser error:', err);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}
