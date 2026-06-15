import { dingTalkTopApiPost, parseFeature } from './client.js';
import { walkEduDepartmentTree } from './eduDept.js';
import { filterDepartmentsByCampus, shouldSkipDepartmentSubtree } from './orgFilter.js';
import { fetchAllStudents, resolveClassDepartments } from './students.js';
import { getDingTalkConfig, getDingTalkCampusFilterConfig, isDingTalkConfigured } from './config.js';
import {
  DINGTALK_STUDENT_FIELD_AVAILABILITY,
  type DingTalkFieldGuideItem,
  type DingTalkIndustryDept,
  type DingTalkPreviewDepartment,
  type DingTalkPreviewResult,
} from './types.js';

const FIELD_GUIDE: DingTalkFieldGuideItem[] = [
  {
    field: 'dept_id',
    source: 'edu/dept/list · industry/department/list',
    descriptionZh: '部门/班级 ID；dept_type=class 时即 class_id',
    descriptionEn: 'Dept/class ID; class_id when dept_type=class',
    mapsToLocal: 'student_enrollments.class_id（经 classNameMapping 映射）',
  },
  {
    field: 'name',
    source: 'edu/dept/list',
    descriptionZh: '部门名称（校区 / 学段 / 年级 / 班级名）',
    descriptionEn: 'Department name (campus / period / grade / class)',
    mapsToLocal: 'classes.name',
  },
  {
    field: 'dept_type',
    source: 'edu/dept/list',
    descriptionZh: '组织层级：campus 校区、period 学段、grade 年级、class 班级',
    descriptionEn: 'Org level: campus, period, grade, class',
  },
  {
    field: 'super_id',
    source: 'edu/dept/list',
    descriptionZh: '父部门 ID，用于构建组织树',
    descriptionEn: 'Parent department ID for org tree',
  },
  {
    field: 'feature.grade_level',
    source: 'dept · feature',
    descriptionZh: '年级级数（如一年级为 1）',
    descriptionEn: 'Grade level number',
    mapsToLocal: 'students.current_grade',
  },
  {
    field: 'userid',
    source: 'edu/user/list',
    descriptionZh: '钉钉用户 ID，建议作学生外部主键',
    descriptionEn: 'DingTalk user ID',
    mapsToLocal: 'students.id（或 dingtalk_user_id）',
  },
  {
    field: 'student_no',
    source: 'edu/user/list',
    descriptionZh: '学号（响应体字段或 feature 内）',
    descriptionEn: 'Student number (top-level or in feature)',
    mapsToLocal: 'students.student_number',
  },
  {
    field: 'class_id',
    source: 'edu/user/list',
    descriptionZh: '所属班级 ID',
    descriptionEn: 'Class ID',
    mapsToLocal: 'student_enrollments.class_id',
  },
  {
    field: 'unionid',
    source: 'edu/user/list',
    descriptionZh: '开放平台唯一标识',
    descriptionEn: 'Open platform union ID',
  },
];

type DeptListResponse = {
  result?: {
    details?: DingTalkIndustryDept[];
    has_more?: boolean;
    next_cursor?: number;
  };
};

async function listIndustryDepartments(deptId: number): Promise<DingTalkIndustryDept[]> {
  const all: DingTalkIndustryDept[] = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await dingTalkTopApiPost<DeptListResponse>(
      '/topapi/industry/department/list',
      { dept_id: deptId, cursor, size: 1000 },
    );
    const batch = data.result?.details ?? [];
    all.push(...batch);
    hasMore = Boolean(data.result?.has_more);
    cursor = data.result?.next_cursor ?? 0;
    if (hasMore && cursor === 0) break;
  }

  return all;
}

async function walkIndustryDepartmentTree(): Promise<DingTalkPreviewDepartment[]> {
  const flat: DingTalkPreviewDepartment[] = [];
  const queue: Array<{ parentId: number; parentPath: string; parentDeptId: number | null }> = [
    { parentId: 1, parentPath: '', parentDeptId: null },
  ];

  while (queue.length > 0) {
    const { parentId, parentPath, parentDeptId } = queue.shift()!;
    const children = await listIndustryDepartments(parentId);
    for (const child of children) {
      const path = parentPath ? `${parentPath} / ${child.name}` : child.name;
      if (shouldSkipDepartmentSubtree(child.name, parentPath)) continue;
      flat.push({
        deptId: child.dept_id,
        name: child.name,
        deptType: child.dept_type ?? 'unknown',
        parentDeptId: parentId === 1 ? 1 : parentDeptId ?? parentId,
        parentPath: parentPath || '—',
        fullPath: path,
        feature: parseFeature(child.feature),
        source: 'industry',
      });
      queue.push({ parentId: child.dept_id, parentPath: path, parentDeptId: child.dept_id });
    }
  }

  return flat;
}

async function loadDepartments(): Promise<DingTalkPreviewDepartment[]> {
  let departments = await walkEduDepartmentTree();
  if (departments.length === 0) {
    departments = await walkIndustryDepartmentTree();
  }
  return filterDepartmentsByCampus(departments);
}

let lastPreviewResult: DingTalkPreviewResult | null = null;
let previewInFlight: Promise<DingTalkPreviewResult> | null = null;

/** 只读内存缓存，不触发钉钉 API，也不等待进行中的刷新。 */
export function getCachedDingTalkPreview(): DingTalkPreviewResult | null {
  return lastPreviewResult;
}

/** 用前端 localStorage 快照或刷新结果填充服务端缓存（供同步比对/应用）。 */
export function seedDingTalkPreviewCache(preview: DingTalkPreviewResult): void {
  if (preview.fetchedAt && preview.students.length > 0) {
    lastPreviewResult = preview;
  }
}

function emptyPreviewNoCache(): DingTalkPreviewResult {
  const config = getDingTalkConfig();
  return {
    configured: isDingTalkConfigured(config),
    fetchedAt: null,
    error: '暂无钉钉学生缓存。请先在「钉钉 API」点击「刷新」拉取最新数据。',
    config: {
      appId: config.appId,
      agentId: config.agentId,
      clientId: config.clientId,
    },
    summary: {
      departmentCount: 0,
      byType: {},
      classCount: 0,
      studentCount: 0,
    },
    fieldGuide: FIELD_GUIDE,
    fieldAvailability: DINGTALK_STUDENT_FIELD_AVAILABILITY,
    departments: [],
    students: [],
  };
}

async function buildDingTalkPreview(): Promise<DingTalkPreviewResult> {
  const config = getDingTalkConfig();
  const base: DingTalkPreviewResult = {
    configured: isDingTalkConfigured(config),
    fetchedAt: null,
    error: null,
    config: {
      appId: config.appId,
      agentId: config.agentId,
      clientId: config.clientId,
    },
    summary: {
      departmentCount: 0,
      byType: {},
      classCount: 0,
      studentCount: 0,
    },
    fieldGuide: FIELD_GUIDE,
    fieldAvailability: DINGTALK_STUDENT_FIELD_AVAILABILITY,
    departments: [],
    students: [],
  };

  if (!base.configured) {
    base.error = '未配置 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET（见 apps/api/.env）';
    return base;
  }

  try {
    const departments = await loadDepartments();
    const byType: Record<string, number> = {};
    for (const d of departments) {
      const key = d.deptType || 'unknown';
      byType[key] = (byType[key] ?? 0) + 1;
    }

    const classDepts = resolveClassDepartments(departments);
    // 预览刷新：仅 edu/user/list 名单，不逐人调详情补学号（学号规范/生成在「确认同步」时进行）
    const students = await fetchAllStudents(departments, { enrichDetails: false, classDepts });
    const uniqueStudentCount = new Set(students.map((s) => s.userid)).size;

    base.fetchedAt = new Date().toISOString();
    base.departments = departments;
    base.students = students;
    base.campusFilter = getDingTalkCampusFilterConfig();
    base.summary = {
      departmentCount: departments.length,
      byType,
      classCount: classDepts.length,
      studentCount: students.length,
      uniqueStudentCount,
    };
    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message : 'Failed to fetch DingTalk preview';
    return base;
  }
}

export async function fetchDingTalkPreview(options?: { force?: boolean }): Promise<DingTalkPreviewResult> {
  const force = options?.force === true;

  // 非强制：仅返回已有缓存，绝不触发拉取或等待进行中的刷新（同步比对依赖此行为）
  if (!force) {
    return lastPreviewResult ?? emptyPreviewNoCache();
  }

  if (previewInFlight) {
    return previewInFlight;
  }

  previewInFlight = buildDingTalkPreview()
    .then((result) => {
      if (!result.error && result.fetchedAt) {
        lastPreviewResult = result;
      } else if (lastPreviewResult && result.error) {
        return { ...lastPreviewResult, error: result.error };
      }
      return result;
    })
    .finally(() => {
      previewInFlight = null;
    });

  return previewInFlight;
}
