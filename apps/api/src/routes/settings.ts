import express, { Request } from 'express';
import pool from '../config/database.js';
import { loadSchoolGradeStructure, saveSchoolGradeStructure } from '../lib/schoolGradeStructure.js';
import {
  loadSchoolTeachingResearchGroups,
  saveSchoolTeachingResearchGroups,
} from '../lib/schoolTeachingResearchGroups.js';
import {
  loadSchoolTeachingSubjectGroups,
  saveSchoolTeachingSubjectGroups,
} from '../lib/schoolTeachingSubjectGroups.js';
import { normalizeCourseDomainsConfig } from '@repo/shared';

const router = express.Router();
let ensuredCourseDomainsColumn = false;

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
}

/**
 * 兼容存量数据库：运行时确保 user_settings.course_domains 列存在，
 * 避免未执行最新 init.sql 时出现“前端已生效但保存报错”。
 */
async function ensureCourseDomainsColumn(): Promise<void> {
  if (ensuredCourseDomainsColumn) return;
  await pool.query(
    `ALTER TABLE user_settings
     ADD COLUMN IF NOT EXISTS course_domains JSONB DEFAULT '{"domains":[],"domainOrder":[]}'::jsonb`,
  );
  ensuredCourseDomainsColumn = true;
}

/** 学科列顺序的全校唯一存储行：优先首位 system-admin，否则首位 admin（与 PUT 写入目标一致） */
async function getSchoolCategoryOrderHolderId(fallbackUserId: string): Promise<string> {
  const sa = await pool.query(
    `SELECT id FROM users WHERE role = 'system-admin' ORDER BY created_at ASC NULLS LAST LIMIT 1`,
  );
  if (sa.rows[0]) return (sa.rows[0] as { id: string }).id;
  const ad = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC NULLS LAST LIMIT 1`,
  );
  if (ad.rows[0]) return (ad.rows[0] as { id: string }).id;
  return fallbackUserId;
}

router.get('/key-concepts', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    // 全校共享：返回最近一次由 system-admin 维护的关键概念列表（教师只读与课程河流一致）
    const result = await pool.query(
      `SELECT s.key_concepts
       FROM user_settings s
       INNER JOIN users u ON u.id = s.user_id AND u.role = 'system-admin'
       WHERE s.key_concepts IS NOT NULL
       ORDER BY s.updated_at DESC NULLS LAST
       LIMIT 1`,
    );
    if (result.rows.length === 0) return res.json([]);
    const keyConcepts = (result.rows[0] as Record<string, unknown>).key_concepts || [];
    res.json(keyConcepts);
  } catch (error) {
    console.error('Get key concepts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/key-concepts', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin') {
      return res.status(403).json({ error: 'Forbidden: system-admin required to edit key concepts' });
    }

    const { keyConcepts } = req.body;
    if (!Array.isArray(keyConcepts)) return res.status(400).json({ error: 'keyConcepts must be an array' });

    await pool.query(
      `INSERT INTO user_settings (user_id, key_concepts, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET key_concepts = $2, updated_at = CURRENT_TIMESTAMP`,
      [uid, JSON.stringify(keyConcepts)]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Save key concepts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 全校共享：学科列顺序存于 holder 用户的 user_settings.category_order */
router.get('/category-order', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const holderId = await getSchoolCategoryOrderHolderId(uid);
    const result = await pool.query(
      `SELECT category_order FROM user_settings WHERE user_id = $1`,
      [holderId],
    );
    if (result.rows.length === 0) return res.json([]);
    const raw = (result.rows[0] as Record<string, unknown>).category_order;
    if (raw == null) return res.json([]);
    const parsed = typeof raw === 'string' ? JSON.parse(raw as string) : raw;
    if (!Array.isArray(parsed) || parsed.length === 0) return res.json([]);
    res.json(parsed);
  } catch (error) {
    console.error('Get category order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/category-order', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin or system-admin required' });
    }

    const { categoryOrder } = req.body as { categoryOrder?: unknown };
    if (!Array.isArray(categoryOrder) || !categoryOrder.every((x) => typeof x === 'string')) {
      return res.status(400).json({ error: 'categoryOrder must be an array of strings' });
    }

    const holderId = await getSchoolCategoryOrderHolderId(uid);

    await pool.query(
      `INSERT INTO user_settings (user_id, category_order, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET category_order = EXCLUDED.category_order, updated_at = CURRENT_TIMESTAMP`,
      [holderId, JSON.stringify(categoryOrder)],
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Save category order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 全校共享：课程领域（存于 holder 用户的 user_settings.course_domains） */
router.get('/course-domains', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    await ensureCourseDomainsColumn();

    const holderId = await getSchoolCategoryOrderHolderId(uid);
    const result = await pool.query(
      `SELECT course_domains FROM user_settings WHERE user_id = $1`,
      [holderId],
    );
    if (result.rows.length === 0) {
      return res.json(normalizeCourseDomainsConfig(null));
    }
    const raw = (result.rows[0] as Record<string, unknown>).course_domains;
    if (raw == null) return res.json(normalizeCourseDomainsConfig(null));
    const parsed = typeof raw === 'string' ? JSON.parse(raw as string) : raw;
    res.json(normalizeCourseDomainsConfig(parsed));
  } catch (error) {
    console.error('Get course domains error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/course-domains', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    await ensureCourseDomainsColumn();

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin or system-admin required' });
    }

    const normalized = normalizeCourseDomainsConfig((req.body as { courseDomains?: unknown })?.courseDomains ?? req.body);
    const holderId = await getSchoolCategoryOrderHolderId(uid);

    await pool.query(
      `INSERT INTO user_settings (user_id, course_domains, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET course_domains = EXCLUDED.course_domains, updated_at = CURRENT_TIMESTAMP`,
      [holderId, JSON.stringify(normalized)],
    );

    res.json({ success: true, courseDomains: normalized });
  } catch (error) {
    console.error('Save course domains error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 全校共享：学段与年级结构（school_settings.grade_structure） */
router.get('/school-grade-structure', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    res.json(await loadSchoolGradeStructure());
  } catch (error) {
    console.error('Get school grade structure error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/school-grade-structure', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin or system-admin required' });
    }

    const body = req.body as { gradeStructure?: unknown; gradeConfig?: unknown };
    const raw = body.gradeStructure ?? body.gradeConfig;
    const normalized = await saveSchoolGradeStructure(raw, uid);
    res.json({ success: true, gradeStructure: normalized, gradeConfig: normalized });
  } catch (error) {
    console.error('Save school grade structure error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** @deprecated 使用 /school-grade-structure；保留兼容旧客户端 */
router.get('/grade-config', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    res.json(await loadSchoolGradeStructure());
  } catch (error) {
    console.error('Get grade config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/grade-config', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin or system-admin required' });
    }

    const normalized = await saveSchoolGradeStructure(
      (req.body as { gradeConfig?: unknown })?.gradeConfig,
      uid,
    );
    res.json({ success: true, gradeConfig: normalized });
  } catch (error) {
    console.error('Save grade config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 全校教研共同体列表（职能岗位·学科组长） */
router.get('/teaching-research-groups', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const groups = await loadSchoolTeachingResearchGroups();
    res.json({ groups });
  } catch (error) {
    console.error('Get teaching research groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/teaching-research-groups', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin or system-admin required' });
    }

    const raw = (req.body as { groups?: unknown })?.groups;
    const groups = await saveSchoolTeachingResearchGroups(raw, uid);
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Save teaching research groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** 全校学科组定义（教学管理） */
router.get('/teaching-subject-groups', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const groups = await loadSchoolTeachingSubjectGroups();
    res.json({ groups });
  } catch (error) {
    console.error('Get teaching subject groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/teaching-subject-groups', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [uid]);
    const role = roleResult.rows[0]?.role as string | undefined;
    if (role !== 'system-admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin or system-admin required' });
    }

    const raw = (req.body as { groups?: unknown })?.groups;
    const groups = await saveSchoolTeachingSubjectGroups(raw, uid);
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Save teaching subject groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
