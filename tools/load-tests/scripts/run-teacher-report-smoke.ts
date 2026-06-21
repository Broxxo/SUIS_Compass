/**
 * 单教师学业报告链路压测（JWT 登录，默认纯 API，无需 DATABASE_URL）。
 *
 *   API_BASE_URL=https://suiscompass.preview.aliyun-zeabur.cn \
 *   npm run load:report:teacher -- --username=huhengxing --password=hv7622 \
 *     --template=小学期末学业报告
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { filterReportPlanForTeacher } from './reportPlanFilters.js';
import {
  loginWithPassword,
  resolvePasswordForUsername,
  resolveTeacherByName,
} from './loadTestAuth.js';
import { loadTestCredentialsFile } from './loadTestCredentials.js';
import {
  buildReportLoadPlanFromApi,
  createBearerAuthProvider,
} from './reportLoadApiPlan.js';
import { buildReportLoadPlan, type ReportTemplateSpec } from './reportLoadContext.js';
import {
  finalizeLoadTestConfig,
  runLoadRound,
  verifyRoundWrites,
  type LoadTestConfig,
} from './reportLoadRunner.js';
import { resolvePgSsl } from '../../../apps/api/src/config/pgSsl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

function parseArg(argv: string[], name: string): string | null {
  const p = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length).trim() : null;
}

function parseTerm(argv: string[]): 'Semester 1' | 'Semester 2' {
  const raw = parseArg(argv, 'term');
  if (raw === 'Semester 1' || raw === '1' || raw === '上学期') return 'Semester 1';
  if (raw === 'Semester 2' || raw === '2' || raw === '下学期') return 'Semester 2';
  return 'Semester 2';
}

function useApiOnlyMode(argv: string[]): boolean {
  if (argv.includes('--db-plan')) return false;
  if (argv.includes('--api-only')) return true;
  const apiBase = process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
  return apiBase.startsWith('https://') || !process.env.DATABASE_URL;
}

async function fetchMyProgress(
  apiBase: string,
  templateId: string,
  token: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const base = apiBase.replace(/\/$/, '');
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${base}/api/classes/reports/templates/${encodeURIComponent(templateId)}/my-progress`,
      { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`my-progress ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStudentReport(
  apiBase: string,
  studentId: string,
  academicYearId: string,
  term: string,
  templateId: string,
  token: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; snippet: string }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/students/${encodeURIComponent(studentId)}` +
    `/terms/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}` +
    `/templates/${encodeURIComponent(templateId)}`;
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, snippet: text.slice(0, 200) };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeProgress(label: string, data: Record<string, unknown>) {
  const progress = (data.progress ?? data) as Record<string, unknown>;
  const classes = Array.isArray(progress.classes) ? progress.classes : [];
  console.log(`\n--- ${label} · my-progress ---`);
  console.log(
    `总进度: ${progress.completedStudents ?? 0}/${progress.totalStudents ?? 0}（${progress.completionRate ?? 0}%）`,
  );
  const subjectProgress = progress.subjectProgress as Record<string, unknown> | null | undefined;
  const homeroomProgress = progress.homeroomProgress as Record<string, unknown> | null | undefined;
  if (subjectProgress) {
    console.log(
      `学科线: ${subjectProgress.completedStudents ?? 0}/${subjectProgress.totalStudents ?? 0}（${subjectProgress.completionRate ?? 0}%）`,
    );
  }
  if (homeroomProgress) {
    console.log(
      `班主任线: ${homeroomProgress.completedStudents ?? 0}/${homeroomProgress.totalStudents ?? 0}（${homeroomProgress.completionRate ?? 0}%）`,
    );
  }
  for (const row of classes) {
    const c = row as Record<string, unknown>;
    const className = String(c.className ?? c.name ?? '—');
    const total = Number(c.totalStudents ?? 0);
    const done = Number(c.completedStudents ?? 0);
    const subjDone = Number(c.subjectCompletedStudents ?? 0);
    const homDone = Number(c.homeroomCompletedStudents ?? 0);
    console.log(`  · ${className}: 全科 ${done}/${total} · 学科 ${subjDone}/${total} · 班主任 ${homDone}/${total}`);
  }
}

async function main() {
  const argv = process.argv;
  const apiBase = process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
  const usernameArg = parseArg(argv, 'username');
  const teacherName = parseArg(argv, 'teacher-name');
  const templateTitle = parseArg(argv, 'template') ?? '小学期末学业报告';
  const gradeRange = parseArg(argv, 'grades') ?? '1-6';
  const term = parseTerm(argv);
  const password = resolvePasswordForUsername(loginUsername, argv);
  const credsLoaded = !!loadTestCredentialsFile();
  const apiOnly = useApiOnlyMode(argv);

  const m = gradeRange.match(/^(\d+)\s*-\s*(\d+)$/);
  const gradeMin = m ? Number(m[1]) : 1;
  const gradeMax = m ? Number(m[2]) : 6;

  const health = await fetch(`${apiBase.replace(/\/$/, '')}/health`);
  if (!health.ok) throw new Error(`API health failed: ${health.status}`);

  const loginUsername = usernameArg ?? teacherName;
  if (!loginUsername) {
    throw new Error('请指定 --username=huhengxing 或 --teacher-name=（须与登录名一致）');
  }

  let teacher: { id: string; username: string; displayName: string };
  let token: string;

  if (apiOnly) {
    const session = await loginWithPassword(apiBase, loginUsername, password);
    token = session.token;
    teacher = {
      id: session.userId,
      username: loginUsername,
      displayName: session.displayName,
    };
    console.log(`模式: 纯 API（JWT 登录，无需 DATABASE_URL）${credsLoaded ? ' · 凭据来自 credentials.local.json' : ''}`);
  } else {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for --db-plan mode');
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: resolvePgSsl(databaseUrl),
      connectionTimeoutMillis: 15_000,
    });
    try {
      const needle = usernameArg ?? teacherName!;
      const resolved = await resolveTeacherByName(pool, needle);
      const session = await loginWithPassword(apiBase, resolved.username, password);
      teacher = { ...resolved };
      token = session.token;
      console.log('模式: 数据库规划任务 + JWT 写入');
      await pool.end();
    } catch (e) {
      await pool.end();
      throw e;
    }
  }

  console.log('########## 单教师学业报告链路 ##########');
  console.log(`API: ${apiBase}`);
  console.log(`教师: ${teacher.displayName} (${teacher.username}) · id=${teacher.id}`);
  console.log(`模板: ${templateTitle} · ${term}`);

  const fetchApi = async (apiPath: string) => {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}${apiPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${apiPath} → ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
  };

  let fullPlan;
  if (apiOnly) {
    fullPlan = await buildReportLoadPlanFromApi(fetchApi, teacher, templateTitle, term);
  } else {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL!,
      ssl: resolvePgSsl(process.env.DATABASE_URL!),
      connectionTimeoutMillis: 15_000,
    });
    try {
      fullPlan = await buildReportLoadPlan(pool, templateTitle, gradeMin, gradeMax, null, term);
    } finally {
      await pool.end();
    }
  }

  const plan = filterReportPlanForTeacher(fullPlan, teacher.id);

  console.log('\n--- 任务规模（该教师） ---');
  console.log(`学科×学生: ${plan.subjectTasks.length}`);
  console.log(`班主任×学生: ${plan.homeroomTasks.length}`);
  console.log(`班科分析: ${new Set(plan.subjectTasks.map((t) => `${t.classId}::${t.subjectKey}`)).size}`);
  if (plan.subjectTasks.length === 0 && plan.homeroomTasks.length === 0) {
    throw new Error('该教师在所选报告下没有可填写任务。');
  }

  const progressBefore = await fetchMyProgress(apiBase, fullPlan.template.id, token, 30_000);
  summarizeProgress('填写前', progressBefore);

  const spec: ReportTemplateSpec = { templateTitle, gradeMin, gradeMax, term };
  const partialConfig: Omit<LoadTestConfig, 'authHeaders'> = {
    apiBase,
    reportSpecs: [spec],
    term,
    portraitTemplateTitles: [],
    reportsOnly: true,
    rounds: 1,
    concurrency: Math.max(2, Number(parseArg(argv, 'concurrency') ?? 8)),
    insightConcurrency: Math.max(2, Number(parseArg(argv, 'insight-concurrency') ?? 4)),
    retries: 2,
    requestTimeoutMs: 45_000,
    maxWallMs: 600_000,
    verifyLastRoundOnly: true,
    skipTierVerify: true,
    skipSubjectSettingsLog: true,
  };
  const config: LoadTestConfig = {
    ...partialConfig,
    authHeaders: createBearerAuthProvider(token),
  };

  const started = Date.now();
  const metrics = await runLoadRound(plan, 1, config);
  console.log(`\n写入完成 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(
    `学科 ${metrics.subjectOk}/${metrics.subjectTotal} | 班主任 ${metrics.homeroomOk}/${metrics.homeroomTotal} | 班科 ${metrics.insightOk}/${metrics.insightTotal}`,
  );
  if (metrics.subjectLatencyP95 > 0) {
    console.log(`学科延迟 P50/P95: ${metrics.subjectLatencyP50}ms / ${metrics.subjectLatencyP95}ms`);
  }
  if (metrics.errors.length) {
    console.log('错误样例:', metrics.errors.slice(0, 3));
  }

  const progressAfter = await fetchMyProgress(apiBase, fullPlan.template.id, token, 30_000);
  summarizeProgress('填写后', progressAfter);

  if (!apiOnly && process.env.DATABASE_URL) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: resolvePgSsl(process.env.DATABASE_URL),
      connectionTimeoutMillis: 15_000,
    });
    try {
      const verification = await verifyRoundWrites(pool, plan, 1);
      console.log('\n--- 数据库校验 ---');
      console.log(
        `考试有分 ${verification.examWithScore}/${verification.examWrites} | 班科全班行 ${verification.insightsWithFullStudentRows}`,
      );
    } finally {
      await pool.end();
    }
  }

  const sample = plan.subjectTasks[0];
  if (sample) {
    const read = await fetchStudentReport(
      apiBase,
      sample.studentId,
      sample.academicYearId,
      sample.term,
      sample.templateId,
      token,
      30_000,
    );
    console.log(`\n--- 学生报告读取 ---`);
    console.log(`GET 学生报告: ${read.ok ? 'OK' : 'FAIL'} (${read.status})`);
  }

  const outDir = path.resolve(__dirname, '../artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `teacher-smoke-${teacher.username}-${Date.now()}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ apiBase, apiOnly, teacher, template: fullPlan.template, metrics }, null, 2),
    'utf8',
  );
  console.log(`\nSaved: ${outFile}`);
  console.log('\n########## 完成 ##########');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
