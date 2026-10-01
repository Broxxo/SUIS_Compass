import {
  sortPublishedTasksNewestFirst,
  TEACHER_PORTRAIT_COLLECTION_TYPES,
  teacherPortraitCollectionTypeLabel,
  type TeacherPortraitCollectionType,
} from '@repo/shared';
import { api, USE_CLOUD_STORAGE } from './api';
import { loadAcademicYears } from './classStorage';
import { latestAcademicYear } from './academicPeriodDefault';
import type { HubTeacherTodoItem } from '../types/hubNavigation';
import type { Term } from '../types/classManagement';
import type { OpenLesson } from '../types/openLesson';

function termLabel(term: Term, isZh: boolean): string {
  if (term === 'Semester 1') return isZh ? '上学期' : 'Semester 1';
  return isZh ? '下学期' : 'Semester 2';
}

function collectionTypeFromRaw(raw: string): TeacherPortraitCollectionType {
  if (raw in TEACHER_PORTRAIT_COLLECTION_TYPES) return raw as TeacherPortraitCollectionType;
  return 'teaching-diagnosis-kiss';
}

async function resolveHubTodoYearContext(isZh: boolean) {
  const years = await loadAcademicYears();
  const year = latestAcademicYear(years);
  const yearId = year?.id || '';
  const yearName = year?.name?.trim() || (isZh ? '本学年' : 'This year');
  return { yearId, yearName };
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function timeStartMinutes(text: string): number {
  const match = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function nearbyDayLabel(lessonDate: string, today: string, isZh: boolean): string {
  if (lessonDate === today) return isZh ? '今天' : 'Today';
  return isZh ? '明天' : 'Tomorrow';
}

/** 学科组名取一个学科，例如「小学英语组」→「英语」 */
function openLessonSubjectLabel(groupNameZh: string): string {
  return groupNameZh.trim().replace(/^(小学|初中|高中)/, '').replace(/组$/, '').trim();
}

/** 只取开始钟点，例如 09:00-09:40 → 09:00 */
function lessonStartClock(timeText: string): string {
  const match = timeText.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) {
    return timeText.trim().split(/\s*[-–—~～至]\s*/)[0]?.trim() ?? '';
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** 今日、明日的公开课，按日期和时间由近到远。日常课由接口按创建者和上课教师过滤。 */
async function fetchNearbyOpenLessons(yearId: string, isZh: boolean): Promise<HubTeacherTodoItem[]> {
  const today = localDateKey(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateKey(tomorrowDate);
  const lists = await Promise.all(
    (['Semester 1', 'Semester 2'] as const).map((term) =>
      api.listOpenLessonsForTerm(yearId, term).catch(() => [] as OpenLesson[]),
    ),
  );
  const lessons = lists
    .flat()
    .filter((lesson) => lesson.lessonDate === today || lesson.lessonDate === tomorrow)
    .sort((a, b) => {
      const byDate = a.lessonDate.localeCompare(b.lessonDate);
      if (byDate !== 0) return byDate;
      const byTime = timeStartMinutes(a.timeText) - timeStartMinutes(b.timeText);
      if (byTime !== 0) return byTime;
      return a.gradeUnitTopic.localeCompare(b.gradeUnitTopic, 'zh');
    });
  return lessons.map((lesson) => {
    const teacher = (isZh ? lesson.teacherNameZh : lesson.teacherNameEn).trim() || lesson.teacherNameZh || lesson.teacherNameEn;
    const when = `${nearbyDayLabel(lesson.lessonDate, today, isZh)} ${lessonStartClock(lesson.timeText)}`.trim();
    const subject = openLessonSubjectLabel(lesson.groupNameZh);
    const className = lesson.className.trim();
    const location = lesson.location.trim();
    const classPlace = className && location ? `${className}(${location})` : className || location;
    const label = [when, subject, teacher, classPlace].filter((part) => part.trim()).join(' ');
    return {
      key: `open-lesson-${lesson.id}`,
      label,
      subtitle: '',
      publishedAt: null,
      target: {
        type: 'open-lesson' as const,
        academicYearId: lesson.academicYearId,
        term: lesson.term,
        lessonKind: lesson.lessonKind,
        lessonId: lesson.id,
      },
    };
  });
}

function sortHubTodoItems(items: HubTeacherTodoItem[]): HubTeacherTodoItem[] {
  return sortPublishedTasksNewestFirst(
    items.map((item) => ({
      ...item,
      id: item.key,
      updatedAt: null,
      isComplete: false,
    })),
  );
}

/** 教师：本人未完成的教学诊断与学业报告 */
export async function fetchHubTeacherTodos(isZh: boolean): Promise<HubTeacherTodoItem[]> {
  if (!USE_CLOUD_STORAGE) return [];

  const { yearId, yearName } = await resolveHubTodoYearContext(isZh);
  if (!yearId) return [];

  const terms: Term[] = ['Semester 1', 'Semester 2'];
  const items: HubTeacherTodoItem[] = [];

  const portraitLists = await Promise.all(
    terms.map((term) => api.getTeacherPortraitCollections({ academicYearId: yearId, term })),
  );
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    for (const tpl of portraitLists[i]) {
      if (tpl.status !== 'published') continue;
      if (tpl.mySubmission?.hasContent === true) continue;
      const typeLabel = teacherPortraitCollectionTypeLabel(
        collectionTypeFromRaw(tpl.collectionType),
        isZh,
      );
      const label = (tpl.title ?? '').trim() || typeLabel;
      items.push({
        key: `portrait-${tpl.id}`,
        label,
        subtitle: `${yearName} · ${termLabel(term, isZh)}`,
        publishedAt: tpl.publishedAt,
        target: {
          type: 'teacher-portrait-collection',
          academicYearId: tpl.academicYearId,
          term: tpl.term,
          templateId: tpl.id,
        },
      });
    }
  }

  const reportLists = await Promise.all(
    terms.map((term) => api.getReportTemplatesForTerm(yearId, term)),
  );
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const published = reportLists[i].filter((tpl) => tpl.status === 'published' && !!tpl.id);
    const progressRows = await Promise.all(
      published.map(async (tpl) => {
        const progress = await api.getMyReportTemplateProgress(tpl.id as string);
        return { tpl, progress };
      }),
    );
    for (const { tpl, progress } of progressRows) {
      if (progress.classes.length === 0 || progress.pendingStudents <= 0) continue;
      const label = (tpl.title ?? progress.title ?? '').trim() || (isZh ? '学业报告' : 'Academic report');
      items.push({
        key: `report-${tpl.id}`,
        label,
        subtitle: `${yearName} · ${termLabel(term, isZh)}`,
        publishedAt: tpl.publishedAt ?? null,
        target: {
          type: 'academic-report',
          academicYearId: yearId,
          term,
          templateId: tpl.id as string,
        },
      });
    }
  }

  const tasks = sortHubTodoItems(items);
  const lessons = await fetchNearbyOpenLessons(yearId, isZh);
  return [...tasks, ...lessons];
}

/** 管理员：全校仍有未完成进度的已发布任务 */
export async function fetchHubAdminTodos(isZh: boolean): Promise<HubTeacherTodoItem[]> {
  if (!USE_CLOUD_STORAGE) return [];

  const { yearId, yearName } = await resolveHubTodoYearContext(isZh);
  if (!yearId) return [];

  const terms: Term[] = ['Semester 1', 'Semester 2'];
  const items: HubTeacherTodoItem[] = [];

  const portraitLists = await Promise.all(
    terms.map((term) => api.getAdminTeacherPortraitTemplates({ academicYearId: yearId, term })),
  );
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const published = portraitLists[i].filter((tpl) => tpl.status === 'published');
    const progressRows = await Promise.all(
      published.map(async (tpl) => {
        const progress = await api.getAdminTeacherPortraitTemplateProgress(tpl.id);
        return { tpl, progress };
      }),
    );
    for (const { tpl, progress } of progressRows) {
      if (progress.pendingTeachers <= 0) continue;
      const typeLabel = teacherPortraitCollectionTypeLabel(
        collectionTypeFromRaw(tpl.collectionType),
        isZh,
      );
      const label = (tpl.title ?? '').trim() || typeLabel;
      const pendingLabel = isZh
        ? `余 ${progress.pendingTeachers} 位教师`
        : `${progress.pendingTeachers} teachers left`;
      items.push({
        key: `portrait-${tpl.id}`,
        label,
        subtitle: `${yearName} · ${termLabel(term, isZh)} · ${pendingLabel}`,
        publishedAt: tpl.publishedAt,
        target: {
          type: 'teacher-portrait-collection',
          academicYearId: tpl.academicYearId,
          term: tpl.term,
          templateId: tpl.id,
        },
      });
    }
  }

  const reportTemplates = await api.getAdminReportTemplates({ academicYearId: yearId });
  const publishedReports = reportTemplates.filter((tpl) => tpl.status === 'published' && !!tpl.id);
  const reportProgressRows = await Promise.all(
    publishedReports.map(async (tpl) => {
      const progress = await api.getAdminReportTemplateProgress(tpl.id);
      return { tpl, progress };
    }),
  );
  for (const { tpl, progress } of reportProgressRows) {
    if (progress.pendingStudents <= 0) continue;
    const label = (tpl.title ?? progress.title ?? '').trim() || (isZh ? '学业报告' : 'Academic report');
    const pendingLabel = isZh
      ? `余 ${progress.pendingStudents} 人`
      : `${progress.pendingStudents} students left`;
    items.push({
      key: `report-${tpl.id}`,
      label,
      subtitle: `${yearName} · ${termLabel(tpl.term, isZh)} · ${pendingLabel}`,
      publishedAt: tpl.publishedAt ?? null,
      target: {
        type: 'academic-report',
        academicYearId: yearId,
        term: tpl.term,
        templateId: tpl.id,
      },
    });
  }

  const tasks = sortHubTodoItems(items);
  const lessons = await fetchNearbyOpenLessons(yearId, isZh);
  return [...tasks, ...lessons];
}
