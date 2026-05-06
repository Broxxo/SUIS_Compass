import type { Course, GradeConfig, SemesterData, User } from '../types';
import type {
  AcademicYear,
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
  ReportTemplateProgress,
  StaffingAssignment,
  ReportTemplateStatus,
  HomeroomCommentMode,
  EvaluationModuleType,
  ScoreVisibility,
  TargetLevel,
  Term,
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
    ...(token ? { Authorization: `Bearer ${token}` } : userId ? { 'X-User-Id': userId } : {}),
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

  async getGradeConfig(): Promise<GradeConfig> {
    const response = await fetch(apiUrl('/api/settings/grade-config'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Unauthorized');
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch grade config: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return data as GradeConfig;
  },

  async putGradeConfig(gradeConfig: GradeConfig): Promise<GradeConfig> {
    const response = await fetch(apiUrl('/api/settings/grade-config'), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ gradeConfig }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save grade config' }));
      throw new Error(error.error || 'Failed to save grade config');
    }
    const data = await response.json();
    return (data?.gradeConfig ?? gradeConfig) as GradeConfig;
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

  async createUser(input: { username: string; displayName?: string; role: User['role']; password: string; department?: string | null }): Promise<User & { createdAt?: string; password?: string | null; department?: string | null }> {
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
    return data.user as User & { createdAt?: string; password?: string | null; department?: string | null };
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

  async updateUserDepartment(userId: string, department: string | null): Promise<void> {
    const response = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ department }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to update department');
    }
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

  async getClasses(academicYearId: string): Promise<ClassItem[]> {
    const url = academicYearId
      ? apiUrl(`/api/classes?academicYearId=${encodeURIComponent(academicYearId)}`)
      : apiUrl('/api/classes');
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch classes');
    const data = await response.json();
    return (data.classes ?? data) as ClassItem[];
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
    }>;
  },

  async getStudentTermReportDetail(studentId: string, academicYearId: string, term: Term, templateId: string): Promise<StudentTermReport> {
    const response = await fetch(
      apiUrl(
        `/api/classes/reports/students/${encodeURIComponent(studentId)}/terms/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}/templates/${encodeURIComponent(templateId)}`
      ),
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch report detail');
    const data = await readJsonOrThrow(response, 'Failed to fetch report detail');
    return data.report as StudentTermReport;
  },

  async getReportTemplatesForTerm(academicYearId: string, term: Term): Promise<ReportTemplate[]> {
    const response = await fetch(
      apiUrl(`/api/classes/reports/templates/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}`),
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
      teacherComment?: string | null;
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

  async createAdminReportTemplate(input: { academicYearId: string; term: Term; title?: string | null; sourceTemplateId?: string | null }): Promise<ReportTemplate> {
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

  async upsertAdminReportTemplate(input: {
    templateId: string;
    title?: string | null;
    status: ReportTemplateStatus;
    homeroomCommentMode: HomeroomCommentMode;
    subjects: Array<{
      subjectNameZh: string;
      subjectNameEn: string;
      moduleType?: EvaluationModuleType;
      enableScore?: boolean;
      enableTeacherComment?: boolean;
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
  }): Promise<void> {
    const response = await fetch(
      apiUrl(`/api/admin/staffing/assignments/${encodeURIComponent(input.academicYearId)}/${encodeURIComponent(input.classId)}/${encodeURIComponent(input.subjectKey)}`),
      {
        method: 'DELETE',
        headers: getHeaders(),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Failed to remove staffing assignment');
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
};

export { USE_CLOUD_STORAGE };
