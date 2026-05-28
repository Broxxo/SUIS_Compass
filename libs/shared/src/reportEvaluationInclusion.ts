/** segmentId → courseId → gradeIds participating in evaluation (year-level) */
export type EvaluationGradeInclusionMap = Record<string, Record<string, string[]>>;

/** `${term}::${segmentId}` → courseId → gradeIds participating in exam (term-specific) */
export type ExamGradeInclusionMap = Record<string, Record<string, string[]>>;

export function reportExamScopeKey(term: string, schoolSegmentId: string): string {
  return `${String(term ?? '').trim()}::${String(schoolSegmentId ?? '').trim()}`;
}

function sanitizeGradeIdList(raw: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x ?? '').trim();
    if (!id || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function sanitizeNestedGradeInclusion(raw: unknown): Record<string, Record<string, string[]>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, Record<string, string[]>> = {};
  for (const [segKey, segVal] of Object.entries(raw as Record<string, unknown>)) {
    const segmentId = String(segKey ?? '').trim();
    if (!segmentId || !segVal || typeof segVal !== 'object' || Array.isArray(segVal)) continue;
    const courses: Record<string, string[]> = {};
    for (const [courseKey, gradeVal] of Object.entries(segVal as Record<string, unknown>)) {
      const courseId = String(courseKey ?? '').trim();
      if (!courseId) continue;
      const gradeIds = Array.isArray(gradeVal)
        ? gradeVal.map((g) => String(g ?? '').trim()).filter(Boolean)
        : [];
      if (gradeIds.length > 0) courses[courseId] = [...new Set(gradeIds)];
    }
    if (Object.keys(courses).length > 0) out[segmentId] = courses;
  }
  return out;
}

export function extractEvaluationGradeInclusion(raw: unknown): EvaluationGradeInclusionMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const nested = (raw as { evaluationGradeInclusion?: unknown }).evaluationGradeInclusion;
  return sanitizeNestedGradeInclusion(nested);
}

export function extractExamGradeInclusion(raw: unknown): ExamGradeInclusionMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const nested = (raw as { examGradeInclusion?: unknown }).examGradeInclusion;
  return sanitizeNestedGradeInclusion(nested);
}

/** Legacy: derive exam grade inclusion from subjectInclusion + gradeConfigs when examGradeInclusion missing */
export function inferExamGradeInclusionFromLegacyScope(
  scopeKey: string,
  examConfigs: Record<
    string,
    {
      subjectInclusion?: string[];
      subjects?: Array<{ courseId?: string; gradeConfigs?: Array<{ gradeId?: string }> }>;
    }
  > | undefined,
  segmentGradeIds: string[],
): Record<string, string[]> {
  const scope = examConfigs?.[scopeKey];
  if (!scope) return {};
  const allowed = new Set(segmentGradeIds.map((g) => String(g).trim()).filter(Boolean));
  const out: Record<string, string[]> = {};
  const inclusion = Array.isArray(scope.subjectInclusion) ? scope.subjectInclusion : [];
  for (const cid of inclusion) {
    const courseId = String(cid ?? '').trim();
    if (!courseId) continue;
    const sub = (scope.subjects ?? []).find((s) => String(s.courseId ?? '').trim() === courseId);
    const fromConfigs = (sub?.gradeConfigs ?? [])
      .map((g) => String(g.gradeId ?? '').trim())
      .filter((id) => id && allowed.has(id));
    out[courseId] = fromConfigs.length > 0 ? [...new Set(fromConfigs)] : [...allowed];
  }
  return out;
}

export function resolveEvaluationGradesForCourse(
  segmentId: string,
  courseId: string,
  segmentGradeIds: string[],
  stageInclusion: Record<string, string[]> | undefined,
  evaluationGradeInclusion: EvaluationGradeInclusionMap | undefined,
): string[] {
  const seg = String(segmentId ?? '').trim();
  const cid = String(courseId ?? '').trim();
  if (!seg || !cid) return [];
  const pool = (stageInclusion?.[seg] ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (!pool.includes(cid)) return [];
  const allowed = new Set(segmentGradeIds.map((g) => String(g).trim()).filter(Boolean));
  const stored = evaluationGradeInclusion?.[seg]?.[cid];
  if (stored !== undefined) {
    return sanitizeGradeIdList(stored, allowed);
  }
  return [...allowed];
}

export function resolveExamGradesForCourse(
  scopeKey: string,
  courseId: string,
  segmentGradeIds: string[],
  evaluationGrades: string[],
  examGradeInclusion: ExamGradeInclusionMap | undefined,
  legacyExamConfigs?: Parameters<typeof inferExamGradeInclusionFromLegacyScope>[1],
): string[] {
  const cid = String(courseId ?? '').trim();
  if (!cid || evaluationGrades.length === 0) return [];
  const evalSet = new Set(evaluationGrades);
  const allowed = new Set(
    segmentGradeIds.map((g) => String(g).trim()).filter((g) => g && evalSet.has(g)),
  );
  const stored = examGradeInclusion?.[scopeKey]?.[cid];
  if (stored !== undefined) {
    return sanitizeGradeIdList(stored, allowed);
  }
  const legacy = inferExamGradeInclusionFromLegacyScope(scopeKey, legacyExamConfigs, [...allowed]);
  if (legacy[cid] !== undefined) {
    return sanitizeGradeIdList(legacy[cid], allowed);
  }
  // No exam config for this course in this term/segment — not an exam subject.
  return [];
}

export function isEvaluationGradeIncluded(
  segmentId: string,
  courseId: string,
  gradeId: string,
  segmentGradeIds: string[],
  stageInclusion: Record<string, string[]> | undefined,
  evaluationGradeInclusion: EvaluationGradeInclusionMap | undefined,
): boolean {
  const grades = resolveEvaluationGradesForCourse(
    segmentId,
    courseId,
    segmentGradeIds,
    stageInclusion,
    evaluationGradeInclusion,
  );
  return grades.includes(String(gradeId ?? '').trim());
}

export function isExamGradeIncluded(
  term: string,
  segmentId: string,
  courseId: string,
  gradeId: string,
  segmentGradeIds: string[],
  stageInclusion: Record<string, string[]> | undefined,
  evaluationGradeInclusion: EvaluationGradeInclusionMap | undefined,
  examGradeInclusion: ExamGradeInclusionMap | undefined,
  legacyExamConfigs?: Parameters<typeof inferExamGradeInclusionFromLegacyScope>[1],
): boolean {
  const seg = String(segmentId ?? '').trim();
  const gid = String(gradeId ?? '').trim();
  if (!seg || !gid) return false;
  const evalGrades = resolveEvaluationGradesForCourse(
    seg,
    courseId,
    segmentGradeIds,
    stageInclusion,
    evaluationGradeInclusion,
  );
  if (!evalGrades.includes(gid)) return false;
  const scopeKey = reportExamScopeKey(term, seg);
  const examGrades = resolveExamGradesForCourse(
    scopeKey,
    courseId,
    segmentGradeIds,
    evalGrades,
    examGradeInclusion,
    legacyExamConfigs,
  );
  return examGrades.includes(gid);
}

export function courseIdsInEvaluationPool(
  segmentId: string,
  stageInclusion: Record<string, string[]> | undefined,
): string[] {
  const seg = String(segmentId ?? '').trim();
  if (!seg) return [];
  return (stageInclusion?.[seg] ?? []).map((x) => String(x).trim()).filter(Boolean);
}

export function courseIdsWithEvaluationGrades(
  segmentId: string,
  segmentGradeIds: string[],
  stageInclusion: Record<string, string[]> | undefined,
  evaluationGradeInclusion: EvaluationGradeInclusionMap | undefined,
): string[] {
  return courseIdsInEvaluationPool(segmentId, stageInclusion).filter(
    (cid) =>
      resolveEvaluationGradesForCourse(
        segmentId,
        cid,
        segmentGradeIds,
        stageInclusion,
        evaluationGradeInclusion,
      ).length > 0,
  );
}

export function courseIdsWithExamGrades(
  term: string,
  segmentId: string,
  segmentGradeIds: string[],
  stageInclusion: Record<string, string[]> | undefined,
  evaluationGradeInclusion: EvaluationGradeInclusionMap | undefined,
  examGradeInclusion: ExamGradeInclusionMap | undefined,
  legacyExamConfigs?: Parameters<typeof inferExamGradeInclusionFromLegacyScope>[1],
): string[] {
  const scopeKey = reportExamScopeKey(term, segmentId);
  return courseIdsWithEvaluationGrades(
    segmentId,
    segmentGradeIds,
    stageInclusion,
    evaluationGradeInclusion,
  ).filter(
    (cid) =>
      resolveExamGradesForCourse(
        scopeKey,
        cid,
        segmentGradeIds,
        resolveEvaluationGradesForCourse(
          segmentId,
          cid,
          segmentGradeIds,
          stageInclusion,
          evaluationGradeInclusion,
        ),
        examGradeInclusion,
        legacyExamConfigs,
      ).length > 0,
  );
}
