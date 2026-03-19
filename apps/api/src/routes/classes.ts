import express, { type Request, type Response } from 'express';
import pool from '../config/database.js';

type ReqWithUserId = Request & { userId?: string };

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let ensuredClassTeacherAssignments = false;
async function ensureClassTeacherAssignmentsTable(): Promise<void> {
  if (ensuredClassTeacherAssignments) return;
  // Local dev DB may not have run the latest migration yet; keep endpoints functional.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_teacher_assignments (
      id VARCHAR(80) PRIMARY KEY,
      class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(30) NOT NULL DEFAULT 'co-teacher',
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unassigned_at TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_class_active
      ON class_teacher_assignments(class_id) WHERE unassigned_at IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher_active
      ON class_teacher_assignments(teacher_id) WHERE unassigned_at IS NULL;
  `);
  ensuredClassTeacherAssignments = true;
}

async function isAdmin(req: ReqWithUserId): Promise<boolean> {
  const userId = req.userId;
  if (!userId) return false;
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  const role = result.rows[0]?.role as string;
  return result.rows.length > 0 && (role === 'system-admin' || role === 'admin');
}

async function isSystemAdmin(req: ReqWithUserId): Promise<boolean> {
  const userId = req.userId;
  if (!userId) return false;
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  const role = result.rows[0]?.role as string;
  return result.rows.length > 0 && role === 'system-admin';
}

function requireAdmin(getHandler: (req: ReqWithUserId, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const ext = req as ReqWithUserId;
    const ok = await isAdmin(ext);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: admin only' });
      return;
    }
    return getHandler(ext, res);
  };
}

function requireSystemAdmin(getHandler: (req: ReqWithUserId, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const ext = req as ReqWithUserId;
    const ok = await isSystemAdmin(ext);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: system admin only' });
      return;
    }
    return getHandler(ext, res);
  };
}

const router = express.Router();

// ---------- 学年 ----------
router.get('/academic-years', async (req: ReqWithUserId, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, start_date, end_date, is_current FROM academic_years ORDER BY start_date DESC NULLS LAST, name ASC'
    );
    const years = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      startDate: r.start_date?.toISOString().slice(0, 10),
      endDate: r.end_date?.toISOString().slice(0, 10),
      isCurrent: !!r.is_current,
    }));
    res.json({ years });
  } catch (e) {
    console.error('get academic-years', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/current-year', async (_req: ReqWithUserId, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, start_date, end_date, is_current FROM academic_years WHERE is_current = TRUE LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.json({ year: null });
    }
    const r = result.rows[0];
    res.json({
      year: {
        id: r.id,
        name: r.name,
        startDate: r.start_date?.toISOString().slice(0, 10),
        endDate: r.end_date?.toISOString().slice(0, 10),
        isCurrent: true,
      },
    });
  } catch (e) {
    console.error('get current-year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/current-year', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { academicYearId } = req.body || {};
    if (!academicYearId) { res.status(400).json({ error: 'academicYearId required' }); return; }
    await pool.query('UPDATE academic_years SET is_current = FALSE');
    await pool.query('UPDATE academic_years SET is_current = TRUE WHERE id = $1', [academicYearId]);
    res.json({ success: true });
  } catch (e) {
    console.error('put current-year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post('/academic-years', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { id, name, startDate, endDate, isCurrent } = req.body || {};
    if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (isCurrent) {
      await pool.query('UPDATE academic_years SET is_current = FALSE');
    }
    await pool.query(
      'INSERT INTO academic_years (id, name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name = $2, start_date = $3, end_date = $4, is_current = $5, updated_at = CURRENT_TIMESTAMP',
      [id, name, start, end, !!isCurrent]
    );
    const row = (await pool.query('SELECT id, name, start_date, end_date, is_current FROM academic_years WHERE id = $1', [id])).rows[0];
    res.status(201).json({
      id: row.id,
      name: row.name,
      startDate: row.start_date?.toISOString().slice(0, 10),
      endDate: row.end_date?.toISOString().slice(0, 10),
      isCurrent: !!row.is_current,
    });
  } catch (e) {
    console.error('post academic-years', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/academic-years/:yearId', requireSystemAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { yearId } = req.params;
    if (!yearId) { res.status(400).json({ error: 'yearId required' }); return; }
    await pool.query('UPDATE academic_years SET is_current = FALSE WHERE id = $1', [yearId]);
    await pool.query('DELETE FROM student_enrollments WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = $1)', [yearId]);
    await pool.query('DELETE FROM classes WHERE academic_year_id = $1', [yearId]);
    const del = await pool.query('DELETE FROM academic_years WHERE id = $1 RETURNING id', [yearId]);
    if (del.rowCount === 0) { res.status(404).json({ error: 'Academic year not found' }); return; }
    res.json({ success: true });
  } catch (e) {
    console.error('delete academic-year', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 班级 ----------
router.get('/', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
    const academicYearId = req.query.academicYearId as string | undefined;
    let sql = 'SELECT id, academic_year_id, grade, name, teacher_id FROM classes';
    const params: string[] = [];
    if (academicYearId) {
      sql += ' WHERE academic_year_id = $1';
      params.push(academicYearId);
    }
    sql += ' ORDER BY grade ASC, name ASC';
    const result = await pool.query(sql, params.length ? params : undefined);
    const classIds = result.rows.map((r) => r.id as string);
    const teacherMap = new Map<string, string[]>();
    if (classIds.length) {
      const assigns = await pool.query(
        `SELECT class_id, teacher_id
         FROM class_teacher_assignments
         WHERE class_id = ANY($1::varchar[]) AND unassigned_at IS NULL`,
        [classIds]
      );
      for (const row of assigns.rows) {
        const cid = row.class_id as string;
        const tid = row.teacher_id as string;
        const arr = teacherMap.get(cid) ?? [];
        arr.push(tid);
        teacherMap.set(cid, arr);
      }
    }
    const classes = result.rows.map((r) => {
      const legacyTeacherId = (r.teacher_id as string | null) ?? null;
      const assigned = teacherMap.get(r.id as string) ?? [];
      const teacherIds = legacyTeacherId && !assigned.includes(legacyTeacherId) ? [legacyTeacherId, ...assigned] : assigned;
      return {
        id: r.id,
        academicYearId: r.academic_year_id,
        grade: r.grade,
        name: r.name,
        teacherId: legacyTeacherId,
        teacherIds,
      };
    });
    res.json({ classes });
  } catch (e) {
    console.error('get classes', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
    const { id, academicYearId, grade, name, teacherId } = req.body || {};
    if (!id || !academicYearId || grade == null || !name) { res.status(400).json({ error: 'id, academicYearId, grade, name required' }); return; }
    await pool.query(
      'INSERT INTO classes (id, academic_year_id, grade, name, teacher_id) VALUES ($1, $2, $3, $4, $5)',
      [id, academicYearId, Number(grade), name, teacherId || null]
    );
    if (teacherId) {
      await pool.query(
        `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [createId('cta'), id, teacherId, 'homeroom']
      );
    }
    res.status(201).json({ id, academicYearId, grade: Number(grade), name, teacherId: teacherId || null });
  } catch (e) {
    console.error('post class', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 班级-教师关联 ----------
router.get('/:classId/teachers', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
    const { classId } = req.params;
    if (!classId) { res.status(400).json({ error: 'classId required' }); return; }
    const result = await pool.query(
      `SELECT a.teacher_id, a.role, u.display_name
       FROM class_teacher_assignments a
       JOIN users u ON u.id = a.teacher_id
       WHERE a.class_id = $1 AND a.unassigned_at IS NULL
       ORDER BY CASE WHEN a.role = 'homeroom' THEN 0 ELSE 1 END, u.display_name ASC`,
      [classId]
    );
    const teachers = result.rows.map((r) => ({
      teacherId: r.teacher_id,
      role: r.role,
      displayName: r.display_name,
    }));
    res.json({ teachers });
  } catch (e) {
    console.error('get class teachers', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:classId/teachers', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
    const { classId } = req.params;
    const { teacherId, role } = req.body || {};
    if (!classId || !teacherId) { res.status(400).json({ error: 'classId, teacherId required' }); return; }
    const normalizedRole = (role as string | undefined) ?? 'co-teacher';
    await pool.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL`,
      [classId, teacherId]
    );
    const id = createId('cta');
    await pool.query(
      `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role)
       VALUES ($1, $2, $3, $4)`,
      [id, classId, teacherId, normalizedRole]
    );
    res.status(201).json({ id, classId, teacherId, role: normalizedRole });
  } catch (e) {
    console.error('post class teacher assignment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/:classId/teachers/:teacherId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureClassTeacherAssignmentsTable();
    const { classId, teacherId } = req.params;
    if (!classId || !teacherId) { res.status(400).json({ error: 'classId, teacherId required' }); return; }
    await pool.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL`,
      [classId, teacherId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('delete class teacher assignment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/:classId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { classId } = req.params;
    await pool.query('DELETE FROM student_enrollments WHERE class_id = $1', [classId]);
    await pool.query('DELETE FROM classes WHERE id = $1', [classId]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete class', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 学生 ----------
router.get('/students', async (_req: ReqWithUserId, res: Response) => {
  try {
    const result = await pool.query('SELECT id, name, gender, grade, student_number, date_of_birth FROM students ORDER BY name ASC');
    const students = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      gender: r.gender,
      grade: r.grade ?? null,
      studentNumber: r.student_number,
      dateOfBirth: r.date_of_birth?.toISOString().slice(0, 10),
    }));
    res.json({ students });
  } catch (e) {
    console.error('get students', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/students', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { id, name, gender, grade, studentNumber, dateOfBirth } = req.body || {};
    if (!id || !name || !gender) { res.status(400).json({ error: 'id, name, gender required' }); return; }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    await pool.query(
      'INSERT INTO students (id, name, gender, grade, student_number, date_of_birth) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, name, gender, grade || null, studentNumber || null, dob]
    );
    res.status(201).json({
      id,
      name,
      gender,
      grade: grade || null,
      studentNumber: studentNumber || null,
      dateOfBirth: dateOfBirth || null,
    });
  } catch (e) {
    console.error('post student', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.patch('/students/:studentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { studentId } = req.params;
    const { name, gender, grade, studentNumber, dateOfBirth } = req.body || {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (gender !== undefined) { updates.push(`gender = $${idx++}`); values.push(gender); }
    if (grade !== undefined) { updates.push(`grade = $${idx++}`); values.push(grade || null); }
    if (studentNumber !== undefined) { updates.push(`student_number = $${idx++}`); values.push(studentNumber || null); }
    if (dateOfBirth !== undefined) { updates.push(`date_of_birth = $${idx++}`); values.push(dateOfBirth ? new Date(dateOfBirth) : null); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    values.push(studentId);
    await pool.query(
      `UPDATE students SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx}`,
      values
    );
    const row = (await pool.query('SELECT id, name, gender, grade, student_number, date_of_birth FROM students WHERE id = $1', [studentId])).rows[0];
    if (!row) { res.status(404).json({ error: 'Student not found' }); return; }
    res.json({
      id: row.id,
      name: row.name,
      gender: row.gender,
      grade: row.grade ?? null,
      studentNumber: row.student_number,
      dateOfBirth: row.date_of_birth?.toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error('patch student', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/students/:studentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { studentId } = req.params;
    await pool.query('DELETE FROM student_enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete student', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 学籍 ----------
router.get('/enrollments', async (req: ReqWithUserId, res: Response) => {
  try {
    const academicYearId = req.query.academicYearId as string | undefined;
    let sql = 'SELECT id, student_id, class_id, academic_year_id FROM student_enrollments';
    const params: string[] = [];
    if (academicYearId) {
      sql += ' WHERE academic_year_id = $1';
      params.push(academicYearId);
    }
    sql += ' ORDER BY academic_year_id DESC, class_id ASC';
    const result = await pool.query(sql, params.length ? params : undefined);
    const enrollments = result.rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      classId: r.class_id,
      academicYearId: r.academic_year_id,
    }));
    res.json({ enrollments });
  } catch (e) {
    console.error('get enrollments', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/enrollments', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { id, studentId, classId, academicYearId } = req.body || {};
    if (!id || !studentId || !classId || !academicYearId) { res.status(400).json({ error: 'id, studentId, classId, academicYearId required' }); return; }
    await pool.query(
      'INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id) VALUES ($1, $2, $3, $4)',
      [id, studentId, classId, academicYearId]
    );
    res.status(201).json({ id, studentId, classId, academicYearId });
  } catch (e) {
    console.error('post enrollment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/enrollments/:enrollmentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    const { enrollmentId } = req.params;
    await pool.query('DELETE FROM student_enrollments WHERE id = $1', [enrollmentId]);
    res.json({ success: true });
  } catch (e) {
    console.error('delete enrollment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

export default router;