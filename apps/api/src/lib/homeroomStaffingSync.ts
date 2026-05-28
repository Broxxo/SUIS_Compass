import type { Pool, PoolClient } from 'pg';
import { STAFFING_HOMEROOM_SUBJECT_KEY, staffingHomeroomSubjectName, staffingSubjectKeyFromCourse } from '@repo/shared';
import { ensureStaffingTables } from './ensureStaffingTables.js';
import { ensureClassTeacherAssignmentsTable } from './ensureClassTeacherAssignmentsTable.js';

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type Db = Pool | PoolClient;

/**
 * 与岗位表「班 / 班会」类课程列对齐（依据课程设置里的 `courses.name`，与岗位列一致）。
 * 班主任岗位确定后，这些列的 teacher_slot 0 自动与班主任一致。
 */
const HOMEROOM_SYNCED_CLASS_MEETING_COURSE_NAMES_EXACT = new Set([
  '班',
  '班会',
  '班会课',
  '班队',
  '班课',
  '主题班会',
  '班队课',
]);

function isHanChar(ch: string): boolean {
  return ch.length === 1 && /\p{Script=Han}/u.test(ch);
}

/** 从字符串开头起连续汉字，遇非汉字即停（如「班会-SUIS」→「班会」） */
function leadingContiguousHanFromStart(s: string): string {
  let out = '';
  for (const ch of s) {
    if (isHanChar(ch)) out += ch;
    else break;
  }
  return out;
}

/** 课程设置名可能是「班会 / Class Meeting」或仅一段，分段分别判定 */
function* segmentsForStaffingMatch(raw: string): Generator<string> {
  const t = raw.trim();
  if (!t) return;
  yield t;
  for (const part of t.split(/[/|／]/)) {
    const p = part.trim();
    if (p && p !== t) yield p;
  }
}

function matchesClassMeetingCourseSegment(segment: string): boolean {
  const n = segment.trim();
  if (!n) return false;
  if (HOMEROOM_SYNCED_CLASS_MEETING_COURSE_NAMES_EXACT.has(n)) return true;

  const lower = n.toLowerCase().replace(/\s+/g, ' ');
  if (lower.startsWith('class meeting')) return true;

  const hanLead = leadingContiguousHanFromStart(n);
  if (hanLead.length >= 2 && hanLead.slice(0, 2) === '班会') return true;

  return false;
}

function isHomeroomSyncedClassMeetingCourseName(rawName: string): boolean {
  for (const seg of segmentsForStaffingMatch(rawName)) {
    if (matchesClassMeetingCourseSegment(seg)) return true;
  }
  return false;
}

function parseApplicableGradeKeysFromCourseRow(raw: unknown): string[] {
  const set = new Set<string>();
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) arr = p;
    } catch {
      /* ignore */
    }
  }
  for (const item of arr) {
    if (typeof item === 'string' && item.trim()) {
      const s = item.trim();
      const n = Number(s);
      if (Number.isFinite(n) && n >= 1 && n <= 20) {
        set.add(`g${Math.round(n)}`);
      } else {
        set.add(s);
      }
      continue;
    }
    const n = typeof item === 'number' ? item : parseInt(String(item), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 20) {
      set.add(`g${Math.round(n)}`);
    }
  }
  return Array.from(set);
}

/**
 * 与岗位表展示尽量一致：能解析出 g{年级} 时按数值年级过滤；
 * 若仅配置学段等非 g{n} id，服务端无法可靠对应班级 grade，则仍同步以免漏填（如班会课）。
 */
function classGradeEligibleForCourse(applicableRaw: unknown, classGrade: number): boolean {
  const keys = parseApplicableGradeKeysFromCourseRow(applicableRaw);
  if (keys.length === 0) return true;
  if (keys.includes(`g${classGrade}`)) return true;
  const everyKeyIsNumericGrade = keys.length > 0 && keys.every((k) => /^g\d+$/i.test(k));
  if (everyKeyIsNumericGrade) return false;
  return true;
}

async function syncHomeroomTeacherToClassMeetingStaffing(db: Db, classId: string, homeroomTeacherId: string | null): Promise<void> {
  await ensureStaffingTables();
  const cls = (await db.query(`SELECT academic_year_id, grade FROM classes WHERE id = $1 LIMIT 1`, [classId])).rows[0] as
    | { academic_year_id: string; grade: number }
    | undefined;
  if (!cls) return;
  const grade = Number(cls.grade);
  if (!Number.isFinite(grade)) return;

  const courseRows = (await db.query(`SELECT id, name, applicable_grades FROM courses`)).rows as Array<{
    id: string;
    name: string;
    applicable_grades: unknown;
  }>;

  const targets: Array<{ subjectKey: string; subjectName: string }> = [];
  for (const c of courseRows) {
    const name = String(c.name ?? '').trim();
    if (!isHomeroomSyncedClassMeetingCourseName(name)) continue;
    if (!classGradeEligibleForCourse(c.applicable_grades, grade)) continue;
    const subjectKey = staffingSubjectKeyFromCourse(String(c.id), name);
    targets.push({ subjectKey, subjectName: name });
  }

  if (homeroomTeacherId) {
    for (const t of targets) {
      const id = `csta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await db.query(
        `INSERT INTO class_subject_teacher_assignments
          (id, academic_year_id, class_id, subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, NULL)
         ON CONFLICT (academic_year_id, class_id, subject_key, teacher_slot)
         DO UPDATE SET
           subject_name = EXCLUDED.subject_name,
           teacher_id = EXCLUDED.teacher_id,
           updated_at = CURRENT_TIMESTAMP`,
        [id, cls.academic_year_id, classId, t.subjectKey, t.subjectName, homeroomTeacherId],
      );
    }
  } else {
    for (const t of targets) {
      await db.query(
        `DELETE FROM class_subject_teacher_assignments
         WHERE academic_year_id = $1 AND class_id = $2 AND subject_key = $3 AND teacher_slot = 0`,
        [cls.academic_year_id, classId, t.subjectKey],
      );
    }
  }
}

/** 将班级管理中的班主任写入岗位表（按学年 class_subject_teacher_assignments） */
export async function upsertHomeroomStaffingFromClassTables(db: Db, classId: string): Promise<void> {
  await ensureStaffingTables();
  await ensureClassTeacherAssignmentsTable(db);
  const cls = (
    await db.query(`SELECT id, academic_year_id, teacher_id FROM classes WHERE id = $1 LIMIT 1`, [classId])
  ).rows[0] as { id: string; academic_year_id: string; teacher_id: string | null } | undefined;
  if (!cls) return;

  const homeroomRow = (
    await db.query(
      `SELECT teacher_id
       FROM class_teacher_assignments
       WHERE class_id = $1 AND role = 'homeroom' AND unassigned_at IS NULL
       ORDER BY assigned_at DESC
       LIMIT 1`,
      [classId],
    )
  ).rows[0] as { teacher_id: string } | undefined;
  const teacherId = homeroomRow?.teacher_id ?? cls.teacher_id ?? null;
  if (!teacherId) {
    await db.query(
      `DELETE FROM class_subject_teacher_assignments
       WHERE academic_year_id = $1 AND class_id = $2 AND subject_key = $3`,
      [cls.academic_year_id, classId, STAFFING_HOMEROOM_SUBJECT_KEY],
    );
    await syncHomeroomTeacherToClassMeetingStaffing(db, classId, null);
    return;
  }
  const id = `csta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const zh = staffingHomeroomSubjectName(true);
  const en = staffingHomeroomSubjectName(false);
  const subjectName = `${zh} / ${en}`;
  await db.query(
    `INSERT INTO class_subject_teacher_assignments
      (id, academic_year_id, class_id, subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, NULL)
     ON CONFLICT (academic_year_id, class_id, subject_key, teacher_slot)
     DO UPDATE SET
       subject_name = EXCLUDED.subject_name,
       teacher_id = EXCLUDED.teacher_id,
       updated_at = CURRENT_TIMESTAMP`,
    [id, cls.academic_year_id, classId, STAFFING_HOMEROOM_SUBJECT_KEY, subjectName, teacherId],
  );
  await syncHomeroomTeacherToClassMeetingStaffing(db, classId, teacherId);
}

/**
 * 岗位安排保存班主任后，同步 class_teacher_assignments + classes.teacher_id
 *（与 POST /classes/:id/teachers role=homeroom 行为一致）
 */
export async function applyHomeroomFromStaffingToClassTables(
  db: Db,
  classId: string,
  teacherId: string | null,
): Promise<void> {
  await ensureClassTeacherAssignmentsTable(db);
  if (teacherId) {
    await db.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL`,
      [classId, teacherId],
    );
    await db.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND role = 'homeroom' AND unassigned_at IS NULL`,
      [classId],
    );
    await db.query(`UPDATE classes SET teacher_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
      teacherId,
      classId,
    ]);
    const ctaId = createId('cta');
    await db.query(
      `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role)
       VALUES ($1, $2, $3, 'homeroom')`,
      [ctaId, classId, teacherId],
    );
  } else {
    await db.query(
      `UPDATE class_teacher_assignments
       SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND role = 'homeroom' AND unassigned_at IS NULL`,
      [classId],
    );
    await db.query(`UPDATE classes SET teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [classId]);
  }
  await syncHomeroomTeacherToClassMeetingStaffing(db, classId, teacherId);
}

/** 拉取岗位表时：把仅有班级管理数据、尚未写入岗位表的班主任补进 class_subject_teacher_assignments */
export async function backfillHomeroomStaffingForAcademicYear(db: Db, academicYearId: string): Promise<void> {
  await ensureStaffingTables();
  await ensureClassTeacherAssignmentsTable(db);
  const rows = (
    await db.query(
      `SELECT c.id AS class_id
       FROM classes c
       WHERE c.academic_year_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM class_subject_teacher_assignments s
           WHERE s.academic_year_id = c.academic_year_id
             AND s.class_id = c.id
             AND s.subject_key = $2
             AND s.teacher_slot = 0
         )
         AND (
           EXISTS (
             SELECT 1 FROM class_teacher_assignments a
             WHERE a.class_id = c.id AND a.role = 'homeroom' AND a.unassigned_at IS NULL
           )
           OR c.teacher_id IS NOT NULL
         )`,
      [academicYearId, STAFFING_HOMEROOM_SUBJECT_KEY],
    )
  ).rows as Array<{ class_id: string }>;
  for (const r of rows) {
    await upsertHomeroomStaffingFromClassTables(db, r.class_id);
  }
}
