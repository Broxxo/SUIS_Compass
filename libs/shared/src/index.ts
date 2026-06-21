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
export { isCourseIncludedInStaffing } from './courseStaffing.js';
export type { SelfStudyModule, SelfStudySlot, SelfStudyWeekday, SelfStudyGradeConfig, StaffingSemesterTerm } from './selfStudyStaffing.js';
export { SELF_STUDY_WEEKDAY_LABELS, selfStudyWeekdayLabel, parseStaffingSemesterTerm } from './selfStudyStaffing.js';
export type { ElectiveScheduleConfig, ElectiveCourse, ElectiveDurationPeriods, ElectiveScheduleMode } from './electiveStaffing.js';
export {
  ELECTIVE_PERIODS_PER_WEEK,
  electiveTeacherWeeklyPeriods,
  electiveTeacherWeeklyLoads,
  electiveScheduleMode,
  electiveDurationTypeLabel,
  electiveDurationTypeHint,
  parseElectiveDurationPeriods,
  formatElectiveTeachersDisplay,
  formatElectiveTeachersCompact,
  formatElectiveCourseCardTitle,
  electiveDurationTypeLabelCompact,
} from './electiveStaffing.js';
export type { ElectiveAgeBandId, ElectiveBandCapacitySummary, ElectiveTeacherConflict } from './electiveBands.js';
export {
  ELECTIVE_AGE_BANDS,
  electiveAgeBandLabel,
  gradeLevelToElectiveBand,
  electiveBandGradeLevels,
  resolveCourseElectiveBand,
  countElectiveBandEnrollment,
  summarizeElectiveBandCapacity,
  findElectiveTeacherConflicts,
  groupElectiveCoursesByBand,
} from './electiveBands.js';
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
  DEFAULT_TEACHING_RESEARCH_GROUPS,
  normalizeTeachingResearchGroups,
  type TeachingResearchGroup,
} from './teachingResearchGroups.js';
export {
  createTeachingSubjectGroupId,
  normalizeTeachingSubjectGroups,
  type TeachingSubjectGroup,
} from './teachingSubjectGroups.js';
export {
  parseAcademicYearSpan,
  suggestNextAcademicYearName,
  suggestPreviousAcademicYearName,
  bumpIsoDateByYears,
  getGradeCatalogIdForClass,
  getSegmentGraduationLevels,
  isGraduatingClass,
  graduateArchiveLabel,
  bumpClassNameForPromotion,
  getGradeIdByLevel,
  getGradeLevelById,
  getGradeLabelByLevel,
} from './academicYearPromotion.js';
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
