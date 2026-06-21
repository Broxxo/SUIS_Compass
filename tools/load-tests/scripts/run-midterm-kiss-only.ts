/**
 * 仅压测教学诊断 KISS（2 轮），避免 CLI 参数 `--portraits-templates` 易拼错。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { buildReportLoadSuite } from './reportLoadContext.js';
import { putPortraitKiss, runPool, verifyPortraitWrites } from './reportLoadRunner.js';
import { createLegacyAuthProvider } from './loadTestAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

async function main() {
  const roundsArg = process.argv.find((a) => a.startsWith('--rounds='));
  const rounds = Math.max(1, Number(roundsArg?.split('=')[1] ?? 2));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
  const apiBase = process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
  try {
    const suite = await buildReportLoadSuite(
      pool,
      [{ templateTitle: '期中学业报告', gradeMin: 1, gradeMax: 9, term: 'Semester 2' }],
      ['期中教学诊断'],
    );
    const tasks = suite.executionPlan.portraitKissTasks;
    console.log(`期中教学诊断 KISS 任务: ${tasks.length} 条，${rounds} 轮`);
    const legacyAuth = createLegacyAuthProvider();
    for (let round = 1; round <= rounds; round += 1) {
      let ok = 0;
      let fail = 0;
      await runPool(tasks, 64, async (task) => {
        const res = await putPortraitKiss(apiBase, task, round, 25_000, legacyAuth);
        if (res.ok) ok += 1;
        else fail += 1;
      }, (done, total) => {
        if (done % 25 === 0 || done === total) console.log(`[R${round}] ${done}/${total}`);
      });
      console.log(`[R${round}] ok=${ok} fail=${fail}`);
      const v = await verifyPortraitWrites(pool, tasks, round);
      console.log(`[R${round}] KISS 含标记: ${v.portraitWithMarker}/${tasks.length}`);
      if (v.issues.length) console.log(v.issues);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
