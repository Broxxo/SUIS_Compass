import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Course, CourseColor, SubjectCategory } from '../types';
import { Trash2, Download, Upload, ChevronUp, ChevronDown } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { COURSE_COLORS } from '../lib/constants';
import { getColorValue } from '../lib/courseUtils';
import { exportAllDataSync, importAllData } from '../lib/storage';
import { getCategoryCanonicalKey, sortCoursesLikeCurriculumRoadmap } from '../lib/utils';
import { logError } from '../lib/errorHandler';
import { useState, useRef, useEffect, useMemo } from 'react';

interface ColumnOrderItem {
  canonicalKey: string;
  displayKey: string;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: Course[];
  onUpdateCourse: (
    courseId: string,
    updates: {
      name?: string;
      subjectCategory?: SubjectCategory | string;
      applicableGrades?: string[];
      weeklyPeriodsByGrade?: Record<string, number>;
      textbookVersion?: string;
      color?: CourseColor;
    },
  ) => void;
  onDeleteCourse: (courseId: string) => void | Promise<void>;
  onEditCourse?: (course: Course) => void;
  /** 与整体视图一致的学科列（顺序即当前已提交顺序） */
  columnOrderItems: ColumnOrderItem[];
  /** 可编辑列顺序时展示「保存顺序」与箭头排序（课程管理管理员） */
  canReorderColumns?: boolean;
  /** 保存顺序：父组件内 await 写库并 setCategoryOrder */
  onColumnOrderSave?: (keys: string[]) => void | Promise<void>;
}

export default function SettingsDialog({
  open,
  onOpenChange,
  courses,
  onUpdateCourse: _onUpdateCourse,
  onDeleteCourse,
  onEditCourse,
  columnOrderItems,
  canReorderColumns = false,
  onColumnOrderSave,
}: SettingsDialogProps) {
  const { t, language } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [draftColumnKeys, setDraftColumnKeys] = useState<string[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const baselineStr = columnOrderItems.map((i) => i.canonicalKey).join('\0');

  useEffect(() => {
    if (!open) return;
    setDraftColumnKeys(columnOrderItems.map((i) => i.canonicalKey));
  }, [open, baselineStr]);

  const orderDirty =
    canReorderColumns &&
    columnOrderItems.length > 0 &&
    draftColumnKeys.length === columnOrderItems.length &&
    draftColumnKeys.join('\0') !== baselineStr;

  const handleOpenChange = (next: boolean) => {
    if (!next && orderDirty) {
      const ok = window.confirm(t('settings.unsavedColumnOrderConfirm'));
      if (!ok) return;
    }
    onOpenChange(next);
  };

  const moveColumn = (index: number, delta: -1 | 1) => {
    setDraftColumnKeys((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleSaveColumnOrder = async () => {
    if (!canReorderColumns || !onColumnOrderSave) return;
    setSavingOrder(true);
    try {
      await onColumnOrderSave(draftColumnKeys);
      alert(t('settings.columnOrderSaved'));
    } catch (e) {
      logError('Save category order', e);
      alert(t('settings.columnOrderSaveFailed'));
    } finally {
      setSavingOrder(false);
    }
  };

  const handleEditCourse = (course: Course) => {
    if (onEditCourse) {
      onEditCourse(course);
    }
  };

  const handleDeleteCourse = (courseId: string, courseName: string) => {
    const confirmMsg = language === 'zh'
      ? `确定要删除课程"${courseName}"吗？\n\n此操作将删除该课程的所有学期数据和单元信息，且无法恢复。`
      : `Are you sure you want to delete course "${courseName}"?\n\nThis will delete all semester data and unit information for this course and cannot be undone.`;
    if (window.confirm(confirmMsg)) {
      onDeleteCourse(courseId);
    }
  };

  const handleExportData = () => {
    try {
      const data = exportAllDataSync();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `curriculum-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const successMsg = language === 'zh'
        ? '数据导出成功！'
        : 'Data exported successfully!';
      alert(successMsg);
    } catch (error) {
      logError('Export failed', error);
      const errorMsg = language === 'zh'
        ? '数据导出失败，请重试。'
        : 'Export failed, please try again.';
      alert(errorMsg);
    }
  };

  const handleImportData = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const confirmMsg = language === 'zh'
        ? '导入数据将覆盖当前所有数据（课程、单元、概念等），确定要继续吗？\n\n注意：导入的数据将保存到当前登录账号中。'
        : 'Importing data will overwrite all current data (courses, units, concepts, etc.). Are you sure you want to continue?\n\nNote: Imported data will be saved to the currently logged-in account.';

      if (window.confirm(confirmMsg)) {
        const result = await importAllData(data);
        if (result.success) {
          const successMsg = language === 'zh'
            ? '数据导入成功！页面将刷新以应用更改。'
            : 'Data imported successfully! The page will refresh to apply changes.';
          alert(successMsg);
          window.location.reload();
        } else {
          const errorMsg = language === 'zh'
            ? `数据导入失败：${result.error || '未知错误'}`
            : `Import failed: ${result.error || 'Unknown error'}`;
          alert(errorMsg);
        }
      }
    } catch (error) {
      logError('Import failed', error);
      const errorMsg = language === 'zh'
        ? '文件格式错误，请确保选择的是有效的JSON文件。'
        : 'Invalid file format. Please ensure you selected a valid JSON file.';
      alert(errorMsg);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const coursesGroupedByCanonical = useMemo(() => {
    const m = new Map<string, Course[]>();
    courses.forEach((c) => {
      const k = getCategoryCanonicalKey(c.subjectCategory) || c.name;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    });
    return m;
  }, [courses]);

  const coursesForFlatList = useMemo(
    () => sortCoursesLikeCurriculumRoadmap(courses, columnOrderItems.map((i) => i.canonicalKey)),
    [courses, columnOrderItems],
  );

  const colorConfig = (c: Course) => COURSE_COLORS.find((x) => x.value === c.color) ?? COURSE_COLORS[0];
  const colorGradient = (c: Course) => {
    const cc = colorConfig(c);
    const light = getColorValue(cc.light);
    const standard = getColorValue(cc.standard);
    return `linear-gradient(135deg, ${light} 0%, ${light} 50%, ${standard} 50%, ${standard} 100%)`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t('settings.courseManagement')}</DialogTitle>
          <DialogDescription>
            {language === 'zh' ? '管理课程列表与数据导入导出' : 'Manage course list and data import/export'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
          <div className="flex-shrink-0">
            <div className="text-sm font-medium text-slate-700">
              {language === 'zh' ? '课程列表' : 'Courses'}
            </div>
            {canReorderColumns && columnOrderItems.length > 0 && (
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{t('settings.columnOrderHint')}</p>
            )}
          </div>

          {canReorderColumns && columnOrderItems.length > 0 ? (
            <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
              {draftColumnKeys.map((canonicalKey, groupIndex) => {
                const groupCourses = coursesGroupedByCanonical.get(canonicalKey) ?? [];
                if (groupCourses.length === 0) return null;
                return (
                  <div key={canonicalKey} className="flex gap-2 min-w-0 items-start">
                    <div className="flex shrink-0 gap-1 pt-0.5">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          disabled={groupIndex === 0}
                          onClick={() => moveColumn(groupIndex, -1)}
                          className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none disabled:text-slate-400"
                          title={language === 'zh' ? '整列上移' : 'Move column up'}
                          aria-label={language === 'zh' ? '整列上移' : 'Move column up'}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={groupIndex === draftColumnKeys.length - 1}
                          onClick={() => moveColumn(groupIndex, 1)}
                          className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none disabled:text-slate-400"
                          title={language === 'zh' ? '整列下移' : 'Move column down'}
                          aria-label={language === 'zh' ? '整列下移' : 'Move column down'}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                      <span className="tabular-nums text-sm font-semibold text-slate-500 w-6 text-center pt-1">
                        {groupIndex + 1}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      {groupCourses.map((course) => (
                        <div
                          key={course.id}
                          className="flex items-center gap-2.5 border rounded-lg px-3.5 py-2.5 min-w-0 bg-white"
                        >
                          <div
                            className="w-[21px] h-[21px] rounded flex-shrink-0 border border-gray-300"
                            style={{ background: colorGradient(course) }}
                          />
                          <span className="text-[15px] font-medium truncate flex-1 min-w-0" title={course.name}>
                            {course.name}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Button
                              onClick={() => handleEditCourse(course)}
                              variant="outline"
                              size="sm"
                              className="h-[30px] px-2.5 text-xs"
                            >
                              {t('common.edit')}
                            </Button>
                            <Button
                              onClick={() => handleDeleteCourse(course.id, course.name)}
                              variant="outline"
                              size="sm"
                              className="h-[30px] w-[30px] p-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 min-h-0 overflow-y-auto pr-1">
              {coursesForFlatList.map((course) => (
                <div
                  key={course.id}
                  className="flex items-center gap-2.5 border rounded-lg px-3.5 py-2.5 min-w-0"
                >
                  <div
                    className="w-[21px] h-[21px] rounded flex-shrink-0 border border-gray-300"
                    style={{ background: colorGradient(course) }}
                  />
                  <span className="text-[15px] font-medium truncate flex-1 min-w-0" title={course.name}>
                    {course.name}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      onClick={() => handleEditCourse(course)}
                      variant="outline"
                      size="sm"
                      className="h-[30px] px-2.5 text-xs"
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      onClick={() => handleDeleteCourse(course.id, course.name)}
                      variant="outline"
                      size="sm"
                      className="h-[30px] w-[30px] p-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 pt-4 border-t flex-shrink-0">
          <div className="flex flex-col gap-3">
            <div className="text-sm font-medium text-gray-700">
              {language === 'zh' ? '数据管理' : 'Data Management'}
            </div>
            <div className="text-xs text-gray-500 mb-2">
              {language === 'zh'
                ? '导出或导入所有数据（课程、单元、概念等），方便跨设备迁移'
                : 'Export or import all data (courses, units, concepts, etc.) for cross-device migration'}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleExportData}
                className="flex-1"
              >
                <Download className="w-4 h-4 mr-2" />
                {language === 'zh' ? '导出数据' : 'Export Data'}
              </Button>
              <Button
                variant="outline"
                onClick={handleImportData}
                disabled={isImporting}
                className="flex-1"
              >
                <Upload className="w-4 h-4 mr-2" />
                {isImporting
                  ? (language === 'zh' ? '导入中...' : 'Importing...')
                  : (language === 'zh' ? '导入数据' : 'Import Data')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 flex flex-wrap gap-2 sm:justify-end">
          {canReorderColumns && (
            <Button
              type="button"
              onClick={() => { void handleSaveColumnOrder(); }}
              disabled={!orderDirty || savingOrder || draftColumnKeys.length === 0}
            >
              {savingOrder ? (language === 'zh' ? '保存中…' : 'Saving…') : t('settings.saveColumnOrder')}
            </Button>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
