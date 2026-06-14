import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** 协和蓝选中态：与课程管理默认 Button（primary）一致 */
const segmentTabActive = 'bg-primary text-primary-foreground shadow-sm';
const segmentTabInactive = 'text-slate-600 hover:bg-slate-100';
const segmentTabGroupedInactive = 'text-slate-600 hover:bg-white/80 hover:text-slate-900';

type SegmentTabButtonProps = {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  /** 组块内标签：无独立底色，由 SegmentTabGroup 外壳承托 */
  grouped?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children' | 'className'>;

export function SegmentTabButton({
  active,
  onClick,
  children,
  className,
  grouped = false,
  ...props
}: SegmentTabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0',
        active ? segmentTabActive : grouped ? segmentTabGroupedInactive : segmentTabInactive,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** 课程河流等：多个相关标签共用一个浅灰组块外壳 */
export function SegmentTabGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-stretch gap-0.5 rounded-lg bg-slate-100/95 p-0.5 ring-1 ring-slate-200/90',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SegmentTabStrip({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <nav className={cn('flex flex-wrap items-center gap-2', className)} aria-label={ariaLabel}>
      {children}
    </nav>
  );
}
