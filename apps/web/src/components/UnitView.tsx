import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { Course, GradeConfig, Semester, Unit } from '../types';
import AddUnitDialog from './AddUnitDialog';
import { useLanguage } from '../contexts/LanguageContext';
import { SEMESTERS, SEMESTER_LABELS } from '../lib/constants';
import { loadSemesterDataSync, saveSemesterData, loadSemesterData } from '../lib/storage';
import { getCourseTagChrome } from '../lib/courseUtils';
import { getGradeLabelByLevel } from '../lib/gradeConfig';

interface UnitViewProps {
  courses: Course[];
  selectedSemester: Semester;
  onSemesterChange: (semester: Semester) => void;
  gradeConfig: GradeConfig;
  /** 课程河流只读：禁止拖拽、改周次与编辑单元 */
  readOnly?: boolean;
}

interface CourseUnitsData {
  course: Course;
  units: Unit[];
}

interface DragState {
  unitId: string;
  courseId: string;
  type: 'drag' | 'resize-left' | 'resize-right';
  startX: number;
  initialStart: number;
  initialEnd: number;
}

export default function UnitView({
  courses,
  selectedSemester,
  onSemesterChange,
  gradeConfig,
  readOnly = false,
}: UnitViewProps) {
  const { t } = useLanguage();
  const [courseUnitsData, setCourseUnitsData] = useState<CourseUnitsData[]>([]);
  const [editingUnit, setEditingUnit] = useState<{ unit: Unit; courseId: string } | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  
  // Drag and Resize State
  const [dragState, setDragState] = useState<DragState | null>(null);
  const wasDraggingRef = useRef(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load all units for the selected semester
  const loadUnits = () => {
    const loadedData: CourseUnitsData[] = [];
    
    courses.forEach((course) => {
      const semesterData = loadSemesterDataSync(course.id, selectedSemester.grade, selectedSemester.semester);
      if (semesterData && semesterData.units && semesterData.units.length > 0) {
        // Sort units by order
        const sortedUnits = [...semesterData.units].sort((a, b) => a.order - b.order);
        loadedData.push({ course, units: sortedUnits });
      }
    });
    
    setCourseUnitsData(loadedData);
  };

  useEffect(() => {
    loadUnits();
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [courses, selectedSemester]);

  const handleUpdateUnit = (unitData: Omit<Unit, 'id' | 'order'>) => {
    if (!editingUnit) return;

    const { unit, courseId } = editingUnit;
    const semesterData = loadSemesterDataSync(courseId, selectedSemester.grade, selectedSemester.semester);
    
    if (semesterData) {
      const updatedUnits = semesterData.units.map((u: Unit) => 
        u.id === unit.id ? { ...u, ...unitData } : u
      );
      saveSemesterData({ ...semesterData, units: updatedUnits });
      loadUnits(); // Reload data
    }
    
    setIsEditDialogOpen(false);
    setEditingUnit(null);
  };

  const handleDeleteUnit = async (unitId: string) => {
    if (!editingUnit) return;

    const { courseId } = editingUnit;
    // 使用异步加载，确保获取最新数据
    const semesterData = await loadSemesterData(courseId, selectedSemester.grade, selectedSemester.semester);
    
    if (semesterData) {
      const updatedUnits = semesterData.units.filter((u: Unit) => u.id !== unitId);
      // Reorder units
      const reorderedUnits = updatedUnits.map((u: Unit, index: number) => ({ ...u, order: index }));
      // 使用异步保存，确保同步到云端
      await saveSemesterData({ ...semesterData, units: reorderedUnits });
      loadUnits(); // Reload data
    }
    
    setIsEditDialogOpen(false);
    setEditingUnit(null);
  };


  const parseWeekRange = (weekStr: string): { start: number; end: number } => {
    if (!weekStr) return { start: 1, end: 1 };
    const cleanStr = String(weekStr);
    if (cleanStr.includes('-')) {
      const [start, end] = cleanStr.split('-').map(Number);
      return { start: isNaN(start) ? 1 : start, end: isNaN(end) ? 1 : end };
    }
    const week = Number(cleanStr);
    return { start: isNaN(week) ? 1 : week, end: isNaN(week) ? 1 : week };
  };

  const formatWeekRange = (start: number, end: number): string => {
    const s = Math.round(start);
    const e = Math.round(end);
    return s === e ? `${s}` : `${s}-${e}`;
  };

  const TOTAL_WEEKS = 20;
  const COURSE_LABEL_WIDTH = 105;
  const MIN_WEEK_WIDTH_PX = 28;
  const [gridWidthPx, setGridWidthPx] = useState(0);
  const weekWidthRef = useRef(116);

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.clientWidth;
      setGridWidthPx(w);
      const weekArea = Math.max(0, w - COURSE_LABEL_WIDTH);
      weekWidthRef.current = Math.max(MIN_WEEK_WIDTH_PX, weekArea / TOTAL_WEEKS);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weekWidthPx = useMemo(
    () =>
      gridWidthPx > 0
        ? Math.max(MIN_WEEK_WIDTH_PX, (gridWidthPx - COURSE_LABEL_WIDTH) / TOTAL_WEEKS)
        : 116,
    [gridWidthPx],
  );

  useEffect(() => {
    weekWidthRef.current = weekWidthPx;
  }, [weekWidthPx]);

  // Drag and Resize Handlers
  const handlePointerDown = (e: React.PointerEvent, unit: Unit, courseId: string, type: 'drag' | 'resize-left' | 'resize-right') => {
    if (readOnly) return;
    e.stopPropagation();
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredUnitId(null);
    wasDraggingRef.current = false; // Reset dragging flag on mouse down
    const { start, end } = parseWeekRange(unit.week);
    setDragState({
      unitId: unit.id,
      courseId,
      type,
      startX: e.clientX,
      initialStart: start,
      initialEnd: end,
    });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (readOnly || !dragState) return;

    const deltaX = e.clientX - dragState.startX;
    
    // If we've moved more than 2 pixels, mark it as a drag operation
    if (Math.abs(deltaX) > 2) {
      wasDraggingRef.current = true;
    }

    const deltaWeeks = Math.round(deltaX / weekWidthRef.current);

    if (deltaWeeks === 0 && dragState.type === 'drag') return;

    setCourseUnitsData(prev => prev.map(cData => {
      if (cData.course.id !== dragState.courseId) return cData;
      
      const newUnits = [...cData.units];
      const unitIndex = newUnits.findIndex(u => u.id === dragState.unitId);
      if (unitIndex === -1) return cData;

      // Current unit initial values
      const initialS = dragState.initialStart;
      const initialE = dragState.initialEnd;

      let currentNewStart = initialS;
      let currentNewEnd = initialE;

      if (dragState.type === 'drag') {
        const duration = initialE - initialS;
        currentNewStart = Math.max(1, Math.min(TOTAL_WEEKS - duration, initialS + deltaWeeks));
        currentNewEnd = currentNewStart + duration;
      } else if (dragState.type === 'resize-left') {
        currentNewStart = Math.max(1, Math.min(initialE, initialS + deltaWeeks));
        currentNewEnd = initialE;
      } else if (dragState.type === 'resize-right') {
        currentNewStart = initialS;
        currentNewEnd = Math.max(initialS, Math.min(TOTAL_WEEKS, initialE + deltaWeeks));
      }

      // Apply changes to current unit
      newUnits[unitIndex] = { ...newUnits[unitIndex], week: formatWeekRange(currentNewStart, currentNewEnd) };

      // LINKAGE: Shared boundary logic
      // If we move the START of the current unit, and the previous unit ended where we started, move its END too
      if (currentNewStart !== initialS && unitIndex > 0) {
        const prevUnit = { ...newUnits[unitIndex - 1] };
        const { start: pStart, end: pEnd } = parseWeekRange(cData.units[unitIndex - 1].week);
        if (pEnd === initialS) {
          prevUnit.week = formatWeekRange(pStart, currentNewStart);
          newUnits[unitIndex - 1] = prevUnit;
        }
      }

      // If we move the END of the current unit, and the next unit started where we ended, move its START too
      if (currentNewEnd !== initialE && unitIndex < newUnits.length - 1) {
        const nextUnit = { ...newUnits[unitIndex + 1] };
        const { start: nStart, end: nEnd } = parseWeekRange(cData.units[unitIndex + 1].week);
        if (nStart === initialE) {
          nextUnit.week = formatWeekRange(currentNewEnd, nEnd);
          newUnits[unitIndex + 1] = nextUnit;
        }
      }

      return { ...cData, units: newUnits };
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (readOnly || !dragState) return;

    // Save ALL units for this course to localStorage to capture linked changes
    const courseData = courseUnitsData.find(c => c.course.id === dragState.courseId);
    
    if (courseData) {
      const semesterData = loadSemesterDataSync(dragState.courseId, selectedSemester.grade, selectedSemester.semester);
      
      if (semesterData) {
        // Use updated units from state to replace units in localStorage
        const updatedUnits = semesterData.units.map((u: Unit) => {
          const latestUnit = courseData.units.find(lu => lu.id === u.id);
          return latestUnit ? { ...u, week: latestUnit.week } : u;
        });
        
        saveSemesterData({ ...semesterData, units: updatedUnits });
      }
    }

    setDragState(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      {/* Semester Selector（与概念视图同一套上下边距） */}
      <div className="flex-shrink-0 px-6 py-1.5">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-700">{t('semester.select')}:</label>
          <select
            value={`${selectedSemester.grade}-${selectedSemester.semester}`}
            onChange={(e) => {
              const [grade, semester] = e.target.value.split('-');
              onSemesterChange({ grade: parseInt(grade), semester: semester as 'Semester 1' | 'Semester 2' });
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {gradeConfig.items.map((item) =>
              SEMESTERS.map((semester) => (
                <option key={`${item.level}-${semester}`} value={`${item.level}-${semester}`}>
                  {getGradeLabelByLevel(gradeConfig, item.level)} {SEMESTER_LABELS[semester]} ({item.level} {semester})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Main Content Area（与概念视图：pt/px/pb 一致，主框占满剩余高度） */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3 pt-2">
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Timeline and Grid Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative" ref={scrollContainerRef}>
            <div className="w-full">
              {/* Week Header - Sticky at top */}
              <div className="flex sticky top-0 z-20 bg-gray-100/95 backdrop-blur-sm border-b border-gray-200">
                <div 
                  style={{ width: `${COURSE_LABEL_WIDTH}px` }} 
                  className="flex-shrink-0 sticky left-0 z-30 bg-gray-100 border-r border-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 h-8"
                >
                  课程名称
                </div>
                <div className="flex">
                  {Array.from({ length: TOTAL_WEEKS }, (_, i) => (
                    <div
                      key={i}
                      style={{ width: `${weekWidthPx}px` }}
                      className="flex-shrink-0 h-8 flex items-center justify-center border-r border-gray-200 text-xs font-bold text-gray-500"
                    >
                      Week {i + 1}
                    </div>
                  ))}
                </div>
              </div>

              {/* Course Rows */}
              {courseUnitsData.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-gray-500">
                  <p>该学期暂无课程单元数据</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {courseUnitsData.map(({ course, units }) => {
                    const tagChrome = getCourseTagChrome(course.color);
                    const isRowHovered = hoveredUnitId && units.some(u => u.id === hoveredUnitId);
                    
                    return (
                      <div 
                        key={course.id} 
                        className={`flex border-b border-gray-100 last:border-0 group h-[84px] relative transition-all duration-200 ${
                          isRowHovered ? 'z-50' : 'z-0'
                        }`}
                      >
                        {/* Course Label on Left - Sticky */}
                        <div 
                          style={{ width: `${COURSE_LABEL_WIDTH}px` }} 
                          className="flex-shrink-0 sticky left-0 z-10 flex items-center justify-center p-3 border-r border-gray-200 bg-white group-hover:bg-gray-50 transition-colors"
                        >
                          <div
                            className="w-full py-2 px-3 rounded-lg text-center"
                            style={{
                              backgroundColor: tagChrome.backgroundColor,
                              boxShadow: tagChrome.boxShadow,
                            }}
                          >
                            <span
                              className="text-[10px] font-bold text-white line-clamp-2 leading-tight"
                              style={{ textShadow: tagChrome.labelTextShadow }}
                            >
                              {course.name}
                            </span>
                          </div>
                        </div>

                        {/* Units Row */}
                        <div 
                          className="flex-1 relative bg-white group-hover:bg-blue-50/10 transition-colors" 
                          style={{ width: `${TOTAL_WEEKS * weekWidthPx}px` }}
                        >
                          {/* Vertical Grid Lines */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {Array.from({ length: TOTAL_WEEKS }, (_, i) => (
                              <div
                                key={i}
                                style={{ width: `${weekWidthPx}px` }}
                                className="h-full border-r border-gray-100/30 flex-shrink-0"
                              />
                            ))}
                          </div>

                          {/* Unit Labels - Positioned according to weeks */}
                          {units.map((unit, index) => {
                            const { start, end } = parseWeekRange(unit.week);
                            
                            // Visual adjustment for "meeting in the middle of shared week"
                            const prevUnit = index > 0 ? units[index - 1] : null;
                            const nextUnit = index < units.length - 1 ? units[index + 1] : null;
                            const prevRange = prevUnit ? parseWeekRange(prevUnit.week) : null;
                            const nextRange = nextUnit ? parseWeekRange(nextUnit.week) : null;

                            let displayStart = start - 1; // 0-based
                            let displayEnd = end;

                            if (prevRange && prevRange.end === start) {
                              displayStart = start - 0.5;
                            }
                            if (nextRange && nextRange.start === end) {
                              displayEnd = end - 0.5;
                            }

                            const duration = displayEnd - displayStart;
                            const leftOffset = displayStart * weekWidthPx;
                            const width = duration * weekWidthPx;
                            const isUnitHovered = hoveredUnitId === unit.id;

                            return (
                              <div
                                key={unit.id}
                                className={`absolute top-1/2 -translate-y-1/2 h-[95%] px-0 group/unit-container transition-shadow ${
                                  readOnly
                                    ? 'cursor-default'
                                    : dragState?.unitId === unit.id
                                      ? 'cursor-grabbing z-[150] shadow-xl ring-2 ring-blue-500'
                                      : 'cursor-grab'
                                }`}
                                style={{
                                  left: `${leftOffset}px`,
                                  width: `${width}px`,
                                  zIndex: isUnitHovered || dragState?.unitId === unit.id ? 100 : 1,
                                }}
                                onMouseEnter={() => {
                                  if (dragState) return;
                                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                                  hoverTimeoutRef.current = setTimeout(() => {
                                    setHoveredUnitId(unit.id);
                                  }, 500);
                                }}
                                onMouseLeave={() => {
                                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                                  setHoveredUnitId(null);
                                }}
                                onPointerDown={readOnly ? undefined : (e) => handlePointerDown(e, unit, course.id, 'drag')}
                                onPointerMove={readOnly ? undefined : handlePointerMove}
                                onPointerUp={readOnly ? undefined : handlePointerUp}
                              >
                                <div 
                                  className="h-full w-full bg-white rounded-lg shadow-sm border border-gray-200 p-2 pt-4 hover:shadow-md transition-all flex flex-col group/unit relative"
                                  onClick={() => {
                                    if (readOnly) return;
                                    // If we just finished a drag or resize, don't open the edit dialog
                                    if (wasDraggingRef.current) {
                                      wasDraggingRef.current = false;
                                      return;
                                    }
                                    setEditingUnit({ unit, courseId: course.id });
                                    setIsEditDialogOpen(true);
                                  }}
                                >
                                  {/* Resize Handles */}
                                  {!readOnly && (
                                    <>
                                  <div
                                    className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400/30 rounded-l-lg z-20"
                                    onPointerDown={(e) => handlePointerDown(e, unit, course.id, 'resize-left')}
                                  />
                                  <div
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400/30 rounded-r-lg z-20"
                                    onPointerDown={(e) => handlePointerDown(e, unit, course.id, 'resize-right')}
                                  />
                                    </>
                                  )}

                                  {/* Unit Badge in top-left */}
                                  <div 
                                    className="absolute top-0 left-0 w-[18px] h-[18px] flex items-center justify-center text-[9px] font-bold text-white rounded-br-lg rounded-tl-lg z-10"
                                    style={{
                                      backgroundColor: tagChrome.backgroundColor,
                                      textShadow: tagChrome.labelTextShadow,
                                    }}
                                  >
                                    {unit.order + 1}
                                  </div>

                                  {/* Title - Positioned even higher */}
                                  <div className="flex justify-center px-1 mb-0">
                                    <h3 className="text-[11.5px] font-bold text-gray-800 text-center line-clamp-2 leading-tight">
                                      {unit.title}
                                    </h3>
                                  </div>
                                  
                                  {/* Key Concepts - Following title closely */}
                                  {unit.keyConcepts.length > 0 && (
                                    <div className="flex flex-wrap gap-0.5 justify-center mt-1 overflow-hidden">
                                      {unit.keyConcepts.slice(0, duration > 1 ? 3 : 2).map((concept) => {
                                        const englishPart = concept.includes(' ') ? concept.split(' ').slice(1).join(' ') : concept;
                                        return (
                                          <span
                                            key={concept}
                                            className="px-1 py-0 bg-blue-50 text-blue-700 rounded-[3px] text-[8.5px] font-medium border border-blue-100 whitespace-nowrap"
                                          >
                                            {englishPart}
                                          </span>
                                        );
                                      })}
                                      {unit.keyConcepts.length > (duration > 1 ? 3 : 2) && (
                                        <span className="text-[8.5px] text-gray-400 font-medium">+{unit.keyConcepts.length - (duration > 1 ? 3 : 2)}</span>
                                      )}
                                    </div>
                                  )}

                                  {/* Popover / Tooltip on Hover - Truly transparent glassmorphism */}
                                  <div className={`transition-all duration-200 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-gray-900/45 backdrop-blur-xl text-white rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] p-4 pointer-events-none border border-white/20 z-[110] ${
                                    isUnitHovered ? 'visible opacity-100 scale-100' : 'invisible opacity-0 scale-95'
                                  }`}>
                                    <div className="flex items-center gap-2 mb-2 border-b border-white/10 pb-2">
                                      <span className="px-1.5 py-0.5 bg-blue-500/80 rounded text-[10px] font-bold text-white">Unit {unit.order + 1}</span>
                                      <span className="text-[10px] text-white/90 font-medium">{unit.week}周 | {unit.periods}节课</span>
                                    </div>
                                    <h4 className="text-sm font-bold mb-2 text-blue-200 leading-tight drop-shadow-sm">{unit.title}</h4>
                                    <div className="text-[11px] leading-relaxed text-white mb-3 bg-white/5 p-2 rounded-lg border border-white/10">
                                      {unit.focus}
                                    </div>
                                    {unit.keyConcepts.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 mt-auto">
                                        {unit.keyConcepts.map((concept) => {
                                          const englishPart = concept.includes(' ') ? concept.split(' ').slice(1).join(' ') : concept;
                                          return (
                                            <span key={concept} className="px-2 py-0.5 bg-white/20 text-white rounded text-[9px] border border-white/20">
                                              {englishPart}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Unit Dialog */}
      <AddUnitDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onAddUnit={handleUpdateUnit}
        onDeleteUnit={handleDeleteUnit}
        editingUnit={editingUnit?.unit}
      />

      <style>{`
        /* Custom scrollbar for better appearance */
        .overflow-auto::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .overflow-auto::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 4px;
        }
        .overflow-auto::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 4px;
        }
        .overflow-auto::-webkit-scrollbar-thumb:hover {
          background: #bbb;
        }
      `}</style>
    </div>
  );
}
