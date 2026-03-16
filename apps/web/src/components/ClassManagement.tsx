/**
 * 班级/我的班级：学年、班级、学生。
 * - 嵌入后台时：标题「班级管理」，显示学年齿轮；仅管理员可写。
 * - 独立「我的班级」时：标题「我的班级」；管理员看全部，教师只看自己关联的班级且只读。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type { AcademicYear, ClassItem, Student, Enrollment } from '../types/classManagement';
import {
  loadAcademicYears,
  loadCurrentAcademicYearId,
  setCurrentAcademicYearId,
  getCurrentAcademicYearId,
  loadClasses,
  loadClassesSync,
  loadStudents,
  loadStudentsSync,
  loadEnrollmentsSync,
  createAcademicYear,
  deleteAcademicYear,
  createClass,
  deleteClass,
  addEnrollment,
  removeEnrollment,
} from '../lib/classStorage';
import { loadUsers } from '../lib/adminStorage';
import type { AdminUser } from '../lib/adminStorage';
import { ChevronDown, ChevronRight, Plus, Settings, Trash2, UserMinus } from 'lucide-react';
import { GRADES } from '../lib/constants';
import CreateStudentDialog from './CreateStudentDialog';

interface ClassManagementProps {
  onBackToHub: () => void;
  /** 嵌入后台时 true：不显示顶栏、不显示学年齿轮 */
  embedded?: boolean;
  /** 是否隐藏学年齿轮（我的班级视图为 true，学年在后台管理） */
  hideYearGear?: boolean;
  /** 页面标题，如「我的班级」或「班级管理」 */
  pageTitle?: string;
}

export default function ClassManagement({ onBackToHub, embedded = false, hideYearGear = false, pageTitle: pageTitleProp }: ClassManagementProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const isAdmin = user?.role === 'system-admin' || user?.role === 'admin';
  const isTeacherOnly = user?.role === 'teacher' && !embedded; // 我的班级下教师只看关联班级且只读
  const pageTitle = pageTitleProp ?? (isZh ? '我的班级' : 'My Classes');

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);

  const [dialogCreateYear, setDialogCreateYear] = useState(false);
  const [dialogCreateClass, setDialogCreateClass] = useState(false);
  const [dialogAddStudent, setDialogAddStudent] = useState<ClassItem | null>(null);
  const [dialogAddToClass, setDialogAddToClass] = useState<Student | null>(null);
  const [addToClassSelectedId, setAddToClassSelectedId] = useState('');

  const [newYearName, setNewYearName] = useState('');
  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState(1);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [dialogYearManagement, setDialogYearManagement] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [newClassTeacherId, setNewClassTeacherId] = useState<string>('');

  /** 我的班级下教师仅看与自己关联的班级；管理员看全部 */
  const displayedClasses = useMemo(() => {
    if (!isTeacherOnly || !user?.id) return classes;
    return classes.filter((c) => c.teacherId === user.id);
  }, [classes, isTeacherOnly, user?.id]);

  /** 是否可编辑（管理员可编辑；我的班级下教师只读） */
  const canEdit = isAdmin && !isTeacherOnly;

  const refresh = async () => {
    const list = await loadAcademicYears();
    setYears(list);
    const cur = await loadCurrentAcademicYearId();
    if (cur) setCurrentYearId(cur);
    else if (list.length > 0) {
      if (!getCurrentAcademicYearId()) setCurrentAcademicYearId(list[0].id);
      setCurrentYearId(list[0].id);
    }
    if (cur || list[0]?.id) {
      const yid = cur || list[0].id;
      const cls = await loadClasses(yid);
      setClasses(cls);
      setCurrentYearId(yid);
    } else setClasses([]);
    const st = await loadStudents();
    setStudents(st);
    setEnrollments(loadEnrollmentsSync());
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    refresh().then(() => { if (!cancelled) setLoading(false); }).catch((e) => { if (!cancelled) { setError(e?.message || 'Load failed'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentYearId) return;
    const cls = loadClassesSync(currentYearId);
    setClasses(cls);
    setEnrollments(loadEnrollmentsSync(currentYearId));
  }, [currentYearId]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadUsers()
      .then((list) => setTeachers(list.filter((u) => u.role === 'teacher')))
      .catch(() => {});
  }, [isAdmin]);

  const handleDeleteYear = async (y: AcademicYear) => {
    const msg = isZh
      ? `确定删除学年「${y.name}」？该学年下所有班级与学籍将一并删除，学生档案保留。`
      : `Delete academic year "${y.name}"? All classes and enrollments in this year will be removed; student records kept.`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await deleteAcademicYear(y.id);
      await refresh();
      if (currentYearId === y.id) setCurrentYearId(getCurrentAcademicYearId());
      setDialogYearManagement(false);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete year');
    }
  };

  const handleCreateYear = async () => {
    if (!newYearName.trim()) return;
    setSubmitLoading(true);
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
      await refresh();
      if (years.length === 0) {
        // 若这是系统中的第一个学年，则设为当前学年
        setCurrentAcademicYearId(id);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create year');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleCreateClass = async () => {
    if (!currentYearId || !newClassName.trim()) return;
    setSubmitLoading(true);
    setError(null);
    try {
      const id = `class-${Date.now()}`;
      await createClass({
        id,
        academicYearId: currentYearId,
        grade: newClassGrade,
        name: newClassName.trim(),
        teacherId: newClassTeacherId || null,
      });
      setNewClassName('');
      setNewClassGrade(1);
      setNewClassTeacherId('');
      setDialogCreateClass(false);
      setClasses(loadClassesSync(currentYearId));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create class');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDeleteClass = async (c: ClassItem) => {
    if (!canEdit) return;
    const msg = isZh ? `确定删除班级「${c.name}」？该班级下的学籍将一并移除，学生档案保留。` : `Delete class "${c.name}"? Enrollments will be removed; student records kept.`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await deleteClass(c.id);
      setClasses((prev) => prev.filter((x) => x.id !== c.id));
      setEnrollments((prev) => prev.filter((e) => e.classId !== c.id));
      if (expandedClassId === c.id) setExpandedClassId(null);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete class');
    }
  };

  const handleCreateStudentSuccess = async (student: Student) => {
    const cls = dialogAddStudent;
    if (!cls) return;
    setSubmitLoading(true);
    setError(null);
    try {
      const enrollmentId = `enr-${Date.now()}`;
      await addEnrollment({
        id: enrollmentId,
        studentId: student.id,
        classId: cls.id,
        academicYearId: cls.academicYearId,
      });
      setDialogAddStudent(null);
      setStudents(loadStudentsSync());
      setEnrollments(loadEnrollmentsSync(currentYearId || undefined));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to add to class');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleRemoveFromClass = async (enrollment: Enrollment) => {
    if (!canEdit) return;
    if (!window.confirm(isZh ? '确定将该学生从本班移除？' : 'Remove this student from the class?')) return;
    setError(null);
    try {
      await removeEnrollment(enrollment.id);
      setEnrollments(loadEnrollmentsSync(currentYearId || undefined));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to remove');
    }
  };

  const enrollmentsInClass = (classId: string) => enrollments.filter((e) => e.classId === classId);
  const getStudent = (id: string) => students.find((s) => s.id === id);

  /** 当前学年下没有任何班级归属的学生（含「从本班移除」后的学生） */
  const unassignedStudents = useMemo(() => {
    if (!currentYearId) return [];
    const enrolledIds = new Set(enrollments.filter((e) => e.academicYearId === currentYearId).map((e) => e.studentId));
    return students.filter((s) => !enrolledIds.has(s.id));
  }, [students, enrollments, currentYearId]);

  const handleAddToClass = async () => {
    const stu = dialogAddToClass;
    const classId = addToClassSelectedId;
    if (!stu || !classId || !currentYearId) return;
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return;
    setSubmitLoading(true);
    setError(null);
    try {
      const enrollmentId = `enr-${Date.now()}`;
      await addEnrollment({
        id: enrollmentId,
        studentId: stu.id,
        classId: cls.id,
        academicYearId: currentYearId,
      });
      setDialogAddToClass(null);
      setAddToClassSelectedId('');
      setEnrollments(loadEnrollmentsSync(currentYearId));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to add to class');
    } finally {
      setSubmitLoading(false);
    }
  };

  const currentYear = years.find((y) => y.id === currentYearId);

  return (
    <div className={`min-h-screen bg-slate-50 ${embedded ? '' : 'pt-14'}`}>
      {!embedded && (
        <AppTopBar
          title={pageTitle}
          showBack
          onBack={onBackToHub}
          rightChildren={
            isAdmin && !hideYearGear ? (
              <div className="relative" ref={settingsMenuRef}>
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setSettingsMenuOpen((o) => !o)}
                  className="h-9 w-9 rounded-lg"
                  title={isZh ? '设置' : 'Settings'}
                >
                  <Settings className="h-4 w-4" />
                </Button>
                {settingsMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-30">
                    <button
                      type="button"
                      onClick={() => {
                        setDialogCreateYear(true);
                        setSettingsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm text-left"
                    >
                      <span>{isZh ? '新建学年' : 'New year'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDialogYearManagement(true);
                        setSettingsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm text-left"
                    >
                      <span>{isZh ? '学年管理' : 'Academic years'}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : undefined
          }
        />
      )}
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {error && <p className="text-sm text-red-500">{error}</p>}

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-700">
              {isZh ? '当前学年：' : 'Current year: '}
            </span>
            <span className="text-sm text-slate-800">
              {currentYear?.name ?? (currentYearId || (isZh ? '未设置' : 'Not set'))}
            </span>
          </div>
          {!currentYearId && years.length === 0 && !loading && (
            <p className="text-sm text-slate-500 mt-2">
              {isZh ? '请在后台「学年管理」中创建学年。' : 'Create academic years in Admin → Year management.'}
            </p>
          )}
        </section>

        {currentYearId && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-800">
                {currentYear?.name ?? currentYearId} — {isZh ? '班级列表' : 'Classes'}
              </h2>
              {canEdit && (
                <Button size="sm" onClick={() => setDialogCreateClass(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  {isZh ? '新建班级' : 'New class'}
                </Button>
              )}
            </div>
            {loading ? (
              <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
            ) : displayedClasses.length === 0 ? (
              <p className="text-sm text-slate-500">
                {isTeacherOnly ? (isZh ? '您暂无关联的班级。' : 'You have no classes assigned.') : (isZh ? '暂无班级。' : 'No classes yet.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {displayedClasses.map((c) => {
                  const enrolls = enrollmentsInClass(c.id);
                  const expanded = expandedClassId === c.id;
                  return (
                    <li key={c.id} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div
                        className="flex items-center justify-between px-3 py-2 bg-slate-50 cursor-pointer"
                        onClick={() => setExpandedClassId(expanded ? null : c.id)}
                      >
                        <span className="flex items-center gap-1">
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className="font-medium">G{c.grade} {c.name}</span>
                          <span className="text-slate-500 text-sm">({enrolls.length})</span>
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteClass(c); }}
                            className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                            title={isZh ? '删除班级' : 'Delete class'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <div className="px-3 py-2 border-t border-slate-100">
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mb-2"
                              onClick={() => setDialogAddStudent(c)}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              {isZh ? '添加学生' : 'Add student'}
                            </Button>
                          )}
                          {enrolls.length === 0 ? (
                            <p className="text-sm text-slate-500">{isZh ? '暂无学生。' : 'No students.'}</p>
                          ) : (
                            <ul className="space-y-1">
                              {enrolls.map((e) => {
                                const stu = getStudent(e.studentId);
                                if (!stu) return null;
                                return (
                                  <li key={e.id} className="flex items-center justify-between py-1.5 text-sm">
                                    <span>{stu.name} {stu.studentNumber ? `(${stu.studentNumber})` : ''} · {stu.gender === 'male' ? (isZh ? '男' : 'M') : stu.gender === 'female' ? (isZh ? '女' : 'F') : (isZh ? '其他' : 'Other')}</span>
                                    {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveFromClass(e)}
                                        className="text-slate-500 hover:text-amber-600"
                                        title={isZh ? '从本班移除' : 'Remove from class'}
                                      >
                                        <UserMinus className="h-4 w-4" />
                                      </button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 未分班学生：当前学年下没有归属任何班级的学生（含从某班移除后的学生） */}
            {unassignedStudents.length > 0 && (
              <section className="bg-amber-50/80 rounded-xl border border-amber-200 p-4 mt-4">
                <h3 className="text-sm font-semibold text-amber-900 mb-2">
                  {isZh ? '未分班学生' : 'Students not in a class'}
                </h3>
                <p className="text-xs text-amber-800/90 mb-2">
                  {isZh ? '以下学生在本学年暂无班级归属，可将其添加到任意班级。' : 'These students have no class in this year; you can add them to a class.'}
                </p>
                <ul className="space-y-1.5">
                  {unassignedStudents.map((stu) => (
                    <li key={stu.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-slate-700">{stu.name} {stu.studentNumber ? `(${stu.studentNumber})` : ''} · {stu.gender === 'male' ? (isZh ? '男' : 'M') : stu.gender === 'female' ? (isZh ? '女' : 'F') : (isZh ? '其他' : 'Other')}</span>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => { setDialogAddToClass(stu); setAddToClassSelectedId(classes[0]?.id ?? ''); }}
                        >
                          {isZh ? '添加到班级' : 'Add to class'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        )}
      </main>

      <Dialog open={dialogCreateYear} onOpenChange={setDialogCreateYear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isZh ? '新建学年' : 'New academic year'}</DialogTitle>
            <DialogDescription>{isZh ? '输入学年名称，如 2024–2025 学年' : 'e.g. 2024–2025'}</DialogDescription>
          </DialogHeader>
          <input
            value={newYearName}
            onChange={(e) => setNewYearName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder={isZh ? '2024–2025 学年' : '2024–2025'}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCreateYear(false)}>{isZh ? '取消' : 'Cancel'}</Button>
            <Button onClick={handleCreateYear} disabled={!newYearName.trim() || submitLoading}>
              {submitLoading ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogCreateClass} onOpenChange={(open) => { if (!open) setNewClassTeacherId(''); setDialogCreateClass(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isZh ? '新建班级' : 'New class'}</DialogTitle>
            <DialogDescription>{isZh ? '年级、班级名称与负责人（教师）' : 'Grade, class name and teacher'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '年级' : 'Grade'}</label>
              <select
                value={newClassGrade}
                onChange={(e) => setNewClassGrade(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {GRADES.map((g) => (
                  <option key={g} value={g}>G{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '班级名称' : 'Class name'}</label>
              <input
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder={isZh ? '如 1班' : 'e.g. Class 1'}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '班主任/负责人' : 'Teacher'}</label>
              <select
                value={newClassTeacherId}
                onChange={(e) => setNewClassTeacherId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"
              >
                <option value="">—</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.displayName || t.username}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCreateClass(false)}>{isZh ? '取消' : 'Cancel'}</Button>
            <Button onClick={handleCreateClass} disabled={!newClassName.trim() || submitLoading}>
              {submitLoading ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateStudentDialog
        open={!!dialogAddStudent}
        onClose={() => setDialogAddStudent(null)}
        currentYearId={currentYearId}
        classesInYear={classes}
        initialGrade={dialogAddStudent?.grade}
        onSuccess={handleCreateStudentSuccess}
        onError={(msg) => setError(msg)}
      />

      <Dialog open={!!dialogAddToClass} onOpenChange={(open) => !open && setDialogAddToClass(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isZh ? '添加到班级' : 'Add to class'}</DialogTitle>
            <DialogDescription>
              {dialogAddToClass && (isZh ? `将「${dialogAddToClass.name}」加入本学年下的一个班级` : `Add "${dialogAddToClass.name}" to a class this year`)}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '选择班级' : 'Select class'}</label>
            <select
              value={addToClassSelectedId}
              onChange={(e) => setAddToClassSelectedId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">—</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>G{c.grade} {c.name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAddToClass(null)}>{isZh ? '取消' : 'Cancel'}</Button>
            <Button onClick={handleAddToClass} disabled={!addToClassSelectedId || submitLoading}>
              {submitLoading ? (isZh ? '添加中…' : 'Adding…') : isZh ? '确定' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogYearManagement} onOpenChange={setDialogYearManagement}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '学年管理' : 'Academic years'}</DialogTitle>
            <DialogDescription>
              {isZh ? '删除学年将同时删除该学年下所有班级与学籍，学生档案保留。' : 'Deleting a year removes all its classes and enrollments; student records are kept.'}
            </DialogDescription>
          </DialogHeader>
          {years.length === 0 ? (
            <p className="text-sm text-slate-500">{isZh ? '暂无学年。' : 'No academic years.'}</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {years.map((y) => (
                <li key={y.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                  <span className="font-medium text-slate-800">{y.name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => handleDeleteYear(y)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {isZh ? '删除' : 'Delete'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogYearManagement(false)}>{isZh ? '关闭' : 'Close'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
