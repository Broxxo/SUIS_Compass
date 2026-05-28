import type { ReactNode } from 'react';
import { Button } from '../ui/button';

/** 学生画像长期发展维度；当前优先开放学业报告，其余模块可逐步扩展。 */
export type PortraitLensTab = 'academic' | 'interests' | 'generalLearning' | 'socialEmotional';

const PORTRAIT_LENS_TABS: { id: PortraitLensTab; labelZh: string; labelEn: string }[] = [
  { id: 'academic', labelZh: '学业报告', labelEn: 'Academic report' },
  { id: 'interests', labelZh: '兴趣特长', labelEn: 'Interests & strengths' },
  { id: 'generalLearning', labelZh: '通用学习能力', labelEn: 'General learning skills' },
  { id: 'socialEmotional', labelZh: '社会情感能力', labelEn: 'Social-emotional learning' },
];

const LENS_PLACEHOLDER_COPY: Record<Exclude<PortraitLensTab, 'academic'>, { zh: string; en: string }> = {
  interests: {
    zh: '「兴趣特长」框架开发中，将用于记录与展示学生的长期兴趣与特长发展。',
    en: 'Interests & strengths: coming soon — a space for long-term interest and talent development.',
  },
  generalLearning: {
    zh: '「通用学习能力」框架开发中，将用于学习策略、习惯等维度的长期追踪。',
    en: 'General learning skills: coming soon — strategies, habits, and longitudinal tracking.',
  },
  socialEmotional: {
    zh: '「社会情感能力」框架开发中，将用于协作、自我管理等方面的长期观察。',
    en: 'Social-emotional learning: coming soon — collaboration, self-management, and related dimensions.',
  },
};

function LensPlaceholderPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
      {message}
    </div>
  );
}

export function PortraitLensWorkspace({
  isZh,
  activeTab,
  onTabChange,
  renderAcademic,
  tabs,
}: {
  isZh: boolean;
  activeTab: PortraitLensTab;
  onTabChange: (tab: PortraitLensTab) => void;
  renderAcademic: () => ReactNode;
  tabs?: PortraitLensTab[];
}) {
  const visibleTabs = tabs && tabs.length > 0 ? PORTRAIT_LENS_TABS.filter((t) => tabs.includes(t.id)) : PORTRAIT_LENS_TABS;
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
      {activeTab === 'academic'
        ? renderAcademic()
        : <LensPlaceholderPanel message={isZh ? LENS_PLACEHOLDER_COPY[activeTab].zh : LENS_PLACEHOLDER_COPY[activeTab].en} />}
    </>
  );
}
