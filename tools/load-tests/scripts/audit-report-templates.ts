/**
 * 审计学业报告模板：学段、学科快照、评价设置、岗位安排一致性。
 * 用法：cd apps/api && npx tsx ../../tools/load-tests/scripts/audit-report-templates.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  isEvaluationGradeIncluded,
  isExamGradeIncluded,
  parseReportGradeDimensionSnapshots,
  resolveTemplateDimensionsForGrade,
} from '@repo/shared';
import {
  loadYearPresetSubjectRows,
  resolveStaffingSubjectKeysForReportTemplate,
} from '../../../apps/api/src/lib/reportYearInclusionContext.js';
import { sanitizeExamConfigs } from '../../../apps/api/src/lib/reportExamConfigSanitize.js';
import {
  buildReportSubjectSettingsSnapshot,
  loadGradeConfigItemsForReport,
  loadSegmentGradeIds,
  loadYearInclusionPayload,
  type Term,
} from './reportLoadContext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const TEMPLATE_TITLES = ['小学期末学业报告', '初中期末学业报告'] as const;
const TERM: Term = 'Semester 2';

type Issue = { level: 'error' | 'warn' | 'info'; code: string; message: string };

function dimLabelsKey(dims: Array<{ dimensionLabelZh?: string; dimensionLabelEn?: string }>): string {
  return dims
    .map((d) => `${String(d.dimensionLabelZh ?? '').trim()}\u0001${String(d.dimensionLabelEn ?? '').trim()}`)
    .filter((k) => k !== '\u0001')
    .join('|');
}

async function auditTemplate(pool: pg.Pool, title: string): Promise<{ issues: Issue[]; summary: Record<string, unknown> }> {
  const issues: Issue[] = [];
  const row = (
    await pool.query(
      `SELECT id, academic_year_id, term, status, title, published_at, released_at,
              COALESCE(school_segment_id, '') AS school_segment_id,
              homeroom_comment_mode
       FROM student_report_templates
       WHERE title = $1 AND term = $2
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [title, TERM],
    )
  ).rows[0] as
    | {
        id: string;
        academic_year_id: string;
        term: Term;
        status: string;
        title: string;
        published_at: Date | null;
        released_at: Date | null;
        school_segment_id: string;
        homeroom_comment_mode: string;
      }
    | undefined;

  if (!row) {
    return { issues: [{ level: 'error', code: 'NOT_FOUND', message: `未找到模板：${title}（${TERM}）` }], summary: {} };
  }

  if (row.status !== 'published') {
    issues.push({
      level: 'error',
      code: 'NOT_PUBLISHED',
      message: `状态为 ${row.status}，教师端无法填写（需 published）`,
    });
  }
  if (!row.school_segment_id) {
    issues.push({ level: 'error', code: 'NO_SEGMENT', message: '未绑定学段 school_segment_id' });
  }

  const segmentId = row.school_segment_id;
  const segmentGradeIds = segmentId ? await loadSegmentGradeIds(pool, segmentId) : [];
  const gradeItems = await loadGradeConfigItemsForReport(pool);
  const inclusionCtx = await loadYearInclusionPayload(pool, row.academic_year_id);
  const libraryRows = await loadYearPresetSubjectRows(row.academic_year_id);
  const libraryByKey = new Map(libraryRows.map((r) => [r.subjectKey, r] as const));

  const subjectRows = (
    await pool.query(
      `SELECT id, subject_key, subject_name, enable_score, enable_learning_quality, grade_dimensions
       FROM student_report_template_subjects
       WHERE template_id = $1
       ORDER BY sort_order ASC`,
      [row.id],
    )
  ).rows as Array<{
    id: string;
    subject_key: string;
    subject_name: string;
    enable_score: boolean;
    enable_learning_quality: boolean;
    grade_dimensions: unknown;
  }>;

  if (subjectRows.length === 0) {
    issues.push({ level: 'error', code: 'NO_SUBJECTS', message: '模板无学科' });
  }

  const flatDimCount = (
    await pool.query(
      `SELECT COUNT(*)::int AS n
       FROM student_report_template_dimensions d
       JOIN student_report_template_subjects s ON s.id = d.template_subject_id
       WHERE s.template_id = $1`,
      [row.id],
    )
  ).rows[0] as { n: number };

  const templateKeys = subjectRows.map((s) => s.subject_key);
  const evalKeys = resolveStaffingSubjectKeysForReportTemplate(
    templateKeys,
    segmentId,
    segmentGradeIds,
    inclusionCtx,
  );
  const evalKeySet = new Set(evalKeys);
  for (const sk of templateKeys) {
    if (!evalKeySet.has(sk)) {
      issues.push({
        level: 'warn',
        code: 'SUBJECT_NOT_IN_EVAL_POOL',
        message: `学科 ${sk} 在模板中但未纳入本学段参评池`,
      });
    }
  }

  let snapshotMismatch = 0;
  let missingGradeSnapshot = 0;
  let zeroDimEvalGrades = 0;

  for (const sub of subjectRows) {
    const sk = sub.subject_key;
    const snap = parseReportGradeDimensionSnapshots(sub.grade_dimensions);
    const lib = libraryByKey.get(sk);
    const courseId = inclusionCtx.subjectKeyToCourseId.get(sk) ?? null;

    if (snap.length === 0 && flatDimCount.n === 0) {
      const inPool = courseId && (inclusionCtx.stageInclusion[segmentId] ?? []).includes(courseId);
      if (inPool) {
        issues.push({
          level: 'error',
          code: 'NO_DIMENSION_SNAPSHOT',
          message: `学科 ${sub.subject_name}（${sk}）无 grade_dimensions 且无扁平维度`,
        });
      }
    }

    if (lib && snap.length > 0) {
      for (const gradeId of segmentGradeIds) {
        if (
          courseId &&
          !isEvaluationGradeIncluded(
            segmentId,
            courseId,
            gradeId,
            segmentGradeIds,
            inclusionCtx.stageInclusion,
            inclusionCtx.evaluationGradeInclusion,
          )
        ) {
          continue;
        }
        const snapRow = snap.find((g) => g.gradeId === gradeId);
        const libRow = lib.gradeDimensions.find((g) => g.gradeId === gradeId);
        if (!snapRow && libRow?.dimensions?.length) {
          missingGradeSnapshot += 1;
          issues.push({
            level: 'warn',
            code: 'MISSING_GRADE_IN_SNAPSHOT',
            message: `${sub.subject_name} 缺少年级 ${gradeId} 维度快照（模板库有配置）`,
          });
        } else if (snapRow && libRow) {
          const a = dimLabelsKey(snapRow.dimensions);
          const b = dimLabelsKey(libRow.dimensions);
          if (a !== b) {
            snapshotMismatch += 1;
            issues.push({
              level: 'error',
              code: 'SNAPSHOT_DRIFT',
              message: `${sub.subject_name} @ ${gradeId} 快照与当前模板库不一致（报告创建后库已变更则属正常）`,
            });
          }
        }
        if (snapRow) {
          const resolved = resolveTemplateDimensionsForGrade(
            { subjectKey: sk, gradeDimensions: snap },
            gradeId,
          );
          if (resolved.length === 0 && courseId && isEvaluationGradeIncluded(
            segmentId, courseId, gradeId, segmentGradeIds,
            inclusionCtx.stageInclusion, inclusionCtx.evaluationGradeInclusion,
          )) {
            zeroDimEvalGrades += 1;
          }
        }
      }
    }
  }

  const subjectMap = new Map(
    subjectRows.map((s) => [
      s.subject_key,
      {
        subjectKey: s.subject_key,
        subjectName: s.subject_name,
        enableScore: Boolean(s.enable_score),
        enableLearningQuality: s.enable_learning_quality !== false,
        dimensions: [] as Array<{ dimensionKey: string; dimensionLabel: string }>,
      },
    ]),
  );
  for (const sub of subjectRows) {
    const snap = parseReportGradeDimensionSnapshots(sub.grade_dimensions);
    const firstGrade = segmentGradeIds[0] ?? null;
    const dims = resolveTemplateDimensionsForGrade(
      { subjectKey: sub.subject_key, gradeDimensions: snap },
      firstGrade,
    );
    const entry = subjectMap.get(sub.subject_key);
    if (entry) entry.dimensions = dims.map((d) => ({ dimensionKey: d.dimensionKey, dimensionLabel: d.dimensionLabel }));
  }

  const settings = await buildReportSubjectSettingsSnapshot(
    pool,
    row,
    subjectMap,
    inclusionCtx,
    segmentGradeIds,
    gradeItems,
  );

  const classRows = (
    await pool.query(
      `SELECT id, grade, name FROM classes WHERE academic_year_id = $1`,
      [row.academic_year_id],
    )
  ).rows as Array<{ id: string; grade: number; name: string }>;

  const staffingRows = (
    await pool.query(
      `SELECT class_id, subject_key, teacher_id
       FROM class_subject_teacher_assignments
       WHERE academic_year_id = $1 AND subject_key <> '__homeroom__'`,
      [row.academic_year_id],
    )
  ).rows as Array<{ class_id: string; subject_key: string; teacher_id: string | null }>;

  const { getGradeCatalogIdForClass } = await import('../../../apps/api/src/lib/schoolGradeStructure.js');
  const gradeConfig = await import('../../../apps/api/src/lib/schoolGradeStructure.js').then((m) =>
    m.loadSchoolGradeStructure(),
  );

  let staffingGaps = 0;
  for (const gradeId of segmentGradeIds) {
    const gradeLevel = gradeItems.find((g) => g.id === gradeId)?.level ?? 0;
    if (!gradeLevel) continue;
    const segmentClasses = classRows.filter((c) => {
      const catalogId = getGradeCatalogIdForClass(gradeConfig, c.grade, { className: c.name });
      return catalogId === gradeId;
    });
    if (segmentClasses.length === 0) continue;
    for (const sk of evalKeys) {
      const courseId = inclusionCtx.subjectKeyToCourseId.get(sk);
      if (
        courseId &&
        !isEvaluationGradeIncluded(
          segmentId, courseId, gradeId, segmentGradeIds,
          inclusionCtx.stageInclusion, inclusionCtx.evaluationGradeInclusion,
        )
      ) {
        continue;
      }
      const hasTeacher = segmentClasses.some((cls) =>
        staffingRows.some(
          (a) => a.class_id === cls.id && a.subject_key === sk && String(a.teacher_id ?? '').trim(),
        ),
      );
      if (!hasTeacher) {
        staffingGaps += 1;
        const subName = subjectRows.find((s) => s.subject_key === sk)?.subject_name ?? sk;
        issues.push({
          level: 'warn',
          code: 'NO_STAFFING',
          message: `${subName} @ ${gradeId}（G${gradeLevel}）本学段有班但无任课教师`,
        });
      }
    }
  }

  const assignmentCount = (
    await pool.query(
      `SELECT COUNT(*)::int AS n FROM class_subject_teacher_assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.academic_year_id = $1 AND c.grade BETWEEN $2 AND $3`,
      [
        row.academic_year_id,
        Math.min(...segmentGradeIds.map((id) => gradeItems.find((g) => g.id === id)?.level ?? 99)),
        Math.max(...segmentGradeIds.map((id) => gradeItems.find((g) => g.id === id)?.level ?? 0)),
      ],
    )
  ).rows[0] as { n: number };

  return {
    issues,
    summary: {
      id: row.id,
      title: row.title,
      term: row.term,
      status: row.status,
      segmentId,
      segmentGradeIds,
      subjectCount: subjectRows.length,
      evalSubjectCount: evalKeys.length,
      flatDimensionRows: flatDimCount.n,
      snapshotMismatch,
      missingGradeSnapshot,
      staffingGaps,
      staffingAssignmentRows: assignmentCount.n,
      homeroomCommentMode: row.homeroom_comment_mode,
      evaluationByGrade: settings.evaluationByGradeLevel,
      examByGrade: settings.examByGradeLevel,
    },
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
  try {
    console.log(`\n========== 学业报告一致性审计（${TERM}） ==========\n`);
    let totalErrors = 0;
    let totalWarns = 0;
    let publishReady = true;

    for (const title of TEMPLATE_TITLES) {
      const { issues, summary } = await auditTemplate(pool, title);
      console.log(`【${title}】`);
      if (Object.keys(summary).length) {
        console.log(JSON.stringify(summary, null, 2));
      }
      for (const i of issues) {
        const tag = i.level === 'error' ? '❌' : i.level === 'warn' ? '⚠️' : 'ℹ️';
        console.log(`  ${tag} [${i.code}] ${i.message}`);
        if (i.level === 'error') {
          totalErrors += 1;
          publishReady = false;
        }
        if (i.level === 'warn') totalWarns += 1;
      }
      if (issues.length === 0) console.log('  ✅ 未发现一致性问题');
      console.log('');
    }

    console.log('========== 发布就绪判定 ==========');
    console.log(`错误: ${totalErrors} | 警告: ${totalWarns}`);
    console.log(
      publishReady && totalWarns === 0
        ? '✅ 可作为发布产品供教师填写'
        : publishReady
          ? '⚠️ 无阻塞错误，但有警告需人工确认'
          : '❌ 存在阻塞项，建议修复后再发布',
    );
    process.exit(totalErrors > 0 ? 1 : 0);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
