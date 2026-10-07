import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { cn } from '../lib/utils';

type Opt = { value: string; label: string; disabled?: boolean };

function optionText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionText).join('');
  if (isValidElement(node)) return optionText((node.props as { children?: ReactNode }).children);
  return '';
}

const SEARCH_MIN_OPTIONS = 8;

function optionMatches(label: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return label.toLowerCase().includes(needle);
}

function highlightMatch(label: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return label;
  const index = label.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return label;
  return (
    <>
      {label.slice(0, index)}
      <mark className="bg-amber-100 text-inherit">{label.slice(index, index + needle.length)}</mark>
      {label.slice(index + needle.length)}
    </>
  );
}

function collectOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode };
    if (child.type === 'option') {
      const value = props.value != null ? String(props.value) : optionText(props.children);
      out.push({ value, label: optionText(props.children).trim() || value, disabled: Boolean(props.disabled) });
    } else if (child.type === 'optgroup') {
      out.push(...collectOptions(props.children));
    }
  });
  return out;
}

/** 替代原生 select：菜单固定在按钮下方展开，避免手机系统弹层盖住或看不清。 */
export function MenuSelect({
  value,
  defaultValue,
  onChange,
  disabled,
  children,
  className,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  searchable: forceSearch = false,
}: SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean }) {
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const options = collectOptions(children);
  const searchable = forceSearch || options.length >= SEARCH_MIN_OPTIONS;
  const current = value != null ? String(value) : defaultValue != null ? String(defaultValue) : '';
  const selected = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shown = searchable ? options.filter((option) => optionMatches(option.label, query)) : options;
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const uid = useId();

  const place = () => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, searchable ? 220 : 180);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const room = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, Math.min(320, room));
    const top = openUp ? Math.max(8, rect.top - 4 - maxHeight) : rect.bottom + 4;
    setPos({ top, left, width, maxHeight });
  };

  useEffect(() => {
    if (open) return;
    setQuery('');
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open || !searchable || !pos) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable, pos]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, options.length, searchable]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const allowMenuScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) event.stopPropagation();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('wheel', allowMenuScroll, true);
    window.addEventListener('touchmove', allowMenuScroll, true);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('wheel', allowMenuScroll, true);
      window.removeEventListener('touchmove', allowMenuScroll, true);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !searchable) return;
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, searchable, activeIndex, query]);

  const label = selected?.label ?? '';

  const choose = (next: string) => {
    onChange?.({
      target: { value: next },
      currentTarget: { value: next },
    } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (shown.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(shown.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = shown[activeIndex];
      if (option && !option.disabled) choose(option.value);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        data-menu-select=""
        data-menu-select-label={label}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        onClick={() => setOpen((next) => !next)}
        className={cn(className, 'inline-flex items-center justify-between gap-2 text-left')}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500', open && 'rotate-180')} aria-hidden />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={uid}
              role="listbox"
              style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
              className="fixed z-[200] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
            >
              {searchable ? (
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-2 pb-2 pt-1">
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveIndex(0);
                    }}
                    onKeyDown={onSearchKeyDown}
                    placeholder={isZh ? '输入筛选' : 'Type to filter'}
                    aria-label={isZh ? '输入筛选' : 'Type to filter'}
                    className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                </div>
              ) : null}
              {shown.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-slate-400">{isZh ? '没有匹配' : 'No matches'}</p>
              ) : null}
              {shown.map((option, index) => {
                const isSelected = option.value === (selected?.value ?? '');
                const isActive = searchable && index === activeIndex;
                return (
                  <button
                    key={`${index}-${option.value}`}
                    type="button"
                    role="option"
                    data-active={isActive ? 'true' : undefined}
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40',
                      isActive && 'bg-slate-100',
                      isSelected && 'font-medium',
                    )}
                    onClick={() => choose(option.value)}
                  >
                    <span className="min-w-0 whitespace-normal break-words">{highlightMatch(option.label, searchable ? query : '')}</span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-blue-600" /> : <span className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
