/**
 * 课堂助手 API：分组方案、小组、成员、积分事件（全校共享，与班级管理一致）
 * 教师可读写自己班级的数据，管理员可读写全部
 */
import express, { type Request, type Response } from 'express';
import pool from '../config/database.js';

type ReqWithUserId = Request & { userId?: string };

async function canAccessClass(userId: string | undefined, classId: string): Promise<boolean> {
  if (!userId) return false;
  const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  if (roleResult.rows.length === 0) return false;
  const role = roleResult.rows[0].role as string;
  if (role === 'system-admin' || role === 'admin') return true;
  const classResult = await pool.query('SELECT teacher_id FROM classes WHERE id = $1', [classId]);
  if (classResult.rows.length === 0) return false;
  return classResult.rows[0].teacher_id === userId;
}

const router = express.Router();

// ---------- 分组方案 ----------
router.get('/schemes', async (req: ReqWithUserId, res: Response) => {
  try {
    const classId = req.query.classId as string;
    if (!classId) {
      res.status(400).json({ error: 'classId required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    const result = await pool.query(
      'SELECT id, class_id, name, scope, subject, created_at, updated_at FROM class_group_schemes WHERE class_id = $1 ORDER BY created_at ASC',
      [classId]
    );
    const schemes = result.rows.map((r) => ({
      id: r.id,
      classId: r.class_id,
      name: r.name,
      scope: r.scope,
      subject: r.subject ?? null,
      createdAt: r.created_at?.toISOString?.() ?? new Date(r.created_at).toISOString(),
      updatedAt: r.updated_at?.toISOString?.() ?? new Date(r.updated_at).toISOString(),
    }));
    res.json({ schemes });
  } catch (e) {
    console.error('get class assistant schemes', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/schemes', async (req: ReqWithUserId, res: Response) => {
  try {
    const { id, classId, name, scope, subject, createdAt, updatedAt } = req.body || {};
    if (!id || !classId || !name) {
      res.status(400).json({ error: 'id, classId, name required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    const now = new Date().toISOString();
    const created = createdAt || now;
    const updated = updatedAt || now;
    await pool.query(
      `INSERT INTO class_group_schemes (id, class_id, name, scope, subject, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET name = $3, scope = $4, subject = $5, updated_at = $7`,
      [id, classId, name, scope || 'class-default', subject || null, created, updated]
    );
    res.status(201).json({
      id,
      classId,
      name,
      scope: scope || 'class-default',
      subject: subject ?? null,
      createdAt: created,
      updatedAt: updated,
    });
  } catch (e) {
    console.error('post class assistant scheme', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/schemes/:schemeId', async (req: ReqWithUserId, res: Response) => {
  try {
    const { schemeId } = req.params;
    const schemeResult = await pool.query('SELECT class_id FROM class_group_schemes WHERE id = $1', [schemeId]);
    if (schemeResult.rows.length === 0) {
      res.status(404).json({ error: 'Scheme not found' });
      return;
    }
    const classId = schemeResult.rows[0].class_id;
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    await pool.query('DELETE FROM class_point_events WHERE scheme_id = $1', [schemeId]);
    await pool.query('DELETE FROM class_group_members WHERE scheme_id = $1', [schemeId]);
    await pool.query('DELETE FROM class_groups WHERE scheme_id = $1', [schemeId]);
    await pool.query('DELETE FROM class_group_schemes WHERE id = $1', [schemeId]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete class assistant scheme', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 小组 ----------
router.get('/groups', async (req: ReqWithUserId, res: Response) => {
  try {
    const classId = req.query.classId as string;
    const schemeId = req.query.schemeId as string;
    if (!classId || !schemeId) {
      res.status(400).json({ error: 'classId and schemeId required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    const result = await pool.query(
      'SELECT id, class_id, scheme_id, name, scope, subject, created_at, updated_at FROM class_groups WHERE class_id = $1 AND scheme_id = $2 ORDER BY created_at ASC',
      [classId, schemeId]
    );
    const groups = result.rows.map((r) => ({
      id: r.id,
      classId: r.class_id,
      schemeId: r.scheme_id,
      name: r.name,
      scope: r.scope,
      subject: r.subject ?? null,
      createdAt: r.created_at?.toISOString?.() ?? new Date(r.created_at).toISOString(),
      updatedAt: r.updated_at?.toISOString?.() ?? new Date(r.updated_at).toISOString(),
    }));
    res.json({ groups });
  } catch (e) {
    console.error('get class assistant groups', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/groups', async (req: ReqWithUserId, res: Response) => {
  try {
    const { classId, schemeId, groups } = req.body || {};
    if (!classId || !schemeId || !Array.isArray(groups)) {
      res.status(400).json({ error: 'classId, schemeId, groups (array) required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    await pool.query('DELETE FROM class_groups WHERE class_id = $1 AND scheme_id = $2', [classId, schemeId]);
    for (const g of groups) {
      const { id, name, scope, subject, createdAt, updatedAt } = g;
      if (!id || !name) continue;
      const now = new Date().toISOString();
      await pool.query(
        `INSERT INTO class_groups (id, class_id, scheme_id, name, scope, subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, classId, schemeId, name, scope || 'class-default', subject ?? null, createdAt || now, updatedAt || now]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('put class assistant groups', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 小组成员 ----------
router.get('/members', async (req: ReqWithUserId, res: Response) => {
  try {
    const classId = req.query.classId as string;
    const schemeId = req.query.schemeId as string;
    if (!classId || !schemeId) {
      res.status(400).json({ error: 'classId and schemeId required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    const result = await pool.query(
      'SELECT id, class_id, scheme_id, group_id, student_id, joined_at, left_at FROM class_group_members WHERE class_id = $1 AND scheme_id = $2 ORDER BY joined_at ASC',
      [classId, schemeId]
    );
    const members = result.rows.map((r) => ({
      id: r.id,
      classId: r.class_id,
      schemeId: r.scheme_id,
      groupId: r.group_id,
      studentId: r.student_id,
      joinedAt: r.joined_at?.toISOString?.() ?? new Date(r.joined_at).toISOString(),
      leftAt: r.left_at ? (r.left_at?.toISOString?.() ?? new Date(r.left_at).toISOString()) : null,
    }));
    res.json({ members });
  } catch (e) {
    console.error('get class assistant members', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/members', async (req: ReqWithUserId, res: Response) => {
  try {
    const { classId, schemeId, members } = req.body || {};
    if (!classId || !schemeId || !Array.isArray(members)) {
      res.status(400).json({ error: 'classId, schemeId, members (array) required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    await pool.query('DELETE FROM class_group_members WHERE class_id = $1 AND scheme_id = $2', [classId, schemeId]);
    for (const m of members) {
      const { id, groupId, studentId, joinedAt, leftAt } = m;
      if (!id || !groupId || !studentId) continue;
      const joined = joinedAt ? new Date(joinedAt) : new Date();
      const left = leftAt ? new Date(leftAt) : null;
      await pool.query(
        `INSERT INTO class_group_members (id, class_id, scheme_id, group_id, student_id, joined_at, left_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, classId, schemeId, groupId, studentId, joined, left]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('put class assistant members', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 积分事件 ----------
router.get('/point-events', async (req: ReqWithUserId, res: Response) => {
  try {
    const classId = req.query.classId as string;
    const schemeId = req.query.schemeId as string | undefined;
    if (!classId) {
      res.status(400).json({ error: 'classId required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    let sql = 'SELECT id, class_id, scheme_id, type, student_id, group_id, delta, reason, created_at FROM class_point_events WHERE class_id = $1';
    const params: string[] = [classId];
    if (schemeId !== undefined && schemeId !== null && schemeId !== '') {
      sql += ' AND (scheme_id = $2 OR (type = \'individual\' AND scheme_id IS NULL))';
      params.push(schemeId);
    }
    sql += ' ORDER BY created_at ASC';
    const result = await pool.query(sql, params);
    const events = result.rows.map((r) => ({
      id: r.id,
      classId: r.class_id,
      schemeId: r.scheme_id ?? null,
      type: r.type,
      studentId: r.student_id ?? null,
      groupId: r.group_id ?? null,
      delta: r.delta,
      reason: r.reason ?? null,
      createdAt: r.created_at?.toISOString?.() ?? new Date(r.created_at).toISOString(),
    }));
    res.json({ events });
  } catch (e) {
    console.error('get class assistant point-events', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/point-events', async (req: ReqWithUserId, res: Response) => {
  try {
    const events = Array.isArray(req.body) ? req.body : req.body?.events ? req.body.events : [req.body];
    if (!events.length) {
      res.status(400).json({ error: 'event(s) required' });
      return;
    }
    for (const e of events) {
      const { id, classId, schemeId, type, studentId, groupId, delta, reason, createdAt } = e;
      if (!id || !classId || !type || delta == null) continue;
      const ok = await canAccessClass(req.userId, classId);
      if (!ok) {
        res.status(403).json({ error: 'Forbidden: no access to this class' });
        return;
      }
      const created = createdAt ? new Date(createdAt) : new Date();
      await pool.query(
        `INSERT INTO class_point_events (id, class_id, scheme_id, type, student_id, group_id, delta, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [id, classId, schemeId ?? null, type, studentId ?? null, groupId ?? null, Number(delta), reason ?? null, created]
      );
    }
    res.status(201).json({ success: true });
  } catch (e) {
    console.error('post class assistant point-events', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/point-events', async (req: ReqWithUserId, res: Response) => {
  try {
    const { classId, events } = req.body || {};
    if (!classId || !Array.isArray(events)) {
      res.status(400).json({ error: 'classId, events (array) required' });
      return;
    }
    const ok = await canAccessClass(req.userId, classId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: no access to this class' });
      return;
    }
    await pool.query('DELETE FROM class_point_events WHERE class_id = $1', [classId]);
    for (const e of events) {
      const { id, schemeId, type, studentId, groupId, delta, reason, createdAt } = e;
      if (!id || !type || delta == null) continue;
      const created = createdAt ? new Date(createdAt) : new Date();
      await pool.query(
        `INSERT INTO class_point_events (id, class_id, scheme_id, type, student_id, group_id, delta, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, classId, schemeId ?? null, type, studentId ?? null, groupId ?? null, Number(delta), reason ?? null, created]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('put class assistant point-events', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
