-- 课堂助手云端同步：分组方案、小组、成员、积分事件（全校共享，与班级管理一致）
-- 执行：psql $DATABASE_URL -f apps/api/src/config/migrate-add-class-assistant.sql

-- 分组方案
CREATE TABLE IF NOT EXISTS class_group_schemes (
  id VARCHAR(80) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  scope VARCHAR(30) NOT NULL DEFAULT 'class-default',
  subject VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_class_group_schemes_class_id ON class_group_schemes(class_id);

-- 小组
CREATE TABLE IF NOT EXISTS class_groups (
  id VARCHAR(80) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  scheme_id VARCHAR(80) NOT NULL REFERENCES class_group_schemes(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  scope VARCHAR(30) NOT NULL DEFAULT 'class-default',
  subject VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_class_groups_class_scheme ON class_groups(class_id, scheme_id);

-- 小组成员
CREATE TABLE IF NOT EXISTS class_group_members (
  id VARCHAR(80) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  scheme_id VARCHAR(80) NOT NULL REFERENCES class_group_schemes(id) ON DELETE CASCADE,
  group_id VARCHAR(80) NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_class_group_members_class_scheme ON class_group_members(class_id, scheme_id);

-- 积分事件（个人/小组）
CREATE TABLE IF NOT EXISTS class_point_events (
  id VARCHAR(80) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  scheme_id VARCHAR(80) REFERENCES class_group_schemes(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('individual', 'group')),
  student_id VARCHAR(50) REFERENCES students(id) ON DELETE SET NULL,
  group_id VARCHAR(80) REFERENCES class_groups(id) ON DELETE SET NULL,
  delta INTEGER NOT NULL,
  reason VARCHAR(200),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_class_point_events_class_id ON class_point_events(class_id);
CREATE INDEX IF NOT EXISTS idx_class_point_events_class_scheme ON class_point_events(class_id, scheme_id);
