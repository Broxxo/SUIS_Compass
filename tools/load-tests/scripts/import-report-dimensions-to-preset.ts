/**
 * 从已发布的学业报告模板，将学科目标维度导入学年预设（student_report_year_dimension_presets）。
 *
 * 默认：2025-2026 上学期 · 小学期末学业报告 + 初中期末学业报告 → 先锋小学 / 先锋初中
 *
 *   npm run seed:report:import-dimensions
 *   npm run seed:report:import-dimensions -- --dry-run
 *   npm run seed:report:import-dimensions -- --academic-year-name=2025-2026 --term=Semester\ 1
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { staffingSubjectKeyFromCourse } from '@repo/shared';
import { loadSchoolGradeStructure } from '../../../apps/api/src/lib/schoolGradeStructure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

type Term = 'Semester 1' | 'Semester 2';

type PresetDimension = {
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  levelDescriptions: Record<string, string>;
};

type PresetSubject = {
  courseId: string;
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  enableScore: boolean;
  enableTeacherComment: boolean;
  enableTarget: boolean;
  gradeDimensions: Array<{ gradeId: string; dimensions: PresetDimension[] }>;
  dimensions: PresetDimension[];
};

type PresetPayload = {
  subjects: PresetSubject[];
  stageInclusion?: Record<string, string[]>;
  evaluationGradeInclusion?: Record<string, Record<string, string[]>>;
  examGradeInclusion?: Record<string, Record<string, string[]>>;
  examConfigs?: Record<string, unknown>;
  unifiedLevelDescriptions?: Record<string, string>;
};

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const yearName =
    argv.find((a) => a.startsWith('--academic-year-name='))?.split('=')[1]?.trim() ?? '2025-2026';
  const termRaw = argv.find((a) => a.startsWith('--term='))?.split('=')[1]?.trim() ?? 'Semester 1';
  const term = (termRaw === 'Semester 2' ? 'Semester 2' : 'Semester 1') as Term;
  const primaryTitle =
    argv.find((a) => a.startsWith('--primary-template='))?.split('=')[1]?.trim() ?? '小学期末学业报告';
  const middleTitle =
    argv.find((a) => a.startsWith('--middle-template='))?.split('=')[1]?.trim() ?? '初中期末学业报告';
  return { dryRun, yearName, term, primaryTitle, middleTitle };
}

function normalizeCourseId(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.includes('_') && s.startsWith('course')) {
    return s.replace(/_/g, '-');
  }
  return s;
}

function toPresetDimensions(
  rows: Array<{ dimension_label_zh: string | null; dimension_label_en: string | null; sort_order: number | null }>,
): PresetDimension[] {
  const sorted = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const out: PresetDimension[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const zh = String(row.dimension_label_zh ?? '').trim();
    const en = String(row.dimension_label_en ?? '').trim();
    if (!zh && !en) continue;
    const dimensionLabelZh = zh || en;
    const dimensionLabelEn = en || zh;
    const key = `${dimensionLabelZh}\u0001${dimensionLabelEn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dimensionLabelZh, dimensionLabelEn, levelDescriptions: {} });
  }
  return out;
}

function presetSubjectKey(sub: { courseId?: string; subjectKey?: string }): string {
  const cid = String(sub.courseId ?? '').trim();
  if (cid) return `course:${cid}`;
  const sk = String(sub.subjectKey ?? '').trim();
  return sk ? `key:${sk}` : '';
}

function mergeGradeDimensions(
  existing: PresetSubject['gradeDimensions'],
  incoming: PresetSubject['gradeDimensions'],
): PresetSubject['gradeDimensions'] {
  const map = new Map<string, PresetDimension[]>();
  for (const row of existing ?? []) {
    const gid = String(row.gradeId ?? '').trim();
    if (gid) map.set(gid, row.dimensions ?? []);
  }
  for (const row of incoming ?? []) {
    const gid = String(row.gradeId ?? '').trim();
    if (!gid) continue;
    if ((row.dimensions ?? []).length > 0) map.set(gid, row.dimensions ?? []);
  }
  return [...map.entries()].map(([gradeId, dimensions]) => ({ gradeId, dimensions }));
}

function mergePresetSubject(existing: PresetSubject, incoming: PresetSubject): PresetSubject {
  const gradeDimensions = mergeGradeDimensions(existing.gradeDimensions, incoming.gradeDimensions);
  const dimensions = incoming.dimensions.length > 0 ? incoming.dimensions : existing.dimensions;
  const enableTarget = gradeDimensions.some((g) => g.dimensions.length > 0) || dimensions.length > 0;
  return {
    ...existing,
    ...incoming,
    subjectNameZh: incoming.subjectNameZh || existing.subjectNameZh,
    subjectNameEn: incoming.subjectNameEn || existing.subjectNameEn,
    enableTarget,
    gradeDimensions,
    dimensions,
  };
}

function mergeSubjects(existing: PresetSubject[], incoming: PresetSubject[]): PresetSubject[] {
  const map = new Map<string, PresetSubject>();
  for (const row of existing) {
    const key = presetSubjectKey(row);
    if (key) map.set(key, row);
  }
  for (const row of incoming) {
    const key = presetSubjectKey(row);
    if (!key) continue;
    const prev = map.get(key);
    map.set(key, prev ? mergePresetSubject(prev, row) : row);
  }
  return [...map.values()];
}

function resolveEvaluationGrades(
  segmentId: string,
  courseId: string,
  segmentGradeIds: string[],
  evaluationGradeInclusion: PresetPayload['evaluationGradeInclusion'],
): string[] {
  const byCourse = evaluationGradeInclusion?.[segmentId]?.[courseId];
  if (Array.isArray(byCourse) && byCourse.length > 0) {
    return byCourse.map((g) => String(g).trim()).filter(Boolean);
  }
  return [...segmentGradeIds];
}

async function loadTemplateSubjects(pool: pg.Pool, templateId: string) {
  const rows = (await pool.query(
    `SELECT s.subject_key, s.subject_name_zh, s.subject_name_en,
            d.dimension_label_zh, d.dimension_label_en, d.sort_order
     FROM student_report_template_subjects s
     LEFT JOIN student_report_template_dimensions d ON d.template_subject_id = s.id
     WHERE s.template_id = $1
     ORDER BY s.sort_order ASC, d.sort_order ASC`,
    [templateId],
  )).rows as Array<{
    subject_key: string;
    subject_name_zh: string;
    subject_name_en: string;
    dimension_label_zh: string | null;
    dimension_label_en: string | null;
    sort_order: number | null;
  }>;
  const byKey = new Map<
    string,
    { subjectNameZh: string; subjectNameEn: string; dimRows: typeof rows }
  >();
  for (const row of rows) {
    const sk = String(row.subject_key ?? '').trim();
    if (!sk) continue;
    let hit = byKey.get(sk);
    if (!hit) {
      hit = {
        subjectNameZh: String(row.subject_name_zh ?? '').trim(),
        subjectNameEn: String(row.subject_name_en ?? '').trim(),
        dimRows: [],
      };
      byKey.set(sk, hit);
    }
    if (row.dimension_label_zh || row.dimension_label_en) {
      hit.dimRows.push(row);
    }
  }
  return byKey;
}

async function main() {
  const { dryRun, yearName, term, primaryTitle, middleTitle } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 15_000 });
  try {
    const yearRow = (
      await pool.query(`SELECT id, name FROM academic_years WHERE name = $1 LIMIT 1`, [yearName])
    ).rows[0] as { id: string; name: string } | undefined;
    if (!yearRow) throw new Error(`Academic year not found: ${yearName}`);
    const academicYearId = yearRow.id;

    const gradeConfig = await loadSchoolGradeStructure();
    const segmentById = new Map(
      (gradeConfig.segments ?? []).map((s) => [s.id, { label: s.label, gradeIds: s.gradeIds ?? [] }]),
    );

    const templates = (await pool.query(
      `SELECT id, title, school_segment_id, status
       FROM student_report_templates
       WHERE academic_year_id = $1 AND term = $2
         AND title IN ($3, $4)
       ORDER BY title`,
      [academicYearId, term, primaryTitle, middleTitle],
    )).rows as Array<{
      id: string;
      title: string;
      school_segment_id: string;
      status: string;
    }>;

    if (templates.length === 0) {
      throw new Error(`No templates found for ${yearName} ${term} (${primaryTitle} / ${middleTitle})`);
    }

    const presetRow = (
      await pool.query(
        `SELECT homeroom_comment_mode, payload FROM student_report_year_dimension_presets WHERE academic_year_id = $1 LIMIT 1`,
        [academicYearId],
      )
    ).rows[0] as { homeroom_comment_mode: string | null; payload: PresetPayload } | undefined;

    const existingPayload: PresetPayload = presetRow?.payload ?? {
      subjects: [],
      stageInclusion: {},
      evaluationGradeInclusion: {},
      examGradeInclusion: {},
      examConfigs: {},
      unifiedLevelDescriptions: {},
    };

    const courses = (await pool.query(`SELECT id, name FROM courses`)).rows as Array<{
      id: string;
      name: string;
    }>;
    const courseNameById = new Map(courses.map((c) => [c.id, c.name]));

    const imported: PresetSubject[] = [];

    for (const tpl of templates) {
      const segmentId = String(tpl.school_segment_id ?? '').trim();
      const seg = segmentById.get(segmentId);
      if (!seg) {
        console.warn(`Skip template「${tpl.title}」: unknown segment ${segmentId}`);
        continue;
      }
      console.log(`\n=== ${seg.label} · ${tpl.title} (${tpl.status}) ===`);
      const subjectMap = await loadTemplateSubjects(pool, tpl.id);
      for (const [subjectKey, meta] of subjectMap) {
        const courseId = normalizeCourseId(subjectKey);
        const dimensions = toPresetDimensions(meta.dimRows);
        if (dimensions.length === 0) {
          console.log(`  - ${meta.subjectNameZh}: 无目标维度，跳过`);
          continue;
        }
        const evalGrades = resolveEvaluationGrades(
          segmentId,
          courseId,
          seg.gradeIds,
          existingPayload.evaluationGradeInclusion,
        );
        const gradeDimensions = evalGrades.map((gradeId) => ({ gradeId, dimensions: [...dimensions] }));
        const courseName = courseNameById.get(courseId) ?? meta.subjectNameZh;
        const subject: PresetSubject = {
          courseId,
          subjectKey: staffingSubjectKeyFromCourse(courseId, courseName),
          subjectNameZh: meta.subjectNameZh,
          subjectNameEn: meta.subjectNameEn,
          enableScore: false,
          enableTeacherComment: false,
          enableTarget: true,
          gradeDimensions,
          dimensions: [...dimensions],
        };
        imported.push(subject);
        console.log(
          `  + ${meta.subjectNameZh} (${courseId}): ${dimensions.map((d) => d.dimensionLabelZh).join('、')} → 年级 ${evalGrades.join(', ')}`,
        );
      }
    }

    let mergedSubjects = mergeSubjects(existingPayload.subjects ?? [], imported);

    // 去掉与模板 courseId 同名的重复学科（如旧预设里多出的英语 course）
    const templateCourseIds = new Set(imported.map((s) => s.courseId));
    const templateNames = new Set(imported.map((s) => s.subjectNameZh));
    mergedSubjects = mergedSubjects.filter((sub) => {
      if (templateCourseIds.has(sub.courseId)) return true;
      if (templateNames.has(sub.subjectNameZh) && imported.some((i) => i.subjectNameZh === sub.subjectNameZh)) {
        return false;
      }
      return true;
    });

    // 若某年级维度列数少于该科模板列数，用模板 flat 维度补全（同学段跨年级一致）
    for (const sub of mergedSubjects) {
      const tplHit = imported.find((i) => i.courseId === sub.courseId);
      const fullDims = tplHit?.dimensions?.length ? tplHit.dimensions : sub.dimensions;
      if (!fullDims.length) continue;
      for (const row of sub.gradeDimensions) {
        if ((row.dimensions?.length ?? 0) < fullDims.length) {
          row.dimensions = fullDims.map((d) => ({ ...d }));
        }
      }
    }

    const nextPayload: PresetPayload = {
      ...existingPayload,
      subjects: mergedSubjects,
    };

    console.log(`\n合并结果: 原有 ${existingPayload.subjects?.length ?? 0} 门 → 导入 ${imported.length} 门 → 合计 ${mergedSubjects.length} 门`);
    if (dryRun) {
      console.log('\n[dry-run] 未写入数据库。');
      return;
    }

    const homeroomCommentMode = presetRow?.homeroom_comment_mode ?? 'disabled';
    await pool.query(
      `INSERT INTO student_report_year_dimension_presets
        (academic_year_id, homeroom_comment_mode, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id) DO UPDATE
       SET payload = EXCLUDED.payload,
           updated_at = CURRENT_TIMESTAMP`,
      [academicYearId, homeroomCommentMode, JSON.stringify(nextPayload)],
    );
    console.log(`\n已写入学年预设: ${yearName} (${academicYearId})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
