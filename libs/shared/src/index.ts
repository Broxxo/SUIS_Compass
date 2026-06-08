export * from './types.js';
export * from './courseDomains.js';
export {
  TEACHER_PORTRAIT_COLLECTION_TYPES,
  teacherPortraitCollectionTypeLabel,
  type TeacherPortraitCollectionType,
} from './teacherPortraitCollections.js';
export * from './constants.js';
export {
  COURSE_PALETTE,
  courseColorOrDefault,
  getCourseCellHex,
  getCourseColorGradient,
} from './courseColors.js';
export { staffingSubjectKeyFromCourse } from './staffingSubjectKey.js';
export {
  getCourseReportSubjectLabels,
  presetSubjectKeyFromCourse,
  type CourseLabelSource,
} from './courseReportSubjectLabels.js';
export {
  buildDimensionRowsFromGradeSnapshot,
  parseReportGradeDimensionSnapshots,
  resolveTemplateDimensionsForGrade,
  type ReportGradeDimensionSnapshot,
  type ReportTemplateDimensionLike,
} from './reportTemplateGradeDimensions.js';
export {
  STAFFING_HOMEROOM_SUBJECT_KEY,
  staffingHomeroomSubjectName,
} from './staffingHomeroom.js';
export {
  MIDTERM_PRIMARY_G46_SUBJECTS,
  MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE,
  MIDTERM_PRIMARY_G46_UNIFIED_LEVEL_DESCRIPTIONS,
  type MidtermPrimaryDimensionDef,
  type MidtermPrimarySubjectBlueprint,
} from './testReportPresets/midtermPrimaryG46.js';
export {
  REPORT_SCORE_LETTER_GRADES,
  defaultReportScoreGradeMinScores,
  defaultPrimarySchoolExamScoreGradeMins,
  defaultJuniorHighExamScoreGradeMins,
  defaultExamScoreGradeMinsForSchoolSegment,
  configuredReportScoreGradeMins,
  parseConfiguredExamPercentBands,
  mergeReportScoreGradeMinScores,
  DEFAULT_EXAM_GRADE_FULL_SCORE,
  examFullScoreFromGradeConfig,
  examFullScoreFromBands,
  absoluteMinScoresFromPercentBands,
  validateConfiguredScoreGradeMinOrder,
  reportLetterGradeFromExamScore,
  reportLetterGradeFromExamPercentBands,
  reportLetterGradeFromScore,
  reportScoreLetterGradeToTargetLevel,
  reportPercentToTargetLevel,
  type ReportScoreLetterGrade,
} from './reportScoreGradeScale.js';
export {
  sortPublishedTasksNewestFirst,
  pickPreferredPublishedTask,
  type PublishedTaskPickInput,
} from './publishedTaskPick.js';
export {
  reportExamScopeKey,
  extractEvaluationGradeInclusion,
  extractExamGradeInclusion,
  inferExamGradeInclusionFromLegacyScope,
  resolveEvaluationGradesForCourse,
  resolveExamGradesForCourse,
  isEvaluationGradeIncluded,
  isExamGradeIncluded,
  courseIdsInEvaluationPool,
  courseIdsWithEvaluationGrades,
  courseIdsWithExamGrades,
  courseIdFromSubjectKey,
  buildSubjectKeyToCourseIdFromPresetPayload,
  resolveSubjectCourseId,
  effectiveTemplateSubjectEnableScore,
  hasReportYearInclusionRules,
  type EvaluationGradeInclusionMap,
  type ExamGradeInclusionMap,
  type ReportYearInclusionPresetSlice,
} from './reportEvaluationInclusion.js';
