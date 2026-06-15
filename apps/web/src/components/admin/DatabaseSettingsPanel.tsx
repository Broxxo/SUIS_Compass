import type { ReactNode } from 'react';
import { SegmentTabButton } from '../ui/segment-tab-button';

export type DatabaseSubTab = 'dingtalk' | 'program';

type DatabaseSettingsPanelProps = {
  isZh: boolean;
  subTab: DatabaseSubTab;
  onSubTabChange: (tab: DatabaseSubTab) => void;
  toolbar: ReactNode;
  children: ReactNode;
};

export default function DatabaseSettingsPanel({
  isZh,
  subTab,
  onSubTabChange,
  toolbar,
  children,
}: DatabaseSettingsPanelProps) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-2">
          <SegmentTabButton active={subTab === 'dingtalk'} onClick={() => onSubTabChange('dingtalk')}>
            {isZh ? '钉钉 API' : 'DingTalk API'}
          </SegmentTabButton>
          <SegmentTabButton active={subTab === 'program'} onClick={() => onSubTabChange('program')}>
            {isZh ? '程序数据库' : 'App database'}
          </SegmentTabButton>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">{toolbar}</div>
      </div>
      {children}
    </section>
  );
}
