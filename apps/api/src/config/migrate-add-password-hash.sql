-- 仅用于已有数据库：为 users 表增加 password_hash 列（新库请用 init.sql）
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
