import type { Course, SemesterData, User } from '../types';
import type {
  AcademicYear,
  ClassItem,
  Student,
  Enrollment,
  ClassGroupScheme,
  ClassGroup,
  ClassGroupMembership,
  ClassPointEvent,
} from '../types/classManagement';
import { getCurrentUserId, getToken } from './authUtils';

// 同源部署时为空，开发时可设为 VITE_API_URL（如 http://localhost:8080/api）
const API_BASE_URL = (import.meta.env.VITE_API_URL as string) ?? '';
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
  const base = API_BASE_URL.replace(/\/$/, '');
  return base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : path.startsWith('/') ? path : `/${path}`;
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

  /**
   * 管理员 API：仅 admin 账号可用
   */
  async getAllUsers(): Promise<(User & { createdAt?: string; password?: string | null; department?: string | null })[]> {
    const response = await fetch(apiUrl('/api/admin/users'), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => 'Failed to fetch users');
      throw new Error(text || 'Failed to fetch users');
    }
    const data = await response.json();
    return (data.users ?? []) as (User & { createdAt?: string; password?: string | null; department?: string | null })[];
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

  async updateStudent(studentId: string, patch: Partial<Pick<Student, 'name' | 'gender' | 'grade' | 'studentNumber' | 'dateOfBirth'>>): Promise<Student> {
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

/**
 * 导出是否使用云端存储的标志
 */
export { USE_CLOUD_STORAGE };
