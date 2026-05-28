/**
 * 小学段 G4–G6 压测用「期中学业报告（测试）」蓝图。
 * 由 tools/load-tests/scripts/seed-midterm-primary-test-report.ts 写入数据库，也可在测试中 import 校验结构。
 */

export const MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE = '期中学业报告（测试）';

export type MidtermPrimaryDimensionDef = {
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  /** 考试学科维度满分（多维度之和应为 100） */
  examMaxScore?: number;
};

export type MidtermPrimarySubjectBlueprint = {
  /** 按课程 name 子串优先匹配（先写更具体的） */
  courseNamePatterns: string[];
  subjectNameZh: string;
  subjectNameEn: string;
  enableScore: boolean;
  enableTeacherComment: boolean;
  enableLearningQuality: boolean;
  enableTarget: boolean;
  dimensions: MidtermPrimaryDimensionDef[];
};

/** 语数外：考试学科，测评成绩；其余：学科评价（目标 + 评语） */
export const MIDTERM_PRIMARY_G46_SUBJECTS: MidtermPrimarySubjectBlueprint[] = [
  {
    courseNamePatterns: ['语文-人教版', '语文'],
    subjectNameZh: '语文',
    subjectNameEn: 'Chinese',
    enableScore: true,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '识字与写字', dimensionLabelEn: 'Literacy and Writing', examMaxScore: 25 },
      { dimensionLabelZh: '阅读与鉴赏', dimensionLabelEn: 'Reading and Appreciation', examMaxScore: 25 },
      { dimensionLabelZh: '表达与交流', dimensionLabelEn: 'Expression and Communication', examMaxScore: 25 },
      { dimensionLabelZh: '梳理与探究', dimensionLabelEn: 'Organization and Inquiry', examMaxScore: 25 },
    ],
  },
  {
    courseNamePatterns: ['数学-沪科版', '数学-苏教版', '数学'],
    subjectNameZh: '数学',
    subjectNameEn: 'Mathematics',
    enableScore: true,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '数与代数', dimensionLabelEn: 'Number and Algebra', examMaxScore: 25 },
      { dimensionLabelZh: '图形与几何', dimensionLabelEn: 'Geometry', examMaxScore: 25 },
      { dimensionLabelZh: '统计与概率', dimensionLabelEn: 'Statistics and Probability', examMaxScore: 25 },
      { dimensionLabelZh: '综合应用', dimensionLabelEn: 'Integrated Application', examMaxScore: 25 },
    ],
  },
  {
    courseNamePatterns: ['英语-SUIS', '英语-外研社', '英语'],
    subjectNameZh: '英语',
    subjectNameEn: 'English',
    enableScore: true,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '听力', dimensionLabelEn: 'Listening', examMaxScore: 25 },
      { dimensionLabelZh: '口语', dimensionLabelEn: 'Speaking', examMaxScore: 25 },
      { dimensionLabelZh: '阅读', dimensionLabelEn: 'Reading', examMaxScore: 25 },
      { dimensionLabelZh: '写作', dimensionLabelEn: 'Writing', examMaxScore: 25 },
    ],
  },
  {
    courseNamePatterns: ['科学-SUIS', '科学'],
    subjectNameZh: '科学',
    subjectNameEn: 'Science',
    enableScore: false,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '科学探究', dimensionLabelEn: 'Scientific Inquiry' },
      { dimensionLabelZh: '科学观念', dimensionLabelEn: 'Scientific Concepts' },
    ],
  },
  {
    courseNamePatterns: ['体育-SUIS', '体育'],
    subjectNameZh: '体育',
    subjectNameEn: 'Physical Education',
    enableScore: false,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '运动技能', dimensionLabelEn: 'Motor Skills' },
      { dimensionLabelZh: '健康与习惯', dimensionLabelEn: 'Health and Habits' },
    ],
  },
  {
    courseNamePatterns: ['美术-SUIS', '美术'],
    subjectNameZh: '美术',
    subjectNameEn: 'Art',
    enableScore: false,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '造型表现', dimensionLabelEn: 'Visual Expression' },
      { dimensionLabelZh: '审美感知', dimensionLabelEn: 'Aesthetic Awareness' },
    ],
  },
  {
    courseNamePatterns: ['音乐-SUIS', '音乐'],
    subjectNameZh: '音乐',
    subjectNameEn: 'Music',
    enableScore: false,
    enableTeacherComment: true,
    enableLearningQuality: true,
    enableTarget: true,
    dimensions: [
      { dimensionLabelZh: '演唱与演奏', dimensionLabelEn: 'Singing and Performance' },
      { dimensionLabelZh: '音乐表现', dimensionLabelEn: 'Musical Expression' },
    ],
  },
];

export const MIDTERM_PRIMARY_G46_UNIFIED_LEVEL_DESCRIPTIONS = {
  A: '超越期望，游刃有余：深度掌握目标，具备自主探究意识。能将知识与技能迁移至新情境，创造性地解决问题。',
  B: '达成期望，稳步前行：有效达成目标，具备独立学习能力。能稳定运用所学，展现良好的应用基础。',
  C: '接近期望，尚需巩固：基本掌握目标，尚需提示引导。在适当帮助下，能够完成相关学习任务。',
  D: '未达期望，需要干预：尚未掌握目标，面临学习挑战。独立完成任务存在困难，需要持续的个性化干预与支持。',
} as const;
