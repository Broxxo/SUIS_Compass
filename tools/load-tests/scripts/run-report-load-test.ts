/**
 * 学业报告可复用压测（多轮覆盖写入 + 学科设置校验）
 *
 * 每轮前读取模板与学年「参加评价 / 考试学科」设置，按年级打印评价学科矩阵。
 * 写入规则：
 *   - 考试学科：测评成绩 + 目标等第 + 学科成绩分析 + 教学反思
 *   - 非考试学科：目标等第 + 教学反思（无分数）
 *   - 班主任评语 + 全班任课教师教学反思
 *
 * 用法：
 *   npm run load:report -- --rounds=5
 *   npm run load:report -- --rounds=3 --concurrency=40 --grade-min=5 --grade-max=6
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { parseLoadTestCliArgs, runFullLoadTest } from './reportLoadRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

async function main() {
  const config = parseLoadTestCliArgs(process.argv);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
  try {
    const report = await runFullLoadTest(pool, config);
    const outDir = path.resolve(__dirname, '../artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `report-load-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

    console.log('########## FINAL REPORT ##########');
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nSaved: ${outFile}`);

    const lastRound = report.rounds[report.rounds.length - 1];
    const lastVerify = report.verifications[report.verifications.length - 1];
    console.log('\n--- Summary ---');
    console.log(`Total wall: ${(report.totalWallMs / 1000).toFixed(1)}s | Rounds: ${report.rounds.length}`);
    if (lastRound) {
      console.log(
        `Last round subject: ${lastRound.subjectOk}/${lastRound.subjectTotal} in ${(lastRound.subjectElapsedMs / 1000).toFixed(1)}s (${lastRound.subjectThroughput.toFixed(1)} req/s)`,
      );
    }
    if (lastVerify) {
      console.log(
        `Last verify: exam scores ${lastVerify.examWithScore}/${lastVerify.examWrites}, reflections ${lastVerify.insightsWithReflection}`,
      );
    }
    const prog = report.adminProgress;
    if (prog && !('error' in prog)) {
      console.log(
        `Admin completion: ${prog.completedStudents}/${prog.totalStudents} (${prog.completionRate}%)`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
