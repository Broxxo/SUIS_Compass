import { STAFFING_HOMEROOM_SUBJECT_KEY, type TeachingSubjectGroup } from '@repo/shared';
import pool from '../config/database.js';
import { ensureStaffingTables } from './ensureStaffingTables.js';
import { listFunctionalRoleAssignments } from './functionalRoleAssignments.js';
import { loadSchoolTeachingSubjectGroups } from './schoolTeachingSubjectGroups.js';
import {
  loadSchoolGradeStructure,
  normalizeGradeConfig,
  type GradeConfig,
} from './schoolGradeStructure.js';
import {
  filterAssignmentsForGroup,
  filterClassesInGroupSegments,
  loadClassesForYear,
  loadDisplayKeyToStaffingSubjectKeys,
  loadReportTemplateSubjectKeys,
  reportSubjectKeysForGroup,
  resolveGroupStaffingSubjectKeys,
  type StaffingAssignmentRow,
} from './teachingSubjectGroupScope.js';
import { listTeachingSubjectGroupMembers } from './teachingSubjectGroupMembers.js';
import {
  ensureTeacherPortraitCollectionTables,
  parseTeachingDiagnosis,
  teachingDiagnosisHasContent,
  type TeachingDiagnosisPayload,
  type Term,
} from './teacherPortraitCollections.js';

export type { StaffingAssignmentRow };

export const ALL_SUBJECTS_PORTRAIT_GROUP_ID = '__all-subjects__';

export type SubjectGroupPortraitSummary = {
  id: string;
  nameZh: string;
  nameEn: string | null;
  memberCount: number;
  subjectLabels: string[];
  isHead: boolean;
};

export type SubjectGroupMemberClassScore = {
  classId: string;
  className: string;
  grade: number;
  subjectKey: string;
  subjectName: string;
  avgScore: number | null;
  studentCount: number;
};

export type SubjectGroupMemberDashboard = {
  teacherId: string;
  teacherName: string;
  assignments: Array<{
    classId: string;
    className: string;
    grade: number;
    subjectKey: string;
    subjectName: string;
  }>;
  classScores: SubjectGroupMemberClassScore[];
  diagnosis: TeachingDiagnosisPayload | null;
  diagnosisHasContent: boolean;
};

export type GradeAverageRow = {
  grade: number;
  gradeLabel: string;
  subjectKey: string;
  subjectName: string;
  avgScore: number | null;
  studentCount: number;
  classCount: number;
};

export type SubjectGroupDataSource = 'report' | 'diagnosis';

export type SubjectScoreLine = {
  subjectKey: string;
  subjectName: string;
  avgScore: number | null;
  studentCount: number;
  teacherId: string;
  teacherName: string;
  diagnosisHasContent: boolean;
};

export type GradeRowTeacherCell = {
  teacherId: string;
  teacherName: string;
  diagnosisHasContent: boolean;
  subjectLabels: string[];
};

export type GradeRowClassCell = {
  classId: string;
  className: string;
  subjectScores: SubjectScoreLine[];
};

export type SubjectGroupGradeRow = {
  grade: number;
  gradeLabel: string;
  subjectAverages: SubjectScoreLine[];
  diagnosisSubmittedCount: number;
  diagnosisTotalCount: number;
  classes: GradeRowClassCell[];
  teachers: GradeRowTeacherCell[];
};

type DashboardSubjectSlot = {
  displayKey: string;
  label: string;
  keys: Set<string>;
};

function buildDashboardSubjectOrder(
  group: TeachingSubjectGroup,
  displayKeyMap: Map<string, Set<string>>,
  reportSubjects: Array<{ subjectKey: string; subjectNameZh: string }>,
): DashboardSubjectSlot[] {
  return group.subjectKeys.map((displayKey) => {
    const staffingKeys = displayKeyMap.get(displayKey) ?? new Set([displayKey]);
    const keys = new Set<string>();
    for (const rs of reportSubjects) {
      const name = rs.subjectNameZh;
      if (
        name === displayKey ||
        name.includes(displayKey) ||
        displayKey.includes(name) ||
        staffingKeys.has(rs.subjectKey)
      ) {
        keys.add(rs.subjectKey);
      }
    }
    if (keys.size === 0) {
      staffingKeys.forEach((k) => keys.add(k));
    }
    let label = displayKey;
    const nameHit = reportSubjects.find((rs) => keys.has(rs.subjectKey));
    if (nameHit?.subjectNameZh) label = nameHit.subjectNameZh;
    return { displayKey, label, keys };
  });
}

function buildDashboardSubjectOrderFromReport(
  reportSubjects: Array<{ subjectKey: string; subjectNameZh: string }>,
): DashboardSubjectSlot[] {
  return reportSubjects.map((rs) => ({
    displayKey: rs.subjectNameZh,
    label: rs.subjectNameZh,
    keys: new Set([rs.subjectKey]),
  }));
}

async function resolveReportTemplateId(
  academicYearId: string,
  term: Term,
  reportTemplateId?: string | null,
): Promise<string | null> {
  const tid = reportTemplateId?.trim();
  if (tid) return tid;
  const templateRow = (
    await pool.query(
      `SELECT id FROM student_report_templates
       WHERE academic_year_id = $1 AND term = $2 AND status = 'published'
       ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [academicYearId, term],
    )
  ).rows[0] as { id: string } | undefined;
  return templateRow?.id ?? null;
}

async function loadReportSubjectsForDashboard(
  academicYearId: string,
  term: Term,
  reportTemplateId: string | null | undefined,
  classIds: string[],
): Promise<Array<{ subjectKey: string; subjectNameZh: string }>> {
  const templateId = await resolveReportTemplateId(academicYearId, term, reportTemplateId);
  if (!templateId) return [];

  const templateRows = (
    await pool.query(
      `SELECT subject_key, subject_name_zh, enable_score, sort_order
       FROM student_report_template_subjects
       WHERE template_id = $1
       ORDER BY sort_order ASC`,
      [templateId],
    )
  ).rows as Array<{
    subject_key: string;
    subject_name_zh: string | null;
    enable_score: boolean;
    sort_order: number;
  }>;

  let scoredRows: Array<{ subject_key: string; subject_name: string }> = [];
  if (classIds.length > 0) {
    const result = await pool.query(
      `SELECT DISTINCT str.subject_key, str.subject_name
       FROM student_term_subject_reports str
       JOIN student_term_reports r ON r.id = str.report_id
       JOIN students s ON s.id = r.student_id
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = r.academic_year_id
       JOIN classes c ON c.id = e.class_id AND c.academic_year_id = r.academic_year_id
       WHERE r.academic_year_id = $1
         AND r.term = $2
         AND r.template_id = $3
         AND str.final_score IS NOT NULL
         AND c.id = ANY($4::varchar[])
       ORDER BY str.subject_name ASC`,
      [academicYearId, term, templateId, classIds],
    );
    scoredRows = result.rows as Array<{ subject_key: string; subject_name: string }>;
  }

  const scoredKeySet = new Set(scoredRows.map((r) => r.subject_key));
  const includedKeys = new Set<string>();
  const ordered: Array<{ subjectKey: string; subjectNameZh: string }> = [];

  for (const t of templateRows) {
    const key = t.subject_key;
    if (!t.enable_score && !scoredKeySet.has(key)) continue;
    ordered.push({
      subjectKey: key,
      subjectNameZh: String(t.subject_name_zh ?? '').trim() || key,
    });
    includedKeys.add(key);
  }

  for (const s of scoredRows) {
    const key = s.subject_key;
    if (includedKeys.has(key)) continue;
    ordered.push({
      subjectKey: key,
      subjectNameZh: String(s.subject_name ?? '').trim() || key,
    });
    includedKeys.add(key);
  }

  return ordered;
}

async function loadReportTemplateSegmentId(templateId: string): Promise<string | null> {
  const row = (
    await pool.query(
      `SELECT COALESCE(school_segment_id, '') AS school_segment_id
       FROM student_report_templates WHERE id = $1 LIMIT 1`,
      [templateId],
    )
  ).rows[0] as { school_segment_id: string } | undefined;
  const segmentId = String(row?.school_segment_id ?? '').trim();
  return segmentId || null;
}

function buildDashboardSubjectOrderFromStaffing(
  group: TeachingSubjectGroup,
  displayKeyMap: Map<string, Set<string>>,
): DashboardSubjectSlot[] {
  return group.subjectKeys.map((displayKey) => {
    const keys = displayKeyMap.get(displayKey) ?? new Set([displayKey]);
    return { displayKey, label: displayKey, keys };
  });
}

function scoreMatchesSlot(
  subjectKey: string,
  subjectName: string,
  slot: DashboardSubjectSlot,
): boolean {
  return (
    slot.keys.has(subjectKey) ||
    subjectName === slot.label ||
    subjectName === slot.displayKey
  );
}

export type SubjectGroupPortraitDashboard = {
  group: {
    id: string;
    nameZh: string;
    nameEn: string | null;
    memberCount: number;
    subjectLabels: string[];
  };
  term: Term;
  dataSource: SubjectGroupDataSource;
  sourceId: string | null;
  sourceTitle: string | null;
  members: SubjectGroupMemberDashboard[];
  gradeAverages: GradeAverageRow[];
  gradeRows: SubjectGroupGradeRow[];
};

export async function listHeadedSubjectGroupIds(
  academicYearId: string,
  teacherId: string,
): Promise<Set<string>> {
  const roles = await listFunctionalRoleAssignments(academicYearId);
  const ids = new Set<string>();
  for (const r of roles) {
    if (r.roleType === 'subject-group-head' && r.teacherId === teacherId && r.scopeKey) {
      ids.add(r.scopeKey);
    }
  }
  return ids;
}

export async function canAccessSubjectGroupPortrait(
  groupId: string,
  academicYearId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (groupId === ALL_SUBJECTS_PORTRAIT_GROUP_ID) return isAdmin;
  if (isAdmin) return true;
  const headed = await listHeadedSubjectGroupIds(academicYearId, userId);
  return headed.has(groupId);
}

export async function listPortraitSubjectGroups(
  academicYearId: string,
  userId: string,
  isAdmin: boolean,
): Promise<SubjectGroupPortraitSummary[]> {
  const [groups, members, headedIds] = await Promise.all([
    loadSchoolTeachingSubjectGroups(),
    listTeachingSubjectGroupMembers(academicYearId),
    isAdmin ? Promise.resolve(null) : listHeadedSubjectGroupIds(academicYearId, userId),
  ]);

  const memberCountByGroup = new Map<string, number>();
  for (const m of members) {
    memberCountByGroup.set(m.groupId, (memberCountByGroup.get(m.groupId) ?? 0) + 1);
  }

  const visible = isAdmin
    ? groups
    : groups.filter((g) => headedIds?.has(g.id));

  const result = visible
    .map((g) => ({
      id: g.id,
      nameZh: g.nameZh,
      nameEn: g.nameEn ?? null,
      memberCount: memberCountByGroup.get(g.id) ?? 0,
      subjectLabels: [...g.subjectKeys],
      isHead: isAdmin || (headedIds?.has(g.id) ?? false),
    }))
    .sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh'));

  if (isAdmin) {
    result.unshift({
      id: ALL_SUBJECTS_PORTRAIT_GROUP_ID,
      nameZh: '全体学科',
      nameEn: 'All subjects',
      memberCount: 0,
      subjectLabels: [],
      isHead: false,
    });
  }

  return result;
}

async function loadStaffingAssignments(academicYearId: string): Promise<StaffingAssignmentRow[]> {
  await ensureStaffingTables();
  const rows = (
    await pool.query(
      `SELECT a.class_id, a.subject_key, a.subject_name, a.teacher_id,
              c.name AS class_name, c.grade AS class_grade,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username, u.id) AS teacher_name
       FROM class_subject_teacher_assignments a
       JOIN classes c ON c.id = a.class_id
       JOIN users u ON u.id = a.teacher_id
       WHERE a.academic_year_id = $1
       ORDER BY c.grade ASC, c.name ASC, a.subject_name ASC`,
      [academicYearId],
    )
  ).rows;
  return rows.map((r) => ({
    classId: r.class_id as string,
    className: r.class_name as string,
    classGrade: Number(r.class_grade ?? 0),
    subjectKey: r.subject_key as string,
    subjectName: r.subject_name as string,
    teacherId: r.teacher_id as string,
    teacherName: r.teacher_name as string,
  }));
}

function gradeLabelForLevel(gradeConfig: GradeConfig, grade: number): string {
  const hit = normalizeGradeConfig(gradeConfig).items.find((i) => i.level === grade);
  return hit?.label ?? `G${grade}`;
}

async function loadClassScoreAggregates(input: {
  academicYearId: string;
  term: Term;
  classIds: string[];
  subjectKeys: string[];
  reportTemplateId?: string | null;
}): Promise<
  Array<{
    classId: string;
    className: string;
    grade: number;
    subjectKey: string;
    subjectName: string;
    teacherId: string | null;
    avgScore: number | null;
    studentCount: number;
  }>
> {
  const { academicYearId, term, classIds, subjectKeys, reportTemplateId } = input;
  if (classIds.length === 0 || subjectKeys.length === 0) return [];

  let templateId = reportTemplateId?.trim() || '';
  if (!templateId) {
    const templateRow = (
      await pool.query(
        `SELECT id, title
         FROM student_report_templates
         WHERE academic_year_id = $1 AND term = $2 AND status = 'published'
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [academicYearId, term],
      )
    ).rows[0] as { id: string; title: string } | undefined;
    if (!templateRow) return [];
    templateId = templateRow.id;
  }

  const rows = (
    await pool.query(
      `SELECT c.id AS class_id, c.name AS class_name, c.grade,
              str.subject_key, str.subject_name,
              str.teacher_id,
              AVG(str.final_score::float) AS avg_score,
              COUNT(str.id)::int AS student_count
       FROM student_term_subject_reports str
       JOIN student_term_reports r ON r.id = str.report_id
       JOIN students s ON s.id = r.student_id
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = r.academic_year_id
       JOIN classes c ON c.id = e.class_id AND c.academic_year_id = r.academic_year_id
       WHERE r.academic_year_id = $1
         AND r.term = $2
         AND r.template_id = $3
         AND str.final_score IS NOT NULL
         AND c.id = ANY($4::varchar[])
         AND str.subject_key = ANY($5::varchar[])
       GROUP BY c.id, c.name, c.grade, str.subject_key, str.subject_name, str.teacher_id`,
      [academicYearId, term, templateId, classIds, subjectKeys],
    )
  ).rows;

  return rows.map((r) => ({
    classId: r.class_id as string,
    className: r.class_name as string,
    grade: Number(r.grade ?? 0),
    subjectKey: r.subject_key as string,
    subjectName: r.subject_name as string,
    teacherId: (r.teacher_id as string | null) ?? null,
    avgScore: r.avg_score == null ? null : Number(Number(r.avg_score).toFixed(2)),
    studentCount: Number(r.student_count ?? 0),
  }));
}

async function loadMemberDiagnoses(
  academicYearId: string,
  term: Term,
  teacherIds: string[],
  diagnosisTemplateId?: string | null,
): Promise<Map<string, { diagnosis: TeachingDiagnosisPayload; hasContent: boolean }>> {
  await ensureTeacherPortraitCollectionTables();
  const out = new Map<string, { diagnosis: TeachingDiagnosisPayload; hasContent: boolean }>();
  if (teacherIds.length === 0) return out;

  let templateId = diagnosisTemplateId?.trim() || '';
  if (!templateId) {
    const templateRow = (
      await pool.query(
        `SELECT id FROM teacher_portrait_collection_templates
         WHERE academic_year_id = $1 AND term = $2 AND status IN ('published', 'closed')
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [academicYearId, term],
      )
    ).rows[0] as { id: string } | undefined;
    if (!templateRow) return out;
    templateId = templateRow.id;
  }

  const subs = (
    await pool.query(
      `SELECT teacher_id, diagnosis
       FROM teacher_portrait_collection_submissions
       WHERE template_id = $1 AND teacher_id = ANY($2::varchar[])`,
      [templateId, teacherIds],
    )
  ).rows;

  for (const s of subs) {
    const diagnosis = parseTeachingDiagnosis(s.diagnosis);
    out.set(s.teacher_id as string, {
      diagnosis,
      hasContent: teachingDiagnosisHasContent(diagnosis),
    });
  }
  return out;
}

async function loadGradeScoreAverages(input: {
  academicYearId: string;
  term: Term;
  classIds: string[];
  subjectKeys: string[];
  gradeConfig: GradeConfig;
  reportTemplateId?: string | null;
}): Promise<GradeAverageRow[]> {
  const { academicYearId, term, classIds, subjectKeys, gradeConfig, reportTemplateId } = input;
  if (classIds.length === 0 || subjectKeys.length === 0) return [];

  let templateId = reportTemplateId?.trim() || '';
  if (!templateId) {
    const templateRow = (
      await pool.query(
        `SELECT id FROM student_report_templates
         WHERE academic_year_id = $1 AND term = $2 AND status = 'published'
         ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
        [academicYearId, term],
      )
    ).rows[0] as { id: string } | undefined;
    if (!templateRow) return [];
    templateId = templateRow.id;
  }

  const rows = (
    await pool.query(
      `SELECT c.grade,
              str.subject_key,
              str.subject_name,
              AVG(str.final_score::float) AS avg_score,
              COUNT(str.id)::int AS student_count,
              COUNT(DISTINCT c.id)::int AS class_count
       FROM student_term_subject_reports str
       JOIN student_term_reports r ON r.id = str.report_id
       JOIN students s ON s.id = r.student_id
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = r.academic_year_id
       JOIN classes c ON c.id = e.class_id AND c.academic_year_id = r.academic_year_id
       WHERE r.academic_year_id = $1
         AND r.term = $2
         AND r.template_id = $3
         AND str.final_score IS NOT NULL
         AND c.id = ANY($4::varchar[])
         AND str.subject_key = ANY($5::varchar[])
       GROUP BY c.grade, str.subject_key, str.subject_name
       ORDER BY c.grade ASC, str.subject_name ASC`,
      [academicYearId, term, templateId, classIds, subjectKeys],
    )
  ).rows;

  return rows.map((r) => {
    const grade = Number(r.grade ?? 0);
    return {
      grade,
      gradeLabel: gradeLabelForLevel(gradeConfig, grade),
      subjectKey: r.subject_key as string,
      subjectName: String(r.subject_name ?? '').trim() || (r.subject_key as string),
      avgScore: r.avg_score == null ? null : Number(Number(r.avg_score).toFixed(2)),
      studentCount: Number(r.student_count ?? 0),
      classCount: Number(r.class_count ?? 0),
    };
  });
}

export async function buildSubjectGroupPortraitDashboard(input: {
  groupId: string;
  academicYearId: string;
  term: Term;
  userId: string;
  isAdmin: boolean;
  dataSource?: SubjectGroupDataSource;
  sourceId?: string | null;
}): Promise<SubjectGroupPortraitDashboard | null> {
  const { groupId, academicYearId, term, userId, isAdmin, dataSource = 'report', sourceId } = input;
  const isAllSubjects = groupId === ALL_SUBJECTS_PORTRAIT_GROUP_ID;
  const allowed = await canAccessSubjectGroupPortrait(groupId, academicYearId, userId, isAdmin);
  if (!allowed) return null;

  const [groups, memberRows, gradeConfig, assignments, displayKeyMap, yearClasses] = await Promise.all([
    loadSchoolTeachingSubjectGroups(),
    listTeachingSubjectGroupMembers(academicYearId),
    loadSchoolGradeStructure(),
    loadStaffingAssignments(academicYearId),
    loadDisplayKeyToStaffingSubjectKeys(),
    loadClassesForYear(academicYearId),
  ]);

  const reportTemplateId = dataSource === 'report' ? sourceId : null;
  const diagnosisTemplateId = dataSource === 'diagnosis' ? sourceId : null;

  let group: TeachingSubjectGroup | undefined;
  let memberIds: string[] = [];
  let memberNameById = new Map<string, string>();
  let scopedAssignments: StaffingAssignmentRow[] = [];
  let classIds: string[] = [];
  let scoreSubjectKeys: string[] = [];
  let reportSubjects: Array<{ subjectKey: string; subjectNameZh: string }> = [];
  let subjectOrder: DashboardSubjectSlot[] = [];

  if (isAllSubjects) {
    classIds = yearClasses.map((c) => c.id);
    if (dataSource === 'report') {
      const templateId = await resolveReportTemplateId(academicYearId, term, reportTemplateId);
      if (templateId) {
        const segmentId = await loadReportTemplateSegmentId(templateId);
        if (segmentId) {
          classIds = filterClassesInGroupSegments(yearClasses, [segmentId], gradeConfig).map((c) => c.id);
        }
      }
    }
    reportSubjects =
      dataSource === 'report'
        ? await loadReportSubjectsForDashboard(academicYearId, term, reportTemplateId, classIds)
        : await loadReportSubjectsForDashboard(academicYearId, term, null, classIds);
    scoreSubjectKeys = reportSubjects.map((rs) => rs.subjectKey);
    subjectOrder =
      reportSubjects.length > 0
        ? buildDashboardSubjectOrderFromReport(reportSubjects)
        : [];
    scopedAssignments = assignments.filter((a) => {
      if (a.subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY) return false;
      return classIds.includes(a.classId);
    });
    memberIds = [...new Set(scopedAssignments.map((a) => a.teacherId))];
    memberNameById = new Map(
      scopedAssignments.map((a) => [a.teacherId, a.teacherName] as const),
    );
  } else {
    group = groups.find((g) => g.id === groupId);
    if (!group) return null;

    memberIds = memberRows.filter((m) => m.groupId === groupId).map((m) => m.teacherId);
    memberNameById = new Map(
      memberRows
        .filter((m) => m.groupId === groupId)
        .map((m) => [m.teacherId, m.teacherName ?? m.teacherId]),
    );

    const allowedStaffingKeys = resolveGroupStaffingSubjectKeys(group.subjectKeys, displayKeyMap);

    scopedAssignments = filterAssignmentsForGroup({
      assignments,
      memberIds,
      segmentIds: group.segmentIds,
      groupSubjectKeys: group.subjectKeys,
      gradeConfig,
      allowedStaffingKeys,
    });

    const segmentClasses = filterClassesInGroupSegments(yearClasses, group.segmentIds, gradeConfig);
    classIds = [...new Set([
      ...scopedAssignments.map((a) => a.classId),
      ...segmentClasses.map((c) => c.id),
    ])];

    scoreSubjectKeys = [...allowedStaffingKeys];
    if (dataSource === 'report') {
      reportSubjects = await loadReportSubjectsForDashboard(
        academicYearId,
        term,
        reportTemplateId,
        classIds,
      );
      if (reportSubjects.length > 0) {
        scoreSubjectKeys = [...reportSubjectKeysForGroup(group.subjectKeys, reportSubjects, allowedStaffingKeys)];
        if (scoreSubjectKeys.length === 0) {
          scoreSubjectKeys = reportSubjects.map((rs) => rs.subjectKey);
        }
        subjectOrder = buildDashboardSubjectOrder(group, displayKeyMap, reportSubjects);
      }
    }

    if (subjectOrder.length === 0) {
      subjectOrder = buildDashboardSubjectOrderFromStaffing(group, displayKeyMap);
    }
  }

  const assignmentByClassSubject = new Map<string, StaffingAssignmentRow>();
  for (const a of assignments) {
    if (a.subjectKey === STAFFING_HOMEROOM_SUBJECT_KEY) continue;
    assignmentByClassSubject.set(`${a.classId}::${a.subjectKey}`, a);
  }

  const [scoreRows, diagnosisByTeacher, gradeAverages] = await Promise.all([
    dataSource === 'report'
      ? loadClassScoreAggregates({
          academicYearId,
          term,
          classIds,
          subjectKeys: scoreSubjectKeys,
          reportTemplateId,
        })
      : Promise.resolve([]),
    loadMemberDiagnoses(academicYearId, term, memberIds, diagnosisTemplateId),
    dataSource === 'report'
      ? loadGradeScoreAverages({
          academicYearId,
          term,
          classIds,
          subjectKeys: scoreSubjectKeys,
          gradeConfig,
          reportTemplateId,
        })
      : Promise.resolve([]),
  ]);

  let sourceTitle: string | null = null;
  if (dataSource === 'report') {
    const tid = reportTemplateId?.trim();
    if (tid) {
      const row = (
        await pool.query(`SELECT title FROM student_report_templates WHERE id = $1 LIMIT 1`, [tid])
      ).rows[0] as { title: string } | undefined;
      sourceTitle = row?.title ?? null;
    } else {
      const row = (
        await pool.query(
          `SELECT title FROM student_report_templates
           WHERE academic_year_id = $1 AND term = $2 AND status = 'published'
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [academicYearId, term],
        )
      ).rows[0] as { title: string } | undefined;
      sourceTitle = row?.title ?? null;
    }
  } else {
    const tid = diagnosisTemplateId?.trim();
    if (tid) {
      const row = (
        await pool.query(`SELECT title FROM teacher_portrait_collection_templates WHERE id = $1 LIMIT 1`, [tid])
      ).rows[0] as { title: string } | undefined;
      sourceTitle = row?.title ?? null;
    } else {
      const row = (
        await pool.query(
          `SELECT title FROM teacher_portrait_collection_templates
           WHERE academic_year_id = $1 AND term = $2 AND status IN ('published', 'closed')
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [academicYearId, term],
        )
      ).rows[0] as { title: string } | undefined;
      sourceTitle = row?.title ?? null;
    }
  }

  const members: SubjectGroupMemberDashboard[] = memberIds
    .map((teacherId) => {
    const teacherAssignments = scopedAssignments.filter((a) => a.teacherId === teacherId);
    const assignmentMap = new Map<string, SubjectGroupMemberDashboard['assignments'][number]>();
    for (const a of teacherAssignments) {
      const key = `${a.classId}::${a.subjectKey}`;
      if (!assignmentMap.has(key)) {
        assignmentMap.set(key, {
          classId: a.classId,
          className: a.className,
          grade: a.classGrade,
          subjectKey: a.subjectKey,
          subjectName: a.subjectName,
        });
      }
    }
    const teacherScores = scoreRows
      .filter((s) => s.teacherId === teacherId || teacherAssignments.some(
        (a) => a.classId === s.classId && a.subjectKey === s.subjectKey,
      ))
      .map((s) => ({
        classId: s.classId,
        className: s.className,
        grade: s.grade,
        subjectKey: s.subjectKey,
        subjectName: s.subjectName,
        avgScore: s.avgScore,
        studentCount: s.studentCount,
      }));

    const diag = diagnosisByTeacher.get(teacherId);
    return {
      teacherId,
      teacherName: memberNameById.get(teacherId) ?? teacherId,
      assignments: Array.from(assignmentMap.values()).sort(
        (a, b) => a.grade - b.grade || a.className.localeCompare(b.className),
      ),
      classScores: teacherScores,
      diagnosis: diag?.hasContent ? diag.diagnosis : null,
      diagnosisHasContent: diag?.hasContent ?? false,
    };
    })
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'zh'));

  const gradeAvgByGradeSubject = new Map(
    gradeAverages.map((g) => [`${g.grade}::${g.subjectKey}`, g]),
  );

  type ClassScoreBucket = Map<
    string,
    {
      className: string;
      scores: Map<string, (typeof scoreRows)[number]>;
    }
  >;
  const scoresByGrade = new Map<number, ClassScoreBucket>();

  if (dataSource === 'report') {
    for (const score of scoreRows) {
      if (score.avgScore == null || score.studentCount <= 0) continue;
      let gradeBucket = scoresByGrade.get(score.grade);
      if (!gradeBucket) {
        gradeBucket = new Map();
        scoresByGrade.set(score.grade, gradeBucket);
      }
      let classBucket = gradeBucket.get(score.classId);
      if (!classBucket) {
        classBucket = { className: score.className, scores: new Map() };
        gradeBucket.set(score.classId, classBucket);
      }
      if (!classBucket.scores.has(score.subjectKey)) {
        classBucket.scores.set(score.subjectKey, score);
      }
    }
  }

  const buildSubjectLineFromScore = (
    slot: DashboardSubjectSlot,
    score: (typeof scoreRows)[number],
  ): SubjectScoreLine => {
    const cellKey = `${score.classId}::${score.subjectKey}`;
    const staffing = assignmentByClassSubject.get(cellKey);
    const teacherId = score.teacherId ?? staffing?.teacherId ?? '';
    const diag = teacherId ? diagnosisByTeacher.get(teacherId) : undefined;
    return {
      subjectKey: score.subjectKey,
      subjectName: slot.label,
      avgScore: score.avgScore,
      studentCount: score.studentCount,
      teacherId,
      teacherName: staffing?.teacherName ?? (teacherId || '—'),
      diagnosisHasContent: diag?.hasContent ?? false,
    };
  };

  const findScoreForSlot = (
    scores: Map<string, (typeof scoreRows)[number]>,
    slot: DashboardSubjectSlot,
  ) => {
    for (const score of scores.values()) {
      if (scoreMatchesSlot(score.subjectKey, score.subjectName, slot)) return score;
    }
    return undefined;
  };

  const gradeRows: SubjectGroupGradeRow[] =
    dataSource === 'report'
      ? [...scoresByGrade.keys()]
          .sort((a, b) => a - b)
          .map((grade) => {
      const subjectAverages: SubjectScoreLine[] = [];
      for (const slot of subjectOrder) {
        const gradeAvg = [...gradeAvgByGradeSubject.entries()]
          .filter(([key]) => Number(key.slice(0, key.indexOf('::'))) === grade)
          .map(([, value]) => value)
          .find(
            (g) =>
              slot.keys.has(g.subjectKey) ||
              g.subjectName === slot.label ||
              g.subjectName === slot.displayKey,
          );
        if (
          dataSource === 'report' &&
          gradeAvg &&
          gradeAvg.avgScore != null &&
          gradeAvg.studentCount > 0
        ) {
          subjectAverages.push({
            subjectKey: gradeAvg.subjectKey,
            subjectName: slot.label,
            avgScore: gradeAvg.avgScore,
            studentCount: gradeAvg.studentCount,
            teacherId: '',
            teacherName: '',
            diagnosisHasContent: false,
          });
        }
      }

      const classes: GradeRowClassCell[] = [];
      const teacherIdsInRow = new Set<string>();

      const gradeBucket = scoresByGrade.get(grade);
      if (gradeBucket) {
        const classIds = [...gradeBucket.keys()].sort((a, b) =>
          (gradeBucket.get(a)?.className ?? '').localeCompare(gradeBucket.get(b)?.className ?? '', 'zh'),
        );
        for (const classId of classIds) {
          const classBucket = gradeBucket.get(classId)!;
          const subjectScores: SubjectScoreLine[] = [];
          for (const slot of subjectOrder) {
            const score = findScoreForSlot(classBucket.scores, slot);
            if (score) {
              const line = buildSubjectLineFromScore(slot, score);
              subjectScores.push(line);
              if (line.teacherId) teacherIdsInRow.add(line.teacherId);
            }
          }
          if (subjectScores.length > 0) {
            classes.push({
              classId,
              className: classBucket.className,
              subjectScores,
            });
          }
        }
      }

      if (subjectAverages.length === 0 && classes.length === 0) return null;

      const diagnosisSubmittedCount = [...teacherIdsInRow].filter(
        (tid) => diagnosisByTeacher.get(tid)?.hasContent,
      ).length;

      return {
        grade,
        gradeLabel: gradeLabelForLevel(gradeConfig, grade),
        subjectAverages,
        diagnosisSubmittedCount,
        diagnosisTotalCount: teacherIdsInRow.size,
        classes,
        teachers: [] as GradeRowTeacherCell[],
      };
    })
          .filter((row): row is SubjectGroupGradeRow => row != null)
      : [];

  return {
    group: isAllSubjects
      ? {
          id: ALL_SUBJECTS_PORTRAIT_GROUP_ID,
          nameZh: '全体学科',
          nameEn: 'All subjects',
          memberCount: memberIds.length,
          subjectLabels: reportSubjects.map((rs) => rs.subjectNameZh),
        }
      : {
          id: group!.id,
          nameZh: group!.nameZh,
          nameEn: group!.nameEn ?? null,
          memberCount: memberIds.length,
          subjectLabels: [...group!.subjectKeys],
        },
    term,
    dataSource,
    sourceId: sourceId?.trim() || null,
    sourceTitle,
    members,
    gradeAverages,
    gradeRows,
  };
}

export function findTeachingSubjectGroup(
  groups: TeachingSubjectGroup[],
  groupId: string,
): TeachingSubjectGroup | undefined {
  return groups.find((g) => g.id === groupId);
}
