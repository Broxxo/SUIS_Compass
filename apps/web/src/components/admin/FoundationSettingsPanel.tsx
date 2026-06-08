import type { ReactNode } from 'react';
import OrgStructurePanel from './OrgStructurePanel';
import GradeStructureEditor from '../GradeStructureEditor';
import ClassManagement from '../ClassManagement';
import { Button } from '../ui/button';
import { Plus } from 'lucide-react';
import type { AcademicYear } from '../../types/classManagement';

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
  currentYearClassCount: number | null;
  currentYearStudentCount: number | null;
  currentYearClasses: Array<{ cls: { id: string; grade: number; name: string }; studentCount: number }>;
  getGradeLabel: (grade: number) => string;
  onOrgError: (msg: string) => void;
  onDepartmentsChange: () => void;
  onStructureSaved?: () => void;
};

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

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
  currentYearClassCount,
  currentYearStudentCount,
  currentYearClasses,
  getGradeLabel,
  onOrgError,
  onDepartmentsChange,
  onStructureSaved,
}: FoundationSettingsPanelProps) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <SubTabButton active={subTab === 'years'} onClick={() => onSubTabChange('years')}>
          {isZh ? '学年管理' : 'Academic years'}
        </SubTabButton>
        <SubTabButton active={subTab === 'structure'} onClick={() => onSubTabChange('structure')}>
          {isZh ? '学段与年级' : 'Stages & grades'}
        </SubTabButton>
        <SubTabButton active={subTab === 'classes'} onClick={() => onSubTabChange('classes')}>
          {isZh ? '班级管理' : 'Classes'}
        </SubTabButton>
        <SubTabButton active={subTab === 'organization'} onClick={() => onSubTabChange('organization')}>
          {isZh ? '组织架构' : 'Organization'}
        </SubTabButton>
      </div>

      {subTab === 'years' && (
        <div className="space-y-4 border-t border-slate-100 pt-4">
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
                void setCurrentAcademicYearIdAndSync(id);
              }}
              disabled={!canEditYears}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="">—</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
            {canEditYears && (
              <>
                <Button size="sm" variant="outline" onClick={onOpenCreateYear}>
                  <Plus className="h-4 w-4 mr-1" />
                  {isZh ? '新建学年' : 'New year'}
                </Button>
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
                {isZh ? '当前学年班级列表' : 'Classes in current year'}
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
    </section>
  );
}
