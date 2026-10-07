/**
 * 全局 AI 上下文：当前选中的“应用”及 payload，供 AI 面板组 context 字符串。
 * 子应用（如 CurriculumRoadmap）通过 setContextFromApp 上报；用户可在 AI 内用上下文选择器切换。
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Course, Semester } from '../types';
import { loadCoursesSync, loadKeyConceptsSync } from '../lib/storage';
import type { StudentPortraitAIPayload } from '../lib/studentPortraitAIContext';
import type { TeacherPortraitAIPayload } from '../lib/teacherPortraitAIContext';
import { buildBasicSchoolCalendarPayload as basicSchoolCalendarPayload, type SchoolCalendarAIPayload } from '../lib/schoolCalendarAIContext';

export type AIScreenId =
  | 'hub'
  | 'curriculum-roadmap'
  | 'student-portrait'
  | 'teacher-portrait'
  | 'school-calendar'
  | 'class-assistant'
  | 'open-lessons'
  | 'lighthouse'
  | 'mailbox'
  | 'admin'
  | null;

export interface CurriculumRoadmapPayload {
  viewMode?: 'overview' | 'focus';
  courses: Course[];
  focusSemester?: Semester;
  keyConcepts?: string[];
  /** 从 hub 选择“课程河流”时只有基础数据，无聚焦学期等 */
  basic?: boolean;
}

export type AIContextPayload =
  | CurriculumRoadmapPayload
  | StudentPortraitAIPayload
  | TeacherPortraitAIPayload
  | SchoolCalendarAIPayload
  | BasicScreenPayload
  | Record<string, unknown>;

interface AIContextType {
  screenId: AIScreenId;
  setScreenId: (id: AIScreenId) => void;
  contextPayload: AIContextPayload;
  setContextPayload: (p: AIContextPayload) => void;
  /** 子应用调用，上报当前屏幕与 payload */
  setContextFromApp: (screenId: AIScreenId, payload: AIContextPayload) => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function useAIContext() {
  const ctx = useContext(AIContext);
  if (ctx === undefined) throw new Error('useAIContext must be used within AIContextProvider');
  return ctx;
}

/** 从 hub 选择「课程河流」时使用：仅全局课程列表 + 概念库，无聚焦学期 */
export function buildBasicCurriculumPayload(): CurriculumRoadmapPayload {
  const courses = loadCoursesSync();
  const keyConcepts = loadKeyConceptsSync();
  return { courses, keyConcepts, basic: true, viewMode: 'overview' };
}

/** 从 Hub / SUIS AI 主入口手动选择「学生中心」时使用：无具体班级/学生明细 */
export function buildBasicStudentPortraitPayload(): StudentPortraitAIPayload {
  return { view: 'idle' };
}

/** 从 Hub / SUIS AI 主入口手动选择「教师中心」时使用：无具体看板明细 */
export function buildBasicTeacherPortraitPayload(): TeacherPortraitAIPayload {
  return { view: 'idle' };
}

/** 从 Hub / SUIS AI 主入口手动选择「校历」时使用：没有打开具体月历或周历 */
export function buildBasicSchoolCalendarPayload(): SchoolCalendarAIPayload {
  return basicSchoolCalendarPayload();
}

/** 公开课 / 信箱 / 后台 / 课堂助手 的基础上下文：仅说明当前所在界面，无具体明细 */
export interface BasicScreenPayload {
  view: 'open-lessons' | 'lighthouse' | 'mailbox' | 'admin' | 'class-assistant' | 'idle';
  summary?: string;
}

export function buildBasicOpenLessonsPayload(): BasicScreenPayload {
  return { view: 'open-lessons' };
}

export function buildBasicLighthousePayload(): BasicScreenPayload {
  return { view: 'lighthouse' };
}

export function buildBasicMailboxPayload(): BasicScreenPayload {
  return { view: 'mailbox' };
}

export function buildBasicAdminPayload(): BasicScreenPayload {
  return { view: 'admin' };
}

export function buildBasicClassAssistantPayload(): BasicScreenPayload {
  return { view: 'class-assistant' };
}

export function AIContextProvider({ children }: { children: ReactNode }) {
  const [screenId, setScreenId] = useState<AIScreenId>(null);
  const [contextPayload, setContextPayload] = useState<AIContextPayload>({});

  const setContextFromApp = useCallback((id: AIScreenId, payload: AIContextPayload) => {
    setScreenId(id);
    setContextPayload(payload);
  }, []);

  return (
    <AIContext.Provider
      value={{
        screenId,
        setScreenId,
        contextPayload,
        setContextPayload,
        setContextFromApp,
      }}
    >
      {children}
    </AIContext.Provider>
  );
}
