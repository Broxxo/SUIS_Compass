import { useState, useEffect, useRef } from 'react';
import { Course, Semester, CourseColor, SubjectCategory } from '../types';
import AddCourseDialog from './AddCourseDialog';
import SemesterOverviewDialog from './SemesterOverviewDialog';
import SettingsDialog from './SettingsDialog';
import EditCourseDialog from './EditCourseDialog';
import UnitView from './UnitView';
import ConceptView from './ConceptView';
import AIChatAssistant from './AIChatAssistant';
import ConceptSettingsDialog from './ConceptSettingsDialog';
import { Settings, Plus, Languages, BarChart2, Globe, LogOut } from 'lucide-react';
import { Button } from './ui/button';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getSubjectCategoryText, getCategoryCanonicalKey } from '../lib/utils';
import { GRADES, SEMESTERS } from '../lib/constants';
import { loadCourses, saveCourses, hasSemesterUnits, deleteCourseSemesterData, loadSemesterDataSync, loadCategoryOrder, saveCategoryOrder } from '../lib/storage';
import { migrateCoursesData, getColorGradient } from '../lib/courseUtils';

type ViewMode = 'overview' | 'unit' | 'concept';

export default function CourseRiver() {
  const { language, setLanguage, t } = useLanguage();
  const { user, logout } = useAuth();
  
  // Load courses from localStorage or cloud on mount
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);

  // Load courses on mount
  useEffect(() => {
    const loadCoursesData = async () => {
      setIsLoadingCourses(true);
      try {
        const loadedCourses = await loadCourses();
        setCourses(migrateCoursesData(loadedCourses));
      } catch (error) {
        console.error('Failed to load courses:', error);
        // Fallback to empty array
        setCourses([]);
      } finally {
        setIsLoadingCourses(false);
      }
    };
    loadCoursesData();
  }, []);
  
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [selectedSemester, setSelectedSemester] = useState<Semester | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isSemesterDialogOpen, setIsSemesterDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isAddCourseDialogOpen, setIsAddCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isEditCourseDialogOpen, setIsEditCourseDialogOpen] = useState(false);
  
  // For focus view, default to G1 Semester 1
  const [focusSemester, setFocusSemester] = useState<Semester>({ grade: 1, semester: 'Semester 1' });
  
  // For concept view, default to null (no semester selected)
  const [conceptSemester, setConceptSemester] = useState<Semester | null>(null);

  // Category order for course river columns (canonical keys = zh). Persisted.
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => loadCategoryOrder());
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [showTotalPeriods, setShowTotalPeriods] = useState(false);
  const [isConceptSettingsDialogOpen, setIsConceptSettingsDialogOpen] = useState(false);

  // Save courses to localStorage or cloud whenever courses change
  useEffect(() => {
    if (courses.length > 0 || !isLoadingCourses) {
      const saveCoursesData = async () => {
        try {
          await saveCourses(courses);
        } catch (error) {
          console.error('Failed to save courses:', error);
        }
      };
      saveCoursesData();
    }
  }, [courses, isLoadingCourses]);

  // Merge new categories into categoryOrder when courses change.
  useEffect(() => {
    const grouped: Record<string, { displayKey: string; courses: Course[] }> = {};
    courses.forEach((c) => {
      const canonical = getCategoryCanonicalKey(c.subjectCategory) || c.name;
      const displayKey = getSubjectCategoryText(c.subjectCategory, language) || c.name;
      if (!grouped[canonical]) grouped[canonical] = { displayKey, courses: [] };
      grouped[canonical].courses.push(c);
      grouped[canonical].displayKey = displayKey;
    });
    setCategoryOrder((prev) => {
      const next = prev.filter((k) => grouped[k]);
      Object.keys(grouped).forEach((k) => {
        if (!next.includes(k)) next.push(k);
      });
      if (next.length === prev.length && next.every((k, i) => prev[i] === k)) return prev;
      return next;
    });
  }, [courses]);

  // Persist category order when it changes (e.g. after reorder or merge).
  const prevOrderRef = useRef<string[]>([]);
  useEffect(() => {
    if (
      prevOrderRef.current.length !== categoryOrder.length ||
      prevOrderRef.current.some((k, i) => categoryOrder[i] !== k)
    ) {
      prevOrderRef.current = [...categoryOrder];
      saveCategoryOrder(categoryOrder);
    }
  }, [categoryOrder]);

  const handleAddCourse = (courseName: string, subjectCategory: SubjectCategory, gradeRange: string, textbookVersion: string, color: Course['color'], weeklyPeriods: number = 2) => {
    const newCourse: Course = {
      id: `course-${Date.now()}`,
      name: courseName,
      subjectCategory: subjectCategory,
      gradeRange: gradeRange || undefined,
      textbookVersion: textbookVersion || '人教版',
      color: color,
      weeklyPeriods: weeklyPeriods,
    };
    setCourses([...courses, newCourse]);
    setIsAddCourseDialogOpen(false);
  };

  const handleUpdateCourse = (courseId: string, updates: { name?: string; subjectCategory?: SubjectCategory | string; gradeRange?: string; textbookVersion?: string; color?: CourseColor; weeklyPeriods?: number }) => {
    setCourses(courses.map(course =>
      course.id === courseId
        ? { ...course, ...updates }
        : course
    ));
  };

  const handleDeleteCourse = (courseId: string) => {
    // 删除所有相关的学期数据
    deleteCourseSemesterData(courseId);
    
    // 从courses数组中移除该课程
    setCourses(courses.filter(course => course.id !== courseId));
  };

  const handleSemesterClick = (course: Course, grade: number, semester: 'Semester 1' | 'Semester 2') => {
    setSelectedCourse(course);
    setSelectedSemester({ grade, semester });
    setIsSemesterDialogOpen(true);
  };

  const getSemesterLabel = (courseName: string, grade: number, semester: 'Semester 1' | 'Semester 2') => {
    return `${courseName} G${grade} ${semester}`;
  };

  const handleEditCourseClick = (course: Course) => {
    setEditingCourse(course);
    setIsEditCourseDialogOpen(true);
  };

  const handleSaveEditedCourse = (courseId: string, updates: { name: string; subjectCategory: SubjectCategory; gradeRange?: string; textbookVersion?: string; color: CourseColor; weeklyPeriods: number }) => {
    handleUpdateCourse(courseId, updates);
    setIsEditCourseDialogOpen(false);
    setEditingCourse(null);
  };

  type CategoryEntry = { canonicalKey: string; displayKey: string; courses: Course[] };
  const buildSortedCategoryEntries = (): CategoryEntry[] => {
    const grouped: Record<string, { displayKey: string; courses: Course[] }> = {};
    courses.forEach((c) => {
      const canonical = getCategoryCanonicalKey(c.subjectCategory) || c.name;
      const displayKey = getSubjectCategoryText(c.subjectCategory, language) || c.name;
      if (!grouped[canonical]) grouped[canonical] = { displayKey, courses: [] };
      grouped[canonical].courses.push(c);
      grouped[canonical].displayKey = displayKey;
    });
    const ordered = categoryOrder.filter((k) => grouped[k]);
    const keys = ordered.slice();
    Object.keys(grouped).forEach((k) => {
      if (!keys.includes(k)) keys.push(k);
    });
    return keys.map((k) => ({ canonicalKey: k, ...grouped[k] }));
  };

  const handleReorderCategories = (draggedKey: string, dropTargetKey: string) => {
    if (draggedKey === dropTargetKey) return;
    const entries = buildSortedCategoryEntries();
    const keys = entries.map((e) => e.canonicalKey);
    const from = keys.indexOf(draggedKey);
    const to = keys.indexOf(dropTargetKey);
    if (from === -1 || to === -1) return;
    const next = keys.slice();
    next.splice(from, 1);
    next.splice(next.indexOf(dropTargetKey), 0, draggedKey);
    setCategoryOrder(next);
    setDragOverCategory(null);
  };

  return (
    <div className="h-screen w-screen bg-white overflow-hidden">
      {/* Header - Centered Title */}
      <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-10">
        <h1 className="text-3xl font-bold text-gray-800">
          课程河流 Curriculum Roadmap
        </h1>
      </div>

      {/* Top-right: Show periods, Language Toggle, Add Course, Settings */}
      <div className="absolute top-6 right-6 z-10 flex gap-2">
        <Button
          variant={showTotalPeriods ? 'default' : 'outline'}
          size="icon"
          onClick={() => setShowTotalPeriods((v) => !v)}
          className="w-10 h-10"
          title={showTotalPeriods ? t('view.hidePeriods') : t('view.showPeriods')}
        >
          <BarChart2 className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          className="w-10 h-10"
          title={language === 'zh' ? 'Switch to English' : '切换到中文'}
        >
          <Languages className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsConceptSettingsDialogOpen(true)}
          className="w-10 h-10"
          title={t('concept.settings')}
        >
          <Globe className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsAddCourseDialogOpen(true)}
          className="w-10 h-10"
          title={t('course.add')}
        >
          <Plus className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsSettingsDialogOpen(true)}
          className="w-10 h-10"
          title={t('settings.title')}
        >
          <Settings className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            if (window.confirm(language === 'zh' ? '确定要退出登录吗？' : 'Are you sure you want to logout?')) {
              logout();
            }
          }}
          className="w-10 h-10"
          title={language === 'zh' ? `退出登录 (${user?.displayName || user?.username})` : `Logout (${user?.displayName || user?.username})`}
        >
          <LogOut className="h-5 w-5" />
        </Button>
      </div>

      {/* Bottom Controls - View Mode Toggle Buttons */}
      <div className="absolute bottom-6 left-0 right-0 z-10 px-4 flex justify-center">
        <div className="flex gap-3">
          <Button
            variant={viewMode === 'overview' ? 'default' : 'outline'}
            onClick={() => setViewMode('overview')}
            className="px-6"
          >
            {t('view.overview')}
          </Button>
          <Button
            variant={viewMode === 'unit' ? 'default' : 'outline'}
            onClick={() => setViewMode('unit')}
            className="px-6"
          >
            {t('view.unit')}
          </Button>
          <Button
            variant={viewMode === 'concept' ? 'default' : 'outline'}
            onClick={() => setViewMode('concept')}
            className="px-6"
          >
            {t('view.concept')}
          </Button>
        </div>
      </div>

      {/* Course Area */}
      {viewMode === 'overview' ? (
        <div className="h-full w-full pt-24 px-4 pb-20 flex justify-center relative">
        <div className="relative h-full w-full max-w-[95%]">
          
          {/* Total Periods Statistics - only when "显示课时" toggle is on */}
          {showTotalPeriods && (
            <div
              className="absolute top-0 bottom-0 flex flex-col pointer-events-none"
              style={{ zIndex: 50, width: '52px', right: '-6px' }}
            >
              {GRADES.map((grade) => {
                const totalWeeklyPeriods = (() => {
                  let total = 0;
                  courses.forEach((course) => {
                    const applicableGrades = parseGradeRange(course.gradeRange);
                    if (applicableGrades.includes(grade)) {
                      const semesterData = loadSemesterDataSync(course.id, grade, 'Semester 1');
                      const weeklyPeriods = semesterData?.weeklyPeriods ?? course.weeklyPeriods ?? 2;
                      total += weeklyPeriods;
                    }
                  });
                  return total;
                })();
                const topPosition = `${((grade - 1) / GRADES.length) * 100}%`;
                const height = `${(1 / GRADES.length) * 100}%`;
                return (
                  <div
                    key={grade}
                    className="absolute left-0 right-0 flex items-center justify-center"
                    style={{ top: topPosition, height }}
                  >
                    <span className="text-xl text-gray-700">{totalWeeklyPeriods}</span>
                  </div>
                );
              })}
            </div>
          )}
          {/* Grade Labels on Left (Outside the box, to the left of border) */}
          <div className="absolute -left-8 top-0 bottom-0 w-8 flex flex-col items-center">
            {GRADES.map((grade) => (
              <div key={grade} className="flex-1 flex items-center justify-center">
                <span className="text-base font-semibold text-gray-700">
                  G{grade}
                </span>
              </div>
            ))}
          </div>

          {/* Course Box */}
          <div className="relative h-full w-full border-2 border-gray-300 rounded-lg bg-gradient-to-b from-gray-50 to-gray-100">
            {/* Grade Division Lines - 8 horizontal dashed lines dividing G1-G9 */}
            <div className="absolute inset-0 pointer-events-none">
              {GRADES.slice(0, -1).map((grade) => (
                <div
                  key={grade}
                  className="absolute left-0 right-0 border-b border-dashed border-gray-300/40"
                  style={{
                    top: `${(grade / GRADES.length) * 100}%`,
                  }}
                />
              ))}
            </div>

            {/* Course Columns Container - with overflow for horizontal scroll */}
            <div className="h-full px-4 overflow-x-auto overflow-y-hidden">
              <div className="h-full flex gap-[29px]" style={{ paddingTop: '0px' }}>
              {buildSortedCategoryEntries().map(({ canonicalKey, displayKey, courses: categoryCourses }) => (
                <CategoryColumn
                  key={canonicalKey}
                  category={displayKey}
                  courses={categoryCourses}
                  onSemesterClick={handleSemesterClick}
                  getSemesterLabel={getSemesterLabel}
                />
              ))}
              </div>
            </div>
            
          </div>

          {/* Course Names at Top - Parallelogram labels, draggable for custom order */}
          <div className="absolute -top-7 left-0 right-0 flex gap-[29px] px-4 overflow-x-auto" style={{ height: '28px' }}>
            {buildSortedCategoryEntries().map(({ canonicalKey, displayKey, courses: categoryCourses }) => {
              const course = categoryCourses[0];
              const gradient = getColorGradient(course.color);
              const isDragging = draggedCategory === canonicalKey;
              const isDropTarget = dragOverCategory === canonicalKey;
              return (
                <div
                  key={canonicalKey}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', canonicalKey);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedCategory(canonicalKey);
                  }}
                  onDragEnd={() => setDraggedCategory(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverCategory(canonicalKey);
                  }}
                  onDragLeave={(e) => {
                    const rel = e.relatedTarget as Node | null;
                    if (!rel || !e.currentTarget.contains(rel))
                      setDragOverCategory((k) => (k === canonicalKey ? null : k));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const key = e.dataTransfer.getData('text/plain');
                    if (key) handleReorderCategories(key, canonicalKey);
                    setDragOverCategory(null);
                  }}
                  className={`flex-shrink-0 relative cursor-grab active:cursor-grabbing select-none transition-opacity ${
                    isDragging ? 'opacity-50' : ''
                  } ${isDropTarget ? 'ring-2 ring-amber-400 ring-offset-1 rounded' : ''}`}
                  style={{ width: '63px', height: '28px' }}
                >
                  {/* Parallelogram background with 3D effect - using course color scheme */}
                  <div
                    className="absolute inset-0 shadow-lg pointer-events-none"
                    style={{
                      transform: 'skewX(-20deg)',
                      transformOrigin: 'bottom center',
                      background: `linear-gradient(135deg, ${gradient.medium} 0%, ${gradient.dark} 50%, ${gradient.medium} 100%)`,
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)',
                      bottom: '0px',
                    }}
                  />
                  {/* Inner highlight for 3D effect */}
                  <div
                    className="absolute inset-0 opacity-30 pointer-events-none"
                    style={{
                      transform: 'skewX(-20deg)',
                      transformOrigin: 'bottom center',
                      background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.3) 0%, transparent 50%)',
                      bottom: '0px',
                    }}
                  />
                  {/* Text container - skewed to match parallelogram angle, centered */}
                  <div
                    className="relative h-full flex items-center justify-center pointer-events-none"
                    style={{ transform: 'skewX(20deg)', padding: '0 2px' }}
                  >
                    <span
                      className="text-xs font-semibold text-black whitespace-nowrap italic"
                      style={{
                        transform: 'skewX(-20deg)',
                        fontStyle: 'italic',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={displayKey}
                    >
                      {displayKey}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      ) : viewMode === 'unit' ? (
        <div className="h-full w-full pt-16 pb-14">
          <UnitView
            courses={courses}
            selectedSemester={focusSemester}
            onSemesterChange={setFocusSemester}
          />
        </div>
      ) : (
        <div className="h-full w-full pt-16 pb-14">
          <ConceptView 
            courses={courses} 
            selectedSemester={conceptSemester}
            onSemesterChange={setConceptSemester}
          />
        </div>
      )}

      {/* Add Course Dialog */}
      <AddCourseDialog
        onAddCourse={handleAddCourse}
        open={isAddCourseDialogOpen}
        onOpenChange={setIsAddCourseDialogOpen}
      />

      {/* Semester Overview Dialog */}
      {selectedCourse && selectedSemester && (
        <SemesterOverviewDialog
          open={isSemesterDialogOpen}
          onOpenChange={setIsSemesterDialogOpen}
          course={selectedCourse}
          semester={selectedSemester}
        />
      )}

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsDialogOpen}
        onOpenChange={setIsSettingsDialogOpen}
        courses={courses}
        onUpdateCourse={handleUpdateCourse}
        onDeleteCourse={handleDeleteCourse}
        onEditCourse={handleEditCourseClick}
      />

      {/* Edit Course Dialog */}
      <EditCourseDialog
        course={editingCourse}
        open={isEditCourseDialogOpen}
        onOpenChange={setIsEditCourseDialogOpen}
        onSave={handleSaveEditedCourse}
      />

      {/* AI Chat Assistant */}
      <AIChatAssistant
        viewMode={viewMode === 'unit' ? 'focus' : viewMode === 'concept' ? 'overview' : viewMode}
        courses={courses}
        focusSemester={focusSemester}
      />

      {/* Concept Settings Dialog */}
      <ConceptSettingsDialog
        open={isConceptSettingsDialogOpen}
        onOpenChange={setIsConceptSettingsDialogOpen}
      />
    </div>
  );
}

interface CategoryColumnProps {
  category: string;
  courses: Course[];
  onSemesterClick: (course: Course, grade: number, semester: 'Semester 1' | 'Semester 2') => void;
  getSemesterLabel: (courseName: string, grade: number, semester: 'Semester 1' | 'Semester 2') => string;
}

const COLOR_CLASSES: Record<CourseColor, { base: string; hover: string; standard: string }> = {
  'light-blue': { base: 'bg-blue-100', hover: 'bg-blue-200', standard: 'bg-blue-300' },
  'light-green': { base: 'bg-green-100', hover: 'bg-green-200', standard: 'bg-green-300' },
  'light-yellow': { base: 'bg-yellow-100', hover: 'bg-yellow-200', standard: 'bg-yellow-300' },
  'light-red': { base: 'bg-red-100', hover: 'bg-red-200', standard: 'bg-red-300' },
  'light-purple': { base: 'bg-purple-100', hover: 'bg-purple-200', standard: 'bg-purple-300' },
  'light-orange': { base: 'bg-orange-100', hover: 'bg-orange-200', standard: 'bg-orange-300' },
  'light-cyan': { base: 'bg-cyan-100', hover: 'bg-cyan-200', standard: 'bg-cyan-300' },
  'light-pink': { base: 'bg-pink-100', hover: 'bg-pink-200', standard: 'bg-pink-300' },
  'light-indigo': { base: 'bg-indigo-100', hover: 'bg-indigo-200', standard: 'bg-indigo-300' },
};

// 解析年级跨度，返回适用的年级数组
function parseGradeRange(gradeRange?: string): number[] {
  if (!gradeRange) {
    // 如果没有设置年级跨度，返回所有年级
    return GRADES;
  }
  
  if (gradeRange.includes('-')) {
    // 范围格式，如 "7-8"
    const [start, end] = gradeRange.split('-').map(Number);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  } else {
    // 单个年级，如 "7"
    return [Number(gradeRange)];
  }
}

// 根据年级找到对应的课程（如果有多个课程覆盖该年级，返回第一个）
function findCourseForGrade(courses: Course[], grade: number): Course | null {
  for (const course of courses) {
    const applicableGrades = parseGradeRange(course.gradeRange);
    if (applicableGrades.includes(grade)) {
      return course;
    }
  }
  return null;
}

function CategoryColumn({ category: _category, courses, onSemesterClick, getSemesterLabel }: CategoryColumnProps) {
  // 使用第一个课程的颜色作为该列的颜色
  const defaultCourse = courses[0];
  
  return (
    <div className="flex-shrink-0 w-[63px] relative">
      {/* Course River */}
      <div className="h-full flex flex-col">
        {GRADES.map((grade) => {
          // 找到覆盖该年级的课程
          const course = findCourseForGrade(courses, grade);
          const isApplicable = course !== null;
          
          return (
            <div key={grade} className="flex-1 flex flex-col">
              {SEMESTERS.map((semester) => {
                if (course) {
                  const hasUnits = hasSemesterUnits(course.id, grade, semester);
                  return (
                    <SemesterSegment
                      key={`${grade}-${semester}`}
                      grade={grade}
                      semester={semester}
                      color={course.color}
                      hasUnits={hasUnits}
                      isApplicable={isApplicable}
                      onSemesterClick={() => onSemesterClick(course, grade, semester)}
                      getSemesterLabel={(g, s) => getSemesterLabel(course.name, g, s)}
                      course={course}
                    />
                  );
                } else {
                  // 没有课程覆盖该年级，显示为灰色
                  return (
                    <SemesterSegment
                      key={`${grade}-${semester}`}
                      grade={grade}
                      semester={semester}
                      color={defaultCourse.color}
                      hasUnits={false}
                      isApplicable={false}
                      onSemesterClick={() => {}}
                      getSemesterLabel={() => ''}
                      course={defaultCourse}
                    />
                  );
                }
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// CourseColumn function removed - not used, CategoryColumn is used instead

interface SemesterSegmentProps {
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  color: Course['color'];
  hasUnits: boolean;
  isApplicable: boolean; // 该年级是否在课程适用的年级范围内
  onSemesterClick: () => void;
  getSemesterLabel: (grade: number, semester: 'Semester 1' | 'Semester 2') => string;
  course: Course; // 添加 course 用于获取 weeklyPeriods
}

function SemesterSegment({ 
  grade, 
  semester, 
  color,
  hasUnits,
  isApplicable,
  onSemesterClick, 
  getSemesterLabel: _getSemesterLabel,
  course
}: SemesterSegmentProps) {
  const { language } = useLanguage();
  const [isHovered, setIsHovered] = useState(false);
  const colorClasses = COLOR_CLASSES[color];
  
  // Get weekly periods for this semester: check SemesterData first, then fallback to course.weeklyPeriods
  const [weeklyPeriods, setWeeklyPeriods] = useState<number>(course.weeklyPeriods || 2);
  
  useEffect(() => {
    const semesterData = loadSemesterDataSync(course.id, grade, semester);
    setWeeklyPeriods(semesterData?.weeklyPeriods ?? course.weeklyPeriods ?? 2);
  }, [course.id, grade, semester, course.weeklyPeriods]);
  
  // 如果不在适用年级范围内，使用灰色并禁用
  if (!isApplicable) {
    const bgColor = 'bg-gray-100';
    return (
      <div
        className="flex-1 relative transition-all duration-200 opacity-50"
        style={{
          pointerEvents: 'none',
        }}
      >
        <div
          className={`absolute inset-0 ${bgColor} border-r border-b border-gray-300/30`}
          style={{
            pointerEvents: 'none',
          }}
        />
        <div 
          className="absolute bottom-0 left-0 right-0 border-b border-dashed border-gray-400/50"
          style={{ pointerEvents: 'none' }}
        />
      </div>
    );
  }
  
  // 如果有单元，使用标准色；否则使用淡色
  const bgColor = hasUnits ? colorClasses.standard : colorClasses.base;
  const hoverColor = hasUnits ? colorClasses.standard : colorClasses.hover;

  return (
    <div
      className="flex-1 relative cursor-pointer transition-all duration-200"
      onMouseEnter={(e) => {
        e.stopPropagation();
        setIsHovered(true);
      }}
      onMouseLeave={(e) => {
        e.stopPropagation();
        setIsHovered(false);
      }}
      onMouseMove={() => {
        // Ensure hover state is maintained when mouse is within bounds
        if (!isHovered) {
          setIsHovered(true);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSemesterClick();
      }}
      style={{
        // Ensure the element captures mouse events properly
        pointerEvents: 'auto',
        // Prevent hover from bleeding to adjacent segments
        isolation: 'isolate',
        zIndex: isHovered ? 10 : 1,
      }}
    >
      {/* Course Segment Background with 3D effect */}
      <div
        className={`absolute inset-0 ${bgColor} transition-all duration-300 ${
          isHovered ? `shadow-xl scale-105 ${hoverColor}` : 'shadow-md'
        } border-r border-b border-gray-300/30`}
        style={{
          pointerEvents: 'none',
          boxShadow: isHovered 
            ? '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05) inset'
            : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.3)',
        }}
      >
        {/* Inner highlight for 3D effect */}
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.4) 0%, transparent 50%)',
            pointerEvents: 'none',
          }}
        />
      </div>
      
      {/* Dashed border between semesters */}
      <div 
        className="absolute bottom-0 left-0 right-0 border-b border-dashed border-gray-400/50"
        style={{ pointerEvents: 'none' }}
      />

      {/* Hover Tooltip */}
      {isHovered && (
        <div 
          className="absolute -top-16 left-1/2 transform -translate-x-1/2 z-30 bg-gray-800 text-white rounded shadow-lg pointer-events-none whitespace-nowrap px-3 py-2"
          style={{ minWidth: '120px' }}
        >
          {/* First line: Category - Textbook Version */}
          <div className="text-xs font-medium leading-tight text-center">
            {getSubjectCategoryText(course.subjectCategory, language)}-{course.textbookVersion || '人教版'}
          </div>
          {/* Second line: Weekly Periods */}
          <div className="text-xs text-gray-300 leading-tight mt-1 text-center">
            {weeklyPeriods}/week
          </div>
        </div>
      )}
    </div>
  );
}
