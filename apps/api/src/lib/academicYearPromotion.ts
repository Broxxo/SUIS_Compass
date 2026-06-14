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
import { setCanonicalConfigAcademicYearId } from './canonicalAcademicConfig.js';
import { ensureClassArchiveColumns } from './classArchiveColumns.js';
import { ensureClassTeacherAssignmentsTable } from './ensureClassTeacherAssignmentsTable.js';
import { ensureFunctionalRoleAssignmentsTable } from './functionalRoleAssignments.js';
import { ensureStaffingTables } from './ensureStaffingTables.js';
import { loadSchoolGradeStructure, type GradeConfig as ApiGradeConfig } from './schoolGradeStructure.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

  for (const enr of enrollments) {
    await client.query(
      `UPDATE student_assignment_history
       SET effective_to = CURRENT_DATE
       WHERE student_id = $1 AND effective_to IS NULL`,
      [enr.student_id],
    );
    await client.query(
      `INSERT INTO student_assignment_history (
         id, student_id, academic_year_id, class_id, grade, effective_from, source
       ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'promotion')`,
      [createId('sah'), enr.student_id, sourceYearId, classId, classGrade],
    );
    await client.query(
      `UPDATE students
       SET status = 'graduated',
           division = $1,
           current_grade = $2,
           current_class_id = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [archiveLabel, classGrade, classId, enr.student_id],
    );
  }
  return enrollments.length;
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

  for (const enr of enrollments) {
    await client.query(
      `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, academic_year_id)
       DO UPDATE SET class_id = EXCLUDED.class_id`,
      [createId('enr'), enr.student_id, targetClassId, targetYearId],
    );
    await client.query(
      `UPDATE student_assignment_history
       SET effective_to = CURRENT_DATE
       WHERE student_id = $1 AND effective_to IS NULL`,
      [enr.student_id],
    );
    await client.query(
      `INSERT INTO student_assignment_history (
         id, student_id, academic_year_id, class_id, grade, effective_from, source
       ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'promotion')`,
      [createId('sah'), enr.student_id, targetYearId, targetClassId, nextGrade],
    );
    await client.query(
      `UPDATE students
       SET current_grade = $1, current_class_id = $2, status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [nextGrade, targetClassId, enr.student_id],
    );
  }
  return enrollments.length;
}

export async function promoteAcademicYearToNext(
  client: PoolClient,
  sourceYearId: string,
): Promise<PromoteToNextYearResult> {
  await ensureClassTeacherAssignmentsTable(pool);
  await ensureStaffingTables();
  await ensureClassArchiveColumns(pool);

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

  await setCanonicalConfigAcademicYearId(sourceYearId, client);

  const gradeConfig = (await loadSchoolGradeStructure()) as ApiGradeConfig & GradeConfig;
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

  for (const cls of sourceClasses) {
    const grad = isGraduatingClass(gradeConfig, { grade: Number(cls.grade), name: cls.name });
    if (grad.graduating) {
      graduatingCatalogIds.add(grad.catalogId);
      const archiveLabel = graduateArchiveLabel(grad.segmentLabel, true);
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

  await client.query(`UPDATE academic_years SET is_current = FALSE`);
  await client.query(`UPDATE academic_years SET is_current = TRUE WHERE id = $1`, [targetYearId]);

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
