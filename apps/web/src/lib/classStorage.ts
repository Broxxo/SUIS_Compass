/**
 * 班级管理数据：学年、班级、学生、学籍均为全校共享（本地与云端一致）。
 *
 * - **纯本地（`USE_CLOUD_STORAGE === false`）**：以 localStorage 为权威；创建/更新先写本地，不请求
 *   `/api/classes/*`（无需启动后端）。课堂助手「云端同步」入口会直接跳过。
 * - **云端（`true`）**：加载时优先拉 API 并写入同一套 key 作缓存；写入时本地 + 尽力同步 API。
 */
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
import { STORAGE_KEYS } from './constants';
import { getCurrentUserId } from './authUtils';
import { api, USE_CLOUD_STORAGE } from './api';
import { logError } from './errorHandler';

export type LocalClassTeacherAssignment = {
  classId: string;
  teacherId: string;
  role: 'homeroom' | 'co-teacher';
  displayName?: string | null;
};

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

// ---------- 班级-教师关联（本地模式） ----------
function loadAllClassTeacherAssignmentsLocal(): LocalClassTeacherAssignment[] {
  migrateFromLegacyUserKeyIfNeeded(STORAGE_KEYS.CLASS_TEACHER_ASSIGNMENTS);
  const key = getClassStorageKey(STORAGE_KEYS.CLASS_TEACHER_ASSIGNMENTS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalClassTeacherAssignment[]) : [];
  } catch {
    return [];
  }
}

function saveAllClassTeacherAssignmentsLocal(assignments: LocalClassTeacherAssignment[]): void {
  const key = getClassStorageKey(STORAGE_KEYS.CLASS_TEACHER_ASSIGNMENTS);
  try {
    localStorage.setItem(key, JSON.stringify(assignments));
  } catch (_) {}
}

export function loadClassTeachersLocalSync(classId: string): LocalClassTeacherAssignment[] {
  return loadAllClassTeacherAssignmentsLocal()
    .filter((a) => a.classId === classId)
    .sort((a, b) => (a.role === 'homeroom' ? -1 : 1) - (b.role === 'homeroom' ? -1 : 1));
}

export function assignTeacherToClassLocal(
  classId: string,
  teacher: { teacherId: string; role: 'homeroom' | 'co-teacher'; displayName?: string | null }
): void {
  const all = loadAllClassTeacherAssignmentsLocal();
  const filtered = all.filter((a) => !(a.classId === classId && a.teacherId === teacher.teacherId));
  filtered.push({ classId, teacherId: teacher.teacherId, role: teacher.role, displayName: teacher.displayName ?? null });
  saveAllClassTeacherAssignmentsLocal(filtered);
}

export function unassignTeacherFromClassLocal(classId: string, teacherId: string): void {
  const all = loadAllClassTeacherAssignmentsLocal();
  saveAllClassTeacherAssignmentsLocal(all.filter((a) => !(a.classId === classId && a.teacherId === teacherId)));
}

export function getTeacherIdsForClassLocalSync(classId: string): string[] {
  return loadAllClassTeacherAssignmentsLocal()
    .filter((a) => a.classId === classId)
    .map((a) => a.teacherId);
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
  // also clean local teacher assignments
  if (!USE_CLOUD_STORAGE) {
    const assigns = loadAllClassTeacherAssignmentsLocal();
    saveAllClassTeacherAssignmentsLocal(assigns.filter((a) => a.classId !== classId));
  }
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

export async function updateStudent(studentId: string, patch: Partial<Student>): Promise<Student> {
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

// ---------- 课堂助手云端加载 ----------

/** 从云端加载课堂助手数据并合并到本地缓存（分组方案、小组、成员、积分事件） */
export async function loadClassAssistantFromCloud(classId: string): Promise<void> {
  if (!USE_CLOUD_STORAGE || !getCurrentUserId()) return;
  try {
    const [cloudSchemes, cloudEvents] = await Promise.all([
      api.getClassAssistantSchemes(classId),
      api.getClassAssistantPointEvents(classId),
    ]);
    const schemesKey = STORAGE_KEYS.CLASS_GROUP_SCHEMES;
    const eventsKey = STORAGE_KEYS.CLASS_POINT_EVENTS;
    const localSchemes: ClassGroupScheme[] = (() => {
      try {
        const raw = localStorage.getItem(schemesKey);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })();
    const localEvents: ClassPointEvent[] = (() => {
      try {
        const raw = localStorage.getItem(eventsKey);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })();
    const otherClassSchemes = localSchemes.filter((s) => s.classId !== classId);
    const nextSchemes = [...otherClassSchemes, ...cloudSchemes];
    localStorage.setItem(schemesKey, JSON.stringify(nextSchemes));
    const otherClassEvents = localEvents.filter((e) => e.classId !== classId);
    const nextEvents = [...otherClassEvents, ...cloudEvents];
    localStorage.setItem(eventsKey, JSON.stringify(nextEvents));
    for (const s of cloudSchemes) {
      const [cloudGroups, cloudMembers] = await Promise.all([
        api.getClassAssistantGroups(classId, s.id),
        api.getClassAssistantMembers(classId, s.id),
      ]);
      const groupsKey = STORAGE_KEYS.CLASS_GROUPS;
      const membersKey = STORAGE_KEYS.CLASS_GROUP_MEMBERS;
      const localGroups: ClassGroup[] = (() => {
        try {
          const raw = localStorage.getItem(groupsKey);
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })();
      const localMembers: ClassGroupMembership[] = (() => {
        try {
          const raw = localStorage.getItem(membersKey);
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })();
      const otherGroups = localGroups.filter(
        (g) => !(g.classId === classId && g.schemeId === s.id)
      );
      const otherMembers = localMembers.filter(
        (m) => !(m.classId === classId && m.schemeId === s.id)
      );
      localStorage.setItem(groupsKey, JSON.stringify([...otherGroups, ...cloudGroups]));
      localStorage.setItem(membersKey, JSON.stringify([...otherMembers, ...cloudMembers]));
    }
  } catch (e) {
    logError('loadClassAssistantFromCloud', e);
  }
}

// ---------- 小组 & 成员（本地共享，不按用户隔离） ----------

function getSharedKey(base: string): string {
  return base;
}

function loadAllGroupSchemesUnsafe(): ClassGroupScheme[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_SCHEMES);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as ClassGroupScheme[];
  } catch {
    return [];
  }
}

function saveAllGroupSchemesUnsafe(schemes: ClassGroupScheme[]): void {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_SCHEMES);
  localStorage.setItem(key, JSON.stringify(schemes));
}

function loadAllGroupsUnsafe(): any[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUPS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as any[];
  } catch {
    return [];
  }
}

function saveAllGroupsUnsafe(groups: any[]): void {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUPS);
  localStorage.setItem(key, JSON.stringify(groups));
}

function loadAllGroupMembersUnsafe(): any[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_MEMBERS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as any[];
  } catch {
    return [];
  }
}

function saveAllGroupMembersUnsafe(members: any[]): void {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_MEMBERS);
  localStorage.setItem(key, JSON.stringify(members));
}

function loadAllPointEventsUnsafe(): any[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_POINT_EVENTS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as any[];
  } catch {
    return [];
  }
}

function saveAllPointEventsUnsafe(events: any[]): void {
  const key = getSharedKey(STORAGE_KEYS.CLASS_POINT_EVENTS);
  localStorage.setItem(key, JSON.stringify(events));
}

function ensureDefaultSchemeForClass(classId: string): ClassGroupScheme {
  const schemes = loadAllGroupSchemesUnsafe();
  const existing = schemes.filter((s) => s.classId === classId);
  if (existing.length > 0) return existing[0];
  const now = new Date().toISOString();
  const scheme: ClassGroupScheme = {
    id: `scheme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    classId,
    name: '默认分组',
    scope: 'class-default',
    subject: null,
    createdAt: now,
    updatedAt: now,
  };
  saveAllGroupSchemesUnsafe([...schemes, scheme]);
  return scheme;
}

/** 旧数据迁移：将没有 schemeId 的小组/成员/小组积分事件归入“默认分组” */
function migrateSchemeIfNeededForClass(classId: string): void {
  const anyGroups = loadAllGroupsUnsafe().some((g: any) => g?.classId === classId && !g?.schemeId);
  const anyMembers = loadAllGroupMembersUnsafe().some((m: any) => m?.classId === classId && !m?.schemeId);
  const anyGroupEvents = loadAllPointEventsUnsafe().some(
    (e: any) => e?.classId === classId && e?.type === 'group' && !e?.schemeId,
  );
  if (!anyGroups && !anyMembers && !anyGroupEvents) return;

  const scheme = ensureDefaultSchemeForClass(classId);

  if (anyGroups) {
    const all = loadAllGroupsUnsafe();
    for (const g of all) {
      if (g?.classId === classId && !g?.schemeId) g.schemeId = scheme.id;
    }
    saveAllGroupsUnsafe(all);
  }
  if (anyMembers) {
    const all = loadAllGroupMembersUnsafe();
    for (const m of all) {
      if (m?.classId === classId && !m?.schemeId) m.schemeId = scheme.id;
    }
    saveAllGroupMembersUnsafe(all);
  }
  if (anyGroupEvents) {
    const all = loadAllPointEventsUnsafe();
    for (const e of all) {
      if (e?.classId === classId && e?.type === 'group' && !e?.schemeId) e.schemeId = scheme.id;
    }
    saveAllPointEventsUnsafe(all);
  }
}

export function loadGroupSchemesByClassSync(classId: string): ClassGroupScheme[] {
  migrateSchemeIfNeededForClass(classId);
  const schemes = loadAllGroupSchemesUnsafe();
  return schemes.filter((s) => s.classId === classId);
}

/** 删除一个分组方案及其下所有小组、成员与小组积分事件 */
export async function deleteGroupScheme(schemeId: string): Promise<void> {
  const schemes = loadAllGroupSchemesUnsafe();
  const scheme = schemes.find((s) => s.id === schemeId);
  if (!scheme) return;
  const remainingSchemes = schemes.filter((s) => s.id !== schemeId);
  saveAllGroupSchemesUnsafe(remainingSchemes);
  const groups = loadAllGroupsUnsafe();
  saveAllGroupsUnsafe(groups.filter((g: any) => g.schemeId !== schemeId));
  const members = loadAllGroupMembersUnsafe();
  saveAllGroupMembersUnsafe(members.filter((m: any) => m.schemeId !== schemeId));
  const events = loadAllPointEventsUnsafe();
  saveAllPointEventsUnsafe(events.filter((e: any) => (e.schemeId ?? null) !== schemeId));
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    try {
      await api.deleteClassAssistantScheme(schemeId);
    } catch (e) {
      logError('deleteGroupScheme to cloud', e);
    }
  }
}

export async function saveGroupSchemes(schemes: ClassGroupScheme[]): Promise<void> {
  const all = loadAllGroupSchemesUnsafe();
  const next = all.filter((s) => !schemes.some((x) => x.id === s.id)).concat(schemes);
  saveAllGroupSchemesUnsafe(next);
  if (USE_CLOUD_STORAGE && getCurrentUserId()) {
    for (const s of schemes) {
      try {
        await api.createClassAssistantScheme(s);
      } catch (e) {
        logError('saveGroupSchemes to cloud', e);
      }
    }
  }
}

export function loadGroupsByClassSync(classId: string, schemeId?: string | null): ClassGroup[] {
  migrateSchemeIfNeededForClass(classId);
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUPS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const all: ClassGroup[] = JSON.parse(raw);
    if (schemeId) return all.filter((g) => g.classId === classId && g.schemeId === schemeId);
    return all.filter((g) => g.classId === classId);
  } catch {
    return [];
  }
}

export function loadAllGroupsSync(): ClassGroup[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUPS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as ClassGroup[];
  } catch {
    return [];
  }
}

export async function saveGroups(
  groups: ClassGroup[],
  syncClassId?: string,
  syncSchemeId?: string
): Promise<void> {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUPS);
  localStorage.setItem(key, JSON.stringify(groups));
  if (USE_CLOUD_STORAGE && getCurrentUserId() && syncClassId && syncSchemeId) {
    try {
      const toSync = groups.filter((g) => g.classId === syncClassId && g.schemeId === syncSchemeId);
      await api.putClassAssistantGroups(syncClassId, syncSchemeId, toSync);
    } catch (e) {
      logError('saveGroups to cloud', e);
    }
  }
}

export function loadGroupMembersByClassSync(classId: string, schemeId?: string | null): ClassGroupMembership[] {
  migrateSchemeIfNeededForClass(classId);
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_MEMBERS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const all: ClassGroupMembership[] = JSON.parse(raw);
    if (schemeId) return all.filter((m) => m.classId === classId && m.schemeId === schemeId);
    return all.filter((m) => m.classId === classId);
  } catch {
    return [];
  }
}

export function loadAllGroupMembersSync(): ClassGroupMembership[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_MEMBERS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as ClassGroupMembership[];
  } catch {
    return [];
  }
}

export async function saveGroupMembers(
  members: ClassGroupMembership[],
  syncClassId?: string,
  syncSchemeId?: string
): Promise<void> {
  const key = getSharedKey(STORAGE_KEYS.CLASS_GROUP_MEMBERS);
  localStorage.setItem(key, JSON.stringify(members));
  if (USE_CLOUD_STORAGE && getCurrentUserId() && syncClassId && syncSchemeId) {
    try {
      const toSync = members.filter((m) => m.classId === syncClassId && m.schemeId === syncSchemeId);
      await api.putClassAssistantMembers(syncClassId, syncSchemeId, toSync);
    } catch (e) {
      logError('saveGroupMembers to cloud', e);
    }
  }
}

// ---------- 积分事件 ----------

export function loadPointEventsByClassSync(classId: string, schemeId?: string | null): ClassPointEvent[] {
  migrateSchemeIfNeededForClass(classId);
  const key = getSharedKey(STORAGE_KEYS.CLASS_POINT_EVENTS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const all: ClassPointEvent[] = JSON.parse(raw);
    if (schemeId) return all.filter((e) => e.classId === classId && (e.schemeId ?? null) === schemeId);
    return all.filter((e) => e.classId === classId);
  } catch {
    return [];
  }
}

export function loadAllPointEventsSync(): ClassPointEvent[] {
  const key = getSharedKey(STORAGE_KEYS.CLASS_POINT_EVENTS);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as ClassPointEvent[];
  } catch {
    return [];
  }
}

export async function savePointEvents(
  events: ClassPointEvent[],
  syncClassId?: string
): Promise<void> {
  const key = getSharedKey(STORAGE_KEYS.CLASS_POINT_EVENTS);
  localStorage.setItem(key, JSON.stringify(events));
  if (USE_CLOUD_STORAGE && getCurrentUserId() && syncClassId) {
    try {
      const toSync = events.filter((e) => e.classId === syncClassId);
      await api.putClassAssistantPointEvents(syncClassId, toSync);
    } catch (e) {
      logError('savePointEvents to cloud', e);
    }
  }
}

export function getIndividualScoresByClass(classId: string): Map<string, number> {
  const events = loadPointEventsByClassSync(classId);
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'individual' || !e.studentId) continue;
    map.set(e.studentId, (map.get(e.studentId) ?? 0) + e.delta);
  }
  return map;
}

export function getGroupScoresByClass(classId: string): Map<string, number> {
  const events = loadPointEventsByClassSync(classId);
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'group' || !e.groupId) continue;
    map.set(e.groupId, (map.get(e.groupId) ?? 0) + e.delta);
  }
  return map;
}

export function getGroupScoresByClassAndScheme(classId: string, schemeId: string): Map<string, number> {
  const events = loadPointEventsByClassSync(classId, schemeId);
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'group' || !e.groupId) continue;
    map.set(e.groupId, (map.get(e.groupId) ?? 0) + e.delta);
  }
  return map;
}
