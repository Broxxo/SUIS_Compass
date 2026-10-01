import crypto from 'crypto';
import pool from '../config/database.js';
import { ensureFunctionalRoleAssignmentsTable } from './functionalRoleAssignments.js';
import { loadSchoolTeachingSubjectGroups } from './schoolTeachingSubjectGroups.js';
import { ensureTeachingSubjectGroupMembersTable } from './teachingSubjectGroupMembers.js';

export const OPEN_LESSON_TERMS = ['Semester 1', 'Semester 2'] as const;
export type OpenLessonTerm = (typeof OPEN_LESSON_TERMS)[number];

export type OpenLessonGroupOption = {
  id: string;
  nameZh: string;
  nameEn: string;
};

export type OpenLessonStaffOption = {
  id: string;
  nameZh: string;
  nameEn: string;
};

export type OpenLessonMembership = {
  groupId: string;
  teacherId: string;
};

export type OpenLessonRow = {
  id: string;
  academicYearId: string;
  term: OpenLessonTerm;
  groupId: string;
  groupNameZh: string;
  groupNameEn: string;
  teacherId: string;
  teacherNameZh: string;
  teacherNameEn: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
  canEdit: boolean;
};

export type OpenLessonBoard = {
  academicYearId: string;
  term: OpenLessonTerm;
  viewerId: string;
  isAdmin: boolean;
  ledGroupIds: string[];
  memberGroupIds: string[];
  groups: OpenLessonGroupOption[];
  staff: OpenLessonStaffOption[];
  memberships: OpenLessonMembership[];
  lessons: OpenLessonRow[];
};

export type OpenLessonInput = {
  academicYearId: string;
  term: OpenLessonTerm;
  groupId: string;
  teacherId: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
};

type Access = {
  viewerId: string;
  isAdmin: boolean;
  ledGroupIds: string[];
  memberGroupIds: string[];
  groups: OpenLessonGroupOption[];
  staff: OpenLessonStaffOption[];
  memberships: OpenLessonMembership[];
  memberTeacherIdsByGroup: Map<string, Set<string>>;
};

const STAFF_NAME_ZH = `COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id)`;
const STAFF_NAME_EN = `COALESCE(NULLIF(TRIM(u.name_en), ''), NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.display_name), ''), u.username, u.id)`;

let ensured = false;

export function isOpenLessonTerm(value: string): value is OpenLessonTerm {
  return (OPEN_LESSON_TERMS as readonly string[]).includes(value);
}

export async function ensureOpenLessonsTable(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS open_lessons (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      group_id VARCHAR(80) NOT NULL,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_date DATE NOT NULL,
      time_label VARCHAR(80) NOT NULL,
      grade_unit_topic VARCHAR(300) NOT NULL,
      location VARCHAR(200) NOT NULL,
      remarks TEXT NOT NULL DEFAULT '',
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_open_lessons_year_term
      ON open_lessons(academic_year_id, term, lesson_date, time_label)
  `);
  ensured = true;
}

function newId(): string {
  return `ol-${crypto.randomBytes(8).toString('hex')}`;
}

export function parseOpenLessonInput(body: unknown, fallbackYear = '', fallbackTerm = ''): OpenLessonInput | { error: string } {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const academicYearId = String(rec.academicYearId ?? fallbackYear).trim();
  const term = String(rec.term ?? fallbackTerm).trim();
  const groupId = String(rec.groupId ?? '').trim();
  const teacherId = String(rec.teacherId ?? '').trim();
  const lessonDate = String(rec.lessonDate ?? '').trim();
  const timeText = String(rec.timeText ?? '').trim();
  const gradeUnitTopic = String(rec.gradeUnitTopic ?? '').trim();
  const location = String(rec.location ?? '').trim();
  const remarks = String(rec.remarks ?? '').trim();
  if (!academicYearId) return { error: 'year_required' };
  if (!isOpenLessonTerm(term)) return { error: 'term_invalid' };
  if (!groupId) return { error: 'group_required' };
  if (!teacherId) return { error: 'teacher_required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate) || Number.isNaN(Date.parse(`${lessonDate}T00:00:00Z`))) {
    return { error: 'date_required' };
  }
  if (!timeText) return { error: 'time_required' };
  if (timeText.length > 80) return { error: 'field_too_long' };
  if (!gradeUnitTopic) return { error: 'topic_required' };
  if (gradeUnitTopic.length > 300) return { error: 'field_too_long' };
  if (!location) return { error: 'location_required' };
  if (location.length > 200) return { error: 'field_too_long' };
  if (remarks.length > 1000) return { error: 'field_too_long' };
  return {
    academicYearId,
    term,
    groupId,
    teacherId,
    lessonDate,
    timeText,
    gradeUnitTopic,
    location,
    remarks,
  };
}

async function loadAccess(viewerId: string, academicYearId: string): Promise<Access | null> {
  const userResult = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [viewerId]);
  const role = userResult.rows[0]?.role as string | undefined;
  if (!role || role === 'student') return null;
  const isAdmin = role === 'admin' || role === 'system-admin';

  const [groupDefs] = await Promise.all([
    loadSchoolTeachingSubjectGroups(),
    ensureFunctionalRoleAssignmentsTable(),
    ensureTeachingSubjectGroupMembersTable(),
  ]);
  const groups: OpenLessonGroupOption[] = groupDefs.map((g) => ({
    id: g.id,
    nameZh: g.nameZh,
    nameEn: g.nameEn?.trim() || g.nameZh,
  }));
  const groupIds = new Set(groups.map((g) => g.id));

  const leadRows = (
    await pool.query(
      `SELECT scope_key
       FROM functional_role_assignments
       WHERE academic_year_id = $1 AND role_type = 'subject-group-head' AND teacher_id = $2`,
      [academicYearId, viewerId],
    )
  ).rows as Array<{ scope_key: string }>;
  const ledGroupIds = leadRows.map((r) => r.scope_key).filter((id) => groupIds.has(id));

  const memberRows = (
    await pool.query(
      `SELECT group_id, teacher_id
       FROM teaching_subject_group_members
       WHERE academic_year_id = $1`,
      [academicYearId],
    )
  ).rows as Array<{ group_id: string; teacher_id: string }>;

  const memberTeacherIdsByGroup = new Map<string, Set<string>>();
  const memberGroupIds: string[] = [];
  const memberships: OpenLessonMembership[] = [];
  for (const row of memberRows) {
    if (!groupIds.has(row.group_id)) continue;
    let set = memberTeacherIdsByGroup.get(row.group_id);
    if (!set) {
      set = new Set();
      memberTeacherIdsByGroup.set(row.group_id, set);
    }
    set.add(row.teacher_id);
    if (row.teacher_id === viewerId && !memberGroupIds.includes(row.group_id)) {
      memberGroupIds.push(row.group_id);
    }
    const visible = isAdmin || row.teacher_id === viewerId || ledGroupIds.includes(row.group_id);
    if (visible) memberships.push({ groupId: row.group_id, teacherId: row.teacher_id });
  }

  const staffSql = `
    SELECT u.id, ${STAFF_NAME_ZH} AS name_zh, ${STAFF_NAME_EN} AS name_en
    FROM users u
    WHERE u.role IN ('teacher', 'admin', 'system-admin')
    ORDER BY name_zh ASC, u.username ASC`;
  const allStaff = (await pool.query(staffSql)).rows as Array<{ id: string; name_zh: string; name_en: string }>;
  const assignableIds = new Set<string>();
  if (isAdmin) {
    for (const s of allStaff) assignableIds.add(s.id);
  } else {
    assignableIds.add(viewerId);
    for (const groupId of ledGroupIds) {
      for (const teacherId of memberTeacherIdsByGroup.get(groupId) ?? []) assignableIds.add(teacherId);
    }
  }
  const staff = allStaff
    .filter((s) => assignableIds.has(s.id))
    .map((s) => ({ id: s.id, nameZh: s.name_zh, nameEn: s.name_en }));

  return {
    viewerId,
    isAdmin,
    ledGroupIds,
    memberGroupIds,
    groups,
    staff,
    memberships,
    memberTeacherIdsByGroup,
  };
}

function canEditPair(access: Access, groupId: string, teacherId: string): boolean {
  if (access.isAdmin) return true;
  if (teacherId === access.viewerId) return true;
  return access.ledGroupIds.includes(groupId);
}

function canAssign(access: Access, groupId: string, teacherId: string): boolean {
  if (!access.groups.some((g) => g.id === groupId)) return false;
  if (!access.staff.some((s) => s.id === teacherId)) return false;
  if (access.isAdmin) return true;
  const inGroup =
    access.memberGroupIds.includes(groupId) || access.ledGroupIds.includes(groupId);
  if (teacherId === access.viewerId && inGroup) return true;
  if (!access.ledGroupIds.includes(groupId)) return false;
  if (teacherId === access.viewerId) return true;
  return access.memberTeacherIdsByGroup.get(groupId)?.has(teacherId) ?? false;
}

function canWrite(
  access: Access,
  existing: { groupId: string; teacherId: string } | null,
  next: { groupId: string; teacherId: string },
): boolean {
  if (existing && !canEditPair(access, existing.groupId, existing.teacherId)) return false;
  const samePair = existing && existing.groupId === next.groupId && existing.teacherId === next.teacherId;
  if (samePair) return true;
  return canAssign(access, next.groupId, next.teacherId);
}

type LessonDbRow = {
  id: string;
  academic_year_id: string;
  term: string;
  group_id: string;
  teacher_id: string;
  lesson_date: string;
  time_label: string;
  grade_unit_topic: string;
  location: string;
  remarks: string;
  teacher_name_zh: string;
  teacher_name_en: string;
};

function mapLesson(row: LessonDbRow, access: Access): OpenLessonRow {
  const group = access.groups.find((g) => g.id === row.group_id);
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    term: row.term as OpenLessonTerm,
    groupId: row.group_id,
    groupNameZh: group?.nameZh ?? row.group_id,
    groupNameEn: group?.nameEn ?? group?.nameZh ?? row.group_id,
    teacherId: row.teacher_id,
    teacherNameZh: row.teacher_name_zh,
    teacherNameEn: row.teacher_name_en,
    lessonDate: row.lesson_date,
    timeText: row.time_label,
    gradeUnitTopic: row.grade_unit_topic,
    location: row.location,
    remarks: row.remarks ?? '',
    canEdit: canEditPair(access, row.group_id, row.teacher_id),
  };
}

const LESSON_SELECT = `
  SELECT l.id, l.academic_year_id, l.term, l.group_id, l.teacher_id,
         to_char(l.lesson_date, 'YYYY-MM-DD') AS lesson_date,
         l.time_label, l.grade_unit_topic, l.location, l.remarks,
         ${STAFF_NAME_ZH} AS teacher_name_zh,
         ${STAFF_NAME_EN} AS teacher_name_en
  FROM open_lessons l
  JOIN users u ON u.id = l.teacher_id
`;

async function yearExists(academicYearId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM academic_years WHERE id = $1`, [academicYearId]);
  return result.rows.length > 0;
}

export async function getOpenLessonBoard(
  viewerId: string,
  academicYearId: string,
  term: OpenLessonTerm,
): Promise<OpenLessonBoard | { error: string }> {
  await ensureOpenLessonsTable();
  if (!(await yearExists(academicYearId))) return { error: 'year_not_found' };
  const access = await loadAccess(viewerId, academicYearId);
  if (!access) return { error: 'forbidden' };
  const rows = (
    await pool.query(
      `${LESSON_SELECT}
       WHERE l.academic_year_id = $1 AND l.term = $2
       ORDER BY l.lesson_date ASC, l.time_label ASC, l.created_at ASC`,
      [academicYearId, term],
    )
  ).rows as LessonDbRow[];
  return {
    academicYearId,
    term,
    viewerId: access.viewerId,
    isAdmin: access.isAdmin,
    ledGroupIds: access.ledGroupIds,
    memberGroupIds: access.memberGroupIds,
    groups: access.groups,
    staff: access.staff,
    memberships: access.memberships,
    lessons: rows.map((row) => mapLesson(row, access)),
  };
}

async function loadLessonById(id: string): Promise<LessonDbRow | null> {
  const result = await pool.query(`${LESSON_SELECT} WHERE l.id = $1`, [id]);
  return (result.rows[0] as LessonDbRow | undefined) ?? null;
}

export async function createOpenLesson(
  viewerId: string,
  input: OpenLessonInput,
): Promise<OpenLessonRow | { error: string }> {
  await ensureOpenLessonsTable();
  if (!(await yearExists(input.academicYearId))) return { error: 'year_not_found' };
  const access = await loadAccess(viewerId, input.academicYearId);
  if (!access) return { error: 'forbidden' };
  if (!canWrite(access, null, input)) return { error: 'assign_forbidden' };
  const id = newId();
  await pool.query(
    `INSERT INTO open_lessons (
       id, academic_year_id, term, group_id, teacher_id, lesson_date, time_label,
       grade_unit_topic, location, remarks, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      id,
      input.academicYearId,
      input.term,
      input.groupId,
      input.teacherId,
      input.lessonDate,
      input.timeText,
      input.gradeUnitTopic,
      input.location,
      input.remarks,
      viewerId,
    ],
  );
  const row = await loadLessonById(id);
  if (!row) return { error: 'not_found' };
  return mapLesson(row, access);
}

export async function updateOpenLesson(
  viewerId: string,
  id: string,
  input: OpenLessonInput,
): Promise<OpenLessonRow | { error: string }> {
  await ensureOpenLessonsTable();
  const existing = await loadLessonById(id);
  if (!existing) return { error: 'not_found' };
  const access = await loadAccess(viewerId, existing.academic_year_id);
  if (!access) return { error: 'forbidden' };
  const next = {
    ...input,
    academicYearId: existing.academic_year_id,
    term: existing.term as OpenLessonTerm,
  };
  if (!canWrite(access, { groupId: existing.group_id, teacherId: existing.teacher_id }, next)) {
    return { error: 'assign_forbidden' };
  }
  await pool.query(
    `UPDATE open_lessons
     SET group_id = $2, teacher_id = $3, lesson_date = $4, time_label = $5,
         grade_unit_topic = $6, location = $7, remarks = $8, updated_by = $9,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      id,
      next.groupId,
      next.teacherId,
      next.lessonDate,
      next.timeText,
      next.gradeUnitTopic,
      next.location,
      next.remarks,
      viewerId,
    ],
  );
  const row = await loadLessonById(id);
  if (!row) return { error: 'not_found' };
  return mapLesson(row, access);
}

export async function deleteOpenLesson(viewerId: string, id: string): Promise<{ ok: true } | { error: string }> {
  await ensureOpenLessonsTable();
  const existing = await loadLessonById(id);
  if (!existing) return { error: 'not_found' };
  const access = await loadAccess(viewerId, existing.academic_year_id);
  if (!access) return { error: 'forbidden' };
  if (!canEditPair(access, existing.group_id, existing.teacher_id)) return { error: 'forbidden' };
  await pool.query(`DELETE FROM open_lessons WHERE id = $1`, [id]);
  return { ok: true };
}
