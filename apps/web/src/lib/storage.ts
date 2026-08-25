import type { CourseDomainsConfig } from '@repo/shared';
import { normalizeCourseDomainsConfig } from '@repo/shared';
import { Course, GradeConfig, SemesterData, Unit } from '../types';
import { STORAGE_KEYS } from './constants';
import { api, USE_CLOUD_STORAGE } from './api';
import { getCurrentUserId } from './authUtils';
import { logError, handleSilentError } from './errorHandler';
import { DEFAULT_GRADE_CONFIG } from './constants';
import { normalizeGradeConfig } from './gradeConfig';
import { migrateCoursesData } from './courseUtils';

/**
 * 获取学期数据的存储键（课程河流现为全校共享，使用全局 key，不再按用户隔离）
 */
export function getSemesterStorageKey(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): string {
  const baseKey = `${STORAGE_KEYS.SEMESTER_PREFIX}${courseId}-${grade}-${semester}`;
  return baseKey;
}

function normalizeUnit(raw: unknown): Unit | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Partial<Unit>;
  const id = String(u.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    title: String(u.title ?? ''),
    focus: String(u.focus ?? ''),
    keyConcepts: Array.isArray(u.keyConcepts) ? u.keyConcepts.map(String) : [],
    week: String(u.week ?? ''),
    periods: typeof u.periods === 'number' && Number.isFinite(u.periods) ? u.periods : 0,
    order: typeof u.order === 'number' && Number.isFinite(u.order) ? u.order : 0,
  };
}

/** 云端/旧缓存学期数据可能缺 units 或 keyConcepts，读时一律补齐，避免格子着色与弹窗白屏 */
export function normalizeSemesterData(data: SemesterData | null | undefined): SemesterData | null {
  if (!data) return null;
  const units = Array.isArray(data.units)
    ? data.units.map(normalizeUnit).filter((u): u is Unit => u !== null)
    : [];
  return {
    courseId: data.courseId,
    grade: data.grade,
    semester: data.semester,
    units,
  };
}

/** 课程 id 因 409 被替换时的映射，供导入时更新学期数据的 courseId */
export type SaveCoursesResult = { idReplacements: { oldId: string; newId: string }[] };

/**
 * 保存课程列表到 localStorage 或云端
 */
export async function saveCourses(courses: Course[]): Promise<SaveCoursesResult> {
  const idReplacements: { oldId: string; newId: string }[] = [];
  // 总是先保存到本地（作为缓存）
  const key = STORAGE_KEYS.COURSES; // 课程全局共享，不再按用户隔离
  
  // 确保本地写入总是执行（即使后续云端操作失败）
  try {
    localStorage.setItem(key, JSON.stringify(courses));
    if (import.meta.env.DEV) {
      console.log(`[Storage] Saved ${courses.length} courses to local key: ${key}`);
    }
  } catch (error) {
    logError(`Failed to save courses to localStorage (key: ${key})`, error);
    // 本地写入失败是严重错误，应该抛出
    throw error;
  }

  // 全校共享课程：同步到云端（需已登录且具备写权限）
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      if (import.meta.env.DEV) {
        console.log(`[Cloud Storage] Saving ${courses.length} courses to cloud...`);
      }

      let cloudCourseIds: Set<string> = new Set();
      try {
        const cloudCourses = await api.getCourses();
        cloudCourseIds = new Set(cloudCourses.map((c) => c.id));
        const localCourseIds = new Set(courses.map((c) => c.id));

        for (const cloudCourse of cloudCourses) {
          if (!localCourseIds.has(cloudCourse.id)) {
            try {
              await api.deleteCourse(cloudCourse.id);
            } catch (deleteError) {
              logError(`Failed to delete course ${cloudCourse.id} from cloud`, deleteError);
            }
          }
        }
      } catch (fetchError) {
        logError('Failed to fetch cloud courses for sync check', fetchError);
      }

      for (const course of courses) {
        try {
          if (cloudCourseIds.has(course.id)) {
            await api.updateCourse(course.id, course);
          } else {
            await api.createCourse(course);
          }
        } catch (error) {
          logError(`Failed to save course ${course.id} to cloud`, error);
        }
      }
      if (import.meta.env.DEV) {
        console.log(`[Cloud Storage] Successfully saved all courses to cloud`);
      }
    } catch (error) {
      logError('Failed to save courses to cloud', error);
    }
  }
  return { idReplacements };
}

/**
 * 从 localStorage 或云端加载课程列表
 */
export async function loadCourses(): Promise<Course[]> {
  // 先读取本地缓存（用于后续比较）
  let localCourses: Course[] = [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.COURSES);
    if (stored) {
      localCourses = JSON.parse(stored);
    }
  } catch (error) {
    // 忽略本地读取错误
  }

  // 如果使用云端存储，优先从云端加载（带超时，避免部分设备/网络下一直 loading；无 userId 时直接用本地）
  const CLOUD_LOAD_TIMEOUT_MS = 12000;
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      if (import.meta.env.DEV) {
        console.log('[Cloud Storage] Loading courses from cloud...');
      }
      const cloudCourses = await Promise.race([
        api.getCourses(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Cloud load timeout')), CLOUD_LOAD_TIMEOUT_MS)
        ),
      ]);
      // 每次刷新以数据库为准：用云端结果覆盖本地，数据库没有的从本地清除
      try {
        localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(cloudCourses));
      } catch (e) {
        logError('Failed to write courses cache to localStorage', e);
      }
      return cloudCourses;
    } catch (error) {
      logError('Failed to load courses from cloud, falling back to local', error);
      // 如果云端加载失败，回退到本地
    }
  }

  // 从本地加载（如果没有使用云端存储，或云端加载失败）
  return localCourses.length > 0 ? localCourses : [];
}

/**
 * 同步版本（用于向后兼容，但会返回空数组，建议使用异步版本）
 * 课程河流全局共享，使用全局 key 与 loadCourses/saveCourses 一致
 */
export function loadCoursesSync(): Course[] {
  try {
    const key = STORAGE_KEYS.COURSES;
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

  // 如果使用云端存储，同步到云端（无 userId 时跳过，保证多用户隔离）
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
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
  // 如果使用云端存储，优先从云端加载（无 userId 时直接用本地）
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const data = normalizeSemesterData(await api.getSemesterData(courseId, grade, semester));
      if (data) {
        // 同时保存到本地作为缓存
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
      return normalizeSemesterData(JSON.parse(stored) as SemesterData);
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
      return normalizeSemesterData(JSON.parse(stored) as SemesterData);
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
 * 从本地缓存读取学科列顺序（云端模式下由 hydrateCategoryOrderFromCloud / saveCategoryOrder 维护与 DB 一致）
 */
export function loadCategoryOrder(): string[] {
  try {
    const key = STORAGE_KEYS.CATEGORY_ORDER;
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

function saveCategoryOrderLocal(order: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDER, JSON.stringify(order));
  } catch (error) {
    logError('Failed to save category order to localStorage', error);
  }
}

/**
 * 从云端拉取学科列顺序并写入本地缓存；未启用云端或未登录时返回本地已有顺序。
 */
export async function hydrateCategoryOrderFromCloud(): Promise<string[]> {
  if (!USE_CLOUD_STORAGE || !getCurrentUserId()) {
    return loadCategoryOrder();
  }
  try {
    const order = await api.getCategoryOrder();
    const arr = Array.isArray(order) ? order : [];
    saveCategoryOrderLocal(arr);
    return arr;
  } catch (error) {
    logError('Failed to hydrate category order from cloud', error);
    return loadCategoryOrder();
  }
}

/**
 * 保存学科列顺序：始终写本地；云端模式下同步到数据库（仅 admin / system-admin 可调顺序，由 API 校验）
 */
export async function saveCategoryOrder(order: string[]): Promise<void> {
  saveCategoryOrderLocal(order);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.putCategoryOrder(order);
    } catch (error) {
      logError('Failed to save category order to cloud', error);
      throw error;
    }
  }
}

export function loadCourseDomainsSync(): CourseDomainsConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.COURSE_DOMAINS);
    if (stored) {
      return normalizeCourseDomainsConfig(JSON.parse(stored));
    }
  } catch (error) {
    logError('Failed to load course domains', error);
  }
  return { domains: [], domainOrder: [] };
}

function saveCourseDomainsLocal(config: CourseDomainsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.COURSE_DOMAINS, JSON.stringify(config));
  } catch (error) {
    logError('Failed to save course domains to localStorage', error);
  }
}

export async function hydrateCourseDomainsFromCloud(): Promise<CourseDomainsConfig> {
  if (!USE_CLOUD_STORAGE || !getCurrentUserId()) {
    return loadCourseDomainsSync();
  }
  try {
    const config = await api.getCourseDomains();
    const normalized = normalizeCourseDomainsConfig(config);
    saveCourseDomainsLocal(normalized);
    return normalized;
  } catch (error) {
    logError('Failed to hydrate course domains from cloud', error);
    return loadCourseDomainsSync();
  }
}

export async function saveCourseDomains(config: CourseDomainsConfig): Promise<void> {
  const normalized = normalizeCourseDomainsConfig(config);
  saveCourseDomainsLocal(normalized);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.putCourseDomains(normalized);
    } catch (error) {
      logError('Failed to save course domains to cloud', error);
      throw error;
    }
  }
}

function migrateLocalSchoolGradeStructureKey(): void {
  try {
    const newKey = STORAGE_KEYS.SCHOOL_GRADE_STRUCTURE;
    if (localStorage.getItem(newKey)) return;
    const legacy = localStorage.getItem(STORAGE_KEYS.GRADE_CONFIG_LEGACY);
    if (legacy) localStorage.setItem(newKey, legacy);
  } catch {
    /* ignore migration errors */
  }
}

/**
 * 学校学段与年级结构（全校共享，存于 school_settings）
 */
export function loadGradeConfigSync(): GradeConfig {
  migrateLocalSchoolGradeStructureKey();
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SCHOOL_GRADE_STRUCTURE);
    if (!stored) return DEFAULT_GRADE_CONFIG;
    return normalizeGradeConfig(JSON.parse(stored));
  } catch (error) {
    logError('Failed to load school grade structure', error);
    return DEFAULT_GRADE_CONFIG;
  }
}

export async function loadGradeConfig(): Promise<GradeConfig> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const fromCloud = normalizeGradeConfig(await api.getSchoolGradeStructure());
      localStorage.setItem(STORAGE_KEYS.SCHOOL_GRADE_STRUCTURE, JSON.stringify(fromCloud));
      return fromCloud;
    } catch (error) {
      logError('Failed to load school grade structure from cloud, falling back to local', error);
    }
  }
  return loadGradeConfigSync();
}

export async function saveGradeConfig(config: GradeConfig): Promise<GradeConfig> {
  const normalized = normalizeGradeConfig(config);
  try {
    localStorage.setItem(STORAGE_KEYS.SCHOOL_GRADE_STRUCTURE, JSON.stringify(normalized));
  } catch (error) {
    logError('Failed to save school grade structure to localStorage', error);
    throw error;
  }
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const saved = normalizeGradeConfig(await api.putSchoolGradeStructure(normalized));
      localStorage.setItem(STORAGE_KEYS.SCHOOL_GRADE_STRUCTURE, JSON.stringify(saved));
      return saved;
    } catch (error) {
      logError('Failed to save school grade structure to cloud', error);
    }
  }
  return normalized;
}

/**
 * 删除课程（包括课程本身和所有学期数据）
 */
export async function deleteCourse(courseId: string): Promise<void> {
  // 删除所有相关的学期数据
  await deleteCourseSemesterData(courseId);

  // 如果使用云端存储，删除云端课程（无 userId 时跳过）
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      if (import.meta.env.DEV) {
        console.log(`[Cloud Storage] Deleting course ${courseId} from cloud...`);
      }
      await api.deleteCourse(courseId);
      if (import.meta.env.DEV) {
        console.log(`[Cloud Storage] Successfully deleted course from cloud`);
      }
    } catch (error) {
      logError(`Failed to delete course ${courseId} from cloud`, error);
      throw error; // 重新抛出错误，让调用者知道删除失败
    }
  }

  // 从本地存储中删除课程（通过重新加载课程列表实现）
  // 注意：这里不直接删除localStorage，因为删除操作应该通过更新课程列表来实现
}

/**
 * 删除课程的所有学期数据
 */
export async function deleteCourseSemesterData(courseId: string): Promise<void> {
  const GRADES = loadGradeConfigSync().items.map((item) => item.level);
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

      // 如果使用云端存储，同时删除云端数据（无 userId 时跳过）
      if (USE_CLOUD_STORAGE && getCurrentUserId()) {
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
 * 从 localStorage 或云端加载关键概念列表
 */
export async function loadKeyConcepts(): Promise<string[]> {
  // 如果使用云端存储，优先从云端加载（无 userId 时直接用本地）
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      if (import.meta.env.DEV) {
        console.log('[Cloud Storage] Loading key concepts from cloud...');
      }
      const keyConcepts = await api.getKeyConcepts();
      // 与 API 一致：全校共享列表，本地用全局键缓存
      handleSilentError(() => {
        localStorage.setItem(STORAGE_KEYS.KEY_CONCEPTS, JSON.stringify(keyConcepts));
      }, undefined);
      return keyConcepts;
    } catch (error) {
      logError('Failed to load key concepts from cloud, falling back to local', error);
      // 如果云端加载失败，回退到本地
    }
  }

  // 从本地加载（全局键，与云端全校列表一致）
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.KEY_CONCEPTS);
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
 * 同步版本（用于向后兼容）
 */
export function loadKeyConceptsSync(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.KEY_CONCEPTS);
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
 * 保存关键概念列表到 localStorage 或云端
 */
export async function saveKeyConcepts(concepts: string[]): Promise<void> {
  // 总是先保存到本地（作为缓存，全局键）
  try {
    localStorage.setItem(STORAGE_KEYS.KEY_CONCEPTS, JSON.stringify(concepts));
  } catch (error) {
    logError('Failed to save key concepts to localStorage', error);
    throw error;
  }

  // 如果使用云端存储，同步到云端（无 userId 时跳过）
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      if (import.meta.env.DEV) {
        console.log(`[Cloud Storage] Saving ${concepts.length} key concepts to cloud...`);
      }
      await api.saveKeyConcepts(concepts);
      if (import.meta.env.DEV) {
        console.log(`[Cloud Storage] Successfully saved key concepts to cloud`);
      }
    } catch (error) {
      logError('Failed to save key concepts to cloud', error);
    }
  }
}

/**
 * 将课程管理导出数据写入本地缓存（导出/导入后保持与数据库一致）
 */
export function cacheCurriculumDataLocally(data: {
  courses?: Course[];
  semesterData?: Record<string, SemesterData>;
  keyConcepts?: string[];
  categoryOrder?: string[];
  courseDomains?: CourseDomainsConfig;
  gradeConfig?: GradeConfig;
}): void {
  try {
    if (data.courses) {
      localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(data.courses));
    }
    if (data.keyConcepts) {
      localStorage.setItem(STORAGE_KEYS.KEY_CONCEPTS, JSON.stringify(data.keyConcepts));
    }
    if (data.categoryOrder) {
      localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDER, JSON.stringify(data.categoryOrder));
    }
    if (data.courseDomains) {
      localStorage.setItem(STORAGE_KEYS.COURSE_DOMAINS, JSON.stringify(normalizeCourseDomainsConfig(data.courseDomains)));
    }
    if (data.gradeConfig) {
      localStorage.setItem(STORAGE_KEYS.SCHOOL_GRADE_STRUCTURE, JSON.stringify(normalizeGradeConfig(data.gradeConfig)));
    }
    if (data.semesterData) {
      for (const [key, semesterData] of Object.entries(data.semesterData)) {
        const normalized = normalizeSemesterData(semesterData);
        if (!normalized) continue;
        const storageKey = key.startsWith(STORAGE_KEYS.SEMESTER_PREFIX)
          ? key
          : getSemesterStorageKey(normalized.courseId, normalized.grade, normalized.semester);
        localStorage.setItem(storageKey, JSON.stringify(normalized));
      }
    }
  } catch (error) {
    logError('Failed to cache curriculum data locally', error);
  }
}

/**
 * 新设备 / 无本地学期缓存时：一次拉全校课程河流学期数据并写入 localStorage，供格子着色与单元视图使用。
 */
export async function hydrateSemesterCacheFromCloud(): Promise<number> {
  if (!USE_CLOUD_STORAGE || !getCurrentUserId()) {
    return 0;
  }
  const data = await api.exportCurriculumData();
  const semesterData = data.semesterData ?? {};
  cacheCurriculumDataLocally({ semesterData });
  return Object.keys(semesterData).length;
}

/**
 * 导出所有数据（课程、学期数据、概念、类别排序）
 * 云端模式：从数据库全量拉取；本地模式：读取 localStorage 缓存
 */
export async function exportAllData(): Promise<{
  courses: Course[];
  semesterData: Record<string, SemesterData>;
  keyConcepts: string[];
  categoryOrder: string[];
  courseDomains: CourseDomainsConfig;
  gradeConfig: GradeConfig;
  exportDate: string;
  version: string;
  source?: 'database' | 'local';
}> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    const data = await api.exportCurriculumData();
    cacheCurriculumDataLocally(data);
    return { ...data, source: 'database' };
  }
  return { ...exportAllDataSync(), source: 'local' };
}

/**
 * 导出所有数据（同步，仅读 localStorage；云端模式请使用 exportAllData）
 */
export function exportAllDataSync(): {
  courses: Course[];
  semesterData: Record<string, SemesterData>;
  keyConcepts: string[];
  categoryOrder: string[];
  courseDomains: CourseDomainsConfig;
  gradeConfig: GradeConfig;
  exportDate: string;
  version: string;
} {
  const courses = loadCoursesSync();
  const keyConcepts = loadKeyConceptsSync();
  const categoryOrder = loadCategoryOrder();
  const courseDomains = loadCourseDomainsSync();
  const gradeConfig = loadGradeConfigSync();
  
  // 收集所有学期数据
  const semesterData: Record<string, SemesterData> = {};
  const gradeLevels = gradeConfig.items.map((item) => item.level);
  const SEMESTERS: ('Semester 1' | 'Semester 2')[] = ['Semester 1', 'Semester 2'];
  
  courses.forEach(course => {
    gradeLevels.forEach(grade => {
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
    courseDomains,
    gradeConfig,
    exportDate: new Date().toISOString(),
    version: '1.1',
  };
}

/**
 * 验证导入的数据是否成功持久化
 */
function verifyImportPersistence<T>(
  expected: T[],
  actual: T[],
  dataType: string,
  expectedKey?: string
): { success: boolean; error?: string } {
  if (expected.length > 0 && actual.length === 0) {
    const keyInfo = expectedKey ? ` Expected key: ${expectedKey}.` : '';
    return {
      success: false,
      error: `Import verification failed: ${dataType} were not persisted.${keyInfo} Please check browser storage permissions (localStorage) and try again.`,
    };
  }
  return { success: true };
}

/**
 * 从课程列表中提取并生成类别排序
 */
function generateCategoryOrderFromCourses(courses: Course[]): string[] {
  const uniq: string[] = [];
  courses.forEach((c) => {
    const cat = (typeof c.subjectCategory === 'object' && c.subjectCategory?.zh)
      ? c.subjectCategory.zh
      : (typeof c.subjectCategory === 'string' ? c.subjectCategory : '');
    const key = cat || c.name;
    if (key && !uniq.includes(key)) uniq.push(key);
  });
  return uniq;
}

/**
 * 导入课程数据（会覆盖现有全校课程数据）
 */
export async function importAllData(data: {
  courses?: Course[];
  semesterData?: Record<string, SemesterData>;
  keyConcepts?: string[];
  categoryOrder?: string[];
  courseDomains?: CourseDomainsConfig;
  gradeConfig?: GradeConfig;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // 兼容旧/不同导出结构：有些版本会把真实数据包在 { data: ... } 里
    const normalized: {
      courses?: Course[];
      semesterData?: Record<string, SemesterData>;
      keyConcepts?: string[];
      categoryOrder?: string[];
      courseDomains?: CourseDomainsConfig;
      gradeConfig?: GradeConfig;
    } =
      data && typeof data === 'object' && 'data' in (data as any) && (data as any).data && typeof (data as any).data === 'object'
        ? (data as any).data
        : data;

    const hasRecognizableFields =
      (normalized.courses && Array.isArray(normalized.courses)) ||
      (normalized.semesterData && typeof normalized.semesterData === 'object') ||
      (normalized.keyConcepts && Array.isArray(normalized.keyConcepts)) ||
      (normalized.categoryOrder && Array.isArray(normalized.categoryOrder)) ||
      normalized.courseDomains != null ||
      normalized.gradeConfig != null;

    if (!hasRecognizableFields) {
      return {
        success: false,
        error:
          'Invalid import file: no recognizable fields (expected courses / semesterData / keyConcepts / categoryOrder / gradeConfig).',
      };
    }

    // 云端模式：直接写入数据库，成功后同步本地缓存
    if (USE_CLOUD_STORAGE && getCurrentUserId()) {
      try {
        await api.importCurriculumData(normalized);
        cacheCurriculumDataLocally(normalized);
        return { success: true };
      } catch (err) {
        logError('Cloud curriculum import failed', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : '云端导入失败，请检查网络与权限后重试。',
        };
      }
    }

    let didImportAnything = false;

    // 导入课程：先写本地并同步云端，再校验云端已有数据，才允许“成功并刷新”（刷新后会从数据库重读）
    let courseIdReplacementMap = new Map<string, string>();
    if (normalized.courses && Array.isArray(normalized.courses)) {
      didImportAnything = true;
      const migratedCourses = migrateCoursesData(normalized.courses);
      const saveResult = await saveCourses(migratedCourses);
      saveResult.idReplacements.forEach(({ oldId, newId }) => courseIdReplacementMap.set(oldId, newId));

      const verifyLocal = loadCoursesSync();
      if (migratedCourses.length > 0 && verifyLocal.length === 0) {
        const expectedKey = STORAGE_KEYS.COURSES;
        return {
          success: false,
          error: `导入校验失败：课程未写入本地。请检查存储权限。key: ${expectedKey}`,
        };
      }
      // 校验云端：只有数据库里已有导入的课程，才返回成功，刷新后 loadCourses 从数据库读取才能看到
      if (USE_CLOUD_STORAGE && getCurrentUserId() && migratedCourses.length > 0) {
        try {
          const cloudCourses = await api.getCourses();
          const cloudIds = new Set(cloudCourses.map((c) => c.id));
          const missing = migratedCourses.filter((c) => !cloudIds.has(c.id));
          if (missing.length > 0) {
            return {
              success: false,
              error: `云端同步未完成（${missing.length} 门课程未出现在数据库中），请检查网络后重试。`,
            };
          }
        } catch (err) {
          logError('Import cloud verification failed', err);
          return {
            success: false,
            error: `无法校验云端数据：${err instanceof Error ? err.message : '网络或服务器错误'}。请稍后重试。`,
          };
        }
      }
      if (import.meta.env.DEV) {
        console.log(`[Import] Verified: ${verifyLocal.length} courses (local and cloud)`);
      }
    }
    
    // 导入学期数据（若课程因 409 换了新 id，用新 id 保存学期数据）
    if (normalized.semesterData && typeof normalized.semesterData === 'object') {
      const savePromises = Object.entries(normalized.semesterData).map(async ([oldKey, semesterData]) => {
        try {
          didImportAnything = true;
          const courseId = courseIdReplacementMap.get(semesterData.courseId) ?? semesterData.courseId;
          await saveSemesterData({ ...semesterData, courseId });
        } catch (error) {
          logError(`Failed to import semester data for ${oldKey}`, error);
        }
      });
      await Promise.all(savePromises);
    }
    
    // 导入概念（异步，确保云端保存完成）
    if (normalized.keyConcepts && Array.isArray(normalized.keyConcepts)) {
      didImportAnything = true;
      try {
        await saveKeyConcepts(normalized.keyConcepts);
      } catch (error) {
        logError('Failed to save key concepts during import', error);
        return {
          success: false,
          error: `Failed to save key concepts: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
      // 立刻校验：避免"提示成功但实际没写入"
      const verifyConcepts = loadKeyConceptsSync();
      const verification = verifyImportPersistence(normalized.keyConcepts, verifyConcepts, 'key concepts');
      if (!verification.success) {
        return verification;
      }
    }
    
    // 导入类别排序（云端会写库）
    if (normalized.categoryOrder && Array.isArray(normalized.categoryOrder)) {
      didImportAnything = true;
      await saveCategoryOrder(normalized.categoryOrder);
      const verification = verifyImportPersistence(normalized.categoryOrder, loadCategoryOrder(), 'category order');
      if (!verification.success) {
        return verification;
      }
    }

    if (normalized.courseDomains) {
      didImportAnything = true;
      await saveCourseDomains(normalized.courseDomains);
    }

    if (normalized.gradeConfig) {
      didImportAnything = true;
      await saveGradeConfig(normalized.gradeConfig);
    }

    // 如果导入到其他账号时 categoryOrder 为空/缺失，自动根据课程生成（避免主界面“看起来空白”）
    // 规则：用课程的 canonical 分类（优先 zh）去重，并按出现顺序排列
    const currentOrder = loadCategoryOrder();
    const currentCourses = loadCoursesSync();
    if (currentCourses.length > 0 && currentOrder.length === 0) {
      const generatedOrder = generateCategoryOrderFromCourses(currentCourses);
      if (generatedOrder.length > 0) {
        await saveCategoryOrder(generatedOrder);
      }
    }

    // 如果没有任何可识别的数据字段，直接判定为导入失败，避免“提示成功但实际为空”
    if (!didImportAnything) {
      return {
        success: false,
        error:
          'Invalid import file: no recognizable fields (expected courses / semesterData / keyConcepts / categoryOrder / gradeConfig).',
      };
    }
    
    return { success: true };
  } catch (error) {
    logError('Failed to import data', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
