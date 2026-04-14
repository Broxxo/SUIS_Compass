import express, { type Request, type Response, type NextFunction } from 'express';
import pool from '../config/database.js';

type ReqWithUserId = Request & { userId?: string };

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let ensuredClassTeacherAssignments = false;
let ensuredPortraitTables = false;
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

async function ensureStudentPortraitTables(): Promise<void> {
  if (ensuredPortraitTables) return;
  await pool.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS name_zh VARCHAR(100),
      ADD COLUMN IF NOT EXISTS name_en VARCHAR(100),
      ADD COLUMN IF NOT EXISTS current_grade INTEGER,
      ADD COLUMN IF NOT EXISTS current_class_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS division VARCHAR(50),
      ADD COLUMN IF NOT EXISTS entry_date DATE,
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'active'
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_number_unique ON students(student_number) WHERE student_number IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_current_class_id ON students(current_class_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_status ON students(status)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_unique_per_year ON student_enrollments(student_id, academic_year_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_assignment_history (
      id VARCHAR(80) PRIMARY KEY,
      student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      class_id VARCHAR(50) REFERENCES classes(id) ON DELETE SET NULL,
      grade INTEGER CHECK (grade >= 1 AND grade <= 12),
      division VARCHAR(50),
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
      effective_to DATE,
      source VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'promotion', 'import', 'sync')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profile_modules (
      id VARCHAR(80) PRIMARY KEY,
      key VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      description TEXT,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profile_module_fields (
      id VARCHAR(80) PRIMARY KEY,
      module_id VARCHAR(80) NOT NULL REFERENCES student_profile_modules(id) ON DELETE CASCADE,
      field_key VARCHAR(80) NOT NULL,
      label VARCHAR(120) NOT NULL,
      field_type VARCHAR(30) NOT NULL CHECK (field_type IN ('text', 'number', 'single-select', 'multi-select', 'score')),
      score_min NUMERIC,
      score_max NUMERIC,
      options JSONB,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(module_id, field_key)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profile_values (
      id VARCHAR(100) PRIMARY KEY,
      student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      module_id VARCHAR(80) NOT NULL REFERENCES student_profile_modules(id) ON DELETE CASCADE,
      field_key VARCHAR(80) NOT NULL,
      value_json JSONB NOT NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, module_id, field_key)
    );
  `);
  await pool.query(`
    INSERT INTO student_profile_modules (id, key, name, description, is_system, is_enabled)
    VALUES ('spm-ability', 'ability', '能力画像', '能力雷达图模块，默认分值范围 0-10', TRUE, TRUE)
    ON CONFLICT (key) DO NOTHING
  `);
  await pool.query('ALTER TABLE students DROP COLUMN IF EXISTS grade');
  ensuredPortraitTables = true;
}

async function getUserRole(req: ReqWithUserId): Promise<string | null> {
  const userId = req.userId;
  if (!userId) return null;
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return (result.rows[0]?.role as string | undefined) ?? null;
}

async function isAdmin(req: ReqWithUserId): Promise<boolean> {
  const role = await getUserRole(req);
  return role === 'system-admin' || role === 'admin';
}

async function isSystemAdmin(req: ReqWithUserId): Promise<boolean> {
  const role = await getUserRole(req);
  return role === 'system-admin';
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

async function canUserAccessStudent(req: ReqWithUserId, studentId: string, requireHomeroom: boolean): Promise<boolean> {
  const userId = req.userId;
  if (!userId) return false;
  const role = await getUserRole(req);
  if (role === 'system-admin' || role === 'admin') return true;
  if (role === 'student') {
    if (requireHomeroom) return false;
    const link = await pool.query('SELECT student_id FROM users WHERE id = $1', [userId]);
    const sid = link.rows[0]?.student_id as string | null | undefined;
    return !!sid && sid === studentId;
  }
  const result = await pool.query(
    `SELECT 1
     FROM student_enrollments e
     JOIN class_teacher_assignments a
       ON a.class_id = e.class_id
      AND a.teacher_id = $1
      AND a.unassigned_at IS NULL
     WHERE e.student_id = $2
       ${requireHomeroom ? "AND a.role = 'homeroom'" : ''}
     LIMIT 1`,
    [userId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

function requireStudentProfileEditor(getHandler: (req: ReqWithUserId, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const ext = req as ReqWithUserId;
    const studentId = req.params.studentId as string | undefined;
    if (!studentId) {
      res.status(400).json({ error: 'studentId required' });
      return;
    }
    const ok = await canUserAccessStudent(ext, studentId, true);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden: homeroom/admin only for student profile edit' });
      return;
    }
    return getHandler(ext, res);
  };
}

const router = express.Router();

/** 学生账号仅允许 GET：本校画像模块、本人学籍行、本人画像分值 */
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const ext = req as ReqWithUserId;
  const role = await getUserRole(ext);
  if (role !== 'student') {
    next();
    return;
  }
  if (req.method !== 'GET') {
    res.status(403).json({ error: 'Forbidden: student accounts are read-only on class APIs' });
    return;
  }
  const path = req.path;
  if (path === '/students' || path === '/profile/modules' || /^\/profile\/students\/[^/]+\/values$/.test(path)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Forbidden: students may only access their own portrait data' });
});

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
    const role = await getUserRole(req);
    const params: string[] = [];
    let sql = 'SELECT id, academic_year_id, grade, name, teacher_id FROM classes';
    const where: string[] = [];
    if (academicYearId) {
      params.push(academicYearId);
      where.push(`academic_year_id = $${params.length}`);
    }
    if (role !== 'system-admin' && role !== 'admin') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      params.push(req.userId);
      where.push(`EXISTS (
        SELECT 1 FROM class_teacher_assignments a
        WHERE a.class_id = classes.id
          AND a.teacher_id = $${params.length}
          AND a.unassigned_at IS NULL
      )`);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
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
router.get('/students', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const role = await getUserRole(req);
    const params: unknown[] = [];
    let sql = `
      SELECT
        id, name, name_zh, name_en, gender, current_grade, current_class_id,
        division, entry_date, status, student_number, date_of_birth
      FROM students
    `;
    if (role === 'student') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const link = await pool.query('SELECT student_id FROM users WHERE id = $1', [req.userId]);
      const sid = link.rows[0]?.student_id as string | null | undefined;
      if (!sid) {
        res.json({ students: [] });
        return;
      }
      params.push(sid);
      sql += ' WHERE id = $1';
    } else if (role !== 'system-admin' && role !== 'admin') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      params.push(req.userId);
      sql += `
        WHERE EXISTS (
          SELECT 1
          FROM student_enrollments e
          JOIN class_teacher_assignments a
            ON a.class_id = e.class_id
           AND a.unassigned_at IS NULL
          WHERE e.student_id = students.id
            AND a.teacher_id = $1
        )
      `;
    }
    sql += ' ORDER BY name ASC';
    const result = await pool.query(sql, params);
    const students = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameZh: r.name_zh ?? null,
      nameEn: r.name_en ?? null,
      gender: r.gender,
      currentGrade: r.current_grade ?? null,
      currentClassId: r.current_class_id ?? null,
      division: r.division ?? null,
      entryDate: r.entry_date?.toISOString().slice(0, 10),
      status: r.status ?? 'active',
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
    await ensureStudentPortraitTables();
    const {
      id, name, nameZh, nameEn, gender, currentGrade, currentClassId,
      division, entryDate, status, studentNumber, dateOfBirth,
    } = req.body || {};
    const zh = typeof nameZh === 'string' ? nameZh.trim() : '';
    const en = typeof nameEn === 'string' ? nameEn.trim() : '';
    const fallback = typeof name === 'string' ? name.trim() : '';
    const displayName = zh || en || fallback;
    if (!id || !displayName || !gender) { res.status(400).json({ error: 'id, gender and at least one of nameZh/nameEn required' }); return; }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    const ent = entryDate ? new Date(entryDate) : null;
    const normalizedStatus = status || 'active';
    const normalizedCurrentGrade = currentGrade == null || currentGrade === '' ? null : Number(currentGrade);
    await pool.query(
      `INSERT INTO students (
        id, name, name_zh, name_en, gender, current_grade, current_class_id,
        division, entry_date, status, student_number, date_of_birth
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, displayName, zh || null, en || null, gender,
        normalizedCurrentGrade, currentClassId || null, division || null, ent, normalizedStatus, studentNumber || null, dob,
      ]
    );
    res.status(201).json({
      id,
      name: displayName,
      nameZh: zh || null,
      nameEn: en || null,
      gender,
      currentGrade: normalizedCurrentGrade,
      currentClassId: currentClassId || null,
      division: division || null,
      entryDate: entryDate || null,
      status: normalizedStatus,
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
    await ensureStudentPortraitTables();
    const { studentId } = req.params;
    const {
      name, nameZh, nameEn, gender, currentGrade, currentClassId,
      division, entryDate, status, studentNumber, dateOfBirth,
    } = req.body || {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const nextNameZh = nameZh !== undefined ? String(nameZh || '').trim() : undefined;
    const nextNameEn = nameEn !== undefined ? String(nameEn || '').trim() : undefined;
    const nextName = name !== undefined ? String(name || '').trim() : undefined;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(nextName || null); }
    if (nameZh !== undefined) { updates.push(`name_zh = $${idx++}`); values.push(nameZh || null); }
    if (nameEn !== undefined) { updates.push(`name_en = $${idx++}`); values.push(nameEn || null); }
    if (gender !== undefined) { updates.push(`gender = $${idx++}`); values.push(gender); }
    const parsedRawCurrentGrade = currentGrade !== undefined && currentGrade !== null && currentGrade !== ''
      ? Number(currentGrade)
      : null;
    const parsedCurrentGrade = parsedRawCurrentGrade != null && !Number.isNaN(parsedRawCurrentGrade)
      ? parsedRawCurrentGrade
      : null;
    if (currentGrade !== undefined) { updates.push(`current_grade = $${idx++}`); values.push(parsedCurrentGrade); }
    if (currentClassId !== undefined) { updates.push(`current_class_id = $${idx++}`); values.push(currentClassId || null); }
    if (division !== undefined) { updates.push(`division = $${idx++}`); values.push(division || null); }
    if (entryDate !== undefined) { updates.push(`entry_date = $${idx++}`); values.push(entryDate ? new Date(entryDate) : null); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
    if (studentNumber !== undefined) { updates.push(`student_number = $${idx++}`); values.push(studentNumber || null); }
    if (dateOfBirth !== undefined) { updates.push(`date_of_birth = $${idx++}`); values.push(dateOfBirth ? new Date(dateOfBirth) : null); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    values.push(studentId);
    await pool.query(
      `UPDATE students SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx}`,
      values
    );
    const row = (await pool.query(`
      SELECT
        id, name, name_zh, name_en, gender, current_grade, current_class_id,
        division, entry_date, status, student_number, date_of_birth
      FROM students WHERE id = $1
    `, [studentId])).rows[0];
    if (!row) { res.status(404).json({ error: 'Student not found' }); return; }
    const finalZh = nextNameZh ?? (row.name_zh ?? '');
    const finalEn = nextNameEn ?? (row.name_en ?? '');
    const finalName = nextName ?? (row.name ?? '');
    if (!String(finalZh).trim() && !String(finalEn).trim() && !String(finalName).trim()) {
      res.status(400).json({ error: 'At least one of nameZh/nameEn is required' });
      return;
    }
    const derived = String(finalZh).trim() || String(finalEn).trim() || String(finalName).trim();
    if (derived && derived !== row.name) {
      await pool.query('UPDATE students SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [derived, studentId]);
      row.name = derived;
    }
    res.json({
      id: row.id,
      name: row.name,
      nameZh: row.name_zh ?? null,
      nameEn: row.name_en ?? null,
      gender: row.gender,
      currentGrade: row.current_grade ?? null,
      currentClassId: row.current_class_id ?? null,
      division: row.division ?? null,
      entryDate: row.entry_date?.toISOString().slice(0, 10),
      status: row.status ?? 'active',
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
    await ensureClassTeacherAssignmentsTable();
    const role = await getUserRole(req);
    const academicYearId = req.query.academicYearId as string | undefined;
    const params: unknown[] = [];
    const where: string[] = [];
    let sql = 'SELECT id, student_id, class_id, academic_year_id FROM student_enrollments';
    if (academicYearId) {
      params.push(academicYearId);
      where.push(`academic_year_id = $${params.length}`);
    }
    if (role !== 'system-admin' && role !== 'admin') {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      params.push(req.userId);
      where.push(`EXISTS (
        SELECT 1 FROM class_teacher_assignments a
        WHERE a.class_id = student_enrollments.class_id
          AND a.teacher_id = $${params.length}
          AND a.unassigned_at IS NULL
      )`);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY academic_year_id DESC, class_id ASC';
    const result = await pool.query(sql, params);
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
    await ensureStudentPortraitTables();
    const { id, studentId, classId, academicYearId } = req.body || {};
    if (!id || !studentId || !classId || !academicYearId) { res.status(400).json({ error: 'id, studentId, classId, academicYearId required' }); return; }
    await pool.query(
      'INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id) VALUES ($1, $2, $3, $4)',
      [id, studentId, classId, academicYearId]
    );
    const cls = (await pool.query(
      'SELECT grade FROM classes WHERE id = $1 AND academic_year_id = $2',
      [classId, academicYearId]
    )).rows[0];
    const grade = cls?.grade ?? null;
    await pool.query(
      `UPDATE student_assignment_history
       SET effective_to = CURRENT_DATE
       WHERE student_id = $1 AND effective_to IS NULL`,
      [studentId]
    );
    await pool.query(
      `INSERT INTO student_assignment_history (
         id, student_id, academic_year_id, class_id, grade, effective_from, source
       ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'manual')`,
      [createId('sah'), studentId, academicYearId, classId, grade]
    );
    await pool.query(
      `UPDATE students
       SET current_class_id = $1, current_grade = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [classId, grade, studentId]
    );
    res.status(201).json({ id, studentId, classId, academicYearId });
  } catch (e) {
    console.error('post enrollment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.delete('/enrollments/:enrollmentId', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { enrollmentId } = req.params;
    const row = (await pool.query(
      'SELECT student_id, class_id, academic_year_id FROM student_enrollments WHERE id = $1',
      [enrollmentId]
    )).rows[0];
    await pool.query('DELETE FROM student_enrollments WHERE id = $1', [enrollmentId]);
    if (row?.student_id) {
      await pool.query(
        `UPDATE student_assignment_history
         SET effective_to = CURRENT_DATE
         WHERE student_id = $1 AND class_id = $2 AND academic_year_id = $3 AND effective_to IS NULL`,
        [row.student_id, row.class_id, row.academic_year_id]
      );
      await pool.query(
        `UPDATE students
         SET current_class_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.student_id]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('delete enrollment', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// ---------- 学生画像模块（可扩展） ----------
router.get('/profile/modules', async (_req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const modulesResult = await pool.query(
      `SELECT id, key, name, description, is_system, is_enabled
       FROM student_profile_modules
       ORDER BY is_system DESC, created_at ASC`
    );
    const moduleIds = modulesResult.rows.map((r) => r.id as string);
    let fieldsByModule = new Map<string, any[]>();
    if (moduleIds.length > 0) {
      const fieldsResult = await pool.query(
        `SELECT id, module_id, field_key, label, field_type, score_min, score_max, options, sort_order, is_required
         FROM student_profile_module_fields
         WHERE module_id = ANY($1::varchar[])
         ORDER BY sort_order ASC, created_at ASC`,
        [moduleIds]
      );
      for (const row of fieldsResult.rows) {
        const arr = fieldsByModule.get(row.module_id as string) ?? [];
        arr.push({
          id: row.id,
          fieldKey: row.field_key,
          label: row.label,
          fieldType: row.field_type,
          scoreMin: row.score_min == null ? null : Number(row.score_min),
          scoreMax: row.score_max == null ? null : Number(row.score_max),
          options: row.options ?? null,
          sortOrder: row.sort_order,
          required: !!row.is_required,
        });
        fieldsByModule.set(row.module_id as string, arr);
      }
    }
    const modules = modulesResult.rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description ?? null,
      isSystem: !!r.is_system,
      isEnabled: !!r.is_enabled,
      fields: fieldsByModule.get(r.id as string) ?? [],
    }));
    res.json({ modules });
  } catch (e) {
    console.error('get profile modules', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profile/modules', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { key, name, description, isEnabled } = req.body || {};
    if (!key || !name) { res.status(400).json({ error: 'key and name required' }); return; }
    const id = createId('spm');
    await pool.query(
      `INSERT INTO student_profile_modules (id, key, name, description, is_system, is_enabled, created_by)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
      [id, String(key), String(name), description ?? null, isEnabled !== false, req.userId ?? null]
    );
    res.status(201).json({ id, key: String(key), name: String(name), description: description ?? null, isEnabled: isEnabled !== false });
  } catch (e) {
    console.error('post profile module', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post('/profile/modules/:moduleId/fields', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { moduleId } = req.params;
    const { fieldKey, label, fieldType, scoreMin, scoreMax, options, sortOrder, required } = req.body || {};
    if (!moduleId || !fieldKey || !label || !fieldType) {
      res.status(400).json({ error: 'moduleId, fieldKey, label, fieldType required' });
      return;
    }
    const id = createId('spmf');
    await pool.query(
      `INSERT INTO student_profile_module_fields
        (id, module_id, field_key, label, field_type, score_min, score_max, options, sort_order, is_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        id, moduleId, String(fieldKey), String(label), String(fieldType),
        scoreMin == null ? null : Number(scoreMin),
        scoreMax == null ? null : Number(scoreMax),
        options == null ? null : JSON.stringify(options),
        Number(sortOrder ?? 0),
        !!required,
      ]
    );
    res.status(201).json({ id, moduleId, fieldKey, label, fieldType, scoreMin: scoreMin ?? null, scoreMax: scoreMax ?? null, options: options ?? null, sortOrder: Number(sortOrder ?? 0), required: !!required });
  } catch (e) {
    console.error('post profile module field', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.get('/profile/students/:studentId/values', async (req: ReqWithUserId, res: Response) => {
  try {
    await ensureStudentPortraitTables();
    const { studentId } = req.params;
    const canView = await canUserAccessStudent(req, studentId, false);
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: no access to this student profile' });
      return;
    }
    const rows = (await pool.query(
      `SELECT module_id, field_key, value_json
       FROM student_profile_values
       WHERE student_id = $1`,
      [studentId]
    )).rows;
    const values: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const moduleId = row.module_id as string;
      if (!values[moduleId]) values[moduleId] = {};
      values[moduleId][row.field_key as string] = row.value_json;
    }
    res.json({ studentId, values });
  } catch (e) {
    console.error('get student profile values', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profile/students/:studentId/modules/:moduleId/values', requireStudentProfileEditor(async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    const { studentId, moduleId } = req.params;
    const values = (req.body?.values ?? {}) as Record<string, unknown>;
    if (!studentId || !moduleId || typeof values !== 'object') {
      res.status(400).json({ error: 'studentId, moduleId, values required' });
      return;
    }
    const fieldRows = (await pool.query(
      `SELECT field_key, field_type, score_min, score_max
       FROM student_profile_module_fields
       WHERE module_id = $1`,
      [moduleId]
    )).rows as Array<{ field_key: string; field_type: string; score_min: string | null; score_max: string | null }>;
    const fieldMap = new Map(fieldRows.map((f) => [f.field_key, f]));
    await client.query('BEGIN');
    for (const [fieldKey, value] of Object.entries(values)) {
      const def = fieldMap.get(fieldKey);
      if (!def) continue;
      if (def.field_type === 'score' && value != null) {
        const score = Number(value);
        if (Number.isNaN(score)) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: `Field ${fieldKey} must be a number` });
          return;
        }
        const min = def.score_min == null ? 0 : Number(def.score_min);
        const max = def.score_max == null ? 10 : Number(def.score_max);
        if (score < min || score > max) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: `Field ${fieldKey} must be between ${min} and ${max}` });
          return;
        }
      }
      await client.query(
        `INSERT INTO student_profile_values (id, student_id, module_id, field_key, value_json, updated_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (student_id, module_id, field_key)
         DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [createId('spv'), studentId, moduleId, fieldKey, JSON.stringify(value), req.userId ?? null]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('put student profile values', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}));

// ---------- 学年升级（策略 A：一键全校升一级） ----------
router.post('/academic-years/:sourceYearId/promote', requireAdmin(async (req: ReqWithUserId, res: Response) => {
  const client = await pool.connect();
  try {
    await ensureStudentPortraitTables();
    await ensureClassTeacherAssignmentsTable();
    const { sourceYearId } = req.params;
    const { targetYearId, setTargetAsCurrent } = req.body || {};
    if (!sourceYearId || !targetYearId) {
      res.status(400).json({ error: 'sourceYearId and targetYearId required' });
      return;
    }
    await client.query('BEGIN');
    const sourceYear = (await client.query('SELECT id FROM academic_years WHERE id = $1', [sourceYearId])).rows[0];
    const targetYear = (await client.query('SELECT id FROM academic_years WHERE id = $1', [targetYearId])).rows[0];
    if (!sourceYear || !targetYear) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Source or target academic year not found' });
      return;
    }

    const sourceClasses = (await client.query(
      `SELECT id, grade, name FROM classes WHERE academic_year_id = $1`,
      [sourceYearId]
    )).rows as Array<{ id: string; grade: number; name: string }>;

    const targetClassMap = new Map<string, string>();
    for (const cls of sourceClasses) {
      const nextGrade = Math.min(12, Number(cls.grade) + 1);
      const existing = (await client.query(
        `SELECT id FROM classes WHERE academic_year_id = $1 AND grade = $2 AND name = $3 LIMIT 1`,
        [targetYearId, nextGrade, cls.name]
      )).rows[0];
      const targetClassId = existing?.id ?? createId('class');
      if (!existing) {
        await client.query(
          `INSERT INTO classes (id, academic_year_id, grade, name) VALUES ($1, $2, $3, $4)`,
          [targetClassId, targetYearId, nextGrade, cls.name]
        );
      }
      targetClassMap.set(cls.id, targetClassId);
    }

    const enrollments = (await client.query(
      `SELECT e.student_id, e.class_id, c.grade
       FROM student_enrollments e
       JOIN classes c ON c.id = e.class_id
       JOIN students s ON s.id = e.student_id
       WHERE e.academic_year_id = $1 AND s.status = 'active'`,
      [sourceYearId]
    )).rows as Array<{ student_id: string; class_id: string; grade: number }>;

    let promotedCount = 0;
    for (const enr of enrollments) {
      const targetClassId = targetClassMap.get(enr.class_id);
      if (!targetClassId) continue;
      const targetClass = (await client.query('SELECT grade FROM classes WHERE id = $1', [targetClassId])).rows[0];
      const nextGrade = Number(targetClass?.grade ?? Math.min(12, Number(enr.grade) + 1));
      await client.query(
        `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, academic_year_id)
         DO UPDATE SET class_id = EXCLUDED.class_id`,
        [createId('enr'), enr.student_id, targetClassId, targetYearId]
      );
      await client.query(
        `UPDATE student_assignment_history
         SET effective_to = CURRENT_DATE
         WHERE student_id = $1 AND effective_to IS NULL`,
        [enr.student_id]
      );
      await client.query(
        `INSERT INTO student_assignment_history (
           id, student_id, academic_year_id, class_id, grade, effective_from, source
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'promotion')`,
        [createId('sah'), enr.student_id, targetYearId, targetClassId, nextGrade]
      );
      await client.query(
        `UPDATE students
         SET current_grade = $1, current_class_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [nextGrade, targetClassId, enr.student_id]
      );
      promotedCount += 1;
    }

    if (setTargetAsCurrent) {
      await client.query('UPDATE academic_years SET is_current = FALSE');
      await client.query('UPDATE academic_years SET is_current = TRUE WHERE id = $1', [targetYearId]);
    }
    await client.query('COMMIT');
    res.json({
      success: true,
      sourceYearId,
      targetYearId,
      classesPrepared: targetClassMap.size,
      studentsPromoted: promotedCount,
      targetSetCurrent: !!setTargetAsCurrent,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('promote academic year', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}));

export default router;