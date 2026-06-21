import { useRef, useState } from 'react';
import { Input } from './ui/input';
import {
  MAX_WEEKLY_PERIODS_PER_GRADE,
  MIN_WEEKLY_PERIODS_PER_GRADE,
  WEEKLY_PERIODS_STEP,
  mergeGradeRangeIntoSelection,
  setPeriodForGrade,
  toggleGradeSelection,
} from '../lib/courseGradeUtils';
import { useLanguage } from '../contexts/LanguageContext';
import type { GradeConfigItem } from '../types';

interface GradePeriodsFieldsProps {
  applicableGrades: string[];
  weeklyPeriodsByGrade: Record<string, number>;
  gradeItems: GradeConfigItem[];
  onChange: (next: { applicableGrades: string[]; weeklyPeriodsByGrade: Record<string, number> }) => void;
  /** 仅选择开设年级，不展示各年级周课时 */
  gradesOnly?: boolean;
}

export default function GradePeriodsFields({
  applicableGrades,
  weeklyPeriodsByGrade,
  gradeItems,
  onChange,
  gradesOnly = false,
}: GradePeriodsFieldsProps) {
  const { language } = useLanguage();
  const latest = useRef({ applicableGrades, weeklyPeriodsByGrade, onChange });
  latest.current = { applicableGrades, weeklyPeriodsByGrade, onChange };

  const dragRef = useRef<{ start: number; end: number; hasMoved: boolean } | null>(null);
  const removeDocUpRef = useRef<(() => void) | null>(null);
  const [dragPreview, setDragPreview] = useState<{ start: number; end: number } | null>(null);

  const finalizeInteraction = () => {
    if (removeDocUpRef.current) {
      removeDocUpRef.current();
      removeDocUpRef.current = null;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setDragPreview(null);
    if (!drag) return;

    const { applicableGrades: ag, weeklyPeriodsByGrade: wp, onChange: oc } = latest.current;
    if (drag.hasMoved) {
      oc(mergeGradeRangeIntoSelection(ag, wp, drag.start, drag.end, gradeItems, 2));
    } else {
      const id = gradeItems.find((item) => item.level === drag.start)?.id;
      if (id) oc(toggleGradeSelection(ag, wp, id, 2));
    }
  };

  const handleMouseDown = (grade: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { start: grade, end: grade, hasMoved: false };
    setDragPreview({ start: grade, end: grade });

    const onDocUp = () => finalizeInteraction();
    document.addEventListener('mouseup', onDocUp);
    removeDocUpRef.current = () => document.removeEventListener('mouseup', onDocUp);
  };

  const handleMouseEnter = (grade: number) => {
    if (!dragRef.current) return;
    dragRef.current.end = grade;
    if (grade !== dragRef.current.start) {
      dragRef.current.hasMoved = true;
    }
    setDragPreview({ start: dragRef.current.start, end: grade });
  };

  const handleRowMouseLeave = () => {
    if (dragRef.current) {
      finalizeInteraction();
    }
  };

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap gap-1.5 p-0.5 -m-0.5 select-none"
        onMouseLeave={handleRowMouseLeave}
      >
        {gradeItems.map((grade) => {
          const selected = applicableGrades.includes(grade.id);
          const preview = dragPreview !== null;
          const inPreview =
            preview &&
            grade.level >= Math.min(dragPreview.start, dragPreview.end) &&
            grade.level <= Math.max(dragPreview.start, dragPreview.end);
          const highlight = selected || (preview && inPreview);

          return (
            <button
              key={grade.id}
              type="button"
              onMouseDown={(e) => handleMouseDown(grade.level, e)}
              onMouseEnter={() => handleMouseEnter(grade.level)}
              className={`min-w-[34px] h-8 rounded-md border-2 text-[11px] font-semibold leading-none transition-all ${
                preview && inPreview && !selected
                  ? 'bg-blue-300 border-blue-400 text-white shadow-sm scale-[1.02] z-10'
                  : highlight
                    ? 'bg-blue-500 border-blue-500 text-white shadow-sm scale-[1.02] z-10'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-blue-400 hover:bg-blue-50'
              } ${preview ? 'cursor-grabbing' : 'cursor-pointer'}`}
              title={grade.label}
            >
              {grade.label}
            </button>
          );
        })}
      </div>
      {gradesOnly ? (
        applicableGrades.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            {language === 'zh' ? '请至少选择一个年级。' : 'Select at least one grade.'}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            {language === 'zh'
              ? '可单击选择/取消，或按住拖拽连续选择多个年级。'
              : 'Click to toggle, or drag across grades to select a range.'}
          </p>
        )
      ) : applicableGrades.length > 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50/90 px-2 py-1.5">
          <p className="text-[11px] font-medium text-slate-600 mb-1">
            {language === 'zh' ? '各年级周课时（节/周）' : 'Weekly periods per grade'}
          </p>
          <div className="grid grid-cols-5 gap-x-2 gap-y-1.5 max-h-[min(42vh,220px)] overflow-y-auto overflow-x-hidden pr-0.5">
            {applicableGrades.map((gradeId) => {
              const grade = gradeItems.find((item) => item.id === gradeId);
              if (!grade) return null;
              const key = grade.id;
              const val = weeklyPeriodsByGrade[key] ?? 2;
              return (
                <div key={grade.id} className="flex items-center gap-0.5 min-w-0 w-full">
                  <span
                    className="min-w-0 flex-1 truncate text-right text-[10px] font-medium tabular-nums text-gray-600"
                    title={grade.label}
                  >
                    {grade.label}
                  </span>
                  <Input
                    type="number"
                    min={MIN_WEEKLY_PERIODS_PER_GRADE}
                    max={MAX_WEEKLY_PERIODS_PER_GRADE}
                    step={WEEKLY_PERIODS_STEP}
                    className="h-6 w-[3rem] shrink-0 px-1 py-0 text-[11px] tabular-nums leading-tight text-center"
                    value={val}
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value);
                      onChange({
                        applicableGrades,
                        weeklyPeriodsByGrade: setPeriodForGrade(
                          weeklyPeriodsByGrade,
                          grade.id,
                          Number.isFinite(raw) ? raw : 2,
                        ),
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          {language === 'zh' ? '请至少选择一个年级。' : 'Select at least one grade.'}
        </p>
      )}
    </div>
  );
}
