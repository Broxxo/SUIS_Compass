import type { ReactNode } from 'react';
import { SegmentTabButton } from '../ui/segment-tab-button';

export type StaffingSubTab = 'grade-mgmt' | 'teaching-mgmt' | 'course' | 'weekly-load';

type StaffingSettingsPanelProps = {
  isZh: boolean;
  subTab: StaffingSubTab;
  onSubTabChange: (tab: StaffingSubTab) => void;
  toolbar: ReactNode;
  loading: boolean;
  yearId: string;
  cloudRequired: boolean;
  children: ReactNode;
};

export default function StaffingSettingsPanel({
  isZh,
  subTab,
  onSubTabChange,
  toolbar,
  loading,
  yearId,
  cloudRequired,
  children,
}: StaffingSettingsPanelProps) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-2">
          <SegmentTabButton active={subTab === 'grade-mgmt'} onClick={() => onSubTabChange('grade-mgmt')}>
            {isZh ? '年级管理' : 'Grade management'}
          </SegmentTabButton>
          <SegmentTabButton active={subTab === 'teaching-mgmt'} onClick={() => onSubTabChange('teaching-mgmt')}>
            {isZh ? '教学管理' : 'Teaching management'}
          </SegmentTabButton>
          <SegmentTabButton active={subTab === 'course'} onClick={() => onSubTabChange('course')}>
            {isZh ? '课程岗位' : 'Course staffing'}
          </SegmentTabButton>
          <SegmentTabButton active={subTab === 'weekly-load'} onClick={() => onSubTabChange('weekly-load')}>
            {isZh ? '周课时统计' : 'Weekly load'}
          </SegmentTabButton>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">{toolbar}</div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
      ) : !yearId ? (
        <p className="text-sm text-slate-500">{isZh ? '请先创建学年。' : 'Create an academic year first.'}</p>
      ) : cloudRequired ? (
        <p className="text-sm text-slate-500">
          {isZh ? '岗位安排需要云端模式（VITE_USE_CLOUD_STORAGE=true）才能保存。' : 'Staffing requires cloud mode to persist.'}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
