import crypto from 'crypto';
import pool from '../config/database.js';
import { ensureFunctionalRoleAssignmentsTable } from './functionalRoleAssignments.js';
import { loadSchoolTeachingSubjectGroups } from './schoolTeachingSubjectGroups.js';
import { ensureTeachingSubjectGroupMembersTable } from './teachingSubjectGroupMembers.js';

export const OPEN_LESSON_TERMS = ['Semester 1', 'Semester 2'] as const;
export type OpenLessonTerm = (typeof OPEN_LESSON_TERMS)[number];

export const OPEN_LESSON_KINDS = ['group', 'routine', 'school'] as const;
export type OpenLessonKind = (typeof OPEN_LESSON_KINDS)[number];
export const DEFAULT_OPEN_LESSON_KIND: OpenLessonKind = 'group';

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

export type OpenLessonClassOption = {
  id: string;
  grade: number;
  name: string;
};

export type OpenLessonRow = {
  id: string;
  academicYearId: string;
  term: OpenLessonTerm;
  lessonKind: OpenLessonKind;
  groupId: string;
  groupNameZh: string;
  groupNameEn: string;
  teacherId: string;
  teacherNameZh: string;
  teacherNameEn: string;
  classId: string;
  className: string;
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
  lessonKind: OpenLessonKind;
  viewerId: string;
  isAdmin: boolean;
  ledGroupIds: string[];
  memberGroupIds: string[];
  groups: OpenLessonGroupOption[];
  staff: OpenLessonStaffOption[];
  memberships: OpenLessonMembership[];
  classes: OpenLessonClassOption[];
  lessons: OpenLessonRow[];
};

export type OpenLessonInput = {
  academicYearId: string;
  term: OpenLessonTerm;
  lessonKind: OpenLessonKind;
  groupId: string;
  teacherId: string;
  classId: string;
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

export function isOpenLessonKind(value: string): value is OpenLessonKind {
  return (OPEN_LESSON_KINDS as readonly string[]).includes(value);
}

export async function ensureOpenLessonsTable(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS open_lessons (
      id VARCHAR(50) PRIMARY KEY,
      academic_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      term VARCHAR(20) NOT NULL CHECK (term IN ('Semester 1', 'Semester 2')),
      lesson_kind VARCHAR(20) NOT NULL DEFAULT 'group' CHECK (lesson_kind IN ('group', 'routine', 'school')),
      group_id VARCHAR(80) NOT NULL,
      teacher_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id VARCHAR(50) REFERENCES classes(id) ON DELETE SET NULL,
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
  await pool.query(`
    ALTER TABLE open_lessons
      ADD COLUMN IF NOT EXISTS class_id VARCHAR(50) REFERENCES classes(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE open_lessons
      ADD COLUMN IF NOT EXISTS lesson_kind VARCHAR(20) NOT NULL DEFAULT 'group'
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'open_lessons_lesson_kind_check'
      ) THEN
        ALTER TABLE open_lessons
          ADD CONSTRAINT open_lessons_lesson_kind_check
          CHECK (lesson_kind IN ('group', 'routine', 'school'));
      END IF;
    END $$
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
  const lessonKind = String(rec.lessonKind ?? '').trim();
  const groupId = String(rec.groupId ?? '').trim();
  const teacherId = String(rec.teacherId ?? '').trim();
  const classId = String(rec.classId ?? '').trim();
  const lessonDate = String(rec.lessonDate ?? '').trim();
  const timeText = String(rec.timeText ?? '').trim();
  const gradeUnitTopic = String(rec.gradeUnitTopic ?? '').trim();
  const location = String(rec.location ?? '').trim();
  const remarks = String(rec.remarks ?? '').trim();
  if (!academicYearId) return { error: 'year_required' };
  if (!isOpenLessonTerm(term)) return { error: 'term_invalid' };
  if (!isOpenLessonKind(lessonKind)) return { error: 'kind_invalid' };
  if (!groupId) return { error: 'group_required' };
  if (!teacherId) return { error: 'teacher_required' };
  if (!classId) return { error: 'class_required' };
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
    lessonKind,
    groupId,
    teacherId,
    classId,
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

function canAddLessonKind(access: Access, kind: OpenLessonKind): boolean {
  if (kind !== 'school') return true;
  return access.isAdmin || access.ledGroupIds.length > 0;
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
  lesson_kind: string;
  group_id: string;
  teacher_id: string;
  class_id: string | null;
  class_name: string | null;
  lesson_date: string;
  time_label: string;
  grade_unit_topic: string;
  location: string;
  remarks: string;
  teacher_name_zh: string;
  teacher_name_en: string;
  created_by: string | null;
};

function canSeeOpenLesson(
  viewerId: string,
  lesson: { lesson_kind: string; teacher_id: string; created_by: string | null },
): boolean {
  if (lesson.lesson_kind !== 'routine') return true;
  return lesson.teacher_id === viewerId || lesson.created_by === viewerId;
}

function mapLesson(row: LessonDbRow, access: Access): OpenLessonRow {
  const group = access.groups.find((g) => g.id === row.group_id);
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    term: row.term as OpenLessonTerm,
    lessonKind: row.lesson_kind as OpenLessonKind,
    groupId: row.group_id,
    groupNameZh: group?.nameZh ?? row.group_id,
    groupNameEn: group?.nameEn ?? group?.nameZh ?? row.group_id,
    teacherId: row.teacher_id,
    teacherNameZh: row.teacher_name_zh,
    teacherNameEn: row.teacher_name_en,
    classId: row.class_id ?? '',
    className: row.class_name ?? '',
    lessonDate: row.lesson_date,
    timeText: row.time_label,
    gradeUnitTopic: row.grade_unit_topic,
    location: row.location,
    remarks: row.remarks ?? '',
    canEdit: canEditPair(access, row.group_id, row.teacher_id),
  };
}

const LESSON_SELECT = `
  SELECT l.id, l.academic_year_id, l.term, l.lesson_kind, l.group_id, l.teacher_id, l.class_id,
         c.name AS class_name,
         to_char(l.lesson_date, 'YYYY-MM-DD') AS lesson_date,
         l.time_label, l.grade_unit_topic, l.location, l.remarks, l.created_by,
         ${STAFF_NAME_ZH} AS teacher_name_zh,
         ${STAFF_NAME_EN} AS teacher_name_en
  FROM open_lessons l
  JOIN users u ON u.id = l.teacher_id
  LEFT JOIN classes c ON c.id = l.class_id
`;

async function yearExists(academicYearId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM academic_years WHERE id = $1`, [academicYearId]);
  return result.rows.length > 0;
}

async function loadYearClasses(academicYearId: string): Promise<OpenLessonClassOption[]> {
  const result = await pool.query(
    `SELECT id, grade, name
     FROM classes
     WHERE academic_year_id = $1
     ORDER BY grade ASC, name ASC`,
    [academicYearId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    grade: Number(row.grade),
    name: String(row.name),
  }));
}

async function classInYear(classId: string, academicYearId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM classes WHERE id = $1 AND academic_year_id = $2`,
    [classId, academicYearId],
  );
  return result.rows.length > 0;
}

export async function getOpenLessonBoard(
  viewerId: string,
  academicYearId: string,
  term: OpenLessonTerm,
  lessonKind: OpenLessonKind,
): Promise<OpenLessonBoard | { error: string }> {
  await ensureOpenLessonsTable();
  if (!(await yearExists(academicYearId))) return { error: 'year_not_found' };
  const access = await loadAccess(viewerId, academicYearId);
  if (!access) return { error: 'forbidden' };
  const [lessonResult, classes] = await Promise.all([
    pool.query(
      `${LESSON_SELECT}
       WHERE l.academic_year_id = $1 AND l.term = $2 AND l.lesson_kind = $3
         AND (l.lesson_kind <> 'routine' OR l.teacher_id = $4 OR l.created_by = $4)
       ORDER BY l.lesson_date ASC, l.time_label ASC, l.created_at ASC`,
      [academicYearId, term, lessonKind, viewerId],
    ),
    loadYearClasses(academicYearId),
  ]);
  const rows = lessonResult.rows as LessonDbRow[];
  return {
    academicYearId,
    term,
    lessonKind,
    viewerId: access.viewerId,
    isAdmin: access.isAdmin,
    ledGroupIds: access.ledGroupIds,
    memberGroupIds: access.memberGroupIds,
    groups: access.groups,
    staff: access.staff,
    memberships: access.memberships,
    classes,
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
  if (!canAddLessonKind(access, input.lessonKind)) return { error: 'school_add_forbidden' };
  if (!canWrite(access, null, input)) return { error: 'assign_forbidden' };
  if (!(await classInYear(input.classId, input.academicYearId))) return { error: 'class_not_found' };
  const id = newId();
  await pool.query(
    `INSERT INTO open_lessons (
       id, academic_year_id, term, lesson_kind, group_id, teacher_id, class_id, lesson_date, time_label,
       grade_unit_topic, location, remarks, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [
      id,
      input.academicYearId,
      input.term,
      input.lessonKind,
      input.groupId,
      input.teacherId,
      input.classId,
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
  if (!canSeeOpenLesson(viewerId, existing)) return { error: 'not_found' };
  const next = {
    ...input,
    academicYearId: existing.academic_year_id,
    term: existing.term as OpenLessonTerm,
    lessonKind: existing.lesson_kind as OpenLessonKind,
  };
  if (!canWrite(access, { groupId: existing.group_id, teacherId: existing.teacher_id }, next)) {
    return { error: 'assign_forbidden' };
  }
  if (!(await classInYear(next.classId, existing.academic_year_id))) return { error: 'class_not_found' };
  await pool.query(
    `UPDATE open_lessons
     SET group_id = $2, teacher_id = $3, class_id = $4, lesson_date = $5, time_label = $6,
         grade_unit_topic = $7, location = $8, remarks = $9, updated_by = $10,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      id,
      next.groupId,
      next.teacherId,
      next.classId,
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

export async function listOpenLessonsForTerm(
  viewerId: string,
  academicYearId: string,
  term: OpenLessonTerm,
): Promise<{ lessons: OpenLessonRow[] } | { error: string }> {
  await ensureOpenLessonsTable();
  if (!(await yearExists(academicYearId))) return { error: 'year_not_found' };
  const access = await loadAccess(viewerId, academicYearId);
  if (!access) return { error: 'forbidden' };
  const lessonResult = await pool.query(
    `${LESSON_SELECT}
     WHERE l.academic_year_id = $1 AND l.term = $2
       AND (l.lesson_kind <> 'routine' OR l.teacher_id = $3 OR l.created_by = $3)
     ORDER BY l.lesson_date ASC, l.time_label ASC,
       CASE l.lesson_kind WHEN 'group' THEN 1 WHEN 'routine' THEN 2 ELSE 3 END,
       l.created_at ASC`,
    [academicYearId, term, viewerId],
  );
  return { lessons: (lessonResult.rows as LessonDbRow[]).map((row) => mapLesson(row, access)) };
}

export type OpenLessonImportRow = {
  row: number;
  lessonKind: string;
  groupName: string;
  teacherName: string;
  className: string;
  lessonDate: string;
  timeText: string;
  gradeUnitTopic: string;
  location: string;
  remarks: string;
};

export type OpenLessonImportIssue = {
  row: number;
  code: string;
  detail?: string;
};

const KIND_LABELS: Record<string, OpenLessonKind> = {
  group: 'group',
  routine: 'routine',
  school: 'school',
  组内公开课: 'group',
  日常课: 'routine',
  校级公开课: 'school',
  'group open lesson': 'group',
  'daily lesson': 'routine',
  'school open lesson': 'school',
};

function normName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function addAlias(index: Map<string, Set<string>>, alias: string, id: string) {
  const key = normName(alias);
  if (!key) return;
  let ids = index.get(key);
  if (!ids) {
    ids = new Set();
    index.set(key, ids);
  }
  ids.add(id);
}

function resolveAlias(
  index: Map<string, Set<string>>,
  name: string,
): { id: string } | { error: 'not_found' | 'ambiguous' } {
  const ids = index.get(normName(name));
  if (!ids || ids.size === 0) return { error: 'not_found' };
  if (ids.size > 1) return { error: 'ambiguous' };
  return { id: [...ids][0] };
}

function lessonKindFromLabel(value: string): OpenLessonKind | null {
  const key = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return KIND_LABELS[key] ?? null;
}

function normalizeTimeText(value: string): string {
  return value.trim().replace(/[–—−~～]/g, '-').replace(/：/g, ':').replace(/\s+/g, '');
}

export async function replaceOpenLessonsForTerm(
  viewerId: string,
  academicYearId: string,
  term: string,
  rows: OpenLessonImportRow[],
): Promise<{ count: number } | { error: string; issues?: OpenLessonImportIssue[] }> {
  await ensureOpenLessonsTable();
  if (!academicYearId) return { error: 'year_required' };
  if (!isOpenLessonTerm(term)) return { error: 'term_invalid' };
  if (!(await yearExists(academicYearId))) return { error: 'year_not_found' };
  const access = await loadAccess(viewerId, academicYearId);
  if (!access) return { error: 'forbidden' };
  if (rows.length === 0) return { error: 'no_rows' };

  const staffRows = (
    await pool.query(
      `SELECT id,
              TRIM(COALESCE(name_zh, '')) AS name_zh,
              TRIM(COALESCE(name_en, '')) AS name_en,
              TRIM(COALESCE(display_name, '')) AS display_name,
              TRIM(COALESCE(username, '')) AS username
       FROM users
       WHERE role IN ('teacher', 'admin', 'system-admin')`,
    )
  ).rows as Array<{ id: string; name_zh: string; name_en: string; display_name: string; username: string }>;
  const teacherIndex = new Map<string, Set<string>>();
  for (const staff of staffRows) {
    const zh = staff.name_zh || staff.display_name || staff.username || staff.id;
    const en = staff.name_en || staff.name_zh || staff.display_name || staff.username || staff.id;
    addAlias(teacherIndex, staff.name_zh, staff.id);
    addAlias(teacherIndex, staff.name_en, staff.id);
    addAlias(teacherIndex, staff.display_name, staff.id);
    addAlias(teacherIndex, staff.username, staff.id);
    addAlias(teacherIndex, zh, staff.id);
    addAlias(teacherIndex, en, staff.id);
  }
  const groupIndex = new Map<string, Set<string>>();
  for (const group of access.groups) {
    addAlias(groupIndex, group.nameZh, group.id);
    addAlias(groupIndex, group.nameEn, group.id);
  }
  const classes = await loadYearClasses(academicYearId);
  const classIndex = new Map<string, Set<string>>();
  for (const item of classes) addAlias(classIndex, item.name, item.id);

  const issues: OpenLessonImportIssue[] = [];
  const resolved: OpenLessonInput[] = [];
  for (const item of rows) {
    const lessonKind = lessonKindFromLabel(item.lessonKind);
    const group = resolveAlias(groupIndex, item.groupName);
    const teacher = resolveAlias(teacherIndex, item.teacherName);
    const classMatch = item.className.trim() ? resolveAlias(classIndex, item.className) : { error: 'not_found' as const };
    const timeText = normalizeTimeText(item.timeText);
    const rowIssues: OpenLessonImportIssue[] = [];
    if (!lessonKind) rowIssues.push({ row: item.row, code: 'kind_invalid', detail: item.lessonKind });
    if (!item.groupName.trim()) rowIssues.push({ row: item.row, code: 'group_required' });
    else if ('error' in group) {
      rowIssues.push({
        row: item.row,
        code: group.error === 'ambiguous' ? 'group_ambiguous' : 'group_not_found',
        detail: item.groupName,
      });
    }
    if (!item.teacherName.trim()) rowIssues.push({ row: item.row, code: 'teacher_required' });
    else if ('error' in teacher) {
      rowIssues.push({
        row: item.row,
        code: teacher.error === 'ambiguous' ? 'teacher_ambiguous' : 'teacher_not_found',
        detail: item.teacherName,
      });
    }
    if (!item.className.trim()) rowIssues.push({ row: item.row, code: 'class_required' });
    else if ('error' in classMatch) {
      rowIssues.push({
        row: item.row,
        code: classMatch.error === 'ambiguous' ? 'class_ambiguous' : 'class_not_found',
        detail: item.className,
      });
    }
    if (rowIssues.length > 0 || !lessonKind || !('id' in group) || !('id' in teacher) || !('id' in classMatch)) {
      issues.push(...rowIssues);
      continue;
    }
    const parsed = parseOpenLessonInput({
      academicYearId,
      term,
      lessonKind,
      groupId: group.id,
      teacherId: teacher.id,
      classId: classMatch.id,
      lessonDate: item.lessonDate,
      timeText,
      gradeUnitTopic: item.gradeUnitTopic,
      location: item.location,
      remarks: item.remarks,
    });
    if ('error' in parsed) {
      issues.push({ row: item.row, code: parsed.error });
      continue;
    }
    if (!canAddLessonKind(access, lessonKind)) {
      issues.push({ row: item.row, code: 'school_add_forbidden' });
      continue;
    }
    if (!canAssign(access, group.id, teacher.id)) {
      issues.push({ row: item.row, code: 'assign_forbidden', detail: item.teacherName });
      continue;
    }
    resolved.push(parsed);
  }
  if (issues.length > 0) return { error: 'import_invalid', issues };

  const existing = (
    await pool.query(
      `SELECT group_id, teacher_id, lesson_kind, created_by
       FROM open_lessons WHERE academic_year_id = $1 AND term = $2`,
      [academicYearId, term],
    )
  ).rows as Array<{ group_id: string; teacher_id: string; lesson_kind: string; created_by: string | null }>;
  const visibleExisting = existing.filter((row) => canSeeOpenLesson(viewerId, row));
  if (visibleExisting.some((row) => !canEditPair(access, row.group_id, row.teacher_id))) {
    return { error: 'import_forbidden' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM open_lessons
       WHERE academic_year_id = $1 AND term = $2
         AND (lesson_kind <> 'routine' OR teacher_id = $3 OR created_by = $3)`,
      [academicYearId, term, viewerId],
    );
    for (const input of resolved) {
      await client.query(
        `INSERT INTO open_lessons (
           id, academic_year_id, term, lesson_kind, group_id, teacher_id, class_id, lesson_date, time_label,
           grade_unit_topic, location, remarks, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [
          newId(),
          input.academicYearId,
          input.term,
          input.lessonKind,
          input.groupId,
          input.teacherId,
          input.classId,
          input.lessonDate,
          input.timeText,
          input.gradeUnitTopic,
          input.location,
          input.remarks,
          viewerId,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { count: resolved.length };
}

export async function deleteOpenLesson(viewerId: string, id: string): Promise<{ ok: true } | { error: string }> {
  await ensureOpenLessonsTable();
  const existing = await loadLessonById(id);
  if (!existing) return { error: 'not_found' };
  const access = await loadAccess(viewerId, existing.academic_year_id);
  if (!access) return { error: 'forbidden' };
  if (!canSeeOpenLesson(viewerId, existing)) return { error: 'not_found' };
  if (!canEditPair(access, existing.group_id, existing.teacher_id)) return { error: 'forbidden' };
  await pool.query(`DELETE FROM open_lessons WHERE id = $1`, [id]);
  return { ok: true };
}
