import { normalizeTeachingSubjectGroups, type TeachingSubjectGroup } from '@repo/shared';
import pool from '../config/database.js';
import { ensureSchoolSettingsTable } from './schoolGradeStructure.js';

let ensuredColumn = false;

async function ensureTeachingSubjectGroupsColumn(): Promise<void> {
  await ensureSchoolSettingsTable();
  if (ensuredColumn) return;
  await pool.query(`
    ALTER TABLE school_settings
    ADD COLUMN IF NOT EXISTS teaching_subject_groups JSONB
  `);
  await pool.query(`
    ALTER TABLE school_settings
    ADD COLUMN IF NOT EXISTS teaching_research_groups JSONB
  `);
  ensuredColumn = true;
}

export async function loadSchoolTeachingSubjectGroups(): Promise<TeachingSubjectGroup[]> {
  await ensureTeachingSubjectGroupsColumn();
  const row = await pool.query(
    `SELECT teaching_subject_groups, teaching_research_groups FROM school_settings WHERE id = 'default' LIMIT 1`,
  );
  const rec = row.rows[0] as
    | { teaching_subject_groups?: unknown; teaching_research_groups?: unknown }
    | undefined;
  if (rec?.teaching_subject_groups != null) {
    return normalizeTeachingSubjectGroups(rec.teaching_subject_groups);
  }
  return [];
}

export async function saveSchoolTeachingSubjectGroups(
  input: unknown,
  updatedBy: string | null,
): Promise<TeachingSubjectGroup[]> {
  const normalized = normalizeTeachingSubjectGroups(input);
  await ensureTeachingSubjectGroupsColumn();
  await pool.query(
    `INSERT INTO school_settings (id, teaching_subject_groups, updated_at, updated_by)
     VALUES ('default', $1::jsonb, CURRENT_TIMESTAMP, $2)
     ON CONFLICT (id)
     DO UPDATE SET
       teaching_subject_groups = EXCLUDED.teaching_subject_groups,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(normalized), updatedBy],
  );
  return normalized;
}
