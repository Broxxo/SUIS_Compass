import express, { Request } from 'express';
import pool from '../config/database.js';

const router = express.Router();

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
}

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val
      .map((x) => {
        if (typeof x === 'number' && Number.isFinite(x)) return `g${Math.round(x)}`;
        const s = String(x ?? '').trim();
        if (!s) return '';
        const n = Number(s);
        if (Number.isFinite(n)) return `g${Math.round(n)}`;
        return s;
      })
      .filter((x) => !!x);
  }
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return parseJsonArray(p);
    } catch {
      return [];
    }
  }
  return [];
}

const PERIODS_MIN = 0.5;
const PERIODS_MAX = 99;
const PERIODS_STEP = 0.5;

function normalizeWeeklyPeriodsFromDb(raw: number): number {
  if (!Number.isFinite(raw)) return 2;
  const clamped = Math.max(PERIODS_MIN, Math.min(PERIODS_MAX, raw));
  const stepped = Math.round(clamped / PERIODS_STEP) * PERIODS_STEP;
  return Math.round(stepped * 100) / 100;
}

function parsePeriodsMap(val: unknown): Record<string, number> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (Number.isFinite(n)) out[k] = normalizeWeeklyPeriodsFromDb(n);
    }
    return out;
  }
  return {};
}

function mapCourseRow(row: Record<string, unknown>) {
  const applicableGrades = parseJsonArray(row.applicable_grades).filter(
    (id, i, arr) => arr.indexOf(id) === i,
  );
  return {
    id: row.id,
    name: row.name,
    subjectCategory:
      row.subject_category_zh && row.subject_category_en
        ? { zh: row.subject_category_zh, en: row.subject_category_en }
        : row.subject_category_zh || row.subject_category_en || '',
    applicableGrades,
    weeklyPeriodsByGrade: parsePeriodsMap(row.weekly_periods_by_grade),
    textbookVersion: row.textbook_version,
    color: row.color,
  };
}

router.get('/', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      'SELECT * FROM courses ORDER BY created_at ASC',
    );

    const courses = result.rows.map((row: Record<string, unknown>) => mapCourseRow(row));

    res.json(courses);
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: system-admin required to create courses' });
    }

    const { id, name, subjectCategory, applicableGrades, weeklyPeriodsByGrade, textbookVersion, color } =
      req.body;
    const subjectCategoryZh = typeof subjectCategory === 'object' ? subjectCategory.zh : subjectCategory;
    const subjectCategoryEn = typeof subjectCategory === 'object' ? subjectCategory.en : '';

    const ag = JSON.stringify(Array.isArray(applicableGrades) ? applicableGrades : []);
    const wp = JSON.stringify(
      weeklyPeriodsByGrade && typeof weeklyPeriodsByGrade === 'object' ? weeklyPeriodsByGrade : {},
    );

    const result = await pool.query(
      `INSERT INTO courses (id, user_id, name, subject_category_zh, subject_category_en, applicable_grades, weekly_periods_by_grade, textbook_version, color)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, subject_category_zh = EXCLUDED.subject_category_zh, subject_category_en = EXCLUDED.subject_category_en,
         applicable_grades = EXCLUDED.applicable_grades, weekly_periods_by_grade = EXCLUDED.weekly_periods_by_grade,
         textbook_version = EXCLUDED.textbook_version, color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, uid, name, subjectCategoryZh, subjectCategoryEn, ag, wp, textbookVersion, color],
    );

    const course = result.rows[0] as Record<string, unknown>;
    res.status(201).json(mapCourseRow(course));
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: system-admin required to update courses' });
    }

    const { id } = req.params;
    const { name, subjectCategory, applicableGrades, weeklyPeriodsByGrade, textbookVersion, color } =
      req.body;
    const subjectCategoryZh = typeof subjectCategory === 'object' ? subjectCategory.zh : subjectCategory;
    const subjectCategoryEn = typeof subjectCategory === 'object' ? subjectCategory.en : '';

    const ag = JSON.stringify(Array.isArray(applicableGrades) ? applicableGrades : []);
    const wp = JSON.stringify(
      weeklyPeriodsByGrade && typeof weeklyPeriodsByGrade === 'object' ? weeklyPeriodsByGrade : {},
    );

    const result = await pool.query(
      `UPDATE courses 
       SET name = $1, subject_category_zh = $2, subject_category_en = $3, applicable_grades = $4::jsonb,
           weekly_periods_by_grade = $5::jsonb, textbook_version = $6, color = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [name, subjectCategoryZh, subjectCategoryEn, ag, wp, textbookVersion, color, id],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });

    const course = result.rows[0] as Record<string, unknown>;
    res.json(mapCourseRow(course));
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: system-admin required to delete courses' });
    }

    const { id } = req.params;
    const result = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
