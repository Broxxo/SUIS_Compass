import { useState } from 'react';
import OrgStructurePanel from './OrgStructurePanel';
import GradeStructureEditor from '../GradeStructureEditor';
import ClassManagement from '../ClassManagement';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Plus } from 'lucide-react';
import type { AcademicYear } from '../../types/classManagement';
import { SegmentTabButton } from '../ui/segment-tab-button';

export type FoundationSubTab = 'years' | 'structure' | 'classes' | 'organization';

type FoundationSettingsPanelProps = {
  isZh: boolean;
  subTab: FoundationSubTab;
  onSubTabChange: (tab: FoundationSubTab) => void;
  canEditYears: boolean;
  canEditStructure: boolean;
  canMutateOrg: boolean;
  years: AcademicYear[];
  yearLoading: boolean;
  currentYearId: string | null;
  setCurrentYearId: (id: string | null) => void;
  setCurrentAcademicYearIdAndSync: (id: string | null) => void | Promise<void>;
  onOpenCreateYear: () => void;
  onOpenYearManagement: () => void;
  onPromoteToNextYear?: () => void;
  promoteLoading?: boolean;
  promotePreviewLoading?: boolean;
  currentYearClassCount: number | null;
  currentYearStudentCount: number | null;
  currentYearClasses: Array<{ cls: { id: string; grade: number; name: string }; studentCount: number }>;
  getGradeLabel: (grade: number) => string;
  onOrgError: (msg: string) => void;
  onDepartmentsChange: () => void;
  onStructureSaved?: () => void;
  onDefaultYearChanged?: () => void | Promise<void>;
};

export default function FoundationSettingsPanel({
  isZh,
  subTab,
  onSubTabChange,
  canEditYears,
  canEditStructure,
  canMutateOrg,
  years,
  yearLoading,
  currentYearId,
  setCurrentYearId,
  setCurrentAcademicYearIdAndSync,
  onOpenCreateYear,
  onOpenYearManagement,
  onPromoteToNextYear,
  promoteLoading = false,
  promotePreviewLoading = false,
  currentYearClassCount,
  currentYearStudentCount,
  currentYearClasses,
  getGradeLabel,
  onOrgError,
  onDepartmentsChange,
  onStructureSaved,
  onDefaultYearChanged,
}: FoundationSettingsPanelProps) {
  const [defaultYearSwitchOpen, setDefaultYearSwitchOpen] = useState(false);
  const [pendingDefaultYearId, setPendingDefaultYearId] = useState<string | null>(null);
  const [defaultYearSwitchLoading, setDefaultYearSwitchLoading] = useState(false);

  const pendingYear = pendingDefaultYearId
    ? years.find((y) => y.id === pendingDefaultYearId) ?? null
    : null;
  const currentYear = currentYearId ? years.find((y) => y.id === currentYearId) ?? null : null;

  const requestDefaultYearSwitch = (nextId: string | null) => {
    if (!nextId || nextId === currentYearId) return;
    setPendingDefaultYearId(nextId);
    setDefaultYearSwitchOpen(true);
  };

  const cancelDefaultYearSwitch = () => {
    setDefaultYearSwitchOpen(false);
    setPendingDefaultYearId(null);
  };

  const confirmDefaultYearSwitch = async () => {
    if (!pendingDefaultYearId) return;
    setDefaultYearSwitchLoading(true);
    try {
      setCurrentYearId(pendingDefaultYearId);
      await setCurrentAcademicYearIdAndSync(pendingDefaultYearId);
      await onDefaultYearChanged?.();
      setDefaultYearSwitchOpen(false);
      setPendingDefaultYearId(null);
    } finally {
      setDefaultYearSwitchLoading(false);
    }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <SegmentTabButton active={subTab === 'years'} onClick={() => onSubTabChange('years')}>
          {isZh ? '学年管理' : 'Academic years'}
        </SegmentTabButton>
        <SegmentTabButton active={subTab === 'structure'} onClick={() => onSubTabChange('structure')}>
          {isZh ? '学段与年级' : 'Stages & grades'}
        </SegmentTabButton>
        <SegmentTabButton active={subTab === 'classes'} onClick={() => onSubTabChange('classes')}>
          {isZh ? '班级管理' : 'Classes'}
        </SegmentTabButton>
        <SegmentTabButton active={subTab === 'organization'} onClick={() => onSubTabChange('organization')}>
          {isZh ? '组织架构' : 'Organization'}
        </SegmentTabButton>
      </div>

      {subTab === 'years' && (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          {!canEditYears && (
            <p className="text-sm text-slate-500">{isZh ? '仅系统管理员可创建和修改学年。' : 'Only system admin can create and modify academic years.'}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-700">{isZh ? '系统默认学年' : 'System default year'}</label>
            <select
              value={currentYearId || ''}
              onChange={(e) => {
                const id = e.target.value || null;
                if (!canEditYears) return;
                requestDefaultYearSwitch(id);
              }}
              disabled={!canEditYears}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="">—</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? (isZh ? '（默认）' : ' (default)') : ''}
                </option>
              ))}
            </select>
            {canEditYears && (
              <>
                <Button size="sm" variant="outline" onClick={onOpenCreateYear}>
                  <Plus className="h-4 w-4 mr-1" />
                  {isZh ? '新建学年' : 'New year'}
                </Button>
                {onPromoteToNextYear && currentYearId && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={onPromoteToNextYear}
                    disabled={promoteLoading || promotePreviewLoading}
                  >
                    {promotePreviewLoading
                      ? (isZh ? '加载预览…' : 'Loading preview…')
                      : promoteLoading
                        ? (isZh ? '升学年中…' : 'Promoting…')
                        : (isZh ? '升入新学年' : 'Promote to next year')}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={onOpenYearManagement}>
                  {isZh ? '学年管理' : 'Year management'}
                </Button>
              </>
            )}
          </div>
          {currentYearId && (
            <p className="text-xs text-slate-500">
              {isZh
                ? `本学年共有 ${currentYearClassCount ?? 0} 个班级，${currentYearStudentCount ?? 0} 名学生（按学籍统计）。`
                : `This year has ${currentYearClassCount ?? 0} classes and ${currentYearStudentCount ?? 0} students (by enrollments).`}
            </p>
          )}
          {yearLoading && <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>}

          {currentYearId && (
            <div className="mt-2 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">
                {isZh ? '默认学年班级列表' : 'Classes in default year'}
              </h3>
              {currentYearClasses.length === 0 ? (
                <p className="text-sm text-slate-500">{isZh ? '本学年暂无班级。' : 'No classes in this academic year.'}</p>
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
                          <td className="py-2 px-3 text-slate-800">
                            {cls.name}
                            {cls.archiveLabel ? (
                              <span className="ml-2 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                {cls.archiveLabel}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 px-3 text-slate-700">{studentCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === 'structure' && (
        <div className="border-t border-slate-100 pt-4">
          <GradeStructureEditor
            language={isZh ? 'zh' : 'en'}
            canEdit={canEditStructure}
            onSaved={onStructureSaved}
          />
        </div>
      )}

      {subTab === 'classes' && (
        <div className="border-t border-slate-100 pt-4 -mx-4 sm:-mx-6 px-0 sm:px-0">
          <ClassManagement onBackToHub={() => {}} embedded hideYearGear={false} />
        </div>
      )}

      {subTab === 'organization' && (
        <div className="border-t border-slate-100 pt-4">
          <OrgStructurePanel
            isZh={isZh}
            canMutate={canMutateOrg}
            onError={onOrgError}
            onDepartmentsChange={onDepartmentsChange}
          />
        </div>
      )}

      <Dialog
        open={defaultYearSwitchOpen}
        onOpenChange={(open) => {
          if (!open) cancelDefaultYearSwitch();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '切换系统默认学年' : 'Switch system default year'}</DialogTitle>
            <DialogDescription>
              {isZh
                ? `确认将全校默认学年从「${currentYear?.name ?? '—'}」改为「${pendingYear?.name ?? '—'}」？Hub、教职工端与班级管理将立即跟随新默认学年。`
                : `Switch the school default from "${currentYear?.name ?? '—'}" to "${pendingYear?.name ?? '—'}"? Hub and teacher workflows will follow immediately.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDefaultYearSwitch} disabled={defaultYearSwitchLoading}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button onClick={() => void confirmDefaultYearSwitch()} disabled={defaultYearSwitchLoading || !pendingDefaultYearId}>
              {defaultYearSwitchLoading ? (isZh ? '切换中…' : 'Switching…') : (isZh ? '确认切换' : 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
