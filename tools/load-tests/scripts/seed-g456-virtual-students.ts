/**
 * G4–G6 虚拟学生：先删除旧 VIRT 数据，再每班补至 25 人（含学籍）。
 * 中文名以 3 字为主（2–4 字）；英文名拼音或常见英文名。
 *
 *   npm run seed:g456:test-students
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const TARGET_PER_CLASS = 25;

const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高',
];
const GIVEN_TWO = [
  '子涵', '思远', '梓轩', '雨桐', '语嫣', '浩然', '欣怡', '雅琪', '俊杰', '佳怡', '博文', '诗涵', '宇轩', '梦瑶', '明轩',
  '晓彤', '嘉怡', '子墨', '一诺', '若曦', '梓涵', '皓轩', '欣妍', '天佑', '佳琪', '宇航', '雨萱', '子豪', '思琪', '俊熙',
];
const GIVEN_ONE = ['晨', '悦', '宁', '睿', '彤', '昊', '妍', '峰', '琳', '翔'];
const EN_FIRST = [
  'Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Taylor', 'Harper', 'Logan', 'Avery', 'Quinn', 'Skyler', 'Drew', 'Reese',
];
const EN_LAST = ['Zhang', 'Wang', 'Li', 'Chen', 'Liu', 'Huang', 'Xu', 'Sun', 'Zhou', 'Wu'];

function rid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createId(prefix: string): string {
  return `${prefix}-${rid()}`;
}

/** 约 85% 三字；约 10% 二字；约 5% 四字（复姓） */
function randomChineseName(seed: number): string {
  const roll = seed % 100;
  const sur = SURNAMES[seed % SURNAMES.length];
  if (roll < 5) {
    const sur2 = ['欧阳', '司马', '上官', '诸葛'][seed % 4];
    const g = GIVEN_TWO[(seed * 3) % GIVEN_TWO.length];
    return sur2 + g;
  }
  if (roll < 15) {
    return sur + GIVEN_ONE[(seed * 7) % GIVEN_ONE.length];
  }
  return sur + GIVEN_TWO[(seed * 11) % GIVEN_TWO.length];
}

function randomEnglishName(seed: number): string {
  if (seed % 3 === 0) {
    const sur = SURNAMES[seed % SURNAMES.length];
    const g = GIVEN_TWO[(seed * 5) % GIVEN_TWO.length];
    return `${sur}${g}`.toLowerCase().replace(/[^a-z]/g, '') || `student${seed}`;
  }
  const f = EN_FIRST[seed % EN_FIRST.length];
  const l = EN_LAST[(seed * 13) % EN_LAST.length];
  return `${f} ${l}`;
}

function pickP6AClass(
  g6: Array<{ id: string; name: string; n: number }>,
): { id: string; name: string; n: number } | null {
  if (g6.length === 0) return null;
  const compact = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const byName = g6.find((c) => {
    const n = compact(c.name);
    return n.includes('p6a') || n === '6a' || /^g?6a$/.test(n);
  });
  if (byName) return byName;
  const byCount = g6.find((c) => c.n >= 15 && c.n < TARGET_PER_CLASS);
  if (byCount) return byCount;
  if (g6.length === 1) return g6[0];
  return null;
}

async function deleteVirtualStudents(client: pg.PoolClient): Promise<number> {
  const ids = (
    await client.query(
      `SELECT id FROM students
       WHERE student_number LIKE 'VIRT-%' OR id LIKE 'virtstu-%'`,
    )
  ).rows as Array<{ id: string }>;
  if (ids.length === 0) return 0;
  const idList = ids.map((r) => r.id);
  await client.query(`DELETE FROM students WHERE id = ANY($1::varchar[])`, [idList]);
  return idList.length;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Configure apps/api/.env first.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false });
  const client = await pool.connect();
  try {
    const yearRow = (
      await client.query(
        `SELECT id, name FROM academic_years WHERE is_current = TRUE ORDER BY start_date DESC NULLS LAST LIMIT 1`,
      )
    ).rows[0] as { id: string; name: string } | undefined;

    let academicYearId = yearRow?.id;
    let yearName = yearRow?.name ?? '';
    if (!academicYearId) {
      const fallback = (
        await client.query(
          `SELECT c.academic_year_id, ay.name, COUNT(*)::int AS cnt
           FROM classes c
           JOIN academic_years ay ON ay.id = c.academic_year_id
           WHERE c.grade IN (4, 5, 6)
           GROUP BY c.academic_year_id, ay.name
           ORDER BY cnt DESC
           LIMIT 1`,
        )
      ).rows[0] as { academic_year_id: string; name: string } | undefined;
      academicYearId = fallback?.academic_year_id;
      yearName = fallback?.name ?? '';
    }
    if (!academicYearId) {
      console.error('No academic year found.');
      process.exit(1);
    }

    await client.query('BEGIN');
    const removed = await deleteVirtualStudents(client);
    console.log(`Removed ${removed} previous virtual students.`);

    const classRows = (
      await client.query(
        `SELECT c.id, c.name, c.grade,
                COUNT(e.id)::int AS n
         FROM classes c
         LEFT JOIN student_enrollments e
           ON e.class_id = c.id AND e.academic_year_id = $1
         WHERE c.academic_year_id = $1 AND c.grade IN (4, 5, 6)
         GROUP BY c.id, c.name, c.grade
         ORDER BY c.grade ASC, c.name ASC`,
        [academicYearId],
      )
    ).rows as Array<{ id: string; name: string; grade: number; n: number }>;

    if (classRows.length === 0) {
      await client.query('ROLLBACK');
      console.error(`No G4–G6 classes in year ${yearName} (${academicYearId}).`);
      process.exit(1);
    }

    const g6 = classRows.filter((c) => c.grade === 6);
    const p6a = pickP6AClass(g6);

    console.log(`Academic year: ${yearName} (${academicYearId})`);
    console.log(`Classes: ${classRows.length}`);
    if (p6a) console.log(`P6A: ${p6a.name} (${p6a.n} enrolled before seed)`);

    let totalAdded = 0;
    let nameSeed = 0;

    for (const cls of classRows) {
      const need = Math.max(0, TARGET_PER_CLASS - cls.n);
      const label = `G${cls.grade} ${cls.name}`;
      if (need === 0) {
        console.log(`Skip ${label}: already ${cls.n}`);
        continue;
      }
      console.log(`Add ${need} → ${label} (was ${cls.n})`);

      for (let k = 0; k < need; k += 1) {
        nameSeed += 1;
        const seq = cls.n + k + 1;
        const studentId = createId('virtstu');
        const nameZh = randomChineseName(nameSeed + cls.grade * 100 + seq);
        const nameEn = randomEnglishName(nameSeed + seq);
        const gender = seq % 2 === 0 ? 'male' : 'female';
        const studentNumber = `VIRT-G${cls.grade}-${String(seq).padStart(2, '0')}-${rid().slice(-5)}`;

        await client.query(
          `INSERT INTO students (
             id, name, name_zh, name_en, gender, current_grade, current_class_id,
             division, entry_date, status, student_number, date_of_birth
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, CURRENT_DATE, 'active', $8, NULL)`,
          [studentId, nameZh, nameZh, nameEn, gender, cls.grade, cls.id, studentNumber],
        );

        const enrId = createId('enr');
        await client.query(
          `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
           VALUES ($1, $2, $3, $4)`,
          [enrId, studentId, cls.id, academicYearId],
        );

        await client.query(
          `UPDATE student_assignment_history SET effective_to = CURRENT_DATE
           WHERE student_id = $1 AND effective_to IS NULL`,
          [studentId],
        );
        await client.query(
          `INSERT INTO student_assignment_history (
             id, student_id, academic_year_id, class_id, grade, effective_from, source
           ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'manual')`,
          [createId('sah'), studentId, academicYearId, cls.id, cls.grade],
        );

        await client.query(
          `UPDATE students SET current_class_id = $1, current_grade = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [cls.id, cls.grade, studentId],
        );

        totalAdded += 1;
      }
    }

    await client.query('COMMIT');

    const verify = (
      await client.query(
        `SELECT c.grade, c.name, COUNT(e.id)::int AS n
         FROM classes c
         LEFT JOIN student_enrollments e ON e.class_id = c.id AND e.academic_year_id = c.academic_year_id
         WHERE c.academic_year_id = $1 AND c.grade IN (4, 5, 6)
         GROUP BY c.grade, c.name, c.id
         ORDER BY c.grade, c.name`,
        [academicYearId],
      )
    ).rows as Array<{ grade: number; name: string; n: number }>;

    console.log(`\nDone. Added ${totalAdded} students. Per-class counts:`);
    for (const row of verify) {
      const mark = row.n === TARGET_PER_CLASS ? '✓' : row.n < TARGET_PER_CLASS ? '⚠' : '·';
      console.log(`  ${mark} G${row.grade} ${row.name}: ${row.n}`);
    }
    console.log(
      '\n若班级管理仍显示「未分班」，请强制刷新页面（或重新登录）以拉取最新学籍；云端模式下会同步到浏览器缓存。',
    );
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
