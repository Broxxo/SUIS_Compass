import express, { type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/database.js';

const router = express.Router();

interface AuthedRequest extends Request {
  userId?: string;
}

const VALID_ROLES = ['system-admin', 'admin', 'teacher'] as const;

let ensuredUsersStudentIdColumn = false;
async function ensureUsersStudentIdColumn(): Promise<void> {
  if (ensuredUsersStudentIdColumn) return;
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(50)');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id_unique ON users(student_id) WHERE student_id IS NOT NULL',
  );
  try {
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
    `);
  } catch {
    /* constraint may already exist */
  }
  ensuredUsersStudentIdColumn = true;
}

function randomSixDigitPassword(): string {
  return String(crypto.randomInt(100000, 1000000));
}

// 仅允许 system-admin 或 admin 访问本路由
async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const role = result.rows[0].role as string;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin panel access required' });
    }
    return next();
  } catch (error) {
    console.error('requireAdmin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

router.use(requireAdmin);

// 获取用户列表：scope=staff（默认）| students；学生账号列表供管理员与系统管理员查看
router.get('/users', async (req: AuthedRequest, res: Response) => {
  try {
    await ensureUsersStudentIdColumn();
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;
    const scope = (req.query.scope as string) === 'students' ? 'students' : 'staff';

    if (scope === 'students') {
      const result = await pool.query(
        `SELECT u.id, u.username, u.role, u.display_name, u.password, u.department, u.student_id, u.created_at,
                s.name_zh, s.name_en
         FROM users u
         LEFT JOIN students s ON s.id = u.student_id
         WHERE u.role = 'student'
         ORDER BY u.created_at DESC NULLS LAST, u.username ASC`,
      );
      const users = result.rows.map((row) => ({
        id: row.id as string,
        username: row.username as string,
        role: row.role as string,
        displayName: (row.display_name as string) ?? '',
        password: (row.password as string | null) ?? null,
        department: (row.department as string | null) ?? null,
        studentId: (row.student_id as string | null) ?? null,
        studentNameZh: (row.name_zh as string | null) ?? null,
        studentNameEn: (row.name_en as string | null) ?? null,
        createdAt: (row.created_at as Date | null)?.toISOString() ?? undefined,
      }));
      return res.json({ users });
    }

    let result;
    if (callerRole === 'system-admin') {
      result = await pool.query(
        "SELECT id, username, role, display_name, password, department, created_at FROM users WHERE role IN ('admin', 'teacher') ORDER BY created_at DESC, username ASC",
      );
    } else {
      result = await pool.query(
        "SELECT id, username, role, display_name, password, department, created_at FROM users WHERE role = 'teacher' ORDER BY created_at DESC, username ASC",
      );
    }
    const users = result.rows.map((row) => ({
      id: row.id as string,
      username: row.username as string,
      role: row.role as string,
      displayName: (row.display_name as string) ?? '',
      password: (row.password as string | null) ?? null,
      department: (row.department as string | null) ?? null,
      createdAt: (row.created_at as Date | null)?.toISOString() ?? undefined,
    }));
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 批量开通学生登录：学号作 username，随机6 位数字密码（bcrypt 存储）
router.post('/users/import-student-accounts', async (req: AuthedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureUsersStudentIdColumn();
    const body = req.body as {
      items?: Array<{ studentId: string; password: string }>;
    };
    const items = Array.isArray(body.items) ? body.items : [];

    const created: Array<{ studentId: string; username: string; password: string; displayName: string; userId: string }> = [];
    const skipped: Array<{ studentId: string; reason: string }> = [];

    let rows: Array<{ id: string; student_number: string; name: string; name_zh: string | null; name_en: string | null }>;
    if (items.length === 0) {
      const r = await client.query(
        `SELECT id, student_number, name, name_zh, name_en FROM students
         WHERE student_number IS NOT NULL AND TRIM(student_number) <> ''`,
      );
      rows = r.rows as typeof rows;
    } else {
      const idSet = new Set(items.map((i) => i.studentId));
      const r = await client.query(
        `SELECT id, student_number, name, name_zh, name_en FROM students
         WHERE id = ANY($1::varchar[])`,
        [Array.from(idSet)],
      );
      rows = r.rows as typeof rows;
      for (const it of items) {
        if (!rows.some((row) => row.id === it.studentId)) {
          skipped.push({ studentId: it.studentId, reason: 'student_not_found' });
        }
      }
    }

    await client.query('BEGIN');
    for (const s of rows) {
      const uname = String(s.student_number).trim();
      if (!uname) {
        skipped.push({ studentId: s.id, reason: 'empty_student_number' });
        continue;
      }
      const dup = await client.query(
        `SELECT id FROM users WHERE student_id = $1 OR LOWER(TRIM(username)) = LOWER(TRIM($2)) LIMIT 1`,
        [s.id, uname],
      );
      if (dup.rows.length > 0) {
        skipped.push({ studentId: s.id, reason: 'account_or_username_exists' });
        continue;
      }
      let plain: string;
      if (items.length > 0) {
        const it = items.find((x) => x.studentId === s.id);
        if (!it?.password || !/^\d{6}$/.test(it.password)) {
          skipped.push({ studentId: s.id, reason: 'invalid_password' });
          continue;
        }
        plain = it.password;
      } else {
        plain = randomSixDigitPassword();
      }
      const hash = await bcrypt.hash(plain, 10);
      const displayName = String(s.name_zh || s.name_en || s.name || uname).trim() || uname;
      const newId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await client.query(
        `INSERT INTO users (id, username, display_name, role, password_hash, password, student_id, department, created_at, updated_at)
         VALUES ($1, $2, $3, 'student', $4, $5, $6, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [newId, uname, displayName, hash, plain, s.id],
      );
      created.push({ studentId: s.id, username: uname, password: plain, displayName, userId: newId });
    }
    await client.query('COMMIT');
    res.status(201).json({ created, skipped });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import student accounts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 创建新用户：system-admin 可创建管理员或教师，admin 仅可创建教师
router.post('/users', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { username, displayName, role, password, department } = req.body as {
      username?: string;
      displayName?: string;
      role?: string;
      password?: string;
      department?: string | null;
    };

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password and role are required' });
    }

    if (!VALID_ROLES.includes(role as any)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (callerRole === 'system-admin' && role === 'system-admin') {
      return res.status(403).json({ error: 'Cannot create system-admin via panel' });
    }
    if (callerRole === 'admin' && role !== 'teacher') {
      return res.status(403).json({ error: 'Admin can only create teacher accounts' });
    }

    const existing = await pool.query('SELECT 1 FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const dept = department && String(department).trim() ? String(department).trim() : null;
    const newId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const result = await pool.query(
      'INSERT INTO users (id, username, display_name, role, password_hash, password, department, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id, username, role, display_name, password, department, created_at',
      [newId, username.trim(), (displayName ?? username).trim(), role, hash, password, dept],
    );

    const row = result.rows[0] as {
      id: string;
      username: string;
      role: string;
      display_name: string | null;
      password: string | null;
      department: string | null;
      created_at: Date | null;
    };

    res.status(201).json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        displayName: row.display_name ?? '',
        password: row.password ?? password,
        department: row.department ?? null,
        createdAt: row.created_at?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 删除用户：system-admin 可删管理员/教师，admin 仅可删教师；需 body 中 confirmUsername
router.delete('/users/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { id } = req.params;
    const { confirmUsername } = req.body as { confirmUsername?: string };
    if (!confirmUsername || typeof confirmUsername !== 'string') {
      return res.status(400).json({ error: 'confirmUsername is required in body' });
    }
    const getResult = await pool.query('SELECT username, role FROM users WHERE id = $1', [id]);
    if (getResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = getResult.rows[0] as { username: string; role: string };
    if (row.username !== confirmUsername) {
      return res.status(400).json({ error: 'Username does not match' });
    }
    if (row.role === 'system-admin') {
      return res.status(403).json({ error: 'Cannot delete system-admin' });
    }
    if (callerRole === 'admin' && row.role !== 'teacher' && row.role !== 'student') {
      return res.status(403).json({ error: 'Admin can only delete teacher or student accounts' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新单个用户部门
router.patch('/users/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { id } = req.params;
    const { department } = req.body as { department?: string | null };
    const dept = department === undefined ? undefined : (department == null || String(department).trim() === '' ? null : String(department).trim());
    if (dept === undefined) {
      return res.status(400).json({ error: 'department is required' });
    }
    const targetResult = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const targetRole = targetResult.rows[0].role as string;
    if (targetRole === 'student') {
      return res.status(403).json({ error: 'Student accounts have no department; remove the login account to revoke access' });
    }
    if (callerRole === 'admin' && targetRole !== 'teacher') {
      return res.status(403).json({ error: 'Admin can only update teacher accounts' });
    }
    const result = await pool.query(
      'UPDATE users SET department = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, username, role, display_name, department, created_at',
      [dept, id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = result.rows[0] as { id: string; username: string; role: string; display_name: string | null; department: string | null; created_at: Date | null };
    res.json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        displayName: row.display_name ?? '',
        department: row.department ?? null,
        createdAt: row.created_at?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Patch user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新用户角色：仅系统管理员可操作，可将管理员与教师互改
router.put('/users/:id/role', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;
    if (callerRole !== 'system-admin') {
      return res.status(403).json({ error: 'Only system admin can change roles' });
    }

    const { id } = req.params;
    const { role: newRole } = req.body as { role?: string };
    if (!newRole || !['admin', 'teacher'].includes(newRole)) {
      return res.status(400).json({ error: 'role must be admin or teacher' });
    }

    const targetResult = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const targetRole = targetResult.rows[0].role as string;
    if (targetRole === 'system-admin') {
      return res.status(403).json({ error: 'Cannot change system-admin role' });
    }
    if (targetRole === 'student') {
      return res.status(403).json({ error: 'Cannot change student role via this endpoint' });
    }

    await pool.query('UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newRole, id]);
    res.json({ success: true, role: newRole });
  } catch (error) {
    console.error('Put role error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 批量设置用户部门
router.post('/users/batch-department', async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.userId!;
    const callerResult = await pool.query('SELECT role FROM users WHERE id = $1', [callerId]);
    const callerRole = callerResult.rows[0]?.role as string;

    const { userIds, department } = req.body as { userIds?: string[]; department?: string | null };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required and non-empty' });
    }
    let idsToUpdate = userIds;
    if (callerRole === 'admin') {
      const roleResult = await pool.query(
        "SELECT id FROM users WHERE id = ANY($1) AND role = 'teacher'",
        [userIds],
      );
      idsToUpdate = roleResult.rows.map((r) => r.id as string);
    }
    if (idsToUpdate.length === 0) {
      return res.status(403).json({ error: 'Admin can only update teacher accounts' });
    }
    const dept = department == null || String(department).trim() === '' ? null : String(department).trim();
    await pool.query(
      'UPDATE users SET department = $1, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($2)',
      [dept, idsToUpdate],
    );
    res.json({ success: true, count: idsToUpdate.length });
  } catch (error) {
    console.error('Batch department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

