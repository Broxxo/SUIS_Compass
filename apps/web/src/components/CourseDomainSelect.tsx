import type { CourseDomainsConfig } from '@repo/shared';
import { getCourseDomainLabel } from '@repo/shared';
import { useLanguage } from '../contexts/LanguageContext';

interface CourseDomainSelectProps {
  domainsConfig: CourseDomainsConfig;
  value: string | null;
  onChange: (domainId: string | null) => void;
  className?: string;
}

export default function CourseDomainSelect({
  domainsConfig,
  value,
  onChange,
  className,
}: CourseDomainSelectProps) {
  const { language } = useLanguage();
  const isZh = language === 'zh';

  return (
    <select
      className={className ?? 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{isZh ? '无（按学科分类单独成列）' : 'None (column by subject category)'}</option>
      {domainsConfig.domainOrder.map((id) => {
        const d = domainsConfig.domains.find((x) => x.id === id);
        if (!d) return null;
        return (
          <option key={id} value={id}>
            {getCourseDomainLabel(d.label, language) || (isZh ? '未命名领域' : 'Untitled domain')}
          </option>
        );
      })}
    </select>
  );
}
