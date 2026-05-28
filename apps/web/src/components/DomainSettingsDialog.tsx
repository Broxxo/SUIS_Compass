import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, Trash2, X } from 'lucide-react';
import type { Course } from '../types';
import type { CourseDomainsConfig } from '@repo/shared';
import {
  assignCourseToDomain,
  createCourseDomain,
  deleteCourseDomain,
  getCourseDomainLabel,
  normalizeCourseDomainsConfig,
  updateCourseDomainLabel,
} from '@repo/shared';
import { useLanguage } from '../contexts/LanguageContext';
import { getColorValue } from '../lib/courseUtils';
import { COURSE_COLORS } from '../lib/constants';
import { logError } from '../lib/errorHandler';

interface DomainSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: Course[];
  domainsConfig: CourseDomainsConfig;
  onSave: (config: CourseDomainsConfig) => void | Promise<void>;
}

export default function DomainSettingsDialog({
  open,
  onOpenChange,
  courses,
  domainsConfig,
  onSave,
}: DomainSettingsDialogProps) {
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const [draft, setDraft] = useState<CourseDomainsConfig>(() => normalizeCourseDomainsConfig(domainsConfig));
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [newZh, setNewZh] = useState('');
  const [newEn, setNewEn] = useState('');
  const [editZh, setEditZh] = useState('');
  const [editEn, setEditEn] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeCourseDomainsConfig(domainsConfig);
    setDraft(normalized);
    setSelectedDomainId((prev) => {
      if (prev && normalized.domains.some((d) => d.id === prev)) return prev;
      return normalized.domainOrder[0] ?? null;
    });
    setNewZh('');
    setNewEn('');
  }, [open, domainsConfig]);

  const selectedDomain = draft.domains.find((d) => d.id === selectedDomainId) ?? null;

  useEffect(() => {
    if (!selectedDomain) {
      setEditZh('');
      setEditEn('');
      return;
    }
    setEditZh(selectedDomain.label.zh);
    setEditEn(selectedDomain.label.en);
  }, [selectedDomain?.id, selectedDomain?.label.zh, selectedDomain?.label.en]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const coursesInSelected = useMemo(() => {
    if (!selectedDomain) return [];
    return selectedDomain.courseIds
      .map((id) => courseById.get(id))
      .filter((c): c is Course => Boolean(c));
  }, [selectedDomain, courseById]);

  const availableToAdd = useMemo(() => {
    const inAny = new Set<string>();
    draft.domains.forEach((d) => d.courseIds.forEach((id) => inAny.add(id)));
    return courses.filter((c) => !inAny.has(c.id));
  }, [courses, draft.domains]);

  const handleCreate = () => {
    if (!newZh.trim() && !newEn.trim()) return;
    const next = createCourseDomain(draft, {
      zh: newZh.trim() || newEn.trim(),
      en: newEn.trim() || newZh.trim(),
    });
    setDraft(next);
    const created = next.domainOrder[next.domainOrder.length - 1];
    setSelectedDomainId(created);
    setNewZh('');
    setNewEn('');
  };

  const handleDeleteDomain = () => {
    if (!selectedDomainId) return;
    const label = selectedDomain
      ? getCourseDomainLabel(selectedDomain.label, language)
      : '';
    const msg = isZh
      ? `确定删除领域「${label}」？领域内课程将变为未分组（不会删除课程本身）。`
      : `Delete domain "${label}"? Courses will become ungrouped (courses are not deleted).`;
    if (!window.confirm(msg)) return;
    const next = deleteCourseDomain(draft, selectedDomainId);
    setDraft(next);
    setSelectedDomainId(next.domainOrder[0] ?? null);
  };

  const applyLabelEdit = () => {
    if (!selectedDomainId) return;
    setDraft(updateCourseDomainLabel(draft, selectedDomainId, { zh: editZh, en: editEn }));
  };

  const addCourseToDomain = (courseId: string) => {
    if (!selectedDomainId) return;
    setDraft(assignCourseToDomain(draft, courseId, selectedDomainId));
  };

  const removeCourseFromDomain = (courseId: string) => {
    setDraft(assignCourseToDomain(draft, courseId, null));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(normalizeCourseDomainsConfig(draft));
      onOpenChange(false);
    } catch (e) {
      logError('Save course domains', e);
      alert(isZh ? '保存失败，请重试。' : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const colorGradient = (c: Course) => {
    const cc = COURSE_COLORS.find((x) => x.value === c.color) ?? COURSE_COLORS[0];
    const light = getColorValue(cc.light);
    const standard = getColorValue(cc.standard);
    return `linear-gradient(135deg, ${light} 0%, ${light} 50%, ${standard} 50%, ${standard} 100%)`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] flex flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{isZh ? '领域设置' : 'Course domains'}</DialogTitle>
          <DialogDescription>
            {isZh
              ? '将多门课程归入同一「课程领域」，在课程河流整体视图中紧密排列为一组。每门课仍独立维护单元与课时。'
              : 'Group courses into domains. In the curriculum overview they appear as one tight cluster. Each course stays independent.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-4 flex-1 min-h-0 py-2">
          <div className="sm:w-[220px] flex flex-col gap-2 min-h-0 shrink-0">
            <div className="text-sm font-medium text-slate-700">{isZh ? '领域列表' : 'Domains'}</div>
            <div className="flex gap-2">
              <Input
                value={newZh}
                onChange={(e) => setNewZh(e.target.value)}
                placeholder={isZh ? '中文名' : 'Name (ZH)'}
                className="h-8 text-sm"
              />
              <Input
                value={newEn}
                onChange={(e) => setNewEn(e.target.value)}
                placeholder={isZh ? '英文名' : 'Name (EN)'}
                className="h-8 text-sm"
              />
            </div>
            <Button type="button" size="sm" variant="outline" className="w-full" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-1" />
              {isZh ? '新建领域' : 'New domain'}
            </Button>
            <div className="flex-1 min-h-[120px] overflow-y-auto border rounded-lg divide-y">
              {draft.domainOrder.map((id) => {
                const d = draft.domains.find((x) => x.id === id);
                if (!d) return null;
                const active = id === selectedDomainId;
                return (
                  <div
                    key={id}
                    className={`flex items-center gap-1 px-2 py-2 text-sm cursor-pointer ${active ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50'}`}
                    onClick={() => setSelectedDomainId(id)}
                  >
                    <span className="flex-1 truncate font-medium">
                      {getCourseDomainLabel(d.label, language) || (isZh ? '未命名' : 'Untitled')}
                    </span>
                    <span className="text-xs text-slate-400 tabular-nums">{d.courseIds.length}</span>
                  </div>
                );
              })}
              {draft.domainOrder.length === 0 && (
                <p className="text-xs text-slate-500 p-3">{isZh ? '暂无领域' : 'No domains yet'}</p>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0 border-t sm:border-t-0 sm:border-l sm:pl-4 pt-3 sm:pt-0">
            {selectedDomain ? (
              <>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-xs text-slate-500">{isZh ? '领域中文名' : 'Label (ZH)'}</label>
                    <Input value={editZh} onChange={(e) => setEditZh(e.target.value)} onBlur={applyLabelEdit} className="h-8 mt-0.5" />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-xs text-slate-500">{isZh ? '领域英文名' : 'Label (EN)'}</label>
                    <Input value={editEn} onChange={(e) => setEditEn(e.target.value)} onBlur={applyLabelEdit} className="h-8 mt-0.5" />
                  </div>
                  <Button type="button" variant="outline" size="sm" className="text-red-600" onClick={handleDeleteDomain}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {isZh ? '删除领域' : 'Delete'}
                  </Button>
                </div>

                <div className="text-sm font-medium text-slate-700">{isZh ? '领域内课程（顺序在课程设置中统一调整）' : 'Courses in domain (order is managed in Course settings)'}</div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                  {coursesInSelected.map((course) => (
                    <div key={course.id} className="flex items-center gap-2 border rounded-lg px-2 py-2 bg-white">
                      <div className="w-4 h-4 rounded shrink-0 border border-gray-300" style={{ background: colorGradient(course) }} />
                      <span className="flex-1 text-sm truncate" title={course.name}>{course.name}</span>
                      <button type="button" className="p-1 text-slate-500 hover:text-red-600" onClick={() => removeCourseFromDomain(course.id)} title={isZh ? '移出领域' : 'Remove'}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {coursesInSelected.length === 0 && (
                    <p className="text-xs text-slate-500">{isZh ? '从下方添加课程' : 'Add courses below'}</p>
                  )}
                </div>

                {availableToAdd.length > 0 && (
                  <div className="border-t pt-2 shrink-0">
                    <div className="text-xs text-slate-500 mb-1">{isZh ? '添加课程到本领域' : 'Add course'}</div>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white"
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id) addCourseToDomain(id);
                        e.target.value = '';
                      }}
                    >
                      <option value="">{isZh ? '选择课程…' : 'Select course…'}</option>
                      {availableToAdd.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">{isZh ? '请选择或新建一个领域' : 'Select or create a domain'}</p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
