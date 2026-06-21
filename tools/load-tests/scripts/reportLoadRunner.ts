/**
 * 学业报告压测执行器：HTTP 写入、并发池、轮次指标。
 */
import type pg from 'pg';
import {
  createJwtAuthProvider,
  createLegacyAuthProvider,
  resolveLoadTestPassword,
  shouldUseJwtAuth,
} from './loadTestAuth.js';
import {
  buildReportLoadSuite,
  printReportSubjectSettings,
  type HomeroomFillTask,
  type PortraitKissTask,
  type ReportLoadPlan,
  type ReportLoadSuite,
  type ReportTemplateSpec,
  type SubjectFillTask,
} from './reportLoadContext.js';
import {
  printTierConsistencyReport,
  verifyReportTierConsistency,
  type TierConsistencyReport,
} from './verifyReportTierConsistency.js';

export type TargetLevel = 'A' | 'B' | 'C' | 'D';

export type ClassInsightTask = {
  teacherId: string;
  classId: string;
  className: string;
  subjectKey: string;
  subjectName: string;
  templateId: string;
  enableScore: boolean;
  studentIds: string[];
};

export type RoundMetrics = {
  round: number;
  marker: string;
  templateId: string;
  subjectOk: number;
  subjectFail: number;
  subjectTotal: number;
  subjectElapsedMs: number;
  subjectThroughput: number;
  subjectLatencyP50: number;
  subjectLatencyP95: number;
  subjectLatencyP99: number;
  insightOk: number;
  insightFail: number;
  insightTotal: number;
  insightElapsedMs: number;
  homeroomOk: number;
  homeroomFail: number;
  homeroomTotal: number;
  homeroomElapsedMs: number;
  homeroomLatencyP50: number;
  homeroomLatencyP95: number;
  portraitOk: number;
  portraitFail: number;
  portraitTotal: number;
  portraitElapsedMs: number;
  totalElapsedMs: number;
  errors: Array<{ key: string; status: number; body: string }>;
  planStats: ReportLoadPlan['stats'];
};

export type RoundVerification = {
  round: number;
  marker: string;
  sampleComments: number;
  markerComments: number;
  stalePriorRoundComments: number;
  examWrites: number;
  examWithScore: number;
  nonExamWrites: number;
  nonExamWithScore: number;
  insightsTotal: number;
  insightsWithClassAnalysis: number;
  examInsightsWithAnalysis: number;
  examInsightsMissingAnalysis: number;
  insightsWithFullStudentRows: number;
  examScoreMin: number | null;
  examScoreMax: number | null;
  examScoreBuckets: number;
  portraitSubmissions: number;
  portraitWithMarker: number;
  issues: string[];
};

export type LoadTestConfig = {
  apiBase: string;
  /** HTTP 请求头（JWT 或开发环境 X-User-Id） */
  authHeaders: (teacherId: string) => Promise<Record<string, string>>;
  /** 多学段学业报告（先锋小学 G1–6 + 先锋初中 G7–9） */
  reportSpecs: ReportTemplateSpec[];
  /** 学期：默认下学期 Semester 2 */
  term: 'Semester 1' | 'Semester 2';
  /** 每位教师需完成的教学诊断；空数组 = 仅压测学业报告 */
  portraitTemplateTitles: string[];
  /** 仅学业报告（学科/班主任/班科分析），跳过教学诊断 KISS */
  reportsOnly: boolean;
  rounds: number;
  concurrency: number;
  retries: number;
  requestTimeoutMs: number;
  maxWallMs: number;
  /** 班科分析（全班 25 人）payload 较大，单独限流 */
  insightConcurrency: number;
  verifyLastRoundOnly: boolean;
  /** 跳过三层一致性 HTTP 复查（压测写入后省数十秒） */
  skipTierVerify: boolean;
  /** 跳过控制台学科设置明细 */
  skipSubjectSettingsLog: boolean;
};

const DEFAULT_TERM = 'Semester 2' as const;

const DEFAULT_REPORT_SPECS: ReportTemplateSpec[] = [
  { templateTitle: '小学期末学业报告', gradeMin: 1, gradeMax: 6, term: DEFAULT_TERM },
  { templateTitle: '初中期末学业报告', gradeMin: 7, gradeMax: 9, term: DEFAULT_TERM },
];

const DEFAULT_PORTRAIT_TITLES: string[] = [];

const DEFAULT_CONFIG: Omit<LoadTestConfig, 'apiBase'> = {
  reportSpecs: DEFAULT_REPORT_SPECS,
  term: DEFAULT_TERM,
  portraitTemplateTitles: DEFAULT_PORTRAIT_TITLES,
  reportsOnly: true,
  rounds: 3,
  concurrency: 64,
  retries: 2,
  requestTimeoutMs: 25_000,
  maxWallMs: 120_000,
  insightConcurrency: 16,
  verifyLastRoundOnly: true,
  skipTierVerify: false,
  skipSubjectSettingsLog: false,
};

const SCORE_BUCKETS = [
  { label: '优秀', min: 90, max: 100 },
  { label: '良好', min: 80, max: 89 },
  { label: '中等', min: 70, max: 79 },
  { label: '及格', min: 60, max: 69 },
  { label: '待提高', min: 40, max: 59 },
  { label: '学弱', min: 10, max: 39 },
] as const;

function roundMarker(round: number): string {
  return `R${round}压测`;
}

function hashSeed(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

function pickFrom<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length] as T;
}

function examScoreForStudent(task: SubjectFillTask, round: number): number {
  const h = hashSeed(task.studentId, task.subjectKey, task.classId, round);
  const bucket = SCORE_BUCKETS[h % SCORE_BUCKETS.length];
  const full = task.examFullScore ?? 100;
  const absMin = Math.max(0, Math.round((full * bucket.min) / 100));
  const absMax = Math.min(full, Math.round((full * bucket.max) / 100));
  const lo = Math.min(absMin, absMax);
  const hi = Math.max(absMin, absMax);
  const span = hi - lo + 1;
  return lo + (h % span);
}

function ratingForScore(score: number): TargetLevel {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

export function buildSubjectPayload(task: SubjectFillTask, round: number) {
  const h = hashSeed(task.studentId, task.subjectKey, round);
  const finalScore = task.enableScore ? examScoreForStudent(task, round) : null;
  const rating: TargetLevel = finalScore != null ? ratingForScore(finalScore) : pickFrom(['A', 'B', 'C', 'D'] as const, h);
  return {
    subjectName: task.subjectName,
    midtermScore: null,
    finalScore,
    examDimensionScores: null,
    teacherComment: null,
    learningQualityGrade: pickFrom(['A', 'B', 'C'] as const, h + 3),
    dimensions: task.dimensions.map((d, idx) => ({
      dimensionKey: d.dimensionKey,
      dimensionLabel: d.dimensionLabel,
      rating: pickFrom(['A', 'B', 'C', 'D'] as const, h + idx + 7),
      levelDescriptions: {},
    })),
  };
}

function buildClassOverallAnalysis(task: ClassInsightTask, round: number): string {
  const marker = roundMarker(round);
  const h = hashSeed(task.classId, task.subjectKey, round);
  const weak = pickFrom(['综合运用', '审题能力', '计算准确度', '知识迁移', '规范表达'], h);
  const strong = pickFrom(['课堂参与', '合作意识', '思维活跃', '作业质量', '自主预习'], h + 1);
  return [
    `${marker} ${task.className} · ${task.subjectName} 班级整体分析`,
    `一、测评概况：本班共${task.studentIds.length}人，成绩覆盖优秀/良好/中等/及格/待提高/学弱各分数段，分布较为分散。`,
    `二、优势表现：多数学生在${strong}方面表现稳定，学习氛围积极，目标达成度整体向好。`,
    `三、薄弱环节：部分学生在${weak}方面仍需加强，个别学生存在波动，需持续跟进。`,
    `四、教学对策：下阶段推进分层辅导与错题复盘，设计针对性巩固任务，并加强家校沟通协同育人。`,
    `五、下步计划：结合本次测评数据优化单元教学设计，关注临界生与学困生个别化支持。`,
  ].join('\n');
}

function buildStudentAnalysisRows(task: ClassInsightTask, round: number) {
  const marker = roundMarker(round);
  const levels = ['优异', '良好', '稳定', '需关注'] as const;
  const traits = ['理解力强', '态度认真', '基础扎实', '进步明显', '潜力突出'] as const;
  const gaps = ['审题细节', '计算规范', '知识迁移', '表达完整', '时间管理'] as const;
  const supports = ['课后答疑', '分层作业', '同伴互助', '家校沟通', '个别辅导'] as const;
  return task.studentIds.map((studentId, idx) => {
    const h = hashSeed(studentId, task.subjectKey, round, idx);
    return {
      studentId,
      learningAnalysis: [
        `${marker} 学情分析`,
        `该生本次测评表现${pickFrom(levels, h)}，${pickFrom(traits, h + 1)}。`,
        `需重点关注${pickFrom(gaps, h + 2)}，建议课堂多给予展示与反馈机会。`,
      ].join(' '),
      supportPlan: [
        `${marker} 支持计划`,
        `采取${pickFrom(supports, h + 3)}策略，`,
        `每周跟进一次学习清单，并与家长保持阶段性沟通，确保改进措施落地。`,
      ].join(' '),
    };
  });
}

export function buildInsightPayload(task: ClassInsightTask, round: number) {
  return {
    classOverallAnalysis: buildClassOverallAnalysis(task, round),
    studentAnalysisRows: buildStudentAnalysisRows(task, round),
  };
}

function buildHomeroomComment(task: HomeroomFillTask, round: number): string {
  const marker = roundMarker(round);
  const h = hashSeed(task.studentId, task.classId, round);
  const attitude = pickFrom(['积极', '端正', '认真', '尚可'], h);
  const participate = pickFrom(['主动', '稳定', '逐步提升', '需更多鼓励'], h + 1);
  const highlight = pickFrom(['合作意识', '自主学习', '阅读习惯', '表达能力', '责任意识'], h + 2);
  const suggest = pickFrom(['巩固基础知识', '加强阅读积累', '提升时间管理', '拓展探究学习', '规范作业习惯'], h + 3);
  return [
    `${marker} 班主任综合评价`,
    `学生：${task.studentName}（${task.className}）`,
    `本学期整体表现：学习态度${attitude}，课堂参与${participate}，与同学相处融洽，能按要求完成学习任务。`,
    `成长亮点：在${highlight}方面表现突出，能主动反思并调整学习策略，综合素质稳步提升。`,
    `改进建议：建议继续${suggest}，家长可配合督促作息与复习计划，期待下学期持续进步。`,
    `班主任寄语：愿保持好奇心与毅力，在下一阶段取得更扎实的成长。`,
  ].join('\n');
}

export function buildPortraitKissPayload(task: PortraitKissTask, round: number) {
  const marker = roundMarker(round);
  const h = hashSeed(task.teacherId, round);
  const focus = pickFrom(['分层教学', '情境化任务', '课堂即时反馈', '项目式学习', '错题复盘'], h);
  return {
    diagnosis: {
      keep: `${marker} Keep：坚持${focus}与学情诊断闭环，学生参与度和目标达成度较好。`,
      improve: `${marker} Improve：细化分层作业与个别辅导记录，提升临界生转化效率。`,
      stop: `${marker} Stop：减少单向讲授与机械重复练习，避免评价反馈滞后。`,
      start: `${marker} Start：引入更多探究式任务与同伴互评，推动学生自主反思与迁移应用。`,
    },
  };
}

async function putJson(
  apiBase: string,
  url: string,
  teacherId: string,
  body: unknown,
  timeoutMs: number,
  authHeaders: (teacherId: string) => Promise<Record<string, string>>,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const ac = new AbortController();
  const t0 = Date.now();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = await authHeaders(teacherId);
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, body: text.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: (e as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function putSubjectReport(
  apiBase: string,
  task: SubjectFillTask,
  round: number,
  timeoutMs: number,
  authHeaders: (teacherId: string) => Promise<Record<string, string>>,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/students/${encodeURIComponent(task.studentId)}` +
    `/terms/${encodeURIComponent(task.academicYearId)}/${encodeURIComponent(task.term)}` +
    `/templates/${encodeURIComponent(task.templateId)}/subjects/${encodeURIComponent(task.subjectKey)}`;
  return putJson(apiBase, url, task.teacherId, buildSubjectPayload(task, round), timeoutMs, authHeaders);
}

export async function putClassInsights(
  apiBase: string,
  task: ClassInsightTask,
  round: number,
  timeoutMs: number,
  authHeaders: (teacherId: string) => Promise<Record<string, string>>,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/templates/${encodeURIComponent(task.templateId)}` +
    `/classes/${encodeURIComponent(task.classId)}/subjects/${encodeURIComponent(task.subjectKey)}/class-insights`;
  return putJson(apiBase, url, task.teacherId, buildInsightPayload(task, round), timeoutMs, authHeaders);
}

export async function putHomeroomComment(
  apiBase: string,
  task: HomeroomFillTask,
  round: number,
  timeoutMs: number,
  authHeaders: (teacherId: string) => Promise<Record<string, string>>,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/students/${encodeURIComponent(task.studentId)}` +
    `/terms/${encodeURIComponent(task.academicYearId)}/${encodeURIComponent(task.term)}` +
    `/templates/${encodeURIComponent(task.templateId)}/homeroom-comment`;
  return putJson(apiBase, url, task.teacherId, { comment: buildHomeroomComment(task, round) }, timeoutMs, authHeaders);
}

export async function putPortraitKiss(
  apiBase: string,
  task: PortraitKissTask,
  round: number,
  timeoutMs: number,
  authHeaders: (teacherId: string) => Promise<Record<string, string>>,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url = `${base}/api/classes/teacher-portrait/collections/${encodeURIComponent(task.templateId)}`;
  return putJson(apiBase, url, task.teacherId, buildPortraitKissPayload(task, round), timeoutMs, authHeaders);
}

export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let idx = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      await worker(items[i] as T);
      done += 1;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(runners);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}

async function withRetries<T extends { ok: boolean }>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let last: T = await fn();
  for (let a = 1; a <= retries && !last.ok; a += 1) {
    await new Promise((r) => setTimeout(r, 60 * a));
    last = await fn();
  }
  return last;
}

function buildInsightTasks(subjectTasks: SubjectFillTask[]): ClassInsightTask[] {
  const byKey = new Map<string, ClassInsightTask & { seen: Set<string> }>();
  for (const t of subjectTasks) {
    const key = `${t.classId}::${t.subjectKey}`;
    let hit = byKey.get(key);
    if (!hit) {
      hit = {
        teacherId: t.teacherId,
        classId: t.classId,
        className: t.className,
        subjectKey: t.subjectKey,
        subjectName: t.subjectName,
        templateId: t.templateId,
        enableScore: t.enableScore,
        studentIds: [],
        seen: new Set<string>(),
      };
      byKey.set(key, hit);
    }
    if (!hit.seen.has(t.studentId)) {
      hit.seen.add(t.studentId);
      hit.studentIds.push(t.studentId);
    }
  }
  return [...byKey.values()].map(({ seen: _seen, ...task }) => task);
}

export async function runLoadRound(
  plan: ReportLoadPlan,
  round: number,
  config: LoadTestConfig,
): Promise<RoundMetrics> {
  const { subjectTasks, homeroomTasks, portraitKissTasks, template, stats } = plan;
  const insightTasks = buildInsightTasks(subjectTasks);
  const errors: Array<{ key: string; status: number; body: string }> = [];
  const pushError = (key: string, status: number, body: string) => {
    if (errors.length < 30) errors.push({ key, status, body });
  };

  const subjectLatencies: number[] = [];
  let subjectOk = 0;
  let subjectFail = 0;
  const subjectStart = Date.now();
  console.log(
    `[R${round}] 分阶段限流：学科 ${subjectTasks.length}@${config.concurrency} → 班主任 ${homeroomTasks.length} + KISS ${portraitKissTasks.length} → 班科分析 ${insightTasks.length}@${config.insightConcurrency}`,
  );

  await runPool(
    subjectTasks,
    config.concurrency,
    async (task) => {
      const last = await withRetries(
        () => putSubjectReport(config.apiBase, task, round, config.requestTimeoutMs, config.authHeaders),
        config.retries,
      );
      subjectLatencies.push(last.ms);
      if (last.ok) subjectOk += 1;
      else {
        subjectFail += 1;
        pushError(`${task.teacherName}/${task.className}/${task.subjectName}`, last.status, last.body);
      }
    },
    (done, total) => {
      if (done % 500 === 0 || done === total) console.log(`[R${round} subject] ${done}/${total}`);
    },
  );
  const subjectElapsedMs = Date.now() - subjectStart;

  let homeroomOk = 0;
  let homeroomFail = 0;
  const homeroomLatencies: number[] = [];
  const homeroomStart = Date.now();
  const activeHomeroomTasks = homeroomTasks.filter((t) => t.homeroomCommentMode !== 'disabled');
  const homeroomPromise =
    activeHomeroomTasks.length > 0
      ? runPool(
          activeHomeroomTasks,
          config.concurrency,
          async (task) => {
            const last = await withRetries(
              () => putHomeroomComment(config.apiBase, task, round, config.requestTimeoutMs, config.authHeaders),
              config.retries,
            );
            homeroomLatencies.push(last.ms);
            if (last.ok) homeroomOk += 1;
            else {
              homeroomFail += 1;
              pushError(`${task.teacherName}/${task.className}/班主任`, last.status, last.body);
            }
          },
          (done, total) => {
            if (done % 200 === 0 || done === total) console.log(`[R${round} homeroom] ${done}/${total}`);
          },
        )
      : Promise.resolve();

  let portraitOk = 0;
  let portraitFail = 0;
  const portraitStart = Date.now();
  const portraitPromise =
    portraitKissTasks.length > 0
      ? runPool(
          portraitKissTasks,
          Math.min(40, config.concurrency),
          async (task) => {
            const last = await withRetries(
              () => putPortraitKiss(config.apiBase, task, round, config.requestTimeoutMs, config.authHeaders),
              config.retries,
            );
            if (last.ok) portraitOk += 1;
            else {
              portraitFail += 1;
              pushError(`${task.teacherName}/KISS`, last.status, last.body);
            }
          },
          (done, total) => {
            if (done % 25 === 0 || done === total) console.log(`[R${round} portrait-kiss] ${done}/${total}`);
          },
        )
      : Promise.resolve();

  const parallelStart = Date.now();
  let insightOk = 0;
  let insightFail = 0;
  const insightPromise = runPool(
    insightTasks,
    config.insightConcurrency,
    async (task) => {
      const last = await withRetries(
        () => putClassInsights(config.apiBase, task, round, config.requestTimeoutMs, config.authHeaders),
        config.retries,
      );
      if (last.ok) insightOk += 1;
      else {
        insightFail += 1;
        pushError(`${task.className}/${task.subjectName}/班科分析`, last.status, last.body);
      }
    },
    (done, total) => {
      if (done % 20 === 0 || done === total) console.log(`[R${round} insights] ${done}/${total}`);
    },
  );
  await Promise.all([homeroomPromise, portraitPromise, insightPromise]);
  const parallelElapsedMs = Date.now() - parallelStart;
  const homeroomElapsedMs = parallelElapsedMs;
  const portraitElapsedMs = parallelElapsedMs;
  const insightElapsedMs = parallelElapsedMs;

  subjectLatencies.sort((a, b) => a - b);
  homeroomLatencies.sort((a, b) => a - b);

  if (subjectFail > 0 || insightFail > 0 || homeroomFail > 0 || portraitFail > 0) {
    throw new Error(
      `Round ${round}: ${subjectFail} subject, ${insightFail} insight, ${homeroomFail} homeroom, ${portraitFail} portrait failures`,
    );
  }

  const totalElapsedMs = subjectElapsedMs + parallelElapsedMs;

  return {
    round,
    marker: roundMarker(round),
    templateId: template.id,
    subjectOk,
    subjectFail,
    subjectTotal: subjectTasks.length,
    subjectElapsedMs,
    subjectThroughput: subjectElapsedMs > 0 ? (subjectOk / subjectElapsedMs) * 1000 : 0,
    subjectLatencyP50: percentile(subjectLatencies, 50),
    subjectLatencyP95: percentile(subjectLatencies, 95),
    subjectLatencyP99: percentile(subjectLatencies, 99),
    insightOk,
    insightFail,
    insightTotal: insightTasks.length,
    insightElapsedMs,
    homeroomOk,
    homeroomFail,
    homeroomTotal: activeHomeroomTasks.length,
    homeroomElapsedMs,
    homeroomLatencyP50: percentile(homeroomLatencies, 50),
    homeroomLatencyP95: percentile(homeroomLatencies, 95),
    portraitOk,
    portraitFail,
    portraitTotal: portraitKissTasks.length,
    portraitElapsedMs,
    totalElapsedMs,
    errors,
    planStats: stats,
  };
}

export async function verifyRoundWrites(
  pool: pg.Pool,
  plan: ReportLoadPlan,
  round: number,
  priorRound?: number,
): Promise<RoundVerification> {
  const marker = roundMarker(round);
  const priorMarker = priorRound ? roundMarker(priorRound) : null;
  const issues: string[] = [];
  const templateId = plan.template.id;

  const homeroomSample = await pool.query(
    `SELECT homeroom_comment
     FROM student_term_reports
     WHERE template_id = $1
     LIMIT 500`,
    [templateId],
  );
  let markerHomeroomComments = 0;
  let stalePriorRoundHomeroom = 0;
  for (const row of homeroomSample.rows) {
    const c = String(row.homeroom_comment ?? '');
    if (c.includes(marker)) markerHomeroomComments += 1;
    if (priorMarker && c.includes(priorMarker)) stalePriorRoundHomeroom += 1;
  }

  const scoreCheck = await pool.query(
    `SELECT c.grade AS class_grade, sr.subject_key, sr.final_score, sr.teacher_comment, sr.updated_at
     FROM student_term_subject_reports sr
     JOIN student_term_reports r ON r.id = sr.report_id
     JOIN student_enrollments e ON e.student_id = r.student_id AND e.academic_year_id = r.academic_year_id
     JOIN classes c ON c.id = e.class_id
     WHERE r.template_id = $1`,
    [templateId],
  );

  const gradeItems = await import('./reportLoadContext.js').then((m) => m.loadGradeConfigItemsForReport(pool));
  const examKeys = new Set<string>();
  const nonExamKeys = new Set<string>();
  const examFullScoreByKey = new Map<string, number>();
  for (const row of plan.subjectSettings.rows) {
    const key = `${row.gradeLevel}::${row.subjectKey}`;
    if (row.effectiveEnableScore) examKeys.add(key);
    else nonExamKeys.add(key);
  }
  for (const t of plan.subjectTasks) {
    if (!t.enableScore || t.examFullScore == null) continue;
    examFullScoreByKey.set(`${t.classGrade}::${t.subjectKey}`, t.examFullScore);
  }

  let examWrites = 0;
  let examWithScore = 0;
  let nonExamWrites = 0;
  let nonExamWithScore = 0;
  let subjectCommentLeaks = 0;
  const examScores: number[] = [];
  const examScorePercents: number[] = [];
  const examScoreBucketHits = new Set<number>();

  for (const row of scoreCheck.rows) {
    const g = Number(row.class_grade);
    const sk = String(row.subject_key);
    const key = `${g}::${sk}`;
    const finalScore = row.final_score == null ? null : Number(row.final_score);
    const hasScore = finalScore != null && Number.isFinite(finalScore);
    if (String(row.teacher_comment ?? '').trim()) subjectCommentLeaks += 1;

    if (examKeys.has(key)) {
      examWrites += 1;
      if (hasScore) {
        examWithScore += 1;
        examScores.push(finalScore!);
        const full = examFullScoreByKey.get(key) ?? 100;
        const pct = full > 0 ? (finalScore! / full) * 100 : 0;
        examScorePercents.push(pct);
        const bucketIdx = SCORE_BUCKETS.findIndex((b) => pct >= b.min && pct <= b.max);
        if (bucketIdx >= 0) examScoreBucketHits.add(bucketIdx);
      } else {
        issues.push(`考试学科 G${g} ${sk} 缺少测评成绩(final_score)`);
      }
    } else if (nonExamKeys.has(key)) {
      nonExamWrites += 1;
      if (hasScore) {
        nonExamWithScore += 1;
        issues.push(`非考试学科 G${g} ${sk} 不应有分数但 final_score=${row.final_score}`);
      }
    }
  }

  const examScoreMin = examScores.length ? Math.min(...examScores) : null;
  const examScoreMax = examScores.length ? Math.max(...examScores) : null;
  if (examWithScore > 0 && examScoreBucketHits.size < 4) {
    issues.push(`考试得分率段覆盖不足: 仅 ${examScoreBucketHits.size}/6 个分数段有学生`);
  }
  const pctMin = examScorePercents.length ? Math.min(...examScorePercents) : null;
  const pctMax = examScorePercents.length ? Math.max(...examScorePercents) : null;
  if (examWithScore > 0 && (pctMin == null || pctMax == null || pctMax - pctMin < 30)) {
    issues.push(`考试得分率分布跨度偏小: min=${pctMin?.toFixed(1)}% max=${pctMax?.toFixed(1)}%`);
  }

  const insightRows = await pool.query(
    `SELECT c.grade, c.id AS class_id, i.subject_key, i.class_overall_analysis, i.student_analysis_rows
     FROM student_report_subject_class_insights i
     JOIN classes c ON c.id = i.class_id
     WHERE i.template_id = $1`,
    [templateId],
  );
  const classSizeRows = await pool.query(
    `SELECT e.class_id, COUNT(DISTINCT e.student_id)::int AS student_count
     FROM student_enrollments e
     WHERE e.academic_year_id = $1
     GROUP BY e.class_id`,
    [plan.template.academicYearId],
  );
  const studentsPerClass = new Map<string, number>(
    classSizeRows.rows.map((r: { class_id: string; student_count: number }) => [
      String(r.class_id),
      Number(r.student_count),
    ]),
  );
  let insightsWithClassAnalysis = 0;
  let examInsightsWithAnalysis = 0;
  let examInsightsMissingAnalysis = 0;
  let insightsWithFullStudentRows = 0;
  for (const row of insightRows.rows) {
    const text = String(row.class_overall_analysis ?? '');
    if (!text.includes(marker)) continue;
    insightsWithClassAnalysis += 1;
    const g = Number(row.grade);
    const sk = String(row.subject_key);
    if (examKeys.has(`${g}::${sk}`)) {
      examInsightsWithAnalysis += 1;
    }
    const rowsRaw = row.student_analysis_rows;
    const parsed = Array.isArray(rowsRaw)
      ? rowsRaw
      : typeof rowsRaw === 'string'
        ? (JSON.parse(rowsRaw) as unknown[])
        : [];
    const withMarker = parsed.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      const rec = r as Record<string, unknown>;
      const la = String(rec.learningAnalysis ?? '');
      const sp = String(rec.supportPlan ?? '');
      return la.includes(marker) && sp.includes(marker) && String(rec.studentId ?? '').trim();
    });
    const classId = String(row.class_id ?? '');
    const expectedStudents = studentsPerClass.get(classId) ?? withMarker.length;
    if (withMarker.length >= expectedStudents) insightsWithFullStudentRows += 1;
  }
  for (const key of examKeys) {
    const [g, sk] = key.split('::');
    const found = insightRows.rows.some(
      (row: { grade: number; subject_key: string; class_overall_analysis: string | null }) =>
        Number(row.grade) === Number(g) &&
        String(row.subject_key) === sk &&
        String(row.class_overall_analysis ?? '').includes(marker),
    );
    if (!found) {
      examInsightsMissingAnalysis += 1;
      issues.push(`考试学科 G${g} ${sk} 缺少班级整体分析`);
    }
  }

  const expectedInsightPairs = new Set(
    plan.subjectTasks.map((t) => `${t.classId}::${t.subjectKey}`),
  ).size;
  if (insightsWithClassAnalysis < expectedInsightPairs * 0.9) {
    issues.push(`班级整体分析覆盖率偏低: ${insightsWithClassAnalysis} (预期约 ${expectedInsightPairs} 班科)`);
  }

  if (insightsWithFullStudentRows < expectedInsightPairs * 0.85) {
    issues.push(
      `个别学生分析覆盖率偏低: ${insightsWithFullStudentRows}/${expectedInsightPairs} 班科已覆盖全班学生`,
    );
  }
  if (subjectCommentLeaks > 0) {
    issues.push(`学科评语应已禁用，但仍有 ${subjectCommentLeaks} 条 teacher_comment`);
  }
  if (plan.template.homeroomCommentMode !== 'disabled' && homeroomSample.rows.length > 0) {
    if (markerHomeroomComments < homeroomSample.rows.length * 0.85) {
      issues.push(`班主任评语轮次标记不足: ${markerHomeroomComments}/${homeroomSample.rows.length} 含 ${marker}`);
    }
    if (priorMarker && stalePriorRoundHomeroom > homeroomSample.rows.length * 0.05) {
      issues.push(`仍有 ${stalePriorRoundHomeroom} 条班主任评语含上一轮 ${priorMarker}（覆盖不完整）`);
    }
    const shortHomeroom = homeroomSample.rows.filter((row) => String(row.homeroom_comment ?? '').length < 80).length;
    if (shortHomeroom > homeroomSample.rows.length * 0.1) {
      issues.push(`班主任评语过短条目偏多: ${shortHomeroom}`);
    }
  }

  return {
    round,
    marker,
    sampleComments: homeroomSample.rows.length,
    markerComments: markerHomeroomComments,
    stalePriorRoundComments: stalePriorRoundHomeroom,
    examWrites,
    examWithScore,
    nonExamWrites,
    nonExamWithScore,
    insightsTotal: insightRows.rows.length,
    insightsWithClassAnalysis,
    examInsightsWithAnalysis,
    examInsightsMissingAnalysis,
    insightsWithFullStudentRows,
    examScoreMin,
    examScoreMax,
    examScoreBuckets: examScoreBucketHits.size,
    portraitSubmissions: 0,
    portraitWithMarker: 0,
    issues: issues.slice(0, 40),
  };
}

export async function verifyPortraitWrites(
  pool: pg.Pool,
  portraitKissTasks: PortraitKissTask[],
  round: number,
): Promise<{ portraitSubmissions: number; portraitWithMarker: number; issues: string[] }> {
  const marker = roundMarker(round);
  const issues: string[] = [];
  let portraitSubmissions = 0;
  let portraitWithMarker = 0;
  const portraitByTemplate = new Map<string, number>();
  for (const task of portraitKissTasks) {
    const rows = await pool.query(
      `SELECT diagnosis FROM teacher_portrait_collection_submissions
       WHERE template_id = $1 AND teacher_id = $2`,
      [task.templateId, task.teacherId],
    );
    portraitSubmissions += rows.rows.length;
    for (const row of rows.rows) {
      const d = row.diagnosis;
      const text = typeof d === 'string' ? d : JSON.stringify(d ?? {});
      if (text.includes(marker)) {
        portraitWithMarker += 1;
        portraitByTemplate.set(task.templateId, (portraitByTemplate.get(task.templateId) ?? 0) + 1);
      }
    }
  }
  for (const [templateId, count] of portraitByTemplate) {
    const expected = portraitKissTasks.filter((t) => t.templateId === templateId).length;
    const title = portraitKissTasks.find((t) => t.templateId === templateId)?.templateTitle ?? templateId;
    if (expected > 0 && count < expected * 0.85) {
      issues.push(`教学诊断「${title}」标记不足: ${count}/${expected}`);
    }
  }
  return { portraitSubmissions, portraitWithMarker, issues };
}

export async function fetchAdminProgress(
  pool: pg.Pool,
  apiBase: string,
  templateId: string,
): Promise<Record<string, unknown> | { error: string }> {
  const admin = (
    await pool.query(`SELECT id FROM users WHERE role IN ('system-admin','admin') ORDER BY role LIMIT 1`)
  ).rows[0] as { id: string } | undefined;
  if (!admin) return { error: 'no admin user' };
  const res = await fetch(
    `${apiBase.replace(/\/$/, '')}/api/admin/report-templates/${encodeURIComponent(templateId)}/progress`,
    { headers: { 'X-User-Id': admin.id } },
  );
  if (!res.ok) return { error: await res.text() };
  const data = (await res.json()) as { progress?: Record<string, unknown> };
  return data.progress ?? {};
}

export async function runFullLoadTest(
  pool: pg.Pool,
  config: LoadTestConfig,
): Promise<{
  config: LoadTestConfig;
  suite: ReportLoadSuite;
  subjectSettings: ReportLoadPlan['subjectSettings'][];
  rounds: RoundMetrics[];
  verifications: RoundVerification[];
  adminProgress: Record<string, unknown> | { error: string };
  tierConsistency: TierConsistencyReport[];
  totalWallMs: number;
}> {
  const health = await fetch(`${config.apiBase.replace(/\/$/, '')}/health`);
  if (!health.ok) throw new Error('API health check failed');

  const suite = await buildReportLoadSuite(pool, config.reportSpecs, config.portraitTemplateTitles);
  const plan = suite.executionPlan;
  if (!config.skipSubjectSettingsLog) {
    for (const p of suite.plans) {
      printReportSubjectSettings(p.subjectSettings);
    }
  }

  const examTaskCount = plan.subjectTasks.filter((t) => t.enableScore).length;
  const nonExamTaskCount = plan.subjectTasks.length - examTaskCount;
  const teachersForPortrait = new Set(plan.portraitKissTasks.map((t) => t.teacherId)).size;
  console.log('--- 本轮写入任务（多学段合并并发池） ---');
  console.log(`学期: ${config.term}`);
  for (const p of suite.plans) {
    console.log(`学业报告: ${p.template.title} (${p.template.term}) | 学段 ${p.template.schoolSegmentId || '—'} | ${p.template.id}`);
  }
  console.log(`学科×学生: ${plan.subjectTasks.length}（考试 ${examTaskCount} / 非考试 ${nonExamTaskCount}）`);
  console.log(`班科分析×班科: ${new Set(plan.subjectTasks.map((t) => `${t.classId}::${t.subjectKey}`)).size}（全班个别分析）`);
  console.log(`班主任×学生: ${plan.homeroomTasks.length}`);
  if (plan.portraitKissTasks.length > 0) {
    console.log(
      `教学诊断(KISS): ${teachersForPortrait} 教师 × ${suite.portraitTemplates.length} 模板 = ${plan.portraitKissTasks.length} 条`,
    );
    for (const pt of suite.portraitTemplates) console.log(`  · ${pt.title}`);
  } else if (config.reportsOnly) {
    console.log('教学诊断(KISS): 已跳过（--reports-only / 仅学业报告压测）');
  } else {
    console.log(`教学诊断(KISS): 未找到已发布模板 ${config.portraitTemplateTitles.join('、')}`);
  }
  console.log(
    `并发: 学科/班主任 ${config.concurrency} | 班科分析 ${config.insightConcurrency} | 轮次 ${config.rounds} | 时限 ${(config.maxWallMs / 1000).toFixed(0)}s`,
  );
  console.log('');

  const rounds: RoundMetrics[] = [];
  const verifications: RoundVerification[] = [];
  const started = Date.now();

  for (let round = 1; round <= config.rounds; round += 1) {
    console.log(`########## ROUND ${round} / ${config.rounds} ##########\n`);
    const metrics = await runLoadRound(plan, round, config);
    rounds.push(metrics);
    console.log(`[R${round}] 完成 ${(metrics.totalElapsedMs / 1000).toFixed(1)}s`);

    const shouldVerify = !config.verifyLastRoundOnly || round === config.rounds;
    if (shouldVerify) {
      const mergedIssues: string[] = [];
      for (const segmentPlan of suite.plans) {
        const verification = await verifyRoundWrites(
          pool,
          { ...segmentPlan, portraitKissTasks: [] },
          round,
          round > 1 ? round - 1 : undefined,
        );
        verifications.push(verification);
        console.log(`\n--- Round ${round} 校验 · ${segmentPlan.template.title} ---`);
        console.log(
          `班主任 ${verification.markerComments}/${verification.sampleComments} | 考试有分 ${verification.examWithScore}/${verification.examWrites}（${verification.examScoreMin}~${verification.examScoreMax}，${verification.examScoreBuckets}段）`,
        );
        console.log(
          `班科分析 ${verification.insightsWithClassAnalysis} | 全班个别分析 ${verification.insightsWithFullStudentRows}`,
        );
        mergedIssues.push(...verification.issues);
      }
      if (plan.portraitKissTasks.length > 0) {
        const portraitVerify = await verifyPortraitWrites(pool, plan.portraitKissTasks, round);
        const last = verifications[verifications.length - 1];
        if (last) {
          last.portraitSubmissions = portraitVerify.portraitSubmissions;
          last.portraitWithMarker = portraitVerify.portraitWithMarker;
        }
        console.log(`\n--- Round ${round} 教学诊断校验 ---`);
        console.log(
          `KISS 含轮次标记: ${portraitVerify.portraitWithMarker}/${plan.portraitKissTasks.length}（${suite.portraitTemplates.map((p) => p.title).join('、')}）`,
        );
        mergedIssues.push(...portraitVerify.issues);
      }
      if (mergedIssues.length) {
        console.log('校验问题:');
        for (const issue of mergedIssues.slice(0, 20)) console.log(`  - ${issue}`);
        throw new Error(`Round ${round} verification failed with ${mergedIssues.length} issue(s)`);
      }
      console.log('');
    }
  }

  const totalWallMs = Date.now() - started;
  if (totalWallMs > config.maxWallMs) {
    throw new Error(
      `压测总耗时 ${(totalWallMs / 1000).toFixed(1)}s 超过 ${(config.maxWallMs / 1000).toFixed(0)}s 上限；可调高 --max-wall-ms 或 --insight-concurrency`,
    );
  }

  const adminProgress = { skipped: true, reason: 'load test fast path' } as Record<string, unknown>;

  for (const segmentPlan of suite.plans) {
    await pool.query(
      `UPDATE student_report_templates
       SET released_at = COALESCE(released_at, NOW())
       WHERE id = $1 AND status IN ('published', 'closed')`,
      [segmentPlan.template.id],
    );
  }

  const tierConsistency: TierConsistencyReport[] = [];
  const tierIssues: string[] = [];
  if (!config.skipTierVerify) for (const segmentPlan of suite.plans) {
    const spec = config.reportSpecs.find((s) => s.templateTitle === segmentPlan.template.title);
    const gradeLevels: number[] = [];
    for (let g = spec?.gradeMin ?? 1; g <= (spec?.gradeMax ?? 9); g += 1) gradeLevels.push(g);
    const tierReport = await verifyReportTierConsistency(pool, config.apiBase, segmentPlan, {
      requestTimeoutMs: config.requestTimeoutMs,
      gradeLevels,
    });
    tierConsistency.push(tierReport);
    printTierConsistencyReport(tierReport);
    tierIssues.push(...tierReport.issues.filter((i) => i.level === 'error').map((i) => i.message));
  }
  if (tierIssues.length > 0) {
    throw new Error(`三层一致性复查失败：${tierIssues.length} 项错误`);
  }

  return {
    config,
    suite,
    subjectSettings: suite.plans.map((p) => p.subjectSettings),
    rounds,
    verifications,
    adminProgress,
    tierConsistency,
    totalWallMs,
  };
}

function parseTerm(argv: string[]): 'Semester 1' | 'Semester 2' {
  const p = '--term=';
  const hit = argv.find((a) => a.startsWith(p));
  const raw = hit?.slice(p.length).trim();
  if (raw === 'Semester 1' || raw === '1' || raw === '上学期') return 'Semester 1';
  if (raw === 'Semester 2' || raw === '2' || raw === '下学期') return 'Semester 2';
  return DEFAULT_TERM;
}

function parseReportSpecs(argv: string[], term: 'Semester 1' | 'Semester 2'): ReportTemplateSpec[] {
  const parseArg = (name: string): string | null => {
    const p = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length).trim() : null;
  };
  const templatesRaw = parseArg('templates') ?? parseArg('template');
  const rangesRaw = parseArg('template-ranges');
  if (!templatesRaw) return DEFAULT_REPORT_SPECS;
  const titles = templatesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const ranges = rangesRaw
    ? rangesRaw.split(',').map((r) => r.trim())
    : titles.map((_, i) => DEFAULT_REPORT_SPECS[i] ? `${DEFAULT_REPORT_SPECS[i].gradeMin}-${DEFAULT_REPORT_SPECS[i].gradeMax}` : '1-9');
  return titles.map((templateTitle, i) => {
    const range = ranges[i] ?? ranges[ranges.length - 1] ?? '1-9';
    const m = range.match(/^(\d+)\s*-\s*(\d+)$/);
    const gradeMin = m ? Number(m[1]) : 1;
    const gradeMax = m ? Number(m[2]) : 9;
    return { templateTitle, gradeMin, gradeMax, term };
  });
}

function parsePortraitTitles(argv: string[], reportsOnly: boolean): string[] {
  if (reportsOnly) return [];
  const p = '--portrait-templates=';
  const hit = argv.find((a) => a.startsWith(p));
  if (hit) {
    return hit
      .slice(p.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const legacy = argv.find((a) => a.startsWith('--portrait-template='));
  if (legacy) {
    const one = legacy.slice('--portrait-template='.length).trim();
    return one ? [one] : DEFAULT_PORTRAIT_TITLES;
  }
  return DEFAULT_PORTRAIT_TITLES;
}

export function parseLoadTestCliArgs(argv: string[]): Omit<LoadTestConfig, 'authHeaders'> {
  const parseArg = (name: string): string | null => {
    const p = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length).trim() : null;
  };
  const fast = argv.includes('--fast');
  const reportsOnly = argv.includes('--reports-only') || (!argv.includes('--with-portraits') && !fast);
  const term = parseTerm(argv);
  const base: Omit<LoadTestConfig, 'authHeaders'> = {
    ...DEFAULT_CONFIG,
    apiBase: process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:8080',
    term,
    reportSpecs: fast
      ? parseReportSpecs([...argv, '--templates=小学期末学业报告', '--template-ranges=1-6'], term)
      : parseReportSpecs(argv, term),
    portraitTemplateTitles: fast ? ['期末教学诊断'] : parsePortraitTitles(argv, reportsOnly),
    reportsOnly: fast ? false : reportsOnly,
    rounds: fast ? 1 : Math.max(1, Number(parseArg('rounds') ?? DEFAULT_CONFIG.rounds)),
    concurrency: Math.max(1, Number(parseArg('concurrency') ?? (fast ? 64 : DEFAULT_CONFIG.concurrency))),
    retries: Math.max(0, Number(parseArg('retries') ?? (fast ? 2 : DEFAULT_CONFIG.retries))),
    requestTimeoutMs: Math.max(5000, Number(parseArg('timeout-ms') ?? DEFAULT_CONFIG.requestTimeoutMs)),
    maxWallMs: Math.max(10_000, Number(parseArg('max-wall-ms') ?? (fast ? 300_000 : DEFAULT_CONFIG.maxWallMs))),
    insightConcurrency: Math.max(4, Number(parseArg('insight-concurrency') ?? (fast ? 24 : DEFAULT_CONFIG.insightConcurrency))),
    verifyLastRoundOnly: true,
    skipTierVerify: fast || argv.includes('--skip-tier-verify'),
    skipSubjectSettingsLog: fast || argv.includes('--skip-subject-settings-log'),
  };
  return base;
}

export async function finalizeLoadTestConfig(
  partial: Omit<LoadTestConfig, 'authHeaders'>,
  pool: pg.Pool,
  argv: string[],
): Promise<LoadTestConfig> {
  const useJwt = shouldUseJwtAuth(argv);
  const creds = loadTestCredentialsFile();
  const passwordMap = passwordMapFromCredentials(creds);
  let defaultPassword = '';
  try {
    defaultPassword = resolveLoadTestPassword(argv);
  } catch {
    if (!passwordMap?.size) throw new Error(resolveLoadTestPasswordErrorHint());
  }
  const authHeaders = useJwt
    ? createJwtAuthProvider(partial.apiBase, pool, defaultPassword, passwordMap)
    : createLegacyAuthProvider();
  if (creds) {
    console.log(`认证: ${useJwt ? 'JWT 登录' : 'X-User-Id'} · 凭据文件 ${creds.users.length} 个账号`);
  } else {
    console.log(`认证: ${useJwt ? 'JWT 登录' : 'X-User-Id（仅开发 API）'}`);
  }
  return { ...partial, authHeaders };
}

function resolveLoadTestPasswordErrorHint(): string {
  return '请运行 npm run export:load-credentials，或设置 LOAD_TEST_PASSWORD / --password=';
}
