import express, { Request } from 'express';
import pool from '../config/database.js';

const router = express.Router();

function userId(req: Request): string {
  return ((req as Request & { userId?: string }).userId ?? req.headers['x-user-id']) as string;
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

type GradeConfigItem = { id: string; label: string; level: number };
type GradeConfigSegment = { id: string; label: string; gradeIds: string[] };
type GradeConfig = { items: GradeConfigItem[]; segments?: GradeConfigSegment[] };

function buildDefaultGradeConfig(): GradeConfig {
  return {
    items: Array.from({ length: 9 }, (_, i) => {
      const level = i + 1;
      return { id: `g${level}`, label: `G${level}`, level };
    }),
  };
}

function normalizeSegments(
  rawSegments: unknown,
  itemById: Map<string, GradeConfigItem>,
): GradeConfigSegment[] | undefined {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return undefined;
  const usedGradeIds = new Set<string>();
  const out: GradeConfigSegment[] = [];
  for (const seg of rawSegments) {
    if (!seg || typeof seg !== 'object') continue;
    const rec = seg as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const label = String(rec.label ?? '').trim();
    if (!id || !label) continue;
    const rawIds = Array.isArray(rec.gradeIds) ? rec.gradeIds : [];
    const gradeIds: string[] = [];
    for (const g of rawIds) {
      const gid = String(g ?? '').trim();
      if (!gid || !itemById.has(gid) || usedGradeIds.has(gid)) continue;
      usedGradeIds.add(gid);
      gradeIds.push(gid);
    }
    out.push({ id, label, gradeIds });
  }
  if (out.length === 0) return undefined;
  const cleaned = out.filter((s) => s.gradeIds.length > 0);
  if (cleaned.length === 0) return undefined;
  const used = new Set(cleaned.flatMap((s) => s.gradeIds));
  const allIds = new Set(itemById.keys());
  for (const id of allIds) {
    if (!used.has(id)) {
      const last = cleaned[cleaned.length - 1];
      last.gradeIds.push(id);
      used.add(id);
    }
  }
  return cleaned;
}

function normalizeGradeConfig(input: unknown): GradeConfig {
  const defaults = buildDefaultGradeConfig();
  if (!input || typeof input !== 'object' || !Array.isArray((input as { items?: unknown }).items)) {
    return defaults;
  }
  const rawItems = (input as { items: unknown[] }).items;
  const seen = new Set<string>();
  const items: GradeConfigItem[] = [];
  rawItems.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const rec = it as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const label = String(rec.label ?? '').trim();
    const level = Number(rec.level);
    if (!id || !label) return;
    if (!Number.isFinite(level) || level < 1 || level > 20) return;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({ id, label, level: Math.round(level) });
  });
  if (items.length === 0) return defaults;
  items.sort((a, b) => a.level - b.level);
  const itemById = new Map(items.map((it) => [it.id, it]));
  const rawSeg = (input as { segments?: unknown }).segments;
  const segments = normalizeSegments(rawSeg, itemById);
  return segments ? { items, segments } : { items };
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

/** 全校共享：年级配置（唯一） */
router.get('/grade-config', async (req, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const holderId = await getSchoolCategoryOrderHolderId(uid);
    const result = await pool.query(`SELECT grade_config FROM user_settings WHERE user_id = $1`, [holderId]);
    if (result.rows.length === 0) return res.json(buildDefaultGradeConfig());
    const raw = (result.rows[0] as Record<string, unknown>).grade_config;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    res.json(normalizeGradeConfig(parsed));
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

    const normalized = normalizeGradeConfig((req.body as { gradeConfig?: unknown })?.gradeConfig);
    const holderId = await getSchoolCategoryOrderHolderId(uid);

    await pool.query(
      `INSERT INTO user_settings (user_id, grade_config, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET grade_config = EXCLUDED.grade_config, updated_at = CURRENT_TIMESTAMP`,
      [holderId, JSON.stringify(normalized)],
    );

    res.json({ success: true, gradeConfig: normalized });
  } catch (error) {
    console.error('Save grade config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
