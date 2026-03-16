import express, { Request } from 'express';
import pool from '../config/database.js';

const router = express.Router();

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
}

router.get('/', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    // 全校共享课程：不再按 user_id 过滤，只按创建时间排序
    const result = await pool.query(
      'SELECT * FROM courses ORDER BY created_at ASC',
    );

    const courses = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
      subjectCategory:
        row.subject_category_zh && row.subject_category_en
          ? { zh: row.subject_category_zh, en: row.subject_category_en }
          : row.subject_category_zh || row.subject_category_en || '',
      gradeRange: row.grade_range,
      textbookVersion: row.textbook_version,
      color: row.color,
      weeklyPeriods: row.weekly_periods || 2,
    }));

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
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }

    const { id, name, subjectCategory, gradeRange, textbookVersion, color, weeklyPeriods } = req.body;
    const subjectCategoryZh = typeof subjectCategory === 'object' ? subjectCategory.zh : subjectCategory;
    const subjectCategoryEn = typeof subjectCategory === 'object' ? subjectCategory.en : '';

    const result = await pool.query(
      `INSERT INTO courses (id, user_id, name, subject_category_zh, subject_category_en, grade_range, textbook_version, color, weekly_periods)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, subject_category_zh = EXCLUDED.subject_category_zh, subject_category_en = EXCLUDED.subject_category_en,
         grade_range = EXCLUDED.grade_range, textbook_version = EXCLUDED.textbook_version, color = EXCLUDED.color,
         weekly_periods = EXCLUDED.weekly_periods, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, uid, name, subjectCategoryZh, subjectCategoryEn, gradeRange, textbookVersion, color, weeklyPeriods || 2],
    );

    const course = result.rows[0] as Record<string, unknown>;
    res.status(201).json({
      id: course.id,
      name: course.name,
      subjectCategory:
        course.subject_category_zh && course.subject_category_en
          ? { zh: course.subject_category_zh, en: course.subject_category_en }
          : course.subject_category_zh || course.subject_category_en || '',
      gradeRange: course.grade_range,
      textbookVersion: course.textbook_version,
      color: course.color,
      weeklyPeriods: course.weekly_periods || 2,
    });
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
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }

    const { id } = req.params;
    const { name, subjectCategory, gradeRange, textbookVersion, color, weeklyPeriods } = req.body;
    const subjectCategoryZh = typeof subjectCategory === 'object' ? subjectCategory.zh : subjectCategory;
    const subjectCategoryEn = typeof subjectCategory === 'object' ? subjectCategory.en : '';

    const result = await pool.query(
      `UPDATE courses 
       SET name = $1, subject_category_zh = $2, subject_category_en = $3, grade_range = $4, 
           textbook_version = $5, color = $6, weekly_periods = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [name, subjectCategoryZh, subjectCategoryEn, gradeRange, textbookVersion, color, weeklyPeriods || 2, id],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });

    const course = result.rows[0] as Record<string, unknown>;
    res.json({
      id: course.id,
      name: course.name,
      subjectCategory:
        course.subject_category_zh && course.subject_category_en
          ? { zh: course.subject_category_zh, en: course.subject_category_en }
          : course.subject_category_zh || course.subject_category_en || '',
      gradeRange: course.grade_range,
      textbookVersion: course.textbook_version,
      color: course.color,
      weeklyPeriods: course.weekly_periods || 2,
    });
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
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin only' });
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
