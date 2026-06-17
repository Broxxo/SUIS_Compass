import type { ReactNode } from 'react';
import { Button } from '../ui/button';

/** 学生画像透镜：概览 + 学业报告 */
export type PortraitLensTab = 'overview' | 'academic';

const PORTRAIT_LENS_TABS: { id: PortraitLensTab; labelZh: string; labelEn: string }[] = [
  { id: 'overview', labelZh: '概览', labelEn: 'Overview' },
  { id: 'academic', labelZh: '学业报告', labelEn: 'Academic report' },
];

export function PortraitLensWorkspace({
  isZh,
  activeTab,
  onTabChange,
  renderOverview,
  renderAcademic,
  tabs,
}: {
  isZh: boolean;
  activeTab: PortraitLensTab;
  onTabChange: (tab: PortraitLensTab) => void;
  renderOverview: () => ReactNode;
  renderAcademic: () => ReactNode;
  tabs?: PortraitLensTab[];
}) {
  const visibleTabs =
    tabs && tabs.length > 0 ? PORTRAIT_LENS_TABS.filter((t) => tabs.includes(t.id)) : PORTRAIT_LENS_TABS;
  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex flex-wrap gap-1">
        {visibleTabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onTabChange(tab.id)}
          >
            {isZh ? tab.labelZh : tab.labelEn}
          </Button>
        ))}
      </div>
      {activeTab === 'overview' ? renderOverview() : renderAcademic()}
    </>
  );
}
