import type { CourseDomainsConfig, TeachingResearchGroup, TeachingSubjectGroup } from '@repo/shared';
import { normalizeCourseDomainsConfig } from '@repo/shared';
import type { Course, GradeConfig, SemesterData, User } from '../types';
import type {
  AcademicYear,
  AcademicYearPromotionPreview,
  ClassItem,
  Student,
  Enrollment,
  ClassGroupScheme,
  ClassGroup,
  ClassGroupMembership,
  ClassPointEvent,
  StudentTermReport,
  ReportTemplate,
  EvaluationTemplateSummary,
  ReportYearDimensionPreset,
  ReportTemplateProgress,
  ReportClassSubjectInsights,
  ReportClassSubjectAnalysisSummaryItem,
  ReportTeachingDiagnosis,
  TeacherReportTemplateProgress,
  TeacherPortraitCollectionTemplateSummary,
  TeacherPortraitCollectionProgress,
  TeacherPortraitCollectionSubmission,
  StaffingAssignment,
  FunctionalRoleAssignment,
  FunctionalRoleType,
  OrgDepartment,
  ReportTemplateStatus,
  HomeroomCommentMode,
  EvaluationModuleType,
  ScoreVisibility,
  TargetLevel,
  ReportExamConfigScope,
  Term,
  ReportGrade,
} from '../types/classManagement';
import { getCurrentUserId, getToken } from './authUtils';

// 同源部署时为空，联调后端时设为完整前缀（如 http://127.0.0.1:8080/api）
const API_BASE_URL = (import.meta.env.VITE_API_URL as string) ?? '';
/**
 * `VITE_USE_CLOUD_STORAGE === 'true'` 时：课程/班级/学生等会走 API（见 `storage.ts`、`classStorage.ts`）。
 * 为 `false` 时：班级与学生以 localStorage 为准，不依赖本机或远程 API（学生画像扩展模块亦离线）。
 */
const USE_CLOUD_STORAGE = import.meta.env.VITE_USE_CLOUD_STORAGE === 'true';

function getHeaders(): HeadersInit {
  const token = getToken();
  const userId = getCurrentUserId();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : import.meta.env.DEV && userId ? { 'X-User-Id': userId } : {}),
  };
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE_URL) return normalizedPath;

  // Support both forms in VITE_API_URL:
  // - http://127.0.0.1:8080
  // - http://127.0.0.1:8080/api
  // while callers may already pass "/api/..." paths.
  const base = API_BASE_URL.replace(/\/$/, '');
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base.slice(0, -4)}${normalizedPath}`;
  }
  return `${base}${normalizedPath}`;
}

async function readJsonOrThrow(response: Response, fallbackError: string) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text().catch(() => '');
    const preview = text.slice(0, 80).trim();
    throw new Error(`${fallbackError}: expected JSON but got non-JSON response${preview ? ` (${preview})` : ''}`);
  }
  return response.json();
}

async function readErrorMessage(response: Response, fallbackError: string): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    const data = await response.json().catch(() => ({} as { error?: string; message?: string }));
    return (data as { error?: string; message?: string }).error
      || (data as { error?: string; message?: string }).message
      || `${fallbackError} (${response.status})`;
  }
  const text = await response.text().catch(() => '');
  const preview = text.slice(0, 120).trim();
  return preview
    ? `${fallbackError} (${response.status}): ${preview}`
    : `${fallbackError} (${response.status})`;
}

/** 供 AI 等需要自行 fetch 的模块使用 */
export function getApiUrl(path: string): string {
  return apiUrl(path);
}
export function getAuthHeaders(): HeadersInit {
  return getHeaders();
}

/**
 * API 客户端
 */
export const api = {
  /**
   * 检查 API 是否可用
   */
  async checkHealth(): Promise<boolean> {
    if (!USE_CLOUD_STORAGE) return false;
    try {
      const url = API_BASE_URL ? `${API_BASE_URL.replace(/\/api\/?$/, '')}/health` : '/health';
      const response = await fetch(url, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * 认证 API
   */
  async login(username: string, password: string) {
    const response = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(error.error || 'Login failed');
    }
    return response.json();
  },

  async getUser() {
    const response = await fetch(apiUrl('/api/auth/user'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) return null;
      throw new Error('Failed to fetch user');
    }
    return response.json();
  },

  /**
   * 课程 API
   */
  async getCourses(): Promise<Course[]> {
    const response = await fetch(apiUrl('/api/courses'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      // 401 代表未登录/鉴权失败：抛出错误让上层逻辑决定回退到本地缓存或引导登录
      if (response.status === 401) {
        const errorText = await response.text().catch(() => 'Unauthorized');
        throw new Error(`Unauthorized: ${errorText}`);
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch courses: ${response.status} - ${errorText}`);
    }
    return response.json();
  },

  async createCourse(course: Omit<Course, 'id'> & { id?: string }): Promise<Course> {
    const courseData = {
      id: course.id || `course-${Date.now()}`,
      ...course,
    };
    const response = await fetch(apiUrl('/api/courses'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(courseData),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create course' }));
      throw new Error(error.error || 'Failed to create course');
    }
    return response.json();
  },

  async updateCourse(id: string, course: Partial<Course>): Promise<Course> {
    const response = await fetch(apiUrl(`/api/courses/${id}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(course),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update course' }));
      throw new Error(error.error || 'Failed to update course');
    }
    return response.json();
  },

  async deleteCourse(id: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/courses/${id}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete course' }));
      throw new Error(error.error || 'Failed to delete course');
    }
  },

  /** 从数据库全量导出课程管理数据 */
  async exportCurriculumData(): Promise<{
    courses: Course[];
    semesterData: Record<string, SemesterData>;
    keyConcepts: string[];
    categoryOrder: string[];
    courseDomains: CourseDomainsConfig;
    gradeConfig: GradeConfig;
    exportDate: string;
    version: string;
    source?: 'database';
  }> {
    const response = await fetch(apiUrl('/api/curriculum/export'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to export curriculum data: ${response.status} - ${errorText}`);
    }
    return response.json();
  },

  /** 将课程管理数据全量写入数据库（覆盖现有全校课程数据） */
  async importCurriculumData(data: {
    courses?: Course[];
    semesterData?: Record<string, SemesterData>;
    keyConcepts?: string[];
    categoryOrder?: string[];
    courseDomains?: CourseDomainsConfig;
    gradeConfig?: GradeConfig;
  }): Promise<{ success: boolean; coursesImported?: number; semesterRowsImported?: number }> {
    const response = await fetch(apiUrl('/api/curriculum/import'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to import curriculum data' }));
      throw new Error(error.error || 'Failed to import curriculum data');
    }
    return response.json();
  },

  /**
   * 学期数据 API
   */
  async getSemesterData(
    courseId: string,
    grade: number,
    semester: 'Semester 1' | 'Semester 2'
  ): Promise<SemesterData | null> {
    const response = await fetch(
      apiUrl(`/api/semester/${courseId}/${grade}/${semester}`),
      { headers: getHeaders() }
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Failed to fetch semester data');
    }
    return response.json();
  },

  async saveSemesterData(semesterData: SemesterData): Promise<SemesterData> {
    const response = await fetch(apiUrl('/api/semester'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(semesterData),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save semester data' }));
      throw new Error(error.error || 'Failed to save semester data');
    }
    return response.json();
  },

  async deleteSemesterData(
    courseId: string,
    grade: number,
    semester: 'Semester 1' | 'Semester 2'
  ): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/semester/${courseId}/${grade}/${semester}`),
      {
        method: 'DELETE',
        headers: getHeaders(),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete semester data' }));
      throw new Error(error.error || 'Failed to delete semester data');
    }
  },

  /**
   * 用户设置 API（关键概念）
   */
  async getKeyConcepts(): Promise<string[]> {
    const response = await fetch(apiUrl('/api/settings/key-concepts'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) return [];
      if (response.status === 404) return [];
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch key concepts: ${response.status} - ${errorText}`);
    }
    return response.json();
  },

  async saveKeyConcepts(keyConcepts: string[]): Promise<void> {
    const response = await fetch(apiUrl('/api/settings/key-concepts'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ keyConcepts }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save key concepts' }));
      throw new Error(error.error || 'Failed to save key concepts');
    }
  },

  /** 全校共享的学科列顺序（与课程管理/课程河流一致） */
  async getCategoryOrder(): Promise<string[]> {
    const response = await fetch(apiUrl('/api/settings/category-order'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) return [];
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch category order: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },

  async putCategoryOrder(categoryOrder: string[]): Promise<void> {
    const response = await fetch(apiUrl('/api/settings/category-order'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ categoryOrder }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save category order' }));
      throw new Error(error.error || 'Failed to save category order');
    }
  },

  async getCourseDomains(): Promise<CourseDomainsConfig> {
    const response = await fetch(apiUrl('/api/settings/course-domains'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) {
        return { domains: [], domainOrder: [] };
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch course domains: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return normalizeCourseDomainsConfig(data);
  },

  async putCourseDomains(courseDomains: CourseDomainsConfig): Promise<void> {
    const response = await fetch(apiUrl('/api/settings/course-domains'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ courseDomains }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save course domains' }));
      throw new Error(error.error || 'Failed to save course domains');
    }
  },

  async getSchoolGradeStructure(): Promise<GradeConfig> {
    const response = await fetch(apiUrl('/api/settings/school-grade-structure'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Unauthorized');
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch school grade structure: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return data as GradeConfig;
  },

  async putSchoolGradeStructure(gradeStructure: GradeConfig): Promise<GradeConfig> {
    const response = await fetch(apiUrl('/api/settings/school-grade-structure'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ gradeStructure }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save school grade structure' }));
      throw new Error(error.error || 'Failed to save school grade structure');
    }
    const data = await response.json();
    return (data?.gradeStructure ?? data?.gradeConfig ?? gradeStructure) as GradeConfig;
  },

  async getSchoolTeachingResearchGroups(): Promise<TeachingResearchGroup[]> {
    const response = await fetch(apiUrl('/api/settings/teaching-research-groups'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch teaching research groups: ${response.status} - ${errorText}`);
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch teaching research groups');
    return (data.groups ?? []) as TeachingResearchGroup[];
  },

  async getSchoolTeachingSubjectGroups(): Promise<TeachingSubjectGroup[]> {
    const response = await fetch(apiUrl('/api/settings/teaching-subject-groups'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch teaching subject groups: ${response.status} - ${errorText}`);
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch teaching subject groups');
    return (data.groups ?? []) as TeachingSubjectGroup[];
  },

  async putSchoolTeachingSubjectGroups(groups: TeachingSubjectGroup[]): Promise<TeachingSubjectGroup[]> {
    const response = await fetch(apiUrl('/api/settings/teaching-subject-groups'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ groups }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save teaching subject groups');
    }
    const data = await readJsonOrThrow(response, 'Failed to save teaching subject groups');
    return (data.groups ?? groups) as TeachingSubjectGroup[];
  },

  async getAdminTeachingSubjectGroupMembers(
    academicYearId: string,
  ): Promise<Array<{ groupId: string; teacherId: string; teacherName: string | null }>> {
    const response = await fetch(
      apiUrl(
        `/api/admin/teaching-subject-groups/members?academicYearId=${encodeURIComponent(academicYearId)}`,
      ),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch subject group members');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch subject group members');
    return (data.members ?? []) as Array<{ groupId: string; teacherId: string; teacherName: string | null }>;
  },

  async putAdminTeachingSubjectGroupMembers(input: {
    academicYearId: string;
    groupId: string;
    teacherIds: string[];
  }): Promise<void> {
    const response = await fetch(apiUrl('/api/admin/teaching-subject-groups/members'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save subject group members');
    }
  },

  /**
   * 管理员 API：仅 admin 账号可用
   */
  async getAllUsers(
    scope: 'staff' | 'students' = 'staff',
  ): Promise<
    (User & {
      createdAt?: string;
      password?: string | null;
      department?: string | null;
      primarySubject?: string | null;
      nameZh?: string | null;
      nameEn?: string | null;
      studentId?: string | null;
      studentNameZh?: string | null;
      studentNameEn?: string | null;
    })[]
  > {
    const q = scope === 'students' ? '?scope=students' : '';
    const response = await fetch(apiUrl(`/api/admin/users${q}`), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => 'Failed to fetch users');
      throw new Error(text || 'Failed to fetch users');
    }
    const data = await response.json();
    return (data.users ?? []) as (User & {
      createdAt?: string;
      password?: string | null;
      department?: string | null;
      primarySubject?: string | null;
      nameZh?: string | null;
      nameEn?: string | null;
      studentId?: string | null;
      studentNameZh?: string | null;
      studentNameEn?: string | null;
    })[];
  },

  async importStudentAccounts(items?: { studentId: string; password: string }[]): Promise<{
    created: Array<{ studentId: string; username: string; password: string; displayName: string; userId: string }>;
    skipped: Array<{ studentId: string; reason: string }>;
  }> {
    const response = await fetch(apiUrl('/api/admin/users/import-student-accounts'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(items && items.length > 0 ? { items } : {}),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to import student accounts');
    }
    return response.json();
  },

  async createUser(input: {
    username: string;
    displayName?: string;
    nameZh?: string | null;
    nameEn?: string | null;
    role: User['role'];
    password: string;
    department?: string | null;
    primarySubject?: string | null;
  }): Promise<
    User & {
      createdAt?: string;
      password?: string | null;
      department?: string | null;
      primarySubject?: string | null;
      nameZh?: string | null;
      nameEn?: string | null;
    }
  > {
    const response = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => 'Failed to create user');
      let msg = text;
      try {
        const err = JSON.parse(text) as { error?: string };
        if (err?.error) msg = err.error;
      } catch {
        // use text as msg
      }
      throw new Error(msg || 'Failed to create user');
    }
    const data = await response.json();
    return data.user as User & {
      createdAt?: string;
      password?: string | null;
      department?: string | null;
      primarySubject?: string | null;
      nameZh?: string | null;
      nameEn?: string | null;
    };
  },

  async deleteUser(userId: string, confirmUsername: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
      body: JSON.stringify({ confirmUsername }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to delete user');
    }
  },

  async patchUserStaffFields(
    userId: string,
    fields: {
      department?: string | null;
      primarySubject?: string | null;
      nameZh?: string | null;
      nameEn?: string | null;
    },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(fields, 'department')) {
      body.department = fields.department;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'primarySubject')) {
      body.primarySubject = fields.primarySubject;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'nameZh')) {
      body.nameZh = fields.nameZh;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'nameEn')) {
      body.nameEn = fields.nameEn;
    }
    if (Object.keys(body).length === 0) {
      throw new Error('department, primarySubject, nameZh, or nameEn is required');
    }
    const response = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to update user');
    }
  },

  async updateUserDepartment(userId: string, department: string | null): Promise<void> {
    return this.patchUserStaffFields(userId, { department });
  },

  async updateUserRole(userId: string, role: 'admin' | 'teacher'): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}/role`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to update role');
    }
  },

  async batchUpdateDepartment(userIds: string[], department: string | null): Promise<void> {
    const response = await fetch(apiUrl('/api/admin/users/batch-department'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userIds, department }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to update departments');
    }
  },

  async getDatabaseTables(): Promise<Array<{ tableName: string; rowCount: number }>> {
    const response = await fetch(apiUrl('/api/admin/database/tables'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to fetch database tables'));
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch database tables');
    return (data.tables ?? []) as Array<{ tableName: string; rowCount: number }>;
  },

  async getDatabaseTableRows(
    tableName: string,
    input?: { limit?: number; offset?: number }
  ): Promise<{
    tableName: string;
    columns: string[];
    primaryKey: string | null;
    page: { limit: number; offset: number; total: number };
    rows: Array<Record<string, unknown>>;
  }> {
    const limit = input?.limit ?? 20;
    const offset = input?.offset ?? 0;
    const response = await fetch(
      apiUrl(`/api/admin/database/tables/${encodeURIComponent(tableName)}/rows?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`),
      { headers: getHeaders() }
    );
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to fetch table rows'));
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch table rows');
    return {
      tableName: data.tableName as string,
      columns: (data.columns ?? []) as string[],
      primaryKey: (data.primaryKey as string | null | undefined) ?? null,
      page: (data.page ?? { limit, offset, total: 0 }) as { limit: number; offset: number; total: number },
      rows: (data.rows ?? []) as Array<Record<string, unknown>>,
    };
  },

  async getDingTalkPreview(input?: { force?: boolean }): Promise<import('../types/dingtalk').DingTalkPreviewData> {
    const force = input?.force ? 'force=1' : '';
    const qs = force ? `?${force}` : '';
    const response = await fetch(apiUrl(`/api/admin/dingtalk/preview${qs}`), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to fetch DingTalk preview'));
    }
    return readJsonOrThrow(response, 'Failed to fetch DingTalk preview');
  },

  async getDingTalkSyncPlan(
    preview?: import('../types/dingtalk').DingTalkPreviewData,
  ): Promise<import('../types/dingtalkSync').DingTalkSyncPlan> {
    const response = await fetch(apiUrl('/api/admin/dingtalk/sync/plan'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ preview: preview ?? undefined }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to load sync plan'));
    }
    return readJsonOrThrow(response, 'Failed to load sync plan');
  },

  async applyDingTalkSync(input: {
    actionIds: string[];
    preview?: import('../types/dingtalk').DingTalkPreviewData;
    plan?: import('../types/dingtalkSync').DingTalkSyncPlan;
  }): Promise<import('../types/dingtalkSync').DingTalkSyncApplyResult> {
    const response = await fetch(apiUrl('/api/admin/dingtalk/sync/apply'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ actionIds: input.actionIds, preview: input.preview, plan: input.plan }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to apply sync'));
    }
    return readJsonOrThrow(response, 'Failed to apply sync');
  },

  /**
   * 班级管理 API（1.3）
   */
  async getAcademicYears(): Promise<AcademicYear[]> {
    const response = await fetch(apiUrl('/api/classes/academic-years'), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch academic years');
    const data = await response.json();
    return (data.years ?? data) as AcademicYear[];
  },

  async getCurrentAcademicYear(): Promise<AcademicYear | null> {
    const response = await fetch(apiUrl('/api/classes/current-year'), { headers: getHeaders() });
    if (!response.ok) return null;
    const data = await response.json();
    return (data.year ?? data) as AcademicYear | null;
  },

  async setCurrentAcademicYear(academicYearId: string): Promise<void> {
    const response = await fetch(apiUrl('/api/classes/current-year'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ academicYearId }),
    });
    if (!response.ok) throw new Error('Failed to set current academic year');
  },

  async createAcademicYear(year: AcademicYear): Promise<AcademicYear> {
    const response = await fetch(apiUrl('/api/classes/academic-years'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(year),
    });
    if (!response.ok) throw new Error('Failed to create academic year');
    return response.json();
  },

  async deleteAcademicYear(academicYearId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/classes/academic-years/${encodeURIComponent(academicYearId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete academic year');
  },

  async getAcademicYearPromotePreview(sourceYearId?: string): Promise<AcademicYearPromotionPreview> {
    const qs = sourceYearId ? `?sourceYearId=${encodeURIComponent(sourceYearId)}` : '';
    const response = await fetch(apiUrl(`/api/classes/academic-years/promote-preview${qs}`), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to load promotion preview');
    }
    const data = await response.json();
    return (data.preview ?? data) as AcademicYearPromotionPreview;
  },

  async promoteAcademicYearToNext(sourceYearId?: string): Promise<{
    success: boolean;
    sourceYearId: string;
    targetYearId: string;
    targetYearName: string;
    classesPromoted: number;
    classesGraduated: number;
    studentsPromoted: number;
    studentsGraduated: number;
    targetSetCurrent: boolean;
  }> {
    const response = await fetch(apiUrl('/api/classes/academic-years/promote-to-next'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(sourceYearId ? { sourceYearId } : {}),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to promote academic year');
    }
    return response.json();
  },

  async getClasses(academicYearId: string): Promise<ClassItem[]> {
    const url = academicYearId
      ? apiUrl(`/api/classes?academicYearId=${encodeURIComponent(academicYearId)}`)
      : apiUrl('/api/classes');
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch classes');
    const data = await response.json();
    return (data.classes ?? data) as ClassItem[];
  },

  async getMySubjectAssignments(
    academicYearId: string,
  ): Promise<Array<{ classId: string; subjectKey: string; subjectName?: string }>> {
    const response = await fetch(
      apiUrl(`/api/classes/me/subject-assignments?academicYearId=${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to fetch subject assignments');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch subject assignments');
    return (data.assignments ?? []) as Array<{ classId: string; subjectKey: string }>;
  },

  async getMyHomeroomClassIds(academicYearId: string): Promise<string[]> {
    const response = await fetch(
      apiUrl(`/api/classes/me/homeroom-classes?academicYearId=${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to fetch homeroom classes');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch homeroom classes');
    return (data.classIds ?? []) as string[];
  },

  async getMyGradeHeadClassIds(academicYearId: string): Promise<string[]> {
    const response = await fetch(
      apiUrl(`/api/classes/me/grade-head-classes?academicYearId=${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to fetch grade-head classes');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch grade-head classes');
    return (data.classIds ?? []) as string[];
  },

  async createClass(item: ClassItem): Promise<ClassItem> {
    const response = await fetch(apiUrl('/api/classes'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error('Failed to create class');
    return response.json();
  },

  async deleteClass(classId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/classes/${encodeURIComponent(classId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete class');
  },

  async getClassTeachers(
    classId: string
  ): Promise<{ teacherId: string; role: string; displayName: string }[]> {
    const response = await fetch(apiUrl(`/api/classes/${encodeURIComponent(classId)}/teachers`), {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch class teachers');
    const data = await response.json();
    return (data.teachers ?? data) as { teacherId: string; role: string; displayName: string }[];
  },

  async addClassTeacher(
    classId: string,
    input: { teacherId: string; role?: string }
  ): Promise<{ id: string; classId: string; teacherId: string; role: string }> {
    let response: Response;
    try {
      response = await fetch(apiUrl(`/api/classes/${encodeURIComponent(classId)}/teachers`), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(input),
      });
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      throw new Error(`Failed to add class teacher (network): ${msg}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let msg = text || `Failed to add class teacher (${response.status} ${response.statusText})`;
      try {
        const data = JSON.parse(text) as { error?: string };
        if (data?.error) msg = data.error;
      } catch {
        // use text
      }
      throw new Error(msg);
    }
    return response.json();
  },

  async removeClassTeacher(classId: string, teacherId: string): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/classes/${encodeURIComponent(classId)}/teachers/${encodeURIComponent(teacherId)}`),
      {
        method: 'DELETE',
        headers: getHeaders(),
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let msg = text || 'Failed to remove class teacher';
      try {
        const data = JSON.parse(text) as { error?: string };
        if (data?.error) msg = data.error;
      } catch {
        // use text
      }
      throw new Error(msg);
    }
  },

  async getStudents(): Promise<Student[]> {
    const response = await fetch(apiUrl('/api/classes/students'), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch students');
    const data = await response.json();
    return (data.students ?? data) as Student[];
  },

  async createStudent(student: Student): Promise<Student> {
    const response = await fetch(apiUrl('/api/classes/students'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(student),
    });
    if (!response.ok) throw new Error('Failed to create student');
    return response.json();
  },

  async updateStudent(studentId: string, patch: Partial<Student>): Promise<Student> {
    const response = await fetch(apiUrl(`/api/classes/students/${encodeURIComponent(studentId)}`), {
      method: 'PATCH',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error('Failed to update student');
    return response.json();
  },

  async deleteStudent(studentId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/classes/students/${encodeURIComponent(studentId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete student');
  },

  async getEnrollments(): Promise<Enrollment[]> {
    const response = await fetch(apiUrl('/api/classes/enrollments'), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch enrollments');
    const data = await response.json();
    return (data.enrollments ?? data) as Enrollment[];
  },

  async addEnrollment(enrollment: Enrollment): Promise<Enrollment> {
    const response = await fetch(apiUrl('/api/classes/enrollments'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(enrollment),
    });
    if (!response.ok) throw new Error('Failed to add enrollment');
    return response.json();
  },

  async removeEnrollment(enrollmentId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/classes/enrollments/${encodeURIComponent(enrollmentId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to remove enrollment');
  },

  /**
   * 学生画像 API（可扩展模块）
   */
  async getStudentProfileModules(): Promise<Array<{
    id: string;
    key: string;
    name: string;
    description?: string | null;
    isSystem: boolean;
    isEnabled: boolean;
    fields: Array<{
      id: string;
      fieldKey: string;
      label: string;
      fieldType: 'text' | 'number' | 'single-select' | 'multi-select' | 'score';
      scoreMin?: number | null;
      scoreMax?: number | null;
      options?: unknown;
      sortOrder: number;
      required: boolean;
    }>;
  }>> {
    const response = await fetch(apiUrl('/api/classes/profile/modules'), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch profile modules');
    const data = await response.json();
    return (data.modules ?? []) as Array<{
      id: string;
      key: string;
      name: string;
      description?: string | null;
      isSystem: boolean;
      isEnabled: boolean;
      fields: Array<{
        id: string;
        fieldKey: string;
        label: string;
        fieldType: 'text' | 'number' | 'single-select' | 'multi-select' | 'score';
        scoreMin?: number | null;
        scoreMax?: number | null;
        options?: unknown;
        sortOrder: number;
        required: boolean;
      }>;
    }>;
  },

  async getStudentProfileValues(studentId: string): Promise<Record<string, Record<string, unknown>>> {
    const response = await fetch(
      apiUrl(`/api/classes/profile/students/${encodeURIComponent(studentId)}/values`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch student profile values');
    const data = await response.json();
    return (data.values ?? {}) as Record<string, Record<string, unknown>>;
  },

  async putStudentProfileModuleValues(
    studentId: string,
    moduleId: string,
    values: Record<string, unknown>
  ): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/classes/profile/students/${encodeURIComponent(studentId)}/modules/${encodeURIComponent(moduleId)}/values`),
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ values }),
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => 'Failed to save student profile values');
      throw new Error(text || 'Failed to save student profile values');
    }
  },

  async getStudentTermReports(
    studentId: string,
    academicYearId?: string
  ): Promise<Array<{
    id: string;
    studentId: string;
    academicYearId: string;
    academicYearName: string;
    term: Term;
    templateId: string | null;
    templateTitle: string | null;
    homeroomComment: string | null;
    updatedAt: string | null;
    releasedAt: string | null;
  }>> {
    const q = academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : '';
    const response = await fetch(
      apiUrl(`/api/classes/reports/students/${encodeURIComponent(studentId)}${q}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch term reports');
    const data = await readJsonOrThrow(response, 'Failed to fetch term reports');
    return (data.reports ?? []) as Array<{
      id: string;
      studentId: string;
      academicYearId: string;
      academicYearName: string;
      term: Term;
      templateId: string | null;
      templateTitle: string | null;
      homeroomComment: string | null;
      updatedAt: string | null;
      releasedAt: string | null;
    }>;
  },

  async getStudentTermReportBundle(
    studentId: string,
    academicYearId: string,
    term: Term,
    templateId: string,
    opts?: { portraitScope?: 'overview' },
  ): Promise<{ report: StudentTermReport; template: ReportTemplate | null }> {
    const q = new URLSearchParams();
    if (opts?.portraitScope === 'overview') q.set('portraitScope', 'overview');
    const qs = q.toString();
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/students/${encodeURIComponent(studentId)}/terms/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}/templates/${encodeURIComponent(templateId)}${qs ? `?${qs}` : ''}`,
      ),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch report detail');
    const data = await readJsonOrThrow(response, 'Failed to fetch report detail');
    return {
      report: data.report as StudentTermReport,
      template: (data.template ?? null) as ReportTemplate | null,
    };
  },

  async getStudentTermReportDetail(studentId: string, academicYearId: string, term: Term, templateId: string): Promise<StudentTermReport> {
    const bundle = await this.getStudentTermReportBundle(studentId, academicYearId, term, templateId);
    return bundle.report;
  },

  async getReportTemplatesForTerm(
    academicYearId: string,
    term: Term,
    opts?: { schoolSegmentId?: string | null }
  ): Promise<ReportTemplate[]> {
    const q = new URLSearchParams();
    if (opts?.schoolSegmentId && String(opts.schoolSegmentId).trim()) {
      q.set('schoolSegmentId', String(opts.schoolSegmentId).trim());
    }
    const qs = q.toString();
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/templates/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}${qs ? `?${qs}` : ''}`
      ),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch report template');
    const data = await readJsonOrThrow(response, 'Failed to fetch report template');
    return (data.templates ?? []) as ReportTemplate[];
  },

  async getReportTemplateById(templateId: string): Promise<ReportTemplate> {
    const response = await fetch(
      apiUrl(`/api/classes/reports/templates/${encodeURIComponent(templateId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch report template detail');
    const data = await readJsonOrThrow(response, 'Failed to fetch report template detail');
    return data.template as ReportTemplate;
  },

  /** 教师端：读取学年考试维度满分与百分比等第档（与管理员「目标维度分值」同源） */
  async getTeacherReportYearDimensionExamPreset(
    academicYearId: string
  ): Promise<{
    academicYearId: string;
    examConfigs: Record<string, ReportExamConfigScope>;
    stageInclusion?: Record<string, string[]>;
    evaluationGradeInclusion?: Record<string, Record<string, string[]>>;
    examGradeInclusion?: Record<string, Record<string, string[]>>;
    subjectKeyToCourseId?: Record<string, string>;
    updatedAt: string | null;
  } | null> {
    const response = await fetch(
      apiUrl(`/api/classes/reports/year-dimension-presets/${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch year dimension exam preset');
    const data = await readJsonOrThrow(response, 'Failed to fetch year dimension exam preset');
    return (data.preset ?? null) as {
      academicYearId: string;
      examConfigs: Record<string, ReportExamConfigScope>;
      stageInclusion?: Record<string, string[]>;
      evaluationGradeInclusion?: Record<string, Record<string, string[]>>;
      examGradeInclusion?: Record<string, Record<string, string[]>>;
      subjectKeyToCourseId?: Record<string, string>;
      updatedAt: string | null;
    } | null;
  },

  async getReportTemplateAssignedTeachers(
    templateId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const response = await fetch(
      apiUrl(`/api/classes/reports/templates/${encodeURIComponent(templateId)}/assigned-teachers`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch assigned teachers');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch assigned teachers');
    return (data.teachers ?? []) as Array<{ id: string; name: string }>;
  },

  async getMyReportTemplateProgress(
    templateId: string,
    options?: { teacherId?: string },
  ): Promise<TeacherReportTemplateProgress> {
    const q = options?.teacherId?.trim()
      ? `?teacherId=${encodeURIComponent(options.teacherId.trim())}`
      : '';
    const response = await fetch(
      apiUrl(`/api/classes/reports/templates/${encodeURIComponent(templateId)}/my-progress${q}`),
      { headers: getHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch my report progress');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch my report progress');
    return data.progress as TeacherReportTemplateProgress;
  },

  async getReportClassSubjectInsights(
    templateId: string,
    classId: string,
    subjectKey: string
  ): Promise<ReportClassSubjectInsights> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/templates/${encodeURIComponent(templateId)}/classes/${encodeURIComponent(classId)}/subjects/${encodeURIComponent(subjectKey)}/class-insights`
      ),
      { headers: getHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch class insights');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch class insights');
    return data.insights as ReportClassSubjectInsights;
  },

  async getReportClassInsightsSummary(
    templateId: string,
    classId: string,
  ): Promise<ReportClassSubjectAnalysisSummaryItem[]> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/templates/${encodeURIComponent(templateId)}/classes/${encodeURIComponent(classId)}/class-insights-summary`,
      ),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch class insights summary');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch class insights summary');
    return (data.subjects ?? []) as ReportClassSubjectAnalysisSummaryItem[];
  },

  async getStudentSubjectInsights(
    templateId: string,
    studentId: string,
  ): Promise<Array<{
    subjectKey: string;
    subjectName: string;
    teacherName: string | null;
    learningAnalysis: string | null;
    supportPlan: string | null;
  }>> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/templates/${encodeURIComponent(templateId)}/students/${encodeURIComponent(studentId)}/subject-insights`,
      ),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch student subject insights');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch student subject insights');
    return (data.insights ?? []) as Array<{
      subjectKey: string;
      subjectName: string;
      teacherName: string | null;
      learningAnalysis: string | null;
      supportPlan: string | null;
    }>;
  },

  async upsertReportClassSubjectInsights(
    templateId: string,
    classId: string,
    subjectKey: string,
    payload: {
      classOverallAnalysis: string | null;
      studentAnalysisRows: Array<{ studentId: string; learningAnalysis: string; supportPlan: string }>;
    }
  ): Promise<void> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/templates/${encodeURIComponent(templateId)}/classes/${encodeURIComponent(classId)}/subjects/${encodeURIComponent(subjectKey)}/class-insights`
      ),
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save class insights');
    }
  },

  async upsertStudentTermSubjectReport(
    studentId: string,
    academicYearId: string,
    term: Term,
    templateId: string,
    subjectKey: string,
    payload: {
      subjectName: string;
      midtermScore: number | null;
      finalScore: number | null;
      examDimensionScores?: Record<string, number | null> | null;
      teacherComment?: string | null;
      learningQualityGrade?: TargetLevel | null;
      dimensions: Array<{
        dimensionKey: string;
        dimensionLabel: string;
        rating: TargetLevel;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }>;
    }
  ): Promise<void> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/students/${encodeURIComponent(studentId)}/terms/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}/templates/${encodeURIComponent(templateId)}/subjects/${encodeURIComponent(subjectKey)}`
      ),
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save subject report');
    }
  },

  async updateStudentTermHomeroomComment(
    studentId: string,
    academicYearId: string,
    term: Term,
    templateId: string,
    comment: string | null
  ): Promise<void> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/students/${encodeURIComponent(studentId)}/terms/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}/templates/${encodeURIComponent(templateId)}/homeroom-comment`
      ),
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ comment }),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save homeroom comment');
    }
  },

  async getAdminReportTemplates(input?: { academicYearId?: string; term?: Term }): Promise<EvaluationTemplateSummary[]> {
    const q = new URLSearchParams();
    if (input?.academicYearId) q.set('academicYearId', input.academicYearId);
    if (input?.term) q.set('term', input.term);
    const response = await fetch(apiUrl(`/api/admin/report-templates${q.toString() ? `?${q.toString()}` : ''}`), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch report templates');
    const data = await readJsonOrThrow(response, 'Failed to fetch report templates');
    return (data.templates ?? []) as EvaluationTemplateSummary[];
  },

  async createAdminReportTemplate(input: {
    academicYearId: string;
    term: Term;
    title?: string | null;
    sourceTemplateId?: string | null;
    schoolSegmentId?: string | null;
  }): Promise<ReportTemplate> {
    const response = await fetch(apiUrl('/api/admin/report-templates'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Failed to create report template');
    const data = await readJsonOrThrow(response, 'Failed to create report template');
    return data.template as ReportTemplate;
  },

  async getAdminReportTemplate(templateId: string): Promise<ReportTemplate> {
    const response = await fetch(
      apiUrl(`/api/admin/report-templates/${encodeURIComponent(templateId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch report template detail');
    const data = await readJsonOrThrow(response, 'Failed to fetch report template detail');
    return data.template as ReportTemplate;
  },

  async getAdminReportYearDimensionPreset(academicYearId: string): Promise<ReportYearDimensionPreset | null> {
    const response = await fetch(
      apiUrl(`/api/admin/report-dimension-presets/${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch report year dimension preset');
    const data = await readJsonOrThrow(response, 'Failed to fetch report year dimension preset');
    return (data.preset ?? null) as ReportYearDimensionPreset | null;
  },

  async getAdminReportScoreGradeBands(input: {
    academicYearId: string;
    term: Term;
    schoolSegmentId: string;
  }): Promise<{ academicYearId: string; term: Term; schoolSegmentId: string; minScores: Record<ReportGrade, number> }> {
    const q = new URLSearchParams();
    q.set('academicYearId', input.academicYearId.trim());
    q.set('term', input.term);
    q.set('schoolSegmentId', input.schoolSegmentId.trim());
    const response = await fetch(apiUrl(`/api/admin/report-score-grade-bands?${q.toString()}`), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch score grade bands');
    const data = await readJsonOrThrow(response, 'Failed to fetch score grade bands');
    return data as { academicYearId: string; term: Term; schoolSegmentId: string; minScores: Record<ReportGrade, number> };
  },

  async putAdminReportScoreGradeBands(input: {
    academicYearId: string;
    term: Term;
    schoolSegmentId: string;
    minScores: Partial<Record<ReportGrade, number>>;
  }): Promise<{ minScores: Record<ReportGrade, number> }> {
    const response = await fetch(apiUrl('/api/admin/report-score-grade-bands'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save score grade bands');
    }
    const data = await readJsonOrThrow(response, 'Failed to save score grade bands');
    return data as { minScores: Record<ReportGrade, number> };
  },

  async upsertAdminReportYearDimensionPreset(input: {
    academicYearId: string;
    homeroomCommentMode: HomeroomCommentMode;
    /** 不传则服务端保留已有「参与学业报告」配置 */
    stageInclusion?: Record<string, string[]>;
    evaluationGradeInclusion?: Record<string, Record<string, string[]>>;
    examGradeInclusion?: Record<string, Record<string, string[]>>;
    /** key = `${term}::${schoolSegmentId}` */
    examConfigs?: Record<string, ReportExamConfigScope>;
    /** 不传则服务端保留已有全学科共用等第说明 */
    unifiedLevelDescriptions?: Partial<Record<TargetLevel, string>>;
    subjects: Array<{
      courseId?: string;
      subjectKey?: string;
      subjectNameZh: string;
      subjectNameEn: string;
      enableScore?: boolean;
      enableTeacherComment?: boolean;
      enableTarget?: boolean;
      gradeDimensions?: Array<{
        gradeId: string;
        dimensions: Array<{
          dimensionLabelZh: string;
          dimensionLabelEn: string;
          levelDescriptions: Partial<Record<TargetLevel, string>>;
        }>;
      }>;
      dimensions: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }>;
    }>;
  }): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/admin/report-dimension-presets/${encodeURIComponent(input.academicYearId)}`),
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          homeroomCommentMode: input.homeroomCommentMode,
          subjects: input.subjects,
          ...(input.stageInclusion !== undefined ? { stageInclusion: input.stageInclusion } : {}),
          ...(input.evaluationGradeInclusion !== undefined
            ? { evaluationGradeInclusion: input.evaluationGradeInclusion }
            : {}),
          ...(input.examGradeInclusion !== undefined ? { examGradeInclusion: input.examGradeInclusion } : {}),
          ...(input.examConfigs !== undefined ? { examConfigs: input.examConfigs } : {}),
          ...(input.unifiedLevelDescriptions !== undefined ? { unifiedLevelDescriptions: input.unifiedLevelDescriptions } : {}),
        }),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save report year dimension preset');
    }
  },

  async upsertAdminReportTemplate(input: {
    templateId: string;
    title?: string | null;
    status: ReportTemplateStatus;
    homeroomCommentMode: HomeroomCommentMode;
    subjects: Array<{
      /** 与岗位安排 subject_key / 课程一致；未传时由服务端按英文名规范化 */
      subjectKey?: string;
      subjectNameZh: string;
      subjectNameEn: string;
      moduleType?: EvaluationModuleType;
      enableScore?: boolean;
      enableTeacherComment?: boolean;
      enableLearningQuality?: boolean;
      scoreVisibility?: ScoreVisibility;
      dimensions: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions: Partial<Record<TargetLevel, string>>;
      }>;
    }>;
  }): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/admin/report-templates/${encodeURIComponent(input.templateId)}`),
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          title: input.title ?? null,
          status: input.status,
          homeroomCommentMode: input.homeroomCommentMode,
          subjects: input.subjects,
        }),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save report template');
    }
  },

  async publishAdminReportTemplate(templateId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/report-templates/${encodeURIComponent(templateId)}/publish`), {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to publish report template');
    }
  },

  async closeAdminReportTemplate(templateId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/report-templates/${encodeURIComponent(templateId)}/close`), {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to close report template');
    }
  },

  async releaseAdminReportTemplate(templateId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/report-templates/${encodeURIComponent(templateId)}/release`), {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to release report template');
    }
  },

  async deleteAdminReportTemplate(templateId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/report-templates/${encodeURIComponent(templateId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to delete report template');
    }
  },

  async getAdminReportTemplateProgress(templateId: string): Promise<ReportTemplateProgress> {
    const response = await fetch(apiUrl(`/api/admin/report-templates/${encodeURIComponent(templateId)}/progress`), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch report progress');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch report progress');
    return data.progress as ReportTemplateProgress;
  },

  async getAdminStaffingAssignments(academicYearId: string): Promise<StaffingAssignment[]> {
    const response = await fetch(
      apiUrl(`/api/admin/staffing/assignments?academicYearId=${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch staffing assignments');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch staffing assignments');
    return (data.assignments ?? []) as StaffingAssignment[];
  },

  async upsertAdminStaffingAssignment(input: {
    academicYearId: string;
    classId: string;
    subjectKey: string;
    subjectName: string;
    teacherId: string;
    teacherSlot?: 0 | 1;
  }): Promise<void> {
    const response = await fetch(apiUrl('/api/admin/staffing/assignments'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save staffing assignment');
    }
  },

  async deleteAdminStaffingAssignment(input: {
    academicYearId: string;
    classId: string;
    subjectKey: string;
    /** 指定时只删该教师位；省略则删除该班该学科全部岗位行 */
    teacherSlot?: 0 | 1;
  }): Promise<void> {
    const base = `/api/admin/staffing/assignments/${encodeURIComponent(input.academicYearId)}/${encodeURIComponent(input.classId)}/${encodeURIComponent(input.subjectKey)}`;
    const q =
      input.teacherSlot === 0 || input.teacherSlot === 1
        ? `?slot=${encodeURIComponent(String(input.teacherSlot))}`
        : '';
    const response = await fetch(apiUrl(`${base}${q}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to remove staffing assignment');
    }
  },

  async getAdminFunctionalRoles(academicYearId: string): Promise<FunctionalRoleAssignment[]> {
    const response = await fetch(
      apiUrl(`/api/admin/functional-roles?academicYearId=${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch functional roles');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch functional roles');
    return (data.assignments ?? []) as FunctionalRoleAssignment[];
  },

  async upsertAdminFunctionalRole(input: {
    academicYearId: string;
    roleType: FunctionalRoleType;
    scopeKey: string;
    scopeLabel?: string | null;
    teacherId: string | null;
  }): Promise<void> {
    const response = await fetch(apiUrl('/api/admin/functional-roles'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save functional role');
    }
  },

  async getAdminOrgDepartments(): Promise<OrgDepartment[]> {
    const response = await fetch(apiUrl('/api/admin/org-departments'), { headers: getHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch org departments');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch org departments');
    return (data.departments ?? []) as OrgDepartment[];
  },

  async createAdminOrgDepartment(input: { name: string; parentId?: string | null }): Promise<OrgDepartment> {
    const response = await fetch(apiUrl('/api/admin/org-departments'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name: input.name,
        parentId: input.parentId ?? null,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to create department');
    }
    const data = await readJsonOrThrow(response, 'Failed to create department');
    return (data as { department: OrgDepartment }).department;
  },

  async updateAdminOrgDepartment(
    id: string,
    input: Partial<{ name: string; parentId: string | null; sortOrder: number }>,
  ): Promise<OrgDepartment> {
    const response = await fetch(apiUrl(`/api/admin/org-departments/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to update department');
    }
    const data = await readJsonOrThrow(response, 'Failed to update department');
    return (data as { department: OrgDepartment }).department;
  },

  async deleteAdminOrgDepartment(id: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/org-departments/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to delete department');
    }
  },

  /**
   * 课堂助手 API：分组方案、小组、成员、积分事件
   */
  async getClassAssistantSchemes(classId: string): Promise<ClassGroupScheme[]> {
    const response = await fetch(apiUrl(`/api/classes/assistant/schemes?classId=${encodeURIComponent(classId)}`), {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch group schemes');
    const data = await response.json();
    return (data.schemes ?? data) as ClassGroupScheme[];
  },

  async createClassAssistantScheme(scheme: ClassGroupScheme): Promise<ClassGroupScheme> {
    const response = await fetch(apiUrl('/api/classes/assistant/schemes'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(scheme),
    });
    if (!response.ok) throw new Error('Failed to create group scheme');
    return response.json();
  },

  async deleteClassAssistantScheme(schemeId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/classes/assistant/schemes/${encodeURIComponent(schemeId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete group scheme');
  },

  async getClassAssistantGroups(classId: string, schemeId: string): Promise<ClassGroup[]> {
    const response = await fetch(
      apiUrl(`/api/classes/assistant/groups?classId=${encodeURIComponent(classId)}&schemeId=${encodeURIComponent(schemeId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch groups');
    const data = await response.json();
    return (data.groups ?? data) as ClassGroup[];
  },

  async putClassAssistantGroups(classId: string, schemeId: string, groups: ClassGroup[]): Promise<void> {
    const response = await fetch(apiUrl('/api/classes/assistant/groups'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ classId, schemeId, groups }),
    });
    if (!response.ok) throw new Error('Failed to save groups');
  },

  async getClassAssistantMembers(classId: string, schemeId: string): Promise<ClassGroupMembership[]> {
    const response = await fetch(
      apiUrl(`/api/classes/assistant/members?classId=${encodeURIComponent(classId)}&schemeId=${encodeURIComponent(schemeId)}`),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch group members');
    const data = await response.json();
    return (data.members ?? data) as ClassGroupMembership[];
  },

  async putClassAssistantMembers(classId: string, schemeId: string, members: ClassGroupMembership[]): Promise<void> {
    const response = await fetch(apiUrl('/api/classes/assistant/members'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ classId, schemeId, members }),
    });
    if (!response.ok) throw new Error('Failed to save group members');
  },

  async getClassAssistantPointEvents(classId: string, schemeId?: string | null): Promise<ClassPointEvent[]> {
    let url = `/api/classes/assistant/point-events?classId=${encodeURIComponent(classId)}`;
    if (schemeId != null && schemeId !== '') {
      url += `&schemeId=${encodeURIComponent(schemeId)}`;
    }
    const response = await fetch(apiUrl(url), { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch point events');
    const data = await response.json();
    return (data.events ?? data) as ClassPointEvent[];
  },

  async postClassAssistantPointEvents(events: ClassPointEvent | ClassPointEvent[]): Promise<void> {
    const arr = Array.isArray(events) ? events : [events];
    const response = await fetch(apiUrl('/api/classes/assistant/point-events'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(arr),
    });
    if (!response.ok) throw new Error('Failed to save point events');
  },

  async putClassAssistantPointEvents(classId: string, events: ClassPointEvent[]): Promise<void> {
    const response = await fetch(apiUrl('/api/classes/assistant/point-events'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ classId, events }),
    });
    if (!response.ok) throw new Error('Failed to save point events');
  },

  async getAdminTeacherPortraitTemplates(input?: {
    academicYearId?: string;
    term?: Term;
  }): Promise<TeacherPortraitCollectionTemplateSummary[]> {
    const q = new URLSearchParams();
    if (input?.academicYearId) q.set('academicYearId', input.academicYearId);
    if (input?.term) q.set('term', input.term);
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates${q.toString() ? `?${q.toString()}` : ''}`),
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error('Failed to fetch teacher portrait templates');
    const data = await readJsonOrThrow(response, 'Failed to fetch teacher portrait templates');
    return (data.templates ?? []) as TeacherPortraitCollectionTemplateSummary[];
  },

  async createAdminTeacherPortraitTemplate(input: {
    academicYearId: string;
    term: Term;
    title?: string | null;
    collectionType?: string;
  }): Promise<TeacherPortraitCollectionTemplateSummary> {
    const response = await fetch(apiUrl('/api/admin/teacher-portrait/templates'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to create teacher portrait template');
    }
    const data = await readJsonOrThrow(response, 'Failed to create teacher portrait template');
    return data.template as TeacherPortraitCollectionTemplateSummary;
  },

  async putAdminTeacherPortraitTemplate(
    templateId: string,
    input: { title?: string | null },
  ): Promise<TeacherPortraitCollectionTemplateSummary> {
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}`),
      { method: 'PUT', headers: getHeaders(), body: JSON.stringify(input) },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to update template');
    }
    const data = await readJsonOrThrow(response, 'Failed to update template');
    return data.template as TeacherPortraitCollectionTemplateSummary;
  },

  async publishAdminTeacherPortraitTemplate(templateId: string): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}/publish`),
      { method: 'POST', headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to publish');
    }
  },

  async closeAdminTeacherPortraitTemplate(templateId: string): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}/close`),
      { method: 'POST', headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to close');
    }
  },

  async deleteAdminTeacherPortraitTemplate(templateId: string): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}`),
      { method: 'DELETE', headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to delete');
    }
  },

  async getAdminTeacherPortraitTemplateSubmissions(
    templateId: string,
  ): Promise<TeacherPortraitCollectionSubmission[]> {
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}/submissions`),
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error('Failed to fetch submissions');
    const data = await readJsonOrThrow(response, 'Failed to fetch submissions');
    return (data.submissions ?? []) as TeacherPortraitCollectionSubmission[];
  },

  async getAdminTeacherPortraitTeacherSubmission(
    templateId: string,
    teacherId: string,
  ): Promise<TeacherPortraitCollectionSubmission> {
    const response = await fetch(
      apiUrl(
        `/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}/submissions/${encodeURIComponent(teacherId)}`,
      ),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch teacher submission');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch teacher submission');
    return data.submission as TeacherPortraitCollectionSubmission;
  },

  async getAdminTeacherPortraitTemplateProgress(
    templateId: string,
  ): Promise<TeacherPortraitCollectionProgress> {
    const response = await fetch(
      apiUrl(`/api/admin/teacher-portrait/templates/${encodeURIComponent(templateId)}/progress`),
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error('Failed to fetch progress');
    const data = await readJsonOrThrow(response, 'Failed to fetch progress');
    const progress = data.progress as TeacherPortraitCollectionProgress;
    return {
      ...progress,
      completed: progress.completed ?? [],
      pending: progress.pending ?? [],
    };
  },

  async getTeacherPortraitCollections(input?: {
    academicYearId?: string;
    term?: Term;
  }): Promise<TeacherPortraitCollectionTemplateSummary[]> {
    const q = new URLSearchParams();
    if (input?.academicYearId) q.set('academicYearId', input.academicYearId);
    if (input?.term) q.set('term', input.term);
    const response = await fetch(
      apiUrl(`/api/classes/teacher-portrait/collections${q.toString() ? `?${q.toString()}` : ''}`),
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error('Failed to fetch teacher portrait collections');
    const data = await readJsonOrThrow(response, 'Failed to fetch teacher portrait collections');
    return (data.templates ?? []) as TeacherPortraitCollectionTemplateSummary[];
  },

  async getTeacherPortraitCollection(templateId: string): Promise<{
    template: TeacherPortraitCollectionTemplateSummary & { canEdit?: boolean };
    submission: {
      diagnosis: ReportTeachingDiagnosis;
      hasContent: boolean;
      updatedAt: string | null;
    };
  }> {
    const response = await fetch(
      apiUrl(`/api/classes/teacher-portrait/collections/${encodeURIComponent(templateId)}`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch collection');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch collection');
    return data as {
      template: TeacherPortraitCollectionTemplateSummary & { canEdit?: boolean };
      submission: {
        diagnosis: ReportTeachingDiagnosis;
        hasContent: boolean;
        updatedAt: string | null;
      };
    };
  },

  async saveTeacherPortraitCollection(
    templateId: string,
    payload: { diagnosis: ReportTeachingDiagnosis },
  ): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/classes/teacher-portrait/collections/${encodeURIComponent(templateId)}`),
      { method: 'PUT', headers: getHeaders(), body: JSON.stringify(payload) },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to save');
    }
  },

  async getPortraitSubjectGroups(academicYearId: string): Promise<{
    groups: import('../types/classManagement').SubjectGroupPortraitSummary[];
    isAdmin: boolean;
  }> {
    const response = await fetch(
      apiUrl(`/api/classes/teacher-portrait/subject-groups?academicYearId=${encodeURIComponent(academicYearId)}`),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch subject groups');
    }
    return (await readJsonOrThrow(response, 'Failed to fetch subject groups')) as {
      groups: import('../types/classManagement').SubjectGroupPortraitSummary[];
      isAdmin: boolean;
    };
  },

  async getSubjectGroupPortraitDashboard(input: {
    groupId: string;
    academicYearId: string;
    term: Term;
    dataSource?: import('../types/classManagement').SubjectGroupDataSource;
    sourceId?: string | null;
  }): Promise<import('../types/classManagement').SubjectGroupPortraitDashboard> {
    const q = new URLSearchParams({
      academicYearId: input.academicYearId,
      term: input.term,
      dataSource: input.dataSource ?? 'report',
    });
    if (input.sourceId?.trim()) q.set('sourceId', input.sourceId.trim());
    const response = await fetch(
      apiUrl(
        `/api/classes/teacher-portrait/subject-groups/${encodeURIComponent(input.groupId)}/dashboard?${q.toString()}`,
      ),
      { headers: getHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to fetch subject group dashboard');
    }
    const data = await readJsonOrThrow(response, 'Failed to fetch subject group dashboard');
    return (data as { dashboard: import('../types/classManagement').SubjectGroupPortraitDashboard }).dashboard;
  },
};

export { USE_CLOUD_STORAGE };
