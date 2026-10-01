import { useEffect, useState } from 'react';
import { api, USE_CLOUD_STORAGE } from './api';
import { sortAcademicYearsByYear } from './classStorage';
import type { AcademicYear, Term } from '../types/classManagement';

/** 学年名称里的起始年，越晚越新。2026-2027 优先于 2025-2026。 */
export function latestAcademicYear(years: AcademicYear[]): AcademicYear | null {
  if (years.length === 0) return null;
  return sortAcademicYearsByYear(years).at(-1) ?? null;
}

/** 该学年下学期已有公开课、教师问卷或学业报告时用下学期，否则上学期。 */
export async function preferredTermForYear(academicYearId: string): Promise<Term> {
  if (!USE_CLOUD_STORAGE || !academicYearId) return 'Semester 1';
  try {
    const usage = await api.getAcademicPeriodUsage(academicYearId);
    return usage.semester2InUse ? 'Semester 2' : 'Semester 1';
  } catch {
    return 'Semester 1';
  }
}

/**
 * 跟学年走的学期。从待办点进来时，钉住那一次带来的学年和学期；
 * 之后改学年，再按该学年有没有用上下学期。
 */
export function useTermForYear(yearId: string, pinnedYearId?: string, pinnedTerm?: Term) {
  const [term, setTerm] = useState<Term>(pinnedTerm ?? 'Semester 1');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!yearId) {
      setReady(false);
      return;
    }
    if (pinnedTerm && pinnedYearId && yearId === pinnedYearId) {
      setTerm(pinnedTerm);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    preferredTermForYear(yearId).then((next) => {
      if (cancelled) return;
      setTerm(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [yearId, pinnedYearId, pinnedTerm]);

  return { term, setTerm, ready };
}
