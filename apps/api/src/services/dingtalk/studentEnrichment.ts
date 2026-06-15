import { dingTalkTopApiPost, parseFeature } from './client.js';
import { parseGradeFromText } from './classNameMapping.js';
import { getDingTalkConfig } from './config.js';
import type { DingTalkPreviewDepartment } from './types.js';
import { normalizeDeptType } from './orgUtils.js';

export type ClassGradeContext = {
  gradeName: string | null;
  gradeLevel: number | null;
  startYear: string | null;
};

function parseFeatureNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFeatureString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

/** 从组织树向上找到所属年级，解析 grade_level / start_year */
export function buildClassGradeContextMap(
  departments: DingTalkPreviewDepartment[],
): Map<number, ClassGradeContext> {
  const deptById = new Map(departments.map((d) => [d.deptId, d]));
  const result = new Map<number, ClassGradeContext>();

  for (const dept of departments) {
    if (normalizeDeptType(dept.deptType) !== 'class') continue;

    let cursor = dept.parentDeptId != null ? deptById.get(dept.parentDeptId) : undefined;
    while (cursor) {
      if (normalizeDeptType(cursor.deptType) === 'grade') {
        const f = cursor.feature;
        const gradeFromName = parseGradeFromText(cursor.name);
        const featureLevel = parseFeatureNumber(f?.grade_level);
        result.set(dept.deptId, {
          gradeName: cursor.name,
          gradeLevel: gradeFromName ?? featureLevel,
          startYear: parseFeatureString(f?.start_year),
        });
        break;
      }
      cursor = cursor.parentDeptId != null ? deptById.get(cursor.parentDeptId) : undefined;
    }

    if (!result.has(dept.deptId)) {
      const classFeature = dept.feature;
      result.set(dept.deptId, {
        gradeName: null,
        gradeLevel: parseFeatureNumber(classFeature?.grade_level),
        startYear: parseFeatureString(classFeature?.start_year),
      });
    }
  }

  return result;
}

type EduUserGetResponse = {
  result?: {
    details?: Array<{
      student_no?: string;
      feature?: string;
      name?: string;
      unionid?: string;
    }>;
  };
};

type StudentInfoGetResponse = {
  result?: {
    student_num?: string;
    name?: string;
    guardians?: Array<{ name?: string; relation_name?: string }>;
  };
};

export async function fetchEduUserDetail(
  classId: number,
  userid: string,
): Promise<{ studentNo: string | null; unionid: string | null }> {
  try {
    const data = await dingTalkTopApiPost<EduUserGetResponse>(
      '/topapi/edu/user/get',
      { class_id: classId, role: 'student', userid },
    );
    const detail = data.result?.details?.[0];
    if (!detail) return { studentNo: null, unionid: null };

    let studentNo: string | null = null;
    if (detail.student_no != null && String(detail.student_no).trim()) {
      studentNo = String(detail.student_no).trim();
    } else {
      const f = parseFeature(detail.feature);
      studentNo = parseFeatureString(f?.student_no ?? f?.studentNo);
    }

    return {
      studentNo,
      unionid: detail.unionid?.trim() ? detail.unionid : null,
    };
  } catch {
    return { studentNo: null, unionid: null };
  }
}

export async function fetchStudentInfoDetail(
  classId: number,
  userid: string,
): Promise<{ studentNo: string | null }> {
  const { agentId } = getDingTalkConfig();
  const appId = agentId ? Number(agentId) : NaN;
  if (!Number.isFinite(appId)) return { studentNo: null };

  try {
    const data = await dingTalkTopApiPost<StudentInfoGetResponse>(
      '/topapi/edu/class/studentinfo/get',
      { class_id: classId, app_id: appId, userid },
    );
    const num = data.result?.student_num;
    return {
      studentNo: num != null && String(num).trim() ? String(num).trim() : null,
    };
  } catch {
    return { studentNo: null };
  }
}

export async function enrichStudentNo(
  classId: number,
  userid: string,
  existing: string | null,
): Promise<string | null> {
  if (existing) return existing;

  const fromGet = await fetchEduUserDetail(classId, userid);
  if (fromGet.studentNo) return fromGet.studentNo;

  const fromInfo = await fetchStudentInfoDetail(classId, userid);
  return fromInfo.studentNo;
}
