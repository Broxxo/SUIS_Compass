import type { ReportLoadPlan } from './reportLoadContext.js';

export function filterReportPlanForTeacher(plan: ReportLoadPlan, teacherId: string): ReportLoadPlan {
  const subjectTasks = plan.subjectTasks.filter((t) => t.teacherId === teacherId);
  const homeroomTasks = plan.homeroomTasks.filter((t) => t.teacherId === teacherId);
  const portraitKissTasks = plan.portraitKissTasks.filter((t) => t.teacherId === teacherId);
  return {
    ...plan,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: subjectTasks.length > 0 || homeroomTasks.length > 0 ? 1 : 0,
      templateSubjects: plan.stats.templateSubjects,
      skippedStaffingRows: plan.stats.skippedStaffingRows,
      skippedNotInEvaluation: plan.stats.skippedNotInEvaluation,
      portraitTeachers: portraitKissTasks.length > 0 ? 1 : 0,
    },
  };
}

/** 仅保留指定年级（含该班班主任评语）。 */
export function filterReportPlanForGrade(
  plan: ReportLoadPlan,
  gradeMin: number,
  gradeMax: number,
  classGradeById?: Map<string, number>,
): ReportLoadPlan {
  const inGrade = (g: number) => g >= gradeMin && g <= gradeMax;
  const gradeOfClass = (classId: string): number | undefined => {
    if (classGradeById?.has(classId)) return classGradeById.get(classId);
    return plan.subjectTasks.find((t) => t.classId === classId)?.classGrade;
  };

  const subjectTasks = plan.subjectTasks.filter((t) => inGrade(t.classGrade));
  const homeroomTasks = plan.homeroomTasks.filter((t) => {
    const g = gradeOfClass(t.classId);
    return g != null && inGrade(g);
  });
  const portraitKissTasks = plan.portraitKissTasks.filter((t) => t.teacherId); // unchanged; reports-only

  return {
    ...plan,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: new Set([...subjectTasks, ...homeroomTasks].map((t) => t.teacherId)).size,
      templateSubjects: plan.stats.templateSubjects,
      skippedStaffingRows: plan.stats.skippedStaffingRows,
      skippedNotInEvaluation: plan.stats.skippedNotInEvaluation,
      portraitTeachers: new Set(portraitKissTasks.map((t) => t.teacherId)).size,
    },
  };
}

export function mergeReportLoadPlans(plans: ReportLoadPlan[]): ReportLoadPlan {
  if (plans.length === 0) {
    throw new Error('mergeReportLoadPlans: empty');
  }
  const first = plans[0]!;
  const subjectTasks = plans.flatMap((p) => p.subjectTasks);
  const homeroomTasks = plans.flatMap((p) => p.homeroomTasks);
  const portraitKissTasks = plans.flatMap((p) => p.portraitKissTasks);
  return {
    ...first,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: new Set([...subjectTasks, ...homeroomTasks].map((t) => t.teacherId)).size,
      templateSubjects: first.stats.templateSubjects,
      skippedStaffingRows: plans.reduce((n, p) => n + p.stats.skippedStaffingRows, 0),
      skippedNotInEvaluation: plans.reduce((n, p) => n + p.stats.skippedNotInEvaluation, 0),
      portraitTeachers: new Set(portraitKissTasks.map((t) => t.teacherId)).size,
    },
  };
}

/** 保留指定年级范围内、指定教师集合的任务（年级组压测用）。 */
export function filterReportPlanForTeachersAndGrades(
  plan: ReportLoadPlan,
  teacherIds: Set<string>,
  gradeMin: number,
  gradeMax: number,
  classGradeById?: Map<string, number>,
): ReportLoadPlan {
  const filtered = filterReportPlanForGrade(plan, gradeMin, gradeMax, classGradeById);
  const subjectTasks = filtered.subjectTasks.filter((t) => teacherIds.has(t.teacherId));
  const homeroomTasks = filtered.homeroomTasks.filter((t) => teacherIds.has(t.teacherId));
  const portraitKissTasks = filtered.portraitKissTasks.filter((t) => teacherIds.has(t.teacherId));
  return {
    ...filtered,
    subjectTasks,
    homeroomTasks,
    portraitKissTasks,
    stats: {
      classes: new Set(subjectTasks.map((t) => t.classId)).size,
      subjectTeachers: new Set([...subjectTasks, ...homeroomTasks].map((t) => t.teacherId)).size,
      templateSubjects: plan.stats.templateSubjects,
      skippedStaffingRows: plan.stats.skippedStaffingRows,
      skippedNotInEvaluation: plan.stats.skippedNotInEvaluation,
      portraitTeachers: new Set(portraitKissTasks.map((t) => t.teacherId)).size,
    },
  };
}
