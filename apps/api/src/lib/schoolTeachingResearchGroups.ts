import { DEFAULT_TEACHING_RESEARCH_GROUPS, normalizeTeachingResearchGroups, type TeachingResearchGroup } from '@repo/shared';
import pool from '../config/database.js';
import { ensureSchoolSettingsTable } from './schoolGradeStructure.js';

let ensuredColumn = false;

async function ensureTeachingResearchGroupsColumn(): Promise<void> {
  await ensureSchoolSettingsTable();
  if (ensuredColumn) return;
  await pool.query(`
    ALTER TABLE school_settings
    ADD COLUMN IF NOT EXISTS teaching_research_groups JSONB
  `);
  ensuredColumn = true;
}

export async function loadSchoolTeachingResearchGroups(): Promise<TeachingResearchGroup[]> {
  await ensureTeachingResearchGroupsColumn();
  const row = await pool.query(
    `SELECT teaching_research_groups FROM school_settings WHERE id = 'default' LIMIT 1`,
  );
  const raw = (row.rows[0] as { teaching_research_groups?: unknown } | undefined)?.teaching_research_groups;
  if (raw == null) {
    return DEFAULT_TEACHING_RESEARCH_GROUPS.map((g) => ({ ...g }));
  }
  return normalizeTeachingResearchGroups(raw);
}

export async function saveSchoolTeachingResearchGroups(
  input: unknown,
  updatedBy: string | null,
): Promise<TeachingResearchGroup[]> {
  const normalized = normalizeTeachingResearchGroups(input);
  await ensureTeachingResearchGroupsColumn();
  await pool.query(
    `INSERT INTO school_settings (id, teaching_research_groups, updated_at, updated_by)
     VALUES ('default', $1::jsonb, CURRENT_TIMESTAMP, $2)
     ON CONFLICT (id)
     DO UPDATE SET
       teaching_research_groups = EXCLUDED.teaching_research_groups,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(normalized), updatedBy],
  );
  return normalized;
}
