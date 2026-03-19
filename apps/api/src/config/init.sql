-- 用户表（保留 password 用于迁移期，password_hash 用于新认证）
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255),
  password_hash VARCHAR(255),
  role VARCHAR(20) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 若表已存在则只加列（迁移脚本可单独跑）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'department') THEN
    ALTER TABLE users ADD COLUMN department VARCHAR(100);
  END IF;
END $$;

-- 预设用户：密码将在首次部署时由 seed 写入哈希（见 scripts/seed-users.ts 或 init 说明）
-- 角色：system-admin 系统管理员 | admin 管理员 | teacher 教师
INSERT INTO users (id, username, password, role, display_name) VALUES
  ('admin-1', 'Admin', '4321', 'system-admin', '总管理员')
ON CONFLICT (username) DO NOTHING;

-- 课程表
CREATE TABLE IF NOT EXISTS courses (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  subject_category_zh VARCHAR(100),
  subject_category_en VARCHAR(100),
  grade_range VARCHAR(20),
  textbook_version VARCHAR(100),
  color VARCHAR(20) NOT NULL,
  weekly_periods INTEGER DEFAULT 2,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 学期数据表
CREATE TABLE IF NOT EXISTS semester_data (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id VARCHAR(50) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 9),
  semester VARCHAR(20) NOT NULL CHECK (semester IN ('Semester 1', 'Semester 2')),
  weekly_periods INTEGER,
  units JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, course_id, grade, semester)
);

-- 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  key_concepts JSONB DEFAULT '[]'::jsonb,
  category_order JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_user_id ON semester_data(user_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_course_id ON semester_data(course_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_lookup ON semester_data(user_id, course_id, grade, semester);

-- 班级管理（1.3）：学年、班级、学生、学籍（全校共享，不按 user_id 隔离；仅 admin 可写）
CREATE TABLE IF NOT EXISTS academic_years (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_academic_years_current ON academic_years(is_current) WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS classes (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 9),
  name VARCHAR(100) NOT NULL,
  teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_classes_academic_year_id ON classes(academic_year_id);

-- 班级-教师关联（优化）：支持多个教师关联同一班级；取消关联时写 unassigned_at 以保留历史
CREATE TABLE IF NOT EXISTS class_teacher_assignments (
  id VARCHAR(80) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL DEFAULT 'co-teacher',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_class_active ON class_teacher_assignments(class_id) WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher_active ON class_teacher_assignments(teacher_id) WHERE unassigned_at IS NULL;

CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  gender VARCHAR(20) NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  grade VARCHAR(50),
  student_number VARCHAR(50),
  date_of_birth DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_enrollments_class_id ON student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON student_enrollments(student_id);

-- 课堂助手（1.4）：分组方案、小组、成员、积分事件
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
