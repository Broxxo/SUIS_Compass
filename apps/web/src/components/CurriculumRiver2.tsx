import { useEffect, useMemo, useState } from 'react';
import AppTopBar from './AppTopBar';
import CurriculumRoadmap from './CurriculumRoadmap';
import CapabilityView from './CapabilityView';
import DesignBoard from './DesignBoard';
import { SegmentTabButton, SegmentTabGroup, SegmentTabStrip } from './ui/segment-tab-button';
import { useLanguage } from '../contexts/LanguageContext';
import { Course, GradeConfig } from '../types';
import { DEFAULT_GRADE_CONFIG, SEMESTERS } from '../lib/constants';
import { migrateCoursesData } from '../lib/courseUtils';
import { getCourseDisplayName } from '../lib/utils';
import {
  getRoadmapSegmentsInDisplayOrder,
  normalizeGradeConfig,
  ROADMAP_OVERVIEW_TAB_ALL,
} from '../lib/gradeConfig';
import { USE_CLOUD_STORAGE } from '../lib/api';
import { logError } from '../lib/errorHandler';
import {
  hydrateSemesterCacheFromCloud,
  loadCourses,
  loadGradeConfig,
  loadSemesterDataSync,
} from '../lib/storage';
import type { UnitRef } from '../lib/inquiryDesign';

type River2Tab = 'overview' | 'unit' | 'concept' | 'capability' | 'design';

export function isCurriculumRiver2Path(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/curriculum';
}

function collectUnits(courses: Course[]): UnitRef[] {
  const refs: UnitRef[] = [];
  courses.forEach((course) => {
    SEMESTERS.forEach((semester) => {
      [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((grade) => {
        const data = loadSemesterDataSync(course.id, grade, semester);
        data?.units?.forEach((unit) => {
          refs.push({
            courseId: course.id,
            courseName: getCourseDisplayName(course, 'zh'),
            unitId: unit.id,
            unitTitle: unit.title,
            focus: unit.focus || '',
            keyConcepts: unit.keyConcepts ?? [],
            grade,
            semester,
            week: unit.week,
          });
        });
      });
    });
  });
  return refs;
}

export default function CurriculumRiver2() {
  const { language } = useLanguage();
  const [tab, setTab] = useState<River2Tab>('overview');
  const [stageId, setStageId] = useState(ROADMAP_OVERVIEW_TAB_ALL);
  const [courses, setCourses] = useState<Course[]>([]);
  const [gradeConfig, setGradeConfig] = useState<GradeConfig>(DEFAULT_GRADE_CONFIG);
  const [ready, setReady] = useState(false);
  const riverView: 'overview' | 'unit' | 'concept' = tab === 'unit' || tab === 'concept' ? tab : 'overview';
  const showRiver = tab === 'overview' || tab === 'unit' || tab === 'concept';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loadedCourses, loadedGradeConfig] = await Promise.all([
          loadCourses(),
          loadGradeConfig(),
          USE_CLOUD_STORAGE
            ? hydrateSemesterCacheFromCloud().catch((error) => {
                logError('Failed to hydrate semester cache for curriculum 2', error);
                return 0;
              })
            : Promise.resolve(0),
        ]);
        if (cancelled) return;
        setCourses(migrateCoursesData(loadedCourses));
        setGradeConfig(normalizeGradeConfig(loadedGradeConfig));
      } catch (error) {
        logError('Failed to load curriculum 2', error);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const units = useMemo(() => (ready ? collectUnits(courses) : []), [ready, courses]);
  const segments = getRoadmapSegmentsInDisplayOrder(gradeConfig);

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-white">
      <AppTopBar
        title={language === 'zh' ? '课程河流 2.0' : 'Curriculum River 2.0'}
        showBack
        onBack={() => {
          window.location.assign('/');
        }}
      />
      <div className="relative z-40 mt-[var(--app-topbar-height)] flex-shrink-0 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <div className="flex min-h-[40px] items-center justify-center">
          <div className="min-w-0 max-w-full overflow-x-auto">
            <SegmentTabStrip aria-label="课程河流 2.0 视图">
              <SegmentTabGroup>
                {segments.map((segment) => (
                  <SegmentTabButton
                    key={segment.id}
                    grouped
                    active={tab === 'overview' && stageId === segment.id}
                    onClick={() => {
                      setTab('overview');
                      setStageId(segment.id);
                    }}
                  >
                    {segment.label}
                  </SegmentTabButton>
                ))}
                <SegmentTabButton
                  grouped
                  active={tab === 'overview' && stageId === ROADMAP_OVERVIEW_TAB_ALL}
                  onClick={() => {
                    setTab('overview');
                    setStageId(ROADMAP_OVERVIEW_TAB_ALL);
                  }}
                >
                  {language === 'zh' ? '整体' : 'Overview'}
                </SegmentTabButton>
              </SegmentTabGroup>
              <SegmentTabGroup>
                <SegmentTabButton grouped active={tab === 'unit'} onClick={() => setTab('unit')}>单元</SegmentTabButton>
              </SegmentTabGroup>
              <SegmentTabGroup>
                <SegmentTabButton grouped active={tab === 'concept'} onClick={() => setTab('concept')}>概念</SegmentTabButton>
              </SegmentTabGroup>
              <SegmentTabGroup>
                <SegmentTabButton grouped active={tab === 'capability'} onClick={() => setTab('capability')}>能力</SegmentTabButton>
              </SegmentTabGroup>
              <SegmentTabGroup>
                <SegmentTabButton grouped active={tab === 'design'} onClick={() => setTab('design')}>设计板</SegmentTabButton>
              </SegmentTabGroup>
            </SegmentTabStrip>
          </div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={showRiver ? 'h-full' : 'hidden'}>
          <CurriculumRoadmap
            surface="hub"
            forcedView={riverView}
            controlledOverviewStageTabId={stageId}
          />
        </div>
        {tab === 'capability' ? <CapabilityView /> : null}
        <div className={tab === 'design' ? 'h-full' : 'hidden'}>
          <DesignBoard units={units} />
        </div>
      </div>
    </div>
  );
}
