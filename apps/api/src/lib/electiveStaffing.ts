import type { Pool, PoolClient } from 'pg';
import type { ElectiveCourse, ElectiveScheduleConfig, StaffingSemesterTerm } from '@repo/shared';
import { ELECTIVE_PERIODS_PER_WEEK } from '@repo/shared';
import pool from '../config/database.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

let ensured = false;

async function migrateElectiveTermColumns(db: Pool | PoolClient): Promise<void> {
  await db.query(
    `ALTER TABLE elective_courses ADD COLUMN IF NOT EXISTS term VARCHAR(20) NOT NULL DEFAULT 'Semester 1'`,
  );
  await db.query(
    `ALTER TABLE elective_schedule_config ADD COLUMN IF NOT EXISTS term VARCHAR(20) NOT NULL DEFAULT 'Semester 1'`,
  );
  await db.query(
    `ALTER TABLE elective_courses ADD COLUMN IF NOT EXISTS applicable_grades JSONB NOT NULL DEFAULT '[]'`,
  );
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'elective_schedule_config_pkey'
          AND conrelid = 'elective_schedule_config'::regclass
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage
        WHERE table_name = 'elective_schedule_config' AND column_name = 'term'
          AND constraint_name = 'elective_schedule_config_pkey'
      ) THEN
        ALTER TABLE elective_schedule_config DROP CONSTRAINT elective_schedule_config_pkey;
        ALTER TABLE elective_schedule_config ADD PRIMARY KEY (academic_year_id, term);
      END IF;
    END $$
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_elective_courses_year_term
      ON elective_courses(academic_year_id, term)
  `);
}

export async function ensureElectiveTables(db: Pool | PoolClient = pool): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS elective_schedule_config (
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
      periods_per_week INTEGER NOT NULL DEFAULT 2 CHECK (periods_per_week > 0),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (academic_year_id, term)
    )
  `);
  await db.query(`
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
    )
  `);
  await migrateElectiveTermColumns(db);
  ensured = true;
}

function teacherNameSql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(${alias}.name_zh), ''), NULLIF(TRIM(${alias}.name_en), ''),
                   NULLIF(TRIM(${alias}.display_name), ''), ${alias}.username, ${alias}.id)`;
}

function parseJsonStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

function mapCourse(row: Record<string, unknown>): ElectiveCourse {
  return {
    id: row.id as string,
    academicYearId: row.academic_year_id as string,
    term: row.term as StaffingSemesterTerm,
    name: row.name as string,
    applicableGrades: parseJsonStringArray(row.applicable_grades),
    durationPeriods: Number(row.duration_periods) === 2 ? 2 : 1,
    teacherId: (row.teacher_id as string | null) ?? null,
    teacher2Id: (row.teacher2_id as string | null) ?? null,
    teacherName: (row.teacher_name as string | null) ?? null,
    teacher2Name: (row.teacher2_name as string | null) ?? null,
    capacity: Number(row.capacity ?? 0),
    location: String(row.location ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function getElectiveBundle(
  academicYearId: string,
  db: Pool | PoolClient = pool,
): Promise<{ config: ElectiveScheduleConfig; courses: ElectiveCourse[] }> {
  await ensureElectiveTables(db);
  const term: StaffingSemesterTerm = 'Semester 1';
  const config: ElectiveScheduleConfig = {
    academicYearId,
    term,
    periodsPerWeek: ELECTIVE_PERIODS_PER_WEEK,
  };
  const courses = (
    await db.query(
      `SELECT c.id, c.academic_year_id, c.term, c.name, c.applicable_grades, c.duration_periods, c.teacher_id, c.teacher2_id,
              c.capacity, c.location, c.sort_order,
              ${teacherNameSql('t1')} AS teacher_name,
              ${teacherNameSql('t2')} AS teacher2_name
       FROM elective_courses c
       LEFT JOIN users t1 ON t1.id = c.teacher_id
       LEFT JOIN users t2 ON t2.id = c.teacher2_id
       WHERE c.academic_year_id = $1
       ORDER BY c.sort_order ASC, c.created_at ASC`,
      [academicYearId],
    )
  ).rows.map(mapCourse);
  return { config, courses };
}

export async function upsertElectiveCourse(
  input: {
    id?: string;
    academicYearId: string;
    name: string;
    applicableGrades: string[];
    durationPeriods: 1 | 2;
    teacherId: string | null;
    teacher2Id?: string | null;
    capacity: number;
    location: string;
    sortOrder?: number;
  },
  db: Pool | PoolClient = pool,
): Promise<ElectiveCourse> {
  await ensureElectiveTables(db);
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  const applicableGrades = Array.isArray(input.applicableGrades)
    ? [...new Set(input.applicableGrades.map((id) => String(id ?? '').trim()).filter(Boolean))]
    : [];
  if (applicableGrades.length === 0) throw new Error('applicableGrades is required');
  const id = input.id?.trim() || createId('ec');
  const term: StaffingSemesterTerm = 'Semester 1';
  let sortOrder = input.sortOrder;
  if (sortOrder == null) {
    const sortRow = (await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
       FROM elective_courses WHERE academic_year_id = $1`,
      [input.academicYearId],
    )).rows[0] as { next_order: number };
    sortOrder = Number(sortRow.next_order);
  }
  const duration = input.durationPeriods === 2 ? 2 : 1;
  const capacity = Math.max(0, Math.round(input.capacity));
  const location = String(input.location ?? '').trim();
  const row = (
    await db.query(
      `INSERT INTO elective_courses
         (id, academic_year_id, term, name, applicable_grades, duration_periods, teacher_id, teacher2_id, capacity, location, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         term = EXCLUDED.term,
         applicable_grades = EXCLUDED.applicable_grades,
         duration_periods = EXCLUDED.duration_periods,
         teacher_id = EXCLUDED.teacher_id,
         teacher2_id = EXCLUDED.teacher2_id,
         capacity = EXCLUDED.capacity,
         location = EXCLUDED.location,
         sort_order = EXCLUDED.sort_order,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, academic_year_id, term, name, applicable_grades, duration_periods, teacher_id, teacher2_id, capacity, location, sort_order`,
      [
        id,
        input.academicYearId,
        term,
        name,
        JSON.stringify(applicableGrades),
        duration,
        input.teacherId,
        input.teacher2Id ?? null,
        capacity,
        location,
        sortOrder,
      ],
    )
  ).rows[0];
  const bundle = await getElectiveBundle(input.academicYearId, db);
  return bundle.courses.find((c) => c.id === row.id) ?? mapCourse(row);
}

export async function deleteElectiveCourse(courseId: string, db: Pool | PoolClient = pool): Promise<boolean> {
  await ensureElectiveTables(db);
  const result = await db.query(`DELETE FROM elective_courses WHERE id = $1 RETURNING id`, [courseId]);
  return result.rows.length > 0;
}

export async function copyElectivesToAcademicYear(
  client: PoolClient,
  sourceYearId: string,
  targetYearId: string,
): Promise<void> {
  await ensureElectiveTables(client);
  for (const term of ['Semester 1', 'Semester 2'] as StaffingSemesterTerm[]) {
    await client.query(
      `INSERT INTO elective_schedule_config (academic_year_id, term, periods_per_week)
       VALUES ($1, $2, $3)
       ON CONFLICT (academic_year_id, term) DO UPDATE SET
         periods_per_week = EXCLUDED.periods_per_week,
         updated_at = CURRENT_TIMESTAMP`,
      [targetYearId, term, ELECTIVE_PERIODS_PER_WEEK],
    );
    const courses = (await client.query(
      `SELECT name, applicable_grades, duration_periods, teacher_id, teacher2_id, capacity, location, sort_order
       FROM elective_courses WHERE academic_year_id = $1 AND term = $2 ORDER BY sort_order ASC`,
      [sourceYearId, term],
    )).rows as Array<{
      name: string;
      applicable_grades: unknown;
      duration_periods: number;
      teacher_id: string | null;
      teacher2_id: string | null;
      capacity: number;
      location: string;
      sort_order: number;
    }>;
    for (const course of courses) {
      await client.query(
        `INSERT INTO elective_courses
           (id, academic_year_id, term, name, applicable_grades, duration_periods, teacher_id, teacher2_id, capacity, location, sort_order)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
        [
          createId('ec'),
          targetYearId,
          term,
          course.name,
          JSON.stringify(parseJsonStringArray(course.applicable_grades)),
          course.duration_periods,
          course.teacher_id,
          course.teacher2_id,
          course.capacity,
          course.location,
          course.sort_order,
        ],
      );
    }
  }
}
