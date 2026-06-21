import type { PoolClient } from 'pg';
import pool from '../config/database.js';
import {
  bumpClassNameForPromotion,
  bumpIsoDateByYears,
  getGradeCatalogIdForClass,
  getGradeIdByLevel,
  getGradeLevelById,
  graduateArchiveLabel,
  isGraduatingClass,
  suggestNextAcademicYearName,
  type GradeConfig,
} from '@repo/shared';
import { ensureClassArchiveColumns } from './classArchiveColumns.js';
import { ensureClassTeacherAssignmentsTable } from './ensureClassTeacherAssignmentsTable.js';
import { ensureFunctionalRoleAssignmentsTable } from './functionalRoleAssignments.js';
import { ensureStaffingTables } from './ensureStaffingTables.js';
import { copyElectivesToAcademicYear, ensureElectiveTables } from './electiveStaffing.js';
import { copySelfStudyToAcademicYear, ensureSelfStudyTables } from './selfStudyStaffing.js';
import { loadSchoolGradeStructure, type GradeConfig as ApiGradeConfig } from './schoolGradeStructure.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const ensurePromotionLogTable = (() => {
  let ensured = false;
  return async () => {
    if (ensured) return;
    await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_year_promotion_log (
      id VARCHAR(80) PRIMARY KEY,
      source_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      target_year_id VARCHAR(50) NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      promoted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      undone_at TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ay_promotion_log_target
      ON academic_year_promotion_log(target_year_id, promoted_at DESC)
  `);
    ensured = true;
  };
})();

async function captureGraduatedClassSnapshot(
  client: PoolClient,
  sourceYearId: string,
  classId: string,
  classGrade: number,
  teacherId: string | null,
  archiveLabel: string,
  catalogId: string,
): Promise<GraduatedClassPromotionSnapshot> {
  const subjectAssignments = (await client.query(
    `SELECT subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by
     FROM class_subject_teacher_assignments
     WHERE academic_year_id = $1 AND class_id = $2`,
    [sourceYearId, classId],
  )).rows as GraduatedClassPromotionSnapshot['subjectAssignments'];

  const gradeHeadRow = (await client.query(
    `SELECT scope_key, scope_label, teacher_id, updated_by
     FROM functional_role_assignments
     WHERE academic_year_id = $1 AND role_type = 'grade-head' AND scope_key = $2
     LIMIT 1`,
    [sourceYearId, catalogId],
  )).rows[0] as
    | { scope_key: string; scope_label: string | null; teacher_id: string; updated_by: string | null }
    | undefined;

  return {
    classId,
    classGrade,
    teacherId,
    archiveLabel,
    catalogId,
    subjectAssignments,
    gradeHead: gradeHeadRow?.teacher_id
      ? {
          scope_key: gradeHeadRow.scope_key,
          scope_label: gradeHeadRow.scope_label,
          teacher_id: gradeHeadRow.teacher_id,
          updated_by: gradeHeadRow.updated_by,
        }
      : null,
  };
}

async function restoreGraduatedClassFromSnapshot(
  client: PoolClient,
  sourceYearId: string,
  snapshot: GraduatedClassPromotionSnapshot,
): Promise<void> {
  await client.query(
    `UPDATE classes
     SET archived_at = NULL, archive_label = NULL, teacher_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [snapshot.teacherId, snapshot.classId],
  );

  for (const row of snapshot.subjectAssignments) {
    await client.query(
      `INSERT INTO class_subject_teacher_assignments
         (id, academic_year_id, class_id, subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (academic_year_id, class_id, subject_key, teacher_slot)
       DO UPDATE SET
         subject_name = EXCLUDED.subject_name,
         teacher_id = EXCLUDED.teacher_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [
        createId('csta'),
        sourceYearId,
        snapshot.classId,
        row.subject_key,
        row.subject_name,
        row.teacher_id,
        Number(row.teacher_slot ?? 0) === 1 ? 1 : 0,
        row.created_by,
        row.updated_by,
      ],
    );
  }

  if (snapshot.teacherId) {
    const existing = (await client.query(
      `SELECT id FROM class_teacher_assignments
       WHERE class_id = $1 AND teacher_id = $2 AND role = 'homeroom' AND unassigned_at IS NULL
       LIMIT 1`,
      [snapshot.classId, snapshot.teacherId],
    )).rows[0];
    if (!existing) {
      await client.query(
        `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role, assigned_at)
         VALUES ($1, $2, $3, 'homeroom', CURRENT_TIMESTAMP)`,
        [createId('cta'), snapshot.classId, snapshot.teacherId],
      );
    }
  }

  if (snapshot.gradeHead) {
    await client.query(
      `INSERT INTO functional_role_assignments
         (id, academic_year_id, role_type, scope_key, scope_label, teacher_id, updated_by)
       VALUES ($1, $2, 'grade-head', $3, $4, $5, $6)
       ON CONFLICT (academic_year_id, role_type, scope_key)
       DO UPDATE SET
         scope_label = EXCLUDED.scope_label,
         teacher_id = EXCLUDED.teacher_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [
        createId('fra'),
        sourceYearId,
        snapshot.gradeHead.scope_key,
        snapshot.gradeHead.scope_label,
        snapshot.gradeHead.teacher_id,
        snapshot.gradeHead.updated_by,
      ],
    );
  }
}

async function restoreStudentAfterPromotionUndo(
  client: PoolClient,
  studentId: string,
  sourceYearId: string,
  targetYearId: string,
): Promise<void> {
  const sourceEnr = (await client.query(
    `SELECT e.class_id, c.grade
     FROM student_enrollments e
     JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = $1 AND e.academic_year_id = $2
     LIMIT 1`,
    [studentId, sourceYearId],
  )).rows[0] as { class_id: string; grade: number } | undefined;
  if (!sourceEnr) return;

  await client.query(
    `DELETE FROM student_assignment_history
     WHERE student_id = $1 AND source = 'promotion' AND academic_year_id = ANY($2::varchar[])`,
    [studentId, [sourceYearId, targetYearId]],
  );
  await client.query(
    `UPDATE student_assignment_history SET effective_to = NULL
     WHERE id = (
       SELECT id FROM student_assignment_history
       WHERE student_id = $1 AND effective_to IS NOT NULL
       ORDER BY effective_from DESC, created_at DESC
       LIMIT 1
     )`,
    [studentId],
  );
  await client.query(
    `UPDATE students
     SET status = 'active',
         division = NULL,
         current_grade = $1,
         current_class_id = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [Number(sourceEnr.grade), sourceEnr.class_id, studentId],
  );
}

async function purgeAcademicYear(client: PoolClient, yearId: string): Promise<void> {
  await client.query(`DELETE FROM student_enrollments WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM self_study_slots WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM self_study_grade_configs WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM self_study_modules WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM elective_courses WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM elective_schedule_config WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM class_subject_teacher_assignments WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM functional_role_assignments WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM teaching_subject_group_members WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM classes WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM student_assignment_history WHERE academic_year_id = $1`, [yearId]);
  await client.query(`DELETE FROM academic_years WHERE id = $1`, [yearId]);
}

type PromotionLogRow = {
  id: string;
  source_year_id: string;
  target_year_id: string;
  promoted_at: Date;
  snapshot: unknown;
};

async function getLatestUndoablePromotionLog(): Promise<PromotionLogRow | null> {
  await ensurePromotionLogTable();
  const row = (await pool.query(
    `SELECT id, source_year_id, target_year_id, promoted_at, snapshot
     FROM academic_year_promotion_log
     WHERE undone_at IS NULL
     ORDER BY promoted_at DESC
     LIMIT 1`,
  )).rows[0] as PromotionLogRow | undefined;
  return row ?? null;
}

function parsePromotionSnapshot(raw: unknown): AcademicYearPromotionSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { graduatedClasses: [] };
  }
  const rec = raw as { graduatedClasses?: unknown };
  const graduatedClasses = Array.isArray(rec.graduatedClasses)
    ? (rec.graduatedClasses as GraduatedClassPromotionSnapshot[])
    : [];
  return { graduatedClasses };
}

export async function buildAcademicYearUndoPreview(): Promise<AcademicYearUndoPreview | null> {
  await ensurePromotionLogTable();
  const log = await getLatestUndoablePromotionLog();
  if (!log) return null;

  const sourceRow = (await pool.query(
    `SELECT id, name FROM academic_years WHERE id = $1 LIMIT 1`,
    [log.source_year_id],
  )).rows[0] as { id: string; name: string } | undefined;
  const targetRow = (await pool.query(
    `SELECT id, name, is_current FROM academic_years WHERE id = $1 LIMIT 1`,
    [log.target_year_id],
  )).rows[0] as { id: string; name: string; is_current: boolean } | undefined;

  const snapshot = parsePromotionSnapshot(log.snapshot);
  const targetClassCount = Number(
    (await pool.query(`SELECT COUNT(*)::int AS c FROM classes WHERE academic_year_id = $1`, [log.target_year_id]))
      .rows[0]?.c ?? 0,
  );
  const targetEnrollmentCount = Number(
    (
      await pool.query(
        `SELECT COUNT(*)::int AS c FROM student_enrollments WHERE academic_year_id = $1`,
        [log.target_year_id],
      )
    ).rows[0]?.c ?? 0,
  );

  const warnings: string[] = [
    '仅用于测试：将删除新学年及其学籍/岗位/选修与自习配置；若升学后在新学年手工录入的数据会一并丢失。',
    '仅可撤销最近一次升学，且新学年须仍为系统默认学年。',
  ];

  let canUndo = true;
  let blockReason: string | null = null;
  if (!sourceRow || !targetRow) {
    canUndo = false;
    blockReason = 'SOURCE_OR_TARGET_MISSING';
    warnings.push('源学年或新学年已不存在，无法撤销。');
  } else if (!targetRow.is_current) {
    canUndo = false;
    blockReason = 'TARGET_NOT_CURRENT';
    warnings.push('新学年已不是系统默认学年，请先切回默认学年或勿手动切换后再撤销。');
  } else if (suggestNextAcademicYearName(sourceRow.name) !== targetRow.name) {
    canUndo = false;
    blockReason = 'YEAR_NAME_MISMATCH';
    warnings.push('学年名称与最近一次升学记录不一致，无法自动撤销。');
  }

  return {
    logId: log.id,
    sourceYearId: log.source_year_id,
    sourceYearName: sourceRow?.name ?? log.source_year_id,
    targetYearId: log.target_year_id,
    targetYearName: targetRow?.name ?? log.target_year_id,
    promotedAt: log.promoted_at.toISOString(),
    canUndo,
    blockReason,
    summary: {
      targetClassCount,
      targetEnrollmentCount,
      graduatedClassesToRestore: snapshot.graduatedClasses.length,
    },
    warnings,
  };
}

export async function undoAcademicYearPromotion(
  client: PoolClient,
): Promise<UndoAcademicYearPromotionResult> {
  await ensurePromotionLogTable();
  const preview = await buildAcademicYearUndoPreview();
  if (!preview) {
    throw new Error('NO_UNDOABLE_PROMOTION');
  }
  if (!preview.canUndo) {
    throw new Error(preview.blockReason ?? 'CANNOT_UNDO');
  }

  const log = await getLatestUndoablePromotionLog();
  if (!log || log.id !== preview.logId) {
    throw new Error('NO_UNDOABLE_PROMOTION');
  }

  const snapshot = parsePromotionSnapshot(log.snapshot);
  const { sourceYearId, targetYearId } = preview;
  let studentsRestored = 0;

  const affectedStudentIds = new Set<string>();
  const targetStudents = (await client.query(
    `SELECT DISTINCT student_id FROM student_enrollments WHERE academic_year_id = $1`,
    [targetYearId],
  )).rows as Array<{ student_id: string }>;
  for (const row of targetStudents) affectedStudentIds.add(row.student_id);

  const graduatedClassIds = snapshot.graduatedClasses.map((g) => g.classId);
  if (graduatedClassIds.length) {
    const gradStudents = (await client.query(
      `SELECT DISTINCT student_id
       FROM student_enrollments
       WHERE academic_year_id = $1 AND class_id = ANY($2::varchar[])`,
      [sourceYearId, graduatedClassIds],
    )).rows as Array<{ student_id: string }>;
    for (const row of gradStudents) affectedStudentIds.add(row.student_id);
  }

  for (const studentId of affectedStudentIds) {
    await restoreStudentAfterPromotionUndo(client, studentId, sourceYearId, targetYearId);
    studentsRestored += 1;
  }

  for (const graduated of snapshot.graduatedClasses) {
    await restoreGraduatedClassFromSnapshot(client, sourceYearId, graduated);
  }

  await purgeAcademicYear(client, targetYearId);

  await client.query(`UPDATE academic_years SET is_current = FALSE`);
  await client.query(`UPDATE academic_years SET is_current = TRUE WHERE id = $1`, [sourceYearId]);

  await client.query(
    `UPDATE academic_year_promotion_log SET undone_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [log.id],
  );

  return {
    success: true,
    sourceYearId,
    sourceYearName: preview.sourceYearName,
    targetYearId,
    targetYearName: preview.targetYearName,
    studentsRestored,
    classesUnarchived: snapshot.graduatedClasses.length,
    sourceSetCurrent: true,
  };
}

export type PromoteToNextYearResult = {
  success: true;
  sourceYearId: string;
  targetYearId: string;
  targetYearName: string;
  classesPromoted: number;
  classesGraduated: number;
  studentsPromoted: number;
  studentsGraduated: number;
  targetSetCurrent: true;
};

export type GraduatedClassPromotionSnapshot = {
  classId: string;
  classGrade: number;
  teacherId: string | null;
  archiveLabel: string;
  catalogId: string;
  subjectAssignments: Array<{
    subject_key: string;
    subject_name: string;
    teacher_id: string;
    teacher_slot: number;
    created_by: string | null;
    updated_by: string | null;
  }>;
  gradeHead: {
    scope_key: string;
    scope_label: string | null;
    teacher_id: string;
    updated_by: string | null;
  } | null;
};

export type AcademicYearPromotionSnapshot = {
  graduatedClasses: GraduatedClassPromotionSnapshot[];
};

export type UndoAcademicYearPromotionResult = {
  success: true;
  sourceYearId: string;
  sourceYearName: string;
  targetYearId: string;
  targetYearName: string;
  studentsRestored: number;
  classesUnarchived: number;
  sourceSetCurrent: true;
};

export type AcademicYearUndoPreview = {
  logId: string;
  sourceYearId: string;
  sourceYearName: string;
  targetYearId: string;
  targetYearName: string;
  promotedAt: string;
  canUndo: boolean;
  blockReason: string | null;
  summary: {
    targetClassCount: number;
    targetEnrollmentCount: number;
    graduatedClassesToRestore: number;
  };
  warnings: string[];
};

export type PromotionPreviewClassPromote = {
  sourceClassId: string;
  sourceName: string;
  sourceGrade: number;
  targetName: string;
  targetGrade: number;
  studentCount: number;
  homeroomTeacherId: string | null;
  homeroomTeacherName: string | null;
  subjectAssignmentCount: number;
};

export type PromotionPreviewClassGraduate = {
  classId: string;
  className: string;
  grade: number;
  archiveLabel: string;
  studentCount: number;
  homeroomTeacherId: string | null;
  homeroomTeacherName: string | null;
  subjectAssignmentCount: number;
};

export type PromotionPreviewSubjectCopy = {
  sourceClassName: string;
  targetClassName: string;
  subjectName: string;
  teacherName: string;
};

export type PromotionPreviewGradeHeadChange = {
  fromScopeLabel: string;
  toScopeLabel: string;
  teacherName: string;
};

export type PromotionPreviewGradeHeadRelease = {
  scopeLabel: string;
  teacherName: string;
};

export type PromotionPreviewSubjectGroupHead = {
  scopeLabel: string;
  teacherName: string;
};

export type AcademicYearPromotionPreview = {
  sourceYearId: string;
  sourceYearName: string;
  targetYearName: string;
  targetStartDate: string | null;
  targetEndDate: string | null;
  canExecute: boolean;
  blockReason: string | null;
  summary: {
    classesPromoted: number;
    classesGraduated: number;
    studentsPromoted: number;
    studentsGraduated: number;
    subjectAssignmentsCopied: number;
    subjectGroupMembersCopied: number;
    willSetDefaultYear: boolean;
  };
  classes: {
    promote: PromotionPreviewClassPromote[];
    graduate: PromotionPreviewClassGraduate[];
  };
  staffing: {
    subjectCopies: PromotionPreviewSubjectCopy[];
    graduateStaffingReleased: Array<{
      className: string;
      archiveLabel: string;
      homeroomTeacherName: string | null;
      subjectAssignmentCount: number;
    }>;
  };
  functionalRoles: {
    gradeHeadPromote: PromotionPreviewGradeHeadChange[];
    gradeHeadRelease: PromotionPreviewGradeHeadRelease[];
    subjectGroupHeadCopy: PromotionPreviewSubjectGroupHead[];
    subjectGroupMembersCopied: number;
  };
  unchanged: string[];
  warnings: string[];
};

async function loadTeacherDisplayNameMap(teacherIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(teacherIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = (await pool.query(
    `SELECT id,
            COALESCE(NULLIF(TRIM(name_zh), ''), NULLIF(TRIM(name_en), ''),
                     NULLIF(TRIM(display_name), ''), username, id) AS display_name
     FROM users WHERE id = ANY($1::varchar[])`,
    [ids],
  )).rows as Array<{ id: string; display_name: string }>;
  for (const r of rows) map.set(r.id, r.display_name);
  return map;
}

function teacherName(map: Map<string, string>, id: string | null | undefined): string | null {
  if (!id) return null;
  return map.get(id) ?? id;
}

export async function prepareAcademicYearPromotionDependencies(): Promise<void> {
  await ensurePromotionLogTable();
  await ensureClassTeacherAssignmentsTable(pool);
  await ensureStaffingTables();
  await ensureClassArchiveColumns(pool);
  await ensureFunctionalRoleAssignmentsTable();
  await ensureSelfStudyTables(pool);
  await ensureElectiveTables(pool);
}

export async function buildAcademicYearPromotionPreview(
  sourceYearId: string,
): Promise<AcademicYearPromotionPreview> {
  await ensureClassTeacherAssignmentsTable(pool);
  await ensureStaffingTables();
  await ensureClassArchiveColumns(pool);
  await ensureFunctionalRoleAssignmentsTable();

  const sourceRow = (await pool.query(
    `SELECT id, name, start_date, end_date FROM academic_years WHERE id = $1 LIMIT 1`,
    [sourceYearId],
  )).rows[0] as
    | { id: string; name: string; start_date: Date | null; end_date: Date | null }
    | undefined;

  if (!sourceRow) {
    return {
      sourceYearId,
      sourceYearName: '',
      targetYearName: '',
      targetStartDate: null,
      targetEndDate: null,
      canExecute: false,
      blockReason: 'SOURCE_YEAR_NOT_FOUND',
      summary: {
        classesPromoted: 0,
        classesGraduated: 0,
        studentsPromoted: 0,
        studentsGraduated: 0,
        subjectAssignmentsCopied: 0,
        subjectGroupMembersCopied: 0,
        willSetDefaultYear: true,
      },
      classes: { promote: [], graduate: [] },
      staffing: { subjectCopies: [], graduateStaffingReleased: [] },
      functionalRoles: {
        gradeHeadPromote: [],
        gradeHeadRelease: [],
        subjectGroupHeadCopy: [],
        subjectGroupMembersCopied: 0,
      },
      unchanged: [],
      warnings: ['源学年不存在'],
    };
  }

  const targetYearName = suggestNextAcademicYearName(sourceRow.name);
  const existingTarget = (await pool.query(
    `SELECT id FROM academic_years WHERE name = $1 LIMIT 1`,
    [targetYearName],
  )).rows[0] as { id: string } | undefined;

  const targetStart = bumpIsoDateByYears(sourceRow.start_date?.toISOString().slice(0, 10)) ?? null;
  const targetEnd = bumpIsoDateByYears(sourceRow.end_date?.toISOString().slice(0, 10)) ?? null;

  const gradeConfig = (await loadSchoolGradeStructure()) as ApiGradeConfig & GradeConfig;
  const graduatingCatalogIds = new Set<string>();

  const sourceClasses = (await pool.query(
    `SELECT id, grade, name, teacher_id FROM classes
     WHERE academic_year_id = $1 AND archived_at IS NULL
     ORDER BY grade ASC, name ASC`,
    [sourceYearId],
  )).rows as Array<{ id: string; grade: number; name: string; teacher_id: string | null }>;

  const studentCountByClass = new Map<string, number>();
  const countRows = (await pool.query(
    `SELECT e.class_id, COUNT(*)::int AS cnt
     FROM student_enrollments e
     JOIN students s ON s.id = e.student_id
     WHERE e.academic_year_id = $1 AND s.status = 'active'
     GROUP BY e.class_id`,
    [sourceYearId],
  )).rows as Array<{ class_id: string; cnt: number }>;
  for (const r of countRows) studentCountByClass.set(r.class_id, Number(r.cnt));

  const subjectRows = (await pool.query(
    `SELECT class_id, subject_name, teacher_id
     FROM class_subject_teacher_assignments
     WHERE academic_year_id = $1`,
    [sourceYearId],
  )).rows as Array<{ class_id: string; subject_name: string; teacher_id: string }>;
  const subjectsByClass = new Map<string, Array<{ subject_name: string; teacher_id: string }>>();
  for (const r of subjectRows) {
    const list = subjectsByClass.get(r.class_id) ?? [];
    list.push({ subject_name: r.subject_name, teacher_id: r.teacher_id });
    subjectsByClass.set(r.class_id, list);
  }

  const roles = (await pool.query(
    `SELECT role_type, scope_key, scope_label, teacher_id
     FROM functional_role_assignments WHERE academic_year_id = $1`,
    [sourceYearId],
  )).rows as Array<{
    role_type: string;
    scope_key: string;
    scope_label: string | null;
    teacher_id: string | null;
  }>;

  const memberCount = Number(
    (
      await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM teaching_subject_group_members WHERE academic_year_id = $1`,
        [sourceYearId],
      )
    ).rows[0]?.cnt ?? 0,
  );

  const teacherIds: string[] = [];
  for (const c of sourceClasses) if (c.teacher_id) teacherIds.push(c.teacher_id);
  for (const r of subjectRows) teacherIds.push(r.teacher_id);
  for (const r of roles) if (r.teacher_id) teacherIds.push(r.teacher_id);
  const teacherMap = await loadTeacherDisplayNameMap(teacherIds);

  const promote: PromotionPreviewClassPromote[] = [];
  const graduate: PromotionPreviewClassGraduate[] = [];
  const subjectCopies: PromotionPreviewSubjectCopy[] = [];
  const graduateStaffingReleased: AcademicYearPromotionPreview['staffing']['graduateStaffingReleased'] = [];

  let studentsPromoted = 0;
  let studentsGraduated = 0;

  for (const cls of sourceClasses) {
    const studentCount = studentCountByClass.get(cls.id) ?? 0;
    const subjectList = subjectsByClass.get(cls.id) ?? [];
    const grad = isGraduatingClass(gradeConfig, { grade: Number(cls.grade), name: cls.name });
    if (grad.graduating) {
      graduatingCatalogIds.add(grad.catalogId);
      const archiveLabel = graduateArchiveLabel(grad.segmentLabel, true);
      graduate.push({
        classId: cls.id,
        className: cls.name,
        grade: Number(cls.grade),
        archiveLabel,
        studentCount,
        homeroomTeacherId: cls.teacher_id,
        homeroomTeacherName: teacherName(teacherMap, cls.teacher_id),
        subjectAssignmentCount: subjectList.length,
      });
      graduateStaffingReleased.push({
        className: cls.name,
        archiveLabel,
        homeroomTeacherName: teacherName(teacherMap, cls.teacher_id),
        subjectAssignmentCount: subjectList.length,
      });
      studentsGraduated += studentCount;
      continue;
    }

    const nextGrade = Number(cls.grade) + 1;
    const nextName = bumpClassNameForPromotion(cls.name, Number(cls.grade), nextGrade, gradeConfig);
    promote.push({
      sourceClassId: cls.id,
      sourceName: cls.name,
      sourceGrade: Number(cls.grade),
      targetName: nextName,
      targetGrade: nextGrade,
      studentCount,
      homeroomTeacherId: cls.teacher_id,
      homeroomTeacherName: teacherName(teacherMap, cls.teacher_id),
      subjectAssignmentCount: subjectList.length,
    });
    for (const sub of subjectList) {
      subjectCopies.push({
        sourceClassName: cls.name,
        targetClassName: nextName,
        subjectName: sub.subject_name,
        teacherName: teacherName(teacherMap, sub.teacher_id) ?? sub.teacher_id,
      });
    }
    studentsPromoted += studentCount;
  }

  const gradeHeadPromote: PromotionPreviewGradeHeadChange[] = [];
  const gradeHeadRelease: PromotionPreviewGradeHeadRelease[] = [];
  const subjectGroupHeadCopy: PromotionPreviewSubjectGroupHead[] = [];

  for (const role of roles) {
    if (role.role_type === 'subject-group-head' && role.teacher_id) {
      subjectGroupHeadCopy.push({
        scopeLabel: role.scope_label ?? role.scope_key,
        teacherName: teacherName(teacherMap, role.teacher_id) ?? role.teacher_id,
      });
      continue;
    }
    if (role.role_type !== 'grade-head' || !role.teacher_id) continue;
    const label = role.scope_label ?? role.scope_key;
    if (graduatingCatalogIds.has(role.scope_key)) {
      gradeHeadRelease.push({
        scopeLabel: label,
        teacherName: teacherName(teacherMap, role.teacher_id) ?? role.teacher_id,
      });
      continue;
    }
    const level = getGradeLevelById(gradeConfig, role.scope_key);
    const nextCatalogId = getGradeIdByLevel(gradeConfig, level + 1);
    const nextItem = gradeConfig.items.find((it) => it.id === nextCatalogId);
    if (!nextItem) continue;
    gradeHeadPromote.push({
      fromScopeLabel: label,
      toScopeLabel: nextItem.label,
      teacherName: teacherName(teacherMap, role.teacher_id) ?? role.teacher_id,
    });
  }

  const warnings: string[] = [];
  if (existingTarget) warnings.push(`目标学年「${targetYearName}」已存在，无法重复升学年`);
  if (sourceClasses.length === 0) warnings.push('源学年暂无未归档班级');
  warnings.push('操作不可撤销；生产环境请先备份数据库');
  warnings.push('各学段起始年级班级不会自动创建，需在升学年后于「班级管理」手工新建');

  const unchanged = [
    '学业报告预设、等第线、教师画像采集配置（全校共用，不随学年复制）',
    '课程河流、学段结构、学科组定义、组织架构',
    '已填写的学业报告、课堂助手记录、教师已提交采集、学生画像扩展字段',
    '源学年中未毕业班级与岗位配置（保留为历史快照）',
  ];

  return {
    sourceYearId: sourceRow.id,
    sourceYearName: sourceRow.name,
    targetYearName,
    targetStartDate: targetStart,
    targetEndDate: targetEnd,
    canExecute: !existingTarget && !!sourceRow,
    blockReason: existingTarget ? 'TARGET_YEAR_EXISTS' : null,
    summary: {
      classesPromoted: promote.length,
      classesGraduated: graduate.length,
      studentsPromoted,
      studentsGraduated,
      subjectAssignmentsCopied: subjectCopies.length,
      subjectGroupMembersCopied: memberCount,
      willSetDefaultYear: true,
    },
    classes: { promote, graduate },
    staffing: { subjectCopies, graduateStaffingReleased },
    functionalRoles: {
      gradeHeadPromote,
      gradeHeadRelease,
      subjectGroupHeadCopy,
      subjectGroupMembersCopied: memberCount,
    },
    unchanged,
    warnings,
  };
}

async function releaseClassStaffing(
  client: PoolClient,
  academicYearId: string,
  classId: string,
): Promise<void> {
  await client.query(`UPDATE classes SET teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [classId]);
  await client.query(
    `UPDATE class_teacher_assignments
     SET unassigned_at = CURRENT_TIMESTAMP
     WHERE class_id = $1 AND unassigned_at IS NULL`,
    [classId],
  );
  await client.query(
    `DELETE FROM class_subject_teacher_assignments
     WHERE academic_year_id = $1 AND class_id = $2`,
    [academicYearId, classId],
  );
}

async function copyHomeroomToTarget(
  client: PoolClient,
  sourceClassId: string,
  targetClassId: string,
  teacherId: string | null,
): Promise<void> {
  if (!teacherId) return;
  await client.query(
    `UPDATE classes SET teacher_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [teacherId, targetClassId],
  );
  const existing = (await client.query(
    `SELECT id FROM class_teacher_assignments
     WHERE class_id = $1 AND teacher_id = $2 AND unassigned_at IS NULL LIMIT 1`,
    [targetClassId, teacherId],
  )).rows[0];
  if (!existing) {
    await client.query(
      `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role, assigned_at)
       VALUES ($1, $2, $3, 'homeroom', CURRENT_TIMESTAMP)`,
      [createId('cta'), targetClassId, teacherId],
    );
  }
}

async function copySubjectStaffingForClass(
  client: PoolClient,
  sourceYearId: string,
  targetYearId: string,
  sourceClassId: string,
  targetClassId: string,
): Promise<void> {
  const rows = (await client.query(
    `SELECT subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by
     FROM class_subject_teacher_assignments
     WHERE academic_year_id = $1 AND class_id = $2`,
    [sourceYearId, sourceClassId],
  )).rows as Array<{
    subject_key: string;
    subject_name: string;
    teacher_id: string;
    teacher_slot: number;
    created_by: string | null;
    updated_by: string | null;
  }>;
  for (const row of rows) {
    await client.query(
      `INSERT INTO class_subject_teacher_assignments
         (id, academic_year_id, class_id, subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (academic_year_id, class_id, subject_key, teacher_slot)
       DO UPDATE SET
         subject_name = EXCLUDED.subject_name,
         teacher_id = EXCLUDED.teacher_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [
        createId('csta'),
        targetYearId,
        targetClassId,
        row.subject_key,
        row.subject_name,
        row.teacher_id,
        Number(row.teacher_slot ?? 0) === 1 ? 1 : 0,
        row.created_by,
        row.updated_by,
      ],
    );
  }
}

async function copyFunctionalAndGroupMembers(
  client: PoolClient,
  sourceYearId: string,
  targetYearId: string,
  gradeConfig: GradeConfig,
  graduatingCatalogIds: Set<string>,
): Promise<void> {
  await ensureFunctionalRoleAssignmentsTable();
  const roles = (await client.query(
    `SELECT role_type, scope_key, scope_label, teacher_id, updated_by
     FROM functional_role_assignments
     WHERE academic_year_id = $1`,
    [sourceYearId],
  )).rows as Array<{
    role_type: string;
    scope_key: string;
    scope_label: string | null;
    teacher_id: string | null;
    updated_by: string | null;
  }>;

  for (const role of roles) {
    if (role.role_type === 'subject-group-head') {
      if (!role.teacher_id) continue;
      await client.query(
        `INSERT INTO functional_role_assignments
           (id, academic_year_id, role_type, scope_key, scope_label, teacher_id, updated_by)
         VALUES ($1, $2, 'subject-group-head', $3, $4, $5, $6)
         ON CONFLICT (academic_year_id, role_type, scope_key)
         DO UPDATE SET
           scope_label = EXCLUDED.scope_label,
           teacher_id = EXCLUDED.teacher_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [
          createId('fra'),
          targetYearId,
          role.scope_key,
          role.scope_label,
          role.teacher_id,
          role.updated_by,
        ],
      );
      continue;
    }
    if (role.role_type !== 'grade-head' || !role.teacher_id) continue;
    if (graduatingCatalogIds.has(role.scope_key)) continue;
    const level = getGradeLevelById(gradeConfig, role.scope_key);
    const nextCatalogId = getGradeIdByLevel(gradeConfig, level + 1);
    const nextItem = gradeConfig.items.find((it) => it.id === nextCatalogId);
    if (!nextItem) continue;
    const nextLabel = nextItem.label;
    await client.query(
      `INSERT INTO functional_role_assignments
         (id, academic_year_id, role_type, scope_key, scope_label, teacher_id, updated_by)
       VALUES ($1, $2, 'grade-head', $3, $4, $5, $6)
       ON CONFLICT (academic_year_id, role_type, scope_key)
       DO UPDATE SET
         scope_label = EXCLUDED.scope_label,
         teacher_id = EXCLUDED.teacher_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [createId('fra'), targetYearId, nextCatalogId, nextLabel, role.teacher_id, role.updated_by],
    );
  }

  const members = (await client.query(
    `SELECT group_id, teacher_id FROM teaching_subject_group_members WHERE academic_year_id = $1`,
    [sourceYearId],
  )).rows as Array<{ group_id: string; teacher_id: string }>;
  for (const m of members) {
    await client.query(
      `INSERT INTO teaching_subject_group_members (id, academic_year_id, group_id, teacher_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (academic_year_id, group_id, teacher_id) DO NOTHING`,
      [createId('tsgm'), targetYearId, m.group_id, m.teacher_id],
    );
  }
}

async function bulkInsertPromotionHistory(
  client: PoolClient,
  studentIds: string[],
  academicYearId: string,
  classId: string,
  grade: number,
): Promise<void> {
  if (!studentIds.length) return;
  const chunkSize = 200;
  for (let offset = 0; offset < studentIds.length; offset += chunkSize) {
    const chunk = studentIds.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((studentId, index) => {
      const base = index * 5;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, CURRENT_DATE, 'promotion')`,
      );
      values.push(createId('sah'), studentId, academicYearId, classId, grade);
    });
    await client.query(
      `INSERT INTO student_assignment_history (
         id, student_id, academic_year_id, class_id, grade, effective_from, source
       ) VALUES ${placeholders.join(', ')}`,
      values,
    );
  }
}

async function bulkUpsertTargetEnrollments(
  client: PoolClient,
  studentIds: string[],
  targetClassId: string,
  targetYearId: string,
): Promise<void> {
  if (!studentIds.length) return;
  const chunkSize = 200;
  for (let offset = 0; offset < studentIds.length; offset += chunkSize) {
    const chunk = studentIds.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((studentId, index) => {
      const base = index * 4;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      values.push(createId('enr'), studentId, targetClassId, targetYearId);
    });
    await client.query(
      `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (student_id, academic_year_id)
       DO UPDATE SET class_id = EXCLUDED.class_id`,
      values,
    );
  }
}

async function closeOpenAssignmentHistory(client: PoolClient, studentIds: string[]): Promise<void> {
  if (!studentIds.length) return;
  await client.query(
    `UPDATE student_assignment_history
     SET effective_to = CURRENT_DATE
     WHERE student_id = ANY($1::varchar[]) AND effective_to IS NULL`,
    [studentIds],
  );
}

async function graduateClassStudents(
  client: PoolClient,
  sourceYearId: string,
  classId: string,
  archiveLabel: string,
  classGrade: number,
): Promise<number> {
  const enrollments = (await client.query(
    `SELECT e.student_id
     FROM student_enrollments e
     JOIN students s ON s.id = e.student_id
     WHERE e.class_id = $1 AND e.academic_year_id = $2 AND s.status = 'active'`,
    [classId, sourceYearId],
  )).rows as Array<{ student_id: string }>;
  const studentIds = enrollments.map((enr) => enr.student_id);
  if (!studentIds.length) return 0;

  await closeOpenAssignmentHistory(client, studentIds);
  await bulkInsertPromotionHistory(client, studentIds, sourceYearId, classId, classGrade);
  await client.query(
    `UPDATE students
     SET status = 'graduated',
         division = $1,
         current_grade = $2,
         current_class_id = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ANY($4::varchar[])`,
    [archiveLabel, classGrade, classId, studentIds],
  );
  return studentIds.length;
}

async function promoteClassStudents(
  client: PoolClient,
  sourceYearId: string,
  targetYearId: string,
  sourceClassId: string,
  targetClassId: string,
  nextGrade: number,
): Promise<number> {
  const enrollments = (await client.query(
    `SELECT e.student_id
     FROM student_enrollments e
     JOIN students s ON s.id = e.student_id
     WHERE e.class_id = $1 AND e.academic_year_id = $2 AND s.status = 'active'`,
    [sourceClassId, sourceYearId],
  )).rows as Array<{ student_id: string }>;
  const studentIds = enrollments.map((enr) => enr.student_id);
  if (!studentIds.length) return 0;

  await bulkUpsertTargetEnrollments(client, studentIds, targetClassId, targetYearId);
  await closeOpenAssignmentHistory(client, studentIds);
  await bulkInsertPromotionHistory(client, studentIds, targetYearId, targetClassId, nextGrade);
  await client.query(
    `UPDATE students
     SET current_grade = $1, current_class_id = $2, status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE id = ANY($3::varchar[])`,
    [nextGrade, targetClassId, studentIds],
  );
  return studentIds.length;
}

export async function promoteAcademicYearToNext(
  client: PoolClient,
  sourceYearId: string,
  createdBy?: string | null,
): Promise<PromoteToNextYearResult> {
  const sourceRow = (await client.query(
    `SELECT id, name, start_date, end_date FROM academic_years WHERE id = $1 LIMIT 1`,
    [sourceYearId],
  )).rows[0] as
    | { id: string; name: string; start_date: Date | null; end_date: Date | null }
    | undefined;
  if (!sourceRow) {
    throw new Error('SOURCE_YEAR_NOT_FOUND');
  }

  const targetYearName = suggestNextAcademicYearName(sourceRow.name);
  const existingTarget = (await client.query(
    `SELECT id FROM academic_years WHERE name = $1 LIMIT 1`,
    [targetYearName],
  )).rows[0] as { id: string } | undefined;
  if (existingTarget) {
    throw new Error('TARGET_YEAR_EXISTS');
  }

  const targetYearId = createId('ay');
  const targetStart = bumpIsoDateByYears(sourceRow.start_date?.toISOString().slice(0, 10));
  const targetEnd = bumpIsoDateByYears(sourceRow.end_date?.toISOString().slice(0, 10));

  await client.query(
    `INSERT INTO academic_years (id, name, start_date, end_date, is_current)
     VALUES ($1, $2, $3, $4, FALSE)`,
    [targetYearId, targetYearName, targetStart ?? null, targetEnd ?? null],
  );

  const gradeConfig = (await loadSchoolGradeStructure(client)) as ApiGradeConfig & GradeConfig;
  const graduatingCatalogIds = new Set<string>();

  const sourceClasses = (await client.query(
    `SELECT id, grade, name, teacher_id FROM classes
     WHERE academic_year_id = $1 AND archived_at IS NULL
     ORDER BY grade ASC, name ASC`,
    [sourceYearId],
  )).rows as Array<{ id: string; grade: number; name: string; teacher_id: string | null }>;

  let classesPromoted = 0;
  let classesGraduated = 0;
  let studentsPromoted = 0;
  let studentsGraduated = 0;
  const snapshot: AcademicYearPromotionSnapshot = { graduatedClasses: [] };

  for (const cls of sourceClasses) {
    const grad = isGraduatingClass(gradeConfig, { grade: Number(cls.grade), name: cls.name });
    if (grad.graduating) {
      graduatingCatalogIds.add(grad.catalogId);
      const archiveLabel = graduateArchiveLabel(grad.segmentLabel, true);
      snapshot.graduatedClasses.push(
        await captureGraduatedClassSnapshot(
          client,
          sourceYearId,
          cls.id,
          Number(cls.grade),
          cls.teacher_id,
          archiveLabel,
          grad.catalogId,
        ),
      );
      await client.query(
        `UPDATE classes
         SET archived_at = CURRENT_TIMESTAMP, archive_label = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [archiveLabel, cls.id],
      );
      await releaseClassStaffing(client, sourceYearId, cls.id);
      await client.query(
        `DELETE FROM functional_role_assignments
         WHERE academic_year_id = $1 AND role_type = 'grade-head' AND scope_key = $2`,
        [sourceYearId, grad.catalogId],
      );
      studentsGraduated += await graduateClassStudents(
        client,
        sourceYearId,
        cls.id,
        archiveLabel,
        Number(cls.grade),
      );
      classesGraduated += 1;
      continue;
    }

    const nextGrade = Number(cls.grade) + 1;
    const nextName = bumpClassNameForPromotion(cls.name, Number(cls.grade), nextGrade, gradeConfig);
    const existing = (await client.query(
      `SELECT id FROM classes
       WHERE academic_year_id = $1 AND grade = $2 AND name = $3 AND archived_at IS NULL
       LIMIT 1`,
      [targetYearId, nextGrade, nextName],
    )).rows[0] as { id: string } | undefined;
    const targetClassId = existing?.id ?? createId('class');
    if (!existing) {
      await client.query(
        `INSERT INTO classes (id, academic_year_id, grade, name, teacher_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetClassId, targetYearId, nextGrade, nextName, cls.teacher_id],
      );
    }
    await copyHomeroomToTarget(client, cls.id, targetClassId, cls.teacher_id);
    await copySubjectStaffingForClass(client, sourceYearId, targetYearId, cls.id, targetClassId);
    studentsPromoted += await promoteClassStudents(
      client,
      sourceYearId,
      targetYearId,
      cls.id,
      targetClassId,
      nextGrade,
    );
    classesPromoted += 1;
  }

  await copyFunctionalAndGroupMembers(client, sourceYearId, targetYearId, gradeConfig, graduatingCatalogIds);
  const maxGradeLevel = Math.max(0, ...gradeConfig.items.map((it) => it.level));
  await copySelfStudyToAcademicYear(client, sourceYearId, targetYearId, maxGradeLevel, gradeConfig);
  await copyElectivesToAcademicYear(client, sourceYearId, targetYearId);

  await client.query(`UPDATE academic_years SET is_current = FALSE`);
  await client.query(`UPDATE academic_years SET is_current = TRUE WHERE id = $1`, [targetYearId]);

  await client.query(
    `INSERT INTO academic_year_promotion_log
       (id, source_year_id, target_year_id, created_by, snapshot)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [createId('aypl'), sourceYearId, targetYearId, createdBy ?? null, JSON.stringify(snapshot)],
  );

  return {
    success: true,
    sourceYearId,
    targetYearId,
    targetYearName,
    classesPromoted,
    classesGraduated,
    studentsPromoted,
    studentsGraduated,
    targetSetCurrent: true,
  };
}
