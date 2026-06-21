import type { Pool, PoolClient } from 'pg';
import type {
  SelfStudyGradeConfig,
  SelfStudyModule,
  SelfStudySlot,
  SelfStudyWeekday,
  StaffingSemesterTerm,
} from '@repo/shared';
import { bumpClassNameForPromotion, type GradeConfig } from '@repo/shared';
import pool from '../config/database.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

let ensured = false;
let classLevelMigrated = false;

async function migrateSelfStudySlotsToClassLevel(db: Pool | PoolClient): Promise<void> {
  if (classLevelMigrated) return;
  await db.query(
    `ALTER TABLE self_study_slots ADD COLUMN IF NOT EXISTS class_id VARCHAR(50) REFERENCES classes(id) ON DELETE CASCADE`,
  );
  await db.query(
    `ALTER TABLE self_study_slots DROP CONSTRAINT IF EXISTS self_study_slots_module_id_grade_weekday_key`,
  );
  await db.query(`DROP INDEX IF EXISTS self_study_slots_module_id_grade_weekday_key`);

  const unmigrated = (
    await db.query(
      `SELECT id, academic_year_id, term, module_id, grade, weekday, teacher_id, sort_order
       FROM self_study_slots WHERE class_id IS NULL`,
    )
  ).rows as Array<{
    id: string;
    academic_year_id: string;
    term: string;
    module_id: string;
    grade: number;
    weekday: number;
    teacher_id: string | null;
    sort_order: number;
  }>;

  for (const row of unmigrated) {
    const classes = (
      await db.query(
        `SELECT id FROM classes
         WHERE academic_year_id = $1 AND grade = $2 AND archived_at IS NULL
         ORDER BY name ASC`,
        [row.academic_year_id, row.grade],
      )
    ).rows as Array<{ id: string }>;

    if (classes.length === 0) {
      await db.query(`DELETE FROM self_study_slots WHERE id = $1`, [row.id]);
      continue;
    }

    const [first, ...rest] = classes;
    await db.query(`UPDATE self_study_slots SET class_id = $1 WHERE id = $2`, [first.id, row.id]);
    for (const cls of rest) {
      await db.query(
        `INSERT INTO self_study_slots (id, academic_year_id, term, module_id, class_id, grade, weekday, teacher_id, sort_order)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
         WHERE NOT EXISTS (
           SELECT 1 FROM self_study_slots
           WHERE module_id = $4 AND class_id = $5 AND weekday = $7
         )`,
        [
          createId('sss'),
          row.academic_year_id,
          row.term,
          row.module_id,
          cls.id,
          row.grade,
          row.weekday,
          row.teacher_id,
          row.sort_order,
        ],
      );
    }
  }

  await db.query(`DELETE FROM self_study_slots WHERE class_id IS NULL`);

  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'self_study_slots_module_id_class_id_weekday_key'
      ) THEN
        ALTER TABLE self_study_slots
          ADD CONSTRAINT self_study_slots_module_id_class_id_weekday_key
          UNIQUE(module_id, class_id, weekday);
      END IF;
    END $$
  `);

  classLevelMigrated = true;
}

async function migrateSelfStudyTermColumns(db: Pool | PoolClient): Promise<void> {
  await db.query(
    `ALTER TABLE self_study_modules ADD COLUMN IF NOT EXISTS term VARCHAR(20) NOT NULL DEFAULT 'Semester 1'`,
  );
  await db.query(
    `ALTER TABLE self_study_slots ADD COLUMN IF NOT EXISTS term VARCHAR(20) NOT NULL DEFAULT 'Semester 1'`,
  );
  await db.query(`
    CREATE TABLE IF NOT EXISTS self_study_grade_configs (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
      module_id VARCHAR(50) NOT NULL REFERENCES self_study_modules(id) ON DELETE CASCADE,
      grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 20),
      sessions_per_week SMALLINT NOT NULL DEFAULT 1 CHECK (sessions_per_week >= 1 AND sessions_per_week <= 14),
      UNIQUE(module_id, grade)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_self_study_modules_year_term
      ON self_study_modules(academic_year_id, term)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_self_study_slots_year_term
      ON self_study_slots(academic_year_id, term, module_id)
  `);
  await migrateSelfStudySlotsToClassLevel(db);
}

export async function ensureSelfStudyTables(db: Pool | PoolClient = pool): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS self_study_modules (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL DEFAULT 'Semester 1' CHECK (term IN ('Semester 1', 'Semester 2')),
      name VARCHAR(200) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
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
      UNIQUE(module_id, grade, weekday)
    )
  `);
  await migrateSelfStudyTermColumns(db);
  ensured = true;
}

function mapModule(row: Record<string, unknown>): SelfStudyModule {
  return {
    id: row.id as string,
    academicYearId: row.academic_year_id as string,
    term: row.term as StaffingSemesterTerm,
    name: row.name as string,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapGradeConfig(row: Record<string, unknown>): SelfStudyGradeConfig {
  return {
    id: row.id as string,
    academicYearId: row.academic_year_id as string,
    term: row.term as StaffingSemesterTerm,
    moduleId: row.module_id as string,
    grade: Number(row.grade),
    sessionsPerWeek: Number(row.sessions_per_week),
  };
}

function mapSlot(row: Record<string, unknown>): SelfStudySlot {
  return {
    id: row.id as string,
    academicYearId: row.academic_year_id as string,
    term: row.term as StaffingSemesterTerm,
    moduleId: row.module_id as string,
    classId: row.class_id as string,
    grade: Number(row.grade),
    weekday: Number(row.weekday) as SelfStudyWeekday,
    teacherId: (row.teacher_id as string | null) ?? null,
    teacherName: (row.teacher_name as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function listSelfStudyBundle(
  academicYearId: string,
  db: Pool | PoolClient = pool,
): Promise<{ modules: SelfStudyModule[]; gradeConfigs: SelfStudyGradeConfig[]; slots: SelfStudySlot[] }> {
  await ensureSelfStudyTables(db);
  const modules = (
    await db.query(
      `SELECT id, academic_year_id, term, name, sort_order
       FROM self_study_modules
       WHERE academic_year_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [academicYearId],
    )
  ).rows.map(mapModule);
  const gradeConfigs = (
    await db.query(
      `SELECT id, academic_year_id, term, module_id, grade, sessions_per_week
       FROM self_study_grade_configs
       WHERE academic_year_id = $1
       ORDER BY module_id ASC, grade ASC`,
      [academicYearId],
    )
  ).rows.map(mapGradeConfig);
  const slots = (
    await db.query(
      `SELECT s.id, s.academic_year_id, s.term, s.module_id, s.class_id, s.grade, s.weekday, s.teacher_id, s.sort_order,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM self_study_slots s
       LEFT JOIN users u ON u.id = s.teacher_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.academic_year_id = $1 AND s.class_id IS NOT NULL
       ORDER BY s.module_id ASC, c.grade ASC, c.name ASC, s.weekday ASC`,
      [academicYearId],
    )
  ).rows.map(mapSlot);
  return { modules, gradeConfigs, slots };
}

export async function createSelfStudyModule(
  input: {
    academicYearId: string;
    name: string;
    gradeConfigs: Array<{ grade: number; sessionsPerWeek: number }>;
  },
  db: Pool | PoolClient = pool,
): Promise<{ module: SelfStudyModule; gradeConfigs: SelfStudyGradeConfig[] }> {
  await ensureSelfStudyTables(db);
  const term: StaffingSemesterTerm = 'Semester 1';
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  const configs = input.gradeConfigs
    .map((g) => ({
      grade: Math.round(g.grade),
      sessionsPerWeek: Math.min(14, Math.max(1, Math.round(g.sessionsPerWeek))),
    }))
    .filter((g) => g.sessionsPerWeek > 0);
  if (configs.length === 0) throw new Error('At least one grade config is required');

  const sortRow = (await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
     FROM self_study_modules WHERE academic_year_id = $1`,
    [input.academicYearId],
  )).rows[0] as { next_order: number };
  const moduleId = createId('ssm');
  const moduleRow = (
    await db.query(
      `INSERT INTO self_study_modules (id, academic_year_id, term, name, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, academic_year_id, term, name, sort_order`,
      [moduleId, input.academicYearId, term, name, Number(sortRow.next_order)],
    )
  ).rows[0];

  const savedConfigs: SelfStudyGradeConfig[] = [];
  for (const cfg of configs) {
    const cfgId = createId('ssgc');
    const row = (
      await db.query(
        `INSERT INTO self_study_grade_configs (id, academic_year_id, term, module_id, grade, sessions_per_week)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, academic_year_id, term, module_id, grade, sessions_per_week`,
        [cfgId, input.academicYearId, term, moduleId, cfg.grade, cfg.sessionsPerWeek],
      )
    ).rows[0];
    savedConfigs.push(mapGradeConfig(row));
  }

  return { module: mapModule(moduleRow), gradeConfigs: savedConfigs };
}

export async function updateSelfStudyModule(
  input: { id: string; name: string },
  db: Pool | PoolClient = pool,
): Promise<SelfStudyModule | null> {
  await ensureSelfStudyTables(db);
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  const row = (
    await db.query(
      `UPDATE self_study_modules
       SET name = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, academic_year_id, term, name, sort_order`,
      [name, input.id],
    )
  ).rows[0];
  return row ? mapModule(row) : null;
}

export async function deleteSelfStudyModule(moduleId: string, db: Pool | PoolClient = pool): Promise<boolean> {
  await ensureSelfStudyTables(db);
  const result = await db.query(`DELETE FROM self_study_modules WHERE id = $1 RETURNING id`, [moduleId]);
  return result.rows.length > 0;
}

export async function upsertSelfStudySlot(
  input: {
    id?: string;
    academicYearId: string;
    moduleId: string;
    classId: string;
    weekday: SelfStudyWeekday;
    teacherId: string | null;
    sortOrder?: number;
  },
  db: Pool | PoolClient = pool,
): Promise<SelfStudySlot> {
  await ensureSelfStudyTables(db);
  const term: StaffingSemesterTerm = 'Semester 1';
  const classId = input.classId.trim();
  const weekday = Math.min(7, Math.max(1, Math.round(input.weekday))) as SelfStudyWeekday;
  if (!classId) throw new Error('classId is required');

  const classRow = (
    await db.query(
      `SELECT id, grade, academic_year_id FROM classes
       WHERE id = $1 AND archived_at IS NULL`,
      [classId],
    )
  ).rows[0] as { id: string; grade: number; academic_year_id: string } | undefined;
  if (!classRow || classRow.academic_year_id !== input.academicYearId) {
    throw new Error('Class not found for this academic year');
  }

  const grade = Number(classRow.grade);
  const limitRow = (await db.query(
    `SELECT sessions_per_week FROM self_study_grade_configs
     WHERE module_id = $1 AND grade = $2 LIMIT 1`,
    [input.moduleId, grade],
  )).rows[0] as { sessions_per_week: number } | undefined;
  if (!limitRow) throw new Error('Grade is not configured for this module');

  const id = input.id?.trim() || createId('sss');
  const sortOrder = input.sortOrder ?? weekday;
  const row = (
    await db.query(
      `INSERT INTO self_study_slots (id, academic_year_id, term, module_id, class_id, grade, weekday, teacher_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (module_id, class_id, weekday)
       DO UPDATE SET
         teacher_id = EXCLUDED.teacher_id,
         grade = EXCLUDED.grade,
         sort_order = EXCLUDED.sort_order
       RETURNING id, academic_year_id, term, module_id, class_id, grade, weekday, teacher_id, sort_order`,
      [id, input.academicYearId, term, input.moduleId, classId, grade, weekday, input.teacherId, sortOrder],
    )
  ).rows[0];
  let teacherName: string | null = null;
  if (input.teacherId) {
    const t = (await db.query(
      `SELECT COALESCE(NULLIF(TRIM(name_zh), ''), NULLIF(TRIM(name_en), ''),
                      NULLIF(TRIM(display_name), ''), username, id) AS teacher_name
       FROM users WHERE id = $1`,
      [input.teacherId],
    )).rows[0] as { teacher_name: string } | undefined;
    teacherName = t?.teacher_name ?? null;
  }
  return { ...mapSlot(row), teacherName };
}

export async function deleteSelfStudySlot(slotId: string, db: Pool | PoolClient = pool): Promise<boolean> {
  await ensureSelfStudyTables(db);
  const result = await db.query(`DELETE FROM self_study_slots WHERE id = $1 RETURNING id`, [slotId]);
  return result.rows.length > 0;
}

export async function copySelfStudyToAcademicYear(
  client: PoolClient,
  sourceYearId: string,
  targetYearId: string,
  maxGradeLevel: number,
  gradeConfig: GradeConfig,
): Promise<void> {
  await ensureSelfStudyTables(client);
  const targetClasses = (
    await client.query(
      `SELECT id, grade, name FROM classes
       WHERE academic_year_id = $1 AND archived_at IS NULL`,
      [targetYearId],
    )
  ).rows as Array<{ id: string; grade: number; name: string }>;

  for (const term of ['Semester 1', 'Semester 2'] as StaffingSemesterTerm[]) {
    const modules = (await client.query(
      `SELECT id, name, sort_order FROM self_study_modules
       WHERE academic_year_id = $1 AND term = $2 ORDER BY sort_order ASC`,
      [sourceYearId, term],
    )).rows as Array<{ id: string; name: string; sort_order: number }>;
    const moduleIdMap = new Map<string, string>();
    for (const mod of modules) {
      const newId = createId('ssm');
      moduleIdMap.set(mod.id, newId);
      await client.query(
        `INSERT INTO self_study_modules (id, academic_year_id, term, name, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId, targetYearId, term, mod.name, mod.sort_order],
      );
    }

    const gradeConfigs = (await client.query(
      `SELECT module_id, grade, sessions_per_week
       FROM self_study_grade_configs WHERE academic_year_id = $1 AND term = $2`,
      [sourceYearId, term],
    )).rows as Array<{ module_id: string; grade: number; sessions_per_week: number }>;
    for (const cfg of gradeConfigs) {
      const nextModuleId = moduleIdMap.get(cfg.module_id);
      if (!nextModuleId) continue;
      const nextGrade = Number(cfg.grade) + 1;
      if (nextGrade > maxGradeLevel) continue;
      await client.query(
        `INSERT INTO self_study_grade_configs (id, academic_year_id, term, module_id, grade, sessions_per_week)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (module_id, grade) DO NOTHING`,
        [createId('ssgc'), targetYearId, term, nextModuleId, nextGrade, cfg.sessions_per_week],
      );
    }

    const slots = (await client.query(
      `SELECT s.module_id, s.weekday, s.teacher_id, s.sort_order, s.class_id, c.grade, c.name
       FROM self_study_slots s
       JOIN classes c ON c.id = s.class_id
       WHERE s.academic_year_id = $1 AND s.term = $2`,
      [sourceYearId, term],
    )).rows as Array<{
      module_id: string;
      weekday: number;
      teacher_id: string | null;
      sort_order: number;
      class_id: string;
      grade: number;
      name: string;
    }>;
    for (const slot of slots) {
      const nextModuleId = moduleIdMap.get(slot.module_id);
      if (!nextModuleId) continue;
      const nextGrade = Number(slot.grade) + 1;
      if (nextGrade > maxGradeLevel) continue;
      const nextName = bumpClassNameForPromotion(slot.name, Number(slot.grade), nextGrade, gradeConfig);
      const targetClass = targetClasses.find((c) => c.grade === nextGrade && c.name === nextName);
      if (!targetClass) continue;
      await client.query(
        `INSERT INTO self_study_slots (id, academic_year_id, term, module_id, class_id, grade, weekday, teacher_id, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (module_id, class_id, weekday) DO NOTHING`,
        [
          createId('sss'),
          targetYearId,
          term,
          nextModuleId,
          targetClass.id,
          nextGrade,
          slot.weekday,
          slot.teacher_id,
          slot.sort_order,
        ],
      );
    }
  }
}
