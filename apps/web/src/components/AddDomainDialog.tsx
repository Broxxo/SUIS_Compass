import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useLanguage } from '../contexts/LanguageContext';
import { COURSE_COLORS } from '../lib/constants';
import { getColorValue } from '../lib/courseUtils';
import type { Course, CourseColor } from '../types';

interface AddDomainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: Course[];
  onCreate: (payload: {
    labelZh: string;
    labelEn: string;
    color: CourseColor;
    courseIds: string[];
  }) => void;
}

export default function AddDomainDialog({
  open,
  onOpenChange,
  courses,
  onCreate,
}: AddDomainDialogProps) {
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const [labelZh, setLabelZh] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [color, setColor] = useState<CourseColor>('light-blue');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const coursesSorted = useMemo(
    () => [...courses].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [courses],
  );

  const reset = () => {
    setLabelZh('');
    setLabelEn('');
    setColor('light-blue');
    setSelectedIds([]);
  };

  const toggleCourse = (courseId: string) => {
    setSelectedIds((prev) => (prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]));
  };

  const submit = () => {
    const zh = labelZh.trim() || labelEn.trim();
    const en = labelEn.trim() || labelZh.trim();
    if (!zh && !en) return;
    onCreate({
      labelZh: zh,
      labelEn: en,
      color,
      courseIds: selectedIds,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) reset();
      onOpenChange(next);
    }}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isZh ? '新建领域' : 'New domain'}</DialogTitle>
          <DialogDescription>
            {isZh
              ? '创建领域时可设置色系，并直接把课程加入该领域。'
              : 'Set color family and add courses while creating a domain.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={labelZh}
              onChange={(e) => setLabelZh(e.target.value)}
              placeholder={isZh ? '领域中文名' : 'Domain name (ZH)'}
            />
            <Input
              value={labelEn}
              onChange={(e) => setLabelEn(e.target.value)}
              placeholder={isZh ? '领域英文名' : 'Domain name (EN)'}
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-1.5">{isZh ? '领域色系' : 'Color family'}</div>
            <div className="flex gap-2 flex-wrap">
              {COURSE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-8 h-8 rounded-md border-2 overflow-hidden ${
                    color === c.value ? 'border-slate-800 scale-105' : 'border-slate-300'
                  }`}
                  title={isZh ? c.label : c.labelEn}
                >
                  <div
                    className="w-full h-full"
                    style={{
                      background: `linear-gradient(135deg, ${getColorValue(c.light)} 0%, ${getColorValue(c.light)} 50%, ${getColorValue(c.standard)} 50%, ${getColorValue(c.standard)} 100%)`,
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium mb-1.5">{isZh ? '添加课程（可选）' : 'Add courses (optional)'}</div>
            <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
              {coursesSorted.map((course) => (
                <label key={course.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(course.id)}
                    onChange={() => toggleCourse(course.id)}
                  />
                  <span className="truncate">{course.name}</span>
                </label>
              ))}
              {coursesSorted.length === 0 && (
                <p className="text-xs text-slate-500 px-3 py-2">{isZh ? '暂无课程可选' : 'No courses available'}</p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button onClick={submit} disabled={!labelZh.trim() && !labelEn.trim()}>
            {isZh ? '创建领域' : 'Create domain'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

