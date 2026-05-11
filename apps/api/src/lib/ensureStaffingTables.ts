import pool from '../config/database.js';

let ensuredStaffingTables = false;

/** 班级-学科教师岗位表（含 teacher_slot 迁移）；与 admin 岗位接口共用 */
export async function ensureStaffingTables(): Promise<void> {
  if (ensuredStaffingTables) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_subject_teacher_assignments (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_key VARCHAR(120) NOT NULL,
      subject_name VARCHAR(160) NOT NULL,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(academic_year_id, class_id, subject_key)
    )
  `);
  await pool.query(`
    ALTER TABLE class_subject_teacher_assignments
      ADD COLUMN IF NOT EXISTS teacher_slot SMALLINT NOT NULL DEFAULT 0
  `);
  await pool.query(`
    UPDATE class_subject_teacher_assignments SET teacher_slot = 0 WHERE teacher_slot IS NULL OR teacher_slot NOT IN (0, 1)
  `);
  await pool.query(`
    DO $$
    DECLARE cname text;
    BEGIN
      SELECT con.conname INTO cname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'class_subject_teacher_assignments'
        AND con.contype = 'u'
        AND array_length(con.conkey, 1) = 3
      LIMIT 1;
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE class_subject_teacher_assignments DROP CONSTRAINT IF EXISTS %I', cname);
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$
  `);
  await pool.query(`
    ALTER TABLE class_subject_teacher_assignments
      DROP CONSTRAINT IF EXISTS class_subject_teacher_assignments_slot_unique
  `);
  await pool.query(`
    ALTER TABLE class_subject_teacher_assignments
      ADD CONSTRAINT class_subject_teacher_assignments_slot_unique
      UNIQUE (academic_year_id, class_id, subject_key, teacher_slot)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_csta_year_class
      ON class_subject_teacher_assignments(academic_year_id, class_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_csta_teacher
      ON class_subject_teacher_assignments(teacher_id)
  `);
  ensuredStaffingTables = true;
}
