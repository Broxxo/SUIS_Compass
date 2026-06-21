/**
 * 年级组学业报告压测（多教师 · JWT · credentials.local.json）
 *
 *   API_BASE_URL=https://suiscompass.preview.aliyun-zeabur.cn \
 *   npm run load:report:grade -- --grade=4 --template=小学期末学业报告
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loginWithPassword, createJwtAuthProviderFromCredentials } from './loadTestAuth.js';
import { loadTestCredentialsFile, resolveLoginUsername } from './loadTestCredentials.js';
import {
  createApiFetch,
  loadReportApiSharedContext,
  buildTeacherReportPlanFromContext,
  loginAdminFromCredentials,
  type MyProgressClass,
} from './reportLoadApiPlan.js';
import type { ReportLoadPlan } from './reportLoadContext.js';
import { filterReportPlanForGrade, mergeReportLoadPlans } from './reportPlanFilters.js';
import { runLoadRound, type LoadTestConfig } from './reportLoadRunner.js';

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

function parseGrade(argv: string[]): { gradeMin: number; gradeMax: number } {
  if (argv.includes('--school')) return { gradeMin: 1, gradeMax: 6 };
  const single = parseArg(argv, 'grade');
  const range = parseArg(argv, 'grades');
  if (single) {
    const g = Number(single);
    if (!Number.isFinite(g)) throw new Error('--grade 须为数字');
    return { gradeMin: g, gradeMax: g };
  }
  if (range) {
    const m = range.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) throw new Error('--grades 格式应为 4-4 或 1-6');
    return { gradeMin: Number(m[1]), gradeMax: Number(m[2]) };
  }
  throw new Error('请指定 --school、--grade=4 或 --grades=1-6');
}

async function main() {
  const argv = process.argv;
  const apiBase = process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
  const templateTitle = parseArg(argv, 'template') ?? '小学期末学业报告';
  const term = parseTerm(argv);
  const { gradeMin, gradeMax } = parseGrade(argv);
  const concurrency = Math.max(4, Number(parseArg(argv, 'concurrency') ?? 16));
  const insightConcurrency = Math.max(2, Number(parseArg(argv, 'insight-concurrency') ?? 8));

  const creds = loadTestCredentialsFile();
  if (!creds?.users.length) {
    throw new Error('请先运行 npm run export:load-credentials 生成 credentials.local.json');
  }

  const health = await fetch(`${apiBase.replace(/\/$/, '')}/health`);
  if (!health.ok) throw new Error(`API health failed: ${health.status}`);

  console.log('########## 年级组学业报告压测 ##########');
  console.log(`API: ${apiBase}`);
  console.log(`模板: ${templateTitle} · ${term} · G${gradeMin}${gradeMax !== gradeMin ? `–${gradeMax}` : ''}`);

  const adminSession = await loginAdminFromCredentials(apiBase, creds);
  console.log(`管理员登录: ${adminSession.username}`);
  const adminFetch = createApiFetch(apiBase, adminSession.token);
  const ctx = await loadReportApiSharedContext(adminFetch, templateTitle, term);

  const classIdsInRange = [...ctx.classGradeById.entries()]
    .filter(([, g]) => g >= gradeMin && g <= gradeMax)
    .map(([id]) => id);
  console.log(`范围内班级: ${classIdsInRange.length} 个（G${gradeMin}–${gradeMax}）`);

  const teacherCreds = creds.users.filter((u) => u.role === 'teacher');
  const remoteUserIdToUsername = new Map<string, string>();
  const teacherPlans: ReportLoadPlan[] = [];
  let scanned = 0;
  let activeTeachers = 0;

  for (const cred of teacherCreds) {
    scanned += 1;
    let session;
    const loginName = resolveLoginUsername(cred, apiBase);
    try {
      session = await loginWithPassword(apiBase, loginName, cred.password);
    } catch (e) {
      console.warn(`[跳过] ${loginName} 登录失败: ${(e as Error).message}`);
      continue;
    }
    remoteUserIdToUsername.set(session.userId, loginName);

    const fetchTeacher = createApiFetch(apiBase, session.token);
    let progressData: { progress?: { classes?: MyProgressClass[] } };
    try {
      progressData = (await fetchTeacher(
        `/api/classes/reports/templates/${encodeURIComponent(ctx.template.id)}/my-progress`,
      )) as { progress?: { classes?: MyProgressClass[] } };
    } catch {
      continue;
    }

    const progressClasses = (progressData.progress?.classes ?? []).filter(
      (c) => c.grade >= gradeMin && c.grade <= gradeMax,
    );
    if (progressClasses.length === 0) continue;

    const plan = buildTeacherReportPlanFromContext(
      ctx,
      { id: session.userId, displayName: session.displayName },
      progressClasses,
    );
    const filtered = filterReportPlanForGrade(plan, gradeMin, gradeMax, ctx.classGradeById);
    if (filtered.subjectTasks.length === 0 && filtered.homeroomTasks.length === 0) continue;

    activeTeachers += 1;
    teacherPlans.push(filtered);
    if (activeTeachers <= 8 || activeTeachers % 10 === 0) {
      console.log(
        `  · ${cred.displayName || cred.username}: 学科 ${filtered.subjectTasks.length} · 班主任 ${filtered.homeroomTasks.length}`,
      );
    }
  }

  console.log(`\n扫描教师 ${scanned} 人 · 本年级有任务 ${activeTeachers} 人`);

  if (teacherPlans.length === 0) {
    throw new Error(`G${gradeMin} 没有找到可执行的学业报告任务`);
  }

  const merged = mergeReportLoadPlans(teacherPlans);
  const examCount = merged.subjectTasks.filter((t) => t.enableScore).length;
  const classCount = new Set(merged.subjectTasks.map((t) => t.classId)).size;
  const studentCount = new Set(merged.subjectTasks.map((t) => t.studentId)).size;

  console.log('\n--- 合并任务 ---');
  console.log(`班级: ${classCount} · 学生(学科行去重): ${studentCount}`);
  console.log(`学科×学生: ${merged.subjectTasks.length}（测评成绩 ${examCount}）`);
  console.log(`班主任×学生: ${merged.homeroomTasks.length}`);
  console.log(`班科分析: ${new Set(merged.subjectTasks.map((t) => `${t.classId}::${t.subjectKey}`)).size}`);
  console.log(`并发: 学科/班主任 ${concurrency} · 班科 ${insightConcurrency}`);

  const config: LoadTestConfig = {
    apiBase,
    reportSpecs: [{ templateTitle, gradeMin, gradeMax, term }],
    term,
    portraitTemplateTitles: [],
    reportsOnly: true,
    rounds: 1,
    concurrency,
    insightConcurrency,
    retries: 2,
    requestTimeoutMs: 60_000,
    maxWallMs: 900_000,
    verifyLastRoundOnly: true,
    skipTierVerify: true,
    skipSubjectSettingsLog: true,
    authHeaders: createJwtAuthProviderFromCredentials(apiBase, creds, remoteUserIdToUsername),
  };

  const started = Date.now();
  const metrics = await runLoadRound(merged, 1, config);
  const wallSec = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n写入完成 ${wallSec}s`);
  console.log(
    `学科 ${metrics.subjectOk}/${metrics.subjectTotal} | 班主任 ${metrics.homeroomOk}/${metrics.homeroomTotal} | 班科 ${metrics.insightOk}/${metrics.insightTotal}`,
  );
  if (metrics.subjectLatencyP95 > 0) {
    console.log(`学科延迟 P50/P95: ${metrics.subjectLatencyP50}ms / ${metrics.subjectLatencyP95}ms`);
  }
  if (metrics.errors.length) {
    console.log('错误样例:', metrics.errors.slice(0, 5));
  }

  const outDir = path.resolve(__dirname, '../artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `grade-load-g${gradeMin}-${Date.now()}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        apiBase,
        gradeMin,
        gradeMax,
        templateTitle,
        activeTeachers,
        classCount,
        studentCount,
        metrics: {
          subjectOk: metrics.subjectOk,
          subjectTotal: metrics.subjectTotal,
          homeroomOk: metrics.homeroomOk,
          homeroomTotal: metrics.homeroomTotal,
          insightOk: metrics.insightOk,
          insightTotal: metrics.insightTotal,
          wallSec,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nSaved: ${outFile}`);
  console.log('\n########## 完成 ##########');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
