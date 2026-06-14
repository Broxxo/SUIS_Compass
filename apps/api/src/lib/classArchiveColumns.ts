import type { Pool, PoolClient } from 'pg';
import pool from '../config/database.js';
import { createRunOnce } from './runOnce.js';

const ensureOnce = createRunOnce();

export async function ensureClassArchiveColumns(db: Pool | PoolClient = pool): Promise<void> {
  await ensureOnce.run(async () => {
    await db.query(`
      ALTER TABLE classes
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS archive_label VARCHAR(200)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_classes_archived_at
      ON classes(academic_year_id, archived_at)
      WHERE archived_at IS NOT NULL
    `);
  });
}
