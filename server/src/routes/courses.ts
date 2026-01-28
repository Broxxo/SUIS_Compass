import express from 'express';
import pool from '../config/database';

const router = express.Router();

// 获取所有课程
router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      'SELECT * FROM courses WHERE user_id = $1 ORDER BY created_at ASC',
      [userId]
    );

    // 转换数据格式以匹配前端类型
    const courses = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      subjectCategory: row.subject_category_zh && row.subject_category_en
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

// 创建课程
router.post('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id, name, subjectCategory, gradeRange, textbookVersion, color, weeklyPeriods } = req.body;

    const subjectCategoryZh = typeof subjectCategory === 'object' ? subjectCategory.zh : subjectCategory;
    const subjectCategoryEn = typeof subjectCategory === 'object' ? subjectCategory.en : '';

    const result = await pool.query(
      `INSERT INTO courses (id, user_id, name, subject_category_zh, subject_category_en, grade_range, textbook_version, color, weekly_periods)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, userId, name, subjectCategoryZh, subjectCategoryEn, gradeRange, textbookVersion, color, weeklyPeriods || 2]
    );

    const course = result.rows[0];
    res.status(201).json({
      id: course.id,
      name: course.name,
      subjectCategory: course.subject_category_zh && course.subject_category_en
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

// 更新课程
router.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { name, subjectCategory, gradeRange, textbookVersion, color, weeklyPeriods } = req.body;

    const subjectCategoryZh = typeof subjectCategory === 'object' ? subjectCategory.zh : subjectCategory;
    const subjectCategoryEn = typeof subjectCategory === 'object' ? subjectCategory.en : '';

    const result = await pool.query(
      `UPDATE courses 
       SET name = $1, subject_category_zh = $2, subject_category_en = $3, grade_range = $4, 
           textbook_version = $5, color = $6, weekly_periods = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [name, subjectCategoryZh, subjectCategoryEn, gradeRange, textbookVersion, color, weeklyPeriods || 2, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const course = result.rows[0];
    res.json({
      id: course.id,
      name: course.name,
      subjectCategory: course.subject_category_zh && course.subject_category_en
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

// 删除课程
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM courses WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
