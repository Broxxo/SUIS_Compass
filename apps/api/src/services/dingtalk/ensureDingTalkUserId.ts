import pool from '../../config/database.js';

let ensured = false;

export async function ensureDingTalkUserIdColumn(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    ALTER TABLE students ADD COLUMN IF NOT EXISTS dingtalk_user_id VARCHAR(100);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_dingtalk_user_id_unique
    ON students(dingtalk_user_id) WHERE dingtalk_user_id IS NOT NULL;
  `);
  ensured = true;
}
