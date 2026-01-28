-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入预设用户（密码需要先哈希，这里先用明文，后续会改进）
INSERT INTO users (id, username, password, role, display_name) VALUES
  ('admin-1', 'Admin', '4321', 'admin', '总管理员'),
  ('hf-admin-1', 'HF-Admin', '1234', 'hf-admin', 'HF管理员'),
  ('wx-admin-1', 'WX-Admin', '1234', 'wx-admin', 'WX管理员')
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

-- 用户设置表（存储概念、类别排序等）
CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  key_concepts JSONB DEFAULT '[]'::jsonb,
  category_order JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_user_id ON semester_data(user_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_course_id ON semester_data(course_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_lookup ON semester_data(user_id, course_id, grade, semester);
