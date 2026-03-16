import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Course, Semester, SemesterData, Unit } from '../types';
import { useState, useEffect } from 'react';
import AddUnitDialog from './AddUnitDialog';
import BulkImportDialog from './BulkImportDialog';
import AIGenerateUnitsDialog from './AIGenerateUnitsDialog';
import { Sparkles, Trash2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { GRADE_LABELS, SEMESTER_LABELS } from '../lib/constants';
import { loadSemesterData, saveSemesterData } from '../lib/storage';

interface SemesterOverviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  semester: Semester;
}

export default function SemesterOverviewDialog({ 
  open, 
  onOpenChange, 
  course,
  semester 
}: SemesterOverviewDialogProps) {
  const { t, language } = useLanguage();
  const [semesterData, setSemesterData] = useState<SemesterData | null>(null);
  const [isAddUnitDialogOpen, setIsAddUnitDialogOpen] = useState(false);
  const [isBulkImportDialogOpen, setIsBulkImportDialogOpen] = useState(false);
  const [isAIGenerateDialogOpen, setIsAIGenerateDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [draggedUnitId, setDraggedUnitId] = useState<string | null>(null);
  const [isEditingWeeklyPeriods, setIsEditingWeeklyPeriods] = useState(false);
  const [tempWeeklyPeriods, setTempWeeklyPeriods] = useState<number>(2);

  // Load semester data from localStorage or cloud
  useEffect(() => {
    if (open && course && semester) {
      const loadData = async () => {
        try {
          const loaded = await loadSemesterData(course.id, semester.grade, semester.semester);
          if (loaded) {
            setSemesterData(loaded);
          } else {
            // Initialize new semester data with weeklyPeriods from course
            setSemesterData({
              courseId: course.id,
              grade: semester.grade,
              semester: semester.semester,
              units: [],
              weeklyPeriods: course.weeklyPeriods || 2,
            });
          }
        } catch (error) {
          console.error('Failed to load semester data:', error);
          // Fallback to empty data
          setSemesterData({
            courseId: course.id,
            grade: semester.grade,
            semester: semester.semester,
            units: [],
            weeklyPeriods: course.weeklyPeriods || 2,
          });
        }
      };
      loadData();
    }
  }, [open, course, semester]);

  // Save semester data to localStorage or cloud
  useEffect(() => {
    if (semesterData && course && semester) {
      const saveData = async () => {
        try {
          await saveSemesterData(semesterData);
        } catch (error) {
          console.error('Failed to save semester data:', error);
        }
      };
      saveData();
    }
  }, [semesterData, course, semester]);

  const handleAddUnit = (unitData: Omit<Unit, 'id' | 'order'>) => {
    if (!semesterData) return;

    const newUnit: Unit = {
      id: `unit-${Date.now()}`,
      ...unitData,
      order: semesterData.units.length,
    };

    setSemesterData({
      ...semesterData,
      units: [...semesterData.units, newUnit],
    });
  };

  const handleUpdateUnit = (unitData: Omit<Unit, 'id' | 'order'>) => {
    if (!semesterData || !editingUnit) return;

    const updatedUnits = semesterData.units.map(unit =>
      unit.id === editingUnit.id
        ? { ...unit, ...unitData }
        : unit
    );

    setSemesterData({
      ...semesterData,
      units: updatedUnits,
    });

    setEditingUnit(null);
  };

  const handleDeleteUnit = (unitId: string) => {
    if (!semesterData) return;

    const updatedUnits = semesterData.units.filter(unit => unit.id !== unitId);
    
    // Reorder units after deletion
    const reorderedUnits = updatedUnits.map((unit, index) => ({
      ...unit,
      order: index,
    }));

    setSemesterData({
      ...semesterData,
      units: reorderedUnits,
    });
  };

  const handleBulkImportUnits = (units: Omit<Unit, 'id' | 'order'>[]) => {
    if (!semesterData) return;

    const newUnits: Unit[] = units.map((unitData, index) => ({
      id: `unit-${Date.now()}-${index}`,
      ...unitData,
      order: semesterData.units.length + index,
    }));

    setSemesterData({
      ...semesterData,
      units: [...semesterData.units, ...newUnits],
    });
  };

  const handleClearAllUnits = () => {
    if (!semesterData) return;

    const semesterKey = (semester?.semester || 'Semester 1') as 'Semester 1' | 'Semester 2';
    const confirmMsg = language === 'zh'
      ? `确定要清除"${course?.name}" ${GRADE_LABELS[semester?.grade || 1]} ${SEMESTER_LABELS[semesterKey]}的所有单元吗？此操作不可恢复。`
      : `Are you sure you want to clear all units for "${course?.name}" ${GRADE_LABELS[semester?.grade || 1]} ${SEMESTER_LABELS[semesterKey]}? This action cannot be undone.`;
    
    if (window.confirm(confirmMsg)) {
      setSemesterData({
        ...semesterData,
        units: [],
      });
    }
  };

  const handleUnitClick = (unit: Unit) => {
    setEditingUnit(unit);
  };

  const handleDragStart = (e: React.DragEvent, unitId: string) => {
    setDraggedUnitId(unitId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetUnitId: string) => {
    e.preventDefault();
    if (!semesterData || !draggedUnitId || draggedUnitId === targetUnitId) {
      setDraggedUnitId(null);
      return;
    }

    const units = [...semesterData.units];
    const draggedIndex = units.findIndex(u => u.id === draggedUnitId);
    const targetIndex = units.findIndex(u => u.id === targetUnitId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedUnitId(null);
      return;
    }

    // Remove dragged unit
    const [draggedUnit] = units.splice(draggedIndex, 1);
    // Insert at target position
    units.splice(targetIndex, 0, draggedUnit);

    // Update order
    const reorderedUnits = units.map((unit, index) => ({
      ...unit,
      order: index,
    }));

    setSemesterData({
      ...semesterData,
      units: reorderedUnits,
    });

    setDraggedUnitId(null);
  };

  const handleDragEnd = () => {
    setDraggedUnitId(null);
  };

  const handleMoveUnit = (unitId: string, direction: 'up' | 'down') => {
    if (!semesterData) return;

    const units = [...semesterData.units];
    const currentIndex = units.findIndex(u => u.id === unitId);
    
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0 || newIndex >= units.length) return;

    // Swap units
    [units[currentIndex], units[newIndex]] = [units[newIndex], units[currentIndex]];

    // Update order
    const reorderedUnits = units.map((unit, index) => ({
      ...unit,
      order: index,
    }));

    setSemesterData({
      ...semesterData,
      units: reorderedUnits,
    });
  };

  if (!semester || !course) return null;

  const sortedUnits = semesterData?.units.sort((a, b) => a.order - b.order) || [];
  
  // Get weekly periods: use semesterData.weeklyPeriods if set, otherwise fallback to course.weeklyPeriods
  const currentWeeklyPeriods = semesterData?.weeklyPeriods ?? course.weeklyPeriods ?? 2;
  
  // Total periods calculation removed (not used)
  
  const handleUpdateWeeklyPeriods = () => {
    if (!semesterData) return;
    setSemesterData({
      ...semesterData,
      weeklyPeriods: tempWeeklyPeriods,
    });
    setIsEditingWeeklyPeriods(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col" aria-describedby="semester-overview-desc">
          <DialogHeader className="mb-4 pb-4 border-b space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="text-2xl font-bold text-gray-800 leading-none">
                {course.name}
              </DialogTitle>
              <div className="text-sm text-gray-600 whitespace-nowrap">
                {GRADE_LABELS[semester.grade]} {SEMESTER_LABELS[semester.semester as 'Semester 1' | 'Semester 2']} - {t('semester.overview')} | G{semester.grade} {semester.semester} {t('semester.overview')}
              </div>
            </div>
            <DialogDescription id="semester-overview-desc" className="text-sm text-muted-foreground">
              {language === 'zh' ? '查看、添加与编辑本学期单元' : 'View, add and edit units for this semester'}
            </DialogDescription>
            {/* Weekly Periods Display and Edit */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{language === 'zh' ? '周课时数' : 'Weekly Periods'}:</span>
              {isEditingWeeklyPeriods ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={tempWeeklyPeriods}
                    onChange={(e) => setTempWeeklyPeriods(Math.max(1, Math.min(10, parseInt(e.target.value) || 2)))}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                    autoFocus
                  />
                  <button
                    onClick={handleUpdateWeeklyPeriods}
                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingWeeklyPeriods(false);
                      setTempWeeklyPeriods(currentWeeklyPeriods);
                    }}
                    className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-medium">{currentWeeklyPeriods} {language === 'zh' ? '节/周' : 'periods/week'}</span>
                  <button
                    onClick={() => {
                      setTempWeeklyPeriods(currentWeeklyPeriods);
                      setIsEditingWeeklyPeriods(true);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 underline"
                  >
                    {t('common.edit')}
                  </button>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Units list */}
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {sortedUnits.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                {t('semester.noUnits')}，{t('semester.noUnitsHint')}
              </div>
            ) : (
              sortedUnits.map((unit, index) => (
                <div
                  key={unit.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, unit.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, unit.id)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => {
                    // 如果点击的不是箭头按钮，则打开编辑界面
                    if (!(e.target as HTMLElement).closest('button')) {
                      handleUnitClick(unit);
                    }
                  }}
                  className={`flex items-stretch gap-0 border-2 rounded-lg shadow-md transition-all cursor-pointer overflow-hidden ${
                    draggedUnitId === unit.id ? 'opacity-50' : 'hover:shadow-lg'
                  }`}
                  style={{
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.3)',
                  }}
                >
                  {/* Unit label with arrows - 左侧独立部分，与卡片等高，蓝色背景填满，共享左侧圆角 */}
                  <div 
                    className="flex flex-col items-center justify-between p-0.5 flex-shrink-0 border-r border-blue-400 bg-gradient-to-b from-blue-500 to-blue-600"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Up arrow */}
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => handleMoveUnit(unit.id, 'up')}
                        className="p-0.5 hover:bg-blue-700 rounded transition-colors"
                        title={t('semester.moveUp')}
                      >
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                    )}
                    {index === 0 && <div className="w-3.5 h-3.5" />}

                    {/* Unit number */}
                    <div className="w-9 h-9 text-white flex items-center justify-center font-bold text-[0.8625rem] leading-tight">
                      Unit{index + 1}
                    </div>

                    {/* Down arrow */}
                    {index < sortedUnits.length - 1 && (
                      <button
                        type="button"
                        onClick={() => handleMoveUnit(unit.id, 'down')}
                        className="p-0.5 hover:bg-blue-700 rounded transition-colors"
                        title={t('semester.moveDown')}
                      >
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                    {index === sortedUnits.length - 1 && <div className="w-3.5 h-3.5" />}
                  </div>

                  {/* Unit content - 右侧主要内容，白色背景 */}
                  <div className="flex-1 p-1.5 space-y-0 bg-white relative">
                    {/* Vertical divider line with shadow - 固定位置的竖线分割，往左移动15%（10%+5%） */}
                    <div 
                      className="absolute top-0 bottom-0 w-px bg-gray-300 flex-shrink-0 pointer-events-none" 
                      style={{
                        right: '162px', // 154px * 1.05 = 161.7px ≈ 162px (再往左移动5%)
                        boxShadow: '1px 0 2px rgba(0, 0, 0, 0.1)'
                      }} 
                    />

                    {/* Title and Focus Section - 左侧，不能超过竖线 */}
                    <div 
                      className="min-w-0 pr-2"
                      style={{
                        maxWidth: 'calc(100% - 162px - 8px)', // 确保不超过竖线位置（162px + 8px padding）
                      }}
                    >
                      <h3 className="text-[1.15rem] font-semibold text-gray-800 leading-tight break-words">
                        {unit.title}
                      </h3>
                      {/* Focus */}
                      {unit.focus && (
                        <p className="text-[0.8625rem] text-gray-600 mt-0.5 leading-tight whitespace-normal break-words">
                          {unit.focus}
                        </p>
                      )}
                    </div>

                    {/* Week, Periods and Key Concepts Section - 右侧固定位置 */}
                    <div className="absolute top-1.5 flex flex-col items-end gap-0.5" style={{ width: '150px', right: '8px' }}>
                      <div className="text-[0.8625rem] text-gray-600 whitespace-nowrap leading-tight">
                        <span>{t('semester.weekLabel')}: {unit.week}</span>
                        <span className="ml-2">{t('semester.periodsLabel')}: {unit.periods} {t('semester.periodsUnit')}</span>
                      </div>
                      {/* Key Concepts - 根据语言显示中文或英文 */}
                      {unit.keyConcepts.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 justify-end w-full pr-1">
                          {unit.keyConcepts.map((concept) => {
                            // 根据语言显示中文或英文
                            let displayText: string;
                            if (concept.includes(' ')) {
                              const parts = concept.split(' ');
                              displayText = language === 'zh' ? parts[0] : parts.slice(1).join(' ');
                            } else {
                              displayText = concept;
                            }
                            return (
                              <span
                                key={concept}
                                className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-[0.75rem] leading-tight"
                              >
                                {displayText}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
        </div>

          {/* Footer */}
          <div className="mt-4 pt-4 border-t flex justify-between items-center gap-2">
            {/* 左侧：清除单元按钮 */}
            <Button 
              variant="outline" 
              onClick={handleClearAllUnits}
              disabled={!semesterData || semesterData.units.length === 0}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t('semester.clearAll')}
            </Button>

            {/* 右侧：其他操作按钮 */}
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setIsAIGenerateDialogOpen(true)}
                className="bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border-blue-300"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {t('common.aiImport')}
              </Button>
              <Button variant="outline" onClick={() => setIsBulkImportDialogOpen(true)}>
                {t('common.excelImport')}
              </Button>
              <Button onClick={() => setIsAddUnitDialogOpen(true)}>
                {t('semester.addUnit')}
              </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('semester.close')}
          </Button>
            </div>
          </div>
      </DialogContent>
    </Dialog>

      {/* Add Unit Dialog */}
      <AddUnitDialog
        open={isAddUnitDialogOpen}
        onOpenChange={setIsAddUnitDialogOpen}
        onAddUnit={handleAddUnit}
      />

      {/* Edit Unit Dialog */}
      <AddUnitDialog
        open={!!editingUnit}
        onOpenChange={(open) => {
          if (!open) setEditingUnit(null);
        }}
        onAddUnit={handleUpdateUnit}
        onDeleteUnit={handleDeleteUnit}
        editingUnit={editingUnit}
      />

      {/* Bulk Import Dialog */}
      {course && semester && (
        <BulkImportDialog
          open={isBulkImportDialogOpen}
          onOpenChange={setIsBulkImportDialogOpen}
          course={course}
          semester={semester}
          onImportUnits={handleBulkImportUnits}
        />
      )}

      {/* AI Generate Units Dialog */}
      {course && semester && (
        <AIGenerateUnitsDialog
          open={isAIGenerateDialogOpen}
          onOpenChange={setIsAIGenerateDialogOpen}
          course={course}
          semester={semester}
          onConfirm={handleBulkImportUnits}
        />
      )}
    </>
  );
}
