import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const tpl = (
      await pool.query(
        `SELECT id, academic_year_id FROM student_report_templates
         WHERE title='小学期末学业报告' AND term='Semester 2' ORDER BY updated_at DESC LIMIT 1`,
      )
    ).rows[0] as { id: string; academic_year_id: string };

    const templateKeys = (
      await pool.query(
        `SELECT subject_key, subject_name FROM student_report_template_subjects WHERE template_id=$1`,
        [tpl.id],
      )
    ).rows;

    const classes = await pool.query(
      `SELECT id, name, grade FROM classes WHERE academic_year_id=$1 AND grade BETWEEN 4 AND 6 ORDER BY grade, name`,
      [tpl.academic_year_id],
    );

    console.log('Template keys:', templateKeys.filter((r) => /英语|ELA/i.test(String(r.subject_name))));

    for (const cls of classes.rows as Array<{ id: string; name: string; grade: number }>) {
      const staffing = await pool.query(
        `SELECT subject_key, subject_name, teacher_id FROM class_subject_teacher_assignments
         WHERE class_id=$1 AND (subject_name ILIKE '%英语%' OR subject_name ILIKE '%ELA%')`,
        [cls.id],
      );
      const writes = await pool.query(
        `SELECT sr.subject_key, COUNT(*)::int AS n
         FROM student_term_subject_reports sr
         JOIN student_term_reports r ON r.id=sr.report_id
         JOIN student_enrollments e ON e.student_id=r.student_id AND e.academic_year_id=r.academic_year_id
         WHERE r.template_id=$1 AND e.class_id=$2
           AND (sr.subject_name ILIKE '%英语%' OR sr.subject_name ILIKE '%ELA%')
         GROUP BY sr.subject_key`,
        [tpl.id, cls.id],
      );
      const inTemplate = staffing.rows.map((s) => {
        const sk = String((s as { subject_key: string }).subject_key);
        const inTpl = templateKeys.some((t) => t.subject_key === sk);
        return { ...s, inTemplate: inTpl };
      });
      const missingTpl = inTemplate.filter((s) => !s.inTemplate);
      if (missingTpl.length > 0 || writes.rows.length > 0) {
        console.log(`\n${cls.name} (G${cls.grade}):`);
        console.log('  staffing:', inTemplate);
        console.log('  written:', writes.rows);
        for (const tk of templateKeys.filter((r) => /英语|ELA/i.test(String(r.subject_name)))) {
          const cnt = await pool.query(
            `SELECT COUNT(DISTINCT r.student_id)::int AS n
             FROM student_term_subject_reports sr
             JOIN student_term_reports r ON r.id=sr.report_id
             JOIN student_enrollments e ON e.student_id=r.student_id AND e.academic_year_id=r.academic_year_id
             WHERE r.template_id=$1 AND e.class_id=$2 AND sr.subject_key=$3`,
            [tpl.id, cls.id, tk.subject_key],
          );
          console.log(`  template key ${tk.subject_key} (${tk.subject_name}): ${cnt.rows[0]?.n ?? 0}/25 students`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
