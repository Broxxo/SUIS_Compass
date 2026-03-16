import { useState, useEffect, useRef } from 'react';
import { Course, Semester, CourseColor, SubjectCategory } from '../types';
import AddCourseDialog from './AddCourseDialog';
import SemesterOverviewDialog from './SemesterOverviewDialog';
import SettingsDialog from './SettingsDialog';
import EditCourseDialog from './EditCourseDialog';
import UnitView from './UnitView';
import ConceptView from './ConceptView';
import ConceptSettingsDialog from './ConceptSettingsDialog';
import AppTopBar from './AppTopBar';
import { Settings, Plus, BarChart2, Globe, Bot } from 'lucide-react';
import { Button } from './ui/button';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useAIContext } from '../contexts/AIContext';
import { getSubjectCategoryText, getCategoryCanonicalKey } from '../lib/utils';
import { GRADES, SEMESTERS } from '../lib/constants';
import { loadCourses, saveCourses, hasSemesterUnits, deleteCourse, loadSemesterDataSync, loadSemesterData, loadCategoryOrder, saveCategoryOrder } from '../lib/storage';
import { USE_CLOUD_STORAGE } from '../lib/api';
import { migrateCoursesData, getColorGradient } from '../lib/courseUtils';

// 课程列宽度与列间距
const COLUMN_WIDTH_PX = 56; // 51 + 10%
const COLUMN_GAP_PX = 24;   // 25 - 5%

type ViewMode = 'overview' | 'unit' | 'concept';

interface CurriculumRoadmapProps {
  onBackToHub?: () => void;
  /** 由上层控制 AI 是否打开（用于高亮按钮） */
  isAIOpen?: boolean;
  /** 切换 AI 面板打开/关闭 */
  onToggleAI?: () => void;
}

export default function CurriculumRoadmap({ onBackToHub, isAIOpen, onToggleAI }: CurriculumRoadmapProps) {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const canEditCourses = user?.role === 'system-admin' || user?.role === 'admin';
  const { setContextFromApp } = useAIContext();
  
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
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false); // 课程设置对话框
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);     // 右上角齿轮菜单
  const [isAddCourseDialogOpen, setIsAddCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isEditCourseDialogOpen, setIsEditCourseDialogOpen] = useState(false);
  
  // For focus view, default to G1 Semester 1
  const [focusSemester, setFocusSemester] = useState<Semester>({ grade: 1, semester: 'Semester 1' });
  
  // For concept view, default to null (no semester selected)
  const [conceptSemester, setConceptSemester] = useState<Semester | null>(null);

  // Category order for curriculum roadmap columns (canonical keys = zh). Persisted.
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => loadCategoryOrder());
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [showTotalPeriods, setShowTotalPeriods] = useState(false);
  const [isConceptSettingsDialogOpen, setIsConceptSettingsDialogOpen] = useState(false);
  
  // 用于触发学期数据刷新（更新格子颜色）
  const [semesterDataRefreshKey, setSemesterDataRefreshKey] = useState(0);
  // 刷新完成后递增，用于真正触发“基于缓存”的重新渲染（格子颜色更新）
  const [semesterCacheVersion, setSemesterCacheVersion] = useState(0);
  const isRefreshingSemesterCacheRef = useRef(false);

  // 定期刷新学期数据（用于更新格子颜色）
  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return; // 如果未启用云端存储，不需要刷新
    
    // 每30秒刷新一次学期数据
    const refreshInterval = setInterval(() => {
      setSemesterDataRefreshKey(prev => prev + 1);
    }, 30000); // 30秒

    return () => clearInterval(refreshInterval);
  }, []);

  // 首次进入主界面/页面刷新后：课程加载完成即触发一次刷新（避免必须等30秒）
  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (isLoadingCourses) return;
    // 即使课程为空，也触发一次（用于把格子颜色与云端缓存对齐）
    setSemesterDataRefreshKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingCourses]);

  // 用户“主动回来查看”（切回标签页/窗口获得焦点）时，立即刷新一次
  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    const onFocus = () => setSemesterDataRefreshKey((k) => k + 1);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setSemesterDataRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // 当刷新键变化时，从云端重新加载所有学期的数据（更新本地缓存）
  useEffect(() => {
    if (!USE_CLOUD_STORAGE || semesterDataRefreshKey === 0) return;
    if (isRefreshingSemesterCacheRef.current) return;
    isRefreshingSemesterCacheRef.current = true;

    const refreshSemesterData = async () => {
      try {
        for (const course of courses) {
          for (const grade of GRADES) {
            for (const semester of SEMESTERS) {
              // 仅刷新本地已有缓存的学期，避免对不存在的 (course, grade, semester) 发起请求导致大量 404
              const cached = loadSemesterDataSync(course.id, grade, semester);
              if (!cached) continue;
              try {
                await loadSemesterData(course.id, grade, semester);
              } catch {
                // 静默失败，不影响UI
              }
            }
          }
        }
      } finally {
        isRefreshingSemesterCacheRef.current = false;
        // 缓存更新完成后，触发一次真正的重渲染（让 hasSemesterUnits 读到最新 localStorage）
        setSemesterCacheVersion((v) => v + 1);
      }
    };
    
    refreshSemesterData();
  }, [semesterDataRefreshKey, courses]);

  // Save courses to localStorage or cloud whenever courses change
  // 注意：不要在课程加载期间或课程为空时保存，避免清空已有数据
  useEffect(() => {
    // 只在课程加载完成且有课程数据时才保存
    // 避免导入后刷新时，loadCourses 返回空数组导致清空本地缓存
    if (isLoadingCourses) {
      return; // 正在加载中，不保存
    }
    if (courses.length === 0) {
      return; // 课程为空，不保存（避免清空已有数据）
    }
    
    const saveCoursesData = async () => {
      try {
        await saveCourses(courses);
      } catch (error) {
        console.error('Failed to save courses:', error);
      }
    };
    saveCoursesData();
  }, [courses, isLoadingCourses]);

  // 向全局 AI 上下文上报当前屏幕与 payload（实事求是：有聚焦/概念视图才传）
  useEffect(() => {
    setContextFromApp('curriculum-roadmap', {
      viewMode: viewMode === 'unit' ? 'focus' : 'overview',
      courses,
      focusSemester,
    });
  }, [viewMode, courses, focusSemester, setContextFromApp]);

  // Merge new categories into categoryOrder when courses change.
  useEffect(() => {
    // 如果课程列表为空（比如页面刚加载时），不要清空 categoryOrder
    // 避免导入后刷新时，categoryOrder 被意外清空
    if (courses.length === 0) {
      return;
    }
    
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
  }, [courses, language]);

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

  const handleDeleteCourse = async (courseId: string) => {
    try {
      // 删除课程（包括学期数据和云端课程）
      await deleteCourse(courseId);
      
      // 从courses数组中移除该课程
      setCourses(courses.filter(course => course.id !== courseId));
    } catch (error) {
      console.error('Failed to delete course:', error);
      // 即使云端删除失败，也从本地移除（避免UI不一致）
      setCourses(courses.filter(course => course.id !== courseId));
    }
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

  const topBarTitle = language === 'zh' ? '课程河流' : 'Curriculum Roadmap';

  return (
    <div className="h-screen w-screen bg-white overflow-hidden flex flex-col">
      <AppTopBar
        title={topBarTitle}
        showBack={!!onBackToHub}
        onBack={onBackToHub}
        rightChildren={
          <>
            {canEditCourses && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsAddCourseDialogOpen(true)}
                className="h-9 w-9 rounded-lg flex-shrink-0"
                title={t('course.add')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
            {canEditCourses && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsSettingsMenuOpen((open) => !open)}
                  className="h-9 w-9 rounded-lg flex-shrink-0"
                  title={t('settings.title')}
                >
                  <Settings className="h-4 w-4" />
                </Button>

                {/* Settings dropdown：课时 / 概念 / 课程设置（登出在顶部栏用户菜单） */}
                {isSettingsMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-sm text-slate-800 z-30">
                    {/* 课时显示开关 */}
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors"
                      onClick={() => {
                        setShowTotalPeriods((v) => !v);
                        // 不强制关闭菜单，方便用户连续操作；如需更干净可在此关闭
                      }}
                    >
                      <BarChart2 className="h-4 w-4" />
                      <span>
                        {showTotalPeriods
                          ? (language === 'zh' ? '隐藏总课时' : 'Hide total periods')
                          : (language === 'zh' ? '显示总课时' : 'Show total periods')}
                      </span>
                    </button>

                    {/* 概念设置 */}
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors"
                      onClick={() => {
                        setIsSettingsMenuOpen(false);
                        setIsConceptSettingsDialogOpen(true);
                      }}
                    >
                      <Globe className="h-4 w-4" />
                      <span>{language === 'zh' ? '概念设置' : 'Concept settings'}</span>
                    </button>

                    {/* 课程设置（原齿轮弹窗） */}
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors"
                      onClick={() => {
                        // 打开课程设置对话框，并关闭菜单
                        setIsSettingsMenuOpen(false);
                        setIsSettingsDialogOpen(true);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                      <span>{language === 'zh' ? '课程设置' : 'Course settings'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {onToggleAI && (
              <Button
                variant={isAIOpen ? 'default' : 'outline'}
                size="icon"
                onClick={onToggleAI}
                className="h-9 w-9 rounded-lg flex-shrink-0"
                title="AI"
              >
                <Bot className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />

      {/* 主内容区：留出顶部栏高度 */}
      <div className="flex-1 min-h-0 pt-14">

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

      {/* Course Area：行宽=内容宽(上限95vw)，大屏居中且总课时贴框体；窄屏行=100%中间滚动 */}
      {viewMode === 'overview' ? (
        <div className="h-full w-full pt-2 px-2 sm:px-4 pb-20 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 min-w-0 flex justify-center items-stretch">
          {(() => {
            const categoryEntries = buildSortedCategoryEntries();
            const totalColumnsWidth = categoryEntries.length * COLUMN_WIDTH_PX + Math.max(0, categoryEntries.length - 1) * COLUMN_GAP_PX;
            const labelColWidth = 28;
            const periodsColWidth = showTotalPeriods ? 52 : 0;
            return (
              <div
                className="h-full w-[94vw] sm:w-full max-w-[1200px] mx-auto min-w-0 flex flex-row gap-0 items-stretch overflow-hidden flex-shrink-0"
              >
                  {/* 左侧年级 */}
                  <div className="flex flex-col flex-shrink-0" style={{ width: labelColWidth }}>
                    <div style={{ height: 28, flexShrink: 0 }} />
                    <div className="flex-1 flex flex-col min-h-0">
                      {GRADES.map((grade) => (
                        <div key={grade} className="flex-1 flex items-center justify-center min-h-0">
                          <span className="text-base font-semibold text-gray-700">G{grade}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* 中间课程网格：外层仅负责横向滚动，真正的“框体”由内部容器绘制边框，标签在框体上方 */}
                  <div className="curriculum-roadmap-scroll-x flex-1 min-w-0 h-full overflow-x-auto overflow-y-hidden pr-0 min-h-0">
                    <div
                      className="flex flex-col flex-shrink-0 h-full"
                      style={{ width: `max(100%, ${totalColumnsWidth}px)` }}
                    >
                  {/* Course Names at Top - Parallelogram labels, draggable；与下方课程框体紧贴，无缝衔接 */}
                  <div
                    className="flex flex-shrink-0"
                    style={{ height: 28, gap: COLUMN_GAP_PX }}
                  >
                    {categoryEntries.map(({ canonicalKey, displayKey, courses: categoryCourses }) => {
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
                  style={{ width: COLUMN_WIDTH_PX, height: 28 }}
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

                  {/* Course Box - 实际课程框体：有边框与背景，标签位于其上方 */}
                  <div className="relative flex-1 min-h-0 border-2 border-gray-300 rounded-lg bg-gradient-to-b from-gray-50 to-gray-100">
                    <div className="absolute inset-0 pointer-events-none">
                      {GRADES.slice(0, -1).map((grade) => (
                        <div
                          key={grade}
                          className="absolute left-0 right-0 border-b border-dashed border-gray-300/40"
                          style={{ top: `${(grade / GRADES.length) * 100}%` }}
                        />
                      ))}
                    </div>
                    <div className="h-full flex overflow-y-hidden" style={{ gap: COLUMN_GAP_PX }}>
                      {categoryEntries.map(({ canonicalKey, displayKey, courses: categoryCourses }) => (
                        <CategoryColumn
                          key={canonicalKey}
                          category={displayKey}
                          courses={categoryCourses}
                          onSemesterClick={handleSemesterClick}
                          getSemesterLabel={getSemesterLabel}
                          refreshKey={semesterCacheVersion}
                          columnWidthPx={COLUMN_WIDTH_PX}
                        />
                      ))}
                    </div>
                  </div>
                    </div>
                  </div>
                  {/* 右侧总课时数：紧贴框体右侧，不参与横向滚动 */}
                  {showTotalPeriods && (
                    <div
                      className="flex flex-col flex-shrink-0 pointer-events-none items-center justify-start pl-0"
                      style={{ width: periodsColWidth }}
                    >
                      <div style={{ height: 28, flexShrink: 0 }} />
                      <div className="flex-1 flex flex-col min-h-0">
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
                          return (
                            <div key={grade} className="flex-1 flex items-center justify-start min-h-0 pl-0">
                              <span className="text-xl text-gray-700">{totalWeeklyPeriods}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>
            );
          })()}
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

      </div>

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
  refreshKey: number; // 用于触发重新渲染，更新格子颜色
  columnWidthPx: number;
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

function CategoryColumn({ category: _category, courses, onSemesterClick, getSemesterLabel, refreshKey, columnWidthPx }: CategoryColumnProps) {
  // 使用第一个课程的颜色作为该列的颜色
  const defaultCourse = courses[0];
  
  return (
    <div className="flex-shrink-0 relative" style={{ width: columnWidthPx }}>
      {/* Curriculum Roadmap */}
      <div className="h-full flex flex-col">
        {GRADES.map((grade) => {
          // 找到覆盖该年级的课程
          const course = findCourseForGrade(courses, grade);
          const isApplicable = course !== null;
          
          return (
            <div key={grade} className="flex-1 flex flex-col">
              {SEMESTERS.map((semester) => {
                if (course) {
                  // 使用refreshKey确保在数据刷新后重新计算
                  const hasUnits = hasSemesterUnits(course.id, grade, semester);
                  return (
                    <SemesterSegment
                      key={`${course.id}-${grade}-${semester}-${refreshKey}`}
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
