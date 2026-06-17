import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../lib/utils';
import type { AcademicYear, Term } from '../types/classManagement';

export const FILTER_SELECT_WIDTH = {
  year: 'min-w-[11rem] max-w-[14rem] w-auto',
  term: 'min-w-[7.5rem] max-w-[9.5rem] w-auto',
  teacher: 'min-w-[12rem] max-w-[18rem] w-auto',
  report: 'min-w-[14rem] max-w-[22rem] w-auto',
  md: 'min-w-[10rem] max-w-[16rem] w-auto',
  sm: 'min-w-[6.5rem] max-w-[11rem] w-auto',
} as const;

export type FilterSelectWidth = keyof typeof FILTER_SELECT_WIDTH;
export type FilterControlSize = 'md' | 'sm';

const FILTER_CONTROL_SIZE_CLASS: Record<FilterControlSize, string> = {
  md: 'px-3 py-2 text-sm',
  sm: 'px-2 py-1.5 text-xs',
};

const filterSelectBase =
  'rounded-lg border border-slate-300 bg-white ' +
  'disabled:bg-slate-50 disabled:text-slate-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/80';

export function filterSelectClassName(
  width: FilterSelectWidth = 'md',
  className?: string,
  size: FilterControlSize = 'md',
) {
  return cn(filterSelectBase, FILTER_CONTROL_SIZE_CLASS[size], FILTER_SELECT_WIDTH[width], className);
}

export function FilterSelect({
  width = 'md',
  controlSize = 'md',
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { width?: FilterSelectWidth; controlSize?: FilterControlSize }) {
  return <select className={filterSelectClassName(width, className, controlSize)} {...props} />;
}

export function FilterFieldLabel({
  children,
  htmlFor,
  size = 'md',
}: {
  children: ReactNode;
  htmlFor?: string;
  size?: FilterControlSize;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-slate-500 mb-0.5', size === 'sm' ? 'text-[11px]' : 'text-xs')}
    >
      {children}
    </label>
  );
}

export function FilterField({
  label,
  htmlFor,
  children,
  className,
  size = 'md',
}: {
  label?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  size?: FilterControlSize;
}) {
  return (
    <div className={cn('shrink-0', className)}>
      {label != null ? (
        <FilterFieldLabel htmlFor={htmlFor} size={size}>
          {label}
        </FilterFieldLabel>
      ) : null}
      {children}
    </div>
  );
}

/** 筛选器工具条：学年/学期等并排，宽度随内容而非撑满整行 */
export function FilterToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-3', className)}>{children}</div>;
}

export function termOptionLabel(term: Term, isZh: boolean): string {
  if (term === 'Semester 1') return isZh ? '上学期' : 'Semester 1';
  return isZh ? '下学期' : 'Semester 2';
}

export function TermSelect({
  isZh,
  value,
  onChange,
  id,
  disabled,
  className,
}: {
  isZh: boolean;
  value: Term;
  onChange: (term: Term) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <FilterSelect
      id={id}
      width="term"
      value={value}
      disabled={disabled}
      className={className}
      onChange={(e) => onChange(e.target.value as Term)}
    >
      <option value="Semester 1">{termOptionLabel('Semester 1', isZh)}</option>
      <option value="Semester 2">{termOptionLabel('Semester 2', isZh)}</option>
    </FilterSelect>
  );
}

export function AcademicYearSelect({
  years,
  value,
  onChange,
  isZh,
  allowEmpty = false,
  emptyLabel,
  id,
  disabled,
  className,
}: {
  years: AcademicYear[];
  value: string;
  onChange: (yearId: string) => void;
  isZh: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <FilterSelect
      id={id}
      width="year"
      value={value}
      disabled={disabled}
      className={className}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty ? (
        <option value="">{emptyLabel ?? (isZh ? '请选择' : 'Select')}</option>
      ) : null}
      {years.map((y) => (
        <option key={y.id} value={y.id}>
          {y.name}
        </option>
      ))}
    </FilterSelect>
  );
}

export function AcademicYearSelectField({
  isZh,
  years,
  value,
  onChange,
  allowEmpty,
  emptyLabel,
  id,
  disabled,
}: {
  isZh: boolean;
  years: AcademicYear[];
  value: string;
  onChange: (yearId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <FilterField label={isZh ? '学年' : 'Academic year'} htmlFor={id}>
      <AcademicYearSelect
        id={id}
        isZh={isZh}
        years={years}
        value={value}
        onChange={onChange}
        allowEmpty={allowEmpty}
        emptyLabel={emptyLabel}
        disabled={disabled}
      />
    </FilterField>
  );
}

export function TermSelectField({
  isZh,
  value,
  onChange,
  id,
  disabled,
}: {
  isZh: boolean;
  value: Term;
  onChange: (term: Term) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <FilterField label={isZh ? '学期' : 'Term'} htmlFor={id}>
      <TermSelect id={id} isZh={isZh} value={value} onChange={onChange} disabled={disabled} />
    </FilterField>
  );
}

export function AcademicYearTermFields({
  isZh,
  years,
  yearId,
  term,
  onYearIdChange,
  onTermChange,
  allowEmptyYear = false,
  emptyYearLabel,
  yearDisabled,
  termDisabled,
}: {
  isZh: boolean;
  years: AcademicYear[];
  yearId: string;
  term: Term;
  onYearIdChange: (id: string) => void;
  onTermChange: (term: Term) => void;
  allowEmptyYear?: boolean;
  emptyYearLabel?: string;
  yearDisabled?: boolean;
  termDisabled?: boolean;
}) {
  return (
    <FilterToolbar>
      <AcademicYearSelectField
        isZh={isZh}
        years={years}
        value={yearId}
        onChange={onYearIdChange}
        allowEmpty={allowEmptyYear}
        emptyLabel={emptyYearLabel}
        disabled={yearDisabled}
      />
      <TermSelectField
        isZh={isZh}
        value={term}
        onChange={onTermChange}
        disabled={termDisabled}
      />
    </FilterToolbar>
  );
}
