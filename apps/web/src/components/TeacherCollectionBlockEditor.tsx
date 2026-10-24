import { useEffect, useRef, useState } from 'react';
import type { TeacherCollectionBlock } from '@repo/shared';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type { ReportTeachingDiagnosis } from '../types/classManagement';
import TeachingDiagnosisKissForm from './TeachingDiagnosisKissForm';

const EMPTY_KISS: ReportTeachingDiagnosis = { keep: '', improve: '', stop: '', start: '' };

export function newCollectionBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyTextBlock(): TeacherCollectionBlock {
  return { id: newCollectionBlockId(), kind: 'text', label: '' };
}

export function normalizeCollectionBlocks(blocks: TeacherCollectionBlock[]): TeacherCollectionBlock[] {
  return blocks.map((block) =>
    block.kind === 'text' ? { ...block, label: block.label.trim() } : block,
  );
}

export function validateCollectionBlocks(blocks: TeacherCollectionBlock[], isZh: boolean): string | null {
  if (blocks.length === 0) return isZh ? '请至少添加一道题' : 'Add at least one question';
  if (blocks.filter((block) => block.kind === 'kiss').length > 1) {
    return isZh ? 'KISS 反思只能添加一次' : 'KISS can be added once';
  }
  if (blocks.some((block) => block.kind === 'text' && !block.label.trim())) {
    return isZh ? '请为每个自定义文本填写名称' : 'Name each text field';
  }
  return null;
}

export function collectionBlockSummary(
  blocks: TeacherCollectionBlock[] | null | undefined,
  fallback: string,
  isZh: boolean,
): string {
  if (!blocks || blocks.length === 0) return fallback;
  return blocks
    .map((block) => (block.kind === 'kiss' ? 'KISS' : block.label))
    .join(isZh ? '、' : ', ');
}

function SortableQuestion({
  block,
  isZh,
  onLabel,
  onRemove,
}: {
  block: TeacherCollectionBlock;
  isZh: boolean;
  onLabel: (label: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-slate-200 bg-white px-2 py-3 ${isDragging ? 'relative z-20 shadow-md' : ''}`}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="mt-1 inline-flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-slate-400 hover:text-slate-600 active:cursor-grabbing"
          aria-label={isZh ? '拖动调整顺序' : 'Drag to reorder'}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          {block.kind === 'kiss' ? (
            <div className="pt-1 text-sm font-medium text-slate-800">KISS</div>
          ) : (
            <input
              value={block.label}
              maxLength={80}
              onChange={(event) => onLabel(event.target.value)}
              placeholder={isZh ? '题目名称，例如发展规划、读书笔记' : 'Question name'}
              className="w-full rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
            />
          )}
          {block.kind === 'kiss' ? (
            <TeachingDiagnosisKissForm value={EMPTY_KISS} onChange={() => {}} disabled isZh={isZh} />
          ) : (
            <textarea
              disabled
              rows={4}
              placeholder={isZh ? '教师在这里填写' : 'Teachers write here'}
              className="min-h-[5.5rem] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          )}
        </div>
        <button
          type="button"
          className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
          aria-label={isZh ? '移除' : 'Remove'}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function TeacherCollectionBlockEditor({
  blocks,
  onChange,
  isZh,
}: {
  blocks: TeacherCollectionBlock[];
  onChange: (next: TeacherCollectionBlock[]) => void;
  isZh: boolean;
}) {
  const hasKiss = blocks.some((block) => block.kind === 'kiss');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  const addBlock = (block: TeacherCollectionBlock) => {
    onChange([...blocks, block]);
    setPickerOpen(false);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = blocks.findIndex((block) => block.id === active.id);
    const to = blocks.findIndex((block) => block.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(blocks, from, to));
  };

  return (
    <div className="space-y-3">
      {blocks.length === 0 ? null : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => setActiveId(String(event.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
            <div className={`space-y-3 ${activeId ? 'select-none' : ''}`}>
              {blocks.map((block) => (
                <SortableQuestion
                  key={block.id}
                  block={block}
                  isZh={isZh}
                  onLabel={(label) =>
                    onChange(
                      blocks.map((item) => (item.id === block.id && item.kind === 'text' ? { ...item, label } : item)),
                    )
                  }
                  onRemove={() => onChange(blocks.filter((item) => item.id !== block.id))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <div ref={pickerRef} className="relative">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          disabled={blocks.length >= 12}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <Plus className="h-4 w-4" />
          {isZh ? '添加项目' : 'Add item'}
        </button>
        {pickerOpen ? (
          <div className="absolute left-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <button
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              disabled={hasKiss}
              onClick={() => addBlock({ id: newCollectionBlockId(), kind: 'kiss' })}
            >
              <span className="block text-sm text-slate-800">{isZh ? '阶段教学诊断（KISS）' : 'Teaching diagnosis (KISS)'}</span>
              <span className="block text-xs text-slate-500">
                {hasKiss
                  ? isZh
                    ? '已添加'
                    : 'Already added'
                  : 'Keep / Improve / Stop / Start'}
              </span>
            </button>
            <button
              type="button"
              className="block w-full border-t border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => addBlock(emptyTextBlock())}
            >
              <span className="block text-sm text-slate-800">{isZh ? '自定义文本' : 'Custom text'}</span>
              <span className="block text-xs text-slate-500">
                {isZh ? '自定名称，收集一段文字' : 'A named text response'}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
