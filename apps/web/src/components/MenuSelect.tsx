import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

type Opt = { value: string; label: string; disabled?: boolean };

function optionText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionText).join('');
  if (isValidElement(node)) return optionText((node.props as { children?: ReactNode }).children);
  return '';
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
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = collectOptions(children);
  const current = value != null ? String(value) : defaultValue != null ? String(defaultValue) : '';
  const selected = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const uid = useId();

  const place = () => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const room = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, Math.min(320, room));
    const top = openUp ? Math.max(8, rect.top - 4 - maxHeight) : rect.bottom + 4;
    setPos({ top, left, width, maxHeight });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, options.length]);

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

  const label = selected?.label ?? '';

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
              {options.map((option, index) => {
                const isSelected = option.value === (selected?.value ?? '');
                return (
                  <button
                    key={`${index}-${option.value}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40',
                      isSelected && 'bg-slate-50 font-medium',
                    )}
                    onClick={() => {
                      onChange?.({
                        target: { value: option.value },
                        currentTarget: { value: option.value },
                      } as ChangeEvent<HTMLSelectElement>);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 whitespace-normal break-words">{option.label}</span>
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
