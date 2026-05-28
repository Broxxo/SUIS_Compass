/**
 * 学业报告压测执行器：HTTP 写入、并发池、轮次指标。
 */
import type pg from 'pg';
import {
  buildReportLoadPlan,
  printReportSubjectSettings,
  type HomeroomFillTask,
  type ReportLoadPlan,
  type SubjectFillTask,
} from './reportLoadContext.js';

export type TargetLevel = 'A' | 'B' | 'C' | 'D';

export type ClassInsightTask = {
  teacherId: string;
  classId: string;
  className: string;
  subjectKey: string;
  subjectName: string;
  templateId: string;
  enableScore: boolean;
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
  insightsWithReflection: number;
  examInsightsWithAnalysis: number;
  examInsightsMissingAnalysis: number;
  issues: string[];
};

export type LoadTestConfig = {
  apiBase: string;
  templateTitle: string;
  gradeMin: number;
  gradeMax: number;
  rounds: number;
  concurrency: number;
  retries: number;
  requestTimeoutMs: number;
};

const DEFAULT_CONFIG: Omit<LoadTestConfig, 'apiBase'> = {
  templateTitle: '期中学业报告（测试）',
  gradeMin: 4,
  gradeMax: 6,
  rounds: 5,
  concurrency: 50,
  retries: 3,
  requestTimeoutMs: 30_000,
};

function roundMarker(round: number): string {
  return `R${round}压测`;
}

function randomComment(round: number, prefix: string): string {
  const tags = ['进步明显', '态度认真', '需巩固基础', '参与积极', '作业良好', '持续进步', '表现优异'];
  return `${roundMarker(round)}-${prefix}-${tags[Math.floor(Math.random() * tags.length)]}-${Date.now() % 100000}`;
}

export function buildSubjectPayload(task: SubjectFillTask, round: number) {
  const scoreBase = 70 + (round - 1) * 3;
  const scoreSpan = 11;
  const examDimensionScores = task.enableScore
    ? Object.fromEntries(
        task.dimensions.map((d) => [d.dimensionKey, 17 + Math.floor(Math.random() * 6)]),
      )
    : null;
  const rating: TargetLevel = round % 2 === 1 ? 'B' : 'A';
  return {
    subjectName: task.subjectName,
    midtermScore: task.enableScore ? scoreBase + Math.floor(Math.random() * scoreSpan) : null,
    finalScore: null,
    examDimensionScores,
    teacherComment: randomComment(round, `${task.className}-${task.subjectName}`),
    learningQualityGrade: (['A', 'B', 'C'] as const)[Math.floor(Math.random() * 3)],
    dimensions: task.dimensions.map((d) => ({
      dimensionKey: d.dimensionKey,
      dimensionLabel: d.dimensionLabel,
      rating,
      levelDescriptions: {},
    })),
  };
}

export function buildInsightPayload(task: ClassInsightTask, round: number) {
  const marker = roundMarker(round);
  return {
    weaknessRows: task.enableScore
      ? [
          {
            weakPoint: `${marker}-薄弱点`,
            errorAnalysis: `${marker}-学科成绩分析`,
            nextPlan: `${marker}-改进计划`,
          },
        ]
      : [],
    teachingReflection: randomComment(round, `${task.className}-${task.subjectName}-教学反思`),
  };
}

async function putJson(
  apiBase: string,
  url: string,
  userId: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const ac = new AbortController();
  const t0 = Date.now();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
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
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/students/${encodeURIComponent(task.studentId)}` +
    `/terms/${encodeURIComponent(task.academicYearId)}/${encodeURIComponent(task.term)}` +
    `/templates/${encodeURIComponent(task.templateId)}/subjects/${encodeURIComponent(task.subjectKey)}`;
  return putJson(apiBase, url, task.teacherId, buildSubjectPayload(task, round), timeoutMs);
}

export async function putClassInsights(
  apiBase: string,
  task: ClassInsightTask,
  round: number,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/templates/${encodeURIComponent(task.templateId)}` +
    `/classes/${encodeURIComponent(task.classId)}/subjects/${encodeURIComponent(task.subjectKey)}/class-insights`;
  return putJson(apiBase, url, task.teacherId, buildInsightPayload(task, round), timeoutMs);
}

export async function putHomeroomComment(
  apiBase: string,
  task: HomeroomFillTask,
  round: number,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/students/${encodeURIComponent(task.studentId)}` +
    `/terms/${encodeURIComponent(task.academicYearId)}/${encodeURIComponent(task.term)}` +
    `/templates/${encodeURIComponent(task.templateId)}/homeroom-comment`;
  return putJson(apiBase, url, task.teacherId, { comment: randomComment(round, `${task.className}-班主任`) }, timeoutMs);
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
  const seen = new Set<string>();
  const out: ClassInsightTask[] = [];
  for (const t of subjectTasks) {
    const key = `${t.classId}::${t.subjectKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      teacherId: t.teacherId,
      classId: t.classId,
      className: t.className,
      subjectKey: t.subjectKey,
      subjectName: t.subjectName,
      templateId: t.templateId,
      enableScore: t.enableScore,
    });
  }
  return out;
}

export async function runLoadRound(
  plan: ReportLoadPlan,
  round: number,
  config: LoadTestConfig,
): Promise<RoundMetrics> {
  const { subjectTasks, homeroomTasks, template, stats } = plan;
  const insightTasks = buildInsightTasks(subjectTasks);
  const errors: Array<{ key: string; status: number; body: string }> = [];
  const pushError = (key: string, status: number, body: string) => {
    if (errors.length < 30) errors.push({ key, status, body });
  };

  const subjectLatencies: number[] = [];
  let subjectOk = 0;
  let subjectFail = 0;
  const subjectStart = Date.now();

  await runPool(
    subjectTasks,
    config.concurrency,
    async (task) => {
      const last = await withRetries(
        () => putSubjectReport(config.apiBase, task, round, config.requestTimeoutMs),
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
      if (done % 250 === 0 || done === total) console.log(`[R${round} subject] ${done}/${total}`);
    },
  );
  const subjectElapsedMs = Date.now() - subjectStart;

  let insightOk = 0;
  let insightFail = 0;
  const insightStart = Date.now();
  console.log(`[R${round} insights] ${insightTasks.length} class-subject (reflection + exam analysis)`);
  await runPool(
    insightTasks,
    config.concurrency,
    async (task) => {
      const last = await withRetries(
        () => putClassInsights(config.apiBase, task, round, config.requestTimeoutMs),
        config.retries,
      );
      if (last.ok) insightOk += 1;
      else {
        insightFail += 1;
        pushError(`${task.className}/${task.subjectName}/教学反思`, last.status, last.body);
      }
    },
    (done, total) => {
      if (done % 30 === 0 || done === total) console.log(`[R${round} insights] ${done}/${total}`);
    },
  );
  const insightElapsedMs = Date.now() - insightStart;

  let homeroomOk = 0;
  let homeroomFail = 0;
  const homeroomLatencies: number[] = [];
  const homeroomStart = Date.now();
  if (template.homeroomCommentMode !== 'disabled' && homeroomTasks.length > 0) {
    await runPool(
      homeroomTasks,
      config.concurrency,
      async (task) => {
        const last = await withRetries(
          () => putHomeroomComment(config.apiBase, task, round, config.requestTimeoutMs),
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
        if (done % 100 === 0 || done === total) console.log(`[R${round} homeroom] ${done}/${total}`);
      },
    );
  }
  const homeroomElapsedMs = Date.now() - homeroomStart;
  subjectLatencies.sort((a, b) => a - b);
  homeroomLatencies.sort((a, b) => a - b);

  if (subjectFail > 0 || insightFail > 0 || homeroomFail > 0) {
    throw new Error(
      `Round ${round}: ${subjectFail} subject, ${insightFail} insight, ${homeroomFail} homeroom failures`,
    );
  }

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
    homeroomTotal: homeroomTasks.length,
    homeroomElapsedMs,
    homeroomLatencyP50: percentile(homeroomLatencies, 50),
    homeroomLatencyP95: percentile(homeroomLatencies, 95),
    totalElapsedMs: subjectElapsedMs + insightElapsedMs + homeroomElapsedMs,
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

  const commentSample = await pool.query(
    `SELECT sr.teacher_comment
     FROM student_term_subject_reports sr
     JOIN student_term_reports r ON r.id = sr.report_id
     WHERE r.template_id = $1
     LIMIT 300`,
    [templateId],
  );
  let markerComments = 0;
  let stalePriorRoundComments = 0;
  for (const row of commentSample.rows) {
    const c = String(row.teacher_comment ?? '');
    if (c.includes(marker)) markerComments += 1;
    if (priorMarker && c.includes(priorMarker)) stalePriorRoundComments += 1;
  }

  const scoreCheck = await pool.query(
    `SELECT c.grade AS class_grade, sr.subject_key, sr.midterm_score, sr.teacher_comment
     FROM student_term_subject_reports sr
     JOIN student_term_reports r ON r.id = sr.report_id
     JOIN student_enrollments e ON e.student_id = r.student_id AND e.academic_year_id = r.academic_year_id
     JOIN classes c ON c.id = e.class_id
     WHERE r.template_id = $1 AND sr.teacher_comment LIKE $2`,
    [templateId, `%${marker}%`],
  );

  const gradeItems = await import('./reportLoadContext.js').then((m) => m.loadGradeConfigItemsForReport(pool));
  const examKeys = new Set<string>();
  const nonExamKeys = new Set<string>();
  for (const row of plan.subjectSettings.rows) {
    const key = `${row.gradeLevel}::${row.subjectKey}`;
    if (row.effectiveEnableScore) examKeys.add(key);
    else nonExamKeys.add(key);
  }

  let examWrites = 0;
  let examWithScore = 0;
  let nonExamWrites = 0;
  let nonExamWithScore = 0;

  for (const row of scoreCheck.rows) {
    const g = Number(row.class_grade);
    const sk = String(row.subject_key);
    const key = `${g}::${sk}`;
    const hasScore = row.midterm_score != null;
    if (examKeys.has(key)) {
      examWrites += 1;
      if (hasScore) examWithScore += 1;
      else issues.push(`考试学科 G${g} ${sk} 缺少测评成绩`);
    } else if (nonExamKeys.has(key)) {
      nonExamWrites += 1;
      if (hasScore) {
        nonExamWithScore += 1;
        issues.push(`非考试学科 G${g} ${sk} 不应有分数但 midterm_score=${row.midterm_score}`);
      }
    }
  }

  const insightRows = await pool.query(
    `SELECT c.grade, i.subject_key, i.teaching_reflection, i.weakness_rows
     FROM student_report_subject_class_insights i
     JOIN classes c ON c.id = i.class_id
     WHERE i.template_id = $1`,
    [templateId],
  );
  let insightsWithReflection = 0;
  let examInsightsWithAnalysis = 0;
  let examInsightsMissingAnalysis = 0;
  for (const row of insightRows.rows) {
    const refl = String(row.teaching_reflection ?? '');
    if (!refl.includes(marker)) continue;
    insightsWithReflection += 1;
    const g = Number(row.grade);
    const sk = String(row.subject_key);
    const key = `${g}::${sk}`;
    const weak = row.weakness_rows;
    const arr = Array.isArray(weak) ? weak : typeof weak === 'string' ? JSON.parse(weak) : [];
    const hasAnalysis =
      Array.isArray(arr) &&
      arr.some(
        (w: unknown) =>
          w &&
          typeof w === 'object' &&
          String((w as { errorAnalysis?: string }).errorAnalysis ?? '').includes(marker),
      );
    if (examKeys.has(`${g}::${sk}`)) {
      if (hasAnalysis) examInsightsWithAnalysis += 1;
      else {
        examInsightsMissingAnalysis += 1;
        issues.push(`考试学科 G${g} ${sk} 缺少学科成绩分析`);
      }
    }
  }

  const expectedInsightPairs = new Set(
    plan.subjectTasks.map((t) => `${t.classId}::${t.subjectKey}`),
  ).size;
  if (insightsWithReflection < expectedInsightPairs * 0.9) {
    issues.push(`教学反思覆盖率偏低: ${insightsWithReflection} (预期约 ${expectedInsightPairs} 班科)`);
  }

  if (markerComments < commentSample.rows.length * 0.85) {
    issues.push(`评语轮次标记不足: ${markerComments}/${commentSample.rows.length} 含 ${marker}`);
  }
  if (priorMarker && stalePriorRoundComments > commentSample.rows.length * 0.05) {
    issues.push(`仍有 ${stalePriorRoundComments} 条评语含上一轮 ${priorMarker}（覆盖不完整）`);
  }

  return {
    round,
    marker,
    sampleComments: commentSample.rows.length,
    markerComments,
    stalePriorRoundComments,
    examWrites,
    examWithScore,
    nonExamWrites,
    nonExamWithScore,
    insightsTotal: insightRows.rows.length,
    insightsWithReflection,
    examInsightsWithAnalysis,
    examInsightsMissingAnalysis,
    issues: issues.slice(0, 40),
  };
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
  subjectSettings: ReportLoadPlan['subjectSettings'];
  rounds: RoundMetrics[];
  verifications: RoundVerification[];
  adminProgress: Record<string, unknown> | { error: string };
  totalWallMs: number;
}> {
  const health = await fetch(`${config.apiBase.replace(/\/$/, '')}/health`);
  if (!health.ok) throw new Error('API health check failed');

  const plan = await buildReportLoadPlan(pool, config.templateTitle, config.gradeMin, config.gradeMax);
  printReportSubjectSettings(plan.subjectSettings);

  const examTaskCount = plan.subjectTasks.filter((t) => t.enableScore).length;
  const nonExamTaskCount = plan.subjectTasks.length - examTaskCount;
  console.log('--- 本轮写入任务 ---');
  console.log(`学科×学生: ${plan.subjectTasks.length}（考试 ${examTaskCount} / 非考试 ${nonExamTaskCount}）`);
  console.log(`班主任×学生: ${plan.homeroomTasks.length}`);
  console.log(`并发: ${config.concurrency} | 轮次: ${config.rounds}`);
  console.log('');

  const rounds: RoundMetrics[] = [];
  const verifications: RoundVerification[] = [];
  const started = Date.now();

  for (let round = 1; round <= config.rounds; round += 1) {
    console.log(`########## ROUND ${round} / ${config.rounds} ##########\n`);
    const metrics = await runLoadRound(plan, round, config);
    rounds.push(metrics);
    const verification = await verifyRoundWrites(pool, plan, round, round > 1 ? round - 1 : undefined);
    verifications.push(verification);
    console.log(`\n--- Round ${round} 数据校验 ---`);
    console.log(
      `评语标记 ${verification.markerComments}/${verification.sampleComments} | 考试有分 ${verification.examWithScore}/${verification.examWrites} | 非考试误填分 ${verification.nonExamWithScore}`,
    );
    console.log(
      `教学反思 ${verification.insightsWithReflection} | 考试学科成绩分析 ${verification.examInsightsWithAnalysis} | 缺分析 ${verification.examInsightsMissingAnalysis}`,
    );
    if (verification.issues.length) {
      console.log('校验问题:');
      for (const issue of verification.issues.slice(0, 15)) console.log(`  - ${issue}`);
      throw new Error(`Round ${round} verification failed with ${verification.issues.length} issue(s)`);
    }
    console.log('');
  }

  const adminProgress = await fetchAdminProgress(pool, config.apiBase, plan.template.id);
  return {
    config,
    subjectSettings: plan.subjectSettings,
    rounds,
    verifications,
    adminProgress,
    totalWallMs: Date.now() - started,
  };
}

export function parseLoadTestCliArgs(argv: string[]): LoadTestConfig {
  const parseArg = (name: string): string | null => {
    const p = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length).trim() : null;
  };
  return {
    ...DEFAULT_CONFIG,
    apiBase: process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:8080',
    templateTitle: parseArg('template') ?? DEFAULT_CONFIG.templateTitle,
    gradeMin: Math.max(1, Number(parseArg('grade-min') ?? DEFAULT_CONFIG.gradeMin)),
    gradeMax: Math.max(1, Number(parseArg('grade-max') ?? DEFAULT_CONFIG.gradeMax)),
    rounds: Math.max(1, Number(parseArg('rounds') ?? DEFAULT_CONFIG.rounds)),
    concurrency: Math.max(1, Number(parseArg('concurrency') ?? DEFAULT_CONFIG.concurrency)),
    retries: Math.max(0, Number(parseArg('retries') ?? DEFAULT_CONFIG.retries)),
    requestTimeoutMs: Math.max(5000, Number(parseArg('timeout-ms') ?? DEFAULT_CONFIG.requestTimeoutMs)),
  };
}
