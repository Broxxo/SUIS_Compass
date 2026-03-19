-- Add class_teacher_assignments table for multi-teacher class visibility

CREATE TABLE IF NOT EXISTS class_teacher_assignments (
  id VARCHAR(80) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL DEFAULT 'co-teacher',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_class_active
  ON class_teacher_assignments(class_id) WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher_active
  ON class_teacher_assignments(teacher_id) WHERE unassigned_at IS NULL;

-- Backfill legacy single teacher_id into assignments (homeroom)
INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role, assigned_at)
SELECT
  'cta-' || c.id || '-' || c.teacher_id,
  c.id,
  c.teacher_id,
  'homeroom',
  COALESCE(c.created_at, CURRENT_TIMESTAMP)
FROM classes c
WHERE c.teacher_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM class_teacher_assignments a
    WHERE a.class_id = c.id
      AND a.teacher_id = c.teacher_id
      AND a.unassigned_at IS NULL
  );

