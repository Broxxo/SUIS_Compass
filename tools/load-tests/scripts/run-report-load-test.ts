/**
 * 多学段学业报告压测（默认仅学业报告，不含教学诊断）
 *
 * 默认：2025-26 下学期 Semester 2
 *   - 小学期末学业报告（G1–G6）
 *   - 初中期末学业报告（G7–G9）
 *
 * 用法：
 *   npm run load:report
 *   npm run load:report -- --rounds=3 --term=Semester\ 2 --reports-only
 *   npm run load:report -- --with-portraits   # 含期中/期末教学诊断 KISS
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { parseLoadTestCliArgs, runFullLoadTest, finalizeLoadTestConfig } from './reportLoadRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

async function main() {
  const partial = parseLoadTestCliArgs(process.argv);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
  try {
    const config = await finalizeLoadTestConfig(partial, pool, process.argv);
    const report = await runFullLoadTest(pool, config);
    const outDir = path.resolve(__dirname, '../artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `report-load-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

    const lastRound = report.rounds[report.rounds.length - 1];
    const lastVerify = report.verifications[report.verifications.length - 1];
    console.log('\n########## SUMMARY ##########');
    console.log(`Term: ${config.term} | Reports-only: ${config.reportsOnly}`);
    console.log(
      `Reports: ${config.reportSpecs.map((s) => `${s.templateTitle}(G${s.gradeMin}–${s.gradeMax})`).join(' + ')}`,
    );
    if (!config.reportsOnly) {
      console.log(`Portraits: ${config.portraitTemplateTitles.join(' + ') || '—'}`);
    }
    console.log(
      `Total wall: ${(report.totalWallMs / 1000).toFixed(1)}s / ${(config.maxWallMs / 1000).toFixed(0)}s cap | Rounds: ${report.rounds.length}`,
    );
    for (const r of report.rounds) {
      console.log(
        `  R${r.round}: ${(r.totalElapsedMs / 1000).toFixed(1)}s | subject ${r.subjectOk}/${r.subjectTotal} | insights ${r.insightOk}/${r.insightTotal} | homeroom ${r.homeroomOk}/${r.homeroomTotal}${config.reportsOnly ? '' : ` | kiss ${r.portraitOk}/${r.portraitTotal}`}`,
      );
    }
    const lastSegmentVerifies = report.verifications.slice(-report.suite.plans.length);
    for (let i = 0; i < lastSegmentVerifies.length; i += 1) {
      const v = lastSegmentVerifies[i]!;
      const title = report.suite.plans[i]?.template.title ?? '—';
      console.log(
        `  Verify ${title}: scores ${v.examScoreMin}~${v.examScoreMax} (${v.examScoreBuckets} buckets) | insights ${v.insightsWithFullStudentRows}`,
      );
    }
    if (!config.reportsOnly && lastVerify) {
      console.log(`  Verify KISS: ${lastVerify.portraitWithMarker}/${lastRound?.portraitTotal ?? 0} with round marker`);
    }
    if (report.tierConsistency?.length) {
      console.log('\n--- 三层一致性复查汇总 ---');
      for (const t of report.tierConsistency) {
        const errs = t.issues.filter((i) => i.level === 'error').length;
        const warns = t.issues.filter((i) => i.level === 'warn').length;
        console.log(`  ${t.templateTitle}: ${errs} 错误 / ${warns} 警告 | release=${t.released ? 'Y' : 'N'}`);
      }
    }
    console.log(`Saved: ${outFile}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
