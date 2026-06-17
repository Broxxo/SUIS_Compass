import { effectiveTemplateSubjectEnableScore, examFullScoreFromGradeConfig } from '@repo/shared';
import type { GradeConfig } from '../types';
import type {
  ReportExamConfigScope,
  ReportTemplate,
  StudentTermReport,
  SubjectGroupGradeRow,
  Term,
} from '../types/classManagement';
import {
  getGradeCatalogIdForClass,
  getSchoolSegmentIdForStudentGradeLevel,
  getSegmentGradeIds,
} from './gradeConfig';

export type OverviewReportMeta = {
  academicYearId: string;
  academicYearName: string;
  term: Term;
  templateId: string;
  templateTitle: string | null;
  releasedAt: string | null;
  label: string;
  sortKey: string;
};

export type OverviewReportSnapshot = {
  meta: OverviewReportMeta;
  report: StudentTermReport;
  template: ReportTemplate | null;
  gradeCatalogId: string | null;
  examPreset: { examConfigs?: Record<string, ReportExamConfigScope> } | null;
};

export type StudentSubjectInsightItem = {
  subjectKey: string;
  subjectName: string;
  teacherName: string | null;
  learningAnalysis: string | null;
  supportPlan: string | null;
};

export type ExamTrendPoint = {
  reportKey: string;
  label: string;
  score: number;
  gradeLabel: string | null;
  /** 该数据点所属学业报告、学期下的学科满分 */
  fullScore: number | null;
};

export type ExamSubjectTrendSeries = {
  subjectKey: string;
  subjectName: string;
  points: ExamTrendPoint[];
};

export type SubjectScoreScale = {
  subjectKey: string;
  subjectName: string;
  fullScore: number | null;
};

/** 与某份学业报告绑定的满分表（不同学期/报告可能不同） */
export type ReportSubjectScoreScaleSet = {
  reportLabel: string;
  term: Term | null;
  templateTitle: string | null;
  scales: SubjectScoreScale[];
};

/** 从学年考试维度配置解析某学科在某年级的考试满分（如科学 50、语文 100）；非考试学科返回 null */
export function resolveSubjectExamFullScore(
  tpl: ReportTemplate | null,
  examPreset: { examConfigs?: Record<string, ReportExamConfigScope> } | null,
  subjectKey: string,
  gradeCatalogId: string | null,
): number | null {
  if (!tpl || !examPreset?.examConfigs) return null;
  const examKey = `${tpl.term}::${String(tpl.schoolSegmentId ?? '').trim()}`;
  const scope = examPreset.examConfigs[examKey];
  const examSubject = scope?.subjects?.find((s) => s.subjectKey === subjectKey);
  const examG =
    examSubject?.gradeConfigs?.find((g) => g.gradeId === gradeCatalogId) ?? examSubject?.gradeConfigs?.[0] ?? null;
  if (!examG) return null;
  return examFullScoreFromGradeConfig(examG.fullScore, examG.percentBands);
}

export function buildSubjectScoreScales(input: {
  subjects: Array<{ subjectKey: string; subjectName: string }>;
  template: ReportTemplate | null;
  examPreset: { examConfigs?: Record<string, ReportExamConfigScope> } | null;
  gradeCatalogId: string | null;
  gradeConfig: GradeConfig;
  studentGrade: number | null | undefined;
}): SubjectScoreScale[] {
  const seen = new Set<string>();
  const out: SubjectScoreScale[] = [];
  for (const { subjectKey, subjectName } of input.subjects) {
    if (!subjectKey || seen.has(subjectKey)) continue;
    seen.add(subjectKey);
    const hasExam = subjectHasExamScore(
      subjectKey,
      input.template,
      input.gradeCatalogId,
      input.gradeConfig,
      input.studentGrade,
      input.examPreset,
    );
    out.push({
      subjectKey,
      subjectName: subjectName || subjectKey,
      fullScore: hasExam
        ? resolveSubjectExamFullScore(input.template, input.examPreset, subjectKey, input.gradeCatalogId)
        : null,
    });
  }
  return out.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'zh-CN'));
}

/** 从单份学业报告快照解析该报告下各考试学科的满分 */
export function buildSubjectScoreScalesForSnapshot(
  snap: OverviewReportSnapshot,
  gradeConfig: GradeConfig,
  studentGrade: number | null | undefined,
): SubjectScoreScale[] {
  const subjects = snap.report.subjectReports.map((s) => ({
    subjectKey: s.subjectKey,
    subjectName: s.subjectName || s.subjectKey,
  }));
  return buildSubjectScoreScales({
    subjects,
    template: snap.template,
    examPreset: snap.examPreset,
    gradeCatalogId: snap.gradeCatalogId,
    gradeConfig,
    studentGrade,
  });
}

/** 教师中心学科看板：从所选学业报告 + 看板年级行解析各学科满分 */
export function buildSubjectScoreScalesForReportDashboard(input: {
  template: ReportTemplate | null;
  examPreset: { examConfigs?: Record<string, ReportExamConfigScope> } | null;
  gradeConfig: GradeConfig;
  gradeRows: SubjectGroupGradeRow[];
  reportLabel: string;
  term: Term;
  templateTitle: string | null;
}): ReportSubjectScoreScaleSet | null {
  if (!input.template || !input.examPreset?.examConfigs || input.gradeRows.length === 0) return null;
  const seen = new Set<string>();
  const scales: SubjectScoreScale[] = [];
  for (const row of input.gradeRows) {
    const gradeCatalogId = getGradeCatalogIdForClass(input.gradeConfig, row.grade, {});
    for (const s of row.subjectAverages) {
      if (!s.subjectKey || seen.has(s.subjectKey)) continue;
      if (
        !subjectHasExamScore(
          s.subjectKey,
          input.template,
          gradeCatalogId,
          input.gradeConfig,
          row.grade,
          input.examPreset,
        )
      ) {
        continue;
      }
      seen.add(s.subjectKey);
      scales.push({
        subjectKey: s.subjectKey,
        subjectName: s.subjectName,
        fullScore: resolveSubjectExamFullScore(
          input.template,
          input.examPreset,
          s.subjectKey,
          gradeCatalogId,
        ),
      });
    }
  }
  if (scales.length === 0) return null;
  return {
    reportLabel: input.reportLabel,
    term: input.term,
    templateTitle: input.templateTitle,
    scales: scales.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'zh-CN')),
  };
}

export function scaleForSubjectKey(
  subjectKey: string | undefined,
  subjectName: string | undefined,
  scales: SubjectScoreScale[] | undefined,
): SubjectScoreScale | undefined {
  if (!scales?.length) return undefined;
  if (subjectKey) {
    const byKey = scales.find((s) => s.subjectKey === subjectKey);
    if (byKey) return byKey;
  }
  if (subjectName) return scales.find((s) => s.subjectName === subjectName);
  return undefined;
}

export function formatScoreWithFullMark(
  score: number | null | undefined,
  subjectKey: string | undefined,
  subjectName: string | undefined,
  scales: SubjectScoreScale[] | undefined,
  isZh: boolean,
  explicitFullScore?: number | null,
): string {
  if (score == null || !Number.isFinite(score)) return '—';
  const max =
    explicitFullScore != null && explicitFullScore > 0
      ? explicitFullScore
      : scaleForSubjectKey(subjectKey, subjectName, scales)?.fullScore;
  if (max != null && max > 0) {
    const pct = ((score / max) * 100).toFixed(1);
    return isZh ? `${score}/${max}（得分率 ${pct}%）` : `${score}/${max} (${pct}%)`;
  }
  return String(score);
}

export function appendReportSubjectScoreScalesBlock(
  ctx: string,
  scaleSet: ReportSubjectScoreScaleSet | null | undefined,
  isZh: boolean,
): string {
  const examScales = (scaleSet?.scales ?? []).filter((s) => s.fullScore != null && s.fullScore > 0);
  if (examScales.length === 0) return ctx;
  let out = ctx;
  const reportHint = scaleSet?.reportLabel
    ? (isZh ? `（${scaleSet.reportLabel}）` : ` (${scaleSet.reportLabel})`)
    : '';
  out += isZh
    ? `\n考试学科满分${reportHint}（按该学业报告所属学期配置）：\n`
    : `\nExam full scores${reportHint} (per report/term config):\n`;
  for (const s of examScales) {
    out += `- ${s.subjectName}：${s.fullScore}\n`;
  }
  return out;
}

export function buildOverviewReportSortKey(input: {
  academicYearId: string;
  term: Term;
  releasedAt: string | null;
}): string {
  const termOrd = input.term === 'Semester 1' ? '1' : '2';
  return `${input.academicYearId}::${termOrd}::${input.releasedAt ?? ''}`;
}

export function gradeCatalogIdForOverviewStudent(
  gradeConfig: GradeConfig,
  studentGrade: number | null | undefined,
  className?: string | null,
): string | null {
  if (studentGrade == null || !Number.isFinite(studentGrade)) return null;
  return getGradeCatalogIdForClass(gradeConfig, studentGrade, { className: className ?? undefined });
}

export function subjectHasExamScore(
  subjectKey: string,
  template: ReportTemplate | null,
  gradeCatalogId: string | null,
  gradeConfig: GradeConfig,
  studentGrade: number | null | undefined,
  examPreset: { examConfigs?: Record<string, ReportExamConfigScope> } | null,
): boolean {
  if (!template) return false;
  const cfg = template.subjects?.find((s) => s.subjectKey === subjectKey);
  if (!cfg) return false;
  const segId =
    String(template.schoolSegmentId ?? '').trim()
    || getSchoolSegmentIdForStudentGradeLevel(gradeConfig, studentGrade ?? null)
    || '';
  return effectiveTemplateSubjectEnableScore(
    template.term,
    segId,
    subjectKey,
    gradeCatalogId,
    getSegmentGradeIds(gradeConfig, segId),
    cfg.enableScore !== false,
    examPreset,
  );
}

export function buildExamScoreTrendSeries(input: {
  snapshots: OverviewReportSnapshot[];
  gradeConfig: GradeConfig;
  studentGrade: number | null | undefined;
}): ExamSubjectTrendSeries[] {
  const { snapshots, gradeConfig, studentGrade } = input;
  const seriesMap = new Map<string, ExamSubjectTrendSeries>();

  for (const snap of snapshots) {
    const { meta, report, template, gradeCatalogId, examPreset } = snap;
    for (const subject of report.subjectReports) {
      if (subject.finalScore == null || !Number.isFinite(subject.finalScore)) continue;
      if (!subjectHasExamScore(subject.subjectKey, template, gradeCatalogId, gradeConfig, studentGrade, examPreset)) {
        continue;
      }
      const fullScore = resolveSubjectExamFullScore(template, examPreset, subject.subjectKey, gradeCatalogId);
      const existing = seriesMap.get(subject.subjectKey) ?? {
        subjectKey: subject.subjectKey,
        subjectName: subject.subjectName || subject.subjectKey,
        points: [],
      };
      existing.points.push({
        reportKey: meta.sortKey,
        label: meta.label,
        score: Number(Number(subject.finalScore).toFixed(1)),
        gradeLabel: subject.finalGrade ?? null,
        fullScore,
      });
      seriesMap.set(subject.subjectKey, existing);
    }
  }

  return Array.from(seriesMap.values())
    .filter((s) => s.points.length >= 1)
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'zh-CN'));
}
