import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { buildReportLoadSuite } from './reportLoadContext.js';
import { buildSubjectPayload, putSubjectReport, putClassInsights, type ClassInsightTask } from './reportLoadRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';
  try {
    const suite = await buildReportLoadSuite(pool, [
      { templateTitle: '小学期末学业报告', gradeMin: 1, gradeMax: 6, term: 'Semester 2' },
      { templateTitle: '初中期末学业报告', gradeMin: 7, gradeMax: 9, term: 'Semester 2' },
    ], []);
    const tasks = suite.executionPlan.subjectTasks;
    const errors = new Map<string, number>();
    const samples: Array<{ key: string; status: number; body: string }> = [];

    for (let i = 0; i < tasks.length; i += 37) {
      const task = tasks[i]!;
      const res = await putSubjectReport(apiBase, task, 1, 25_000);
      if (!res.ok) {
        const key = `${res.status}:${res.body.slice(0, 80)}`;
        errors.set(key, (errors.get(key) ?? 0) + 1);
        if (samples.length < 15) {
          samples.push({
            key: `${task.subjectName}/${task.className}/G${task.classGrade}`,
            status: res.status,
            body: res.body,
          });
        }
      }
    }

    console.log('Subject sample errors by type:');
    for (const [k, n] of [...errors.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}x ${k}`);
    }
    console.log('\nSamples:');
    for (const s of samples) console.log(JSON.stringify(s));

    const insightTasks: ClassInsightTask[] = [];
    const byKey = new Map<string, ClassInsightTask>();
    for (const t of tasks) {
      const k = `${t.templateId}::${t.classId}::${t.subjectKey}`;
      if (byKey.has(k)) {
        const ex = byKey.get(k)!;
        if (!ex.studentIds.includes(t.studentId)) ex.studentIds.push(t.studentId);
      } else {
        byKey.set(k, {
          teacherId: t.teacherId,
          classId: t.classId,
          className: t.className,
          subjectKey: t.subjectKey,
          subjectName: t.subjectName,
          templateId: t.templateId,
          enableScore: t.enableScore,
          studentIds: [t.studentId],
        });
      }
    }
    insightTasks.push(...byKey.values());

    const iErrors = new Map<string, number>();
    for (let i = 0; i < insightTasks.length; i += 11) {
      const task = insightTasks[i]!;
      const res = await putClassInsights(apiBase, task, 1, 25_000);
      if (!res.ok) {
        const key = `${res.status}:${res.body.slice(0, 80)}`;
        iErrors.set(key, (iErrors.get(key) ?? 0) + 1);
        console.log('INSIGHT FAIL', task.className, task.subjectName, res.status, res.body.slice(0, 200));
      }
    }
    console.log('\nInsight error types:', Object.fromEntries(iErrors));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
