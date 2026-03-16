-- Add grade column to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS grade VARCHAR(50);
