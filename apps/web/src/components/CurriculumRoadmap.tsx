import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  assignCourseToDomain,
  buildRoadmapLayoutSegments,
  countRoadmapLayoutColumns,
  getCourseCellHex,
  getCourseDomainLabel,
  removeCourseFromDomains,
  type CourseDomainsConfig,
  type RoadmapLayoutSegment,
} from '@repo/shared';
import { Course, CourseColor, GradeConfig, Semester, SubjectCategory } from '../types';
import AddCourseDialog from './AddCourseDialog';
import SemesterOverviewDialog from './SemesterOverviewDialog';
import SettingsDialog from './SettingsDialog';
import EditCourseDialog from './EditCourseDialog';
import UnitView from './UnitView';
import ConceptView from './ConceptView';
import ConceptSettingsDialog from './ConceptSettingsDialog';
import AppTopBar from './AppTopBar';
import { Settings, Plus, Bot, Download, Upload, SlidersHorizontal, BarChart2, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { SegmentTabButton, SegmentTabGroup, SegmentTabStrip } from './ui/segment-tab-button';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useAIContext } from '../contexts/AIContext';
import { getSubjectCategoryText, getCategoryCanonicalKey } from '../lib/utils';
import type { TranslationKey } from '../locales/translations';
import { DEFAULT_GRADE_CONFIG, SEMESTERS } from '../lib/constants';
import {
  loadCourses,
  saveCourses,
  hasSemesterUnits,
  deleteCourse,
  loadCategoryOrder,
  loadCourseDomainsSync,
  saveCategoryOrder,
  saveCourseDomains,
  hydrateCourseDomainsFromCloud,
  hydrateCategoryOrderFromCloud,
  hydrateSemesterCacheFromCloud,
  exportAllData,
  importAllData,
  loadGradeConfig,
} from '../lib/storage';
import { logError } from '../lib/errorHandler';
import { USE_CLOUD_STORAGE } from '../lib/api';
import { migrateCoursesData, getCourseTagChrome } from '../lib/courseUtils';
import {
  courseAppliesToGrade,
  courseVisibleInRoadmapTab,
  getWeeklyPeriodsForGrade,
} from '../lib/courseGradeUtils';
import {
  getGradeLabelByLevel,
  getRoadmapSegmentsInDisplayOrder,
  getRoadmapVisibleGradeLevels,
  normalizeGradeConfig,
  ROADMAP_OVERVIEW_TAB_ALL,
} from '../lib/gradeConfig';

// 课程列宽度与列间距（自适应上下限）
const COLUMN_WIDTH_DEFAULT_PX = 56;
const COLUMN_GAP_DEFAULT_PX = 24;
const COLUMN_WIDTH_MIN_PX = 42;
const COLUMN_GAP_MIN_PX = 6;
/** 左侧年级标签列宽（复合名如 G9国际）；右对齐贴近课程区，右侧留少量空隙 */
const GRADE_LABEL_COL_WIDTH_PX = 84;
/** Hub 整体视图：年级列更窄，把横向空间留给课程网格 */
const GRADE_LABEL_COL_WIDTH_HUB_PX = 68;
/** 同一课程领域内各课程列之间的间距（紧密排列） */
const ROADMAP_DOMAIN_INNER_GAP_PX = 2;

function roadmapDomainInnerGapTotal(segments: readonly RoadmapLayoutSegment[]): number {
  return segments.reduce(
    (sum, s) => (s.kind === 'domain' ? sum + Math.max(0, s.columns.length - 1) * ROADMAP_DOMAIN_INNER_GAP_PX : sum),
    0,
  );
}

function roadmapLayoutTotalWidth(
  segments: readonly RoadmapLayoutSegment[],
  columnWidthPx: number,
  segmentGapPx: number,
): number {
  let total = roadmapDomainInnerGapTotal(segments);
  segments.forEach((seg, idx) => {
    if (idx > 0) total += segmentGapPx;
    if (seg.kind === 'domain') {
      total += seg.columns.length * columnWidthPx;
    } else {
      total += columnWidthPx;
    }
  });
  return total;
}

/** 按当前可用宽度分配列宽与段间距，使整体视图无需横向滚动且铺满容器 */
function computeAdaptiveRoadmapLayout(
  segments: readonly RoadmapLayoutSegment[],
  availableWidthPx: number,
): { columnWidthPx: number; segmentGapPx: number } {
  const columnCount = countRoadmapLayoutColumns(segments);
  const segmentGapCount = Math.max(0, segments.length - 1);

  if (columnCount <= 0 || !Number.isFinite(availableWidthPx) || availableWidthPx <= 0) {
    return { columnWidthPx: COLUMN_WIDTH_DEFAULT_PX, segmentGapPx: COLUMN_GAP_DEFAULT_PX };
  }

  const innerGapTotal = roadmapDomainInnerGapTotal(segments);
  const flexBudget = availableWidthPx - innerGapTotal;
  if (flexBudget <= 0) {
    return { columnWidthPx: COLUMN_WIDTH_MIN_PX, segmentGapPx: 0 };
  }

  let segmentGapPx = segmentGapCount > 0 ? COLUMN_GAP_MIN_PX : 0;
  let columnWidthPx = (flexBudget - segmentGapCount * segmentGapPx) / columnCount;

  if (columnWidthPx < COLUMN_WIDTH_MIN_PX) {
    segmentGapPx = 0;
    columnWidthPx = flexBudget / columnCount;
  }

  const ABSOLUTE_MIN_COL_PX = 22;
  columnWidthPx = Math.max(ABSOLUTE_MIN_COL_PX, columnWidthPx);

  let total = roadmapLayoutTotalWidth(segments, columnWidthPx, segmentGapPx);
  if (total > availableWidthPx + 0.5) {
    const scale = availableWidthPx / total;
    columnWidthPx *= scale;
    segmentGapPx *= scale;
  } else if (total < availableWidthPx - 0.5) {
    columnWidthPx += (availableWidthPx - total) / columnCount;
  }

  return {
    columnWidthPx: Math.round(columnWidthPx * 100) / 100,
    segmentGapPx: Math.round(segmentGapPx * 100) / 100,
  };
}

type ViewMode = 'overview' | 'unit' | 'concept';

function RoadmapViewTabStrip({
  gradeConfig,
  viewMode,
  setViewMode,
  overviewStageTabId,
  setOverviewStageTabId,
  t,
}: {
  gradeConfig: GradeConfig;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  overviewStageTabId: string;
  setOverviewStageTabId: (id: string) => void;
  t: (key: TranslationKey) => string;
}) {
  const segments = getRoadmapSegmentsInDisplayOrder(gradeConfig);

  return (
    <SegmentTabStrip className="justify-center max-w-full" aria-label={t('view.roadmapNavAria')}>
      <SegmentTabGroup>
        {segments.map((seg) => {
          const active = viewMode === 'overview' && overviewStageTabId === seg.id;
          return (
            <SegmentTabButton
              key={seg.id}
              grouped
              active={active}
              onClick={() => {
                setViewMode('overview');
                setOverviewStageTabId(seg.id);
              }}
            >
              {seg.label}
            </SegmentTabButton>
          );
        })}
        <SegmentTabButton
          grouped
          active={viewMode === 'overview' && overviewStageTabId === ROADMAP_OVERVIEW_TAB_ALL}
          onClick={() => {
            setViewMode('overview');
            setOverviewStageTabId(ROADMAP_OVERVIEW_TAB_ALL);
          }}
        >
          {t('view.overview')}
        </SegmentTabButton>
      </SegmentTabGroup>
      <SegmentTabGroup>
        <SegmentTabButton grouped active={viewMode === 'unit'} onClick={() => setViewMode('unit')}>
          {t('view.unit')}
        </SegmentTabButton>
      </SegmentTabGroup>
      <SegmentTabGroup>
        <SegmentTabButton grouped active={viewMode === 'concept'} onClick={() => setViewMode('concept')}>
          {t('view.concept')}
        </SegmentTabButton>
      </SegmentTabGroup>
    </SegmentTabStrip>
  );
}

interface CurriculumRoadmapProps {
  onBackToHub?: () => void;
  /** 由上层控制 AI 是否打开（用于高亮按钮） */
  isAIOpen?: boolean;
  /** 切换 AI 面板打开/关闭 */
  onToggleAI?: () => void;
  /**
   * hub：全校只读看板（所有人不能改课程/单元/概念框架）。
   * admin-course-management：后台「课程管理」；仅 system-admin 可改课程与概念框架，admin 可改单元。
   */
  surface?: 'hub' | 'admin-course-management';
  /** 嵌在后台内时使用，避免占满视口 */
  embedded?: boolean;
}

export default function CurriculumRoadmap({
  onBackToHub,
  isAIOpen,
  onToggleAI,
  surface = 'hub',
  embedded = false,
}: CurriculumRoadmapProps) {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const isAdminSurface = surface === 'admin-course-management';
  const showRoadmapTopBar = !embedded;
  const canEditFramework = surface === 'admin-course-management' && user?.role === 'system-admin';
  const canEditUnits = surface === 'admin-course-management'
    && (user?.role === 'system-admin' || user?.role === 'admin');
  /** 与数据库学科顺序一致：仅管理员与系统管理员可在「课程设置」中调序并保存 */
  const canReorderCategories =
    isAdminSurface && (user?.role === 'system-admin' || user?.role === 'admin');
  const { setContextFromApp } = useAIContext();
  
  // Load courses from localStorage or cloud on mount
  const [courses, setCourses] = useState<Course[]>([]);
  const [gradeConfig, setGradeConfig] = useState<GradeConfig>(DEFAULT_GRADE_CONFIG);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const gradeItems = gradeConfig.items;
  const gradeLevels = gradeItems.map((item) => item.level);

  // Load courses on mount
  useEffect(() => {
    const loadCoursesData = async () => {
      setIsLoadingCourses(true);
      try {
        const [loadedCourses, loadedGradeConfig] = await Promise.all([
          loadCourses(),
          loadGradeConfig(),
          USE_CLOUD_STORAGE
            ? hydrateSemesterCacheFromCloud().catch((err) => {
                logError('Failed to hydrate semester cache on first load', err);
                return 0;
              })
            : Promise.resolve(0),
        ]);
        setCourses(migrateCoursesData(loadedCourses));
        setGradeConfig(normalizeGradeConfig(loadedGradeConfig));
      } catch (error) {
        console.error('Failed to load courses:', error);
        // Fallback to empty array
        setCourses([]);
        setGradeConfig(DEFAULT_GRADE_CONFIG);
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
  const [focusSemester, setFocusSemester] = useState<Semester>({ grade: gradeLevels[0] ?? 1, semester: 'Semester 1' });
  
  // For concept view, default to null (no semester selected)
  const [conceptSemester, setConceptSemester] = useState<Semester | null>(null);
  /** 整体视图学段筛选：ROADMAP_OVERVIEW_TAB_ALL 为全校；有学段时默认优先最低年段学段 */
  const [overviewStageTabId, setOverviewStageTabId] = useState<string>(ROADMAP_OVERVIEW_TAB_ALL);
  const overviewSegmentDefaultAppliedRef = useRef(false);

  useEffect(() => {
    if (gradeLevels.length === 0) return;
    setFocusSemester((prev) =>
      gradeLevels.includes(prev.grade) ? prev : { ...prev, grade: gradeLevels[0] },
    );
    setConceptSemester((prev) => {
      if (!prev) return prev;
      return gradeLevels.includes(prev.grade) ? prev : { ...prev, grade: gradeLevels[0] };
    });
    setSelectedSemester((prev) => {
      if (!prev) return prev;
      return gradeLevels.includes(prev.grade) ? prev : { ...prev, grade: gradeLevels[0] };
    });
  }, [gradeLevels]);

  useEffect(() => {
    const norm = normalizeGradeConfig(gradeConfig);
    const ordered = getRoadmapSegmentsInDisplayOrder(gradeConfig);
    if (!norm.segments?.length || ordered.length === 0) {
      overviewSegmentDefaultAppliedRef.current = false;
      setOverviewStageTabId(ROADMAP_OVERVIEW_TAB_ALL);
      return;
    }
    setOverviewStageTabId((prev) => {
      if (!overviewSegmentDefaultAppliedRef.current) {
        overviewSegmentDefaultAppliedRef.current = true;
        return ordered[0].id;
      }
      if (prev === ROADMAP_OVERVIEW_TAB_ALL || norm.segments!.some((s) => s.id === prev)) {
        return prev;
      }
      return ordered[0].id;
    });
  }, [gradeConfig]);

  // Category order（云端：先空再 hydrate；本地：读缓存）
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() =>
    USE_CLOUD_STORAGE ? [] : loadCategoryOrder(),
  );
  const [courseDomains, setCourseDomains] = useState<CourseDomainsConfig>(() =>
    USE_CLOUD_STORAGE ? { domains: [], domainOrder: [] } : loadCourseDomainsSync(),
  );
  /** 与 useEffect 持久化学科顺序配合：手动「保存顺序」先写入此 ref，避免已 await save 后再被 effect 打一次重复 PUT */
  const prevPersistedCategoryOrderRef = useRef<string[]>([]);
  const [showTotalPeriods, setShowTotalPeriods] = useState(false);
  const [isConceptSettingsDialogOpen, setIsConceptSettingsDialogOpen] = useState(false);

  // 用于触发学期数据刷新（更新格子颜色）
  const [semesterDataRefreshKey, setSemesterDataRefreshKey] = useState(0);
  // 刷新完成后递增，用于真正触发“基于缓存”的重新渲染（格子颜色更新）
  const [semesterCacheVersion, setSemesterCacheVersion] = useState(0);
  const bumpSemesterCache = useCallback(() => {
    setSemesterCacheVersion((v) => v + 1);
  }, []);
  const isRefreshingSemesterCacheRef = useRef(false);
  const courseDataImportInputRef = useRef<HTMLInputElement>(null);
  const [isImportingCourseData, setIsImportingCourseData] = useState(false);
  const [isExportingCourseData, setIsExportingCourseData] = useState(false);
  const overviewRowRef = useRef<HTMLDivElement>(null);
  const [overviewRowWidthPx, setOverviewRowWidthPx] = useState(0);

  useLayoutEffect(() => {
    const el = overviewRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setOverviewRowWidthPx(el.clientWidth);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, overviewStageTabId, courses.length, showTotalPeriods]);

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
  // 学期格子占用已在首次 load 中通过 hydrateSemesterCacheFromCloud 写入；此处仅兜底（例如登录后晚于首屏）
  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (isLoadingCourses) return;
    setSemesterDataRefreshKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingCourses]);

  // 用户“主动回来查看”时刷新学期缓存，并重新拉取云端学科列顺序
  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    const onFocus = () => setSemesterDataRefreshKey((k) => k + 1);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setSemesterDataRefreshKey((k) => k + 1);
        void hydrateCategoryOrderFromCloud().then((order) => {
          setCategoryOrder((prev) => (order.length > 0 ? order : prev));
        });
        void hydrateCourseDomainsFromCloud().then((config) => {
          setCourseDomains((prev) =>
            config.domains.length > 0 || config.domainOrder.length > 0 ? config : prev,
          );
        });
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // 云端：首次挂载拉取全校共享的学科列顺序（与岗位安排等共用）
  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    let cancelled = false;
    hydrateCategoryOrderFromCloud().then((order) => {
      if (cancelled) return;
      setCategoryOrder((prev) => {
        if (order.length > 0) return order;
        return prev;
      });
    });
    hydrateCourseDomainsFromCloud().then((config) => {
      if (cancelled) return;
      setCourseDomains((prev) =>
        config.domains.length > 0 || config.domainOrder.length > 0 ? config : prev,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 当刷新键变化时，从云端重新加载所有学期的数据（更新本地缓存）
  useEffect(() => {
    if (!USE_CLOUD_STORAGE || semesterDataRefreshKey === 0) return;
    if (isRefreshingSemesterCacheRef.current) return;
    isRefreshingSemesterCacheRef.current = true;

    const refreshSemesterData = async () => {
      try {
        await hydrateSemesterCacheFromCloud();
      } catch {
        // 静默失败，不影响UI
      } finally {
        isRefreshingSemesterCacheRef.current = false;
        // 缓存更新完成后，触发一次真正的重渲染（让 hasSemesterUnits 读到最新 localStorage）
        setSemesterCacheVersion((v) => v + 1);
      }
    };
    
    refreshSemesterData();
  }, [semesterDataRefreshKey]);

  // Save courses to localStorage or cloud whenever courses change
  // 注意：不要在课程加载期间或课程为空时保存，避免清空已有数据
  useEffect(() => {
    if (!canEditFramework) return;
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
  }, [courses, isLoadingCourses, canEditFramework]);

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

  // 学科列顺序：合并新课程 / 手动保存 后统一在此写本地 + 云端（与岗位安排共用）
  useEffect(() => {
    if (!canReorderCategories) return;
    if (categoryOrder.length === 0) return;
    if (
      prevPersistedCategoryOrderRef.current.length === categoryOrder.length &&
      prevPersistedCategoryOrderRef.current.every((k, i) => k === categoryOrder[i])
    ) {
      return;
    }
    prevPersistedCategoryOrderRef.current = [...categoryOrder];
    void saveCategoryOrder(categoryOrder).catch((err) => {
      console.error('Failed to persist category order:', err);
    });
  }, [categoryOrder, canReorderCategories]);

  const handleAddCourse = (
    courseName: string,
    subjectCategory: SubjectCategory,
    applicableGrades: string[],
    weeklyPeriodsByGrade: Record<string, number>,
    textbookVersion: string,
    color: Course['color'],
    coTeaching: boolean,
    excludeFromStaffing: boolean,
    domainId: string | null,
  ) => {
    const newCourse: Course = {
      id: `course-${Date.now()}`,
      name: courseName,
      subjectCategory: subjectCategory,
      applicableGrades,
      weeklyPeriodsByGrade,
      textbookVersion: textbookVersion || '人教版',
      color: color,
      coTeaching: excludeFromStaffing ? false : Boolean(coTeaching),
      excludeFromStaffing: Boolean(excludeFromStaffing),
    };
    setCourses([...courses, newCourse]);
    if (domainId) {
      const next = assignCourseToDomain(courseDomains, newCourse.id, domainId);
      setCourseDomains(next);
      void saveCourseDomains(next).catch((err) => console.error('Failed to save course domains:', err));
    }
    setIsAddCourseDialogOpen(false);
  };

  const handleUpdateCourse = (
    courseId: string,
    updates: {
      name?: string;
      subjectCategory?: SubjectCategory | string;
      applicableGrades?: string[];
      weeklyPeriodsByGrade?: Record<string, number>;
      textbookVersion?: string;
      color?: CourseColor;
      coTeaching?: boolean;
      excludeFromStaffing?: boolean;
    },
  ) => {
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
      const nextDomains = removeCourseFromDomains(courseDomains, courseId);
      setCourseDomains(nextDomains);
      void saveCourseDomains(nextDomains).catch((err) => console.error('Failed to save course domains:', err));
    } catch (error) {
      console.error('Failed to delete course:', error);
      // 即使云端删除失败，也从本地移除（避免UI不一致）
      setCourses(courses.filter(course => course.id !== courseId));
      const nextDomains = removeCourseFromDomains(courseDomains, courseId);
      setCourseDomains(nextDomains);
      void saveCourseDomains(nextDomains).catch((err) => console.error('Failed to save course domains:', err));
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

  const handleSaveEditedCourse = (
    courseId: string,
    updates: {
      name: string;
      subjectCategory: SubjectCategory;
      applicableGrades: string[];
      weeklyPeriodsByGrade: Record<string, number>;
      textbookVersion?: string;
      color: CourseColor;
      coTeaching: boolean;
      excludeFromStaffing: boolean;
      domainId: string | null;
    },
  ) => {
    const { domainId, ...courseUpdates } = updates;
    handleUpdateCourse(courseId, courseUpdates);
    const nextDomains = assignCourseToDomain(courseDomains, courseId, domainId);
    setCourseDomains(nextDomains);
    void saveCourseDomains(nextDomains).catch((err) => console.error('Failed to save course domains:', err));
    setIsEditCourseDialogOpen(false);
    setEditingCourse(null);
  };

  const handleExportCourseData = async () => {
    setIsExportingCourseData(true);
    try {
      const data = await exportAllData();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `curriculum-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const sourceHint =
        data.source === 'database'
          ? language === 'zh'
            ? '（已从数据库导出全量数据）'
            : ' (full export from database)'
          : '';
      alert(
        language === 'zh'
          ? `数据导出成功！${sourceHint}`
          : `Data exported successfully!${sourceHint}`,
      );
    } catch (error) {
      logError('Export failed', error);
      alert(
        language === 'zh'
          ? '数据导出失败，请检查网络连接后重试。'
          : 'Export failed. Please check your connection and try again.',
      );
    } finally {
      setIsExportingCourseData(false);
    }
  };

  const handleImportCourseDataClick = () => {
    courseDataImportInputRef.current?.click();
  };

  const handleCourseDataFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingCourseData(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const confirmMsg =
        USE_CLOUD_STORAGE && language === 'zh'
          ? '导入数据将覆盖数据库中的全校课程数据（课程、单元、概念等），确定要继续吗？'
          : USE_CLOUD_STORAGE
            ? 'Importing will overwrite all school-wide course data in the database (courses, units, concepts, etc.). Continue?'
            : language === 'zh'
              ? '导入数据将覆盖当前全校课程数据（课程、单元、概念等），确定要继续吗？'
              : 'Importing will overwrite all school-wide course data (courses, units, concepts, etc.). Continue?';

      if (window.confirm(confirmMsg)) {
        const result = await importAllData(data);
        if (result.success) {
          alert(
            language === 'zh'
              ? '数据导入成功！页面将刷新以应用更改。'
              : 'Data imported successfully! The page will refresh to apply changes.',
          );
          window.location.reload();
        } else {
          alert(
            language === 'zh'
              ? `数据导入失败：${result.error || '未知错误'}`
              : `Import failed: ${result.error || 'Unknown error'}`,
          );
        }
      }
    } catch (error) {
      logError('Import failed', error);
      alert(
        language === 'zh'
          ? '文件格式错误，请确保选择的是有效的JSON文件。'
          : 'Invalid file format. Please ensure you selected a valid JSON file.',
      );
    } finally {
      setIsImportingCourseData(false);
      if (courseDataImportInputRef.current) {
        courseDataImportInputRef.current.value = '';
      }
    }
  };

  const totalPeriodsToggleTitle = showTotalPeriods ? t('view.hidePeriods') : t('view.showPeriods');

  type CategoryEntry = { canonicalKey: string; displayKey: string; courses: Course[] };
  const buildSortedCategoryEntries = (sourceCourses: Course[]): CategoryEntry[] => {
    const grouped: Record<string, { displayKey: string; courses: Course[] }> = {};
    sourceCourses.forEach((c) => {
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

  const settingsColumnOrderItems = buildSortedCategoryEntries(courses).map(({ canonicalKey, displayKey }) => ({
    canonicalKey,
    displayKey,
  }));

  const topBarTitle = surface === 'admin-course-management'
    ? (language === 'zh' ? '课程管理' : 'Course management')
    : (language === 'zh' ? '课程河流' : 'Curriculum Roadmap');

  const showRoadmapTabToolbar = showRoadmapTopBar || (embedded && isAdminSurface);

  const adminToolbarActions = canEditFramework ? (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsAddCourseDialogOpen(true)}
        className="h-9 w-9 rounded-lg flex-shrink-0"
        title={t('course.add')}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsSettingsDialogOpen(true)}
        className="h-9 w-9 rounded-lg flex-shrink-0"
        title={language === 'zh' ? '课程设置' : 'Course settings'}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </Button>
      <div className="relative z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsSettingsMenuOpen((open) => !open)}
          className="h-9 w-9 rounded-lg flex-shrink-0"
          title={t('settings.title')}
        >
          <Settings className="h-4 w-4" />
        </Button>
        {isSettingsMenuOpen && (
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg">
            <button
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors"
              onClick={() => {
                setIsSettingsMenuOpen(false);
                setShowTotalPeriods((v) => !v);
              }}
            >
              <BarChart2 className="h-4 w-4" />
              <span>{totalPeriodsToggleTitle}</span>
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors"
              onClick={() => {
                setIsSettingsMenuOpen(false);
                setIsConceptSettingsDialogOpen(true);
              }}
            >
              <Globe className="h-4 w-4" />
              <span>{language === 'zh' ? '概念设置' : 'Concept settings'}</span>
            </button>
            <button
              type="button"
              disabled={isExportingCourseData}
              className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title={t('settings.exportCourseDataTitle')}
              onClick={() => {
                setIsSettingsMenuOpen(false);
                void handleExportCourseData();
              }}
            >
              <Download className="h-4 w-4" />
              <span>{t('settings.exportCourseData')}</span>
            </button>
            <button
              type="button"
              disabled={isImportingCourseData}
              className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title={t('settings.importCourseDataTitle')}
              onClick={() => {
                setIsSettingsMenuOpen(false);
                handleImportCourseDataClick();
              }}
            >
              <Upload className="h-4 w-4" />
              <span>{t('settings.importCourseData')}</span>
            </button>
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <div
      className={
        embedded
          ? 'flex-1 min-h-0 w-full bg-white overflow-hidden flex flex-col'
          : 'h-screen w-screen bg-white overflow-hidden flex flex-col'
      }
    >
      {showRoadmapTopBar && (
        <AppTopBar
          title={topBarTitle}
          showBack={!!onBackToHub}
          onBack={onBackToHub}
          rightChildren={
            onToggleAI ? (
              <Button
                variant={isAIOpen ? 'default' : 'outline'}
                size="icon"
                onClick={onToggleAI}
                className="h-9 w-9 rounded-lg flex-shrink-0"
                title="AI"
              >
                <Bot className="h-4 w-4" />
              </Button>
            ) : undefined
          }
        />
      )}

      {showRoadmapTabToolbar && (
        <div
          className={`relative z-40 flex-shrink-0 overflow-visible border-b border-slate-200 bg-white px-3 sm:px-4 py-2 ${
            showRoadmapTopBar ? 'mt-14' : ''
          }`}
        >
          <div className="relative flex min-h-[40px] items-center justify-center overflow-visible">
            <div className="min-w-0 max-w-full overflow-x-auto no-scrollbar">
              <RoadmapViewTabStrip
                gradeConfig={gradeConfig}
                viewMode={viewMode}
                setViewMode={setViewMode}
                overviewStageTabId={overviewStageTabId}
                setOverviewStageTabId={setOverviewStageTabId}
                t={t}
              />
            </div>
            {isAdminSurface ? (
              <div className="absolute right-0 top-1/2 flex -translate-y-1/2 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                {adminToolbarActions}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div className={`relative flex-1 min-h-0 overflow-hidden ${showRoadmapTopBar ? '' : 'pt-2'}`}>

      {/* Course Area：Hub 贴左铺满可用宽度；后台课程管理保持略宽边距 */}
      {viewMode === 'overview' ? (
        <div
          className={`h-full w-full pt-2 flex flex-col min-w-0 ${
            isAdminSurface ? 'px-2 sm:px-4 pb-3' : 'pl-1 pr-2 sm:pl-2 sm:pr-3 pb-14'
          }`}
        >
          <div className="flex-1 min-h-0 min-w-0 flex items-stretch">
          {(() => {
            const visibleGradeLevels = getRoadmapVisibleGradeLevels(gradeConfig, overviewStageTabId);
            const tabFilteredCourses = courses.filter((c) =>
              courseVisibleInRoadmapTab(c, visibleGradeLevels, gradeConfig),
            );
            const layoutSegments = buildRoadmapLayoutSegments(
              tabFilteredCourses,
              categoryOrder,
              courseDomains,
              language,
            );
            const labelColWidth = isAdminSurface ? GRADE_LABEL_COL_WIDTH_PX : GRADE_LABEL_COL_WIDTH_HUB_PX;
            const periodsColWidth = showTotalPeriods ? 52 : 0;
            const availableCourseWidth = Math.max(0, overviewRowWidthPx - labelColWidth - periodsColWidth);
            const adaptive =
              overviewRowWidthPx > 0
                ? computeAdaptiveRoadmapLayout(layoutSegments, availableCourseWidth)
                : { columnWidthPx: COLUMN_WIDTH_DEFAULT_PX, segmentGapPx: COLUMN_GAP_DEFAULT_PX };
            const segmentWidth = (seg: RoadmapLayoutSegment) =>
              seg.kind === 'domain'
                ? seg.columns.length * adaptive.columnWidthPx +
                  Math.max(0, seg.columns.length - 1) * ROADMAP_DOMAIN_INNER_GAP_PX
                : adaptive.columnWidthPx;
            const denseGrades = visibleGradeLevels.length > 9;
            const headerHeight = denseGrades ? 24 : 28;
            const hasDomainSegments = layoutSegments.some((s) => s.kind === 'domain');
            const domainLabelRow = hasDomainSegments ? 14 : 0;
            const totalHeaderHeight = headerHeight + domainLabelRow;
            return (
              <div
                ref={overviewRowRef}
                className="h-full w-full max-w-none min-w-0 flex flex-row gap-0 items-stretch overflow-hidden flex-shrink-0"
              >
                  {/* 左侧年级 */}
                  <div className="flex flex-col flex-shrink-0 pr-1" style={{ width: labelColWidth }}>
                    <div style={{ height: totalHeaderHeight, flexShrink: 0 }} />
                    <div className="flex-1 flex flex-col min-h-0">
                      {visibleGradeLevels.map((grade) => (
                        <div key={grade} className="flex-1 flex items-center justify-end min-h-0 pr-0.5">
                          <span
                            className={`${denseGrades ? 'text-sm' : 'text-base'} font-semibold text-gray-700 text-right leading-tight break-words max-w-full`}
                          >
                            {getGradeLabelByLevel(gradeConfig, grade)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* 中间课程网格：列宽自适应铺满，无需横向滚动 */}
                  <div className="flex-1 min-w-0 h-full overflow-x-hidden overflow-y-hidden pr-0 min-h-0">
                    <div className="flex flex-col w-full h-full min-w-0">
                  {/* Course Names at Top - 领域簇 + 学科列（顺序在设置中调整） */}
                  <div className="flex flex-shrink-0 items-end" style={{ height: totalHeaderHeight }}>
                    {layoutSegments.map((segment, segIdx) => {
                      const marginLeft = segIdx > 0 ? adaptive.segmentGapPx : 0;
                      if (segment.kind === 'domain') {
                        const domainLabel = getCourseDomainLabel(segment.label, language);
                        return (
                          <div
                            key={segment.domainId}
                            className="flex shrink-0 flex-col items-stretch"
                            style={{ marginLeft, width: segmentWidth(segment) }}
                          >
                            {domainLabelRow > 0 && (
                              <div
                                className="text-[10px] font-medium text-slate-500 text-center truncate px-0.5 leading-tight"
                                style={{ height: domainLabelRow }}
                                title={domainLabel}
                              >
                                {domainLabel}
                              </div>
                            )}
                            <div
                              className="flex items-end rounded-t-md border border-b-0 border-slate-200/90 bg-slate-50/50 px-0.5 pt-0.5"
                              style={{ gap: ROADMAP_DOMAIN_INNER_GAP_PX, height: headerHeight }}
                            >
                              {segment.columns.map((col) => (
                                <RoadmapParallelogramHeader
                                  key={col.displayKey}
                                  course={col.courses[0]}
                                  displayKey={col.displayKey}
                                  columnWidthPx={adaptive.columnWidthPx}
                                  headerHeight={headerHeight}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      }
                      const course = segment.courses[0];
                      return (
                        <div key={segment.canonicalKey} className="shrink-0" style={{ marginLeft }}>
                          <RoadmapParallelogramHeader
                            course={course}
                            displayKey={segment.displayKey}
                            columnWidthPx={adaptive.columnWidthPx}
                            headerHeight={headerHeight}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Course Box - 实际课程框体 */}
                  <div className="relative flex-1 min-h-0 border-2 border-gray-300 rounded-lg bg-gradient-to-b from-gray-50 to-gray-100">
                    <div className="absolute inset-0 pointer-events-none">
                      {visibleGradeLevels.slice(0, -1).map((grade, idx) => (
                        <div
                          key={`${grade}-${idx}`}
                          className="absolute left-0 right-0 border-b border-dashed border-gray-300/40"
                          style={{ top: `${((idx + 1) / visibleGradeLevels.length) * 100}%` }}
                        />
                      ))}
                    </div>
                    <div className="h-full flex overflow-y-hidden items-stretch">
                      {layoutSegments.map((segment, segIdx) => {
                        const marginLeft = segIdx > 0 ? adaptive.segmentGapPx : 0;
                        if (segment.kind === 'domain') {
                          return (
                            <div
                              key={segment.domainId}
                              className="flex shrink-0 h-full rounded-b-md border border-t-0 border-slate-200/90 bg-white/30"
                              style={{
                                marginLeft,
                                gap: ROADMAP_DOMAIN_INNER_GAP_PX,
                                width: segmentWidth(segment),
                              }}
                            >
                              {segment.columns.map((col) => (
                                <CategoryColumn
                                  key={col.displayKey}
                                  category={col.displayKey}
                                  courses={col.courses}
                                  onSemesterClick={handleSemesterClick}
                                  getSemesterLabel={getSemesterLabel}
                                  refreshKey={semesterCacheVersion}
                                  columnWidthPx={adaptive.columnWidthPx}
                                  showCellPeriods={showTotalPeriods}
                                  gradeLevels={visibleGradeLevels}
                                  gradeConfig={gradeConfig}
                                />
                              ))}
                            </div>
                          );
                        }
                        return (
                          <div key={segment.canonicalKey} className="shrink-0 h-full" style={{ marginLeft }}>
                            <CategoryColumn
                              category={segment.displayKey}
                              courses={segment.courses}
                              onSemesterClick={handleSemesterClick}
                              getSemesterLabel={getSemesterLabel}
                              refreshKey={semesterCacheVersion}
                              columnWidthPx={adaptive.columnWidthPx}
                              showCellPeriods={showTotalPeriods}
                              gradeLevels={visibleGradeLevels}
                              gradeConfig={gradeConfig}
                            />
                          </div>
                        );
                      })}
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
                      <div style={{ height: totalHeaderHeight, flexShrink: 0 }} />
                      <div className="flex-1 flex flex-col min-h-0">
                        {visibleGradeLevels.map((grade) => {
                          const totalWeeklyPeriods = (() => {
                            let total = 0;
                            tabFilteredCourses.forEach((course) => {
                              if (courseAppliesToGrade(course, grade, gradeConfig)) {
                                total += getWeeklyPeriodsForGrade(course, grade, gradeConfig);
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
        <div
          className={`flex h-full min-h-0 w-full flex-col ${showRoadmapTopBar ? 'pt-1' : 'pt-2'} ${isAdminSurface ? 'pb-3' : 'pb-14'}`}
        >
          <UnitView
            courses={courses}
            selectedSemester={focusSemester}
            onSemesterChange={setFocusSemester}
            gradeConfig={gradeConfig}
            readOnly={!canEditUnits}
          />
        </div>
      ) : (
        <div
          className={`flex h-full min-h-0 w-full flex-col ${showRoadmapTopBar ? 'pt-1' : 'pt-2'} ${isAdminSurface ? 'pb-3' : 'pb-14'}`}
        >
          <ConceptView
            courses={courses}
            selectedSemester={conceptSemester}
            onSemesterChange={setConceptSemester}
            gradeConfig={gradeConfig}
          />
        </div>
      )}

      </div>

      {/* Add Course Dialog */}
      <AddCourseDialog
        onAddCourse={handleAddCourse}
        gradeItems={gradeItems}
        domainsConfig={courseDomains}
        open={isAddCourseDialogOpen}
        onOpenChange={setIsAddCourseDialogOpen}
      />

      {/* Semester Overview Dialog */}
      {selectedCourse && selectedSemester && (
        <SemesterOverviewDialog
          open={isSemesterDialogOpen}
          onOpenChange={(open) => {
            setIsSemesterDialogOpen(open);
            if (!open) bumpSemesterCache();
          }}
          onDataLoaded={bumpSemesterCache}
          course={selectedCourse}
          semester={selectedSemester}
          readOnly={!canEditUnits}
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
        columnOrderItems={settingsColumnOrderItems}
        domainsConfig={courseDomains}
        canReorderColumns={canReorderCategories}
        onColumnOrderSave={async (keys) => {
          await saveCategoryOrder(keys);
          prevPersistedCategoryOrderRef.current = [...keys];
          setCategoryOrder(keys);
        }}
        onDomainsSave={async (config) => {
          setCourseDomains(config);
          await saveCourseDomains(config);
        }}
        onCreateCourseRequested={() => setIsAddCourseDialogOpen(true)}
      />

      {/* Edit Course Dialog */}
      <EditCourseDialog
        course={editingCourse}
        gradeItems={gradeItems}
        domainsConfig={courseDomains}
        open={isEditCourseDialogOpen}
        onOpenChange={setIsEditCourseDialogOpen}
        onSave={handleSaveEditedCourse}
      />

      {/* Concept Settings Dialog */}
      <ConceptSettingsDialog
        open={isConceptSettingsDialogOpen}
        onOpenChange={setIsConceptSettingsDialogOpen}
      />

      <input
        ref={courseDataImportInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden
        onChange={handleCourseDataFileChange}
      />
    </div>
  );
}

function RoadmapParallelogramHeader({
  course,
  displayKey,
  columnWidthPx,
  headerHeight,
}: {
  course: Course;
  displayKey: string;
  columnWidthPx: number;
  headerHeight: number;
}) {
  const tagChrome = getCourseTagChrome(course.color);
  return (
    <div
      className="flex-shrink-0 relative select-none cursor-default"
      style={{ width: columnWidthPx, height: headerHeight }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: 'skewX(-20deg)',
          transformOrigin: 'bottom center',
          backgroundColor: tagChrome.backgroundColor,
          bottom: '0px',
          boxShadow: tagChrome.boxShadow,
        }}
      />
      <div
        className="relative h-full flex items-center justify-center pointer-events-none"
        style={{ transform: 'skewX(20deg)', padding: '0 2px' }}
      >
        <span
          className="text-xs font-semibold text-white whitespace-nowrap italic"
          style={{
            transform: 'skewX(-20deg)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: tagChrome.labelTextShadow,
          }}
          title={displayKey}
        >
          {displayKey}
        </span>
      </div>
    </div>
  );
}

interface CategoryColumnProps {
  category: string;
  courses: Course[];
  onSemesterClick: (course: Course, grade: number, semester: 'Semester 1' | 'Semester 2') => void;
  getSemesterLabel: (courseName: string, grade: number, semester: 'Semester 1' | 'Semester 2') => string;
  /** 学期缓存版本：变化时重算格子；勿用于子组件 key（会整格卸载） */
  refreshKey: number;
  columnWidthPx: number;
  showCellPeriods: boolean;
  gradeLevels: number[];
  gradeConfig: GradeConfig;
}

// 根据年级找到对应的课程（如果有多个课程覆盖该年级，返回第一个）
function findCourseForGrade(courses: Course[], grade: number, gradeConfig: GradeConfig): Course | null {
  for (const course of courses) {
    if (courseAppliesToGrade(course, grade, gradeConfig)) {
      return course;
    }
  }
  return null;
}

function CategoryColumn({
  category: _category,
  courses,
  onSemesterClick,
  getSemesterLabel,
  refreshKey,
  columnWidthPx,
  showCellPeriods,
  gradeLevels,
  gradeConfig,
}: CategoryColumnProps) {
  /** 随学期缓存刷新变化，触发本列重算 hasSemesterUnits；切勿写入子组件 key，否则会整格卸载导致 hover/tooltip 狂闪 */
  void refreshKey;

  // 使用第一个课程的颜色作为该列的颜色
  const defaultCourse = courses[0];

  return (
    <div className="flex-shrink-0 relative h-full" style={{ width: columnWidthPx }}>
      {/* Curriculum Roadmap */}
      <div className="h-full flex flex-col">
        {gradeLevels.map((grade) => {
          // 找到覆盖该年级的课程
          const course = findCourseForGrade(courses, grade, gradeConfig);
          const isApplicable = course !== null;
          
          return (
            <div key={grade} className="relative flex min-h-0 flex-1 flex-col">
              {SEMESTERS.map((semester) => {
                if (course) {
                  const hasUnits = hasSemesterUnits(course.id, grade, semester);
                  return (
                    <SemesterSegment
                      key={`${course.id}-${grade}-${semester}`}
                      grade={grade}
                      semester={semester}
                      color={course.color}
                      hasUnits={hasUnits}
                      isApplicable={isApplicable}
                      onSemesterClick={() => onSemesterClick(course, grade, semester)}
                      getSemesterLabel={(g, s) => getSemesterLabel(course.name, g, s)}
                      course={course}
                      gradeConfig={gradeConfig}
                    />
                  );
                }
                if (!defaultCourse) {
                  return (
                    <div
                      key={`${grade}-${semester}`}
                      className="flex-1 relative transition-all duration-200 opacity-50"
                    >
                      <div className="absolute inset-0 bg-gray-100 border-r border-b border-gray-300/30" />
                    </div>
                  );
                }
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
                    gradeConfig={gradeConfig}
                  />
                );
              })}
              {showCellPeriods && course && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                  aria-hidden
                >
                  <span className="text-base font-bold tabular-nums text-gray-900/90 [text-shadow:0_0_10px_rgba(255,255,255,0.75),0_1px_0_rgba(255,255,255,0.5)]">
                    {getWeeklyPeriodsForGrade(course, grade, gradeConfig)}
                  </span>
                </div>
              )}
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
  isApplicable: boolean;
  onSemesterClick: () => void;
  getSemesterLabel: (grade: number, semester: 'Semester 1' | 'Semester 2') => string;
  course: Course;
  gradeConfig: GradeConfig;
}

function SemesterSegment({ 
  grade, 
  semester: _semester, 
  color,
  hasUnits,
  isApplicable,
  onSemesterClick, 
  getSemesterLabel: _getSemesterLabel,
  course,
  gradeConfig,
}: SemesterSegmentProps) {
  const { language } = useLanguage();
  const cellRef = useRef<HTMLDivElement>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [tipAnchor, setTipAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  const baseHex = getCourseCellHex(color, 'base');
  const hoverHex = getCourseCellHex(color, 'hover');
  const standardHex = getCourseCellHex(color, 'standard');
  const bgColor = hasUnits ? standardHex : baseHex;
  const hoverBg = hasUnits ? standardHex : hoverHex;
  const subjectLine = `${getSubjectCategoryText(course.subjectCategory, language)}-${course.textbookVersion || '人教版'}`;
  const periods = getWeeklyPeriodsForGrade(course, grade, gradeConfig);
  const hoverTitle =
    language === 'zh'
      ? `${subjectLine} · 周课时 ${periods} 节/周`
      : `${subjectLine} · Weekly ${periods}/week`;

  const updateTipPosition = () => {
    const el = cellRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipAnchor({ left: r.left + r.width / 2, top: r.top });
  };

  useLayoutEffect(() => {
    if (!hoverOpen) return;
    updateTipPosition();
    const onScrollOrResize = () => updateTipPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [hoverOpen]);

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
  
  const cellBg = hoverOpen ? hoverBg : bgColor;

  return (
    <>
      <div
        ref={cellRef}
        className="relative flex-1 cursor-pointer"
        title={hoverTitle}
        onMouseEnter={() => {
          const el = cellRef.current;
          if (el) {
            const r = el.getBoundingClientRect();
            setTipAnchor({ left: r.left + r.width / 2, top: r.top });
          }
          setHoverOpen(true);
        }}
        onMouseLeave={() => setHoverOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          onSemesterClick();
        }}
      >
        <div className="absolute inset-0 z-[1]" />
        <div
          className={`pointer-events-none absolute inset-0 z-[2] border-r border-b border-gray-300/30 transition-[background-color,box-shadow] duration-150 ${
            hoverOpen ? 'shadow-md' : 'shadow-sm'
          }`}
          style={{
            backgroundColor: cellBg,
            boxShadow: hoverOpen
              ? '0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04) inset'
              : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.3)',
          }}
        >
          <div
            className="absolute inset-0 transition-opacity duration-150"
            style={{
              background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.35) 0%, transparent 50%)',
              opacity: hoverOpen ? 0.22 : 0.3,
            }}
          />
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[3] border-b border-dashed border-gray-400/50" />
      </div>
      {hoverOpen &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[10050] min-w-[min(8.8rem,calc(100vw-1.5rem))] max-w-[min(13.6rem,calc(100vw-1.5rem))] rounded-md border border-gray-900/10 bg-white/78 px-3 py-2 text-center text-gray-900 shadow-lg backdrop-blur-md"
            style={{
              left: tipAnchor.left,
              top: tipAnchor.top,
              transform: 'translate(-50%, calc(-100% - 6px)) scale(0.72)',
              transformOrigin: 'bottom center',
            }}
          >
            <div className="text-xs font-semibold leading-snug text-gray-900">{subjectLine}</div>
            <div className="mt-1 text-xs leading-snug text-gray-700">
              {language === 'zh' ? `周课时：${periods} 节/周` : `Weekly: ${periods} periods/week`}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
