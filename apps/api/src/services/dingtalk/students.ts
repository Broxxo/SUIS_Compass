import { dingTalkTopApiPost, parseFeature } from './client.js';
import {
  buildClassGradeContextMap,
  enrichStudentNo,
  fetchEduUserDetail,
} from './studentEnrichment.js';
import type { DingTalkPreviewDepartment, DingTalkPreviewStudent } from './types.js';
import { resolveClassDepartments } from './orgUtils.js';

type EduUserRow = {
  userid?: string;
  name?: string;
  class_id?: number;
  classId?: number;
  unionid?: string;
  feature?: string;
  role?: string;
  student_no?: string;
};

type EduUserListResponse = {
  result?: {
    details?: EduUserRow[];
    has_more?: boolean;
  };
};

type IndustryUserRow = {
  userid?: string;
  name?: string;
  dept_id?: number;
  unionid?: string;
  feature?: string;
  roles?: Array<{ id?: number; name?: string }>;
};

type IndustryUserListResponse = {
  result?: {
    details?: IndustryUserRow[];
    has_more?: boolean;
    next_cursor?: number;
  };
};

function extractStudentNo(row: EduUserRow | IndustryUserRow): string | null {
  const direct = (row as EduUserRow).student_no;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const feature = parseFeature(row.feature);
  if (!feature) return null;
  for (const key of ['student_no', 'studentNo', 'student_num', '学号']) {
    const val = feature[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return null;
}

function resolveClassId(row: EduUserRow, fallbackClassId: number): number {
  return row.class_id ?? row.classId ?? fallbackClassId;
}

async function listEduStudents(classId: number): Promise<EduUserRow[]> {
  const all: EduUserRow[] = [];
  let pageNo = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await dingTalkTopApiPost<EduUserListResponse>(
      '/topapi/edu/user/list',
      { class_id: classId, role: 'student', page_no: pageNo, page_size: 30 },
    );
    const batch = data.result?.details ?? [];
    all.push(...batch);
    hasMore = Boolean(data.result?.has_more);
    pageNo += 1;
    if (pageNo > 500) break;
  }

  return all;
}

async function listIndustryStudents(deptId: number): Promise<IndustryUserRow[]> {
  const all: IndustryUserRow[] = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await dingTalkTopApiPost<IndustryUserListResponse>(
      '/topapi/industry/user/list',
      { dept_id: deptId, role: 'student', cursor, size: 1000 },
    );
    const batch = data.result?.details ?? [];
    all.push(...batch);
    hasMore = Boolean(data.result?.has_more);
    cursor = data.result?.next_cursor ?? 0;
    if (hasMore && cursor === 0) break;
  }

  if (all.length > 0) return all;

  cursor = 0;
  hasMore = true;
  const unfiltered: IndustryUserRow[] = [];
  while (hasMore) {
    const data = await dingTalkTopApiPost<IndustryUserListResponse>(
      '/topapi/industry/user/list',
      { dept_id: deptId, cursor, size: 1000 },
    );
    const batch = data.result?.details ?? [];
    unfiltered.push(...batch);
    hasMore = Boolean(data.result?.has_more);
    cursor = data.result?.next_cursor ?? 0;
    if (hasMore && cursor === 0) break;
  }

  return unfiltered.filter((row) => {
    const roleNames = (row.roles ?? []).map((r) => (r.name ?? '').toLowerCase());
    return roleNames.some((n) => n.includes('学生') || n.includes('student'));
  });
}

async function fetchStudentsForClass(
  cls: DingTalkPreviewDepartment,
  classNameById: Map<number, string>,
  fullPathById: Map<number, string>,
  gradeContextByClass: ReturnType<typeof buildClassGradeContextMap>,
  enrichDetails: boolean,
): Promise<DingTalkPreviewStudent[]> {
  const classId = cls.deptId;
  const className = classNameById.get(classId) ?? cls.name;
  const classPath = fullPathById.get(classId) ?? cls.fullPath ?? cls.parentPath;
  const gradeCtx = gradeContextByClass.get(classId);

  let rows: Array<EduUserRow | IndustryUserRow> = await listEduStudents(classId);
  let source = 'edu/user/list';

  if (rows.length === 0) {
    rows = await listIndustryStudents(classId);
    source = 'industry/user/list';
  }

  const students: DingTalkPreviewStudent[] = [];
  for (const row of rows) {
    if (!row.userid || !row.name) continue;
    const resolvedClassId = resolveClassId(row as EduUserRow, classId);
    let studentNo = extractStudentNo(row);
    let unionid = row.unionid?.trim() ? row.unionid : null;

    if (enrichDetails && source === 'edu/user/list') {
      const enrichedNo = await enrichStudentNo(resolvedClassId, row.userid, studentNo);
      studentNo = enrichedNo ?? studentNo;
      if (!unionid) {
        const detail = await fetchEduUserDetail(resolvedClassId, row.userid);
        unionid = detail.unionid ?? unionid;
      }
    }

    students.push({
      userid: row.userid,
      name: row.name,
      classId: resolvedClassId,
      className: classNameById.get(resolvedClassId) ?? className,
      classPath: fullPathById.get(resolvedClassId) ?? classPath ?? className,
      studentNo,
      gradeName: gradeCtx?.gradeName ?? null,
      gradeLevel: gradeCtx?.gradeLevel ?? null,
      startYear: gradeCtx?.startYear ?? null,
      unionid,
      gender: null,
      dateOfBirth: null,
      source,
    });
  }
  return students;
}

export async function fetchAllStudents(
  departments: DingTalkPreviewDepartment[],
  options?: { enrichDetails?: boolean; classDepts?: DingTalkPreviewDepartment[] },
): Promise<DingTalkPreviewStudent[]> {
  const enrichDetails = options?.enrichDetails === true;
  const classDepts = options?.classDepts ?? resolveClassDepartments(departments);
  const classNameById = new Map(departments.map((d) => [d.deptId, d.name]));
  const fullPathById = new Map(
    departments.map((d) => [d.deptId, d.fullPath ?? d.parentPath]),
  );
  const gradeContextByClass = buildClassGradeContextMap(departments);

  const byUserId = new Map<string, DingTalkPreviewStudent>();

  for (const cls of classDepts) {
    const batch = await fetchStudentsForClass(
      cls,
      classNameById,
      fullPathById,
      gradeContextByClass,
      enrichDetails,
    );
    for (const s of batch) {
      const key = `${s.userid}:${s.classId}`;
      if (!byUserId.has(key)) byUserId.set(key, s);
    }
  }

  return Array.from(byUserId.values()).sort((a, b) =>
    (a.classPath ?? '').localeCompare(b.classPath ?? '', 'zh-CN')
    || (a.studentNo ?? '').localeCompare(b.studentNo ?? '', 'zh-CN')
    || a.name.localeCompare(b.name, 'zh-CN'),
  );
}

export { resolveClassDepartments };
