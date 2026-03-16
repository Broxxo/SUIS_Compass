/**
 * 班级管理数据：学年、班级、学生、学籍均为全校共享（本地与云端一致）。
 * 本地：localStorage 用同一套 key，不按用户隔离。
 * 云端：优先 API（接口本身全校共享），本地缓存也用同一套 key。
 */
import type { AcademicYear, ClassItem, Student, Enrollment } from '../types/classManagement';
import { STORAGE_KEYS } from './constants';
import { getCurrentUserId } from './authUtils';
import { api, USE_CLOUD_STORAGE } from './api';
import { logError } from './errorHandler';

/** 班级管理存储 key：始终全校共用，不按用户分（本地与服务器端一致） */
function getClassStorageKey(baseKey: string): string {
  return baseKey;
}

/** 本地模式下若共享 key 为空，从系统管理员旧 key 迁移一次，避免已有数据看不到 */
function migrateFromLegacyUserKeyIfNeeded(baseKey: string): void {
  if (USE_CLOUD_STORAGE) return;
  const sharedKey = baseKey;
  if (localStorage.getItem(sharedKey)) return;
  const legacyKey = `${baseKey}-user-admin-1`;
  const raw = localStorage.getItem(legacyKey);
  if (raw) {
    try {
      localStorage.setItem(sharedKey, raw);
    } catch (_) {}
  }
}

// ---------- 学年 ----------
export async function loadAcademicYears(): Promise<AcademicYear[]> {
  let list: AcademicYear[] = [];
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      list = await api.getAcademicYears();
      const key = getClassStorageKey(STORAGE_KEYS.ACADEMIC_YEARS);
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch (_) {}
    } catch (e) {
      logError('loadAcademicYears from cloud', e);
    }
  }
  if (list.length === 0) {
    try {
      migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.ACADEMIC_YEARS);
      const key = getClassStorageKey(STORAGE_KEYS.ACADEMIC_YEARS);
      const raw = localStorage.getItem(key);
      if (raw) list = JSON.parse(raw);
    } catch (e) {
      logError('loadAcademicYears from local', e);
    }
  }
  return sortAcademicYearsByYear(list);
}

export function loadAcademicYearsSync(): AcademicYear[] {
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.ACADEMIC_YEARS);
    const key = getClassStorageKey(STORAGE_KEYS.ACADEMIC_YEARS);
    const raw = localStorage.getItem(key);
    if (raw) return sortAcademicYearsByYear(JSON.parse(raw));
  } catch (_) {}
  return [];
}

/** 按年份排序学年（从早到晚），如 2023-2024、2024-2025 */
export function sortAcademicYearsByYear(years: AcademicYear[]): AcademicYear[] {
  const extractYear = (name: string): number => {
    const m = name.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : 9999;
  };
  return [...years].sort((a, b) => extractYear(a.name) - extractYear(b.name));
}

export async function saveAcademicYears(years: AcademicYear[]): Promise<void> {
  const key = getClassStorageKey(STORAGE_KEYS.ACADEMIC_YEARS);
  localStorage.setItem(key, JSON.stringify(years));
  // 云端无“全量保存学年”接口，仅本地持久化；创建单条用 createAcademicYear
}

export function getCurrentAcademicYearId(): string | null {
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.CURRENT_ACADEMIC_YEAR_ID);
    const key = getClassStorageKey(STORAGE_KEYS.CURRENT_ACADEMIC_YEAR_ID);
    return localStorage.getItem(key);
  } catch (_) {}
  return null;
}

export async function loadCurrentAcademicYearId(): Promise<string | null> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const current = await api.getCurrentAcademicYear();
      if (current?.id) {
        const key = getClassStorageKey(STORAGE_KEYS.CURRENT_ACADEMIC_YEAR_ID);
        localStorage.setItem(key, current.id);
        return current.id;
      }
    } catch (e) {
      logError('loadCurrentAcademicYearId from cloud', e);
    }
  }
  return getCurrentAcademicYearId();
}

export function setCurrentAcademicYearId(id: string | null): void {
  const key = getClassStorageKey(STORAGE_KEYS.CURRENT_ACADEMIC_YEAR_ID);
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
}

export async function setCurrentAcademicYearIdAndSync(id: string | null): Promise<void> {
  setCurrentAcademicYearId(id);
  if (USE_CLOUD_STORAGE && getCurrentUserId() && id) {
    try {
      await api.setCurrentAcademicYear(id);
    } catch (e) {
      logError('setCurrentAcademicYear to cloud', e);
    }
  }
}

// ---------- 班级 ----------
export async function loadClasses(academicYearId: string): Promise<ClassItem[]> {
  const all = await loadAllClasses();
  return all.filter((c) => c.academicYearId === academicYearId);
}

export function loadClassesSync(academicYearId: string): ClassItem[] {
  const all = loadAllClassesSync();
  return all.filter((c) => c.academicYearId === academicYearId);
}

export function loadAllClassesSync(): ClassItem[] {
  migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.CLASSES);
  const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

export async function loadAllClasses(): Promise<ClassItem[]> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const list = await api.getClasses('');
      const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
      localStorage.setItem(key, JSON.stringify(list));
      return list;
    } catch (e) {
      logError('loadAllClasses from cloud', e);
    }
  }
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.CLASSES);
    const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveAllClassesLocal(classes: ClassItem[]): void {
  const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
  localStorage.setItem(key, JSON.stringify(classes));
}

// ---------- 学生 ----------
export async function loadStudents(): Promise<Student[]> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const list = await api.getStudents();
      const key = getClassStorageKey(STORAGE_KEYS.STUDENTS);
      localStorage.setItem(key, JSON.stringify(list));
      return list;
    } catch (e) {
      logError('loadStudents from cloud', e);
    }
  }
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.STUDENTS);
    const key = getClassStorageKey(STORAGE_KEYS.STUDENTS);
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

export function loadStudentsSync(): Student[] {
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.STUDENTS);
    const key = getClassStorageKey(STORAGE_KEYS.STUDENTS);
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveAllStudentsLocal(students: Student[]): void {
  const key = getClassStorageKey(STORAGE_KEYS.STUDENTS);
  localStorage.setItem(key, JSON.stringify(students));
}

// ---------- 学籍 ----------
export async function loadEnrollments(academicYearId?: string): Promise<Enrollment[]> {
  const all = await loadAllEnrollments();
  if (academicYearId) return all.filter((e) => e.academicYearId === academicYearId);
  return all;
}

export function loadEnrollmentsSync(academicYearId?: string): Enrollment[] {
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.ENROLLMENTS);
    const key = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
    const raw = localStorage.getItem(key);
    if (raw) {
      const all: Enrollment[] = JSON.parse(raw);
      if (academicYearId) return all.filter((e) => e.academicYearId === academicYearId);
      return all;
    }
  } catch (_) {}
  return [];
}

async function loadAllEnrollments(): Promise<Enrollment[]> {
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      const list = await api.getEnrollments();
      const key = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
      localStorage.setItem(key, JSON.stringify(list));
      return list;
    } catch (e) {
      logError('loadAllEnrollments from cloud', e);
    }
  }
  try {
    migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.ENROLLMENTS);
    const key = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveAllEnrollmentsLocal(enrollments: Enrollment[]): void {
  const key = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
  localStorage.setItem(key, JSON.stringify(enrollments));
}

// ---------- 创建/删除（统一走本地 + 可选云端） ----------
export async function createAcademicYear(year: AcademicYear): Promise<AcademicYear> {
  const years = loadAcademicYearsSync();
  years.push(year);
  await saveAcademicYears(years);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      return await api.createAcademicYear(year);
    } catch (e) {
      logError('createAcademicYear to cloud', e);
    }
  }
  return year;
}

export async function deleteAcademicYear(academicYearId: string): Promise<void> {
  const years = loadAcademicYearsSync().filter((y) => y.id !== academicYearId);
  await saveAcademicYears(years);
  if (getCurrentAcademicYearId() === academicYearId) {
    setCurrentAcademicYearId(years.length > 0 ? years[0].id : null);
    if (USE_CLOUD_STORAGE && getCurrentUserId()) {
      try {
        if (years.length > 0) await api.setCurrentAcademicYear(years[0].id);
      } catch (e) {
        logError('setCurrentAcademicYear after delete', e);
      }
    }
  }
  const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
  let allClasses: ClassItem[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) allClasses = JSON.parse(raw);
  } catch (_) {}
  const toRemove = allClasses.filter((c) => c.academicYearId === academicYearId).map((c) => c.id);
  allClasses = allClasses.filter((c) => c.academicYearId !== academicYearId);
  saveAllClassesLocal(allClasses);
  const enrollKey = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
  let enrollments: Enrollment[] = [];
  try {
    const raw = localStorage.getItem(enrollKey);
    if (raw) enrollments = JSON.parse(raw);
  } catch (_) {}
  enrollments = enrollments.filter((e) => !toRemove.includes(e.classId));
  saveAllEnrollmentsLocal(enrollments);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.deleteAcademicYear(academicYearId);
    } catch (e) {
      logError('deleteAcademicYear from cloud', e);
    }
  }
}

export async function createClass(item: ClassItem): Promise<ClassItem> {
  const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
  const all: ClassItem[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) all.push(...JSON.parse(raw));
  } catch (_) {}
  all.push(item);
  saveAllClassesLocal(all);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      return await api.createClass(item);
    } catch (e) {
      logError('createClass to cloud', e);
    }
  }
  return item;
}

export async function deleteClass(classId: string): Promise<void> {
  const key = getClassStorageKey(STORAGE_KEYS.CLASSES);
  let all: ClassItem[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) all = JSON.parse(raw);
  } catch (_) {}
  all = all.filter((c) => c.id !== classId);
  saveAllClassesLocal(all);
  const enrollKey = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
  let enrollments: Enrollment[] = [];
  try {
    const raw = localStorage.getItem(enrollKey);
    if (raw) enrollments = JSON.parse(raw);
  } catch (_) {}
  enrollments = enrollments.filter((e) => e.classId !== classId);
  saveAllEnrollmentsLocal(enrollments);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.deleteClass(classId);
    } catch (e) {
      logError('deleteClass from cloud', e);
    }
  }
}

export async function createStudent(student: Student): Promise<Student> {
  const all = loadStudentsSync();
  all.push(student);
  saveAllStudentsLocal(all);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      return await api.createStudent(student);
    } catch (e) {
      logError('createStudent to cloud', e);
    }
  }
  return student;
}

export async function updateStudent(studentId: string, patch: Partial<Pick<Student, 'name' | 'gender' | 'grade' | 'studentNumber' | 'dateOfBirth'>>): Promise<Student> {
  const all = loadStudentsSync();
  const idx = all.findIndex((s) => s.id === studentId);
  if (idx < 0) throw new Error('Student not found');
  const updated = { ...all[idx], ...patch };
  all[idx] = updated;
  saveAllStudentsLocal(all);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      return await api.updateStudent(studentId, patch);
    } catch (e) {
      logError('updateStudent to cloud', e);
    }
  }
  return updated;
}

export async function deleteStudent(studentId: string): Promise<void> {
  let students = loadStudentsSync();
  students = students.filter((s) => s.id !== studentId);
  saveAllStudentsLocal(students);
  let enrollments = loadEnrollmentsSync();
  enrollments = enrollments.filter((e) => e.studentId !== studentId);
  saveAllEnrollmentsLocal(enrollments);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.deleteStudent(studentId);
    } catch (e) {
      logError('deleteStudent from cloud', e);
    }
  }
}

export async function addEnrollment(enrollment: Enrollment): Promise<Enrollment> {
  const key = getClassStorageKey(STORAGE_KEYS.ENROLLMENTS);
  const all: Enrollment[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) all.push(...JSON.parse(raw));
  } catch (_) {}
  all.push(enrollment);
  saveAllEnrollmentsLocal(all);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      return await api.addEnrollment(enrollment);
    } catch (e) {
      logError('addEnrollment to cloud', e);
    }
  }
  return enrollment;
}

export async function removeEnrollment(enrollmentId: string): Promise<void> {
  let all = loadEnrollmentsSync();
  all = all.filter((e) => e.id !== enrollmentId);
  saveAllEnrollmentsLocal(all);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.removeEnrollment(enrollmentId);
    } catch (e) {
      logError('removeEnrollment from cloud', e);
    }
  }
}
