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
  name_zh VARCHAR(100),
  name_en VARCHAR(100),
  gender VARCHAR(20) NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  current_grade INTEGER CHECK (current_grade >= 1 AND current_grade <= 12),
  current_class_id VARCHAR(50),
  division VARCHAR(50),
  entry_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated', 'leave', 'withdrawn')),
  student_number VARCHAR(50),
  date_of_birth DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_number_unique ON students(student_number) WHERE student_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_current_class_id ON students(current_class_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

-- 学生登录：users.student_id 关联 students（须在 students 表创建之后执行）
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id_unique ON users(student_id) WHERE student_id IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'users' AND constraint_name = 'users_student_id_fkey'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 兼容旧库：增量补列
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'name_zh') THEN
    ALTER TABLE students ADD COLUMN name_zh VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'name_en') THEN
    ALTER TABLE students ADD COLUMN name_en VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'current_grade') THEN
    ALTER TABLE students ADD COLUMN current_grade INTEGER CHECK (current_grade >= 1 AND current_grade <= 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'current_class_id') THEN
    ALTER TABLE students ADD COLUMN current_class_id VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'division') THEN
    ALTER TABLE students ADD COLUMN division VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'entry_date') THEN
    ALTER TABLE students ADD COLUMN entry_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'status') THEN
    ALTER TABLE students ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS student_enrollments (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_enrollments_class_id ON student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON student_enrollments(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_unique_per_year ON student_enrollments(student_id, academic_year_id);

-- 学籍历史轨迹（权威）
CREATE TABLE IF NOT EXISTS student_assignment_history (
  id VARCHAR(80) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  class_id VARCHAR(50) REFERENCES classes(id) ON DELETE SET NULL,
  grade INTEGER CHECK (grade >= 1 AND grade <= 12),
  division VARCHAR(50),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  source VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'promotion', 'import', 'sync')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_assignment_history_student ON student_assignment_history(student_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_student_assignment_history_year ON student_assignment_history(academic_year_id);

-- 学生画像可扩展模块定义
CREATE TABLE IF NOT EXISTS student_profile_modules (
  id VARCHAR(80) PRIMARY KEY,
  key VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_profile_module_fields (
  id VARCHAR(80) PRIMARY KEY,
  module_id VARCHAR(80) NOT NULL REFERENCES student_profile_modules(id) ON DELETE CASCADE,
  field_key VARCHAR(80) NOT NULL,
  label VARCHAR(120) NOT NULL,
  field_type VARCHAR(30) NOT NULL CHECK (field_type IN ('text', 'number', 'single-select', 'multi-select', 'score')),
  score_min NUMERIC,
  score_max NUMERIC,
  options JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(module_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_student_profile_module_fields_module ON student_profile_module_fields(module_id, sort_order ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS student_profile_values (
  id VARCHAR(100) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  module_id VARCHAR(80) NOT NULL REFERENCES student_profile_modules(id) ON DELETE CASCADE,
  field_key VARCHAR(80) NOT NULL,
  value_json JSONB NOT NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, module_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_student_profile_values_student ON student_profile_values(student_id, module_id);

-- 默认系统模块：能力雷达（分值 0-10，维度可扩展）
INSERT INTO student_profile_modules (id, key, name, description, is_system, is_enabled)
VALUES ('spm-ability', 'ability', '能力画像', '能力雷达图模块，默认分值范围 0-10', TRUE, TRUE)
ON CONFLICT (key) DO NOTHING;

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
