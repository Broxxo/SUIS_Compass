/**
 * 幂等创建/更新小学段「期中学业报告（测试）」模板与学年维度预设。
 *
 *   npm run seed:report:midterm-primary-test
 *   npm run seed:report:midterm-primary-test -- --both-terms --publish
 *   npm run seed:report:midterm-primary-test -- --release
 *
 * 环境变量：DATABASE_URL（apps/api/.env）
 * 可选：ACADEMIC_YEAR_ID、PRIMARY_SEGMENT_ID
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE } from '@repo/shared';
import { applyMidtermPrimaryTestReport } from '../../../apps/api/src/lib/applyMidtermPrimaryTestReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

type Term = 'Semester 1' | 'Semester 2';

function parseArgs(argv: string[]) {
  const bothTerms = argv.includes('--both-terms');
  const publish = argv.includes('--publish') || !argv.includes('--no-publish');
  const release = argv.includes('--release');
  const termArg = argv.find((a) => a.startsWith('--term='));
  const term = (termArg?.split('=')[1]?.trim() as Term | undefined) ?? 'Semester 1';
  if (term !== 'Semester 1' && term !== 'Semester 2') {
    throw new Error(`Invalid --term= value (use Semester 1 or Semester 2)`);
  }
  return { bothTerms, publish, release, term };
}

async function resolveAcademicYearId(pool: pg.Pool): Promise<string> {
  const fromEnv = process.env.ACADEMIC_YEAR_ID?.trim();
  if (fromEnv) return fromEnv;
  const r = await pool.query(
    `SELECT id FROM academic_years WHERE is_current = TRUE ORDER BY start_date DESC NULLS LAST LIMIT 1`,
  );
  const id = r.rows[0]?.id as string | undefined;
  if (!id) throw new Error('No current academic year (set ACADEMIC_YEAR_ID)');
  return id;
}

async function main() {
  const { bothTerms, publish, release, term } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (see apps/api/.env)');
  }

  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  try {
    console.log('Connecting to database…');
    await pool.query('SELECT 1');
    const academicYearId = await resolveAcademicYearId(pool);
    const primarySegmentId = process.env.PRIMARY_SEGMENT_ID?.trim() || undefined;
    const terms: Term[] = bothTerms ? ['Semester 1', 'Semester 2'] : [term];

    console.log(`Academic year: ${academicYearId}`);
    console.log(`Report title: ${MIDTERM_PRIMARY_G46_TEST_REPORT_TITLE}`);
    console.log(`Terms: ${terms.join(', ')} | publish=${publish} release=${release}`);

    for (const t of terms) {
      const result = await applyMidtermPrimaryTestReport(pool, {
        academicYearId,
        term: t,
        primarySegmentId,
        publish,
        release,
      });
      console.log(`\n[${t}] templateId=${result.templateId}`);
      console.log(`  primarySegmentId=${result.primarySegmentId}`);
      console.log(`  courses (${result.courseIds.length}): ${result.courseIds.join(', ')}`);
      console.log(`  exam courses: ${result.examCourseIds.join(', ')}`);
    }

    console.log('\nDone. Open Admin → 学业报告 to review, or use portrait after --release.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
