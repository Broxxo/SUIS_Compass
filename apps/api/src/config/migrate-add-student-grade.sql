-- Legacy VARCHAR grade removed; students use current_grade (integer) only.
ALTER TABLE students DROP COLUMN IF EXISTS grade;
