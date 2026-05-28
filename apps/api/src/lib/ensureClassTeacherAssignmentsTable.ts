import type { Pool, PoolClient } from 'pg';
import { createRunOnce } from './runOnce.js';

const ensureOnce = createRunOnce();

/** 班级-教师关联表（班主任 / 历史任课）；与 classes 路由共用 */
export async function ensureClassTeacherAssignmentsTable(db: Pool | PoolClient): Promise<void> {
  await ensureOnce.run(async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS class_teacher_assignments (
      id VARCHAR(80) PRIMARY KEY,
      class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(30) NOT NULL DEFAULT 'co-teacher',
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unassigned_at TIMESTAMP
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_class_active
      ON class_teacher_assignments(class_id) WHERE unassigned_at IS NULL;
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher_active
      ON class_teacher_assignments(teacher_id) WHERE unassigned_at IS NULL;
  `);
  });
}
