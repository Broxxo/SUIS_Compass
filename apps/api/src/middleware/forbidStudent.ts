import type { Request, Response, NextFunction } from 'express';
import pool from '../config/database.js';

type ReqWithUserId = Request & { userId?: string };

/**
 * 学生登录账号仅允许访问学生画像相关接口；挂载在课程/AI/后台等路由上，禁止学生调用。
 */
export async function forbidStudentAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ext = req as ReqWithUserId;
  if (!ext.userId) {
    next();
    return;
  }
  try {
    const r = await pool.query('SELECT role FROM users WHERE id = $1', [ext.userId]);
    const role = r.rows[0]?.role as string | undefined;
    if (role === 'student') {
      res.status(403).json({ error: 'Forbidden: student accounts may only access student portrait data' });
      return;
    }
  } catch (e) {
    console.error('forbidStudentAccounts', e);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  next();
}
