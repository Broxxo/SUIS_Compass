import type { PoolClient } from 'pg';
import pool from '../config/database.js';

export type AcademicReportExchangePayload = {
  meta: {
    academicYearName: string;
    term: string;
    templateTitle: string;
  };
  students: Array<{
    studentNumber: string;
    nameZh: string;
    nameEn: string;
    className: string;
    homeroomComment: string;
  }>;
  subjects: Array<{
    studentNumber: string;
    className: string;
    subjectKey: string;
    subjectName: string;
    learningQualityGrade: string;
    midtermScore: number | null;
    midtermGrade: string;
    finalScore: number | null;
    finalGrade: string;
    teacherComment: string;
    examDimensionScores: Record<string, number | null> | null;
  }>;
  dimensions: Array<{
    studentNumber: string;
    subjectKey: string;
    dimensionKey: string;
    dimensionLabel: string;
    rating: string;
  }>;
  classInsights: Array<{
    className: string;
    subjectKey: string;
    classOverallAnalysis: string;
    studentNumber: string;
    learningAnalysis: string;
    supportPlan: string;
  }>;
};

export type AcademicReportImportResult = {
  importedStudents: number;
  warnings: string[];
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function letterOrNull(value: string): string | null {
  const v = value.trim().toUpperCase();
  return v === 'A' || v === 'B' || v === 'C' || v === 'D' ? v : null;
}

function gradeOrNull(value: string): string | null {
  const v = value.trim();
  if (!v || v.length > 10) return null;
  return v;
}

export async function exportAcademicReport(templateId: string): Promise<AcademicReportExchangePayload | null> {
  const meta = (await pool.query(
    `SELECT t.title, t.term, ay.name AS year_name
     FROM student_report_templates t
     JOIN academic_years ay ON ay.id = t.academic_year_id
     WHERE t.id = $1
     LIMIT 1`,
    [templateId],
  )).rows[0] as { title: string | null; term: string; year_name: string } | undefined;
  if (!meta) return null;

  const reports = (await pool.query(
    `SELECT r.id, r.homeroom_comment, r.snapshot_class_id,
            s.student_number, s.name_zh, s.name_en, s.name,
            c.name AS class_name
     FROM student_term_reports r
     JOIN students s ON s.id = r.student_id
     LEFT JOIN classes c ON c.id = r.snapshot_class_id
     WHERE r.template_id = $1
     ORDER BY c.name ASC NULLS LAST, s.student_number ASC NULLS LAST, s.name_zh ASC`,
    [templateId],
  )).rows as Array<{
    id: string;
    homeroom_comment: string | null;
    student_number: string | null;
    name_zh: string | null;
    name_en: string | null;
    name: string;
    class_name: string | null;
  }>;

  const reportIds = reports.map((row) => row.id);
  const subjectRows = reportIds.length
    ? (await pool.query(
      `SELECT report_id, id, subject_key, subject_name, midterm_score, midterm_grade,
              final_score, final_grade, learning_quality_grade, teacher_comment, exam_dimension_scores
       FROM student_term_subject_reports
       WHERE report_id = ANY($1::varchar[])
       ORDER BY subject_name ASC`,
      [reportIds],
    )).rows as Array<{
      report_id: string;
      id: string;
      subject_key: string;
      subject_name: string;
      midterm_score: string | null;
      midterm_grade: string | null;
      final_score: string | null;
      final_grade: string | null;
      learning_quality_grade: string | null;
      teacher_comment: string | null;
      exam_dimension_scores: Record<string, number | null> | null;
    }>
    : [];

  const subjectIds = subjectRows.map((row) => row.id);
  const dimensionRows = subjectIds.length
    ? (await pool.query(
      `SELECT d.subject_report_id, d.dimension_key, d.dimension_label, rt.rating
       FROM student_term_target_dimensions d
       LEFT JOIN student_term_target_ratings rt
         ON rt.dimension_id = d.id AND rt.subject_report_id = d.subject_report_id
       WHERE d.subject_report_id = ANY($1::varchar[])
       ORDER BY d.sort_order ASC, d.dimension_key ASC`,
      [subjectIds],
    )).rows as Array<{
      subject_report_id: string;
      dimension_key: string;
      dimension_label: string;
      rating: string | null;
    }>
    : [];

  const insightRows = (await pool.query(
    `SELECT i.subject_key, i.class_overall_analysis, i.student_analysis_rows, c.name AS class_name
     FROM student_report_subject_class_insights i
     JOIN classes c ON c.id = i.class_id
     WHERE i.template_id = $1
     ORDER BY c.name ASC, i.subject_key ASC`,
    [templateId],
  )).rows as Array<{
    subject_key: string;
    class_overall_analysis: string | null;
    student_analysis_rows: unknown;
    class_name: string;
  }>;

  const reportById = new Map(reports.map((row) => [row.id, row]));
  const subjectById = new Map(subjectRows.map((row) => [row.id, row]));

  const students = reports.map((row) => ({
    studentNumber: row.student_number ?? '',
    nameZh: row.name_zh ?? row.name ?? '',
    nameEn: row.name_en ?? '',
    className: row.class_name ?? '',
    homeroomComment: row.homeroom_comment ?? '',
  }));

  const subjects = subjectRows.map((row) => {
    const report = reportById.get(row.report_id);
    return {
      studentNumber: report?.student_number ?? '',
      className: report?.class_name ?? '',
      subjectKey: row.subject_key,
      subjectName: row.subject_name,
      learningQualityGrade: row.learning_quality_grade ?? '',
      midtermScore: row.midterm_score == null ? null : Number(row.midterm_score),
      midtermGrade: row.midterm_grade ?? '',
      finalScore: row.final_score == null ? null : Number(row.final_score),
      finalGrade: row.final_grade ?? '',
      teacherComment: row.teacher_comment ?? '',
      examDimensionScores: row.exam_dimension_scores ?? null,
    };
  });

  const dimensions = dimensionRows.flatMap((row) => {
    const subject = subjectById.get(row.subject_report_id);
    const report = subject ? reportById.get(subject.report_id) : undefined;
    if (!report || !subject) return [];
    return [{
      studentNumber: report.student_number ?? '',
      subjectKey: subject.subject_key,
      dimensionKey: row.dimension_key,
      dimensionLabel: row.dimension_label,
      rating: row.rating ?? '',
    }];
  });

  const classInsights = insightRows.flatMap((row) => {
    const analysis = Array.isArray(row.student_analysis_rows) ? row.student_analysis_rows : [];
    const studentRows = analysis
      .map((item) => item as Record<string, unknown>)
      .map((item) => ({
        studentId: String(item.studentId ?? '').trim(),
        learningAnalysis: String(item.learningAnalysis ?? ''),
        supportPlan: String(item.supportPlan ?? ''),
      }))
      .filter((item) => item.studentId || item.learningAnalysis || item.supportPlan);
  const lines = studentRows.length > 0 ? studentRows : [{ studentId: '', learningAnalysis: '', supportPlan: '' }];
    return lines.map((item) => ({
      className: row.class_name,
      subjectKey: row.subject_key,
      classOverallAnalysis: row.class_overall_analysis ?? '',
      learningAnalysis: item.learningAnalysis,
      supportPlan: item.supportPlan,
      studentId: item.studentId,
    }));
  });

  const studentIds = [...new Set(classInsights.map((row) => row.studentId).filter(Boolean))];
  const numberRows = studentIds.length
    ? (await pool.query(
      `SELECT id, student_number FROM students WHERE id = ANY($1::varchar[])`,
      [studentIds],
    )).rows as Array<{ id: string; student_number: string | null }>
    : [];
  const numberByStudent = new Map(numberRows.map((row) => [row.id, row.student_number ?? '']));

  return {
    meta: {
      academicYearName: meta.year_name,
      term: meta.term,
      templateTitle: meta.title ?? '',
    },
    students,
    subjects,
    dimensions,
    classInsights: classInsights.map(({ studentId, ...row }) => ({
      ...row,
      studentNumber: studentId ? (numberByStudent.get(studentId) ?? '') : '',
    })),
  };
}

export async function importAcademicReport(
  templateId: string,
  payload: AcademicReportExchangePayload,
  operatorId: string | null,
): Promise<AcademicReportImportResult> {
  const template = (await pool.query(
    `SELECT id, academic_year_id, term, title
     FROM student_report_templates
     WHERE id = $1
     LIMIT 1`,
    [templateId],
  )).rows[0] as { id: string; academic_year_id: string; term: string; title: string | null } | undefined;
  if (!template) {
    throw new Error('template_not_found');
  }

  const templateSubjects = (await pool.query(
    `SELECT subject_key, subject_name FROM student_report_template_subjects WHERE template_id = $1`,
    [templateId],
  )).rows as Array<{ subject_key: string; subject_name: string }>;
  const subjectNameByKey = new Map(templateSubjects.map((row) => [row.subject_key, row.subject_name]));

  const templateDimensions = (await pool.query(
    `SELECT ts.subject_key, td.dimension_key, td.dimension_label, td.sort_order, ld.level, ld.description
     FROM student_report_template_subjects ts
     JOIN student_report_template_dimensions td ON td.template_subject_id = ts.id
     LEFT JOIN student_report_template_level_descriptions ld ON ld.template_dimension_id = td.id
     WHERE ts.template_id = $1`,
    [templateId],
  )).rows as Array<{
    subject_key: string;
    dimension_key: string;
    dimension_label: string;
    sort_order: number;
    level: string | null;
    description: string | null;
  }>;
  const dimensionMeta = new Map<string, { label: string; sort: number; descriptions: Partial<Record<string, string>> }>();
  for (const row of templateDimensions) {
    const key = `${row.subject_key}::${row.dimension_key}`;
    const meta = dimensionMeta.get(key) ?? { label: row.dimension_label, sort: row.sort_order, descriptions: {} };
    if (row.level && row.description) meta.descriptions[row.level] = row.description;
    dimensionMeta.set(key, meta);
  }

  const studentRows = (await pool.query(
    `SELECT id, student_number FROM students WHERE student_number IS NOT NULL AND TRIM(student_number) <> ''`,
  )).rows as Array<{ id: string; student_number: string }>;
  const studentIdByNumber = new Map<string, string>();
  const duplicateNumbers = new Set<string>();
  for (const row of studentRows) {
    const key = row.student_number.trim();
    if (studentIdByNumber.has(key)) duplicateNumbers.add(key);
    else studentIdByNumber.set(key, row.id);
  }

  const classRows = (await pool.query(
    `SELECT id, name FROM classes WHERE academic_year_id = $1`,
    [template.academic_year_id],
  )).rows as Array<{ id: string; name: string }>;
  const classIdByName = new Map(classRows.map((row) => [row.name.trim(), row.id]));

  const warnings: string[] = [];
  const numbers = new Set<string>();
  for (const row of payload.students) if (row.studentNumber.trim()) numbers.add(row.studentNumber.trim());
  for (const row of payload.subjects) if (row.studentNumber.trim()) numbers.add(row.studentNumber.trim());
  for (const row of payload.dimensions) if (row.studentNumber.trim()) numbers.add(row.studentNumber.trim());

  const client = await pool.connect();
  let importedStudents = 0;
  try {
    await client.query('BEGIN');
    for (const studentNumber of numbers) {
      if (duplicateNumbers.has(studentNumber)) {
        warnings.push(`学号 ${studentNumber} 在系统中不唯一，已跳过`);
        continue;
      }
      const studentId = studentIdByNumber.get(studentNumber);
      if (!studentId) {
        warnings.push(`学号 ${studentNumber} 未找到学生，已跳过`);
        continue;
      }
      const profile = payload.students.find((row) => row.studentNumber.trim() === studentNumber);
      const subjectClass = payload.subjects.find((row) => row.studentNumber.trim() === studentNumber)?.className ?? '';
      const className = (profile?.className || subjectClass).trim();
      const classId = className ? classIdByName.get(className) ?? null : null;
      if (className && !classId) warnings.push(`学号 ${studentNumber} 的班级「${className}」在该学年不存在，报告内容仍会写入`);

      const reportId = await upsertImportedReport(client, {
        studentId,
        academicYearId: template.academic_year_id,
        term: template.term,
        templateId,
        homeroomComment: profile ? (profile.homeroomComment.trim() || null) : undefined,
        classId,
        operatorId,
      });

      const subjectRowsForStudent = payload.subjects.filter((row) => row.studentNumber.trim() === studentNumber);
      for (const subject of subjectRowsForStudent) {
        const subjectKey = subject.subjectKey.trim();
        if (!subjectNameByKey.has(subjectKey)) {
          warnings.push(`学号 ${studentNumber} 的学科「${subjectKey}」不在这份报告里，已跳过`);
          continue;
        }
        const subjectReportId = await upsertImportedSubject(client, {
          reportId,
          subjectKey,
          subjectName: subjectNameByKey.get(subjectKey) || subject.subjectName || subjectKey,
          subject,
          operatorId,
        });
        const dims = payload.dimensions.filter(
          (row) => row.studentNumber.trim() === studentNumber && row.subjectKey.trim() === subjectKey && letterOrNull(row.rating),
        );
        if (dims.length > 0) {
          await replaceImportedDimensions(client, subjectReportId, subjectKey, dims, dimensionMeta, operatorId, warnings, studentNumber);
        }
      }
      importedStudents += 1;
    }

    const insightGroups = new Map<string, AcademicReportExchangePayload['classInsights']>();
    for (const row of payload.classInsights) {
      const key = `${row.className.trim()}::${row.subjectKey.trim()}`;
      const list = insightGroups.get(key) ?? [];
      list.push(row);
      insightGroups.set(key, list);
    }
    for (const [key, rows] of insightGroups) {
      const [className, subjectKey] = key.split('::');
      if (!subjectNameByKey.has(subjectKey)) {
        warnings.push(`班级分析学科「${subjectKey}」不在这份报告里，已跳过`);
        continue;
      }
      const classId = classIdByName.get(className);
      if (!classId) {
        warnings.push(`班级分析里的班级「${className}」在该学年不存在，已跳过`);
        continue;
      }
      const analysis = rows
        .map((row) => ({
          studentId: studentIdByNumber.get(row.studentNumber.trim()) ?? '',
          learningAnalysis: row.learningAnalysis.trim(),
          supportPlan: row.supportPlan.trim(),
        }))
        .filter((row) => row.studentId && (row.learningAnalysis || row.supportPlan));
      const overall = rows.map((row) => row.classOverallAnalysis.trim()).find(Boolean) ?? null;
      await client.query(
        `INSERT INTO student_report_subject_class_insights
          (id, template_id, academic_year_id, term, class_id, subject_key, weakness_rows, class_overall_analysis, student_analysis_rows, teaching_reflection, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, $8::jsonb, NULL, $9, $9)
         ON CONFLICT (template_id, class_id, subject_key)
         DO UPDATE SET
           class_overall_analysis = EXCLUDED.class_overall_analysis,
           student_analysis_rows = EXCLUDED.student_analysis_rows,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [
          createId('srci'),
          templateId,
          template.academic_year_id,
          template.term,
          classId,
          subjectKey,
          overall,
          JSON.stringify(analysis),
          operatorId,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { importedStudents, warnings };
}

async function upsertImportedReport(
  client: PoolClient,
  input: {
    studentId: string;
    academicYearId: string;
    term: string;
    templateId: string;
    homeroomComment: string | null | undefined;
    classId: string | null;
    operatorId: string | null;
  },
): Promise<string> {
  const existing = (await client.query(
    `SELECT id FROM student_term_reports
     WHERE student_id = $1 AND academic_year_id = $2 AND term = $3 AND COALESCE(template_id, '') = COALESCE($4, '')
     LIMIT 1`,
    [input.studentId, input.academicYearId, input.term, input.templateId],
  )).rows[0] as { id: string } | undefined;
  if (!existing) {
    const id = createId('str');
    await client.query(
      `INSERT INTO student_term_reports (
         id, student_id, academic_year_id, term, template_id, homeroom_comment, snapshot_class_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        id,
        input.studentId,
        input.academicYearId,
        input.term,
        input.templateId,
        input.homeroomComment ?? null,
        input.classId,
        input.operatorId,
      ],
    );
    return id;
  }
  await client.query(
    `UPDATE student_term_reports
     SET homeroom_comment = COALESCE($2, homeroom_comment),
         snapshot_class_id = COALESCE($3, snapshot_class_id),
         updated_by = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [existing.id, input.homeroomComment === undefined ? null : input.homeroomComment, input.classId, input.operatorId],
  );
  if (input.homeroomComment === undefined) {
    return existing.id;
  }
  await client.query(
    `UPDATE student_term_reports SET homeroom_comment = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [existing.id, input.homeroomComment],
  );
  return existing.id;
}

async function upsertImportedSubject(
  client: PoolClient,
  input: {
    reportId: string;
    subjectKey: string;
    subjectName: string;
    subject: AcademicReportExchangePayload['subjects'][number];
    operatorId: string | null;
  },
): Promise<string> {
  const existing = (await client.query(
    `SELECT id FROM student_term_subject_reports WHERE report_id = $1 AND subject_key = $2 LIMIT 1`,
    [input.reportId, input.subjectKey],
  )).rows[0] as { id: string } | undefined;
  const id = existing?.id ?? createId('strs');
  await client.query(
    `INSERT INTO student_term_subject_reports (
       id, report_id, subject_key, subject_name, midterm_score, midterm_grade, final_score, final_grade,
       learning_quality_grade, exam_dimension_scores, teacher_comment, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $12)
     ON CONFLICT (report_id, subject_key)
     DO UPDATE SET
       subject_name = EXCLUDED.subject_name,
       midterm_score = EXCLUDED.midterm_score,
       midterm_grade = EXCLUDED.midterm_grade,
       final_score = EXCLUDED.final_score,
       final_grade = EXCLUDED.final_grade,
       learning_quality_grade = EXCLUDED.learning_quality_grade,
       exam_dimension_scores = EXCLUDED.exam_dimension_scores,
       teacher_comment = EXCLUDED.teacher_comment,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
    [
      id,
      input.reportId,
      input.subjectKey,
      input.subjectName,
      input.subject.midtermScore,
      gradeOrNull(input.subject.midtermGrade),
      input.subject.finalScore,
      gradeOrNull(input.subject.finalGrade),
      letterOrNull(input.subject.learningQualityGrade),
      input.subject.examDimensionScores ? JSON.stringify(input.subject.examDimensionScores) : null,
      input.subject.teacherComment.trim() || null,
      input.operatorId,
    ],
  );
  return id;
}

async function replaceImportedDimensions(
  client: PoolClient,
  subjectReportId: string,
  subjectKey: string,
  dims: AcademicReportExchangePayload['dimensions'],
  dimensionMeta: Map<string, { label: string; sort: number; descriptions: Partial<Record<string, string>> }>,
  operatorId: string | null,
  warnings: string[],
  studentNumber: string,
): Promise<void> {
  await client.query(`DELETE FROM student_term_target_ratings WHERE subject_report_id = $1`, [subjectReportId]);
  await client.query(
    `DELETE FROM student_term_target_level_descriptions
     WHERE dimension_id IN (SELECT id FROM student_term_target_dimensions WHERE subject_report_id = $1)`,
    [subjectReportId],
  );
  await client.query(`DELETE FROM student_term_target_dimensions WHERE subject_report_id = $1`, [subjectReportId]);

  let order = 0;
  for (const dim of dims) {
    const meta = dimensionMeta.get(`${subjectKey}::${dim.dimensionKey.trim()}`);
    const rating = letterOrNull(dim.rating);
    if (!rating) continue;
    const dimensionId = createId('strd');
    await client.query(
      `INSERT INTO student_term_target_dimensions (id, subject_report_id, dimension_key, dimension_label, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        dimensionId,
        subjectReportId,
        dim.dimensionKey.trim(),
        meta?.label || dim.dimensionLabel || dim.dimensionKey,
        meta?.sort ?? order,
      ],
    );
    order += 1;
    for (const level of ['A', 'B', 'C', 'D']) {
      const description = meta?.descriptions[level];
      if (!description) continue;
      await client.query(
        `INSERT INTO student_term_target_level_descriptions (id, dimension_id, level, description)
         VALUES ($1, $2, $3, $4)`,
        [createId('strld'), dimensionId, level, description],
      );
    }
    await client.query(
      `INSERT INTO student_term_target_ratings (id, subject_report_id, dimension_id, rating, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [createId('strr'), subjectReportId, dimensionId, rating, operatorId],
    );
  }
}
