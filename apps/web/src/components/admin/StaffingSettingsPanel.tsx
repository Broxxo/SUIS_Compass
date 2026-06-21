import type { ReactNode } from 'react';
import { SegmentTabButton, SegmentTabGroup, SegmentTabStrip } from '../ui/segment-tab-button';

export type StaffingSubTab = 'grade-mgmt' | 'teaching-mgmt' | 'course' | 'self-study' | 'elective' | 'weekly-load';

export type StaffingTabGroup = 'key-roles' | 'course-jobs' | 'weekly-load';

export function staffingSubTabGroup(tab: StaffingSubTab): StaffingTabGroup {
  if (tab === 'grade-mgmt' || tab === 'teaching-mgmt') return 'key-roles';
  if (tab === 'weekly-load') return 'weekly-load';
  return 'course-jobs';
}

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
        <SegmentTabStrip aria-label={isZh ? '岗位安排' : 'Staffing'}>
          <SegmentTabGroup>
            <SegmentTabButton grouped active={subTab === 'grade-mgmt'} onClick={() => onSubTabChange('grade-mgmt')}>
              {isZh ? '年级管理' : 'Grade management'}
            </SegmentTabButton>
            <SegmentTabButton grouped active={subTab === 'teaching-mgmt'} onClick={() => onSubTabChange('teaching-mgmt')}>
              {isZh ? '教学管理' : 'Teaching management'}
            </SegmentTabButton>
          </SegmentTabGroup>
          <SegmentTabGroup>
            <SegmentTabButton grouped active={subTab === 'course'} onClick={() => onSubTabChange('course')}>
              {isZh ? '课程岗位' : 'Course staffing'}
            </SegmentTabButton>
            <SegmentTabButton grouped active={subTab === 'self-study'} onClick={() => onSubTabChange('self-study')}>
              {isZh ? '自习' : 'Self-study'}
            </SegmentTabButton>
            <SegmentTabButton grouped active={subTab === 'elective'} onClick={() => onSubTabChange('elective')}>
              {isZh ? '选修' : 'Elective'}
            </SegmentTabButton>
          </SegmentTabGroup>
          <SegmentTabGroup>
            <SegmentTabButton grouped active={subTab === 'weekly-load'} onClick={() => onSubTabChange('weekly-load')}>
              {isZh ? '周课时统计' : 'Weekly load'}
            </SegmentTabButton>
          </SegmentTabGroup>
        </SegmentTabStrip>
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
