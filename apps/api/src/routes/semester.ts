import express, { Request } from 'express';
import pool from '../config/database.js';

const router = express.Router();

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
}

router.get('/:courseId/:grade/:semester', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const { courseId, grade, semester } = req.params;
    const result = await pool.query(
      `SELECT * FROM semester_data 
       WHERE course_id = $1 AND grade = $2 AND semester = $3`,
      [courseId, parseInt(grade), semester]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        courseId,
        grade: parseInt(grade),
        semester,
        units: [],
        weeklyPeriods: 2,
      });
    }

    const row = result.rows[0] as Record<string, unknown>;
    res.json({
      courseId: row.course_id,
      grade: row.grade,
      semester: row.semester,
      units: row.units,
      weeklyPeriods: row.weekly_periods,
    });
  } catch (error) {
    console.error('Get semester data error:', error);
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

    const { courseId, grade, semester, units, weeklyPeriods } = req.body;
    const result = await pool.query(
      `INSERT INTO semester_data (user_id, course_id, grade, semester, units, weekly_periods)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (course_id, grade, semester)
       DO UPDATE SET units = EXCLUDED.units, weekly_periods = EXCLUDED.weekly_periods, user_id = EXCLUDED.user_id, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [uid, courseId, grade, semester, JSON.stringify(units || []), weeklyPeriods],
    );

    const row = result.rows[0] as Record<string, unknown>;
    res.json({
      courseId: row.course_id,
      grade: row.grade,
      semester: row.semester,
      units: row.units,
      weeklyPeriods: row.weekly_periods,
    });
  } catch (error) {
    console.error('Save semester data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:courseId/:grade/:semester', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }

    const { courseId, grade, semester } = req.params;
    const result = await pool.query(
      `DELETE FROM semester_data 
       WHERE course_id = $1 AND grade = $2 AND semester = $3
       RETURNING id`,
      [courseId, parseInt(grade), semester],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Semester data not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete semester data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
