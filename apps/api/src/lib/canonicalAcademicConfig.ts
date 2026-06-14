import type { Pool, PoolClient } from 'pg';
import pool from '../config/database.js';
import { ensureSchoolSettingsTable } from './schoolGradeStructure.js';

let ensuredColumn = false;

async function ensureCanonicalColumn(db: Pool | PoolClient = pool): Promise<void> {
  await ensureSchoolSettingsTable();
  if (ensuredColumn) return;
  await db.query(`
    ALTER TABLE school_settings
    ADD COLUMN IF NOT EXISTS canonical_config_academic_year_id VARCHAR(50)
      REFERENCES academic_years(id) ON DELETE SET NULL
  `);
  ensuredColumn = true;
}

/** 学业报告预设、教师画像采集配置等全校共用配置所挂靠的学年 id */
export async function getCanonicalConfigAcademicYearId(db: Pool | PoolClient = pool): Promise<string | null> {
  await ensureCanonicalColumn(db);
  const row = (await db.query(
    `SELECT canonical_config_academic_year_id FROM school_settings WHERE id = 'default' LIMIT 1`,
  )).rows[0] as { canonical_config_academic_year_id?: string | null } | undefined;
  const id = String(row?.canonical_config_academic_year_id ?? '').trim();
  return id || null;
}

export async function setCanonicalConfigAcademicYearId(
  academicYearId: string,
  db: Pool | PoolClient = pool,
): Promise<void> {
  const id = String(academicYearId ?? '').trim();
  if (!id) return;
  await ensureCanonicalColumn(db);
  await db.query(
    `INSERT INTO school_settings (id, canonical_config_academic_year_id, updated_at)
     VALUES ('default', $1, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       canonical_config_academic_year_id = EXCLUDED.canonical_config_academic_year_id,
       updated_at = CURRENT_TIMESTAMP`,
    [id],
  );
}

/** 解析请求学年 → 实际读取全校共用配置的学年 id */
export async function resolveConfigAcademicYearId(
  requestedYearId: string,
  db: Pool | PoolClient = pool,
): Promise<string> {
  const req = String(requestedYearId ?? '').trim();
  const canonical = await getCanonicalConfigAcademicYearId(db);
  if (canonical) return canonical;
  if (req) {
    await setCanonicalConfigAcademicYearId(req, db);
    return req;
  }
  const cur = (await db.query(
    `SELECT id FROM academic_years WHERE is_current = TRUE ORDER BY updated_at DESC LIMIT 1`,
  )).rows[0] as { id: string } | undefined;
  if (cur?.id) {
    await setCanonicalConfigAcademicYearId(cur.id, db);
    return cur.id;
  }
  return req;
}
