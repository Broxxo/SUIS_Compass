/** 学年 */
export interface AcademicYear {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}

/** 升学年预览（只读，不写库） */
export interface AcademicYearPromotionPreview {
  sourceYearId: string;
  sourceYearName: string;
  targetYearName: string;
  targetStartDate: string | null;
  targetEndDate: string | null;
  canExecute: boolean;
  blockReason: string | null;
  summary: {
    classesPromoted: number;
    classesGraduated: number;
    studentsPromoted: number;
    studentsGraduated: number;
    subjectAssignmentsCopied: number;
    subjectGroupMembersCopied: number;
    willSetDefaultYear: boolean;
  };
  classes: {
    promote: Array<{
      sourceClassId: string;
      sourceName: string;
      sourceGrade: number;
      targetName: string;
      targetGrade: number;
      studentCount: number;
      homeroomTeacherId: string | null;
      homeroomTeacherName: string | null;
      subjectAssignmentCount: number;
    }>;
    graduate: Array<{
      classId: string;
      className: string;
      grade: number;
      archiveLabel: string;
      studentCount: number;
      homeroomTeacherId: string | null;
      homeroomTeacherName: string | null;
      subjectAssignmentCount: number;
    }>;
  };
  staffing: {
    subjectCopies: Array<{
      sourceClassName: string;
      targetClassName: string;
      subjectName: string;
      teacherName: string;
    }>;
    graduateStaffingReleased: Array<{
      className: string;
      archiveLabel: string;
      homeroomTeacherName: string | null;
      subjectAssignmentCount: number;
    }>;
  };
  functionalRoles: {
    gradeHeadPromote: Array<{ fromScopeLabel: string; toScopeLabel: string; teacherName: string }>;
    gradeHeadRelease: Array<{ scopeLabel: string; teacherName: string }>;
    subjectGroupHeadCopy: Array<{ scopeLabel: string; teacherName: string }>;
    subjectGroupMembersCopied: number;
  };
  unchanged: string[];
  warnings: string[];
}

/** 全校组织架构部门（树形；parentId 为空表示根部门） */
export interface OrgDepartment {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export interface OrgDepartmentNode extends OrgDepartment {
  children: OrgDepartmentNode[];
}

/** 班级（属于某学年） */
export interface ClassItem {
  id: string;
  academicYearId: string;
  grade: number;
  name: string;
  teacherId?: string | null;
  teacherIds?: string[];
  /** 毕业班归档时间（升学年后留在源学年） */
  archivedAt?: string | null;
  archiveLabel?: string | null;
}

/** 学生（独立于学年，跨学年存在） */
export interface Student {
  id: string;
  name: string;
  nameZh?: string | null;
  nameEn?: string | null;
  gender: 'male' | 'female' | 'other';
  currentGrade?: number | null;
  currentClassId?: string | null;
  division?: string | null;
  entryDate?: string | null;
  status?: 'active' | 'graduated' | 'leave' | 'withdrawn';
  studentNumber?: string | null;
  dateOfBirth?: string | null;
}

/** 学籍：学生在某学年某班的归属 */
export interface Enrollment {
  id: string;
  studentId: string;
  classId: string;
  academicYearId: string;
}

/** 分组方案：一个班级下可有多套平行分组 */
export interface ClassGroupScheme {
  id: string;
  classId: string;
  name: string;
  scope: 'class-default' | 'subject' | 'project';
  subject?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 班级小组（暂时主要用 scope='class-default'） */
export interface ClassGroup {
  id: string;
  classId: string;
  schemeId: string;
  name: string;
  scope: 'class-default' | 'subject' | 'project';
  subject?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 小组成员：带加入/退出时间，支持换组历史 */
export interface ClassGroupMembership {
  id: string;
  classId: string;
  schemeId: string;
  groupId: string;
  studentId: string;
  joinedAt: string;
  leftAt?: string | null;
}

/** 课堂积分事件（个人 / 小组） */
export interface ClassPointEvent {
  id: string;
  classId: string;
  schemeId?: string | null; // 小组事件用；旧数据兼容
  type: 'individual' | 'group';
  studentId?: string | null; // type='individual' 时使用
  groupId?: string | null; // type='group' 时使用
  delta: number; // +1 / -1 / +5 ...
  reason?: string | null;
  createdAt: string;
}

export type Term = 'Semester 1' | 'Semester 2';
export type ReportGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'U';
export type TargetLevel = 'A' | 'B' | 'C' | 'D';

export interface StudentTermTargetDimension {
  id: string;
  dimensionKey: string;
  dimensionLabel: string;
  sortOrder: number;
  rating: TargetLevel | null;
  levelDescriptions: Partial<Record<TargetLevel, string>>;
}

export interface StudentTermSubjectReport {
  id: string;
  subjectKey: string;
  subjectName: string;
  midtermScore: number | null;
  midtermGrade: ReportGrade | null;
  finalScore: number | null;
  finalGrade: ReportGrade | null;
  /** 学习品质等第（A–D），与模板 enableLearningQuality 一致时填写 */
  learningQualityGrade?: TargetLevel | null;
  /** @deprecated 旧版分项考试成绩；新版考试学科仅使用 finalScore（满分 100） */
  examDimensionScores?: Record<string, number | null> | null;
  teacherComment: string | null;
  teacherId: string | null;
  dimensions: StudentTermTargetDimension[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StudentTermReport {
  id: string | null;
  studentId: string;
  academicYearId: string;
  term: Term;
  templateId?: string | null;
  homeroomComment: string | null;
  subjectReports: StudentTermSubjectReport[];
  createdAt: string | null;
  updatedAt: string | null;
}

export type ReportTemplateStatus = 'draft' | 'published' | 'closed';
export type HomeroomCommentMode = 'disabled' | 'optional' | 'required';
export type EvaluationModuleType = 'subject_score' | 'subject_comment' | 'non_score_comment';
export type ScoreVisibility = 'teacher_homeroom_admin';

export interface ReportTemplateDimension {
  id: string;
  dimensionKey: string;
  dimensionLabel: string;
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  sortOrder: number;
  levelDescriptions: Partial<Record<TargetLevel, string>>;
}

export interface ReportTemplateSubject {
  id: string;
  subjectKey: string;
  subjectName: string;
  subjectNameZh: string;
  subjectNameEn: string;
  moduleType: EvaluationModuleType;
  enableScore: boolean;
  enableTeacherComment: boolean;
  /** 是否展示「学习品质」A–D 评价 */
  enableLearningQuality?: boolean;
  scoreVisibility: ScoreVisibility;
  sortOrder: number;
  /** 创建报告时从学年模板库快照的分年级维度；已保存报告不随预设变更 */
  gradeDimensions?: Array<{
    gradeId: string;
    dimensions: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions?: Partial<Record<TargetLevel, string>>;
    }>;
  }>;
  dimensions: ReportTemplateDimension[];
}

export interface ReportTemplate {
  id: string | null;
  academicYearId: string;
  term: Term;
  title: string | null;
  /** 与课程设置中学段 id 一致；空字符串表示未区分学段（兼容旧数据） */
  schoolSegmentId?: string;
  /** 与模板学段对应的分数→等第下限（合并默认值后下发，便于前端换算展示） */
  scoreGradeMinScores?: Partial<Record<ReportGrade, number>> | Record<ReportGrade, number>;
  templateType?: 'portrait-evaluation';
  isActive?: boolean;
  publishedAt?: string | null;
  releasedAt?: string | null;
  status: ReportTemplateStatus;
  homeroomCommentMode: HomeroomCommentMode;
  subjects: ReportTemplateSubject[];
}

export interface EvaluationTemplateSummary {
  id: string;
  academicYearId: string;
  academicYearName: string;
  term: Term;
  title: string | null;
  status: ReportTemplateStatus;
  templateType: 'portrait-evaluation';
  isActive: boolean;
  publishedAt: string | null;
  releasedAt: string | null;
  homeroomCommentMode?: HomeroomCommentMode;
  schoolSegmentId?: string;
  updatedAt: string | null;
}

export type TeacherPortraitCollectionTemplateStatus = 'draft' | 'published' | 'closed';

export interface TeacherPortraitCollectionTemplateSummary {
  id: string;
  academicYearId: string;
  academicYearName: string;
  term: Term;
  title: string | null;
  collectionType: string;
  status: TeacherPortraitCollectionTemplateStatus;
  publishedAt: string | null;
  updatedAt: string | null;
  mySubmission?: { hasContent: boolean; updatedAt: string | null };
}

export interface TeacherPortraitCollectionProgressTeacher {
  teacherId: string;
  teacherName: string;
  updatedAt: string | null;
}

export interface TeacherPortraitCollectionProgress {
  templateId: string;
  totalTeachers: number;
  completedTeachers: number;
  pendingTeachers: number;
  completionRate: number;
  completed: TeacherPortraitCollectionProgressTeacher[];
  pending: Array<{ teacherId: string; teacherName: string }>;
}

export interface TeacherPortraitCollectionSubmission {
  teacherId: string;
  teacherName: string;
  diagnosis: ReportTeachingDiagnosis;
  updatedAt: string | null;
  hasContent: boolean;
}

export interface ReportYearDimensionPresetSubject {
  courseId?: string;
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  enableScore: boolean;
  enableTeacherComment: boolean;
  enableTarget: boolean;
  gradeDimensions?: Array<{
    gradeId: string;
    dimensions: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>;
  }>;
  dimensions: Array<{
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>;
}

/** @deprecated 考试学科不再配置分项满分，仅保留类型以兼容旧数据 */
export interface ReportExamDimensionScore {
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  score: number;
}

export interface ReportExamGradeConfig {
  gradeId: string;
  /** 本学科本年级考试满分（如 100、50）；未配置时按 100 计 */
  fullScore?: number;
  /** 得分率阈值（0-100，%），例如总分 100、A+=95 表示 ≥95 分为 A+ */
  percentBands: Partial<Record<ReportGrade, number>>;
  /** 已废弃：旧版按目标维度分项计分；新配置应为空数组 */
  dimensionScores?: ReportExamDimensionScore[];
}

export interface ReportExamSubjectConfig {
  courseId: string;
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  gradeConfigs: ReportExamGradeConfig[];
}

export interface ReportExamConfigScope {
  /** 纳入考试评价的课程 id（与课程设置一致） */
  subjectInclusion: string[];
  /** 已配置考试规则的学科明细 */
  subjects: ReportExamSubjectConfig[];
}

export interface ReportYearDimensionPreset {
  academicYearId: string;
  homeroomCommentMode: HomeroomCommentMode;
  subjects: ReportYearDimensionPresetSubject[];
  /** 学段 id → 纳入学业报告的课程 id 列表；缺省某学段时由前端按该学段年级上已保存的目标维度推断，推断为空则该学段暂无纳入课程（需勾选并保存「当前学科设置」） */
  stageInclusion?: Record<string, string[]>;
  /** 学段 id → 课程 id → 参加评价（目标维度+评语）的年级 id；缺省且课程在 stageInclusion 中时视为该学段全部年级 */
  evaluationGradeInclusion?: Record<string, Record<string, string[]>>;
  /** `${term}::${schoolSegmentId}` → 课程 id → 参加考试的年级 id；缺省且课程在考试学科列表中时由旧 subjectInclusion 推断 */
  examGradeInclusion?: Record<string, Record<string, string[]>>;
  /** key = `${term}::${schoolSegmentId}` 的考试配置 */
  examConfigs?: Record<string, ReportExamConfigScope>;
  /** 全学年共用的 A–D 等第说明（学科维度不再单独存 ABCD 描述） */
  unifiedLevelDescriptions?: Partial<Record<TargetLevel, string>>;
  updatedAt: string | null;
}

export interface ReportTemplateProgressTeacher {
  teacherId: string;
  teacherName: string;
}

export interface ReportTemplateProgressSubjectGap {
  subjectKey: string;
  subjectLabel: string;
  /** 岗位安排中的任课教师，便于催办 */
  teacherNames: string;
  pendingStudentCount: number;
}

export interface ReportTemplateProgressClassItem {
  classId: string;
  className: string;
  grade: number;
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
  pendingStudentNames: string[];
  teachers: ReportTemplateProgressTeacher[];
  reminderMessage: string;
  /** 班主任姓名（来自班级班主任岗位） */
  homeroomTeacherNames?: string[];
  /** 班主任综合评价是否仍有学生未填 */
  homeroomPending?: boolean;
  /** 仍有学生未满足要求的学科及任课教师 */
  subjectGaps?: ReportTemplateProgressSubjectGap[];
}

export interface ReportTemplateProgress {
  templateId: string;
  title: string | null;
  status: ReportTemplateStatus;
  academicYearId: string;
  term: Term;
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
  classes: ReportTemplateProgressClassItem[];
}

export interface TeacherReportTemplateProgressTrack {
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
}

export interface TeacherReportTemplateClassProgress {
  classId: string;
  className: string;
  grade: number;
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
  pendingStudentNames: string[];
  requiredSubjectKeys: string[];
  requiresHomeroomComment: boolean;
  /** 班主任且模板未禁用班主任评语时，学业报告下拉中展示「班主任综合评价」 */
  homeroomEvaluationAvailable?: boolean;
  /** 本班所负责学科维度下，已满足学科填报要求的学生数 */
  subjectCompletedStudents?: number;
  /** 本班在班主任综合评价开启时，已填写班主任评语的学生数 */
  homeroomCompletedStudents?: number;
}

export interface TeacherReportTemplateProgress {
  templateId: string;
  title: string | null;
  status: ReportTemplateStatus;
  academicYearId: string;
  term: Term;
  totalStudents: number;
  completedStudents: number;
  pendingStudents: number;
  completionRate: number;
  /** 有学科任务时：各学科填报进度（仅统计分配了学科的教师侧） */
  subjectProgress?: TeacherReportTemplateProgressTrack | null;
  /** 有班主任任务时：班主任综合评价填写进度 */
  homeroomProgress?: TeacherReportTemplateProgressTrack | null;
  classes: TeacherReportTemplateClassProgress[];
  /** 管理员按教师查看时返回 */
  viewingTeacherId?: string | null;
  viewingTeacherName?: string | null;
}

export interface ReportClassWeaknessRow {
  /** 学生薄弱项 */
  weakPoint: string;
  errorAnalysis: string;
  /** @deprecated 旧版第三列，新数据不再使用 */
  nextPlan?: string;
}

export interface ReportStudentAnalysisRow {
  studentId: string;
  learningAnalysis: string;
  supportPlan: string;
}

export interface ReportTeachingDiagnosis {
  keep: string;
  improve: string;
  stop: string;
  start: string;
}

export interface ReportClassSubjectInsights {
  /** @deprecated 已由班级整体分析替代 */
  weaknessRows: ReportClassWeaknessRow[];
  /** 班级整体分析（不纳入学生发布的学业报告） */
  classOverallAnalysis: string | null;
  studentAnalysisRows: ReportStudentAnalysisRow[];
  teachingDiagnosis: ReportTeachingDiagnosis | null;
  /** @deprecated 旧版纯文本反思，读取时可能由 teachingDiagnosis 或此字段回填 */
  teachingReflection: string | null;
  updatedAt: string | null;
}

/** 班主任在学生中心查看的学科教师班级整体分析汇总项 */
export interface ReportClassSubjectAnalysisSummaryItem {
  subjectKey: string;
  subjectName: string;
  teacherName: string | null;
  classOverallAnalysis: string | null;
  updatedAt: string | null;
}

export interface StaffingAssignment {
  id: string;
  academicYearId: string;
  classId: string;
  className: string;
  classGrade: number;
  subjectKey: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  /** 合作教学第二位教师为 1，默认可省略视为 0 */
  teacherSlot?: 0 | 1;
  updatedAt: string | null;
}

export type FunctionalRoleType = 'grade-head' | 'subject-group-head';

export interface FunctionalRoleAssignment {
  id: string;
  academicYearId: string;
  roleType: FunctionalRoleType;
  scopeKey: string;
  scopeLabel: string | null;
  teacherId: string | null;
  teacherName: string | null;
  updatedAt: string | null;
}

export const ALL_SUBJECTS_PORTRAIT_GROUP_ID = '__all-subjects__';

export type SubjectGroupPortraitSummary = {
  id: string;
  nameZh: string;
  nameEn: string | null;
  memberCount: number;
  subjectLabels: string[];
  isHead: boolean;
};

export type SubjectGroupMemberClassScore = {
  classId: string;
  className: string;
  grade: number;
  subjectKey: string;
  subjectName: string;
  avgScore: number | null;
  studentCount: number;
};

export type SubjectGroupMemberDashboard = {
  teacherId: string;
  teacherName: string;
  assignments: Array<{
    classId: string;
    className: string;
    grade: number;
    subjectKey: string;
    subjectName: string;
  }>;
  classScores: SubjectGroupMemberClassScore[];
  diagnosis: ReportTeachingDiagnosis | null;
  diagnosisHasContent: boolean;
};

export type GradeAverageRow = {
  grade: number;
  gradeLabel: string;
  subjectKey: string;
  subjectName: string;
  avgScore: number | null;
  studentCount: number;
  classCount: number;
};

export type SubjectGroupDataSource = 'report' | 'diagnosis';

export type SubjectScoreLine = {
  subjectKey: string;
  subjectName: string;
  avgScore: number | null;
  studentCount: number;
  teacherId: string;
  teacherName: string;
  diagnosisHasContent: boolean;
};

export type GradeRowTeacherCell = {
  teacherId: string;
  teacherName: string;
  diagnosisHasContent: boolean;
  subjectLabels: string[];
};

export type GradeRowClassCell = {
  classId: string;
  className: string;
  subjectScores: SubjectScoreLine[];
};

export type SubjectGroupGradeRow = {
  grade: number;
  gradeLabel: string;
  subjectAverages: SubjectScoreLine[];
  diagnosisSubmittedCount: number;
  diagnosisTotalCount: number;
  classes: GradeRowClassCell[];
  teachers: GradeRowTeacherCell[];
};

export type SubjectGroupPortraitDashboard = {
  group: {
    id: string;
    nameZh: string;
    nameEn: string | null;
    memberCount: number;
    subjectLabels: string[];
  };
  term: Term;
  dataSource: SubjectGroupDataSource;
  sourceId: string | null;
  sourceTitle: string | null;
  members: SubjectGroupMemberDashboard[];
  gradeAverages: GradeAverageRow[];
  gradeRows: SubjectGroupGradeRow[];
};
