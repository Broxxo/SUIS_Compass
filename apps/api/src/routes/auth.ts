import express, { Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/auth.js';

const router = express.Router();

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const legacy = req.headers['x-user-id'] as string | undefined;
  if (token && JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      return decoded.userId;
    } catch {
      return null;
    }
  }
  return legacy ?? null;
}

function toUserRow(row: {
  id: string;
  username: string;
  role: string;
  display_name: string;
  student_id?: string | null;
}) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    studentId: row.student_id ?? null,
  };
}

// 登录：支持 password_hash（bcrypt）与旧明文密码；成功后签发 JWT
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT id, username, role, display_name, student_id, password, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const row = result.rows[0] as {
      id: string;
      username: string;
      role: string;
      display_name: string;
      student_id: string | null;
      password: string | null;
      password_hash: string | null;
    };

    let valid = false;
    if (row.password_hash) {
      valid = await bcrypt.compare(password, row.password_hash);
    } else if (row.password) {
      valid = row.password === password;
      if (valid) {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
          hash,
          row.id,
        ]);
      }
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = toUserRow(row);
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'Server auth not configured (JWT_SECRET)' });
    }
    const token = jwt.sign(
      { userId: row.id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
    res.json({ success: true, token, user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取当前用户信息（Bearer 或 X-User-Id）
router.get('/user', async (req, res) => {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      'SELECT id, username, role, display_name, student_id FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const row = result.rows[0] as {
      id: string;
      username: string;
      role: string;
      display_name: string;
      student_id: string | null;
    };
    res.json({ user: toUserRow(row) });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
