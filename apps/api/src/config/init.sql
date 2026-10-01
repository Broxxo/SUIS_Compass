-- 用户表（password_hash 为认证；测试环境以本文件为库结构唯一来源，见 npm run db:init）
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255),
  password_hash VARCHAR(255),
  role VARCHAR(20) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  name_zh VARCHAR(100),
  name_en VARCHAR(100),
  department VARCHAR(100),
  primary_subject VARCHAR(120),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 已有库缺列时补齐（全新 CREATE 已含上述列）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'department') THEN
    ALTER TABLE users ADD COLUMN department VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'primary_subject') THEN
    ALTER TABLE users ADD COLUMN primary_subject VARCHAR(120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name_zh') THEN
    ALTER TABLE users ADD COLUMN name_zh VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name_en') THEN
    ALTER TABLE users ADD COLUMN name_en VARCHAR(100);
  END IF;
END $$;

-- 旧数据：将原 display_name 回填到 name_zh（测试库可整库 init 重建）
UPDATE users SET name_zh = display_name WHERE name_zh IS NULL AND display_name IS NOT NULL AND TRIM(display_name) <> '';

-- 预设用户：默认系统管理员 Admin / Suiscompass2019!（password_hash 预置，勿在 password 列存明文）
-- 角色：system-admin 系统管理员 | admin 管理员 | teacher 教师
INSERT INTO users (id, username, password, password_hash, role, display_name, name_zh) VALUES
  ('admin-1', 'Admin', NULL, '$2a$10$UKiOHMaAhEAD.GI6iA6bgugpEbODjmGNdta.7wdPrlhujaeUHK3Sm', 'system-admin', '系统管理员', '系统管理员')
ON CONFLICT (username) DO NOTHING;

-- 课程表（全校共享；通过权限控制写入）
CREATE TABLE IF NOT EXISTS courses (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  subject_category_zh VARCHAR(100),
  subject_category_en VARCHAR(100),
  applicable_grades JSONB NOT NULL DEFAULT '[]'::jsonb,
  weekly_periods_by_grade JSONB NOT NULL DEFAULT '{}'::jsonb,
  co_teaching BOOLEAN NOT NULL DEFAULT FALSE,
  exclude_from_staffing BOOLEAN NOT NULL DEFAULT FALSE,
  textbook_version VARCHAR(100),
  color VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 测试版迁移：由旧 grade_range / weekly_periods 切到按年级 JSON（不保留旧数据语义）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'courses' AND column_name = 'grade_range') THEN
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS applicable_grades JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS weekly_periods_by_grade JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE courses DROP COLUMN IF EXISTS grade_range;
    ALTER TABLE courses DROP COLUMN IF EXISTS weekly_periods;
  END IF;
END $$;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS co_teaching BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS exclude_from_staffing BOOLEAN NOT NULL DEFAULT FALSE;

-- 学期数据表（全校共享；每课程-年级-学期唯一）
CREATE TABLE IF NOT EXISTS semester_data (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id VARCHAR(50) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 20),
  semester VARCHAR(20) NOT NULL CHECK (semester IN ('Semester 1', 'Semester 2')),
  weekly_periods INTEGER,
  units JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id, grade, semester)
);

-- 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  key_concepts JSONB DEFAULT '[]'::jsonb,
  category_order JSONB DEFAULT '[]'::jsonb,
  course_domains JSONB DEFAULT '{"domains":[],"domainOrder":[]}'::jsonb,
  grade_config JSONB DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS grade_config JSONB DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS course_domains JSONB DEFAULT '{"domains":[],"domainOrder":[]}'::jsonb;
DO $$
DECLARE
  holder_id VARCHAR(50);
BEGIN
  SELECT id INTO holder_id FROM users WHERE role = 'system-admin' ORDER BY created_at ASC NULLS LAST LIMIT 1;
  IF holder_id IS NULL THEN
    SELECT id INTO holder_id FROM users WHERE role = 'admin' ORDER BY created_at ASC NULLS LAST LIMIT 1;
  END IF;
  IF holder_id IS NOT NULL THEN
    INSERT INTO user_settings (user_id, grade_config, updated_at)
    VALUES (
      holder_id,
      '{"items":[{"id":"g1","label":"G1","level":1},{"id":"g2","label":"G2","level":2},{"id":"g3","label":"G3","level":3},{"id":"g4","label":"G4","level":4},{"id":"g5","label":"G5","level":5},{"id":"g6","label":"G6","level":6},{"id":"g7","label":"G7","level":7},{"id":"g8","label":"G8","level":8},{"id":"g9","label":"G9","level":9}]}'::jsonb,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id)
    DO UPDATE SET grade_config = COALESCE(user_settings.grade_config, EXCLUDED.grade_config), updated_at = CURRENT_TIMESTAMP;
  END IF;
END $$;

-- 学年表（须在 school_settings、classes 等引用 academic_years 的表之前创建）
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

-- 升学年操作日志（供测试环境「撤回升年」；每次 promote-to-next 写入一条）
CREATE TABLE IF NOT EXISTS academic_year_promotion_log (
  id VARCHAR(80) PRIMARY KEY,
  source_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  target_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  promoted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  undone_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ay_promotion_log_target
  ON academic_year_promotion_log(target_year_id, promoted_at DESC);

-- 全校基础设置：学段与年级结构（自 user_settings.grade_config 迁移）
CREATE TABLE IF NOT EXISTS school_settings (
  id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
  grade_structure JSONB,
  teaching_research_groups JSONB,
  teaching_subject_groups JSONB,
  canonical_config_academic_year_id VARCHAR(50) REFERENCES academic_years(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_course_id ON semester_data(course_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_lookup ON semester_data(course_id, grade, semester);

-- 兼容旧库：semester_data 去除 user_id 隔离唯一约束，改为全校共享唯一键
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT conname INTO old_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'semester_data'::regclass
    AND contype = 'u'
    AND conname <> 'semester_data_course_id_grade_semester_key'
    AND pg_get_constraintdef(oid) LIKE '%user_id, course_id, grade, semester%';

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE semester_data DROP CONSTRAINT %I', old_constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_semester_data_course_grade_term_unique
  ON semester_data(course_id, grade, semester);
DROP INDEX IF EXISTS idx_semester_data_user_id;

-- 班级管理（1.3）：班级、学生、学籍（全校共享，不按 user_id 隔离；仅 admin 可写）
CREATE TABLE IF NOT EXISTS classes (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 20),
  name VARCHAR(100) NOT NULL,
  teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  archived_at TIMESTAMP,
  archive_label VARCHAR(200),
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

-- 将 classes.teacher_id 同步为班主任岗位（幂等；测试环境可整库 init 重建）
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

-- 班级-学科教师岗位安排（按学年版本化）
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
);
CREATE INDEX IF NOT EXISTS idx_csta_year_class ON class_subject_teacher_assignments(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_csta_teacher ON class_subject_teacher_assignments(teacher_id);

-- 职能岗位（年级组长、学科组长等；班主任仍走 class_subject_teacher_assignments）
CREATE TABLE IF NOT EXISTS functional_role_assignments (
  id VARCHAR(100) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  role_type VARCHAR(40) NOT NULL CHECK (role_type IN ('grade-head', 'subject-group-head')),
  scope_key VARCHAR(120) NOT NULL,
  scope_label VARCHAR(200),
  teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(academic_year_id, role_type, scope_key)
);
CREATE INDEX IF NOT EXISTS idx_functional_role_assignments_year_type
  ON functional_role_assignments(academic_year_id, role_type);

CREATE TABLE IF NOT EXISTS teaching_subject_group_members (
  id VARCHAR(100) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  group_id VARCHAR(80) NOT NULL,
  teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(academic_year_id, group_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_tsg_members_year_group
  ON teaching_subject_group_members(academic_year_id, group_id);

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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'dingtalk_user_id') THEN
    ALTER TABLE students ADD COLUMN dingtalk_user_id VARCHAR(100);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_dingtalk_user_id_unique
  ON students(dingtalk_user_id) WHERE dingtalk_user_id IS NOT NULL;

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

-- 学业报告（v1）：每学生每学期一份报告，含学科表现与班主任评语
CREATE TABLE IF NOT EXISTS student_term_reports (
  id VARCHAR(100) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
  template_id VARCHAR(100),
  homeroom_comment TEXT,
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, academic_year_id, term, template_id)
);
ALTER TABLE student_term_reports
  ADD COLUMN IF NOT EXISTS template_id VARCHAR(100);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_term_reports_student_id_academic_year_id_term_key'
  ) THEN
    ALTER TABLE student_term_reports DROP CONSTRAINT student_term_reports_student_id_academic_year_id_term_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_term_reports_student_term_template_unique
  ON student_term_reports(student_id, academic_year_id, term, COALESCE(template_id, ''));
CREATE INDEX IF NOT EXISTS idx_student_term_reports_student ON student_term_reports(student_id, academic_year_id, term, template_id);

CREATE TABLE IF NOT EXISTS student_term_subject_reports (
  id VARCHAR(100) PRIMARY KEY,
  report_id VARCHAR(100) NOT NULL REFERENCES student_term_reports(id) ON DELETE CASCADE,
  subject_key VARCHAR(80) NOT NULL,
  subject_name VARCHAR(120) NOT NULL,
  midterm_score NUMERIC(5,2),
  midterm_grade VARCHAR(10),
  final_score NUMERIC(5,2),
  final_grade VARCHAR(10),
  teacher_comment TEXT,
  learning_quality_grade VARCHAR(2),
  teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, subject_key)
);
ALTER TABLE student_term_subject_reports
  ADD COLUMN IF NOT EXISTS learning_quality_grade VARCHAR(2);
CREATE INDEX IF NOT EXISTS idx_student_term_subject_reports_report ON student_term_subject_reports(report_id);

CREATE TABLE IF NOT EXISTS student_term_target_dimensions (
  id VARCHAR(100) PRIMARY KEY,
  subject_report_id VARCHAR(100) NOT NULL REFERENCES student_term_subject_reports(id) ON DELETE CASCADE,
  dimension_key VARCHAR(80) NOT NULL,
  dimension_label VARCHAR(120) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_report_id, dimension_key)
);
CREATE INDEX IF NOT EXISTS idx_student_term_target_dimensions_subject ON student_term_target_dimensions(subject_report_id, sort_order);

CREATE TABLE IF NOT EXISTS student_term_target_level_descriptions (
  id VARCHAR(100) PRIMARY KEY,
  dimension_id VARCHAR(100) NOT NULL REFERENCES student_term_target_dimensions(id) ON DELETE CASCADE,
  level VARCHAR(1) NOT NULL CHECK (level IN ('A', 'B', 'C', 'D')),
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(dimension_id, level)
);

CREATE TABLE IF NOT EXISTS student_term_target_ratings (
  id VARCHAR(100) PRIMARY KEY,
  subject_report_id VARCHAR(100) NOT NULL REFERENCES student_term_subject_reports(id) ON DELETE CASCADE,
  dimension_id VARCHAR(100) NOT NULL REFERENCES student_term_target_dimensions(id) ON DELETE CASCADE,
  rating VARCHAR(1) NOT NULL CHECK (rating IN ('A', 'B', 'C', 'D')),
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_report_id, dimension_id)
);
CREATE INDEX IF NOT EXISTS idx_student_term_target_ratings_subject ON student_term_target_ratings(subject_report_id);

-- 学业报告模板（管理员配置；教师按模板填写）
CREATE TABLE IF NOT EXISTS student_report_templates (
  id VARCHAR(100) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
  title VARCHAR(160),
  template_type VARCHAR(40) NOT NULL DEFAULT 'portrait-evaluation',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMP,
  released_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK (homeroom_comment_mode IN ('disabled', 'optional', 'required')),
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_report_templates_academic_year_id_term_key'
  ) THEN
    ALTER TABLE student_report_templates DROP CONSTRAINT student_report_templates_academic_year_id_term_key;
  END IF;
END $$;
ALTER TABLE student_report_templates
  ADD COLUMN IF NOT EXISTS homeroom_comment_mode VARCHAR(20) NOT NULL DEFAULT 'optional';
ALTER TABLE student_report_templates
  ADD COLUMN IF NOT EXISTS template_type VARCHAR(40) NOT NULL DEFAULT 'portrait-evaluation';
ALTER TABLE student_report_templates
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE student_report_templates
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;
ALTER TABLE student_report_templates
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMP;
ALTER TABLE student_report_templates
  ADD COLUMN IF NOT EXISTS school_segment_id VARCHAR(120) NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS student_report_score_grade_bands (
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
  school_segment_id VARCHAR(120) NOT NULL DEFAULT '',
  min_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (academic_year_id, term, school_segment_id)
);
CREATE INDEX IF NOT EXISTS idx_report_score_grade_bands_year_init
  ON student_report_score_grade_bands(academic_year_id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_term_reports_template_id_fkey'
  ) THEN
    ALTER TABLE student_term_reports
      ADD CONSTRAINT student_term_reports_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES student_report_templates(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_student_report_templates_year_term
  ON student_report_templates(academic_year_id, term);
CREATE INDEX IF NOT EXISTS idx_student_report_templates_year_term_title
  ON student_report_templates(academic_year_id, term, title);

CREATE TABLE IF NOT EXISTS student_report_template_subjects (
  id VARCHAR(100) PRIMARY KEY,
  template_id VARCHAR(100) NOT NULL REFERENCES student_report_templates(id) ON DELETE CASCADE,
  subject_key VARCHAR(80) NOT NULL,
  subject_name VARCHAR(120) NOT NULL,
  subject_name_zh VARCHAR(120) NOT NULL DEFAULT '',
  subject_name_en VARCHAR(120) NOT NULL DEFAULT '',
  module_type VARCHAR(30) NOT NULL DEFAULT 'subject_score',
  enable_score BOOLEAN NOT NULL DEFAULT TRUE,
  enable_learning_quality BOOLEAN NOT NULL DEFAULT TRUE,
  enable_teacher_comment BOOLEAN NOT NULL DEFAULT TRUE,
  score_visibility VARCHAR(40) NOT NULL DEFAULT 'teacher_homeroom_admin',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(template_id, subject_key)
);
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS subject_name_zh VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS subject_name_en VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS module_type VARCHAR(30) NOT NULL DEFAULT 'subject_score';
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS enable_score BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS enable_teacher_comment BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS enable_learning_quality BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS score_visibility VARCHAR(40) NOT NULL DEFAULT 'teacher_homeroom_admin';
ALTER TABLE student_report_template_subjects
  ADD COLUMN IF NOT EXISTS grade_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_student_report_template_subjects_template
  ON student_report_template_subjects(template_id, sort_order);

CREATE TABLE IF NOT EXISTS student_report_template_dimensions (
  id VARCHAR(100) PRIMARY KEY,
  template_subject_id VARCHAR(100) NOT NULL REFERENCES student_report_template_subjects(id) ON DELETE CASCADE,
  dimension_key VARCHAR(80) NOT NULL,
  dimension_label VARCHAR(120) NOT NULL,
  dimension_label_zh VARCHAR(120) NOT NULL DEFAULT '',
  dimension_label_en VARCHAR(120) NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(template_subject_id, dimension_key)
);
ALTER TABLE student_report_template_dimensions
  ADD COLUMN IF NOT EXISTS dimension_label_zh VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE student_report_template_dimensions
  ADD COLUMN IF NOT EXISTS dimension_label_en VARCHAR(120) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_student_report_template_dimensions_subject
  ON student_report_template_dimensions(template_subject_id, sort_order);

CREATE TABLE IF NOT EXISTS student_report_template_level_descriptions (
  id VARCHAR(100) PRIMARY KEY,
  template_dimension_id VARCHAR(100) NOT NULL REFERENCES student_report_template_dimensions(id) ON DELETE CASCADE,
  level VARCHAR(1) NOT NULL CHECK (level IN ('A', 'B', 'C', 'D')),
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(template_dimension_id, level)
);

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

-- 全校组织架构部门（树形嵌套；仅 system-admin 可改，admin 只读）
CREATE TABLE IF NOT EXISTS org_departments (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  parent_id VARCHAR(50) REFERENCES org_departments(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_departments_parent ON org_departments(parent_id);

-- 教师画像：可配置的教师数据采集（如阶段教学反思 KISS）
CREATE TABLE IF NOT EXISTS teacher_portrait_collection_templates (
  id VARCHAR(100) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
  title VARCHAR(200),
  collection_type VARCHAR(60) NOT NULL DEFAULT 'teaching-diagnosis-kiss',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  published_at TIMESTAMP,
  target_departments JSONB,
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_teacher_portrait_collection_templates_year_term
  ON teacher_portrait_collection_templates(academic_year_id, term, updated_at DESC);

CREATE TABLE IF NOT EXISTS teacher_portrait_collection_submissions (
  id VARCHAR(100) PRIMARY KEY,
  template_id VARCHAR(100) NOT NULL REFERENCES teacher_portrait_collection_templates(id) ON DELETE CASCADE,
  teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diagnosis JSONB NOT NULL DEFAULT '{"keep":"","improve":"","stop":"","start":""}'::jsonb,
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(template_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_portrait_collection_submissions_template
  ON teacher_portrait_collection_submissions(template_id);

-- 自习岗位（按学年+学期；模块如课内自习、晚自习）
CREATE TABLE IF NOT EXISTS self_study_modules (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
  name VARCHAR(200) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_self_study_modules_year_term ON self_study_modules(academic_year_id, term);

CREATE TABLE IF NOT EXISTS self_study_grade_configs (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
  module_id VARCHAR(50) NOT NULL REFERENCES self_study_modules(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 20),
  sessions_per_week SMALLINT NOT NULL DEFAULT 1 CHECK (sessions_per_week >= 1 AND sessions_per_week <= 14),
  UNIQUE(module_id, grade)
);

CREATE TABLE IF NOT EXISTS self_study_slots (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
  module_id VARCHAR(50) NOT NULL REFERENCES self_study_modules(id) ON DELETE CASCADE,
  class_id VARCHAR(50) REFERENCES classes(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 20),
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(module_id, class_id, weekday)
);
CREATE INDEX IF NOT EXISTS idx_self_study_slots_year_term ON self_study_slots(academic_year_id, term, module_id);

-- 选修课岗位（按学年+学期）
CREATE TABLE IF NOT EXISTS elective_schedule_config (
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
  periods_per_week INTEGER NOT NULL DEFAULT 2 CHECK (periods_per_week > 0),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (academic_year_id, term)
);

CREATE TABLE IF NOT EXISTS elective_courses (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
  name VARCHAR(200) NOT NULL,
  duration_periods SMALLINT NOT NULL DEFAULT 1 CHECK (duration_periods IN (1, 2)),
  teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  teacher2_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 30 CHECK (capacity >= 0),
  location VARCHAR(200) NOT NULL DEFAULT '',
  applicable_grades JSONB NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_elective_courses_year_term ON elective_courses(academic_year_id, term);

-- 公开课登记（按学年+学期，全校共享；写权限由角色与学科组长岗位决定）
CREATE TABLE IF NOT EXISTS open_lessons (
  id VARCHAR(50) PRIMARY KEY,
  academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
  group_id VARCHAR(80) NOT NULL,
  teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_date DATE NOT NULL,
  time_label VARCHAR(80) NOT NULL,
  grade_unit_topic VARCHAR(300) NOT NULL,
  location VARCHAR(200) NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_open_lessons_year_term
  ON open_lessons(academic_year_id, term, lesson_date, time_label);
