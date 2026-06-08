import pool from '../config/database.js';

export type GradeConfigItem = { id: string; label: string; level: number };
export type GradeConfigSegment = { id: string; label: string; gradeIds: string[] };
export type GradeConfig = { items: GradeConfigItem[]; segments?: GradeConfigSegment[] };

let ensuredSchoolSettingsTable = false;

export async function ensureSchoolSettingsTable(): Promise<void> {
  if (ensuredSchoolSettingsTable) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_settings (
      id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
      grade_structure JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  ensuredSchoolSettingsTable = true;
}

export async function getSchoolSettingsHolderUserId(): Promise<string | null> {
  const sa = await pool.query(
    `SELECT id FROM users WHERE role = 'system-admin' ORDER BY created_at ASC NULLS LAST LIMIT 1`,
  );
  if (sa.rows[0]) return String((sa.rows[0] as { id: string }).id).trim();
  const ad = await pool.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC NULLS LAST LIMIT 1`);
  return (ad.rows[0] as { id: string } | undefined)?.id ? String((ad.rows[0] as { id: string }).id).trim() : null;
}

export function buildDefaultGradeConfig(): GradeConfig {
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

export function normalizeGradeConfig(input: unknown): GradeConfig {
  const defaults = buildDefaultGradeConfig();
  if (!input || typeof input !== 'object' || !Array.isArray((input as { items?: unknown }).items)) {
    return defaults;
  }
  const rawItems = (input as { items: unknown[] }).items;
  const seen = new Set<string>();
  const items: GradeConfigItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const label = String(rec.label ?? '').trim();
    const level = Number(rec.level);
    if (!id || !label || !Number.isFinite(level) || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label, level: Math.round(level) });
  }
  if (items.length === 0) return defaults;
  items.sort((a, b) => a.level - b.level);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const segments = normalizeSegments((input as { segments?: unknown }).segments, itemById);
  return segments ? { items, segments } : { items };
}

async function loadLegacyGradeConfigFromHolder(holderId: string): Promise<GradeConfig | null> {
  const result = await pool.query(`SELECT grade_config FROM user_settings WHERE user_id = $1`, [holderId]);
  if (result.rows.length === 0) return null;
  const raw = (result.rows[0] as Record<string, unknown>).grade_config;
  if (raw == null) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return normalizeGradeConfig(parsed);
}

async function persistGradeStructure(config: GradeConfig, updatedBy: string | null): Promise<void> {
  await ensureSchoolSettingsTable();
  await pool.query(
    `INSERT INTO school_settings (id, grade_structure, updated_at, updated_by)
     VALUES ('default', $1::jsonb, CURRENT_TIMESTAMP, $2)
     ON CONFLICT (id)
     DO UPDATE SET
       grade_structure = EXCLUDED.grade_structure,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(config), updatedBy],
  );
}

/** 读取全校学段与年级结构：优先 school_settings，否则从 user_settings.grade_config 迁移 */
export async function loadSchoolGradeStructure(): Promise<GradeConfig> {
  await ensureSchoolSettingsTable();
  const row = await pool.query(
    `SELECT grade_structure FROM school_settings WHERE id = 'default' LIMIT 1`,
  );
  const raw = (row.rows[0] as { grade_structure?: unknown } | undefined)?.grade_structure;
  if (raw != null) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeGradeConfig(parsed);
  }

  const holderId = await getSchoolSettingsHolderUserId();
  if (!holderId) return buildDefaultGradeConfig();

  const legacy = await loadLegacyGradeConfigFromHolder(holderId);
  if (!legacy) return buildDefaultGradeConfig();

  await persistGradeStructure(legacy, null);
  return legacy;
}

/** 保存全校学段与年级结构到 school_settings */
export async function saveSchoolGradeStructure(
  input: unknown,
  updatedBy: string | null,
): Promise<GradeConfig> {
  const normalized = normalizeGradeConfig(input);
  await persistGradeStructure(normalized, updatedBy);
  return normalized;
}

export async function loadGradeConfigItemsForReport(): Promise<Array<{ id: string; level: number }>> {
  const cfg = await loadSchoolGradeStructure();
  const fallback = () =>
    Array.from({ length: 9 }, (_, i) => ({
      id: `g${i + 1}`,
      level: i + 1,
    }));
  const out: Array<{ id: string; level: number }> = [];
  for (const it of cfg.items) {
    out.push({ id: it.id, level: it.level });
  }
  return out.length > 0 ? out.sort((a, b) => a.level - b.level) : fallback();
}

export async function loadSegmentGradeIds(segmentId: string): Promise<string[]> {
  const sid = String(segmentId ?? '').trim();
  if (!sid) return [];
  const cfg = await loadSchoolGradeStructure();
  const segments = cfg.segments;
  if (!Array.isArray(segments)) return [];
  const hit = segments.find((s) => s.id === sid);
  if (!hit || !Array.isArray(hit.gradeIds)) return [];
  return hit.gradeIds.map((g) => String(g ?? '').trim()).filter(Boolean);
}

/** 与前端 gradeConfig.getGradeCatalogIdForClass 一致：班名/学部可映射到 G9I、G9C 等 catalog */
export function getGradeCatalogIdForClass(
  config: GradeConfig,
  classGrade: number,
  opts?: { className?: string; division?: string | null },
): string {
  const norm = normalizeGradeConfig(config);
  const name = String(opts?.className ?? '').trim().toUpperCase();
  const div = String(opts?.division ?? '').trim().toUpperCase();
  if (name === 'S9A' || div === 'G9I') {
    const hit = norm.items.find((i) => i.label === 'G9I');
    if (hit) return hit.id;
  }
  if (name === 'S9B' || div === 'G9C') {
    const hit = norm.items.find((i) => i.label === 'G9C');
    if (hit) return hit.id;
  }
  const hit = norm.items.find((i) => i.level === classGrade);
  return hit?.id ?? `g${classGrade}`;
}

/** 班级是否属于报告模板学段（按年级 catalog + 班名，与岗位安排学段划分一致） */
export function isClassInSegmentGrades(
  config: GradeConfig,
  cls: { grade: number; name: string },
  segmentGradeIds: string[],
): boolean {
  if (!segmentGradeIds.length) return true;
  const catalogId = getGradeCatalogIdForClass(config, cls.grade, { className: cls.name });
  return segmentGradeIds.includes(catalogId);
}
