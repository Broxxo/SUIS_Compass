/**
 * G1–G6 压测学生：按学年班级覆盖录入，每班 25 人。
 * - 中文名 3–4 字；英文名「Taylor Li」格式（英文名 + 中文姓拼音）
 * - 学号：YYGCCSS（学年末两位 + 年级 + 班序号 + 座位号），全校唯一
 * - 出生日期按年级推算；学部「小学部」
 *
 *   npm run seed:g16:test-students
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const TARGET_PER_CLASS = 25;
const GRADE_MIN = 1;
const GRADE_MAX = 6;
const DIVISION = '小学部';

const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高',
];
const COMPOUND_SURNAMES = ['欧阳', '司马', '上官', '诸葛'];
const GIVEN_TWO = [
  '子涵', '思远', '梓轩', '雨桐', '语嫣', '浩然', '欣怡', '雅琪', '俊杰', '佳怡', '博文', '诗涵', '宇轩', '梦瑶', '明轩',
  '晓彤', '嘉怡', '子墨', '一诺', '若曦', '梓涵', '皓轩', '欣妍', '天佑', '佳琪', '宇航', '雨萱', '子豪', '思琪', '俊熙',
];
const GIVEN_ONE = ['晨', '悦', '宁', '睿', '彤', '昊', '妍', '峰', '琳', '翔', '瑶', '轩', '怡', '泽', '涵'];
const EN_FIRST = [
  'Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Taylor', 'Harper', 'Logan', 'Avery', 'Quinn', 'Skyler', 'Drew', 'Reese',
  'Cameron', 'Parker', 'Sage', 'Rowan', 'Blake', 'Emery',
];

const SURNAME_ROMAN: Record<string, string> = {
  王: 'Wang', 李: 'Li', 张: 'Zhang', 刘: 'Liu', 陈: 'Chen', 杨: 'Yang', 黄: 'Huang', 赵: 'Zhao', 周: 'Zhou', 吴: 'Wu',
  徐: 'Xu', 孙: 'Sun', 马: 'Ma', 朱: 'Zhu', 胡: 'Hu', 郭: 'Guo', 何: 'He', 林: 'Lin', 罗: 'Luo', 高: 'Gao',
  欧阳: 'Ouyang', 司马: 'Sima', 上官: 'Shangguan', 诸葛: 'Zhuge',
};

function rid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createId(prefix: string): string {
  return `${prefix}-${rid()}`;
}

function parseClassIndex(className: string, grade: number): number {
  const compact = className.replace(/\s+/g, '').toUpperCase();
  const m = compact.match(new RegExp(`P?${grade}([A-Z])`, 'i'));
  if (m?.[1]) {
    const code = m[1].toUpperCase().charCodeAt(0) - 64;
    if (code >= 1 && code <= 26) return code;
  }
  const tail = compact.replace(new RegExp(`^P?${grade}`, 'i'), '');
  if (tail) {
    const code = tail.charAt(0).toUpperCase().charCodeAt(0) - 64;
    if (code >= 1 && code <= 26) return code;
  }
  return 1;
}

function academicYearShortCode(yearName: string, fallbackStartYear: number): string {
  const m = yearName.match(/(20\d{2})/);
  const y = m ? Number(m[1]) : fallbackStartYear;
  return String(y).slice(-2);
}

function buildStudentNumber(yearShort: string, grade: number, classIndex: number, seat: number): string {
  return `${yearShort}${grade}${String(classIndex).padStart(2, '0')}${String(seat).padStart(2, '0')}`;
}

/** 3–4 字中文名（约 15% 四字复姓） */
function randomChineseName(seed: number): { nameZh: string; surname: string } {
  const roll = seed % 100;
  if (roll < 15) {
    const sur = COMPOUND_SURNAMES[seed % COMPOUND_SURNAMES.length];
    const g = GIVEN_TWO[(seed * 3) % GIVEN_TWO.length];
    return { nameZh: sur + g, surname: sur };
  }
  const sur = SURNAMES[seed % SURNAMES.length];
  if (roll < 55) {
    return { nameZh: sur + GIVEN_TWO[(seed * 11) % GIVEN_TWO.length], surname: sur };
  }
  const g1 = GIVEN_ONE[(seed * 5) % GIVEN_ONE.length];
  const g2 = GIVEN_ONE[(seed * 7 + 3) % GIVEN_ONE.length];
  return { nameZh: sur + g1 + g2, surname: sur };
}

function englishNameFromSurname(seed: number, surname: string): string {
  const first = EN_FIRST[seed % EN_FIRST.length];
  const last = SURNAME_ROMAN[surname] ?? 'Li';
  return `${first} ${last}`;
}

function dateOfBirthForGrade(grade: number, academicStartYear: number, seat: number): string {
  const birthYear = academicStartYear - (grade + 6);
  const month = ((seat * 3 + grade) % 12) + 1;
  const day = ((seat * 5 + grade * 2) % 27) + 1;
  return `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function resolveAcademicYear(client: pg.PoolClient): Promise<{ id: string; name: string; startYear: number }> {
  const yearRow = (
    await client.query(
      `SELECT id, name, start_date FROM academic_years WHERE is_current = TRUE ORDER BY start_date DESC NULLS LAST LIMIT 1`,
    )
  ).rows[0] as { id: string; name: string; start_date: Date | string | null } | undefined;

  if (yearRow?.id) {
    const startYear = yearRow.start_date
      ? new Date(yearRow.start_date).getFullYear()
      : Number((yearRow.name.match(/(20\d{2})/) ?? [])[1] ?? new Date().getFullYear());
    return { id: yearRow.id, name: yearRow.name, startYear };
  }

  const fallback = (
    await client.query(
      `SELECT c.academic_year_id, ay.name, ay.start_date, COUNT(*)::int AS cnt
       FROM classes c
       JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE c.grade BETWEEN $1 AND $2
       GROUP BY c.academic_year_id, ay.name, ay.start_date
       ORDER BY cnt DESC
       LIMIT 1`,
      [GRADE_MIN, GRADE_MAX],
    )
  ).rows[0] as { academic_year_id: string; name: string; start_date: Date | string | null } | undefined;

  if (!fallback?.academic_year_id) {
    throw new Error('No academic year found.');
  }
  const startYear = fallback.start_date
    ? new Date(fallback.start_date).getFullYear()
    : Number((fallback.name.match(/(20\d{2})/) ?? [])[1] ?? new Date().getFullYear());
  return { id: fallback.academic_year_id, name: fallback.name, startYear };
}

async function deleteStudentsInGrades(
  client: pg.PoolClient,
  academicYearId: string,
  gradeMin: number,
  gradeMax: number,
): Promise<number> {
  const ids = (
    await client.query(
      `SELECT DISTINCT e.student_id AS id
       FROM student_enrollments e
       JOIN classes c ON c.id = e.class_id
       WHERE e.academic_year_id = $1 AND c.grade BETWEEN $2 AND $3`,
      [academicYearId, gradeMin, gradeMax],
    )
  ).rows as Array<{ id: string }>;

  const extra = (
    await client.query(
      `SELECT id FROM students
       WHERE student_number LIKE 'VIRT-%' OR id LIKE 'virtstu-%' OR student_number LIKE 'LT-%'`,
    )
  ).rows as Array<{ id: string }>;

  const idSet = new Set([...ids.map((r) => r.id), ...extra.map((r) => r.id)]);
  const idList = [...idSet];
  if (idList.length === 0) return 0;

  await client.query(`DELETE FROM students WHERE id = ANY($1::varchar[])`, [idList]);
  return idList.length;
}

async function insertStudent(
  client: pg.PoolClient,
  opts: {
    academicYearId: string;
    classId: string;
    grade: number;
    seat: number;
    nameZh: string;
    nameEn: string;
    gender: string;
    studentNumber: string;
    dateOfBirth: string;
  },
): Promise<void> {
  const studentId = createId('ltstu');
  await client.query(
    `INSERT INTO students (
       id, name, name_zh, name_en, gender, current_grade, current_class_id,
       division, entry_date, status, student_number, date_of_birth
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, 'active', $9, $10)`,
    [
      studentId,
      opts.nameZh,
      opts.nameZh,
      opts.nameEn,
      opts.gender,
      opts.grade,
      opts.classId,
      DIVISION,
      opts.studentNumber,
      opts.dateOfBirth,
    ],
  );

  const enrId = createId('enr');
  await client.query(
    `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id)
     VALUES ($1, $2, $3, $4)`,
    [enrId, studentId, opts.classId, opts.academicYearId],
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
    [createId('sah'), studentId, opts.academicYearId, opts.classId, opts.grade],
  );

  await client.query(
    `UPDATE students SET current_class_id = $1, current_grade = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [opts.classId, opts.grade, studentId],
  );
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
    const { id: academicYearId, name: yearName, startYear } = await resolveAcademicYear(client);
    const yearShort = academicYearShortCode(yearName, startYear);

    const classRows = (
      await client.query(
        `SELECT c.id, c.name, c.grade,
                COUNT(e.id)::int AS n
         FROM classes c
         LEFT JOIN student_enrollments e
           ON e.class_id = c.id AND e.academic_year_id = $1
         WHERE c.academic_year_id = $1 AND c.grade BETWEEN $2 AND $3
         GROUP BY c.id, c.name, c.grade
         ORDER BY c.grade ASC, c.name ASC`,
        [academicYearId, GRADE_MIN, GRADE_MAX],
      )
    ).rows as Array<{ id: string; name: string; grade: number; n: number }>;

    if (classRows.length === 0) {
      console.error(`No G${GRADE_MIN}–G${GRADE_MAX} classes in year ${yearName} (${academicYearId}).`);
      process.exit(1);
    }

    await client.query('BEGIN');
    const removed = await deleteStudentsInGrades(client, academicYearId, GRADE_MIN, GRADE_MAX);
    console.log(`Removed ${removed} existing students in G${GRADE_MIN}–G${GRADE_MAX}.`);
    console.log(`Academic year: ${yearName} (${academicYearId}), code prefix: ${yearShort}`);
    console.log(`Classes: ${classRows.length}, target ${TARGET_PER_CLASS}/class`);

    let totalAdded = 0;
    let nameSeed = 0;

    for (const cls of classRows) {
      const classIndex = parseClassIndex(cls.name, cls.grade);
      console.log(`Seed G${cls.grade} ${cls.name} (class #${classIndex}) → ${TARGET_PER_CLASS} students`);

      for (let seat = 1; seat <= TARGET_PER_CLASS; seat += 1) {
        nameSeed += 1;
        const { nameZh, surname } = randomChineseName(nameSeed + cls.grade * 1000 + classIndex * 100 + seat);
        const nameEn = englishNameFromSurname(nameSeed + seat, surname);
        const gender = seat % 2 === 0 ? 'male' : 'female';
        const studentNumber = buildStudentNumber(yearShort, cls.grade, classIndex, seat);
        const dateOfBirth = dateOfBirthForGrade(cls.grade, startYear, seat);

        await insertStudent(client, {
          academicYearId,
          classId: cls.id,
          grade: cls.grade,
          seat,
          nameZh,
          nameEn,
          gender,
          studentNumber,
          dateOfBirth,
        });
        totalAdded += 1;
      }
    }

    await client.query('COMMIT');

    const verify = (
      await client.query(
        `SELECT c.grade, c.name, COUNT(e.id)::int AS n,
                MIN(s.student_number) AS sample_no,
                MIN(s.name_en) AS sample_en,
                MIN(s.division) AS division
         FROM classes c
         LEFT JOIN student_enrollments e ON e.class_id = c.id AND e.academic_year_id = c.academic_year_id
         LEFT JOIN students s ON s.id = e.student_id
         WHERE c.academic_year_id = $1 AND c.grade BETWEEN $2 AND $3
         GROUP BY c.grade, c.name, c.id
         ORDER BY c.grade, c.name`,
        [academicYearId, GRADE_MIN, GRADE_MAX],
      )
    ).rows as Array<{ grade: number; name: string; n: number; sample_no: string; sample_en: string; division: string }>;

    console.log(`\nDone. Added ${totalAdded} students. Per-class counts:`);
    for (const row of verify) {
      const mark = row.n === TARGET_PER_CLASS ? '✓' : row.n < TARGET_PER_CLASS ? '⚠' : '·';
      console.log(
        `  ${mark} G${row.grade} ${row.name}: ${row.n} | e.g. ${row.sample_no} ${row.sample_en} (${row.division})`,
      );
    }
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
