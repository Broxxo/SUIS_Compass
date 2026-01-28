import { useState, useRef, useEffect } from 'react';

interface GradeRangeSelectorProps {
  value: string; // "3" 或 "3-5"
  onChange: (value: string) => void;
}

export default function GradeRangeSelector({ value, onChange }: GradeRangeSelectorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const TOTAL_GRADES = 9; // G1-G9

  // 解析当前值，获取选中的年级
  const parseValue = (val: string): number[] => {
    if (!val) return [];
    if (val.includes('-')) {
      const [start, end] = val.split('-').map(Number);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [Number(val)];
  };

  const selectedGrades = parseValue(value);

  // 处理点击单个格子
  const handleGradeClick = (grade: number) => {
    if (!hasMoved) {
      onChange(grade.toString());
    }
  };

  // 处理鼠标按下
  const handleMouseDown = (grade: number) => {
    setIsDragging(true);
    setDragStart(grade);
    setDragEnd(grade);
    setHasMoved(false);
  };

  // 处理鼠标移动
  const handleMouseMove = (grade: number) => {
    if (isDragging && dragStart !== null) {
      if (grade !== dragStart) {
        setHasMoved(true);
      }
      setDragEnd(grade);
    }
  };

  // 处理鼠标释放
  const handleMouseUp = () => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      
      if (start === end) {
        onChange(start.toString());
      } else {
        onChange(`${start}-${end}`);
      }
    }
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
    setHasMoved(false);
  };

  // 处理鼠标离开容器
  const handleMouseLeave = () => {
    if (isDragging) {
      handleMouseUp();
    }
  };

  // 判断某个年级是否被选中（包括拖拽中的临时选择）
  const isGradeSelected = (grade: number): boolean => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      return grade >= start && grade <= end;
    }
    return selectedGrades.includes(grade);
  };

  // 判断某个年级是否在拖拽范围内
  const isGradeInDragRange = (grade: number): boolean => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      return grade >= start && grade <= end;
    }
    return false;
  };

  // 全局鼠标事件处理
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        if (dragStart !== null && dragEnd !== null) {
          const start = Math.min(dragStart, dragEnd);
          const end = Math.max(dragStart, dragEnd);
          
          if (start === end) {
            onChange(start.toString());
          } else {
            onChange(`${start}-${end}`);
          }
        }
        setIsDragging(false);
        setDragStart(null);
        setDragEnd(null);
        setHasMoved(false);
      }
    };

    if (isDragging) {
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragStart, dragEnd, onChange]);

  // 计算最小宽度：9个格子 * 40px + 左右padding 24px
  const minWidth = TOTAL_GRADES * 40 + 24;

  return (
    <div className="space-y-2 w-full">
      <div className="w-full overflow-x-auto">
        <div
          ref={containerRef}
          className="flex gap-1 p-3 select-none"
          onMouseLeave={handleMouseLeave}
          style={{ minWidth: `${minWidth}px`, width: 'max-content' }}
        >
        {Array.from({ length: TOTAL_GRADES }, (_, i) => {
          const grade = i + 1;
          const selected = isGradeSelected(grade);
          const inDragRange = isGradeInDragRange(grade);
          
          return (
            <div
              key={grade}
              className={`
                min-w-[40px] h-[41px] rounded-md border-2 cursor-pointer
                transition-all duration-100 flex items-center justify-center
                text-xs font-semibold relative
                ${
                  selected || inDragRange
                    ? 'bg-blue-500 border-blue-500 text-white shadow-md scale-105 z-10'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-blue-400 hover:bg-blue-50'
                }
                ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}
              `}
              onClick={(e) => {
                e.preventDefault();
                if (!hasMoved && !isDragging) {
                  handleGradeClick(grade);
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                handleMouseDown(grade);
              }}
              onMouseEnter={() => {
                if (isDragging) {
                  handleMouseMove(grade);
                }
              }}
              title={`G${grade}`}
            >
              G{grade}
            </div>
          );
        })}
        </div>
      </div>
      {/* 显示当前选中的年级跨度 */}
      <div className="text-sm text-gray-600 text-center">
        {value ? `已选择: G${value}` : '请选择年级跨度'}
      </div>
    </div>
  );
}
