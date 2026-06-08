import type { Pool } from 'pg';

const MAX_GRADE_LEVEL = 20;

/** 放宽 classes / 学籍表年级上限，与课程设置中 G9I（level 10）等保持一致 */
export async function ensureGradeLevelConstraints(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_grade_check;
      ALTER TABLE classes ADD CONSTRAINT classes_grade_check CHECK (grade >= 1 AND grade <= ${MAX_GRADE_LEVEL});
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE students DROP CONSTRAINT IF EXISTS students_current_grade_check;
      ALTER TABLE students ADD CONSTRAINT students_current_grade_check
        CHECK (current_grade IS NULL OR (current_grade >= 1 AND current_grade <= ${MAX_GRADE_LEVEL}));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE student_assignment_history DROP CONSTRAINT IF EXISTS student_assignment_history_grade_check;
      ALTER TABLE student_assignment_history ADD CONSTRAINT student_assignment_history_grade_check
        CHECK (grade IS NULL OR (grade >= 1 AND grade <= ${MAX_GRADE_LEVEL}));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `);

  // S9A/S9B 均为九年级（grade=9）；课程轨 G9I/G9C 由班名/学部与 catalog 对齐，不用 numeric grade 区分
  await pool.query(`
    UPDATE classes SET grade = 9, updated_at = CURRENT_TIMESTAMP
    WHERE UPPER(TRIM(name)) = 'S9A' AND grade = 10
  `);
  await pool.query(`
    UPDATE students s SET current_grade = 9, updated_at = CURRENT_TIMESTAMP
    FROM classes c
    WHERE s.current_class_id = c.id AND UPPER(TRIM(c.name)) = 'S9A' AND s.current_grade = 10
  `);
  await pool.query(`
    UPDATE student_assignment_history h SET grade = 9
    FROM classes c
    WHERE h.class_id = c.id AND UPPER(TRIM(c.name)) = 'S9A' AND h.grade = 10 AND h.effective_to IS NULL
  `);
}
