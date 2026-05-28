import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import type { CourseDomain, CourseDomainsConfig } from '@repo/shared';
import {
  assignCourseToDomain,
  createCourseDomain,
  deleteCourseDomain,
  getCourseDomainLabel,
  normalizeCourseDomainsConfig,
  reorderCoursesInDomain,
  reorderDomains,
  updateCourseDomainColor,
  updateCourseDomainLabel,
} from '@repo/shared';
import { Course, CourseColor, SubjectCategory } from '../types';
import { Trash2, ChevronUp, ChevronDown, Plus, SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { COURSE_COLORS } from '../lib/constants';
import { getColorValue } from '../lib/courseUtils';
import { getCategoryCanonicalKey, sortCoursesLikeCurriculumRoadmap } from '../lib/utils';
import { logError } from '../lib/errorHandler';
import { useState, useEffect, useMemo } from 'react';
import AddDomainDialog from './AddDomainDialog';

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
  /** 课程领域配置（用于统一排序：领域整体 + 领域内课程） */
  domainsConfig?: CourseDomainsConfig;
  /** 保存领域配置（父组件内 await 写库并 setCourseDomains） */
  onDomainsSave?: (config: CourseDomainsConfig) => void | Promise<void>;
  /** 在课程设置中触发「新建课程」 */
  onCreateCourseRequested?: () => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
  courses,
  onUpdateCourse,
  onDeleteCourse,
  onEditCourse,
  columnOrderItems,
  canReorderColumns = false,
  onColumnOrderSave,
  domainsConfig = { domains: [], domainOrder: [] },
  onDomainsSave,
  onCreateCourseRequested,
}: SettingsDialogProps) {
  const { t, language } = useLanguage();
  const [draftColumnKeys, setDraftColumnKeys] = useState<string[]>([]);
  const [draftDomains, setDraftDomains] = useState<CourseDomainsConfig>(() =>
    normalizeCourseDomainsConfig(domainsConfig),
  );
  const [isAddDomainDialogOpen, setIsAddDomainDialogOpen] = useState(false);
  const [activeDomainSettingsId, setActiveDomainSettingsId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const baselineStr = columnOrderItems.map((i) => i.canonicalKey).join('\0');

  useEffect(() => {
    if (!open) return;
    setDraftColumnKeys(columnOrderItems.map((i) => i.canonicalKey));
    setDraftDomains(normalizeCourseDomainsConfig(domainsConfig));
    setIsAddDomainDialogOpen(false);
    setActiveDomainSettingsId(null);
  }, [open, baselineStr, domainsConfig]);

  const orderDirty =
    canReorderColumns &&
    columnOrderItems.length > 0 &&
    draftColumnKeys.length === columnOrderItems.length &&
    draftColumnKeys.join('\0') !== baselineStr;
  const domainsDirty =
    canReorderColumns &&
    JSON.stringify(normalizeCourseDomainsConfig(draftDomains)) !==
      JSON.stringify(normalizeCourseDomainsConfig(domainsConfig));

  const handleOpenChange = (next: boolean) => {
    if (!next && (orderDirty || domainsDirty)) {
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
    if (!canReorderColumns) return;
    setSavingOrder(true);
    try {
      if (orderDirty && onColumnOrderSave) {
        await onColumnOrderSave(draftColumnKeys);
      }
      if (domainsDirty && onDomainsSave) {
        await onDomainsSave(normalizeCourseDomainsConfig(draftDomains));
      }
      // 领域色系：按领域内顺序自动分配近似颜色（仅在选择了领域色时）
      const colorUpdates = applyDomainColorsToCourses();
      colorUpdates.forEach((u) => onUpdateCourse(u.id, { color: u.color }));
      alert(t('settings.columnOrderSaved'));
    } catch (e) {
      logError('Save course/domain order', e);
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

  const createDomainInDraft = (payload: {
    labelZh: string;
    labelEn: string;
    color: CourseColor;
    courseIds: string[];
  }) => {
    const unassignedSet = new Set(unassignedCourses.map((c) => c.id));
    let next = createCourseDomain(
      draftDomains,
      { zh: payload.labelZh, en: payload.labelEn },
      payload.color,
    );
    const createdId = next.domainOrder[next.domainOrder.length - 1] ?? null;
    if (createdId) {
      payload.courseIds.filter((id) => unassignedSet.has(id)).forEach((courseId) => {
        next = assignCourseToDomain(next, courseId, createdId);
      });
    }
    setDraftDomains(next);
    setActiveDomainSettingsId(createdId);
  };

  const coursesGroupedByCanonical = useMemo(() => {
    const m = new Map<string, Course[]>();
    const coursesInDomains = new Set<string>();
    draftDomains.domains.forEach((d) => d.courseIds.forEach((id) => coursesInDomains.add(id)));
    courses.forEach((c) => {
      if (coursesInDomains.has(c.id)) return;
      const k = getCategoryCanonicalKey(c.subjectCategory) || c.name;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    });
    return m;
  }, [courses, draftDomains]);

  const domainRows = useMemo(() => {
    const byId = new Map(courses.map((c) => [c.id, c]));
    const rows: Array<{ domain: CourseDomain; courses: Course[] }> = [];
    for (const id of draftDomains.domainOrder) {
      const domain = draftDomains.domains.find((d) => d.id === id);
      if (!domain) continue;
      const domainCourses = domain.courseIds
        .map((cid) => byId.get(cid))
        .filter((c): c is Course => Boolean(c));
      if (domainCourses.length === 0) continue;
      rows.push({ domain, courses: domainCourses });
    }
    return rows;
  }, [courses, draftDomains]);

  const unassignedCourses = useMemo(() => {
    const assigned = new Set<string>();
    draftDomains.domains.forEach((d) => d.courseIds.forEach((id) => assigned.add(id)));
    return courses.filter((c) => !assigned.has(c.id));
  }, [courses, draftDomains]);

  const getNearbyColorSequence = (base: CourseColor, count: number): CourseColor[] => {
    const all = COURSE_COLORS.map((c) => c.value);
    const baseIndex = Math.max(0, all.indexOf(base));
    const offsets = [0, -1, 1, -2, 2, -3, 3];
    const sequence: CourseColor[] = [];
    let ptr = 0;
    while (sequence.length < count) {
      const off = offsets[ptr % offsets.length];
      const idx = Math.min(all.length - 1, Math.max(0, baseIndex + off));
      const candidate = all[idx];
      if (!sequence.includes(candidate) || all.length < count) {
        sequence.push(candidate);
      }
      ptr += 1;
      if (ptr > 1000) break;
    }
    return sequence;
  };

  const applyDomainColorsToCourses = (): Array<{ id: string; color: CourseColor }> => {
    const updates: Array<{ id: string; color: CourseColor }> = [];
    draftDomains.domainOrder.forEach((domainId) => {
      const domain = draftDomains.domains.find((d) => d.id === domainId);
      if (!domain || !domain.color) return;
      const seq = getNearbyColorSequence(domain.color, domain.courseIds.length);
      domain.courseIds.forEach((courseId, idx) => {
        const color = seq[idx] ?? domain.color!;
        const c = courses.find((x) => x.id === courseId);
        if (!c || c.color === color) return;
        updates.push({ id: courseId, color });
      });
    });
    return updates;
  };

  const moveDomainBlock = (index: number, delta: -1 | 1) => {
    const order = [...draftDomains.domainOrder];
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    setDraftDomains((prev) => reorderDomains(prev, order));
  };

  const moveCourseInDomain = (domainId: string, index: number, delta: -1 | 1) => {
    const domain = draftDomains.domains.find((d) => d.id === domainId);
    if (!domain) return;
    const ids = [...domain.courseIds];
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setDraftDomains((prev) => reorderCoursesInDomain(prev, domainId, ids));
  };

  const updateDomainName = (domainId: string, patch: { zh?: string; en?: string }) => {
    const domain = draftDomains.domains.find((d) => d.id === domainId);
    if (!domain) return;
    setDraftDomains((prev) =>
      updateCourseDomainLabel(prev, domainId, {
        zh: patch.zh ?? domain.label.zh,
        en: patch.en ?? domain.label.en,
      }),
    );
  };

  const addCourseToDomain = (domainId: string, courseId: string) => {
    setDraftDomains((prev) => assignCourseToDomain(prev, courseId, domainId));
  };

  const removeCourseFromDomain = (courseId: string) => {
    setDraftDomains((prev) => assignCourseToDomain(prev, courseId, null));
  };

  const removeDomain = (domainId: string) => {
    setDraftDomains((prev) => deleteCourseDomain(prev, domainId));
    setActiveDomainSettingsId((prev) => (prev === domainId ? null : prev));
  };

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
        </DialogHeader>
        <div className="py-4 flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
          <div className="flex-shrink-0 space-y-2">
            <div className="text-sm font-medium text-slate-700">
              {language === 'zh' ? '课程列表' : 'Courses'}
            </div>
            {canReorderColumns && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onCreateCourseRequested?.()}>
                  <Plus className="w-4 h-4 mr-1" />
                  {language === 'zh' ? '新建课程' : 'New course'}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setIsAddDomainDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  {language === 'zh' ? '新建领域' : 'New domain'}
                </Button>
              </div>
            )}
          </div>

          {canReorderColumns && columnOrderItems.length > 0 ? (
            <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
              {domainRows.map(({ domain, courses: domainCourses }, domainIndex) => (
                <div key={domain.id} className="flex gap-2 min-w-0 items-start">
                  <div className="flex shrink-0 gap-1 pt-0.5">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={domainIndex === 0}
                        onClick={() => moveDomainBlock(domainIndex, -1)}
                        className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none disabled:text-slate-400"
                        title={language === 'zh' ? '整块上移' : 'Move block up'}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={domainIndex === domainRows.length - 1}
                        onClick={() => moveDomainBlock(domainIndex, 1)}
                        className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none disabled:text-slate-400"
                        title={language === 'zh' ? '整块下移' : 'Move block down'}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-slate-600">
                        {language === 'zh' ? '领域' : 'Domain'} · {getCourseDomainLabel(domain.label, language)}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() =>
                          setActiveDomainSettingsId((prev) => (prev === domain.id ? null : domain.id))
                        }
                        title={language === 'zh' ? '配置领域' : 'Configure domain'}
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {activeDomainSettingsId === domain.id && (
                      <div className="rounded-md border border-slate-200 bg-white p-2.5 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={domain.label.zh}
                            onChange={(e) => updateDomainName(domain.id, { zh: e.target.value })}
                            className="h-8 rounded-md border border-slate-300 px-2 text-sm"
                            placeholder={language === 'zh' ? '领域中文名' : 'Domain ZH'}
                          />
                          <input
                            value={domain.label.en}
                            onChange={(e) => updateDomainName(domain.id, { en: e.target.value })}
                            className="h-8 rounded-md border border-slate-300 px-2 text-sm"
                            placeholder={language === 'zh' ? '领域英文名' : 'Domain EN'}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 shrink-0">
                            {language === 'zh' ? '领域色系' : 'Color family'}
                          </span>
                          <select
                            className="h-8 rounded-md border border-slate-300 px-2 text-sm bg-white"
                            value={domain.color ?? ''}
                            onChange={(e) =>
                              setDraftDomains((prev) =>
                                updateCourseDomainColor(prev, domain.id, (e.target.value || undefined) as CourseColor | undefined),
                              )
                            }
                          >
                            <option value="">{language === 'zh' ? '不自动改色' : 'No auto color'}</option>
                            {COURSE_COLORS.map((c) => (
                              <option key={c.value} value={c.value}>
                                {language === 'zh' ? c.label : c.labelEn}
                              </option>
                            ))}
                          </select>
                        </div>
                        {unassignedCourses.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 shrink-0">
                              {language === 'zh' ? '添加课程' : 'Add course'}
                            </span>
                            <select
                              className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-sm bg-white"
                              defaultValue=""
                              onChange={(e) => {
                                const cid = e.target.value;
                                if (cid) addCourseToDomain(domain.id, cid);
                                e.target.value = '';
                              }}
                            >
                              <option value="">{language === 'zh' ? '选择课程…' : 'Select course…'}</option>
                              {unassignedCourses.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="pt-1 border-t border-slate-100">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => removeDomain(domain.id)}
                          >
                            {language === 'zh' ? '删除领域' : 'Delete domain'}
                          </Button>
                        </div>
                      </div>
                    )}
                    {domainCourses.map((course, idx) => (
                      <div
                        key={course.id}
                        className="flex items-center gap-2.5 border rounded-lg px-3.5 py-2.5 min-w-0 bg-white"
                      >
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveCourseInDomain(domain.id, idx, -1)}
                            className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none disabled:text-slate-400"
                            title={language === 'zh' ? '领域内上移' : 'Move up in domain'}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === domainCourses.length - 1}
                            onClick={() => moveCourseInDomain(domain.id, idx, 1)}
                            className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none disabled:text-slate-400"
                            title={language === 'zh' ? '领域内下移' : 'Move down in domain'}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                        <div
                          className="w-[21px] h-[21px] rounded flex-shrink-0 border border-gray-300"
                          style={{ background: colorGradient(course) }}
                        />
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 shrink-0">
                          {language === 'zh' ? '领域' : 'Domain'}
                        </span>
                        <span className="text-[15px] font-medium truncate flex-1 min-w-0" title={course.name}>
                          {course.name}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-[30px] px-2 text-xs"
                          onClick={() => removeCourseFromDomain(course.id)}
                          title={language === 'zh' ? '移出领域' : 'Remove from domain'}
                        >
                          {language === 'zh' ? '移出' : 'Remove'}
                        </Button>
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
              ))}

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
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 shrink-0">
                            {language === 'zh' ? '无领域' : 'No domain'}
                          </span>
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
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 shrink-0">
                    {language === 'zh' ? '按分类' : 'By category'}
                  </span>
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

        <DialogFooter className="flex-shrink-0 flex flex-wrap gap-2 sm:justify-end">
          {canReorderColumns && (
            <Button
              type="button"
              onClick={() => { void handleSaveColumnOrder(); }}
              disabled={(!orderDirty && !domainsDirty) || savingOrder}
            >
              {savingOrder ? (language === 'zh' ? '保存中…' : 'Saving…') : t('settings.saveColumnOrder')}
            </Button>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AddDomainDialog
        open={isAddDomainDialogOpen}
        onOpenChange={setIsAddDomainDialogOpen}
        courses={unassignedCourses}
        onCreate={createDomainInDraft}
      />
    </Dialog>
  );
}
