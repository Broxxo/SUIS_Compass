import { useEffect, useState, useMemo } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type { Course, User } from '../types';
import type { AdminUser } from '../lib/adminStorage';
import {
  loadUsers,
  createUser,
  updateUserDepartment,
  updateUserRole,
  batchUpdateDepartment,
  deleteUser,
  importStudentAccounts,
} from '../lib/adminStorage';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import {
  loadAcademicYears,
  loadCurrentAcademicYearId,
  setCurrentAcademicYearId,
  setCurrentAcademicYearIdAndSync,
  getCurrentAcademicYearId,
  createAcademicYear,
  deleteAcademicYear,
  loadStudents,
  loadEnrollmentsSync,
  loadAllClasses,
  loadAllClassesSync,
  updateStudent,
  deleteStudent,
  addEnrollment,
} from '../lib/classStorage';
import { loadCategoryOrder, hydrateCategoryOrderFromCloud, loadGradeConfigSync } from '../lib/storage';
import { getGradeLabelByLevel, normalizeGradeConfig } from '../lib/gradeConfig';
import { sortCoursesLikeCurriculumRoadmap, getSubjectCategoryText } from '../lib/utils';
import { courseAppliesToGrade } from '../lib/courseGradeUtils';
import type { AcademicYear, Student, Enrollment, ClassItem, EvaluationTemplateSummary, HomeroomCommentMode, ReportGrade, ReportTemplateProgress, ReportTemplateStatus, StaffingAssignment, TargetLevel, Term } from '../types/classManagement';
import ClassManagement from './ClassManagement';
import CurriculumRoadmap from './CurriculumRoadmap';
import CreateStudentDialog from './CreateStudentDialog';
import { ArrowDown, ArrowUp, Eye, EyeOff, LogIn, Pencil, Plus, Trash2 } from 'lucide-react';

function randomSixDigitPassword(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const ROLE_LABELS: Record<User['role'], { zh: string; en: string }> = {
  'system-admin': { zh: '系统管理员', en: 'System Admin' },
  admin: { zh: '管理员', en: 'Admin' },
  teacher: { zh: '教师', en: 'Teacher' },
  student: { zh: '学生', en: 'Student' },
};

type EvaluationDesignerModule = 'homeroom_comment' | 'subject_evaluation';

interface AdminPanelProps {
  onBackToHub: () => void;
}

export default function AdminPanel({ onBackToHub }: AdminPanelProps) {
  const { user: currentUser } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<User['role']>('admin');
  const [password, setPassword] = useState('');
  const [departmentCreate, setDepartmentCreate] = useState('');
  const [creating, setCreating] = useState(false);
  /** 每行密码是否可见（仅影响展示，默认隐藏） */
  const [passwordRevealed, setPasswordRevealed] = useState<Record<string, boolean>>({});
  /** 批量操作：选中的用户 id */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 批量设置部门时的输入值 */
  const [batchDepartment, setBatchDepartment] = useState('');
  /** 批量设置部门请求中 */
  const [batchDeptLoading, setBatchDeptLoading] = useState(false);
  /** 删除确认：当前要删的用户；确认输入框内容 */
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [adminTab, setAdminTab] = useState<'users' | 'years' | 'classes' | 'courses' | 'staffing' | 'students' | 'report-settings' | 'database'>('users');
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const [yearLoading, setYearLoading] = useState(false);
  const [dialogCreateYear, setDialogCreateYear] = useState(false);
  const [dialogYearManagement, setDialogYearManagement] = useState(false);
  const [newYearName, setNewYearName] = useState('');
  const [yearSubmitLoading, setYearSubmitLoading] = useState(false);
  const [currentYearClassCount, setCurrentYearClassCount] = useState<number | null>(null);
  const [currentYearStudentCount, setCurrentYearStudentCount] = useState<number | null>(null);
  const [currentYearClasses, setCurrentYearClasses] = useState<{ cls: ClassItem; studentCount: number }[]>([]);

  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [allYears, setAllYears] = useState<AcademicYear[]>([]);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentFilterName, setStudentFilterName] = useState('');
  const [studentFilterGrade, setStudentFilterGrade] = useState('');
  const [studentFilterClass, setStudentFilterClass] = useState('');
  const [studentSortField, setStudentSortField] = useState<'nameZh' | 'nameEn' | 'currentGrade' | 'gender' | 'studentNumber' | 'dateOfBirth'>('nameZh');
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc');
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editNameZh, setEditNameZh] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editCurrentGrade, setEditCurrentGrade] = useState('');
  const [editGender, setEditGender] = useState<Student['gender']>('male');
  const [editDivision, setEditDivision] = useState('');
  const [editEntryDate, setEditEntryDate] = useState('');
  const [editStatus, setEditStatus] = useState<Student['status']>('active');
  const [editStudentNumber, setEditStudentNumber] = useState('');
  const [editDateOfBirth, setEditDateOfBirth] = useState('');
  const [editSubmitLoading, setEditSubmitLoading] = useState(false);
  const [studentCurrentYearId, setStudentCurrentYearId] = useState<string | null>(null);
  const [dialogCreateStudent, setDialogCreateStudent] = useState(false);
  const [reportSettingYearId, setReportSettingYearId] = useState<string>('');
  const [reportSettingTerm, setReportSettingTerm] = useState<Term>('Semester 1');
  const [reportSettingStatus, setReportSettingStatus] = useState<ReportTemplateStatus>('draft');
  const [reportSettingHomeroomCommentMode, setReportSettingHomeroomCommentMode] = useState<HomeroomCommentMode>('optional');
  const [reportSettingTitle, setReportSettingTitle] = useState('');
  const [reportTemplateList, setReportTemplateList] = useState<EvaluationTemplateSummary[]>([]);
  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState<string>('');
  const [createEvaluationOpen, setCreateEvaluationOpen] = useState(false);
  const [createEvaluationMode, setCreateEvaluationMode] = useState<'create' | 'edit'>('create');
  const [enabledEvaluationModules, setEnabledEvaluationModules] = useState<Record<EvaluationDesignerModule, boolean>>({
    homeroom_comment: false,
    subject_evaluation: true,
  });
  const [evaluationModuleOrder, setEvaluationModuleOrder] = useState<EvaluationDesignerModule[]>([
    'subject_evaluation',
  ]);
  const [homeroomCommentPreview, setHomeroomCommentPreview] = useState('');
  const [addModuleMenuOpen, setAddModuleMenuOpen] = useState(false);
  const [createEvaluationTitle, setCreateEvaluationTitle] = useState('');
  const [createEvaluationFromTemplateId, setCreateEvaluationFromTemplateId] = useState<string>('');
  const [reportSettingSubjects, setReportSettingSubjects] = useState<Array<{
    subjectNameZh: string;
    subjectNameEn: string;
    moduleType: 'subject_score' | 'subject_comment' | 'non_score_comment';
    enableScore: boolean;
    enableTeacherComment: boolean;
    enableTarget: boolean;
    scorePreview: string;
    commentPreview: string;
    scoreVisibility: 'teacher_homeroom_admin';
    dimensions: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>;
  }>>([]);
  const [reportSettingLoading, setReportSettingLoading] = useState(false);
  const [reportSettingSaving, setReportSettingSaving] = useState(false);
  const [progressConfirmOpen, setProgressConfirmOpen] = useState(false);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressData, setProgressData] = useState<ReportTemplateProgress | null>(null);
  const [progressTemplateTitle, setProgressTemplateTitle] = useState('');
  const [dbTables, setDbTables] = useState<Array<{ tableName: string; rowCount: number }>>([]);
  const [dbSelectedTable, setDbSelectedTable] = useState<string>('');
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [dbRows, setDbRows] = useState<Array<Record<string, unknown>>>([]);
  const [dbPrimaryKey, setDbPrimaryKey] = useState<string | null>(null);
  const [dbLimit, setDbLimit] = useState(20);
  const [dbOffset, setDbOffset] = useState(0);
  const [dbTotal, setDbTotal] = useState(0);
  const [dbTableLoading, setDbTableLoading] = useState(false);
  const [dbRowsLoading, setDbRowsLoading] = useState(false);

  /** 岗位安排：学年 + 班级列表（后续接入班主任/学科教师编辑与复制上年） */
  const [staffingYearId, setStaffingYearId] = useState<string>('');
  const [staffingLoading, setStaffingLoading] = useState(false);
  const [staffingCourses, setStaffingCourses] = useState<Course[]>([]);
  const [staffingTeachers, setStaffingTeachers] = useState<AdminUser[]>([]);
  const [staffingAssignments, setStaffingAssignments] = useState<StaffingAssignment[]>([]);
  const [staffingSavingKeys, setStaffingSavingKeys] = useState<Set<string>>(new Set());
  /** 云端下学科顺序从 DB 拉取后 bump，岗位安排列与课程管理对齐 */
  const [staffingCategoryOrderNonce, setStaffingCategoryOrderNonce] = useState(0);

  /** 用户管理：教职工列表 | 学生账号列表 */
  const [userListScope, setUserListScope] = useState<'staff' | 'students'>('staff');
  const [studentLoginOpen, setStudentLoginOpen] = useState(false);
  const [studentLoginPreview, setStudentLoginPreview] = useState<
    Array<{ studentId: string; nameZh: string; nameEn: string; studentNumber: string; password: string }>
  >([]);
  const [studentLoginPhase, setStudentLoginPhase] = useState<'preview' | 'done'>('preview');
  const [studentLoginResult, setStudentLoginResult] = useState<{ created: number; skipped: number } | null>(null);
  const [studentLoginBusy, setStudentLoginBusy] = useState(false);

  /** 仅系统管理员可创建/修改学年 */
  const canEditYears = currentUser?.role === 'system-admin';
  const isSystemAdmin = currentUser?.role === 'system-admin';

  /** 当前用户可创建的角色：系统管理员可创建管理员+教师，管理员只能创建教师 */
  const assignableRoles = useMemo((): User['role'][] => {
    if (currentUser?.role === 'system-admin') return ['admin', 'teacher'];
    if (currentUser?.role === 'admin') return ['teacher'];
    return [];
  }, [currentUser?.role]);

  /** 列表展示：学生账号为独立 scope；教职工仍按权限过滤 */
  const displayedUsers = useMemo(() => {
    if (userListScope === 'students') return users;
    if (currentUser?.role === 'system-admin') return users.filter((u) => u.role === 'admin' || u.role === 'teacher');
    if (currentUser?.role === 'admin') return users.filter((u) => u.role === 'teacher');
    return users;
  }, [users, currentUser?.role, userListScope]);

  /** 当前用户可否编辑该行（角色、部门等）：学生账号不可在此编辑 */
  const canEditUser = (u: AdminUser) => {
    if (u.role === 'student') return false;
    if (u.role === 'system-admin') return false;
    if (currentUser?.role === 'system-admin') return true;
    if (currentUser?.role === 'admin' && u.role === 'teacher') return true;
    return false;
  };

  /** 当前用户可否删除该行：系统管理员可删管理员/教师/学生，管理员可删教师与学生 */
  const canDeleteUser = (u: AdminUser) => {
    if (u.role === 'system-admin') return false;
    if (u.role === 'student') {
      return currentUser?.role === 'system-admin' || currentUser?.role === 'admin';
    }
    if (currentUser?.role === 'system-admin') return true;
    if (currentUser?.role === 'admin' && u.role === 'teacher') return true;
    return false;
  };

  /** 当前列表中出现的所有部门（去重，用于下拉选项） */
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    displayedUsers.forEach((u) => {
      if (u.department && u.department.trim()) set.add(u.department.trim());
    });
    return Array.from(set).sort();
  }, [displayedUsers]);

  useEffect(() => {
    if (adminTab !== 'users') return;
    setLoading(true);
    setError(null);
    loadUsers(userListScope)
      .then((data) => setUsers(data))
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  }, [adminTab, userListScope]);

  useEffect(() => {
    if (assignableRoles.length > 0 && !assignableRoles.includes(role)) {
      setRole(assignableRoles[0]);
    }
  }, [assignableRoles, role]);

  const refreshYears = async () => {
    const list = await loadAcademicYears();
    setYears(list);
    const cur = await loadCurrentAcademicYearId();
    if (cur) setCurrentYearId(cur);
    else if (list.length > 0) {
      if (!getCurrentAcademicYearId()) setCurrentAcademicYearId(list[0].id);
      setCurrentYearId(list[0].id);
    }
  };

  const loadReportTemplateList = async (yearId: string, term: Term) => {
    if (!yearId) return;
    const templates = await api.getAdminReportTemplates({ academicYearId: yearId, term });
    setReportTemplateList(templates);
    const chosen = selectedReportTemplateId && templates.some((t) => t.id === selectedReportTemplateId)
      ? selectedReportTemplateId
      : (templates[0]?.id ?? '');
    setSelectedReportTemplateId(chosen);
    return chosen;
  };

  const loadReportTemplateSetting = async (templateId: string) => {
    if (!templateId) {
      setReportSettingSubjects([]);
      setReportSettingTitle('');
      setReportSettingStatus('draft');
      setReportSettingHomeroomCommentMode('optional');
      const defaultModules = {
        homeroom_comment: false,
        subject_evaluation: true,
      } as Record<EvaluationDesignerModule, boolean>;
      setEnabledEvaluationModules(defaultModules);
      setEvaluationModuleOrder(deriveModuleOrderFromEnabled(defaultModules));
      return;
    }
    setReportSettingLoading(true);
    try {
      const tpl = await api.getAdminReportTemplate(templateId);
      const mappedSubjects = (tpl.subjects ?? []).map((s) => ({
          subjectNameZh: s.subjectNameZh || s.subjectName,
          subjectNameEn: s.subjectNameEn || s.subjectName,
          moduleType: s.moduleType ?? 'subject_score',
          enableScore: s.enableScore ?? true,
          enableTeacherComment: s.enableTeacherComment ?? true,
          enableTarget: (s.dimensions ?? []).length > 0,
          scorePreview: '',
          commentPreview: '',
          scoreVisibility: s.scoreVisibility ?? 'teacher_homeroom_admin',
          dimensions: (s.dimensions ?? []).map((d) => ({
            dimensionLabelZh: d.dimensionLabelZh || d.dimensionLabel,
            dimensionLabelEn: d.dimensionLabelEn || d.dimensionLabel,
            levelDescriptions: d.levelDescriptions ?? {},
          })),
        }));
      const homeroomMode = tpl.homeroomCommentMode ?? 'optional';
      setReportSettingStatus(tpl.status);
      setReportSettingHomeroomCommentMode('optional');
      setReportSettingTitle(tpl.title ?? '');
      setReportSettingSubjects(mappedSubjects);
      const enabled = deriveEnabledModulesFromTemplate(homeroomMode, mappedSubjects);
      setEnabledEvaluationModules(enabled);
      setEvaluationModuleOrder(deriveModuleOrderFromEnabled(enabled));
      return tpl;
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load report template');
    } finally {
      setReportSettingLoading(false);
    }
  };

  const loadDatabaseTables = async () => {
    setDbTableLoading(true);
    try {
      const list = await api.getDatabaseTables();
      setDbTables(list);
      const chosen = dbSelectedTable && list.some((t) => t.tableName === dbSelectedTable)
        ? dbSelectedTable
        : (list[0]?.tableName ?? '');
      setDbSelectedTable(chosen);
      if (!chosen) {
        setDbColumns([]);
        setDbRows([]);
        setDbPrimaryKey(null);
        setDbOffset(0);
        setDbTotal(0);
      }
      return chosen;
    } finally {
      setDbTableLoading(false);
    }
  };

  const loadDatabaseRows = async (tableName: string, offset: number, limit: number) => {
    if (!tableName) return;
    setDbRowsLoading(true);
    try {
      const data = await api.getDatabaseTableRows(tableName, { offset, limit });
      setDbColumns(data.columns);
      setDbRows(data.rows);
      setDbPrimaryKey(data.primaryKey);
      setDbOffset(data.page.offset);
      setDbLimit(data.page.limit);
      setDbTotal(data.page.total);
    } finally {
      setDbRowsLoading(false);
    }
  };

  useEffect(() => {
    if (adminTab !== 'years') return;
    setYearLoading(true);
    refreshYears().finally(() => setYearLoading(false));
  }, [adminTab]);

  useEffect(() => {
    if (adminTab !== 'report-settings') return;
    if (!USE_CLOUD_STORAGE) {
      setReportSettingYearId('');
      setReportTemplateList([]);
      setSelectedReportTemplateId('');
      setReportSettingSubjects([]);
      setReportSettingTitle('');
      setReportSettingStatus('draft');
      setReportSettingHomeroomCommentMode('optional');
      return;
    }
    setReportSettingLoading(true);
    Promise.all([loadAcademicYears(), loadCurrentAcademicYearId()])
      .then(([list, cur]) => {
        setYears(list);
        const id = cur || list[0]?.id || '';
        setReportSettingYearId(id);
        if (id) {
          return loadReportTemplateList(id, reportSettingTerm);
        }
      })
      .finally(() => setReportSettingLoading(false));
  }, [adminTab]);

  useEffect(() => {
    if (adminTab !== 'report-settings' || !reportSettingYearId) return;
    if (!USE_CLOUD_STORAGE) return;
    void loadReportTemplateList(reportSettingYearId, reportSettingTerm);
  }, [reportSettingYearId, reportSettingTerm, adminTab]);

  useEffect(() => {
    if (adminTab !== 'report-settings') return;
    if (!USE_CLOUD_STORAGE) return;
    void loadReportTemplateSetting(selectedReportTemplateId);
  }, [selectedReportTemplateId, adminTab]);

  useEffect(() => {
    if (adminTab !== 'database') return;
    if (!isSystemAdmin) return;
    setError(null);
    setDbOffset(0);
    loadDatabaseTables()
      .then((chosen) => {
        if (chosen) return loadDatabaseRows(chosen, 0, dbLimit);
      })
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load database tables'));
  }, [adminTab, isSystemAdmin]);

  // 选定学年后，统计该学年的班级数和学生数（按学籍去重）
  useEffect(() => {
    if (adminTab !== 'years' || !currentYearId) {
      setCurrentYearClassCount(null);
      setCurrentYearStudentCount(null);
      return;
    }
    try {
      const allClasses = loadAllClassesSync();
      const classesForYear = allClasses.filter((c) => c.academicYearId === currentYearId);
      const enrolls = loadEnrollmentsSync(currentYearId);
      const validClassIds = new Set(classesForYear.map((c) => c.id));

      const classToStudentSet = new Map<string, Set<string>>();
      enrolls.forEach((e) => {
        if (!validClassIds.has(e.classId)) return;
        let set = classToStudentSet.get(e.classId);
        if (!set) {
          set = new Set<string>();
          classToStudentSet.set(e.classId, set);
        }
        set.add(e.studentId);
      });

      const studentIds = new Set<string>();
      classToStudentSet.forEach((set) => set.forEach((id) => studentIds.add(id)));

      setCurrentYearClassCount(classesForYear.length);
      setCurrentYearStudentCount(studentIds.size);
      setCurrentYearClasses(
        classesForYear
          .slice()
          .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name))
          .map((cls) => ({
            cls,
            studentCount: classToStudentSet.get(cls.id)?.size ?? 0,
          })),
      );
    } catch {
      setCurrentYearClassCount(null);
      setCurrentYearStudentCount(null);
      setCurrentYearClasses([]);
    }
  }, [adminTab, currentYearId]);

  useEffect(() => {
    if (adminTab !== 'students') return;
    setStudentLoading(true);
    Promise.all([
      loadStudents(),
      loadAcademicYears(),
      loadAllClasses(),
      loadCurrentAcademicYearId(),
    ]).then(([stList, yList, clsList, curYearId]) => {
      setStudents(stList);
      setAllYears(yList);
      setAllClasses(clsList);
      setEnrollments(loadEnrollmentsSync());
      setStudentCurrentYearId(curYearId || (yList.length > 0 ? yList[0].id : null));
    }).finally(() => setStudentLoading(false));
  }, [adminTab]);

  useEffect(() => {
    if (adminTab !== 'staffing') return;
    setStaffingLoading(true);
    Promise.all([
      loadAcademicYears(),
      loadAllClasses(),
      loadCurrentAcademicYearId(),
      USE_CLOUD_STORAGE ? api.getCourses() : Promise.resolve([] as Course[]),
      loadUsers('staff'),
    ])
      .then(async ([yList, clsList, curYearId, courseList, userList]) => {
        setAllYears(yList);
        setAllClasses(clsList);
        setStaffingCourses(courseList);
        setStaffingTeachers(userList.filter((u) => u.role === 'teacher'));
        const id = curYearId || yList[0]?.id || '';
        setStaffingYearId(id);
        if (id && USE_CLOUD_STORAGE) {
          const assignments = await api.getAdminStaffingAssignments(id);
          setStaffingAssignments(assignments);
        } else {
          setStaffingAssignments([]);
        }
      })
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load staffing data'))
      .finally(() => setStaffingLoading(false));
  }, [adminTab]);

  useEffect(() => {
    if (adminTab !== 'staffing') return;
    if (!USE_CLOUD_STORAGE || !staffingYearId) {
      setStaffingAssignments([]);
      return;
    }
    setStaffingLoading(true);
    api.getAdminStaffingAssignments(staffingYearId)
      .then((assignments) => setStaffingAssignments(assignments))
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load staffing assignments'))
      .finally(() => setStaffingLoading(false));
  }, [adminTab, staffingYearId]);

  useEffect(() => {
    if (adminTab !== 'staffing' || !USE_CLOUD_STORAGE) return;
    let cancelled = false;
    void hydrateCategoryOrderFromCloud().then(() => {
      if (!cancelled) setStaffingCategoryOrderNonce((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [adminTab]);

  const handleCreateYear = async () => {
    if (!newYearName.trim()) return;
    setYearSubmitLoading(true);
    setError(null);
    try {
      const id = `ay-${Date.now()}`;
      await createAcademicYear({
        id,
        name: newYearName.trim(),
        isCurrent: years.length === 0,
      });
      setNewYearName('');
      setDialogCreateYear(false);
      await refreshYears();
      if (years.length === 0) await setCurrentAcademicYearIdAndSync(id);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create year');
    } finally {
      setYearSubmitLoading(false);
    }
  };

  const filteredAndSortedStudents = useMemo(() => {
    let list = [...students];
    if (studentFilterName.trim()) {
      const q = studentFilterName.trim().toLowerCase();
      list = list.filter((s) =>
        (s.nameZh ?? '').toLowerCase().includes(q) ||
        (s.nameEn ?? '').toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.studentNumber?.toLowerCase().includes(q))
      );
    }
    if (studentFilterGrade.trim()) {
      const q = studentFilterGrade.trim().toLowerCase();
      list = list.filter((s) => String(s.currentGrade ?? '').toLowerCase().includes(q));
    }
    if (studentFilterClass.trim()) {
      const classId = studentFilterClass;
      const enrolledIds = new Set(enrollments.filter((e) => e.classId === classId).map((e) => e.studentId));
      list = list.filter((s) => enrolledIds.has(s.id));
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (studentSortField) {
        case 'nameZh':
          cmp = (a.nameZh || '').localeCompare(b.nameZh || '');
          break;
        case 'nameEn':
          cmp = (a.nameEn || '').localeCompare(b.nameEn || '');
          break;
        case 'currentGrade':
          cmp = (a.currentGrade ?? 0) - (b.currentGrade ?? 0);
          break;
        case 'gender':
          cmp = (a.gender || '').localeCompare(b.gender || '');
          break;
        case 'studentNumber':
          cmp = (a.studentNumber ?? '').localeCompare(b.studentNumber ?? '');
          break;
        case 'dateOfBirth':
          cmp = (a.dateOfBirth ?? '').localeCompare(b.dateOfBirth ?? '');
          break;
        default:
          cmp = 0;
      }
      return studentSortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [students, enrollments, studentFilterName, studentFilterGrade, studentFilterClass, studentSortField, studentSortDir]);

  const openEditStudent = (s: Student) => {
    setEditStudent(s);
    setEditNameZh(s.nameZh ?? '');
    setEditNameEn(s.nameEn ?? '');
    setEditCurrentGrade(s.currentGrade == null ? '' : String(s.currentGrade));
    setEditGender(s.gender);
    setEditDivision(s.division ?? '');
    setEditEntryDate(s.entryDate ?? '');
    setEditStatus(s.status ?? 'active');
    setEditStudentNumber(s.studentNumber ?? '');
    setEditDateOfBirth(s.dateOfBirth ?? '');
  };

  const handleSaveStudent = async () => {
    if (!editStudent) return;
    const zh = editNameZh.trim();
    const en = editNameEn.trim();
    if (!zh && !en) return;
    setEditSubmitLoading(true);
    setError(null);
    try {
      await updateStudent(editStudent.id, {
        name: zh || en,
        nameZh: zh || null,
        nameEn: en || null,
        currentGrade: editCurrentGrade.trim() ? Number(editCurrentGrade) : null,
        gender: editGender,
        division: editDivision.trim() || null,
        entryDate: editEntryDate.trim() || null,
        status: editStatus || 'active',
        studentNumber: editStudentNumber.trim() || null,
        dateOfBirth: editDateOfBirth.trim() || null,
      });
      setStudents((prev) => prev.map((s) => (
        s.id === editStudent.id
          ? {
              ...s,
              name: zh || en,
              nameZh: zh || null,
              nameEn: en || null,
              currentGrade: editCurrentGrade.trim() ? Number(editCurrentGrade) : null,
              gender: editGender,
              division: editDivision.trim() || null,
              entryDate: editEntryDate.trim() || null,
              status: editStatus || 'active',
              studentNumber: editStudentNumber.trim() || null,
              dateOfBirth: editDateOfBirth.trim() || null,
            }
          : s
      )));
      setEditStudent(null);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update student');
    } finally {
      setEditSubmitLoading(false);
    }
  };

  const handleDeleteStudentInAdmin = async () => {
    if (!editStudent) return;
    const msg = isZh ? `确定删除学生「${editStudent.name}」？其所有学籍将删除。` : `Delete student "${editStudent.name}"? All enrollments will be removed.`;
    if (!window.confirm(msg)) return;
    setEditSubmitLoading(true);
    setError(null);
    try {
      await deleteStudent(editStudent.id);
      setStudents((prev) => prev.filter((s) => s.id !== editStudent.id));
      setEnrollments((prev) => prev.filter((e) => e.studentId !== editStudent.id));
      setEditStudent(null);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete student');
    } finally {
      setEditSubmitLoading(false);
    }
  };

  const handleDeleteYear = async (y: AcademicYear) => {
    const msg = isZh
      ? `确定删除学年「${y.name}」？该学年下所有班级与学籍将一并删除，学生档案保留。`
      : `Delete academic year "${y.name}"? All classes and enrollments in this year will be removed; student records kept.`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await deleteAcademicYear(y.id);
      await refreshYears();
      setDialogYearManagement(false);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete year');
    }
  };

  const getGradeLabel = (level: number): string =>
    getGradeLabelByLevel(normalizeGradeConfig(loadGradeConfigSync()), level);

  const handleCreate = async () => {
    if (!username || !password) return;
    setCreating(true);
    setError(null);
    try {
      const dept = departmentCreate.trim() || undefined;
      const user = await createUser({ username, displayName: displayName || username, role, password, department: dept ?? null });
      setUsers((prev) => [user, ...prev]);
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole(assignableRoles[0] ?? 'teacher');
      setDepartmentCreate('');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const editableUserIds = useMemo(() => new Set(displayedUsers.filter((u) => canEditUser(u)).map((u) => u.id)), [displayedUsers]);

  const toggleSelectAll = () => {
    const allEditableSelected = editableUserIds.size > 0 && Array.from(editableUserIds).every((id) => selectedIds.has(id));
    if (allEditableSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(editableUserIds));
  };

  const handleBatchDepartment = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeptLoading(true);
    setError(null);
    try {
      const dept = batchDepartment.trim() || null;
      await batchUpdateDepartment(Array.from(selectedIds), dept);
      setUsers((prev) =>
        prev.map((u) => (selectedIds.has(u.id) ? { ...u, department: dept } : u)),
      );
      setSelectedIds(new Set());
      setBatchDepartment('');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update departments');
    } finally {
      setBatchDeptLoading(false);
    }
  };

  const handleDepartmentChange = async (user: AdminUser, newDept: string | null) => {
    const value = newDept === '' ? null : newDept;
    try {
      await updateUserDepartment(user.id, value);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, department: value } : u)));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update department');
    }
  };

  const handleRoleChange = async (user: AdminUser, newRole: 'admin' | 'teacher') => {
    if (user.role === newRole) return;
    try {
      await updateUserRole(user.id, newRole);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update role');
    }
  };

  const openDeleteConfirm = (user: AdminUser) => {
    setDeleteTarget(user);
    setDeleteConfirmInput('');
  };
  const closeDeleteConfirm = () => {
    setDeleteTarget(null);
    setDeleteConfirmInput('');
  };
  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleteConfirmInput !== deleteTarget.username) return;
    setDeleteLoading(true);
    setError(null);
    try {
      await deleteUser(deleteTarget.id, deleteConfirmInput);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      closeDeleteConfirm();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete user');
    } finally {
      setDeleteLoading(false);
    }
  };

  const openStudentLoginDialog = async () => {
    if (!USE_CLOUD_STORAGE) return;
    setStudentLoginBusy(true);
    setStudentLoginPhase('preview');
    setStudentLoginResult(null);
    setError(null);
    try {
      const list = await loadStudents();
      const withNumber = list.filter((s) => s.studentNumber != null && String(s.studentNumber).trim() !== '');
      setStudentLoginPreview(
        withNumber.map((s) => ({
          studentId: s.id,
          nameZh: s.nameZh ?? '',
          nameEn: s.nameEn ?? '',
          studentNumber: String(s.studentNumber).trim(),
          password: randomSixDigitPassword(),
        })),
      );
      setStudentLoginOpen(true);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load students');
    } finally {
      setStudentLoginBusy(false);
    }
  };

  const confirmStudentLoginImport = async () => {
    if (studentLoginPreview.length === 0) return;
    setStudentLoginBusy(true);
    setError(null);
    try {
      const { created, skipped } = await importStudentAccounts(
        studentLoginPreview.map((r) => ({ studentId: r.studentId, password: r.password })),
      );
      setStudentLoginResult({ created: created.length, skipped: skipped.length });
      setStudentLoginPhase('done');
      if (adminTab === 'users' && userListScope === 'students') {
        const next = await loadUsers('students');
        setUsers(next);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Import failed');
    } finally {
      setStudentLoginBusy(false);
    }
  };

  const closeStudentLoginDialog = () => {
    setStudentLoginOpen(false);
    setStudentLoginPreview([]);
    setStudentLoginPhase('preview');
    setStudentLoginResult(null);
  };

  const createEmptySubject = () => ({
    subjectNameZh: '',
    subjectNameEn: '',
    moduleType: 'subject_score' as const,
    enableScore: true,
    enableTeacherComment: true,
    enableTarget: true,
    scorePreview: '',
    commentPreview: '',
    scoreVisibility: 'teacher_homeroom_admin' as const,
    dimensions: [] as Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>,
  });

  const addReportTemplateSubject = () => {
    setReportSettingSubjects((prev) => [
      ...prev,
      createEmptySubject(),
    ]);
  };

  const addModuleToDesigner = (moduleKey: EvaluationDesignerModule) => {
    setEnabledEvaluationModules((prev) => ({ ...prev, [moduleKey]: true }));
    setEvaluationModuleOrder((prev) => (prev.includes(moduleKey) ? prev : [...prev, moduleKey]));
    if (moduleKey === 'subject_evaluation') {
      setReportSettingSubjects((prev) => (prev.length > 0 ? prev : [createEmptySubject()]));
    }
  };

  const removeModuleFromDesigner = (moduleKey: EvaluationDesignerModule) => {
    setEnabledEvaluationModules((prev) => ({ ...prev, [moduleKey]: false }));
    setEvaluationModuleOrder((prev) => prev.filter((k) => k !== moduleKey));
    if (moduleKey === 'homeroom_comment') {
      setReportSettingHomeroomCommentMode('optional');
    }
    if (moduleKey === 'subject_evaluation') {
      setReportSettingSubjects([]);
    }
  };

  const moveModuleCard = (moduleKey: EvaluationDesignerModule, direction: 'up' | 'down') => {
    setEvaluationModuleOrder((prev) => {
      const idx = prev.indexOf(moduleKey);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const toReportGrade = (rawScore: string): ReportGrade | null => {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) return null;
    if (score === 100) return 'A+';
    if (score >= 95 && score < 100) return 'A';
    if (score >= 90 && score < 95) return 'A-';
    if (score >= 85 && score < 90) return 'B+';
    if (score >= 80 && score < 85) return 'B';
    if (score >= 75 && score < 80) return 'B-';
    if (score >= 70 && score < 75) return 'C+';
    if (score >= 65 && score < 70) return 'C';
    if (score >= 60 && score < 65) return 'C-';
    if (score >= 0 && score < 60) return 'D';
    return null;
  };

  const addReportTemplateDimension = (subjectIdx: number) => {
    setReportSettingSubjects((prev) => {
      const next = [...prev];
      const subject = next[subjectIdx];
      if (!subject) return prev;
      const nextDimensions = [
        ...subject.dimensions,
        { dimensionLabelZh: '', dimensionLabelEn: '', levelDescriptions: {} },
      ];
      next[subjectIdx] = { ...subject, dimensions: nextDimensions };
      return next;
    });
  };

  const evaluationModuleOptions: Array<{
    key: EvaluationDesignerModule;
    title: string;
    description: string;
  }> = [
    {
      key: 'homeroom_comment',
      title: isZh ? '班主任综合评价' : 'Homeroom evaluation',
      description: isZh ? '用于填写班主任综合评价。' : 'Homeroom summary evaluation.',
    },
    {
      key: 'subject_evaluation',
      title: isZh ? '学科评价' : 'Subject evaluation',
      description: isZh ? '统一配置学科，并按需开启成绩/目标达成/学科评语。' : 'Configure subjects and enable score/target/comment as needed.',
    },
  ];

  const hasSubjectEvaluationEnabled = enabledEvaluationModules.subject_evaluation;

  const deriveEnabledModulesFromTemplate = (
    homeroomMode: HomeroomCommentMode,
    subjects: Array<{ enableScore: boolean; enableTeacherComment: boolean; dimensions: unknown[] }>,
  ): Record<EvaluationDesignerModule, boolean> => ({
    homeroom_comment: homeroomMode !== 'disabled',
    subject_evaluation: subjects.length > 0,
  });

  const deriveModuleOrderFromEnabled = (enabled: Record<EvaluationDesignerModule, boolean>) => (
    evaluationModuleOptions
      .map((m) => m.key)
      .filter((k) => enabled[k])
  );

  const activeEvaluationModules = evaluationModuleOrder.filter((m) => enabledEvaluationModules[m]);

  const inactiveEvaluationModules = evaluationModuleOptions.filter((m) => !enabledEvaluationModules[m.key]);

  const buildTemplateSubjectsByModules = () => {
    if (!hasSubjectEvaluationEnabled) return [];
    return reportSettingSubjects.map((s) => {
      const normalizedModuleType: 'subject_score' | 'subject_comment' | 'non_score_comment' = s.enableScore
        ? 'subject_score'
        : (s.enableTeacherComment ? 'subject_comment' : 'non_score_comment');
      return {
        subjectNameZh: s.subjectNameZh,
        subjectNameEn: s.subjectNameEn,
        moduleType: normalizedModuleType,
        enableScore: s.enableScore,
        enableTeacherComment: s.enableTeacherComment,
        scoreVisibility: s.scoreVisibility,
        dimensions: s.enableTarget ? s.dimensions : [],
      };
    });
  };

  const validateSubjectEvaluationBeforeSave = (): string | null => {
    if (!hasSubjectEvaluationEnabled) return null;
    if (reportSettingSubjects.length === 0) {
      return isZh ? '已启用“学科评价”，请至少添加一个学科后再保存。' : 'Subject evaluation is enabled. Add at least one subject before saving.';
    }
    for (let i = 0; i < reportSettingSubjects.length; i += 1) {
      const s = reportSettingSubjects[i];
      if (!String(s.subjectNameZh ?? '').trim()) {
        return isZh ? `第 ${i + 1} 个学科名称为空，请填写后再保存。` : `Subject #${i + 1} name is empty. Please fill it before saving.`;
      }
      if (s.enableTarget && s.dimensions.length === 0) {
        return isZh ? `第 ${i + 1} 个学科已开启“目标达成”，请至少添加一个维度。` : `Subject #${i + 1} has target enabled. Add at least one dimension.`;
      }
    }
    return null;
  };

  const saveReportTemplate = async () => {
    if (!USE_CLOUD_STORAGE) {
      setError(isZh ? '学业报告模板需开启云端模式（VITE_USE_CLOUD_STORAGE=true）并连接 API。' : 'Report templates require cloud mode and API.');
      return;
    }
    if (!selectedReportTemplateId) return;
    const validationError = validateSubjectEvaluationBeforeSave();
    if (validationError) {
      setError(validationError);
      return;
    }
    setReportSettingSaving(true);
    setError(null);
    try {
      await api.upsertAdminReportTemplate({
        templateId: selectedReportTemplateId,
        title: reportSettingTitle || null,
        status: reportSettingStatus,
        homeroomCommentMode: enabledEvaluationModules.homeroom_comment ? reportSettingHomeroomCommentMode : 'disabled',
        subjects: buildTemplateSubjectsByModules(),
      });
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      await loadReportTemplateSetting(selectedReportTemplateId);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save report template');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const createEvaluationTemplate = async () => {
    if (!reportSettingYearId) return;
    const validationError = validateSubjectEvaluationBeforeSave();
    if (validationError) {
      setError(validationError);
      return;
    }
    setReportSettingSaving(true);
    setError(null);
    try {
      const created = await api.createAdminReportTemplate({
        academicYearId: reportSettingYearId,
        term: reportSettingTerm,
        title: createEvaluationTitle.trim() || null,
        sourceTemplateId: createEvaluationFromTemplateId || null,
      });
      if (created.id) {
        await api.upsertAdminReportTemplate({
          templateId: created.id,
          title: createEvaluationTitle.trim() || null,
          status: 'draft',
          homeroomCommentMode: enabledEvaluationModules.homeroom_comment ? reportSettingHomeroomCommentMode : 'disabled',
          subjects: buildTemplateSubjectsByModules(),
        });
      }
      setCreateEvaluationOpen(false);
      setCreateEvaluationTitle('');
      setCreateEvaluationFromTemplateId('');
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (created.id) {
        setSelectedReportTemplateId(created.id);
        await loadReportTemplateSetting(created.id);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create evaluation template');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const pickSourceTemplateForCreate = async (templateId: string) => {
    setCreateEvaluationFromTemplateId(templateId);
    if (!templateId) {
      setReportSettingSubjects([]);
      setReportSettingHomeroomCommentMode('optional');
      const defaultModules = {
        homeroom_comment: false,
        subject_evaluation: true,
      } as Record<EvaluationDesignerModule, boolean>;
      setEnabledEvaluationModules(defaultModules);
      setEvaluationModuleOrder(deriveModuleOrderFromEnabled(defaultModules));
      setCreateEvaluationTitle('');
      setReportSettingTitle('');
      return;
    }
    const tpl = await loadReportTemplateSetting(templateId);
    const copiedTitle = tpl?.title ?? '';
    setCreateEvaluationTitle(copiedTitle);
    setReportSettingTitle(copiedTitle);
  };

  const openCreateEvaluationDesigner = async () => {
    setCreateEvaluationMode('create');
    setCreateEvaluationTitle('');
    setReportSettingTitle('');
    setCreateEvaluationFromTemplateId('');
    setReportSettingHomeroomCommentMode('optional');
    const defaultModules = {
      homeroom_comment: false,
      subject_evaluation: true,
    } as Record<EvaluationDesignerModule, boolean>;
    setEnabledEvaluationModules(defaultModules);
    setEvaluationModuleOrder(deriveModuleOrderFromEnabled(defaultModules));
    setReportSettingSubjects([]);
    setCreateEvaluationOpen(true);
  };

  const openEditEvaluationDesigner = async (templateId: string) => {
    setCreateEvaluationMode('edit');
    setCreateEvaluationOpen(true);
    setSelectedReportTemplateId(templateId);
    const tpl = await loadReportTemplateSetting(templateId);
    const initialTitle = tpl?.title ?? '';
    setCreateEvaluationTitle(initialTitle);
    setReportSettingTitle(initialTitle);
  };

  const submitEvaluationDesigner = async () => {
    if (createEvaluationMode === 'edit') {
      await saveReportTemplate();
      setCreateEvaluationOpen(false);
      return;
    }
    await createEvaluationTemplate();
  };

  const setTemplateStatus = async (templateId: string, nextStatus: ReportTemplateStatus) => {
    if (!templateId) return;
    setReportSettingSaving(true);
    setError(null);
    try {
      if (nextStatus === 'published') await api.publishAdminReportTemplate(templateId);
      if (nextStatus === 'closed') await api.closeAdminReportTemplate(templateId);
      if (nextStatus === 'draft') {
        const tpl = await api.getAdminReportTemplate(templateId);
        await api.upsertAdminReportTemplate({
          templateId,
          title: tpl.title ?? null,
          status: 'draft',
          homeroomCommentMode: tpl.homeroomCommentMode,
          subjects: (tpl.subjects ?? []).map((s) => ({
            subjectNameZh: s.subjectNameZh || s.subjectName,
            subjectNameEn: s.subjectNameEn || s.subjectName,
            moduleType: s.moduleType,
            enableScore: s.enableScore,
            enableTeacherComment: s.enableTeacherComment,
            scoreVisibility: s.scoreVisibility,
            dimensions: (s.dimensions ?? []).map((d) => ({
              dimensionLabelZh: d.dimensionLabelZh || d.dimensionLabel,
              dimensionLabelEn: d.dimensionLabelEn || d.dimensionLabel,
              levelDescriptions: d.levelDescriptions ?? {},
            })),
          })),
        });
      }
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (selectedReportTemplateId === templateId) {
        await loadReportTemplateSetting(templateId);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update template status');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const releaseTemplateToStudents = async (templateId: string) => {
    if (!templateId) return;
    setReportSettingSaving(true);
    setError(null);
    try {
      await api.releaseAdminReportTemplate(templateId);
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (selectedReportTemplateId === templateId) {
        await loadReportTemplateSetting(templateId);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to release report template');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const openProgressConfirm = async (templateId: string, templateTitle: string | null) => {
    if (!templateId) return;
    setProgressConfirmOpen(true);
    setProgressLoading(true);
    setProgressData(null);
    setProgressTemplateTitle(templateTitle || (isZh ? '未命名评价' : 'Untitled evaluation'));
    setError(null);
    try {
      const progress = await api.getAdminReportTemplateProgress(templateId);
      setProgressData(progress);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load report progress');
    } finally {
      setProgressLoading(false);
    }
  };

  const remindTeachers = async (message: string) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setError(isZh ? '提醒文案已复制，可直接粘贴发送给老师。' : 'Reminder message copied. Paste to send to teachers.');
      window.setTimeout(() => setError((prev) => (
        prev === (isZh ? '提醒文案已复制，可直接粘贴发送给老师。' : 'Reminder message copied. Paste to send to teachers.')
          ? null
          : prev
      )), 1800);
    } catch {
      setError(isZh ? '复制失败，请手动复制提醒文案。' : 'Copy failed. Please copy the reminder manually.');
    }
  };

  const normalizeSubjectKey = (input: string): string => {
    const normalized = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    return normalized || 'subject';
  };

  const upsertStaffingAssignment = async (input: {
    academicYearId: string;
    classId: string;
    subjectKey: string;
    subjectName: string;
    teacherId: string | null;
  }) => {
    const key = `${input.classId}::${input.subjectKey}`;
    setStaffingSavingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setError(null);
    try {
      const existing = staffingAssignments.find((a) => (
        a.academicYearId === input.academicYearId
        && a.classId === input.classId
        && a.subjectKey === input.subjectKey
      ));
      if (!input.teacherId) {
        if (existing) {
          await api.deleteAdminStaffingAssignment({
            academicYearId: input.academicYearId,
            classId: input.classId,
            subjectKey: input.subjectKey,
          });
          setStaffingAssignments((prev) => prev.filter((a) => a.id !== existing.id));
        }
        return;
      }
      await api.upsertAdminStaffingAssignment({
        academicYearId: input.academicYearId,
        classId: input.classId,
        subjectKey: input.subjectKey,
        subjectName: input.subjectName,
        teacherId: input.teacherId,
      });
      const refreshed = await api.getAdminStaffingAssignments(input.academicYearId);
      setStaffingAssignments(refreshed);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save staffing assignment');
    } finally {
      setStaffingSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const deleteEvaluationTemplate = async (templateId: string) => {
    if (!templateId) return;
    const ok = window.confirm(
      isZh
        ? '确认删除这个评价模板？删除后不可恢复。'
        : 'Delete this evaluation template? This action cannot be undone.',
    );
    if (!ok) return;
    setReportSettingSaving(true);
    setError(null);
    try {
      await api.deleteAdminReportTemplate(templateId);
      const chosen = await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (selectedReportTemplateId === templateId) {
        setSelectedReportTemplateId(chosen || '');
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete evaluation template');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const staffingClassList = useMemo(
    () => allClasses
      .filter((c) => c.academicYearId === staffingYearId)
      .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)),
    [allClasses, staffingYearId],
  );

  /** 与课程管理 / 课程河流整体视图一致：按全局 categoryOrder + 学科分组展开为列 */
  const curriculumCategoryOrderKey =
    adminTab === 'staffing' ? JSON.stringify(loadCategoryOrder()) : '';
  const staffingCourseColumns = useMemo(() => {
    const sorted = sortCoursesLikeCurriculumRoadmap(staffingCourses, loadCategoryOrder());
    return sorted.map((course) => ({
      course,
      key: normalizeSubjectKey(course.id || course.name),
      name: getSubjectCategoryText(course.subjectCategory, language) || course.name,
    }));
  }, [staffingCourses, curriculumCategoryOrderKey, staffingCategoryOrderNonce, language]);

  const staffingAssignmentsMap = useMemo(() => {
    const map = new Map<string, StaffingAssignment>();
    staffingAssignments.forEach((assignment) => {
      map.set(`${assignment.classId}::${assignment.subjectKey}`, assignment);
    });
    return map;
  }, [staffingAssignments]);

  const permissionRows: { role: User['role']; panel: boolean; seeUsers: string; canCreate: string; canDelete: string; yearMgmt: string; classMgmt: string }[] = [
    {
      role: 'system-admin',
      panel: true,
      seeUsers: isZh ? '管理员 + 教师' : 'Admin + Teacher',
      canCreate: isZh ? '管理员 + 教师' : 'Admin + Teacher',
      canDelete: isZh ? '管理员 + 教师' : 'Admin + Teacher',
      yearMgmt: isZh ? '可创建/修改' : 'Create/Edit',
      classMgmt: isZh ? '可创建/删除' : 'Create/Delete',
    },
    {
      role: 'admin',
      panel: true,
      seeUsers: isZh ? '全部（仅教师可编）' : 'All (edit teachers only)',
      canCreate: isZh ? '教师' : 'Teacher',
      canDelete: isZh ? '教师' : 'Teacher',
      yearMgmt: isZh ? '仅查看' : 'View only',
      classMgmt: isZh ? '可创建/删除' : 'Create/Delete',
    },
    {
      role: 'teacher',
      panel: false,
      seeUsers: '—',
      canCreate: '—',
      canDelete: '—',
      yearMgmt: '—',
      classMgmt: isZh ? '仅查看' : 'View only',
    },
  ];
  /**
   * 除「课程管理」全宽外，各 tab 共用同一最大宽度。
   * 根布局为 flex-col 时，子项仅写 max-w + mx-auto 会在交叉轴上收缩为「内容宽度」；
   * 学生管理因有宽表格看似正常，班级管理等窄内容会把 main 压成一条——必须加 w-full。
   */
  const adminContentFrameClass = 'w-full max-w-7xl mx-auto px-4 sm:px-6';

  return (
    <div className={`${adminTab === 'courses' ? 'h-screen overflow-hidden' : 'min-h-screen'} bg-slate-50 pt-14 flex flex-col`}>
      <AppTopBar
        title={isZh ? '后台管理' : 'Admin'}
        showBack
        onBack={onBackToHub}
      />
      <div className="border-b border-slate-200 bg-white flex-shrink-0">
        <div className={`${adminContentFrameClass} flex gap-1 flex-wrap`}>
          <button
            type="button"
            onClick={() => { setAdminTab('users'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'users' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '用户管理' : 'Users'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('years'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'years' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '学年管理' : 'Academic years'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('classes'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'classes' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '班级管理' : 'Classes'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('courses'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'courses' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '课程管理' : 'Courses'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('staffing'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'staffing' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '岗位安排' : 'Staffing'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('students'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'students' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '学生管理' : 'Students'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('report-settings'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'report-settings' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '学生画像' : 'Portrait'}
          </button>
          {isSystemAdmin && (
            <button
              type="button"
              onClick={() => { setAdminTab('database'); setError(null); }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'database' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {isZh ? '数据库' : 'Database'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className={`${adminContentFrameClass} pt-4`}>
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-800" aria-label={isZh ? '关闭' : 'Dismiss'}>
              ×
            </button>
          </div>
        </div>
      )}
      <main
        className={
          adminTab === 'courses'
            ? 'flex-1 flex flex-col min-h-0 w-full px-2 py-2 overflow-hidden'
            : `${adminContentFrameClass} py-6 space-y-6`
        }
      >
        {adminTab === 'courses' && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <CurriculumRoadmap surface="admin-course-management" embedded />
          </div>
        )}
        {adminTab === 'users' && (
        <>
        {userListScope === 'staff' && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-slate-800 mb-3">
            {isZh ? '权限说明' : 'Permission reference'}
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-slate-100 text-left text-xs text-slate-600">
                  <th className="py-2 px-3 font-medium">{isZh ? '角色' : 'Role'}</th>
                  <th className="py-2 px-3 font-medium">{isZh ? '后台入口' : 'Admin panel'}</th>
                  <th className="py-2 px-3 font-medium">{isZh ? '可见用户' : 'See users'}</th>
                  <th className="py-2 px-3 font-medium">{isZh ? '可创建' : 'Can create'}</th>
                  <th className="py-2 px-3 font-medium">{isZh ? '可删除' : 'Can delete'}</th>
                  <th className="py-2 px-3 font-medium">{isZh ? '学年管理' : 'Year mgmt'}</th>
                  <th className="py-2 px-3 font-medium">{isZh ? '班级管理' : 'Class mgmt'}</th>
                </tr>
              </thead>
              <tbody>
                {permissionRows.map((row) => (
                  <tr key={row.role} className="border-t border-slate-100">
                    <td className="py-2 px-3 font-medium text-slate-800">{ROLE_LABELS[row.role][isZh ? 'zh' : 'en']}</td>
                    <td className="py-2 px-3">{row.panel ? (isZh ? '✓' : 'Yes') : '—'}</td>
                    <td className="py-2 px-3 text-slate-600">{row.seeUsers}</td>
                    <td className="py-2 px-3 text-slate-600">{row.canCreate}</td>
                    <td className="py-2 px-3 text-slate-600">{row.canDelete}</td>
                    <td className="py-2 px-3 text-slate-600">{row.yearMgmt}</td>
                    <td className="py-2 px-3 text-slate-600">{row.classMgmt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {isZh ? '系统管理员可在下方用户列表中直接修改「管理员」「教师」的角色（升级或降级）。学生账号由「学生管理 → 学生登录」开通，可在「所有用户 → 学生账号」中查看。' : 'System admin can change admin/teacher roles below. Student logins are created under Students → Student login; view them under All users → Student accounts.'}
          </p>
        </section>
        )}

        {userListScope === 'staff' && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
          <h2 className="text-base sm:text-lg font-semibold text-slate-800">
            {isZh ? '创建新用户' : 'Create New User'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 sm:items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '用户名（登录账号）' : 'Username'}</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={isZh ? '如 admin2' : 'e.g. admin2'}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '显示名称' : 'Display name'}</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={isZh ? '可选，不填则等于用户名' : 'Optional'}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '角色' : 'Role'}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as User['role'])}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r][isZh ? 'zh' : 'en']}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '初始密码' : 'Initial password'}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={isZh ? '建议先简单，登录后再改' : 'Temporary password'}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '部门/分组' : 'Department'}</label>
              <input
                value={departmentCreate}
                onChange={(e) => setDepartmentCreate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={isZh ? '可选' : 'Optional'}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleCreate}
              disabled={!username || !password || creating}
            >
              {creating ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建用户' : 'Create user'}
            </Button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </section>
        )}

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <div className="flex flex-col gap-3 mb-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {isZh ? '列表' : 'List'}
              </span>
              <button
                type="button"
                onClick={() => { setUserListScope('staff'); setSelectedIds(new Set()); }}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${userListScope === 'staff' ? 'border-slate-800 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {isZh ? '教职工' : 'Staff'}
              </button>
              <button
                type="button"
                onClick={() => { setUserListScope('students'); setSelectedIds(new Set()); }}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${userListScope === 'students' ? 'border-slate-800 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {isZh ? '学生账号' : 'Student accounts'}
              </button>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                {userListScope === 'staff' ? (isZh ? '所有用户（教职工）' : 'All users (staff)') : (isZh ? '所有用户（学生账号）' : 'All users (students)')}
              </h2>
              {loading && (
                <span className="text-xs text-slate-500">
                  {isZh ? '加载中…' : 'Loading…'}
                </span>
              )}
              {!loading && userListScope === 'staff' && displayedUsers.length > 0 && selectedIds.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500">
                    {isZh ? `已选 ${selectedIds.size} 人` : `Selected ${selectedIds.size}`}
                  </span>
                  <input
                    value={batchDepartment}
                    onChange={(e) => setBatchDepartment(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-32"
                    placeholder={isZh ? '部门名称' : 'Department'}
                  />
                  <Button
                    size="sm"
                    onClick={handleBatchDepartment}
                    disabled={batchDeptLoading}
                  >
                    {batchDeptLoading ? (isZh ? '处理中…' : 'Updating…') : isZh ? '设为分组' : 'Set group'}
                  </Button>
                </div>
              )}
            </div>
          </div>
          {!loading && userListScope === 'students' && !USE_CLOUD_STORAGE && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
              {isZh ? '当前为本地模式，学生账号列表与导入仅在使用云端存储时可用。请在 .env 中启用 VITE_USE_CLOUD_STORAGE=true 并登录。' : 'Local mode: student account list and import require cloud mode. Set VITE_USE_CLOUD_STORAGE=true and sign in.'}
            </p>
          )}
          {!loading && displayedUsers.length === 0 && (
            <p className="text-sm text-slate-500">
              {userListScope === 'students'
                ? (isZh ? '暂无学生登录账号。可在「学生管理」中使用「学生登录」批量开通。' : 'No student accounts yet. Use Student login under Students.')
                : (isZh ? '暂时没有用户数据。' : 'No users yet.')}
            </p>
          )}
          {displayedUsers.length > 0 && userListScope === 'staff' && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={editableUserIds.size > 0 && Array.from(editableUserIds).every((id) => selectedIds.has(id))}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">{isZh ? '用户名' : 'Username'}</th>
                    <th className="py-2 pr-4">{isZh ? '显示名称' : 'Display name'}</th>
                    <th className="py-2 pr-4">{isZh ? '角色' : 'Role'}</th>
                    <th className="py-2 pr-4">{isZh ? '部门' : 'Department'}</th>
                    <th className="py-2 pr-4">{isZh ? '密码' : 'Password'}</th>
                    <th className="py-2 pr-4">{isZh ? '创建时间' : 'Created at'}</th>
                    <th className="py-2 pr-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {displayedUsers.map((u) => {
                    const hasPassword = u.password != null && u.password !== '';
                    const revealed = passwordRevealed[u.id];
                    return (
                      <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={() => toggleSelect(u.id)}
                            disabled={!canEditUser(u)}
                            className="rounded border-slate-300 disabled:opacity-50"
                          />
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-500 truncate max-w-[120px]">{u.id}</td>
                        <td className="py-2 pr-4">{u.username}</td>
                        <td className="py-2 pr-4">{u.displayName}</td>
                        <td className="py-2 pr-4">
                          {currentUser?.role === 'system-admin' && u.role !== 'system-admin' && u.role !== 'student' ? (
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'teacher')}
                              className="text-sm rounded border border-slate-300 px-2 py-1 bg-white min-w-[100px]"
                            >
                              <option value="admin">{ROLE_LABELS.admin[isZh ? 'zh' : 'en']}</option>
                              <option value="teacher">{ROLE_LABELS.teacher[isZh ? 'zh' : 'en']}</option>
                            </select>
                          ) : (
                            ROLE_LABELS[u.role][isZh ? 'zh' : 'en']
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {canEditUser(u) ? (
                            <select
                              value={u.department ?? ''}
                              onChange={(e) => handleDepartmentChange(u, e.target.value || null)}
                              className="text-sm rounded border border-slate-300 px-2 py-1 bg-white min-w-[100px]"
                            >
                              <option value="">—</option>
                              {departmentOptions.map((d) => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                              {u.department && u.department.trim() && !departmentOptions.includes(u.department.trim()) && (
                                <option value={u.department}>{u.department}</option>
                              )}
                            </select>
                          ) : (
                            <span className="text-slate-600">{u.department ?? '—'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {hasPassword ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-mono text-xs">
                                {revealed ? u.password : '••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPasswordRevealed((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                                title={revealed ? (isZh ? '隐藏密码' : 'Hide password') : (isZh ? '显示密码' : 'Show password')}
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">{isZh ? '不可查看' : 'N/A'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-xs text-slate-500">
                          {u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-2 pr-2">
                          {canDeleteUser(u) ? (
                            <button
                              type="button"
                              onClick={() => openDeleteConfirm(u)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                              title={isZh ? '删除' : 'Delete'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {displayedUsers.length > 0 && userListScope === 'students' && USE_CLOUD_STORAGE && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">{isZh ? '学号（登录名）' : 'Student no. (login)'}</th>
                    <th className="py-2 pr-4">{isZh ? '显示名称' : 'Display name'}</th>
                    <th className="py-2 pr-4">{isZh ? '中文名' : 'Name (ZH)'}</th>
                    <th className="py-2 pr-4">{isZh ? '英文名' : 'Name (EN)'}</th>
                    <th className="py-2 pr-4">{isZh ? '学籍 ID' : 'Student record'}</th>
                    <th className="py-2 pr-4">{isZh ? '密码' : 'Password'}</th>
                    <th className="py-2 pr-4">{isZh ? '创建时间' : 'Created at'}</th>
                    <th className="py-2 pr-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {displayedUsers.map((u) => {
                    const hasPassword = u.password != null && u.password !== '';
                    const revealed = passwordRevealed[u.id];
                    return (
                      <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-4 font-mono text-xs text-slate-500 truncate max-w-[100px]">{u.id}</td>
                        <td className="py-2 pr-4 font-mono">{u.username}</td>
                        <td className="py-2 pr-4">{u.displayName}</td>
                        <td className="py-2 pr-4">{u.studentNameZh ?? '—'}</td>
                        <td className="py-2 pr-4">{u.studentNameEn ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-600">{u.studentId ?? '—'}</td>
                        <td className="py-2 pr-4">
                          {hasPassword ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-mono text-xs">
                                {revealed ? u.password : '••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPasswordRevealed((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                                title={revealed ? (isZh ? '隐藏密码' : 'Hide password') : (isZh ? '显示密码' : 'Show password')}
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">{isZh ? '不可查看' : 'N/A'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-xs text-slate-500">
                          {u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-2 pr-2">
                          {canDeleteUser(u) ? (
                            <button
                              type="button"
                              onClick={() => openDeleteConfirm(u)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                              title={isZh ? '删除登录账号' : 'Remove login'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}

        {adminTab === 'years' && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">{isZh ? '学年管理' : 'Academic years'}</h2>
            {!canEditYears && (
              <p className="text-sm text-slate-500">{isZh ? '仅系统管理员可创建和修改学年。' : 'Only system admin can create and modify academic years.'}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-700">{isZh ? '当前学年' : 'Current year'}</label>
              <select
                value={currentYearId || ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setCurrentYearId(id);
                  setCurrentAcademicYearIdAndSync(id);
                }}
                disabled={!canEditYears}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">—</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </select>
              {canEditYears && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setDialogCreateYear(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    {isZh ? '新建学年' : 'New year'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDialogYearManagement(true)}>
                    {isZh ? '学年管理' : 'Year management'}
                  </Button>
                </>
              )}
            </div>
            {currentYearId && (
              <p className="text-xs text-slate-500 mt-2">
                {isZh
                  ? `本学年共有 ${currentYearClassCount ?? 0} 个班级，${currentYearStudentCount ?? 0} 名学生（按学籍统计）。`
                  : `This year has ${currentYearClassCount ?? 0} classes and ${currentYearStudentCount ?? 0} students (by enrollments).`}
              </p>
            )}
            {yearLoading && <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>}

            {currentYearId && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">
                  {isZh ? '当前学年班级列表' : 'Classes in current year'}
                </h3>
                {currentYearClasses.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {isZh ? '本学年暂无班级。' : 'No classes in this academic year.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border border-slate-200 rounded-lg">
                      <thead>
                        <tr className="bg-slate-100 text-left text-xs text-slate-600">
                          <th className="py-2 px-3 font-medium">{isZh ? '年级' : 'Grade'}</th>
                          <th className="py-2 px-3 font-medium">{isZh ? '班级名称' : 'Class name'}</th>
                          <th className="py-2 px-3 font-medium">{isZh ? '学生数' : 'Students'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentYearClasses.map(({ cls, studentCount }) => (
                          <tr key={cls.id} className="border-t border-slate-100">
                            <td className="py-2 px-3 text-slate-700">{getGradeLabel(cls.grade)}</td>
                            <td className="py-2 px-3 text-slate-800">{cls.name}</td>
                            <td className="py-2 px-3 text-slate-700">{studentCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {adminTab === 'classes' && (
          <div className="mt-4 w-full min-w-0">
            <ClassManagement
              onBackToHub={() => {}}
              embedded
              hideYearGear={false}
              pageTitle={isZh ? '班级管理' : 'Classes'}
            />
          </div>
        )}

        {adminTab === 'staffing' && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                  {isZh ? '岗位安排' : 'Staffing roster'}
                </h2>
                <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                  {isZh
                    ? '表头为课程管理中的课程顺序；左侧为班级。年级不匹配时格内为「—」。'
                    : 'Header row: course order from Admin → Courses. Left: classes. “—” when grade does not match.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="text-sm font-medium text-slate-700 whitespace-nowrap">{isZh ? '学年' : 'Year'}</label>
                <select
                  value={staffingYearId}
                  onChange={(e) => setStaffingYearId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                  disabled={staffingLoading || allYears.length === 0}
                >
                  {allYears.length === 0 ? (
                    <option value="">{isZh ? '暂无学年' : 'No years'}</option>
                  ) : (
                    allYears.map((y) => (
                      <option key={y.id} value={y.id}>{y.name}</option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {staffingLoading ? (
              <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
            ) : !staffingYearId ? (
              <p className="text-sm text-slate-500">{isZh ? '请先创建学年。' : 'Create an academic year first.'}</p>
            ) : !USE_CLOUD_STORAGE ? (
              <p className="text-sm text-slate-500">
                {isZh ? '岗位安排需要云端模式（VITE_USE_CLOUD_STORAGE=true）才能保存。' : 'Staffing requires cloud mode to persist.'}
              </p>
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 overflow-x-auto">
                  {staffingClassList.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-slate-500">{isZh ? '该学年下暂无班级。' : 'No classes in this year.'}</p>
                  ) : staffingCourseColumns.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-slate-500">
                      {isZh ? '暂无课程数据，请先在「课程管理」中添加课程并设置年级跨度。' : 'No courses yet. Add courses under Admin → Courses with grade ranges.'}
                    </p>
                  ) : (
                    <table className="min-w-max w-full text-sm border-collapse">
                      <thead className="bg-slate-50 text-left text-xs text-slate-600">
                        <tr>
                          <th
                            className="sticky left z-10 bg-slate-50 border-b border-r border-slate-200 px-2 py-2 align-bottom min-w-[7.5rem] max-w-[10rem]"
                            title={isZh ? '班级：首列；教师：格内；课程：首行' : 'Class: first column; Teacher: cells; Course: header row'}
                          >
                            <div className="text-[11px] font-semibold text-slate-800 leading-snug">
                              {isZh ? '班级 / 教师 / 课程' : 'Class / Teacher / Course'}
                            </div>
                          </th>
                          {staffingCourseColumns.map((col) => (
                            <th
                              key={col.key}
                              className="border-b border-slate-200 px-2 py-2 font-medium align-bottom min-w-[120px] max-w-[180px]"
                            >
                              <div className="text-[13px] font-semibold text-slate-800 leading-snug line-clamp-2" title={col.name}>
                                {col.name}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {staffingClassList.map((cls) => (
                          <tr key={cls.id} className="border-t border-slate-100">
                            <td className="sticky left z-[1] bg-white border-r border-slate-100 px-3 py-2 align-top">
                              <div className="font-medium text-slate-800">{`${getGradeLabel(cls.grade)} ${cls.name}`}</div>
                            </td>
                            {staffingCourseColumns.map((col) => {
                              const applies = courseAppliesToGrade(
                                col.course,
                                cls.grade,
                                normalizeGradeConfig(loadGradeConfigSync()),
                              );
                              if (!applies) {
                                return (
                                  <td key={`${cls.id}-${col.key}`} className="px-2 py-2 align-top bg-slate-50/60 text-center text-slate-300 text-xs">
                                    —
                                  </td>
                                );
                              }
                              const rowKey = `${cls.id}::${col.key}`;
                              const assigned = staffingAssignmentsMap.get(rowKey);
                              const currentTeacherId = assigned?.teacherId ?? '';
                              const isSaving = staffingSavingKeys.has(rowKey);
                              return (
                                <td key={rowKey} className="px-2 py-2 align-middle border-l border-slate-100 text-center">
                                  <select
                                    value={currentTeacherId}
                                    onChange={(e) => {
                                      void upsertStaffingAssignment({
                                        academicYearId: staffingYearId,
                                        classId: cls.id,
                                        subjectKey: col.key,
                                        subjectName: col.name,
                                        teacherId: e.target.value || null,
                                      });
                                    }}
                                    disabled={isSaving}
                                    title={col.name}
                                    className="w-full max-w-[11rem] mx-auto rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-sm font-medium text-slate-800 text-center cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400 appearance-none bg-no-repeat pr-5 bg-[length:0.65rem] bg-[right_0.35rem_center]"
                                    style={{
                                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                    }}
                                  >
                                    <option value="">{isZh ? '—' : '—'}</option>
                                    {staffingTeachers.map((teacher) => (
                                      <option key={teacher.id} value={teacher.id}>
                                        {teacher.displayName || teacher.username}
                                      </option>
                                    ))}
                                  </select>
                                  {isSaving && (
                                    <div className="text-[10px] text-slate-400 mt-0.5">{isZh ? '…' : '…'}</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {adminTab === 'students' && (
          <>
            {/* 与班级管理一致：第一块仅「当前学年」 */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-slate-700">{isZh ? '当前学年' : 'Academic year'}</label>
                <select
                  value={studentCurrentYearId || ''}
                  onChange={(e) => setStudentCurrentYearId(e.target.value || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                >
                  <option value="">—</option>
                  {allYears.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </div>
            </section>

            {/* 第二块：标题 + 创建按钮 + 筛选 + 表格（与「班级列表」卡片结构一致） */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold text-slate-800">
                  {studentCurrentYearId
                    ? `${allYears.find((y) => y.id === studentCurrentYearId)?.name ?? ''} — ${isZh ? '学生列表' : 'Students'}`
                    : (isZh ? '学生列表' : 'Student list')}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openStudentLoginDialog()}
                    disabled={!USE_CLOUD_STORAGE || studentLoginBusy}
                    title={
                      !USE_CLOUD_STORAGE
                        ? (isZh ? '需开启云端存储后从服务器导入登录账号' : 'Requires cloud mode')
                        : (isZh ? '为有学号的学生生成密码并导入服务器' : 'Import login accounts for students with student number')
                    }
                  >
                    <LogIn className="h-4 w-4 mr-1" />
                    {studentLoginBusy ? (isZh ? '准备中…' : 'Loading…') : isZh ? '学生登录' : 'Student login'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setDialogCreateStudent(true)}
                    disabled={!studentCurrentYearId}
                    title={!studentCurrentYearId ? (isZh ? '请先选择当前学年' : 'Select current year first') : undefined}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {isZh ? '创建学生' : 'Create student'}
                  </Button>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">{isZh ? '筛选：' : 'Filter:'}</span>
                <input
                  value={studentFilterName}
                  onChange={(e) => setStudentFilterName(e.target.value)}
                  placeholder={isZh ? '中文名/英文名/学号' : 'Chinese/English name or ID'}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-36 placeholder:text-slate-400"
                />
                <input
                  value={studentFilterGrade}
                  onChange={(e) => setStudentFilterGrade(e.target.value)}
                  placeholder={isZh ? '当前年级' : 'Current grade'}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-24 placeholder:text-slate-400"
                />
                <select
                  value={studentFilterClass}
                  onChange={(e) => setStudentFilterClass(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white min-w-[120px] text-slate-700"
                >
                  <option value="">{isZh ? '全部班级' : 'All classes'}</option>
                  {allClasses.map((c) => {
                    const year = allYears.find((y) => y.id === c.academicYearId);
                    return (
                      <option key={c.id} value={c.id}>
                        {year ? `${year.name} · ` : ''}{c.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {studentLoading ? (
                <p className="text-sm text-slate-500 py-4">{isZh ? '加载中…' : 'Loading…'}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-left text-xs text-slate-600">
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('nameZh');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '中文名' : 'Chinese name'}
                            {studentSortField === 'nameZh' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('nameEn');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '英文名' : 'English name'}
                            {studentSortField === 'nameEn' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('currentGrade');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '当前年级' : 'Current grade'}
                            {studentSortField === 'currentGrade' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('gender');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '性别' : 'Gender'}
                            {studentSortField === 'gender' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('studentNumber');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '学号' : 'Number'}
                            {studentSortField === 'studentNumber' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('dateOfBirth');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '出生日期' : 'DOB'}
                            {studentSortField === 'dateOfBirth' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">{isZh ? '学部' : 'Division'}</th>
                        <th className="py-2.5 px-3 font-medium">{isZh ? '状态' : 'Status'}</th>
                        <th className="py-2.5 px-3 font-medium">{isZh ? '所在班级' : 'Classes'}</th>
                        <th className="py-2.5 px-3 font-medium w-14">{isZh ? '操作' : ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedStudents.length === 0 ? (
                        <tr><td colSpan={11} className="py-8 text-center text-slate-500 text-sm">{isZh ? '暂无学生' : 'No students'}</td></tr>
                      ) : (
                        filteredAndSortedStudents.map((s) => {
                          const myEnrollments = enrollments.filter((e) => e.studentId === s.id);
                          const classLabels = myEnrollments.map((e) => {
                            const cls = allClasses.find((c) => c.id === e.classId);
                            const year = allYears.find((y) => y.id === e.academicYearId);
                            return year && cls ? `${year.name} · ${cls.name}` : cls?.name ?? e.classId;
                          });
                          return (
                            <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-medium text-slate-800">{s.nameZh ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.nameEn ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.currentGrade != null ? `G${s.currentGrade}` : '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {s.gender === 'male' ? (isZh ? '男' : 'M') : s.gender === 'female' ? (isZh ? '女' : 'F') : (isZh ? '其他' : 'Other')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{s.studentNumber ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.dateOfBirth ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.division ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {s.status === 'graduated'
                                  ? (isZh ? '毕业' : 'Graduated')
                                  : s.status === 'leave'
                                    ? (isZh ? '休学' : 'Leave')
                                    : s.status === 'withdrawn'
                                      ? (isZh ? '离校' : 'Withdrawn')
                                      : (isZh ? '在读' : 'Active')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 text-xs">{classLabels.join('; ') || '—'}</td>
                              <td className="py-2.5 px-3">
                                <button
                                  type="button"
                                  onClick={() => openEditStudent(s)}
                                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                                  title={isZh ? '编辑' : 'Edit'}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {adminTab === 'report-settings' && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            {!USE_CLOUD_STORAGE && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {isZh
                  ? '当前为本地模式。请在 apps/web/.env 启用 VITE_USE_CLOUD_STORAGE=true，并配置 VITE_API_URL（如 http://127.0.0.1:8080/api）后刷新，即可测试学业报告模板。'
                  : 'Local mode now. Enable VITE_USE_CLOUD_STORAGE=true and set VITE_API_URL (e.g. http://127.0.0.1:8080/api) to test report templates.'}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学年' : 'Academic year'}</label>
                <select
                  value={reportSettingYearId}
                  onChange={(e) => setReportSettingYearId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">{isZh ? '请选择' : 'Select'}</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学期' : 'Term'}</label>
                <select
                  value={reportSettingTerm}
                  onChange={(e) => setReportSettingTerm(e.target.value as Term)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="Semester 1">{isZh ? '上学期' : 'Semester 1'}</option>
                  <option value="Semester 2">{isZh ? '下学期' : 'Semester 2'}</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void openCreateEvaluationDesigner()}
                  disabled={!reportSettingYearId}
                >
                  {isZh ? '新建评价' : 'New evaluation'}
                </Button>
              </div>
            </div>
            {reportSettingLoading && <div className="text-xs text-slate-500">{isZh ? '加载中…' : 'Loading…'}</div>}

            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                {isZh ? '本学期评价模板（逐条独立管理）' : 'Evaluation templates (independent items)'}
              </div>
              {reportTemplateList.length === 0 ? (
                <p className="text-xs text-slate-500">{isZh ? '本学年学期暂无模板，请先新建评价。' : 'No templates in this year/term yet.'}</p>
              ) : (
                <div className="space-y-2">
                  {reportTemplateList.map((tpl) => (
                    <div
                      key={tpl.id}
                      className={`rounded border px-2 py-2 flex items-center justify-between gap-2 ${tpl.id === selectedReportTemplateId ? 'border-slate-400 bg-slate-50' : 'border-slate-200'}`}
                    >
                      <button
                        type="button"
                        className="text-left flex-1 min-w-0"
                        onClick={() => setSelectedReportTemplateId(tpl.id)}
                      >
                        <div className="text-sm font-medium text-slate-800 truncate">
                          {tpl.title || (isZh ? '未命名评价' : 'Untitled evaluation')}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {isZh
                            ? `状态：${tpl.releasedAt ? '已正式推送' : tpl.status === 'published' ? '已发布待填写' : tpl.status === 'closed' ? '已关闭待推送' : '草稿'}`
                            : `Status: ${tpl.releasedAt ? 'released' : tpl.status}`}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => void openEditEvaluationDesigner(tpl.id)}>
                          {isZh ? '编辑' : 'Edit'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void setTemplateStatus(tpl.id, 'published')}>
                          {isZh ? '发布' : 'Publish'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void setTemplateStatus(tpl.id, 'closed')}>
                          {isZh ? '停发' : 'Stop'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void releaseTemplateToStudents(tpl.id)}
                          disabled={tpl.status !== 'closed' || !!tpl.releasedAt}
                        >
                          {isZh ? '正式推送' : 'Release'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void openProgressConfirm(tpl.id, tpl.title)}>
                          {isZh ? '进度确认' : 'Progress'}
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => void deleteEvaluationTemplate(tpl.id)}>
                          {isZh ? '删除' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              {isZh
                ? '学科、维度、班主任评语模式与保存操作已整合到“新建评价/编辑评价”弹窗。请在上方模板卡片点击“编辑”进入设计界面。'
                : 'Subject/module design and save actions are now inside New/Edit evaluation dialog. Click Edit on a template card above.'}
            </div>
          </section>
        )}

        {adminTab === 'database' && isSystemAdmin && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                {isZh ? '数据库只读浏览' : 'Database read-only browser'}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  void loadDatabaseTables()
                    .then((chosen) => {
                      if (chosen) return loadDatabaseRows(chosen, 0, dbLimit);
                    })
                    .catch((e: unknown) => setError((e as Error)?.message || 'Failed to refresh database view'));
                }}
                disabled={dbTableLoading || dbRowsLoading}
              >
                {isZh ? '刷新' : 'Refresh'}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {isZh
                ? '仅用于查看数据，不支持增删改。'
                : 'Read-only view. Create/update/delete actions are disabled.'}
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  {isZh ? '数据表与行数' : 'Tables and row counts'}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {dbTableLoading ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
                  ) : dbTables.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '未发现数据表。' : 'No tables found.'}</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {dbTables.map((t) => (
                        <li key={t.tableName}>
                          <button
                            type="button"
                            className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${dbSelectedTable === t.tableName ? 'bg-slate-50' : ''}`}
                            onClick={() => {
                              setDbSelectedTable(t.tableName);
                              setDbOffset(0);
                              setError(null);
                              void loadDatabaseRows(t.tableName, 0, dbLimit).catch((e: unknown) =>
                                setError((e as Error)?.message || 'Failed to load table rows')
                              );
                            }}
                          >
                            <div className="font-mono text-xs text-slate-800">{t.tableName}</div>
                            <div className="text-xs text-slate-500">
                              {isZh ? `行数：${t.rowCount}` : `Rows: ${t.rowCount}`}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="lg:col-span-8 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-slate-600">
                    {dbSelectedTable
                      ? (
                        isZh
                          ? <>表：<span className="font-mono text-slate-800">{dbSelectedTable}</span>{dbPrimaryKey ? <>（主键：<span className="font-mono">{dbPrimaryKey}</span>）</> : ''}</>
                          : <>Table: <span className="font-mono text-slate-800">{dbSelectedTable}</span>{dbPrimaryKey ? <> (PK: <span className="font-mono">{dbPrimaryKey}</span>)</> : ''}</>
                      )
                      : (isZh ? '请选择左侧数据表' : 'Select a table on the left')}
                  </div>
                  {dbSelectedTable && (
                    <div className="text-xs text-slate-500">
                      {isZh ? `共 ${dbTotal} 行` : `Total ${dbTotal} rows`}
                    </div>
                  )}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {dbRowsLoading ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
                  ) : !dbSelectedTable ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '请先选择数据表。' : 'Please choose a table first.'}</p>
                  ) : dbColumns.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '该表无字段。' : 'This table has no columns.'}</p>
                  ) : (
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          {dbColumns.map((col) => (
                            <th key={col} className="px-2 py-2 font-medium whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dbRows.length === 0 ? (
                          <tr>
                            <td colSpan={dbColumns.length} className="px-2 py-6 text-center text-slate-500">
                              {isZh ? '暂无数据。' : 'No rows.'}
                            </td>
                          </tr>
                        ) : (
                          dbRows.map((row, idx) => (
                            <tr key={`${dbOffset + idx}`} className="border-b border-slate-100 align-top">
                              {dbColumns.map((col) => {
                                const value = row[col];
                                const display = value == null
                                  ? 'NULL'
                                  : typeof value === 'object'
                                    ? JSON.stringify(value)
                                    : String(value);
                                return (
                                  <td key={`${idx}-${col}`} className="px-2 py-1.5 text-slate-700 max-w-[260px]">
                                    <div className="truncate" title={display}>{display}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                {dbSelectedTable && (
                  <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {isZh
                        ? `第 ${dbTotal === 0 ? 0 : dbOffset + 1} - ${Math.min(dbOffset + dbLimit, dbTotal)} 条`
                        : `${dbTotal === 0 ? 0 : dbOffset + 1}-${Math.min(dbOffset + dbLimit, dbTotal)}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dbRowsLoading || dbOffset <= 0}
                        onClick={() => {
                          const nextOffset = Math.max(0, dbOffset - dbLimit);
                          void loadDatabaseRows(dbSelectedTable, nextOffset, dbLimit).catch((e: unknown) =>
                            setError((e as Error)?.message || 'Failed to load previous page')
                          );
                        }}
                      >
                        {isZh ? '上一页' : 'Prev'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dbRowsLoading || dbOffset + dbLimit >= dbTotal}
                        onClick={() => {
                          const nextOffset = dbOffset + dbLimit;
                          void loadDatabaseRows(dbSelectedTable, nextOffset, dbLimit).catch((e: unknown) =>
                            setError((e as Error)?.message || 'Failed to load next page')
                          );
                        }}
                      >
                        {isZh ? '下一页' : 'Next'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <Dialog open={dialogCreateYear} onOpenChange={setDialogCreateYear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isZh ? '新建学年' : 'New academic year'}</DialogTitle>
            <DialogDescription>{isZh ? '输入学年名称' : 'Enter year name'}</DialogDescription>
          </DialogHeader>
          <input
            value={newYearName}
            onChange={(e) => setNewYearName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder={isZh ? '2024–2025 学年' : '2024–2025'}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCreateYear(false)}>{isZh ? '取消' : 'Cancel'}</Button>
            <Button onClick={handleCreateYear} disabled={!newYearName.trim() || yearSubmitLoading}>
              {yearSubmitLoading ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogYearManagement} onOpenChange={setDialogYearManagement}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '学年管理' : 'Academic years'}</DialogTitle>
            <DialogDescription>{isZh ? '删除学年将同时删除该学年下所有班级与学籍。' : 'Deleting a year removes all its classes and enrollments.'}</DialogDescription>
          </DialogHeader>
          {years.length === 0 ? (
            <p className="text-sm text-slate-500">{isZh ? '暂无学年。' : 'No academic years.'}</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {years.map((y) => (
                <li key={y.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                  <span className="font-medium text-slate-800">{y.name}</span>
                  {canEditYears && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => handleDeleteYear(y)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {isZh ? '删除' : 'Delete'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogYearManagement(false)}>{isZh ? '关闭' : 'Close'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={studentLoginOpen}
        onOpenChange={(open) => {
          if (!open) closeStudentLoginDialog();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{isZh ? '学生登录账号导入' : 'Import student logins'}</DialogTitle>
            <DialogDescription>
              {studentLoginPhase === 'preview'
                ? (isZh
                  ? '以下为当前档案中有学号的学生；确认后将把学号作为用户名、并写入随机 6 位数字密码到服务器。已开通或学号冲突的条目将被跳过。'
                  : 'Students with a student number below. Confirm to create accounts (username = number, random 6-digit password). Existing or conflicting rows are skipped.')
                : (isZh ? '导入已完成。' : 'Import finished.')}
            </DialogDescription>
          </DialogHeader>
          {studentLoginPhase === 'preview' && studentLoginPreview.length === 0 && (
            <p className="text-sm text-slate-500 py-4">
              {isZh ? '没有可导入的学生（需填写学号）。' : 'No students with a student number to import.'}
            </p>
          )}
          {studentLoginPhase === 'preview' && studentLoginPreview.length > 0 && (
            <div className="overflow-auto flex-1 min-h-0 border border-slate-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 text-left text-xs text-slate-600">
                  <tr>
                    <th className="py-2 px-3 font-medium">{isZh ? '学号' : 'No.'}</th>
                    <th className="py-2 px-3 font-medium">{isZh ? '中文名' : 'ZH'}</th>
                    <th className="py-2 px-3 font-medium">{isZh ? '英文名' : 'EN'}</th>
                    <th className="py-2 px-3 font-medium">{isZh ? '随机密码' : 'Password'}</th>
                  </tr>
                </thead>
                <tbody>
                  {studentLoginPreview.map((r) => (
                    <tr key={r.studentId} className="border-t border-slate-100">
                      <td className="py-2 px-3 font-mono">{r.studentNumber}</td>
                      <td className="py-2 px-3">{r.nameZh || '—'}</td>
                      <td className="py-2 px-3">{r.nameEn || '—'}</td>
                      <td className="py-2 px-3 font-mono">{r.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {studentLoginPhase === 'done' && studentLoginResult && (
            <p className="text-sm text-slate-700 py-2">
              {isZh
                ? `成功开通 ${studentLoginResult.created} 个账号；跳过 ${studentLoginResult.skipped} 条。可在「用户管理 → 学生账号」中查看。`
                : `Created ${studentLoginResult.created} account(s); skipped ${studentLoginResult.skipped}. See Users → Student accounts.`}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {studentLoginPhase === 'preview' ? (
              <>
                <Button variant="outline" onClick={closeStudentLoginDialog} disabled={studentLoginBusy}>
                  {isZh ? '取消' : 'Cancel'}
                </Button>
                <Button
                  onClick={() => void confirmStudentLoginImport()}
                  disabled={studentLoginBusy || studentLoginPreview.length === 0}
                >
                  {studentLoginBusy ? (isZh ? '导入中…' : 'Importing…') : isZh ? '确认导入' : 'Confirm import'}
                </Button>
              </>
            ) : (
              <Button onClick={closeStudentLoginDialog}>{isZh ? '关闭' : 'Close'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createEvaluationOpen}
        onOpenChange={(open) => {
          setCreateEvaluationOpen(open);
          if (!open) {
            setCreateEvaluationTitle('');
            setCreateEvaluationFromTemplateId('');
            setAddModuleMenuOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[1120px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {createEvaluationMode === 'edit'
                ? (isZh ? '编辑评价模板' : 'Edit evaluation template')
                : (isZh ? '新建评价模板' : 'New evaluation template')}
            </DialogTitle>
            <DialogDescription>
              {isZh ? '一栏式所见即所得设计。' : 'Single-column WYSIWYG designer.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-3">
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学年 / 学期' : 'Year / Term'}</label>
                <div className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 flex items-center">
                  {isZh
                    ? `${years.find((y) => y.id === reportSettingYearId)?.name || '—'} · ${reportSettingTerm === 'Semester 1' ? '上学期' : '下学期'}`
                    : `${years.find((y) => y.id === reportSettingYearId)?.name || '-'} · ${reportSettingTerm}`}
                </div>
              </div>
              <div className="lg:col-span-4">
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '基于已有模板（可选）' : 'Based on existing template (optional)'}</label>
                <select
                  value={createEvaluationMode === 'create' ? createEvaluationFromTemplateId : ''}
                  onChange={(e) => void pickSourceTemplateForCreate(e.target.value)}
                  disabled={createEvaluationMode !== 'create'}
                  className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">{isZh ? '从空白开始' : 'Start from scratch'}</option>
                  {reportTemplateList.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.title || (isZh ? '未命名评价' : 'Untitled evaluation')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-5">
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '模板名称' : 'Template name'}</label>
                <input
                  value={createEvaluationTitle}
                  onChange={(e) => {
                    setCreateEvaluationTitle(e.target.value);
                    setReportSettingTitle(e.target.value);
                  }}
                  className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"
                  placeholder={isZh ? '如：期末综合评价' : 'e.g. Final holistic evaluation'}
                />
              </div>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">{isZh ? '评价报告预览（所见即所得）' : 'Evaluation preview (WYSIWYG)'}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {isZh
                    ? '这里预览的是“单个学生”的报告样式。教师实际填写时，会按同样结构逐个填写班级内所有学生。'
                    : 'This preview shows one student report. Teachers fill the same structure for all students in class.'}
                </div>
              </div>

              {activeEvaluationModules.map((moduleKey, moduleIdx) => {
                const moduleMeta = evaluationModuleOptions.find((m) => m.key === moduleKey);
                if (!moduleMeta) return null;
                return (
                  <div key={moduleKey} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800">{moduleMeta.title}</div>
                        <p className="text-xs text-slate-500 mt-1">{moduleMeta.description}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => moveModuleCard(moduleKey, 'up')} disabled={moduleIdx === 0} title={isZh ? '上移' : 'Move up'}>
                          ↑
                        </Button>
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => moveModuleCard(moduleKey, 'down')} disabled={moduleIdx === activeEvaluationModules.length - 1} title={isZh ? '下移' : 'Move down'}>
                          ↓
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => removeModuleFromDesigner(moduleKey)}
                          title={isZh ? '移除模块' : 'Remove module'}
                          aria-label={isZh ? '移除模块' : 'Remove module'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {moduleKey === 'homeroom_comment' && (
                      <textarea
                        value={homeroomCommentPreview}
                        onChange={(e) => setHomeroomCommentPreview(e.target.value)}
                        className="w-full min-h-[92px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder={isZh ? '请输入班主任综合评价内容（模板预览）' : 'Type homeroom evaluation text (preview)'}
                      />
                    )}

                    {moduleKey === 'subject_evaluation' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-slate-500">{isZh ? '定义学科（中英文），并分别配置“成绩/目标达成/学科评语”。' : 'Define subjects (ZH/EN), and configure score/target/comment per subject.'}</div>
                          <Button size="sm" variant="outline" onClick={addReportTemplateSubject}>
                            <Plus className="h-4 w-4 mr-1" />
                            {isZh ? '添加学科' : 'Add subject'}
                          </Button>
                        </div>
                        {reportSettingSubjects.length === 0 && (
                          <p className="text-sm text-slate-500">{isZh ? '暂无学科，请先添加。' : 'No subjects yet. Add one to continue.'}</p>
                        )}
                        {reportSettingSubjects.map((s, subjectIdx) => (
                          <div key={`subject-${subjectIdx}`} className="relative rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="absolute right-2 top-2 h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => setReportSettingSubjects((prev) => prev.filter((_, i) => i !== subjectIdx))}
                              title={isZh ? '删除学科' : 'Remove subject'}
                              aria-label={isZh ? '删除学科' : 'Remove subject'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <div className="pr-10">
                              <input
                                value={s.subjectNameZh}
                                onChange={(e) => setReportSettingSubjects((prev) => {
                                  const next = [...prev];
                                  next[subjectIdx] = {
                                    ...next[subjectIdx],
                                    subjectNameZh: e.target.value,
                                    subjectNameEn: e.target.value,
                                  };
                                  return next;
                                })}
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                placeholder={isZh ? '学科名称（请中英文双语输入，如：数学 Math）' : 'Subject name (bilingual, e.g. Math 数学)'}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" size="sm" variant={s.enableScore ? 'default' : 'outline'} onClick={() => setReportSettingSubjects((prev) => { const next = [...prev]; next[subjectIdx] = { ...next[subjectIdx], enableScore: !next[subjectIdx].enableScore }; return next; })}>
                                {isZh ? '学科成绩' : 'Score'}
                              </Button>
                              <Button type="button" size="sm" variant={s.enableTarget ? 'default' : 'outline'} onClick={() => setReportSettingSubjects((prev) => { const next = [...prev]; next[subjectIdx] = { ...next[subjectIdx], enableTarget: !next[subjectIdx].enableTarget }; return next; })}>
                                {isZh ? '目标达成' : 'Target'}
                              </Button>
                              <Button type="button" size="sm" variant={s.enableTeacherComment ? 'default' : 'outline'} onClick={() => setReportSettingSubjects((prev) => { const next = [...prev]; next[subjectIdx] = { ...next[subjectIdx], enableTeacherComment: !next[subjectIdx].enableTeacherComment }; return next; })}>
                                {isZh ? '学科评语' : 'Comment'}
                              </Button>
                            </div>
                            {s.enableTarget && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-slate-600">{isZh ? '课程目标达成' : 'Target attainment'}</span>
                                  <Button size="sm" variant="outline" onClick={() => addReportTemplateDimension(subjectIdx)}>
                                    {isZh ? '新增维度' : 'Add dimension'}
                                  </Button>
                                </div>
                                {s.dimensions.map((d, dimIdx) => (
                                  <div key={`subject-${subjectIdx}-dim-${dimIdx}`} className="relative rounded border border-slate-100 p-2 space-y-2">
                                    <Button size="icon" variant="ghost" className="absolute right-2 top-2 h-6 w-6 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setReportSettingSubjects((prev) => { const next = [...prev]; const subject = next[subjectIdx]; next[subjectIdx] = { ...subject, dimensions: subject.dimensions.filter((_, i) => i !== dimIdx) }; return next; })} title={isZh ? '删除维度' : 'Remove dimension'} aria-label={isZh ? '删除维度' : 'Remove dimension'}><Trash2 className="h-4 w-4" /></Button>
                                    <div className="pr-8">
                                      <input
                                        value={d.dimensionLabelZh}
                                        onChange={(e) => setReportSettingSubjects((prev) => {
                                          const next = [...prev];
                                          const subject = next[subjectIdx];
                                          const dims = [...subject.dimensions];
                                          dims[dimIdx] = {
                                            ...dims[dimIdx],
                                            dimensionLabelZh: e.target.value,
                                            dimensionLabelEn: e.target.value,
                                          };
                                          next[subjectIdx] = { ...subject, dimensions: dims };
                                          return next;
                                        })}
                                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                        placeholder={isZh ? '维度名称（请中英文双语输入，如：问题解决 Problem Solving）' : 'Dimension name (bilingual, e.g. Problem Solving 问题解决)'}
                                      />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {(['A', 'B', 'C', 'D'] as TargetLevel[]).map((lv) => (
                                        <div key={lv} className="space-y-1">
                                          <div className="text-[11px] font-semibold text-slate-600">{lv}</div>
                                          <textarea
                                            value={d.levelDescriptions[lv] ?? ''}
                                            onChange={(e) => setReportSettingSubjects((prev) => {
                                              const next = [...prev];
                                              const subject = next[subjectIdx];
                                              const dims = [...subject.dimensions];
                                              dims[dimIdx] = {
                                                ...dims[dimIdx],
                                                levelDescriptions: { ...dims[dimIdx].levelDescriptions, [lv]: e.target.value },
                                              };
                                              next[subjectIdx] = { ...subject, dimensions: dims };
                                              return next;
                                            })}
                                            className="min-h-[72px] rounded border border-slate-300 px-2 py-1 text-xs"
                                            placeholder={isZh ? '评价说明（选填）' : 'Description (optional)'}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {s.enableScore && (
                              <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
                                <div className="text-xs font-medium text-slate-600">{isZh ? '学科成绩预览（填写分数后系统自动换算等第）' : 'Score preview (grade auto-calculated from score)'}</div>
                                <div className="grid grid-cols-2 gap-2">
                                  <input value={s.scorePreview} onChange={(e) => setReportSettingSubjects((prev) => { const next = [...prev]; next[subjectIdx] = { ...next[subjectIdx], scorePreview: e.target.value }; return next; })} className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder={isZh ? '分数' : 'Score'} />
                                  <input value={toReportGrade(s.scorePreview) ?? ''} readOnly className="rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm text-slate-600" placeholder={isZh ? '等第' : 'Grade'} />
                                </div>
                              </div>
                            )}
                            {s.enableTeacherComment && (
                              <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
                                <div className="text-xs font-medium text-slate-600">{isZh ? '学科评语预览' : 'Comment preview'}</div>
                                <textarea value={s.commentPreview} onChange={(e) => setReportSettingSubjects((prev) => { const next = [...prev]; next[subjectIdx] = { ...next[subjectIdx], commentPreview: e.target.value }; return next; })} className="w-full min-h-[78px] rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder={isZh ? '输入该学科评语示例内容' : 'Type a sample comment for this subject'} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="relative flex justify-center py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddModuleMenuOpen((v) => !v)}
                  disabled={inactiveEvaluationModules.length === 0}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {isZh ? '添加新模块' : 'Add module'}
                </Button>
                {addModuleMenuOpen && inactiveEvaluationModules.length > 0 && (
                  <div className="absolute z-20 top-full mt-2 min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-lg p-1">
                    {inactiveEvaluationModules.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => {
                          addModuleToDesigner(m.key);
                          setAddModuleMenuOpen(false);
                        }}
                      >
                        {m.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateEvaluationOpen(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button onClick={() => void submitEvaluationDesigner()} disabled={!reportSettingYearId || reportSettingSaving}>
              {reportSettingSaving
                ? (isZh ? '保存中…' : 'Saving…')
                : createEvaluationMode === 'edit'
                  ? (isZh ? '保存模板' : 'Save template')
                  : (isZh ? '创建并保存' : 'Create and save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={progressConfirmOpen}
        onOpenChange={(open) => {
          setProgressConfirmOpen(open);
          if (!open) {
            setProgressData(null);
            setProgressTemplateTitle('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[980px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isZh ? '进度确认' : 'Progress confirmation'}</DialogTitle>
            <DialogDescription>
              {isZh
                ? `评价报告：${progressTemplateTitle || '—'}（仅后台可见）`
                : `Evaluation: ${progressTemplateTitle || '-'} (admin only)`}
            </DialogDescription>
          </DialogHeader>
          {progressLoading ? (
            <div className="text-sm text-slate-500 py-4">{isZh ? '加载进度中…' : 'Loading progress...'}</div>
          ) : !progressData ? (
            <div className="text-sm text-slate-500 py-4">{isZh ? '暂无进度数据。' : 'No progress data yet.'}</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{isZh ? `总学生：${progressData.totalStudents}` : `Total: ${progressData.totalStudents}`}</span>
                <span className="text-emerald-700">{isZh ? `已完成：${progressData.completedStudents}` : `Completed: ${progressData.completedStudents}`}</span>
                <span className="text-amber-700">{isZh ? `未完成：${progressData.pendingStudents}` : `Pending: ${progressData.pendingStudents}`}</span>
                <span className="font-semibold">{isZh ? `完成率：${progressData.completionRate}%` : `Rate: ${progressData.completionRate}%`}</span>
              </div>
              {progressData.classes.length === 0 ? (
                <div className="text-sm text-slate-500">{isZh ? '当前学年暂无班级或学生数据。' : 'No classes/students in this academic year.'}</div>
              ) : (
                <div className="rounded-lg border border-slate-200 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">{isZh ? '班级' : 'Class'}</th>
                        <th className="px-3 py-2 font-medium">{isZh ? '完成情况' : 'Progress'}</th>
                        <th className="px-3 py-2 font-medium">{isZh ? '任课/班级教师' : 'Teachers'}</th>
                        <th className="px-3 py-2 font-medium">{isZh ? '未完成学生' : 'Pending students'}</th>
                        <th className="px-3 py-2 font-medium text-right">{isZh ? '操作' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressData.classes.map((cls) => (
                        <tr key={cls.classId} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{`G${cls.grade} ${cls.className}`}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-slate-700">
                              {cls.completedStudents}/{cls.totalStudents}
                            </div>
                            <div className={`text-xs ${cls.completionRate >= 100 ? 'text-emerald-700' : cls.completionRate >= 60 ? 'text-amber-700' : 'text-rose-700'}`}>
                              {cls.completionRate}%
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {cls.teachers.length > 0
                              ? cls.teachers.map((t) => t.teacherName).join(isZh ? '、' : ', ')
                              : (isZh ? '未分配' : 'Unassigned')}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {cls.pendingStudents > 0
                              ? cls.pendingStudentNames.slice(0, 8).join(isZh ? '、' : ', ')
                              : (isZh ? '全部完成' : 'All done')}
                            {cls.pendingStudentNames.length > 8 ? (isZh ? ' 等' : ' ...') : ''}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void remindTeachers(cls.reminderMessage)}
                              disabled={cls.pendingStudents === 0}
                            >
                              {isZh ? '提醒老师' : 'Remind'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                {isZh
                  ? '点击“提醒老师”会自动复制提醒文案，你可直接粘贴到群或私聊发送。'
                  : 'Click Remind to copy a message, then paste in your chat tool.'}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProgressConfirmOpen(false)}>
              {isZh ? '关闭' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateStudentDialog
        open={dialogCreateStudent}
        onClose={() => setDialogCreateStudent(false)}
        currentYearId={studentCurrentYearId}
        classesInYear={allClasses.filter((c) => c.academicYearId === studentCurrentYearId)}
        onSuccess={(student) => {
          setStudents((prev) => [...prev, student]);
          setDialogCreateStudent(false);
        }}
        onError={(msg) => setError(msg)}
        onEnroll={async (studentId, classId, academicYearId) => {
          const enrollmentId = `enr-${Date.now()}`;
          await addEnrollment({ id: enrollmentId, studentId, classId, academicYearId });
          setEnrollments(loadEnrollmentsSync());
        }}
      />

      <Dialog open={!!editStudent} onOpenChange={(open) => !open && setEditStudent(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{isZh ? '编辑学生' : 'Edit student'}</DialogTitle>
            <DialogDescription>
              {editStudent && (isZh ? `修改「${editStudent.nameZh || editStudent.nameEn || editStudent.name}」的信息` : `Edit "${editStudent.nameZh || editStudent.nameEn || editStudent.name}"`)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '中文名' : 'Chinese name'}</label>
                <input
                  value={editNameZh}
                  onChange={(e) => setEditNameZh(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '英文名' : 'English name'}</label>
                <input
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-1">
              {isZh ? '中文名和英文名至少填写一个。' : 'Please provide at least one of Chinese or English name.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '当前年级（数值）' : 'Current grade (number)'}</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={editCurrentGrade}
                  onChange={(e) => setEditCurrentGrade(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学部' : 'Division'}</label>
                <input
                  value={editDivision}
                  onChange={(e) => setEditDivision(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '性别' : 'Gender'}</label>
              <select
                value={editGender}
                onChange={(e) => setEditGender(e.target.value as Student['gender'])}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="male">{isZh ? '男' : 'Male'}</option>
                <option value="female">{isZh ? '女' : 'Female'}</option>
                <option value="other">{isZh ? '其他' : 'Other'}</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '入学时间' : 'Entry date'}</label>
                <input
                  type="date"
                  value={editEntryDate}
                  onChange={(e) => setEditEntryDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '在读状态' : 'Status'}</label>
                <select
                  value={editStatus || 'active'}
                  onChange={(e) => setEditStatus(e.target.value as Student['status'])}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="active">{isZh ? '在读' : 'Active'}</option>
                  <option value="leave">{isZh ? '休学' : 'Leave'}</option>
                  <option value="graduated">{isZh ? '毕业' : 'Graduated'}</option>
                  <option value="withdrawn">{isZh ? '离校' : 'Withdrawn'}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '学号' : 'Student number'}</label>
              <input
                value={editStudentNumber}
                onChange={(e) => setEditStudentNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '出生日期' : 'Date of birth'}</label>
              <input
                type="date"
                value={editDateOfBirth}
                onChange={(e) => setEditDateOfBirth(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteStudentInAdmin}
              disabled={editSubmitLoading}
              className="mr-auto"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {isZh ? '删除学生' : 'Delete'}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditStudent(null)}>{isZh ? '取消' : 'Cancel'}</Button>
              <Button onClick={handleSaveStudent} disabled={(!editNameZh.trim() && !editNameEn.trim()) || editSubmitLoading}>
                {editSubmitLoading ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认：需输入账户名一致才可确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDeleteConfirm()}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{isZh ? '确认删除用户' : 'Confirm delete user'}</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {isZh ? '删除后该用户及其课程等数据将无法恢复。请输入账户名 ' : 'This user and their data will be permanently removed. Type the username '}
                  <strong className="text-slate-800">{deleteTarget.username}</strong>
                  {isZh ? ' 以确认。' : ' to confirm.'}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <input
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder={deleteTarget?.username}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeDeleteConfirm}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={!deleteTarget || deleteConfirmInput !== deleteTarget.username || deleteLoading}
            >
              {deleteLoading ? (isZh ? '删除中…' : 'Deleting…') : isZh ? '确认删除' : 'Confirm delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

