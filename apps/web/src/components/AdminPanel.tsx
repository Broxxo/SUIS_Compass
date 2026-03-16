import { useEffect, useState, useMemo } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type { User } from '../types';
import type { AdminUser } from '../lib/adminStorage';
import {
  loadUsers,
  createUser,
  updateUserDepartment,
  updateUserRole,
  batchUpdateDepartment,
  deleteUser,
} from '../lib/adminStorage';
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
import type { AcademicYear, Student, Enrollment, ClassItem } from '../types/classManagement';
import ClassManagement from './ClassManagement';
import CreateStudentDialog from './CreateStudentDialog';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';

const ROLE_LABELS: Record<User['role'], { zh: string; en: string }> = {
  'system-admin': { zh: '系统管理员', en: 'System Admin' },
  admin: { zh: '管理员', en: 'Admin' },
  teacher: { zh: '教师', en: 'Teacher' },
};

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

  const [adminTab, setAdminTab] = useState<'users' | 'years' | 'classes' | 'students'>('users');
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
  const [studentSortField, setStudentSortField] = useState<'name' | 'grade' | 'gender' | 'studentNumber' | 'dateOfBirth'>('name');
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc');
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editGender, setEditGender] = useState<Student['gender']>('male');
  const [editStudentNumber, setEditStudentNumber] = useState('');
  const [editDateOfBirth, setEditDateOfBirth] = useState('');
  const [editSubmitLoading, setEditSubmitLoading] = useState(false);
  const [studentCurrentYearId, setStudentCurrentYearId] = useState<string | null>(null);
  const [dialogCreateStudent, setDialogCreateStudent] = useState(false);

  /** 仅系统管理员可创建/修改学年 */
  const canEditYears = currentUser?.role === 'system-admin';

  /** 当前用户可创建的角色：系统管理员可创建管理员+教师，管理员只能创建教师 */
  const assignableRoles = useMemo((): User['role'][] => {
    if (currentUser?.role === 'system-admin') return ['admin', 'teacher'];
    if (currentUser?.role === 'admin') return ['teacher'];
    return [];
  }, [currentUser?.role]);

  /** 列表展示：系统管理员看管理员+教师，管理员仅看教师 */
  const displayedUsers = useMemo(() => {
    if (currentUser?.role === 'system-admin') return users.filter((u) => u.role === 'admin' || u.role === 'teacher');
    if (currentUser?.role === 'admin') return users.filter((u) => u.role === 'teacher');
    return users;
  }, [users, currentUser?.role]);

  /** 当前用户可否编辑该行（角色、部门等）：系统管理员可编管理员/教师，管理员只可编教师 */
  const canEditUser = (u: AdminUser) => {
    if (u.role === 'system-admin') return false;
    if (currentUser?.role === 'system-admin') return true;
    if (currentUser?.role === 'admin' && u.role === 'teacher') return true;
    return false;
  };

  /** 当前用户可否删除该行：系统管理员可删管理员/教师，管理员只可删教师；预设系统管理员不可删（由 adminStorage 拦截） */
  const canDeleteUser = (u: AdminUser) => {
    if (u.role === 'system-admin') return false;
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
    setLoading(true);
    setError(null);
    loadUsers()
      .then((data) => setUsers(data))
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

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

  useEffect(() => {
    if (adminTab !== 'years') return;
    setYearLoading(true);
    refreshYears().finally(() => setYearLoading(false));
  }, [adminTab]);

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
        s.name.toLowerCase().includes(q) ||
        (s.studentNumber?.toLowerCase().includes(q))
      );
    }
    if (studentFilterGrade.trim()) {
      const q = studentFilterGrade.trim().toLowerCase();
      list = list.filter((s) => (s.grade ?? '').toLowerCase().includes(q));
    }
    if (studentFilterClass.trim()) {
      const classId = studentFilterClass;
      const enrolledIds = new Set(enrollments.filter((e) => e.classId === classId).map((e) => e.studentId));
      list = list.filter((s) => enrolledIds.has(s.id));
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (studentSortField) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'grade':
          cmp = (a.grade ?? '').localeCompare(b.grade ?? '');
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
    setEditName(s.name);
    setEditGrade(s.grade ?? '');
    setEditGender(s.gender);
    setEditStudentNumber(s.studentNumber ?? '');
    setEditDateOfBirth(s.dateOfBirth ?? '');
  };

  const handleSaveStudent = async () => {
    if (!editStudent || !editName.trim()) return;
    setEditSubmitLoading(true);
    setError(null);
    try {
      await updateStudent(editStudent.id, {
        name: editName.trim(),
        grade: editGrade.trim() || null,
        gender: editGender,
        studentNumber: editStudentNumber.trim() || null,
        dateOfBirth: editDateOfBirth.trim() || null,
      });
      setStudents((prev) => prev.map((s) => (s.id === editStudent.id ? { ...s, name: editName.trim(), grade: editGrade.trim() || null, gender: editGender, studentNumber: editStudentNumber.trim() || null, dateOfBirth: editDateOfBirth.trim() || null } : s)));
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

  return (
    <div className="min-h-screen bg-slate-50 pt-14">
      <AppTopBar
        title={isZh ? '后台管理' : 'Admin'}
        showBack
        onBack={onBackToHub}
      />
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 flex gap-1">
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
            onClick={() => { setAdminTab('students'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'students' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '学生管理' : 'Students'}
          </button>
        </div>
      </div>
      {error && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-800" aria-label={isZh ? '关闭' : 'Dismiss'}>
              ×
            </button>
          </div>
        </div>
      )}
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {adminTab === 'users' && (
        <>
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
            {isZh ? '系统管理员可在下方用户列表中直接修改「管理员」「教师」的角色（升级或降级）。' : 'System admin can change admin/teacher role in the user list below.'}
          </p>
        </section>

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

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-slate-800">
              {isZh ? '所有用户' : 'All Users'}
            </h2>
            {loading && (
              <span className="text-xs text-slate-500">
                {isZh ? '加载中…' : 'Loading…'}
              </span>
            )}
            {!loading && displayedUsers.length > 0 && selectedIds.size > 0 && (
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
          {!loading && displayedUsers.length === 0 && (
            <p className="text-sm text-slate-500">
              {isZh ? '暂时没有用户数据。' : 'No users yet.'}
            </p>
          )}
          {displayedUsers.length > 0 && (
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
                          {currentUser?.role === 'system-admin' && u.role !== 'system-admin' ? (
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
                            <td className="py-2 px-3 text-slate-700">G{cls.grade}</td>
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
          <div className="mt-4">
            <ClassManagement
              onBackToHub={() => {}}
              embedded
              hideYearGear={false}
              pageTitle={isZh ? '班级管理' : 'Classes'}
            />
          </div>
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
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-slate-800">
                  {studentCurrentYearId
                    ? `${allYears.find((y) => y.id === studentCurrentYearId)?.name ?? ''} — ${isZh ? '学生列表' : 'Students'}`
                    : (isZh ? '学生列表' : 'Student list')}
                </h2>
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

              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">{isZh ? '筛选：' : 'Filter:'}</span>
                <input
                  value={studentFilterName}
                  onChange={(e) => setStudentFilterName(e.target.value)}
                  placeholder={isZh ? '姓名/学号' : 'Name/ID'}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-36 placeholder:text-slate-400"
                />
                <input
                  value={studentFilterGrade}
                  onChange={(e) => setStudentFilterGrade(e.target.value)}
                  placeholder={isZh ? '年级' : 'Grade'}
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
                        {(['name', 'grade', 'gender', 'studentNumber', 'dateOfBirth'] as const).map((field) => (
                          <th key={field} className="py-2.5 px-3 font-medium">
                            <button
                              type="button"
                              onClick={() => {
                                setStudentSortField(field);
                                setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                              }}
                              className="flex items-center gap-1 hover:text-slate-800"
                            >
                              {field === 'name' && (isZh ? '姓名' : 'Name')}
                              {field === 'grade' && (isZh ? '年级' : 'Grade')}
                              {field === 'gender' && (isZh ? '性别' : 'Gender')}
                              {field === 'studentNumber' && (isZh ? '学号' : 'Number')}
                              {field === 'dateOfBirth' && (isZh ? '出生日期' : 'DOB')}
                              {studentSortField === field && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </button>
                          </th>
                        ))}
                        <th className="py-2.5 px-3 font-medium">{isZh ? '所在班级' : 'Classes'}</th>
                        <th className="py-2.5 px-3 font-medium w-14">{isZh ? '操作' : ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedStudents.length === 0 ? (
                        <tr><td colSpan={7} className="py-8 text-center text-slate-500 text-sm">{isZh ? '暂无学生' : 'No students'}</td></tr>
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
                              <td className="py-2.5 px-3 font-medium text-slate-800">{s.name}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.grade ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {s.gender === 'male' ? (isZh ? '男' : 'M') : s.gender === 'female' ? (isZh ? '女' : 'F') : (isZh ? '其他' : 'Other')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{s.studentNumber ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.dateOfBirth ?? '—'}</td>
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
            <DialogDescription>{editStudent && (isZh ? `修改「${editStudent.name}」的信息` : `Edit "${editStudent.name}"`)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '姓名' : 'Name'}</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '年级' : 'Grade'}</label>
              <input
                value={editGrade}
                onChange={(e) => setEditGrade(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={isZh ? '如 一年级、1、G9' : 'e.g. G1, 1'}
              />
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
              <Button onClick={handleSaveStudent} disabled={!editName.trim() || editSubmitLoading}>
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

