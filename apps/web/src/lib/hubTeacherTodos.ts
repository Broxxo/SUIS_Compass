import {
  sortPublishedTasksNewestFirst,
  TEACHER_PORTRAIT_COLLECTION_TYPES,
  teacherPortraitCollectionTypeLabel,
  type TeacherPortraitCollectionType,
} from '@repo/shared';
import { api, USE_CLOUD_STORAGE } from './api';
import { loadAcademicYears, loadCurrentAcademicYearId } from './classStorage';
import type { HubTeacherTodoItem } from '../types/hubNavigation';
import type { Term } from '../types/classManagement';

function termLabel(term: Term, isZh: boolean): string {
  if (term === 'Semester 1') return isZh ? '上学期' : 'Semester 1';
  return isZh ? '下学期' : 'Semester 2';
}

function collectionTypeFromRaw(raw: string): TeacherPortraitCollectionType {
  if (raw in TEACHER_PORTRAIT_COLLECTION_TYPES) return raw as TeacherPortraitCollectionType;
  return 'teaching-diagnosis-kiss';
}

async function resolveHubTodoYearContext(isZh: boolean) {
  const [years, currentYearId] = await Promise.all([loadAcademicYears(), loadCurrentAcademicYearId()]);
  const yearId = currentYearId || years[0]?.id || '';
  const yearName = years.find((y) => y.id === yearId)?.name?.trim() || (isZh ? '本学年' : 'This year');
  return { yearId, yearName };
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

  return sortHubTodoItems(items);
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

  return sortHubTodoItems(items);
}
