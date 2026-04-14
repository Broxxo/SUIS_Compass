/**
 * 统一的创建学生弹窗：所有入口共用，当前年级（数值）为必填（G1-G9），可选加入班级。
 */
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { useLanguage } from '../contexts/LanguageContext';
import type { Student, ClassItem } from '../types/classManagement';
import { createStudent } from '../lib/classStorage';
import { GRADES } from '../lib/constants';

/** 固定 9 个年级选项，显示为 G1-G9 */
const GRADE_OPTIONS = GRADES;

export interface CreateStudentDialogProps {
  open: boolean;
  onClose: () => void;
  /** 当前学年 ID（用于可选加入班级） */
  currentYearId: string | null;
  /** 当前学年下的班级（用于可选「加入班级」下拉） */
  classesInYear: ClassItem[];
  /** 预填年级（如从班级添加入口时传入班级年级） */
  initialGrade?: number;
  /** 创建成功回调 */
  onSuccess: (student: Student) => void;
  /** 错误回调 */
  onError?: (message: string) => void;
  /** 可选：创建后将该学生加入某班级（学生管理里选「加入班级」时调用） */
  onEnroll?: (studentId: string, classId: string, academicYearId: string) => Promise<void>;
}

export default function CreateStudentDialog({
  open,
  onClose,
  currentYearId,
  classesInYear,
  initialGrade,
  onSuccess,
  onError,
  onEnroll,
}: CreateStudentDialogProps) {
  const { language } = useLanguage();
  const isZh = language === 'zh';

  const [nameZh, setNameZh] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [grade, setGrade] = useState<string>(initialGrade != null ? String(initialGrade) : '1');
  const [gender, setGender] = useState<Student['gender']>('male');
  const [division, setDivision] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [status, setStatus] = useState<Student['status']>('active');
  const [studentNumber, setStudentNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [enrollClassId, setEnrollClassId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNameZh('');
    setNameEn('');
    setGrade(initialGrade != null ? String(initialGrade) : '1');
    setGender('male');
    setDivision('');
    setEntryDate('');
    setStatus('active');
    setStudentNumber('');
    setDateOfBirth('');
    setEnrollClassId('');
  }, [open, initialGrade]);

  const handleSubmit = async () => {
    const zh = nameZh.trim();
    const en = nameEn.trim();
    if ((!zh && !en) || !grade.trim()) return;
    setLoading(true);
    if (onError) onError('');
    try {
      const studentId = `stu-${Date.now()}`;
      const student: Student = {
        id: studentId,
        name: zh || en,
        nameZh: zh || null,
        nameEn: en || null,
        gender,
        currentGrade: Number(grade),
        division: division.trim() || null,
        entryDate: entryDate.trim() || null,
        status: status || 'active',
        studentNumber: studentNumber.trim() || undefined,
        dateOfBirth: dateOfBirth.trim() || undefined,
      };
      await createStudent(student);
      if (enrollClassId && currentYearId && onEnroll) {
        await onEnroll(studentId, enrollClassId, currentYearId);
      }
      onSuccess(student);
      onClose();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || 'Failed to create student';
      if (onError) onError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isZh ? '创建学生' : 'Create student'}</DialogTitle>
          <DialogDescription>
            {currentYearId
              ? (isZh ? '填写学生信息，当前年级（数值）为必填（当前学年）' : 'Fill in student info. Current grade is required (current year)')
              : (isZh ? '请先选择当前学年' : 'Select current year first')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '中文名' : 'Chinese name'}</label>
              <input
                value={nameZh}
                onChange={(e) => setNameZh(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '英文名' : 'English name'}</label>
              <input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 -mt-1">
            {isZh ? '中文名和英文名至少填写一个。' : 'Please provide at least one of Chinese or English name.'}
          </p>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '当前年级（数值）' : 'Current grade (number)'} *</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={String(g)}>G{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '性别' : 'Gender'}</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as Student['gender'])}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="male">{isZh ? '男' : 'Male'}</option>
              <option value="female">{isZh ? '女' : 'Female'}</option>
              <option value="other">{isZh ? '其他' : 'Other'}</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '学部（可选）' : 'Division (optional)'}</label>
              <input
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={isZh ? '如 小学部/初中部' : 'e.g. Primary'}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '在读状态' : 'Status'}</label>
              <select
                value={status || 'active'}
                onChange={(e) => setStatus(e.target.value as Student['status'])}
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
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '入学时间（可选）' : 'Entry date (optional)'}</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '学号（可选）' : 'Student number (optional)'}</label>
            <input
              value={studentNumber}
              onChange={(e) => setStudentNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{isZh ? '出生日期（可选）' : 'Date of birth (optional)'}</label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            />
          </div>
          {currentYearId && classesInYear.length > 0 && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '加入班级（可选）' : 'Add to class (optional)'}</label>
              <select
                value={enrollClassId}
                onChange={(e) => setEnrollClassId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">—</option>
                {classesInYear.map((c) => (
                  <option key={c.id} value={c.id}>G{c.grade} {c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</Button>
          <Button onClick={handleSubmit} disabled={(!nameZh.trim() && !nameEn.trim()) || !grade.trim() || loading}>
            {loading ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
