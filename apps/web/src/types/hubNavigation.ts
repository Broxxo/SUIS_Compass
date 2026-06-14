import type { Term } from './classManagement';

export type HubTeacherTodoTarget =
  | {
      type: 'teacher-portrait-collection';
      academicYearId: string;
      term: Term;
      templateId: string;
    }
  | {
      type: 'academic-report';
      academicYearId: string;
      term: Term;
      templateId: string;
    };

export interface HubTeacherTodoItem {
  key: string;
  label: string;
  subtitle: string;
  publishedAt: string | null;
  target: HubTeacherTodoTarget;
}

export type HubPortraitNavigation =
  | {
      view: 'teacher-portrait';
      academicYearId: string;
      term: Term;
      templateId: string;
      portraitTab?: 'collections' | 'school';
    }
  | {
      view: 'academic-reports';
      academicYearId: string;
      term: Term;
      templateId: string;
    };
