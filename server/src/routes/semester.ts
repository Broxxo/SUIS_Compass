import express from 'express';
import pool from '../config/database';

const router = express.Router();

// 获取学期数据
router.get('/:courseId/:grade/:semester', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { courseId, grade, semester } = req.params;

    const result = await pool.query(
      `SELECT * FROM semester_data 
       WHERE user_id = $1 AND course_id = $2 AND grade = $3 AND semester = $4`,
      [userId, courseId, parseInt(grade), semester]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Semester data not found' });
    }

    const row = result.rows[0];
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

// 保存学期数据
router.post('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { courseId, grade, semester, units, weeklyPeriods } = req.body;

    const result = await pool.query(
      `INSERT INTO semester_data (user_id, course_id, grade, semester, units, weekly_periods)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, course_id, grade, semester)
       DO UPDATE SET units = $5, weekly_periods = $6, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, courseId, grade, semester, JSON.stringify(units || []), weeklyPeriods]
    );

    const row = result.rows[0];
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

// 删除学期数据
router.delete('/:courseId/:grade/:semester', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { courseId, grade, semester } = req.params;

    const result = await pool.query(
      `DELETE FROM semester_data 
       WHERE user_id = $1 AND course_id = $2 AND grade = $3 AND semester = $4
       RETURNING id`,
      [userId, courseId, parseInt(grade), semester]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Semester data not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete semester data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
