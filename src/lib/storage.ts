import { Course, SemesterData } from '../types';
import { STORAGE_KEYS } from './constants';
import { api, USE_CLOUD_STORAGE } from './api';
import { getCurrentUserId } from './authUtils';
import { logError, handleSilentError } from './errorHandler';

/**
 * 获取用户特定的存储键
 */
function getUserStorageKey(baseKey: string, userId: string | null): string {
  if (!userId) {
    // 如果没有用户ID，使用默认键（向后兼容）
    return baseKey;
  }
  return `${baseKey}-user-${userId}`;
}

/**
 * 获取学期数据的存储键
 */
export function getSemesterStorageKey(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): string {
  const userId = getCurrentUserId();
  const baseKey = `${STORAGE_KEYS.SEMESTER_PREFIX}${courseId}-${grade}-${semester}`;
  return getUserStorageKey(baseKey, userId);
}

/**
 * 保存课程列表到 localStorage 或云端
 */
export async function saveCourses(courses: Course[]): Promise<void> {
  // 总是先保存到本地（作为缓存）
  handleSilentError(() => {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.COURSES, userId);
    localStorage.setItem(key, JSON.stringify(courses));
  }, undefined);

  // 如果使用云端存储，同步到云端
  if (USE_CLOUD_STORAGE) {
    try {
      // 批量创建/更新课程
      for (const course of courses) {
        try {
          await api.updateCourse(course.id, course);
        } catch (error) {
          // 如果更新失败，尝试创建
          try {
            await api.createCourse(course);
          } catch (createError) {
            logError(`Failed to save course ${course.id} to cloud`, createError);
          }
        }
      }
    } catch (error) {
      logError('Failed to save courses to cloud', error);
    }
  }
}

/**
 * 从 localStorage 或云端加载课程列表
 */
export async function loadCourses(): Promise<Course[]> {
  // 如果使用云端存储，优先从云端加载
  if (USE_CLOUD_STORAGE) {
    try {
      const courses = await api.getCourses();
      // 同时保存到本地作为缓存
      handleSilentError(() => {
        const userId = getCurrentUserId();
        const key = getUserStorageKey(STORAGE_KEYS.COURSES, userId);
        localStorage.setItem(key, JSON.stringify(courses));
      }, undefined);
      return courses;
    } catch (error) {
      logError('Failed to load courses from cloud, falling back to local', error);
      // 如果云端加载失败，回退到本地
    }
  }

  // 从本地加载
  try {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.COURSES, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsedCourses = JSON.parse(stored);
      return parsedCourses;
    }
  } catch (error) {
    console.error('Failed to load courses from localStorage:', error);
  }
  return [];
}

/**
 * 同步版本（用于向后兼容，但会返回空数组，建议使用异步版本）
 */
export function loadCoursesSync(): Course[] {
  try {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.COURSES, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsedCourses = JSON.parse(stored);
      return parsedCourses;
    }
  } catch (error) {
    console.error('Failed to load courses from localStorage:', error);
  }
  return [];
}

/**
 * 保存学期数据到 localStorage 或云端
 */
export async function saveSemesterData(semesterData: SemesterData): Promise<void> {
  // 总是先保存到本地（作为缓存）
  try {
    const storageKey = getSemesterStorageKey(
      semesterData.courseId,
      semesterData.grade,
      semesterData.semester
    );
    localStorage.setItem(storageKey, JSON.stringify(semesterData));
  } catch (error) {
    // Failed to save semester data to localStorage (non-critical)
  }

  // 如果使用云端存储，同步到云端
  if (USE_CLOUD_STORAGE) {
    try {
      await api.saveSemesterData(semesterData);
    } catch (error) {
      logError('Failed to save semester data to cloud', error);
    }
  }
}

/**
 * 从 localStorage 或云端加载学期数据
 */
export async function loadSemesterData(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): Promise<SemesterData | null> {
  // 如果使用云端存储，优先从云端加载
  if (USE_CLOUD_STORAGE) {
    try {
      const data = await api.getSemesterData(courseId, grade, semester);
      // 同时保存到本地作为缓存
      if (data) {
        try {
          const storageKey = getSemesterStorageKey(courseId, grade, semester);
          localStorage.setItem(storageKey, JSON.stringify(data));
        } catch (error) {
          // Failed to cache semester data to localStorage (non-critical)
        }
      }
      return data;
    } catch (error) {
      logError('Failed to load semester data from cloud, falling back to local', error);
      // 如果云端加载失败，回退到本地
    }
  }

  // 从本地加载
  try {
    const storageKey = getSemesterStorageKey(courseId, grade, semester);
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logError('Failed to load semester data', error);
  }
  return null;
}

/**
 * 同步版本（用于向后兼容）
 */
export function loadSemesterDataSync(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): SemesterData | null {
  try {
    const storageKey = getSemesterStorageKey(courseId, grade, semester);
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logError('Failed to load semester data', error);
  }
  return null;
}

/**
 * 检查学期是否有单元数据（同步版本，用于向后兼容）
 */
export function hasSemesterUnits(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): boolean {
  const semesterData = loadSemesterDataSync(courseId, grade, semester);
  return semesterData !== null && semesterData.units && semesterData.units.length > 0;
}

/**
 * 加载课程类别排序（用于课程河流列顺序）
 */
export function loadCategoryOrder(): string[] {
  try {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.CATEGORY_ORDER, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    logError('Failed to load category order', error);
  }
  return [];
}

/**
 * 保存课程类别排序
 */
export function saveCategoryOrder(order: string[]): void {
  try {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.CATEGORY_ORDER, userId);
    localStorage.setItem(key, JSON.stringify(order));
  } catch (error) {
    logError('Failed to save category order', error);
  }
}

/**
 * 删除课程的所有学期数据
 */
export async function deleteCourseSemesterData(courseId: string): Promise<void> {
  const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const SEMESTERS: ('Semester 1' | 'Semester 2')[] = ['Semester 1', 'Semester 2'];
  
  for (const grade of GRADES) {
    for (const semester of SEMESTERS) {
      // 删除本地数据
      const storageKey = getSemesterStorageKey(courseId, grade, semester);
      try {
        localStorage.removeItem(storageKey);
      } catch (error) {
        logError(`Failed to delete semester data for ${storageKey}`, error);
      }

      // 如果使用云端存储，同时删除云端数据
      if (USE_CLOUD_STORAGE) {
        try {
          await api.deleteSemesterData(courseId, grade, semester);
        } catch (error) {
          logError(`Failed to delete semester data from cloud for ${courseId}-${grade}-${semester}`, error);
        }
      }
    }
  }
}

/**
 * 从 localStorage 加载关键概念列表
 */
export function loadKeyConcepts(): string[] {
  try {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.KEY_CONCEPTS, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    logError('Failed to load key concepts', error);
  }
  return [];
}

/**
 * 保存关键概念列表到 localStorage
 */
export function saveKeyConcepts(concepts: string[]): void {
  try {
    const userId = getCurrentUserId();
    const key = getUserStorageKey(STORAGE_KEYS.KEY_CONCEPTS, userId);
    localStorage.setItem(key, JSON.stringify(concepts));
  } catch (error) {
    logError('Failed to save key concepts', error);
  }
}

/**
 * 导出所有数据（课程、学期数据、概念、类别排序）
 */
export function exportAllDataSync(): {
  courses: Course[];
  semesterData: Record<string, SemesterData>;
  keyConcepts: string[];
  categoryOrder: string[];
  exportDate: string;
  version: string;
} {
  const courses = loadCoursesSync();
  const keyConcepts = loadKeyConcepts();
  const categoryOrder = loadCategoryOrder();
  
  // 收集所有学期数据
  const semesterData: Record<string, SemesterData> = {};
  const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const SEMESTERS: ('Semester 1' | 'Semester 2')[] = ['Semester 1', 'Semester 2'];
  
  courses.forEach(course => {
    GRADES.forEach(grade => {
      SEMESTERS.forEach(semester => {
        const data = loadSemesterDataSync(course.id, grade, semester);
        if (data) {
          const key = getSemesterStorageKey(course.id, grade, semester);
          semesterData[key] = data;
        }
      });
    });
  });
  
  return {
    courses,
    semesterData,
    keyConcepts,
    categoryOrder,
    exportDate: new Date().toISOString(),
    version: '1.0'
  };
}

/**
 * 导入所有数据（会覆盖现有数据）
 */
export function importAllData(data: {
  courses?: Course[];
  semesterData?: Record<string, SemesterData>;
  keyConcepts?: string[];
  categoryOrder?: string[];
}): { success: boolean; error?: string } {
  try {
    // 导入课程
    if (data.courses && Array.isArray(data.courses)) {
      saveCourses(data.courses);
    }
    
    // 导入学期数据
    // 注意：导出的键可能包含旧的格式（没有用户ID），需要转换为当前用户的键
    if (data.semesterData && typeof data.semesterData === 'object') {
      Object.entries(data.semesterData).forEach(([oldKey, semesterData]) => {
        try {
          // 使用 saveSemesterData 函数，它会自动使用当前用户的存储键
          // 这样无论导出的键是什么格式，都能正确保存到当前用户的数据中
          saveSemesterData(semesterData);
        } catch (error) {
          logError(`Failed to import semester data for ${oldKey}`, error);
        }
      });
    }
    
    // 导入概念
    if (data.keyConcepts && Array.isArray(data.keyConcepts)) {
      saveKeyConcepts(data.keyConcepts);
    }
    
    // 导入类别排序
    if (data.categoryOrder && Array.isArray(data.categoryOrder)) {
      saveCategoryOrder(data.categoryOrder);
    }
    
    return { success: true };
  } catch (error) {
    logError('Failed to import data', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
