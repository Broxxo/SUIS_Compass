/**
 * 中学 G7–G9 班级与学生：每班 25 人。
 * - S7A/S7B、S8A–C、S9A(G9I)/S9B(G9C)
 * - 中文名 3–4 字；英文名「Taylor Li」格式；学号 YYGCCSS；不与已有学生重名
 *
 *   npm run seed:g789:classes-students
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { STAFFING_HOMEROOM_SUBJECT_KEY, staffingHomeroomSubjectName } from '@repo/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const TARGET_PER_CLASS = 25;

type ClassSpec = {
  grade: number;
  name: string;
  classIndex: number;
  division: string;
  curriculumLabel: string;
};

const CLASS_SPECS: ClassSpec[] = [
  { grade: 7, name: 'S7A', classIndex: 1, division: '中学', curriculumLabel: 'G7' },
  { grade: 7, name: 'S7B', classIndex: 2, division: '中学', curriculumLabel: 'G7' },
  { grade: 8, name: 'S8A', classIndex: 1, division: '中学', curriculumLabel: 'G8' },
  { grade: 8, name: 'S8B', classIndex: 2, division: '中学', curriculumLabel: 'G8' },
  { grade: 8, name: 'S8C', classIndex: 3, division: '中学', curriculumLabel: 'G8' },
  { grade: 9, name: 'S9A', classIndex: 1, division: 'G9I', curriculumLabel: 'G9I' },
  { grade: 9, name: 'S9B', classIndex: 2, division: 'G9C', curriculumLabel: 'G9C' },
];

const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高',
  '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧', '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕',
];
const COMPOUND_SURNAMES = ['欧阳', '司马', '上官', '诸葛', '皇甫', '尉迟'];
const GIVEN_TWO = [
  '子涵', '思远', '梓轩', '雨桐', '语嫣', '浩然', '欣怡', '雅琪', '俊杰', '佳怡', '博文', '诗涵', '宇轩', '梦瑶', '明轩',
  '晓彤', '嘉怡', '子墨', '一诺', '若曦', '梓涵', '皓轩', '欣妍', '天佑', '佳琪', '宇航', '雨萱', '子豪', '思琪', '俊熙',
  '婧怡', '泽宇', '语桐', '景行', '沐辰', '书瑶', '承泽', '清扬', '亦辰', '知夏', '予安', '星野', '乐言', '婉清', '翊辰',
];
const GIVEN_ONE = ['晨', '悦', '宁', '睿', '彤', '昊', '妍', '峰', '琳', '翔', '瑶', '轩', '怡', '泽', '涵', '朗', '琪', '薇', '澈', '岚'];
const EN_FIRST = [
  'Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Taylor', 'Harper', 'Logan', 'Avery', 'Quinn', 'Skyler', 'Drew', 'Reese',
  'Cameron', 'Parker', 'Sage', 'Rowan', 'Blake', 'Emery', 'Finley', 'Hayden', 'Peyton', 'River', 'Spencer', 'Elliot', 'Remy', 'Arden',
];

const SURNAME_ROMAN: Record<string, string> = {
  王: 'Wang', 李: 'Li', 张: 'Zhang', 刘: 'Liu', 陈: 'Chen', 杨: 'Yang', 黄: 'Huang', 赵: 'Zhao', 周: 'Zhou', 吴: 'Wu',
  徐: 'Xu', 孙: 'Sun', 马: 'Ma', 朱: 'Zhu', 胡: 'Hu', 郭: 'Guo', 何: 'He', 林: 'Lin', 罗: 'Luo', 高: 'Gao',
  梁: 'Liang', 宋: 'Song', 郑: 'Zheng', 谢: 'Xie', 韩: 'Han', 唐: 'Tang', 冯: 'Feng', 于: 'Yu', 董: 'Dong', 萧: 'Xiao',
  程: 'Cheng', 曹: 'Cao', 袁: 'Yuan', 邓: 'Deng', 许: 'Xu', 傅: 'Fu', 沈: 'Shen', 曾: 'Zeng', 彭: 'Peng', 吕: 'Lv',
  欧阳: 'Ouyang', 司马: 'Sima', 上官: 'Shangguan', 诸葛: 'Zhuge', 皇甫: 'Huangfu', 尉迟: 'Yuchi',
};

function rid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createId(prefix: string): string {
  return `${prefix}-${rid()}`;
}

function academicYearShortCode(yearName: string, fallbackStartYear: number): string {
  const m = yearName.match(/(20\d{2})/);
  const y = m ? Number(m[1]) : fallbackStartYear;
  return String(y).slice(-2);
}

function buildStudentNumber(yearShort: string, grade: number, classIndex: number, seat: number): string {
  return `${yearShort}${grade}${String(classIndex).padStart(2, '0')}${String(seat).padStart(2, '0')}`;
}

function randomChineseName(seed: number): { nameZh: string; surname: string } {
  const roll = seed % 100;
  if (roll < 12) {
    const sur = COMPOUND_SURNAMES[seed % COMPOUND_SURNAMES.length];
    const g = GIVEN_TWO[(seed * 3) % GIVEN_TWO.length];
    return { nameZh: sur + g, surname: sur };
  }
  const sur = SURNAMES[seed % SURNAMES.length];
  if (roll < 52) {
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

  if (!yearRow?.id) throw new Error('No current academic year found.');
  const startYear = yearRow.start_date
    ? new Date(yearRow.start_date).getFullYear()
    : Number((yearRow.name.match(/(20\d{2})/) ?? [])[1] ?? new Date().getFullYear());
  return { id: yearRow.id, name: yearRow.name, startYear };
}

async function loadTeachers(client: pg.PoolClient): Promise<string[]> {
  const rows = (
    await client.query(`SELECT id FROM users WHERE role = 'teacher' ORDER BY created_at ASC NULLS LAST`)
  ).rows as Array<{ id: string }>;
  if (rows.length === 0) throw new Error('No teacher accounts found for homeroom assignment.');
  return rows.map((r) => r.id);
}

async function ensureClass(
  client: pg.PoolClient,
  academicYearId: string,
  spec: ClassSpec,
  teacherId: string,
): Promise<string> {
  const existing = (
    await client.query(
      `SELECT id FROM classes WHERE academic_year_id = $1 AND grade = $2 AND name = $3 LIMIT 1`,
      [academicYearId, spec.grade, spec.name],
    )
  ).rows[0] as { id: string } | undefined;

  if (existing?.id) {
    await client.query(`UPDATE classes SET teacher_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
      teacherId,
      existing.id,
    ]);
    await client.query(
      `UPDATE class_teacher_assignments SET unassigned_at = CURRENT_TIMESTAMP
       WHERE class_id = $1 AND role = 'homeroom' AND unassigned_at IS NULL`,
      [existing.id],
    );
    await client.query(
      `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role) VALUES ($1, $2, $3, 'homeroom')`,
      [createId('cta'), existing.id, teacherId],
    );
    return existing.id;
  }

  const classId = createId('class');
  await client.query(
    `INSERT INTO classes (id, academic_year_id, grade, name, teacher_id) VALUES ($1, $2, $3, $4, $5)`,
    [classId, academicYearId, spec.grade, spec.name, teacherId],
  );
  await client.query(
    `INSERT INTO class_teacher_assignments (id, class_id, teacher_id, role) VALUES ($1, $2, $3, 'homeroom')`,
    [createId('cta'), classId, teacherId],
  );

  const zh = staffingHomeroomSubjectName(true);
  const en = staffingHomeroomSubjectName(false);
  await client.query(
    `INSERT INTO class_subject_teacher_assignments
      (id, academic_year_id, class_id, subject_key, subject_name, teacher_id, teacher_slot, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, NULL)
     ON CONFLICT (academic_year_id, class_id, subject_key, teacher_slot)
     DO UPDATE SET subject_name = EXCLUDED.subject_name, teacher_id = EXCLUDED.teacher_id, updated_at = CURRENT_TIMESTAMP`,
    [createId('csta'), academicYearId, classId, STAFFING_HOMEROOM_SUBJECT_KEY, `${zh} / ${en}`, teacherId],
  );

  return classId;
}

async function insertStudent(
  client: pg.PoolClient,
  opts: {
    academicYearId: string;
    classId: string;
    grade: number;
    nameZh: string;
    nameEn: string;
    gender: string;
    studentNumber: string;
    dateOfBirth: string;
    division: string;
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
      opts.division,
      opts.studentNumber,
      opts.dateOfBirth,
    ],
  );

  await client.query(
    `INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id) VALUES ($1, $2, $3, $4)`,
    [createId('enr'), studentId, opts.classId, opts.academicYearId],
  );

  await client.query(
    `UPDATE student_assignment_history SET effective_to = CURRENT_DATE WHERE student_id = $1 AND effective_to IS NULL`,
    [studentId],
  );
  await client.query(
    `INSERT INTO student_assignment_history (
       id, student_id, academic_year_id, class_id, grade, effective_from, source
     ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'manual')`,
    [createId('sah'), studentId, opts.academicYearId, opts.classId, opts.grade],
  );
}

function uniqueChineseName(
  seed: number,
  usedZh: Set<string>,
  usedEn: Set<string>,
): { nameZh: string; nameEn: string; nextSeed: number } {
  let s = seed;
  for (let i = 0; i < 5000; i += 1) {
    s += 1;
    const { nameZh, surname } = randomChineseName(s);
    const nameEn = englishNameFromSurname(s, surname);
    if (!usedZh.has(nameZh) && !usedEn.has(nameEn)) {
      usedZh.add(nameZh);
      usedEn.add(nameEn);
      return { nameZh, nameEn, nextSeed: s };
    }
  }
  throw new Error('Failed to generate unique student name.');
}

async function ensureGradeConstraints(client: pg.PoolClient): Promise<void> {
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_grade_check;
      ALTER TABLE classes ADD CONSTRAINT classes_grade_check CHECK (grade >= 1 AND grade <= 20);
    EXCEPTION WHEN OTHERS THEN NULL; END $$;
  `);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false });
  const client = await pool.connect();
  try {
    const { id: academicYearId, name: yearName, startYear } = await resolveAcademicYear(client);
    const yearShort = academicYearShortCode(yearName, startYear);
    const teachers = await loadTeachers(client);

    const usedZh = new Set(
      ((await client.query(`SELECT name_zh FROM students WHERE name_zh IS NOT NULL`)).rows as Array<{ name_zh: string }>).map(
        (r) => r.name_zh.trim(),
      ),
    );
    const usedEn = new Set(
      ((await client.query(`SELECT name_en FROM students WHERE name_en IS NOT NULL`)).rows as Array<{ name_en: string }>).map(
        (r) => r.name_en.trim(),
      ),
    );
    const usedNumbers = new Set(
      ((await client.query(`SELECT student_number FROM students WHERE student_number IS NOT NULL`)).rows as Array<{
        student_number: string;
      }>).map((r) => r.student_number.trim()),
    );

    await ensureGradeConstraints(client);
    await client.query('BEGIN');

    let nameSeed = 9000;
    let totalAdded = 0;

    for (let i = 0; i < CLASS_SPECS.length; i += 1) {
      const spec = CLASS_SPECS[i];
      const teacherId = teachers[i % teachers.length];
      const classId = await ensureClass(client, academicYearId, spec, teacherId);
      const hadStudents = Number(
        (
          await client.query(
            `SELECT COUNT(*)::int AS n FROM student_enrollments WHERE class_id = $1 AND academic_year_id = $2`,
            [classId, academicYearId],
          )
        ).rows[0]?.n ?? 0,
      );

      console.log(
        `${hadStudents > 0 ? 'Update' : 'Create'} ${spec.name} (${spec.curriculumLabel}, grade=${spec.grade}) → target ${TARGET_PER_CLASS} students`,
      );

      const toAdd = Math.max(0, TARGET_PER_CLASS - hadStudents);
      for (let seat = hadStudents + 1; seat <= TARGET_PER_CLASS; seat += 1) {
        const unique = uniqueChineseName(nameSeed, usedZh, usedEn);
        nameSeed = unique.nextSeed;
        let studentNumber = buildStudentNumber(yearShort, spec.grade, spec.classIndex, seat);
        let bump = 0;
        while (usedNumbers.has(studentNumber) && bump < 100) {
          bump += 1;
          studentNumber = buildStudentNumber(yearShort, spec.grade, spec.classIndex, seat + bump);
        }
        usedNumbers.add(studentNumber);

        await insertStudent(client, {
          academicYearId,
          classId,
          grade: spec.grade,
          nameZh: unique.nameZh,
          nameEn: unique.nameEn,
          gender: seat % 2 === 0 ? 'male' : 'female',
          studentNumber,
          dateOfBirth: dateOfBirthForGrade(spec.grade, startYear, seat),
          division: spec.division,
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
         WHERE c.academic_year_id = $1 AND c.grade IN (7, 8, 9)
         GROUP BY c.grade, c.name, c.id
         ORDER BY c.grade, c.name`,
        [academicYearId],
      )
    ).rows;

    console.log(`\nDone. New students: ${totalAdded}. Classes touched: ${CLASS_SPECS.length}.`);
    for (const row of verify) {
      const mark = row.n === TARGET_PER_CLASS ? '✓' : row.n < TARGET_PER_CLASS ? '⚠' : '·';
      console.log(`  ${mark} G${row.grade} ${row.name}: ${row.n} | ${row.sample_no} ${row.sample_en} (${row.division})`);
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
