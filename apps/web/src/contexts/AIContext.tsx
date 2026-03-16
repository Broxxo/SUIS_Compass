/**
 * 全局 AI 上下文：当前选中的“应用”及 payload，供 AI 面板组 context 字符串。
 * 子应用（如 CurriculumRoadmap）通过 setContextFromApp 上报；用户可在 AI 内用上下文选择器切换。
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Course, Semester } from '../types';
import { loadCoursesSync, loadKeyConceptsSync } from '../lib/storage';

export type AIScreenId = 'hub' | 'curriculum-roadmap' | 'student-portrait' | 'class-assistant' | null;

export interface CurriculumRoadmapPayload {
  viewMode?: 'overview' | 'focus';
  courses: Course[];
  focusSemester?: Semester;
  keyConcepts?: string[];
  /** 从 hub 选择“课程河流”时只有基础数据，无聚焦学期等 */
  basic?: boolean;
}

export type AIContextPayload = CurriculumRoadmapPayload | Record<string, unknown>;

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
