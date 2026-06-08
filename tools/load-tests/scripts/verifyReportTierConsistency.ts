/**
 * 三层一致性复查：后台学年配置 → 教师压测任务 → 学生 GET 报告 API
 */
import type pg from 'pg';
import {
  effectiveTemplateSubjectEnableScore,
  isEvaluationGradeIncluded,
  type ReportYearInclusionPresetSlice,
} from '@repo/shared';
import { getGradeCatalogIdForClass, loadSchoolGradeStructure } from '../../../apps/api/src/lib/schoolGradeStructure.js';
import {
  loadYearInclusionPayload,
  type ReportLoadPlan,
  type SubjectFillTask,
} from './reportLoadContext.js';

export type TierConsistencyIssue = {
  level: 'error' | 'warn';
  code: string;
  message: string;
};

export type TierConsistencyReport = {
  templateId: string;
  templateTitle: string;
  released: boolean;
  issues: TierConsistencyIssue[];
  gradeSummary: Array<{
    gradeLevel: number;
    evalSubjectCount: number;
    examSubjectCount: number;
    teacherExamTaskRows: number;
    studentApiSubjectCount: number | null;
    studentApiExamScoreLeaks: number;
  }>;
};

type AdminSubjectRow = {
  subjectKey: string;
  subjectName: string;
  effectiveEnableScore: boolean;
  dimensionCount: number;
};

function presetSliceFromCtx(
  ctx: Awaited<ReturnType<typeof loadYearInclusionPayload>>,
): ReportYearInclusionPresetSlice {
  const subjectKeyToCourseId: Record<string, string> = {};
  for (const [sk, cid] of ctx.subjectKeyToCourseId) {
    subjectKeyToCourseId[sk] = cid;
  }
  return {
    stageInclusion: ctx.stageInclusion,
    evaluationGradeInclusion: ctx.evaluationGradeInclusion,
    examGradeInclusion: ctx.examGradeInclusion,
    examConfigs: ctx.examConfigs,
    subjectKeyToCourseId,
  };
}

function adminSubjectsByGrade(plan: ReportLoadPlan): Map<number, Map<string, AdminSubjectRow>> {
  const out = new Map<number, Map<string, AdminSubjectRow>>();
  for (const row of plan.subjectSettings.rows) {
    if (!row.inEvaluation) continue;
    const g = row.gradeLevel;
    const map = out.get(g) ?? new Map<string, AdminSubjectRow>();
    map.set(row.subjectKey, {
      subjectKey: row.subjectKey,
      subjectName: row.subjectName,
      effectiveEnableScore: row.effectiveEnableScore,
      dimensionCount: row.dimensionCount,
    });
    out.set(g, map);
  }
  return out;
}

function teacherTasksByGrade(tasks: SubjectFillTask[]): Map<number, Map<string, { enableScore: boolean; count: number }>> {
  const out = new Map<number, Map<string, { enableScore: boolean; count: number }>>();
  for (const t of tasks) {
    const g = t.classGrade;
    const map = out.get(g) ?? new Map();
    const prev = map.get(t.subjectKey);
    if (prev && prev.enableScore !== t.enableScore) {
      map.set(t.subjectKey, { enableScore: t.enableScore, count: prev.count + 1 });
    } else {
      map.set(t.subjectKey, { enableScore: t.enableScore, count: (prev?.count ?? 0) + 1 });
    }
    out.set(g, map);
  }
  return out;
}

async function fetchReportDetailAsUser(
  apiBase: string,
  userId: string,
  studentId: string,
  academicYearId: string,
  term: string,
  templateId: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: string; data: unknown }> {
  const base = apiBase.replace(/\/$/, '');
  const url =
    `${base}/api/classes/reports/students/${encodeURIComponent(studentId)}` +
    `/terms/${encodeURIComponent(academicYearId)}/${encodeURIComponent(term)}` +
    `/templates/${encodeURIComponent(templateId)}`;
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'X-User-Id': userId },
      signal: ac.signal,
    });
    const text = await res.text().catch(() => '');
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, body: text.slice(0, 300), data };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveStudentLoginUserId(pool: pg.Pool, studentId: string): Promise<string | null> {
  const row = (
    await pool.query(`SELECT id FROM users WHERE role = 'student' AND student_id = $1 LIMIT 1`, [studentId])
  ).rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

async function resolveAdminUserId(pool: pg.Pool): Promise<string | null> {
  const row = (
    await pool.query(
      `SELECT id FROM users WHERE role IN ('system-admin', 'admin') ORDER BY CASE role WHEN 'system-admin' THEN 0 ELSE 1 END LIMIT 1`,
    )
  ).rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

async function sampleStudentPerGrade(
  pool: pg.Pool,
  tasks: SubjectFillTask[],
  gradeLevels: number[],
): Promise<Map<number, { studentId: string; className: string }>> {
  const out = new Map<number, { studentId: string; className: string }>();
  for (const g of gradeLevels) {
    const hit = tasks.find((t) => t.classGrade === g);
    if (hit) out.set(g, { studentId: hit.studentId, className: hit.className });
  }
  return out;
}

export async function verifyReportTierConsistency(
  pool: pg.Pool,
  apiBase: string,
  plan: ReportLoadPlan,
  opts: { requestTimeoutMs: number; gradeLevels: number[] },
): Promise<TierConsistencyReport> {
  const issues: TierConsistencyIssue[] = [];
  const templateId = plan.template.id;
  const templateTitle = plan.template.title;

  const tplMeta = (
    await pool.query(`SELECT released_at FROM student_report_templates WHERE id = $1 LIMIT 1`, [templateId])
  ).rows[0] as { released_at: Date | null } | undefined;
  const released = !!tplMeta?.released_at;

  const inclusionCtx = await loadYearInclusionPayload(pool, plan.template.academicYearId);
  const presetSlice = presetSliceFromCtx(inclusionCtx);
  const gradeConfig = await loadSchoolGradeStructure();
  const segmentId = plan.template.schoolSegmentId;
  const segmentGradeIds = plan.subjectSettings.rows.map((r) => r.gradeCatalogId).filter((id, i, arr) => arr.indexOf(id) === i);

  const adminByGrade = adminSubjectsByGrade(plan);
  const teacherByGrade = teacherTasksByGrade(plan.subjectTasks);

  for (const gradeLevel of opts.gradeLevels) {
    const adminMap = adminByGrade.get(gradeLevel) ?? new Map();
    const teacherMap = teacherByGrade.get(gradeLevel) ?? new Map();

    for (const [sk, adminRow] of adminMap) {
      const teacherRow = teacherMap.get(sk);
      if (!teacherRow) {
        issues.push({
          level: 'warn',
          code: 'TEACHER_TASK_MISSING',
          message: `G${gradeLevel} 后台参评学科 ${adminRow.subjectName}（${sk}）无教师填写任务`,
        });
        continue;
      }
      if (teacherRow.enableScore !== adminRow.effectiveEnableScore) {
        issues.push({
          level: 'error',
          code: 'TEACHER_VS_ADMIN_SCORE_FLAG',
          message:
            `G${gradeLevel} ${adminRow.subjectName}：教师任务 enableScore=${teacherRow.enableScore}，` +
            `后台 effectiveEnableScore=${adminRow.effectiveEnableScore}`,
        });
      }
    }

    for (const [sk, teacherRow] of teacherMap) {
      if (!adminMap.has(sk)) {
        issues.push({
          level: 'error',
          code: 'TEACHER_TASK_NOT_IN_ADMIN',
          message: `G${gradeLevel} 教师任务包含未参评学科 ${sk}（enableScore=${teacherRow.enableScore}）`,
        });
      }
    }

    const examAdmin = [...adminMap.values()].filter((r) => r.effectiveEnableScore);
    const examTeacher = [...teacherMap.entries()].filter(([, v]) => v.enableScore);
    if (gradeLevel <= 2 && examAdmin.length > 0) {
      issues.push({
        level: 'error',
        code: 'G12_UNEXPECTED_EXAM_ADMIN',
        message: `G${gradeLevel} 后台配置含考试学科：${examAdmin.map((r) => r.subjectName).join('、')}`,
      });
    }
    if (gradeLevel <= 2 && examTeacher.length > 0) {
      issues.push({
        level: 'error',
        code: 'G12_UNEXPECTED_EXAM_TEACHER',
        message: `G${gradeLevel} 教师任务含测评成绩：${examTeacher.map(([sk]) => sk).join('、')}`,
      });
    }
  }

  const gradeSummary: TierConsistencyReport['gradeSummary'] = [];
  const samples = await sampleStudentPerGrade(pool, plan.subjectTasks, opts.gradeLevels);

  for (const gradeLevel of opts.gradeLevels) {
    const adminMap = adminByGrade.get(gradeLevel) ?? new Map();
    const teacherMap = teacherByGrade.get(gradeLevel) ?? new Map();
    const examAdmin = [...adminMap.values()].filter((r) => r.effectiveEnableScore);
    const teacherExamRows = [...teacherMap.values()].filter((v) => v.enableScore).reduce((n, v) => n + v.count, 0);

    let studentApiSubjectCount: number | null = null;
    let studentApiExamScoreLeaks = 0;

    const sample = samples.get(gradeLevel);
    if (sample && released) {
      const studentUserId = await resolveStudentLoginUserId(pool, sample.studentId);
      const viewerUserId = studentUserId ?? (await resolveAdminUserId(pool));
      const viewerRole = studentUserId ? 'student' : 'admin-fallback';
      if (!viewerUserId) {
        issues.push({
          level: 'warn',
          code: 'NO_API_VIEWER',
          message: `G${gradeLevel} 无 student/admin 账号，跳过 GET 报告 API 校验`,
        });
      } else {
        const res = await fetchReportDetailAsUser(
          apiBase,
          viewerUserId,
          sample.studentId,
          plan.template.academicYearId,
          plan.template.term,
          templateId,
          opts.requestTimeoutMs,
        );
        if (!res.ok) {
          issues.push({
            level: 'error',
            code: 'STUDENT_API_FAIL',
            message: `G${gradeLevel} GET 报告失败（${viewerRole}）HTTP ${res.status}: ${res.body}`,
          });
        } else {
          if (!studentUserId) {
            issues.push({
              level: 'warn',
              code: 'NO_STUDENT_LOGIN',
              message: `G${gradeLevel} 样例学生无登录账号，已用 admin 校验学科列表（未测学生端藏分）`,
            });
          }
          const payload = res.data as {
            report?: { subjectReports?: Array<{ subjectKey: string; finalScore?: number | null; finalGrade?: string | null }> };
            template?: { subjects?: Array<{ subjectKey: string; enableScore?: boolean }> };
          };
          const reportSubjects = payload.report?.subjectReports ?? [];
          const templateSubjects = payload.template?.subjects ?? [];
          studentApiSubjectCount = reportSubjects.length;

          const adminKeys = new Set(adminMap.keys());
          for (const s of reportSubjects) {
            if (!adminKeys.has(s.subjectKey)) {
              issues.push({
                level: 'error',
                code: 'STUDENT_PHANTOM_SUBJECT',
                message: `G${gradeLevel} 报告 API 出现未参评学科 ${s.subjectKey}（${sample.className}）`,
              });
            }
            const adminRow = adminMap.get(s.subjectKey);
            if (studentUserId && adminRow && !adminRow.effectiveEnableScore) {
              if (s.finalScore != null || (s.finalGrade ?? '').trim()) {
                studentApiExamScoreLeaks += 1;
                issues.push({
                  level: 'error',
                  code: 'STUDENT_NONEXAM_SCORE_LEAK',
                  message: `G${gradeLevel} 非考试学科 ${s.subjectKey} 学生 API 仍返回成绩`,
                });
              }
            }
          }
          for (const s of templateSubjects) {
            if (!adminKeys.has(s.subjectKey)) {
              issues.push({
                level: 'error',
                code: 'STUDENT_TEMPLATE_PHANTOM',
                message: `G${gradeLevel} template.subjects 含未参评学科 ${s.subjectKey}`,
              });
            }
          }

          const expectedForStudent = [
            ...new Set(
              plan.subjectTasks.filter((t) => t.studentId === sample.studentId).map((t) => t.subjectKey),
            ),
          ].sort();
          const apiReportKeys = reportSubjects.map((s) => s.subjectKey).sort();
          const apiTplKeys = templateSubjects.map((s) => s.subjectKey).sort();
          if (apiReportKeys.join(',') !== expectedForStudent.join(',')) {
            issues.push({
              level: 'error',
              code: 'API_REPORT_SUBJECT_MISMATCH',
              message:
                `G${gradeLevel} report.subjectReports 与压测任务不一致：` +
                `API=[${apiReportKeys.join(',')}] 期望=[${expectedForStudent.join(',')}]`,
            });
          }
          if (apiTplKeys.join(',') !== expectedForStudent.join(',')) {
            issues.push({
              level: 'error',
              code: 'API_TEMPLATE_SUBJECT_MISMATCH',
              message:
                `G${gradeLevel} template.subjects 与压测任务不一致：` +
                `API=[${apiTplKeys.join(',')}] 期望=[${expectedForStudent.join(',')}]`,
            });
          }
          for (const sk of expectedForStudent) {
            const taskRow = plan.subjectTasks.find(
              (t) => t.studentId === sample.studentId && t.subjectKey === sk,
            );
            const adminRow = adminMap.get(sk);
            if (taskRow && adminRow && taskRow.enableScore !== adminRow.effectiveEnableScore) {
              issues.push({
                level: 'error',
                code: 'API_TASK_VS_ADMIN_SCORE',
                message: `G${gradeLevel} ${sk} 压测任务 enableScore 与后台 effectiveEnableScore 不一致`,
              });
            }
          }
        }
      }
    } else if (sample && !released) {
      issues.push({
        level: 'warn',
        code: 'NOT_RELEASED',
        message: `模板未 release，跳过 G${gradeLevel} 学生 API（仅校验后台↔教师）`,
      });
    }

    gradeSummary.push({
      gradeLevel,
      evalSubjectCount: adminMap.size,
      examSubjectCount: examAdmin.length,
      teacherExamTaskRows: teacherExamRows,
      studentApiSubjectCount,
      studentApiExamScoreLeaks,
    });
  }

  for (const gradeLevel of opts.gradeLevels) {
    const adminMap = adminByGrade.get(gradeLevel) ?? new Map();
    for (const [sk, row] of adminMap) {
      const courseId = inclusionCtx.subjectKeyToCourseId.get(sk) ?? null;
      const gradeCatalogId = plan.subjectSettings.rows.find((r) => r.gradeLevel === gradeLevel)?.gradeCatalogId ?? null;
      if (courseId && gradeCatalogId && !isEvaluationGradeIncluded(
        segmentId,
        courseId,
        gradeCatalogId,
        segmentGradeIds,
        inclusionCtx.stageInclusion,
        inclusionCtx.evaluationGradeInclusion,
      )) {
        issues.push({
          level: 'error',
          code: 'ADMIN_ROW_NOT_IN_EVAL',
          message: `G${gradeLevel} 后台快照行 ${row.subjectName} 不在 evaluationGradeInclusion`,
        });
      }
    }
  }

  return {
    templateId,
    templateTitle,
    released,
    issues,
    gradeSummary,
  };
}

export function printTierConsistencyReport(report: TierConsistencyReport): void {
  console.log(`\n--- 三层一致性复查 · ${report.templateTitle} ---`);
  console.log(`模板 ${report.templateId} | 已 release: ${report.released ? '是' : '否'}`);
  for (const g of report.gradeSummary) {
    console.log(
      `G${g.gradeLevel} 参评 ${g.evalSubjectCount} | 考试 ${g.examSubjectCount} | 教师考试任务行 ${g.teacherExamTaskRows}` +
        (g.studentApiSubjectCount != null ? ` | 学生API学科 ${g.studentApiSubjectCount}` : '') +
        (g.studentApiExamScoreLeaks > 0 ? ` | 非考试泄分 ${g.studentApiExamScoreLeaks}` : ''),
    );
  }
  if (report.issues.length === 0) {
    console.log('✅ 后台配置、教师填写、学生视图一致');
    return;
  }
  for (const i of report.issues) {
    const tag = i.level === 'error' ? '❌' : '⚠️';
    console.log(`  ${tag} [${i.code}] ${i.message}`);
  }
}
