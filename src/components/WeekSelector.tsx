import { useState, useRef, useEffect } from 'react';

interface WeekSelectorProps {
  value: string; // "3" 或 "3-5"
  onChange: (value: string) => void;
}

export default function WeekSelector({ value, onChange }: WeekSelectorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const TOTAL_WEEKS = 20;

  // 解析当前值，获取选中的周次
  const parseValue = (val: string): number[] => {
    if (!val) return [];
    if (val.includes('-')) {
      const [start, end] = val.split('-').map(Number);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [Number(val)];
  };

  const selectedWeeks = parseValue(value);

  // 处理点击单个格子
  const handleWeekClick = (week: number) => {
    if (!hasMoved) {
      onChange(week.toString());
    }
  };

  // 处理鼠标按下
  const handleMouseDown = (week: number) => {
    setIsDragging(true);
    setDragStart(week);
    setDragEnd(week);
    setHasMoved(false);
  };

  // 处理鼠标移动
  const handleMouseMove = (week: number) => {
    if (isDragging && dragStart !== null) {
      if (week !== dragStart) {
        setHasMoved(true);
      }
      setDragEnd(week);
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

  // 判断某个周次是否被选中（包括拖拽中的临时选择）
  const isWeekSelected = (week: number): boolean => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      return week >= start && week <= end;
    }
    return selectedWeeks.includes(week);
  };

  // 判断某个周次是否在拖拽范围内
  const isWeekInDragRange = (week: number): boolean => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      return week >= start && week <= end;
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

  // 计算最小宽度：20个格子 * 31.2px + 左右padding 24px（无间隙，宽度再增加5%）
  const minWidth = TOTAL_WEEKS * 31.2 + 24;

  return (
    <div className="space-y-2 w-full">
      <div className="w-full overflow-x-auto">
        <div
          ref={containerRef}
          className="flex gap-0 p-3 select-none"
          onMouseLeave={handleMouseLeave}
          style={{ minWidth: `${minWidth}px`, width: 'max-content' }}
        >
        {Array.from({ length: TOTAL_WEEKS }, (_, i) => {
          const week = i + 1;
          const selected = isWeekSelected(week);
          const inDragRange = isWeekInDragRange(week);
          // Removed unused isFirstInRange and isLastInRange variables
          
          return (
            <div
              key={week}
              className={`
                flex-1 min-w-[31.2px] h-[41px] rounded-md border-2 cursor-pointer
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
                  handleWeekClick(week);
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                handleMouseDown(week);
              }}
              onMouseEnter={() => {
                if (isDragging) {
                  handleMouseMove(week);
                }
              }}
              title={`第${week}周`}
            >
              {week}
            </div>
          );
        })}
        </div>
      </div>
      {/* 显示当前选中的周次 */}
      <div className="text-sm text-gray-600 text-center">
        {value ? `已选择: ${value}` : '请选择周次'}
      </div>
    </div>
  );
}
