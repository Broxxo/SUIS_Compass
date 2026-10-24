import type { Pool } from 'pg';
import pool from '../config/database.js';
import { loadSchoolGradeStructure } from './schoolGradeStructure.js';
import { loadSchoolTeachingSubjectGroups } from './schoolTeachingSubjectGroups.js';

export const COORDINATOR_PERMISSIONS = ['grade-management', 'teaching-management'] as const;
export type CoordinatorPermission = (typeof COORDINATOR_PERMISSIONS)[number];

export type DivisionCoordinatorPost = {
  id: string;
  academicYearId: string;
  title: string;
  segmentIds: string[];
  chargeModules: string[];
  permissions: CoordinatorPermission[];
  teacherId: string | null;
  teacherName: string | null;
  updatedAt: string | null;
};

let ensured = false;

export async function ensureDivisionCoordinatorPostsTable(db: Pool = pool): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS division_coordinator_posts (
      id VARCHAR(100) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      title VARCHAR(80) NOT NULL,
      segment_ids TEXT[] NOT NULL DEFAULT '{}',
      charge_modules TEXT[] NOT NULL DEFAULT '{}',
      permissions TEXT[] NOT NULL DEFAULT '{}',
      teacher_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (academic_year_id, title)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_division_coordinator_posts_year
      ON division_coordinator_posts(academic_year_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_division_coordinator_posts_teacher
      ON division_coordinator_posts(academic_year_id, teacher_id)
  `);
  ensured = true;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function permissionList(value: unknown): CoordinatorPermission[] {
  const allowed = new Set<string>(COORDINATOR_PERMISSIONS);
  return textList(value).filter((item): item is CoordinatorPermission => allowed.has(item));
}

function mapRow(row: {
  id: string;
  academic_year_id: string;
  title: string;
  segment_ids: unknown;
  charge_modules: unknown;
  permissions: unknown;
  teacher_id: string | null;
  teacher_name: string | null;
  updated_at: Date | null;
}): DivisionCoordinatorPost {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    title: row.title,
    segmentIds: textList(row.segment_ids),
    chargeModules: textList(row.charge_modules),
    permissions: permissionList(row.permissions),
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    updatedAt: row.updated_at?.toISOString() ?? null,
  };
}

const SELECT_POSTS = `
  SELECT p.id, p.academic_year_id, p.title, p.segment_ids, p.charge_modules, p.permissions,
         p.teacher_id, p.updated_at,
         COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                  NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
  FROM division_coordinator_posts p
  LEFT JOIN users u ON u.id = p.teacher_id
`;

export async function listDivisionCoordinatorPosts(
  academicYearId: string,
  db: Pool = pool,
): Promise<DivisionCoordinatorPost[]> {
  await ensureDivisionCoordinatorPostsTable(db);
  const rows = (
    await db.query(`${SELECT_POSTS} WHERE p.academic_year_id = $1 ORDER BY p.title ASC`, [academicYearId])
  ).rows;
  return rows.map((row) => mapRow(row));
}

export async function saveDivisionCoordinatorPost(
  input: {
    id?: string | null;
    academicYearId: string;
    title: string;
    segmentIds: string[];
    chargeModules: string[];
    permissions: CoordinatorPermission[];
    teacherId: string | null;
    updatedBy?: string | null;
  },
  db: Pool = pool,
): Promise<DivisionCoordinatorPost> {
  await ensureDivisionCoordinatorPostsTable(db);
  const title = input.title.trim();
  const segmentIds = textList(input.segmentIds);
  const chargeModules = textList(input.chargeModules);
  const permissions = permissionList(input.permissions);
  if (!input.academicYearId || !title) throw new Error('title_required');
  if (title.length > 80) throw new Error('title_too_long');
  if (segmentIds.length === 0) throw new Error('segment_required');
  if (chargeModules.length === 0) throw new Error('charge_required');
  if (permissions.length === 0) throw new Error('permission_required');
  const id = input.id?.trim() || `dcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.query(
      `INSERT INTO division_coordinator_posts
         (id, academic_year_id, title, segment_ids, charge_modules, permissions, teacher_id, updated_by)
       VALUES ($1, $2, $3, $4::text[], $5::text[], $6::text[], $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         segment_ids = EXCLUDED.segment_ids,
         charge_modules = EXCLUDED.charge_modules,
         permissions = EXCLUDED.permissions,
         teacher_id = EXCLUDED.teacher_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       WHERE division_coordinator_posts.academic_year_id = EXCLUDED.academic_year_id`,
      [id, input.academicYearId, title, segmentIds, chargeModules, permissions, input.teacherId, input.updatedBy ?? null],
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') throw new Error('title_taken');
    throw error;
  }
  const row = (
    await db.query(`${SELECT_POSTS} WHERE p.id = $1`, [id])
  ).rows[0];
  if (!row) throw new Error('not_found');
  return mapRow(row);
}

export async function deleteDivisionCoordinatorPost(id: string, db: Pool = pool): Promise<boolean> {
  await ensureDivisionCoordinatorPostsTable(db);
  const result = await db.query(`DELETE FROM division_coordinator_posts WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

async function postsForTeacher(
  teacherId: string,
  academicYearId: string,
  db: Pool,
): Promise<DivisionCoordinatorPost[]> {
  await ensureDivisionCoordinatorPostsTable(db);
  const rows = (
    await db.query(
      `${SELECT_POSTS} WHERE p.academic_year_id = $1 AND p.teacher_id = $2`,
      [academicYearId, teacherId],
    )
  ).rows;
  return rows.map((row) => mapRow(row));
}

/** 协调员岗位覆盖的学部。周历里这些学部对应的模块就是其分管模块。 */
export async function coordinatorSegmentIds(
  teacherId: string,
  academicYearId: string,
  db: Pool = pool,
): Promise<Set<string>> {
  const posts = await postsForTeacher(teacherId, academicYearId, db);
  const ids = new Set<string>();
  for (const post of posts) {
    for (const segmentId of post.segmentIds) ids.add(segmentId);
  }
  return ids;
}

/** 年级管理：该协调员在所选学部内，等同于这些年级的年级组长。 */
export async function coordinatorGradeScopeKeys(
  teacherId: string,
  academicYearId: string,
  db: Pool = pool,
): Promise<Set<string>> {
  const posts = await postsForTeacher(teacherId, academicYearId, db);
  const wanted = new Set<string>();
  for (const post of posts) {
    if (!post.permissions.includes('grade-management')) continue;
    for (const segmentId of post.segmentIds) wanted.add(segmentId);
  }
  if (wanted.size === 0) return new Set();
  const gradeConfig = await loadSchoolGradeStructure();
  const keys = new Set<string>();
  for (const segment of gradeConfig.segments ?? []) {
    if (!wanted.has(segment.id)) continue;
    for (const gradeId of segment.gradeIds) keys.add(gradeId);
  }
  return keys;
}

/** 教学管理：该协调员在所选学部内，等同于覆盖这些学部的学科组长。 */
export async function coordinatorLedGroupIds(
  teacherId: string,
  academicYearId: string,
  db: Pool = pool,
): Promise<Set<string>> {
  const posts = await postsForTeacher(teacherId, academicYearId, db);
  const segmentIds = new Set<string>();
  for (const post of posts) {
    if (!post.permissions.includes('teaching-management')) continue;
    for (const segmentId of post.segmentIds) segmentIds.add(segmentId);
  }
  if (segmentIds.size === 0) return new Set();
  const groups = await loadSchoolTeachingSubjectGroups();
  const ids = new Set<string>();
  for (const group of groups) {
    const covers =
      group.segmentIds.length === 0 || group.segmentIds.some((id) => segmentIds.has(id));
    if (covers) ids.add(group.id);
  }
  return ids;
}
