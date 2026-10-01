import pool from '../config/database.js';

/**
 * 下学期是否已经在用：公开课、已发布的教师采集（教师问卷）、已填写的采集，
 * 或已发布/已有学生记录的学业报告。草稿不算。
 */
export async function isSemester2InUse(academicYearId: string): Promise<boolean> {
  const yearId = academicYearId.trim();
  if (!yearId) return false;
  try {
    const result = await pool.query(
      `SELECT (
         EXISTS (
           SELECT 1 FROM open_lessons
           WHERE academic_year_id = $1 AND term = 'Semester 2'
         )
         OR EXISTS (
           SELECT 1 FROM teacher_portrait_collection_templates
           WHERE academic_year_id = $1 AND term = 'Semester 2'
             AND status IN ('published', 'closed')
         )
         OR EXISTS (
           SELECT 1
           FROM teacher_portrait_collection_submissions s
           JOIN teacher_portrait_collection_templates t ON t.id = s.template_id
           WHERE t.academic_year_id = $1 AND t.term = 'Semester 2'
             AND (
               btrim(COALESCE(s.diagnosis->>'keep', '')) <> ''
               OR btrim(COALESCE(s.diagnosis->>'improve', '')) <> ''
               OR btrim(COALESCE(s.diagnosis->>'stop', '')) <> ''
               OR btrim(COALESCE(s.diagnosis->>'start', '')) <> ''
             )
         )
         OR EXISTS (
           SELECT 1 FROM student_report_templates
           WHERE academic_year_id = $1 AND term = 'Semester 2'
             AND status IN ('published', 'closed')
         )
         OR EXISTS (
           SELECT 1 FROM student_term_reports
           WHERE academic_year_id = $1 AND term = 'Semester 2'
         )
       ) AS in_use`,
      [yearId],
    );
    return result.rows[0]?.in_use === true;
  } catch (error) {
    console.error('isSemester2InUse', error);
    return false;
  }
}
