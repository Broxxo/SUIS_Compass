import { Course, SemesterData } from '../types';
import { getCurrentUserId } from './authUtils';

// API 基础 URL，从环境变量获取，如果没有则使用默认值
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// 是否使用云端存储
const USE_CLOUD_STORAGE = import.meta.env.VITE_USE_CLOUD_STORAGE === 'true';

/**
 * 获取请求头
 */
function getHeaders(): HeadersInit {
  const userId = getCurrentUserId();
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
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
      const baseUrl = API_BASE_URL.replace('/api', '');
      const response = await fetch(`${baseUrl}/health`, { method: 'GET' });
      return response.ok;
    } catch (error) {
      // API health check failed (non-critical)
      return false;
    }
  },

  /**
   * 认证 API
   */
  async login(username: string, password: string) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
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
    const response = await fetch(`${API_BASE_URL}/auth/user`, {
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
    const response = await fetch(`${API_BASE_URL}/courses`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) return [];
      throw new Error('Failed to fetch courses');
    }
    return response.json();
  },

  async createCourse(course: Omit<Course, 'id'> & { id?: string }): Promise<Course> {
    const courseData = {
      id: course.id || `course-${Date.now()}`,
      ...course,
    };
    const response = await fetch(`${API_BASE_URL}/courses`, {
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
    const response = await fetch(`${API_BASE_URL}/courses/${id}`, {
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
    const response = await fetch(`${API_BASE_URL}/courses/${id}`, {
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
      `${API_BASE_URL}/semester/${courseId}/${grade}/${semester}`,
      { headers: getHeaders() }
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Failed to fetch semester data');
    }
    return response.json();
  },

  async saveSemesterData(semesterData: SemesterData): Promise<SemesterData> {
    const response = await fetch(`${API_BASE_URL}/semester`, {
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
      `${API_BASE_URL}/semester/${courseId}/${grade}/${semester}`,
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
};

/**
 * 导出是否使用云端存储的标志
 */
export { USE_CLOUD_STORAGE };
