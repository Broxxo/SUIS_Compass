import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveTemplateDimensionsForGrade, parseReportGradeDimensionSnapshots } from '@repo/shared';
import { getGradeCatalogIdForClass, loadSchoolGradeStructure } from '../../../apps/api/src/lib/schoolGradeStructure.js';
import { resolveReportTemplateSubjectsFromLibrary, loadSegmentGradeIds, loadReportYearInclusionContext } from '../../../apps/api/src/lib/reportYearInclusionContext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const tpl = (
      await pool.query(
        `SELECT id, academic_year_id, term, COALESCE(school_segment_id,'') AS school_segment_id
         FROM student_report_templates
         WHERE title = '小学期末学业报告' AND term = 'Semester 2'
         ORDER BY updated_at DESC LIMIT 1`,
      )
    ).rows[0] as { id: string; academic_year_id: string; term: string; school_segment_id: string };

    const subjectRows = (
      await pool.query(
        `SELECT subject_key, subject_name, grade_dimensions,
                (SELECT COUNT(*)::int FROM student_report_template_dimensions d
                 WHERE d.template_subject_id = s.id) AS flat_dim_count
         FROM student_report_template_subjects s WHERE template_id = $1`,
        [tpl.id],
      )
    ).rows;

    const segmentGradeIds = await loadSegmentGradeIds(tpl.school_segment_id);
    const inclusionCtx = await loadReportYearInclusionContext(tpl.academic_year_id);
    const gradeConfig = await loadSchoolGradeStructure();

    const flatSubjects = subjectRows.map((s) => ({
      id: `x-${s.subject_key}`,
      subjectKey: s.subject_key,
      subjectName: s.subject_name,
      subjectNameZh: s.subject_name,
      subjectNameEn: s.subject_name,
      moduleType: 'subject_score' as const,
      enableScore: true,
      enableTeacherComment: true,
      enableLearningQuality: true,
      scoreVisibility: 'teacher_homeroom_admin' as const,
      sortOrder: 0,
      gradeDimensions: parseReportGradeDimensionSnapshots(s.grade_dimensions),
      dimensions: [] as Array<{ id: string; dimensionKey: string; dimensionLabel: string; dimensionLabelZh: string; dimensionLabelEn: string; sortOrder: number; levelDescriptions: Record<string, string> }>,
    }));

    const resolved = await resolveReportTemplateSubjectsFromLibrary(
      flatSubjects,
      tpl.school_segment_id,
      segmentGradeIds,
      inclusionCtx,
      tpl.academic_year_id,
    );

    const engKeys = resolved.filter((s) => /英语|ela|english/i.test(s.subjectName + s.subjectKey));
    console.log('\n=== Template English/ELA subjects ===');
    for (const s of engKeys) {
      console.log(`${s.subjectKey} | flat_dims=${subjectRows.find((r) => r.subject_key === s.subjectKey)?.flat_dim_count} | gradeDimGrades=${s.gradeDimensions?.length ?? 0} | template.dimensions=${s.dimensions.length}`);
      for (const gid of ['g4', 'g5', 'g6']) {
        const dims = resolveTemplateDimensionsForGrade(s, gid);
        console.log(`  ${gid}: ${dims.map((d) => d.dimensionKey).join(', ') || '(none)'}`);
      }
    }

    const sampleClass = (
      await pool.query(
        `SELECT c.id, c.name, c.grade FROM classes c
         WHERE c.academic_year_id = $1 AND c.name = 'P4A' LIMIT 1`,
        [tpl.academic_year_id],
      )
    ).rows[0] as { id: string; name: string; grade: number } | undefined;

    if (sampleClass) {
      const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, sampleClass.grade, { className: sampleClass.name });
      console.log(`\n=== P4A gradeCatalogId=${gradeCatalogId} ===`);
      for (const s of engKeys) {
        const required = resolveTemplateDimensionsForGrade(s, gradeCatalogId);
        console.log(`${s.subjectKey} required dims: ${required.map((d) => d.dimensionKey).join(', ') || '(none)'}`);
      }

      const students = (
        await pool.query(
          `SELECT s.id FROM students s JOIN student_enrollments e ON e.student_id = s.id
           WHERE e.class_id = $1 AND e.academic_year_id = $2 LIMIT 3`,
          [sampleClass.id, tpl.academic_year_id],
        )
      ).rows as Array<{ id: string }>;

      for (const stu of students) {
        for (const s of engKeys) {
          const report = (
            await pool.query(
              `SELECT r.id FROM student_term_reports r
               WHERE r.student_id = $1 AND r.template_id = $2 LIMIT 1`,
              [stu.id, tpl.id],
            )
          ).rows[0] as { id: string } | undefined;
          if (!report) {
            console.log(`student ${stu.id} ${s.subjectKey}: NO REPORT`);
            continue;
          }
          const sr = (
            await pool.query(
              `SELECT id FROM student_term_subject_reports WHERE report_id = $1 AND subject_key = $2`,
              [report.id, s.subjectKey],
            )
          ).rows[0] as { id: string } | undefined;
          if (!sr) {
            console.log(`student ${stu.id} ${s.subjectKey}: NO SUBJECT REPORT`);
            continue;
          }
          const ratings = await pool.query(
            `SELECT td.dimension_key, tr.rating
             FROM student_term_target_dimensions td
             LEFT JOIN student_term_target_ratings tr ON tr.dimension_id = td.id
             WHERE td.subject_report_id = $1`,
            [sr.id],
          );
          const required = resolveTemplateDimensionsForGrade(s, gradeCatalogId);
          const rated = new Set(ratings.rows.map((r) => String((r as { dimension_key: string }).dimension_key)));
          const missing = required.filter((d) => !rated.has(d.dimensionKey));
          console.log(
            `student ${stu.id.slice(-6)} ${s.subjectKey}: ratings=${[...rated].join(',')} missing=${missing.map((d) => d.dimensionKey).join(',') || 'none'}`,
          );
        }
      }
    }

    const staffing = await pool.query(
      `SELECT DISTINCT subject_key, subject_name FROM class_subject_teacher_assignments
       WHERE academic_year_id = $1 AND (subject_name ILIKE '%英语%' OR subject_name ILIKE '%ELA%' OR subject_key ILIKE '%english%' OR subject_key ILIKE '%ela%')
       ORDER BY 1`,
      [tpl.academic_year_id],
    );
    console.log('\n=== Staffing keys ===', staffing.rows);

    const loadTasks = await pool.query(
      `SELECT COUNT(*)::int AS n, a.subject_key
       FROM class_subject_teacher_assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.academic_year_id = $1 AND c.grade BETWEEN 1 AND 6
         AND (a.subject_name ILIKE '%英语%' OR a.subject_name ILIKE '%ELA%')
       GROUP BY a.subject_key`,
      [tpl.academic_year_id],
    );
    console.log('\n=== Load test would see (by subject_key) ===', loadTasks.rows);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
