import { MenuSelect } from './MenuSelect';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAIContext } from '../contexts/AIContext';
import type {
  AcademicYear,
  ClassItem,
  Enrollment,
  ReportExamConfigScope,
  ReportTemplate,
  ReportTemplateSubject,
  Student,
  StudentTermReport,
  StudentTermSubjectReport,
  TeacherReportTemplateClassProgress,
  TeacherReportTemplateProgress,
  TargetLevel,
  Term,
} from '../types/classManagement';
import { loadAcademicYears, loadAllClasses, loadStudents, loadEnrollments } from '../lib/classStorage';
import { latestAcademicYear, useTermForYear } from '../lib/academicPeriodDefault';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import { fullUnifiedLevelTextFromPreset } from '../lib/reportPresetUnifiedLevels';
import {
  reportLetterGradeFromScore,
  reportLetterGradeFromExamPercentBands,
  mergeReportScoreGradeMinScores,
  examFullScoreFromGradeConfig,
  configuredReportScoreGradeMins,
  effectiveTemplateSubjectEnableScore,
  pickPreferredPublishedTask,
  resolveTemplateDimensionsForGrade,
} from '@repo/shared';
import type { GradeConfig } from '../types';
import {
  normalizeGradeConfig,
  getGradeCatalogIdForClass,
  getSchoolSegmentIdForClass,
  getSchoolSegmentIdForStudentGradeLevel,
  getSegmentGradeIds,
  countStudentsBySchoolSegment,
} from '../lib/gradeConfig';
import { loadGradeConfig, loadGradeConfigSync } from '../lib/storage';
import { PortraitLensWorkspace, type PortraitLensTab } from './student-portrait/PortraitLensWorkspace';
import { StudentOverviewPanel } from './student-portrait/StudentOverviewPanel';
import {
  buildExamScoreTrendSeries,
  buildOverviewReportSortKey,
  buildSubjectScoreScales,
  buildSubjectScoreScalesForSnapshot,
  gradeCatalogIdForOverviewStudent,
  type OverviewReportSnapshot,
  type ReportSubjectScoreScaleSet,
  type StudentSubjectInsightItem,
} from '../lib/studentPortraitOverview';
import { buildStudentPortraitAIPayload } from '../lib/studentPortraitAIContext';
import {
  AcademicYearSelect,
  FilterSelect,
  FilterToolbar,
  TermSelect,
} from './academicPeriodSelectors';
import { applyAcademicReportPdfReflow } from '../lib/academicReportPdfCloneFix';

type PortraitTab = 'overview' | 'my-students' | 'academic-reports';

type SubjectDraft = {
  id: string;
  subjectKey: string;
  subjectName: string;
  midtermScore: number | null;
  midtermGrade: string | null;
  finalScore: number | null;
  finalGrade: string | null;
  examDimensionScores?: Record<string, number | null> | null;
  learningQualityGrade: TargetLevel | null;
  teacherComment: string | null;
  teacherId: string | null;
  dimensions: Array<{
    id: string;
    dimensionKey: string;
    dimensionLabel: string;
    rating: TargetLevel;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>;
};

type StudentAnalysisRowDraft = {
  studentId: string;
  learningAnalysis: string;
  supportPlan: string;
};

function mergeStudentAnalysisRowsWithRoster(
  roster: Array<{ studentId: string }>,
  saved: StudentAnalysisRowDraft[],
): StudentAnalysisRowDraft[] {
  const byId = new Map(saved.map((r) => [r.studentId, r]));
  return roster.map((s) => {
    const hit = byId.get(s.studentId);
    return {
      studentId: s.studentId,
      learningAnalysis: hit?.learningAnalysis ?? '',
      supportPlan: hit?.supportPlan ?? '',
    };
  });
}

const WORKBENCH_ANALYSIS_TEXTAREA_MIN_PX = 72;
/** 班主任综合评价输入框默认高度（在 72px 基础上增加 15%） */
const WORKBENCH_HOMEROOM_COMMENT_TEXTAREA_MIN_PX = Math.round(WORKBENCH_ANALYSIS_TEXTAREA_MIN_PX * 1.15);
/** 个别学生分析：在默认高度上缩减约 30% */
const WORKBENCH_STUDENT_ANALYSIS_TEXTAREA_MIN_PX = 50;
const WORKBENCH_STUDENT_ANALYSIS_VISIBLE_ROWS = 5;
/** 表头 + 约 5 行学生（含单元格内边距）的可视高度，超出部分纵向滚动 */
const WORKBENCH_STUDENT_ANALYSIS_SCROLL_MAX_PX =
  40 + WORKBENCH_STUDENT_ANALYSIS_VISIBLE_ROWS * (WORKBENCH_STUDENT_ANALYSIS_TEXTAREA_MIN_PX + 24);

function WorkbenchAutoGrowTextarea({
  value,
  onChange,
  disabled,
  ariaLabel,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** 个别学生分析用：更矮的起始高度，仍可拖拽拉高与随内容增高 */
  compact?: boolean;
}) {
  const minPx = compact ? WORKBENCH_STUDENT_ANALYSIS_TEXTAREA_MIN_PX : WORKBENCH_ANALYSIS_TEXTAREA_MIN_PX;
  const ref = useRef<HTMLTextAreaElement>(null);
  const adjustHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, minPx)}px`;
  }, [minPx]);
  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      onInput={adjustHeight}
      rows={compact ? 2 : 3}
      className={`w-full resize-y overflow-hidden rounded border border-slate-300 px-2 py-1.5 text-sm leading-relaxed ${
        compact ? 'min-h-[3.15rem]' : 'min-h-[4.5rem]'
      }`}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

type WorkbenchStudentSubjectDraft = {
  studentId: string;
  studentName: string;
  subject: SubjectDraft;
  homeroomComment: string;
};

type ReleasedClassReportOption = {
  key: string;
  label: string;
  academicYearId: string;
  term: Term;
  templateId: string;
  releasedAt: string | null;
  templateTitle: string | null;
};

type ClassReportSnapshotItem = {
  student: Student;
  report: StudentTermReport;
};

/**
 * 将 API 已按年级过滤的报告与模板维度对齐；学生端仅展示已保存学科，不补占位等第。
 */
function gradeCatalogIdForStudentGrade(
  gradeConfig: GradeConfig,
  gradeLevel: number | null | undefined,
  className?: string | null,
): string | null {
  if (gradeLevel == null || !Number.isFinite(gradeLevel)) return null;
  return getGradeCatalogIdForClass(gradeConfig, gradeLevel, { className: className ?? undefined });
}

type MergeStudentTermReportOptions = {
  /** 教师工作台：为模板学科补空白行；学生端仅展示已保存学科 */
  padMissingSubjects?: boolean;
  /** 无教师填写数据时，等第显示为「—」而非占位 A */
  blankUnsetRatings?: boolean;
};

function mergeStudentTermReportWithTemplate(
  detail: StudentTermReport,
  template: ReportTemplate | null,
  gradeCatalogId?: string | null,
  options?: MergeStudentTermReportOptions,
): StudentTermReport {
  const padMissingSubjects = options?.padMissingSubjects ?? false;
  const blankUnsetRatings = options?.blankUnsetRatings ?? false;
  const defaultRating = (rating: TargetLevel | null | undefined): TargetLevel | null =>
    (rating ?? (blankUnsetRatings ? null : 'A')) as TargetLevel | null;

  const normalized: StudentTermReport = {
    ...detail,
    subjectReports: (detail.subjectReports ?? []).map((s) => ({
      ...s,
      dimensions: (s.dimensions ?? []).map((d) => ({
        ...d,
        rating: defaultRating(d.rating) as TargetLevel,
      })),
    })),
  };
  const tplSubjects = template?.subjects ?? [];
  if (tplSubjects.length === 0) {
    return normalized;
  }
  const savedByKey = new Map(
    normalized.subjectReports.map((s) => [String(s.subjectKey ?? '').trim(), s] as const),
  );
  const mergedSubjects: StudentTermSubjectReport[] = [];
  for (const tplSubject of tplSubjects) {
    const tplDims = resolveTemplateDimensionsForGrade(tplSubject, gradeCatalogId ?? null);
    const existing = savedByKey.get(String(tplSubject.subjectKey ?? '').trim());
    if (!existing) {
      if (!padMissingSubjects) continue;
      mergedSubjects.push({
        id: `tpl-${tplSubject.id}`,
        subjectKey: tplSubject.subjectKey,
        subjectName: tplSubject.subjectName,
        midtermScore: null,
        midtermGrade: null,
        finalScore: null,
        finalGrade: null,
        learningQualityGrade: (blankUnsetRatings ? null : 'A') as TargetLevel,
        teacherComment: null,
        teacherId: null,
        dimensions: tplDims.map((d) => ({
          id: d.id ?? `tpl-dim-${d.dimensionKey}`,
          dimensionKey: d.dimensionKey,
          dimensionLabel: d.dimensionLabel,
          sortOrder: d.sortOrder,
          rating: (blankUnsetRatings ? null : 'A') as TargetLevel,
          levelDescriptions: d.levelDescriptions ?? {},
        })),
        createdAt: null,
        updatedAt: null,
      });
      continue;
    }
    mergedSubjects.push({
      ...existing,
      subjectName: tplSubject.subjectName,
      learningQualityGrade: defaultRating(existing.learningQualityGrade) as TargetLevel,
      dimensions: tplDims.map((tplDim) => {
        const oldDim = existing.dimensions.find((d) => d.dimensionKey === tplDim.dimensionKey);
        return {
          id: oldDim?.id ?? tplDim.id ?? tplDim.dimensionKey,
          dimensionKey: tplDim.dimensionKey,
          dimensionLabel: tplDim.dimensionLabel,
          sortOrder: tplDim.sortOrder,
          rating: defaultRating(oldDim?.rating) as TargetLevel,
          levelDescriptions: tplDim.levelDescriptions ?? {},
        };
      }),
    });
  }
  return { ...normalized, subjectReports: mergedSubjects };
}

function reportTermLabel(term: Term, isZh: boolean): string {
  if (term === 'Semester 1') return isZh ? '上学期' : 'Semester 1';
  return isZh ? '下学期' : 'Semester 2';
}

function hasStudentReportContent(report: StudentTermReport): boolean {
  if ((report.homeroomComment ?? '').trim()) return true;
  return report.subjectReports.some((s) => {
    if (s.finalScore != null || s.midtermScore != null) return true;
    if (s.finalGrade || s.midtermGrade) return true;
    if (s.learningQualityGrade) return true;
    if (s.dimensions.some((d) => !!d.rating)) return true;
    return false;
  });
}

function workbenchExamLetterGrade(
  score: number | null | undefined,
  rules: {
    examFullScore: number | null;
    configuredBands: Partial<Record<string, number>> | null;
    letterMins: Partial<Record<string, number>>;
  },
) {
  if (score == null || !Number.isFinite(score)) return null;
  if (rules.configuredBands && Object.keys(rules.configuredBands).length > 0) {
    return reportLetterGradeFromExamPercentBands(score, rules.examFullScore, rules.configuredBands);
  }
  return reportLetterGradeFromScore(score, rules.letterMins);
}

type ReportExamPresetSlice = {
  examConfigs?: Record<string, ReportExamConfigScope>;
};

function buildExamScoreRulesForSubject(
  tpl: ReportTemplate | null,
  examPreset: ReportExamPresetSlice | null,
  subjectKey: string,
  gradeCatalogId: string | null,
): {
  examFullScore: number | null;
  configuredBands: Partial<Record<string, number>> | null;
  letterMins: Partial<Record<string, number>>;
} {
  const letterFallback = mergeReportScoreGradeMinScores(tpl?.scoreGradeMinScores ?? {});
  if (!tpl || !examPreset?.examConfigs) {
    return { examFullScore: null, configuredBands: null, letterMins: letterFallback };
  }
  const examKey = `${tpl.term}::${String(tpl.schoolSegmentId ?? '').trim()}`;
  const scope = examPreset.examConfigs[examKey];
  const examSubject = scope?.subjects?.find((s) => s.subjectKey === subjectKey);
  const examG =
    examSubject?.gradeConfigs?.find((g) => g.gradeId === gradeCatalogId) ?? examSubject?.gradeConfigs?.[0] ?? null;
  const configuredBands = configuredReportScoreGradeMins(examG?.percentBands ?? {});
  const hasExamBands = Object.keys(configuredBands).length > 0;
  return {
    examFullScore: hasExamBands ? examFullScoreFromGradeConfig(examG?.fullScore, examG?.percentBands) : null,
    configuredBands: hasExamBands ? configuredBands : null,
    letterMins: letterFallback,
  };
}

function resolveSubjectAssessmentGrade(
  subject: Pick<StudentTermSubjectReport, 'subjectKey' | 'finalGrade' | 'finalScore'>,
  tpl: ReportTemplate | null,
  examPreset: ReportExamPresetSlice | null,
  gradeCatalogId: string | null,
): string {
  if (subject.finalGrade) return subject.finalGrade;
  const rules = buildExamScoreRulesForSubject(tpl, examPreset, subject.subjectKey, gradeCatalogId);
  return workbenchExamLetterGrade(subject.finalScore, rules) ?? '—';
}

/** 得分率（%）分段：与自动分析纵向柱状图一致 */
const WORKBENCH_SCORE_PCT_BIN_LABELS = [
  { labelZh: '100–90', labelEn: '100–90', minPct: 90, maxPct: 100, maxInclusive: true },
  { labelZh: '80–90', labelEn: '80–90', minPct: 80, maxPct: 90, maxInclusive: false },
  { labelZh: '70–80', labelEn: '70–80', minPct: 70, maxPct: 80, maxInclusive: false },
  { labelZh: '60–70', labelEn: '60–70', minPct: 60, maxPct: 70, maxInclusive: false },
  { labelZh: '35–60', labelEn: '35–60', minPct: 35, maxPct: 60, maxInclusive: false },
  { labelZh: '0–35', labelEn: '0–35', minPct: 0, maxPct: 35, maxInclusive: false },
] as const;

function workbenchPctInScoreBin(
  p: number,
  def: { minPct: number; maxPct: number; maxInclusive: boolean },
): boolean {
  if (!Number.isFinite(p)) return false;
  if (p < def.minPct - 1e-9) return false;
  if (def.maxInclusive) return p <= def.maxPct + 1e-9;
  return p < def.maxPct - 1e-9;
}

/** 工作台「班主任综合评价」模式（非模板学科 key） */
const WORKBENCH_HOMEROOM_SENTINEL = '__homeroom__';

function isWorkbenchHomeroomMode(subjectKey: string): boolean {
  return subjectKey === WORKBENCH_HOMEROOM_SENTINEL;
}

/** 该班在当前模板下是否有可填写的学科或班主任入口 */
function classHasWorkbenchEntry(
  cls: TeacherReportTemplateClassProgress,
  templateSubjects: { subjectKey: string }[] | undefined,
): boolean {
  const homeroomOk = Boolean(cls.homeroomEvaluationAvailable ?? cls.requiresHomeroomComment);
  if (!templateSubjects?.length) {
    return cls.requiredSubjectKeys.length > 0 || homeroomOk;
  }
  const hasSubject = templateSubjects.some((s) => cls.requiredSubjectKeys.includes(s.subjectKey));
  return hasSubject || homeroomOk;
}

function sortWorkbenchClassesByGrade(
  classes: TeacherReportTemplateClassProgress[],
): TeacherReportTemplateClassProgress[] {
  return [...classes].sort((a, b) => (a.grade - b.grade) || a.className.localeCompare(b.className));
}

function pickDefaultWorkbenchClassId(
  classes: TeacherReportTemplateClassProgress[],
  templateSubjects: { subjectKey: string }[] | undefined,
): string {
  const sorted = sortWorkbenchClassesByGrade(classes);
  const withEntry = sorted.find((c) => classHasWorkbenchEntry(c, templateSubjects));
  return withEntry?.classId ?? sorted[0]?.classId ?? '';
}

function filterWorkbenchActionableClasses(
  classes: TeacherReportTemplateClassProgress[],
  templateSubjects: { subjectKey: string }[] | undefined,
): TeacherReportTemplateClassProgress[] {
  return sortWorkbenchClassesByGrade(classes).filter((c) => classHasWorkbenchEntry(c, templateSubjects));
}

/** 班级下拉：优先显示 P6A，不出现 G6 P6A 式前缀 */
function workbenchClassShortLabel(c: Pick<TeacherReportTemplateClassProgress, 'className' | 'grade'>): string {
  const raw = String(c.className ?? '').trim();
  if (!raw) return `G${c.grade}`;
  const noGGrade = raw.replace(new RegExp(`^G\\s*${c.grade}\\s+`, 'i'), '').trim();
  if (noGGrade) return noGGrade;
  return raw.replace(/^G\d+\s+/i, '').trim() || raw;
}

function workbenchSubjectModuleLabel(s: Pick<ReportTemplateSubject, 'subjectName' | 'subjectNameZh' | 'subjectNameEn'>, isZh: boolean): string {
  const zh = (s.subjectNameZh || '').trim() || s.subjectName;
  const en = (s.subjectNameEn || '').trim() || s.subjectName;
  if (isZh) return `${zh} / ${en}`;
  return `${en} / ${zh}`;
}

/** PDF 截图前在克隆 DOM 上去掉控件边框、去掉无评语学生行、去掉操作按钮（cloneRoot 为 html2canvas 正在渲染的根节点） */
function applyWorkbenchPdfCloneTransforms(cloneRoot: HTMLElement, includedStudentIds: Set<string>) {
  const clonedDoc = cloneRoot.ownerDocument;
  if (!clonedDoc) return;
  cloneRoot.querySelectorAll('[data-workbench-pdf-scroll]').forEach((el) => {
    const h = el as HTMLElement;
    h.style.maxHeight = 'none';
    h.style.overflow = 'visible';
    h.style.height = 'auto';
  });

  cloneRoot.querySelectorAll('[data-workbench-pdf-hscroll]').forEach((el) => {
    const h = el as HTMLElement;
    h.style.overflowX = 'visible';
    h.style.overflow = 'visible';
  });

  cloneRoot.querySelectorAll('[data-workbench-pdf-comment-row]').forEach((el) => {
    const id = el.getAttribute('data-workbench-pdf-comment-row');
    if (!id || !includedStudentIds.has(id)) el.remove();
  });

  cloneRoot.querySelectorAll('[data-menu-select]').forEach((el) => {
    const span = clonedDoc.createElement('span');
    span.textContent = (el.getAttribute('data-menu-select-label') ?? '').trim();
    span.style.display = 'inline-block';
    span.style.maxWidth = '100%';
    span.style.verticalAlign = 'middle';
    span.style.lineHeight = '1.45';
    span.style.fontFamily = 'inherit';
    span.style.fontSize = 'inherit';
    span.style.color = '#0f172a';
    el.replaceWith(span);
  });

  cloneRoot.querySelectorAll('button').forEach((b) => b.remove());

  const controls = Array.from(cloneRoot.querySelectorAll('input, textarea, select'));
  for (const el of controls) {
    const tag = el.tagName;
    const span = clonedDoc.createElement('span');
    if (tag === 'SELECT') {
      const sel = el as HTMLSelectElement;
      const opt = sel.options[sel.selectedIndex];
      span.textContent = (opt?.text ?? sel.value ?? '').trim();
    } else {
      const inp = el as HTMLInputElement | HTMLTextAreaElement;
      span.textContent = inp.value ?? '';
    }
    const st = span.style;
    st.whiteSpace = tag === 'TEXTAREA' ? 'pre-wrap' : 'normal';
    st.display = tag === 'TEXTAREA' ? 'block' : 'inline-block';
    st.maxWidth = '100%';
    st.width = tag === 'TEXTAREA' ? '100%' : '';
    st.verticalAlign = 'middle';
    st.lineHeight = '1.45';
    st.fontFamily = 'inherit';
    st.fontSize = 'inherit';
    st.color = '#0f172a';
    el.replaceWith(span);
  }

  cloneRoot.querySelectorAll('[data-workbench-pdf-text-box]').forEach((el) => {
    const h = el as HTMLElement;
    h.style.border = '1px solid #cbd5e1';
    h.style.borderRadius = '6px';
    h.style.padding = '8px 10px';
    h.style.backgroundColor = '#ffffff';
    h.style.boxSizing = 'border-box';
  });

  cloneRoot.style.width = `${Math.ceil(Math.max(cloneRoot.scrollWidth, cloneRoot.clientWidth))}px`;
  cloneRoot.style.overflow = 'visible';
}

/** PDF 页边距：底部略大，避免内容贴边；切片高度 = 页高 - 上边距 - 下边距 */
const WB_PDF_MARGIN = { top: 33, right: 44, bottom: 64, left: 44 } as const;

/** 块与块之间的垂直间距（pt），含元信息块底部与下一板块之间 */
const WB_PDF_SECTION_GAP = 7;

/** html2canvas 与 PDF 缩放舍入余量，避免「刚好超出」被误判为放不下 */
const WB_PDF_HEIGHT_FUZZ = 5;

function wbPdfCanvasHeightPt(pdf: import('jspdf').default, canvas: HTMLCanvasElement): number {
  const pageW = pdf.internal.pageSize.getWidth();
  const M = WB_PDF_MARGIN;
  const drawW = pageW - M.left - M.right;
  return (canvas.height * drawW) / canvas.width;
}

/** 若当前页剩余高度过小，换到新页顶再排表，避免无意义顶格截断 */
function wbPdfNormalizeFlowForTableChunk(pdf: import('jspdf').default, flow: { y: number }): void {
  const pageH = pdf.internal.pageSize.getHeight();
  const M = WB_PDF_MARGIN;
  if (pageH - M.bottom - flow.y < 56) {
    pdf.addPage();
    flow.y = M.top;
  }
}

/**
 * 将（可能较高的）整图按页裁切连续写入 PDF：从 `flow.y` 起画，页内放不下再 addPage。
 * 使用「按像素裁成多张 canvas 再 addImage」避免整图位移依赖阅读器裁剪；部分环境下整图重复绘制会在分页处出现叠影/整块重复。
 */
function wbPdfAppendImageSlicesFlow(
  pdf: import('jspdf').default,
  canvas: HTMLCanvasElement,
  flow: { y: number },
  quality = 0.92,
): void {
  const pageH = pdf.internal.pageSize.getHeight();
  const pageW = pdf.internal.pageSize.getWidth();
  const M = WB_PDF_MARGIN;
  const drawW = pageW - M.left - M.right;
  if (canvas.width <= 0 || canvas.height <= 0) return;
  const scale = drawW / canvas.width;
  const imgH = canvas.height * scale;
  if (imgH <= 0) return;

  const fullBand = pageH - M.top - M.bottom;

  let yTop = flow.y;
  let bandH = pageH - M.bottom - yTop;
  if (bandH < 24) {
    pdf.addPage();
    flow.y = M.top;
    yTop = M.top;
    bandH = fullBand;
  }
  if (imgH <= fullBand + WB_PDF_HEIGHT_FUZZ && bandH + WB_PDF_HEIGHT_FUZZ < imgH) {
    pdf.addPage();
    flow.y = M.top;
    yTop = M.top;
    bandH = fullBand;
  }

  let srcY = 0;
  while (srcY < canvas.height - 1e-6) {
    yTop = flow.y;
    bandH = pageH - M.bottom - yTop;
    if (bandH < 24) {
      pdf.addPage();
      flow.y = M.top;
      yTop = M.top;
      bandH = fullBand;
    }
    const maxSlicePx = Math.max(1, Math.floor((bandH + WB_PDF_HEIGHT_FUZZ) / scale));
    const slicePx = Math.min(canvas.height - srcY, maxSlicePx);
    if (slicePx <= 0) break;

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = Math.ceil(slicePx);
    const ctx = sliceCanvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
    const sliceData = sliceCanvas.toDataURL('image/jpeg', quality);
    const sliceImgH = (slicePx * drawW) / canvas.width;
    pdf.addImage(sliceData, 'JPEG', M.left, yTop, drawW, sliceImgH);

    srcY += slicePx;
    flow.y = yTop + sliceImgH;
  }
  flow.y += WB_PDF_SECTION_GAP;
}

function wbPdfAppendCanvasSlices(pdf: import('jspdf').default, canvas: HTMLCanvasElement, quality = 0.92): void {
  const pageH = pdf.internal.pageSize.getHeight();
  const pageW = pdf.internal.pageSize.getWidth();
  const M = WB_PDF_MARGIN;
  const drawW = pageW - M.left - M.right;
  if (canvas.width <= 0 || canvas.height <= 0) return;
  const scale = drawW / canvas.width;
  const sliceBandPt = pageH - M.top - M.bottom;

  let srcY = 0;
  let first = true;
  while (srcY < canvas.height - 1e-6) {
    if (!first) pdf.addPage();
    first = false;
    const maxSlicePx = Math.max(1, Math.floor((sliceBandPt + WB_PDF_HEIGHT_FUZZ) / scale));
    const slicePx = Math.min(canvas.height - srcY, maxSlicePx);
    if (slicePx <= 0) break;

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = Math.ceil(slicePx);
    const ctx = sliceCanvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
    const sliceData = sliceCanvas.toDataURL('image/jpeg', quality);
    const sliceImgH = (slicePx * drawW) / canvas.width;
    pdf.addImage(sliceData, 'JPEG', M.left, M.top, drawW, sliceImgH);
    srcY += slicePx;
  }
}

async function wbPdfAppendElementAsImageSlices(
  pdf: import('jspdf').default,
  el: HTMLElement | null,
  includedStudentIds: Set<string>,
  flow?: { y: number },
): Promise<void> {
  if (!el) return;
  const html2canvas = (await import('html2canvas')).default;
  const capW = Math.max(el.scrollWidth, el.clientWidth, 400);
  const capH = Math.max(el.scrollHeight, 200);
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    scrollX: 0,
    scrollY: 0,
    windowWidth: capW,
    windowHeight: capH,
    onclone: (a, b) => {
      const cloneEl = (a instanceof HTMLElement ? a : b instanceof HTMLElement ? b : null) as HTMLElement | null;
      if (!cloneEl) return;
      applyWorkbenchPdfCloneTransforms(cloneEl, includedStudentIds);
      applyAcademicReportPdfReflow(cloneEl);
    },
  });
  if (flow) wbPdfAppendImageSlicesFlow(pdf, canvas, flow);
  else wbPdfAppendCanvasSlices(pdf, canvas);
}

async function wbPdfAppendTitleLinesAsImage(
  pdf: import('jspdf').default,
  lines: string[],
  flow?: { y: number },
): Promise<void> {
  const parts = lines.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return;
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:760px;background:#ffffff;padding:4px 0 10px;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;';
  for (const line of parts) {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;min-height:22px;box-sizing:border-box;font-size:14px;font-weight:600;margin-bottom:4px;line-height:1.35;padding:2px 0;white-space:pre-wrap;';
    row.textContent = line;
    host.appendChild(row);
  }
  document.body.appendChild(host);
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(host, { scale: 2, backgroundColor: '#ffffff', logging: false });
    if (flow) wbPdfAppendImageSlicesFlow(pdf, canvas, flow);
    else wbPdfAppendCanvasSlices(pdf, canvas);
  } finally {
    host.remove();
  }
}

/** 学业报告 PDF 页眉：第二行用 flex + 中间留白，避免普通空格被 HTML 折叠导致「加空隙无效」。 */
async function wbPdfAppendStudentReportPdfHeaderAsImage(
  pdf: import('jspdf').default,
  opts: { line1: string; classShort: string; displayName: string; flow?: { y: number } },
): Promise<void> {
  const line1 = opts.line1.trim();
  if (!line1) return;
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:760px;background:#ffffff;padding:4px 0 9px;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;';

  const row1 = document.createElement('div');
  row1.style.cssText =
    'display:flex;align-items:center;min-height:20px;box-sizing:border-box;font-size:14px;font-weight:600;margin-bottom:4px;line-height:1.35;padding:2px 0;white-space:pre-wrap;';
  row1.textContent = line1;

  const row2 = document.createElement('div');
  row2.style.cssText =
    'display:flex;align-items:center;flex-wrap:wrap;box-sizing:border-box;font-size:14px;font-weight:600;margin-bottom:4px;line-height:1.35;padding:2px 0;gap:22px;';

  const left = document.createElement('span');
  left.style.flex = '0 0 auto';
  left.textContent = `Class: ${opts.classShort}`;

  const right = document.createElement('span');
  right.style.flex = '0 0 auto';
  right.textContent = `Name: ${opts.displayName}`;

  row2.appendChild(left);
  row2.appendChild(right);

  host.appendChild(row1);
  host.appendChild(row2);
  document.body.appendChild(host);
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(host, { scale: 2, backgroundColor: '#ffffff', logging: false });
    if (opts.flow) wbPdfAppendImageSlicesFlow(pdf, canvas, opts.flow);
    else wbPdfAppendCanvasSlices(pdf, canvas);
  } finally {
    host.remove();
  }
}

/** 与「分块成绩表」PDF 合成块一致：一行板块标题 + 单线框正文，宽度 780px */
async function wbPdfAppendWorkbenchTextSectionAsImage(
  pdf: import('jspdf').default,
  opts: { title: string; body: string; flow?: { y: number } },
): Promise<void> {
  const raw = opts.body.replace(/\r\n/g, '\n').trim();
  if (!raw) return;

  const host = document.createElement('div');
  host.setAttribute('data-academic-report-pdf-scope', '');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:780px;max-width:780px;background:#ffffff;padding:8px 16px 12px;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;';

  const titleEl = document.createElement('div');
  titleEl.textContent = opts.title;
  titleEl.style.cssText = 'font-weight:600;font-size:13px;margin:0 0 7px 0;color:#1e293b;';

  const bodyEl = document.createElement('div');
  bodyEl.setAttribute('data-student-report-pdf-body-text', '');
  bodyEl.textContent = raw;
  bodyEl.style.cssText =
    'box-sizing:border-box;width:100%;border:1px solid #e2e8f0;background:#ffffff;padding:7px 8px;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;color:#0f172a;';

  host.appendChild(titleEl);
  host.appendChild(bodyEl);
  document.body.appendChild(host);
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      onclone: (a, b) => {
        const cloneEl = (a instanceof HTMLElement ? a : b instanceof HTMLElement ? b : null) as HTMLElement | null;
        if (cloneEl) applyAcademicReportPdfReflow(cloneEl);
      },
    });
    if (opts.flow) wbPdfAppendImageSlicesFlow(pdf, canvas, opts.flow);
    else wbPdfAppendCanvasSlices(pdf, canvas);
  } finally {
    host.remove();
  }
}

/** 分块渲染「表头 + 若干数据行」为图片再写入 PDF。无 flow 时按固定行数分块；有 flow 时按当前页剩余高度尽量多放行，接近底部再换块并重复表头。 */
async function wbPdfAppendChunkedDataTableAsImages(
  pdf: import('jspdf').default,
  opts: {
    sectionTitle: string | null;
    showSectionTitleOnFirstChunkOnly: boolean;
    head: string[];
    body: string[][];
    rowsPerChunk: number;
    flow?: { y: number };
    /** 有 flow 时单次尝试的最大行数（防单张 canvas 过大）；默认 100 */
    maxRowsPerChunk?: number;
    /** 学业质量评价等表格：单元格文字居中 */
    cellTextAlign?: 'left' | 'center';
  },
): Promise<void> {
  const {
    sectionTitle,
    showSectionTitleOnFirstChunkOnly,
    head,
    body,
    rowsPerChunk,
    flow,
    maxRowsPerChunk = 100,
    cellTextAlign = 'left',
  } = opts;
  const centered = cellTextAlign === 'center';
  if (body.length === 0) return;

  const host = document.createElement('div');
  host.setAttribute('data-academic-report-pdf-scope', '');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:780px;max-width:780px;background:#ffffff;padding:8px 16px 12px;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;line-height:1.35;color:#0f172a;';

  document.body.appendChild(host);
  const html2canvas = (await import('html2canvas')).default;

  const renderChunkCanvas = async (
    startIdx: number,
    rowCount: number,
    showSectionHeading: boolean,
  ): Promise<HTMLCanvasElement> => {
    const chunk = body.slice(startIdx, startIdx + rowCount);
    host.innerHTML = '';
    host.setAttribute('data-academic-report-pdf-scope', '');
    const frag = document.createDocumentFragment();
    if (showSectionHeading && sectionTitle) {
      const h = document.createElement('div');
      h.textContent = sectionTitle;
      h.style.cssText = 'font-weight:600;font-size:13px;margin:0 0 7px 0;color:#1e293b;';
      frag.appendChild(h);
    }
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;border:1px solid #e2e8f0;table-layout:fixed;';
    if (centered) table.setAttribute('data-academic-quality-table', '');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.style.background = '#f1f5f9';
    for (const c of head) {
      const th = document.createElement('th');
      th.style.cssText =
        `border:1px solid #e2e8f0;padding:0;text-align:${centered ? 'center' : 'left'};font-weight:600;font-size:11px;vertical-align:middle;word-break:break-word;`;
      const thInner = document.createElement('div');
      thInner.textContent = c;
      if (centered) thInner.style.textAlign = 'center';
      th.appendChild(thInner);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of chunk) {
      const tr = document.createElement('tr');
      for (let j = 0; j < row.length; j += 1) {
        const td = document.createElement('td');
        td.style.cssText = `border:1px solid #e2e8f0;padding:0;vertical-align:middle;text-align:${centered ? 'center' : 'left'};`;
        const inner = document.createElement('div');
        inner.textContent = row[j];
        if (centered) inner.style.textAlign = 'center';
        td.appendChild(inner);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    frag.appendChild(table);
    host.appendChild(frag);

    return html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      onclone: (a, b) => {
        const cloneEl = (a instanceof HTMLElement ? a : b instanceof HTMLElement ? b : null) as HTMLElement | null;
        if (cloneEl) applyAcademicReportPdfReflow(cloneEl);
      },
    });
  };

  try {
    if (flow) {
      const pageH = pdf.internal.pageSize.getHeight();
      const M = WB_PDF_MARGIN;
      let offset = 0;
      while (offset < body.length) {
        wbPdfNormalizeFlowForTableChunk(pdf, flow);
        const budget = pageH - M.bottom - flow.y - WB_PDF_HEIGHT_FUZZ;
        if (budget < 28) {
          pdf.addPage();
          flow.y = M.top;
          continue;
        }

        const showSecTitle =
          Boolean(sectionTitle) && (!showSectionTitleOnFirstChunkOnly || offset === 0);
        const hiBound = Math.min(body.length - offset, maxRowsPerChunk);

        let lo = 1;
        let hi = hiBound;
        let best = 0;
        let bestCanvas: HTMLCanvasElement | null = null;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const probe = await renderChunkCanvas(offset, mid, showSecTitle);
          const h = wbPdfCanvasHeightPt(pdf, probe);
          if (h <= budget) {
            best = mid;
            bestCanvas = probe;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        if (best === 0) {
          const c = await renderChunkCanvas(offset, 1, showSecTitle);
          wbPdfAppendImageSlicesFlow(pdf, c, flow);
          offset += 1;
          continue;
        }

        const canvas = bestCanvas ?? (await renderChunkCanvas(offset, best, showSecTitle));
        wbPdfAppendImageSlicesFlow(pdf, canvas, flow);
        offset += best;
      }
    } else {
      for (let i = 0; i < body.length; i += rowsPerChunk) {
        const showSecTitle =
          Boolean(sectionTitle) && (!showSectionTitleOnFirstChunkOnly || i === 0);
        const n = Math.min(rowsPerChunk, body.length - i);
        const canvas = await renderChunkCanvas(i, n, showSecTitle);
        wbPdfAppendCanvasSlices(pdf, canvas);
      }
    }
  } finally {
    host.remove();
  }
}

type ClassReportPdfExportContext = {
  isZh: boolean;
  line1: string;
  classShort: string;
  classReportTemplate: ReportTemplate;
  academicYearRubric: Record<TargetLevel, string> | null;
  reportYearExamPreset: ReportExamPresetSlice | null;
  gradeConfig: GradeConfig;
  selectedClassRecord: { name: string; grade: number } | null;
  subjectShowsAssessmentScore: (
    subjectKey: string,
    tpl: ReportTemplate | null,
    gradeCatalogId: string | null,
  ) => boolean;
};

function classReportStudentDisplayName(student: Student): string {
  const zh = (student.nameZh ?? '').trim();
  const en = (student.nameEn ?? '').trim();
  const fb = (student.name ?? '').trim();
  return zh && en ? `${zh} ${en}` : zh || en || fb;
}

function safeClassReportPdfFileName(displayName: string, index: number, isZh: boolean): string {
  const order = String(index + 1).padStart(2, '0');
  const base = `${order}-${displayName}`.replace(/[/\\?%*:|"<>]/g, '-');
  return `${isZh ? '学业报告' : 'academic-report'}-${base}.pdf`;
}

function buildClassReportSnapshotDom(
  item: ClassReportSnapshotItem,
  ctx: ClassReportPdfExportContext,
): HTMLElement {
  const { isZh, classReportTemplate, academicYearRubric, reportYearExamPreset, gradeConfig, selectedClassRecord, subjectShowsAssessmentScore } =
    ctx;
  const subjectConfigMap = new Map((classReportTemplate.subjects ?? []).map((s) => [s.subjectKey, s] as const));

  const host = document.createElement('div');
  host.setAttribute('data-academic-report-pdf-scope', '');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:780px;background:#fff;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;';

  const modulesWrap = document.createElement('div');
  modulesWrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

  const hasDims = item.report.subjectReports.some((s) => (s.dimensions ?? []).length > 0);
  if (hasDims) {
    const m = document.createElement('div');
    m.setAttribute('data-student-report-pdf-module', '');
    m.style.cssText = 'border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:9px 10px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;font-weight:600;line-height:1.1;margin-bottom:6px;';
    title.textContent = isZh ? '学业报告等第说明' : 'Academic report grading rubric';
    m.appendChild(title);
    (['A', 'B', 'C', 'D'] as const).forEach((lv) => {
      const row = document.createElement('div');
      row.style.cssText = 'font-size:11px;line-height:1.25;display:flex;gap:6px;align-items:center;margin:2px 0;';
      row.textContent = `${lv} · ${(academicYearRubric ?? fullUnifiedLevelTextFromPreset(null))[lv]}`;
      m.appendChild(row);
    });
    modulesWrap.appendChild(m);
  }

  item.report.subjectReports.forEach((s) => {
    const subjectConfig = subjectConfigMap.get(s.subjectKey);
    const subjectTitle = subjectConfig ? workbenchSubjectModuleLabel(subjectConfig, isZh) : s.subjectName;
    const gradeCatalogId = selectedClassRecord
      ? getGradeCatalogIdForClass(gradeConfig, selectedClassRecord.grade, {
          className: selectedClassRecord.name,
        })
      : null;
    const finalGrade = resolveSubjectAssessmentGrade(s, classReportTemplate, reportYearExamPreset, gradeCatalogId);
    const mod = document.createElement('div');
    mod.setAttribute('data-student-report-pdf-module', '');
    const h = document.createElement('div');
    h.style.cssText = 'font-size:14px;font-weight:600;margin:0 0 6px;';
    h.textContent = subjectTitle || (isZh ? '未命名学科' : 'Untitled subject');
    mod.appendChild(h);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
    const tbody = document.createElement('tbody');
    s.dimensions.forEach((d) => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.style.cssText = 'border:1px solid #e2e8f0;padding:0;';
      const td1v = document.createElement('div');
      td1v.textContent = d.dimensionLabel;
      td1.appendChild(td1v);
      const td2 = document.createElement('td');
      td2.style.cssText = 'border:1px solid #e2e8f0;padding:0;width:120px;text-align:center;';
      const td2v = document.createElement('div');
      td2v.textContent = d.rating ?? '—';
      td2.appendChild(td2v);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });
    if (subjectConfig?.enableLearningQuality !== false) {
      const tr = document.createElement('tr');
      tr.style.background = '#f8fafc';
      const td1 = document.createElement('td');
      td1.style.cssText = 'border:1px solid #e2e8f0;padding:0;';
      const td1v = document.createElement('div');
      td1v.textContent = isZh ? '学习品质：兴趣、习惯与态度' : 'Learning quality: interest, habits, attitude';
      td1.appendChild(td1v);
      const td2 = document.createElement('td');
      td2.style.cssText = 'border:1px solid #e2e8f0;padding:0;width:120px;text-align:center;';
      const td2v = document.createElement('div');
      td2v.textContent = s.learningQualityGrade ?? '—';
      td2.appendChild(td2v);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    }
    if (
      subjectShowsAssessmentScore(
        s.subjectKey,
        classReportTemplate,
        selectedClassRecord
          ? getGradeCatalogIdForClass(gradeConfig, selectedClassRecord.grade, {
              className: selectedClassRecord.name,
            })
          : null,
      )
    ) {
      const tr = document.createElement('tr');
      tr.style.background = '#f1f5f9';
      const td1 = document.createElement('td');
      td1.style.cssText = 'border:1px solid #e2e8f0;padding:0;';
      const td1v = document.createElement('div');
      td1v.textContent = isZh ? '测评成绩' : 'Assessment';
      td1.appendChild(td1v);
      const td2 = document.createElement('td');
      td2.style.cssText = 'border:1px solid #e2e8f0;padding:0;width:120px;text-align:center;';
      const td2v = document.createElement('div');
      td2v.textContent = finalGrade;
      td2.appendChild(td2v);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    mod.appendChild(tableWrap);

    modulesWrap.appendChild(mod);
  });

  if (classReportTemplate.homeroomCommentMode !== 'disabled') {
    const homeroomMod = document.createElement('div');
    homeroomMod.setAttribute('data-student-report-pdf-module', '');
    const t = document.createElement('div');
    t.style.cssText = 'font-size:14px;font-weight:600;margin:0 0 6px;';
    t.textContent = isZh ? '班主任综合评价' : 'Homeroom comprehensive evaluation';
    const box = document.createElement('div');
    box.style.cssText = 'border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:7px 10px;';
    const body = document.createElement('div');
    body.setAttribute('data-student-report-pdf-body-text', '');
    body.style.cssText = 'white-space:pre-wrap;font-size:13px;';
    body.textContent = item.report.homeroomComment?.trim() || (isZh ? '暂无' : 'N/A');
    box.appendChild(body);
    homeroomMod.appendChild(t);
    homeroomMod.appendChild(box);
    modulesWrap.appendChild(homeroomMod);
  }
  host.appendChild(modulesWrap);
  return host;
}

async function appendClassReportStudentToPdf(
  pdf: import('jspdf').default,
  item: ClassReportSnapshotItem,
  ctx: ClassReportPdfExportContext,
  flow: { y: number },
): Promise<void> {
  const displayName = classReportStudentDisplayName(item.student);
  await wbPdfAppendStudentReportPdfHeaderAsImage(pdf, {
    line1: ctx.line1,
    classShort: ctx.classShort,
    displayName,
    flow,
  });
  const host = buildClassReportSnapshotDom(item, ctx);
  document.body.appendChild(host);
  try {
    const modules = Array.from(host.querySelectorAll<HTMLElement>('[data-student-report-pdf-module]'));
    for (const mod of modules) {
      await wbPdfAppendElementAsImageSlices(pdf, mod, new Set<string>(), flow);
    }
  } finally {
    host.remove();
  }
}

export default function StudentPortrait({
  onBackToHub,
  initialTab = 'overview',
  initialWorkbenchTemplateId,
  initialReportYearId,
  initialReportTerm,
  isAIOpen = false,
  onToggleAI,
}: {
  onBackToHub: () => void;
  initialTab?: PortraitTab;
  initialWorkbenchTemplateId?: string;
  initialReportYearId?: string;
  initialReportTerm?: Term;
  isAIOpen?: boolean;
  onToggleAI?: () => void;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { setContextFromApp } = useAIContext();
  const isZh = language === 'zh';
  const isStudentSelf = user?.role === 'student';
  const workbenchTeacherDisplayName = useMemo(() => {
    if (!user) return '';
    const zh = (user.nameZh ?? '').trim();
    const en = (user.nameEn ?? '').trim();
    const dn = (user.displayName ?? '').trim();
    const un = (user.username ?? '').trim();
    if (isZh) return zh || dn || un;
    return en || dn || un;
  }, [user, isZh]);
  const [tab, setTab] = useState<PortraitTab>(initialTab);
  const [portraitLensTab, setPortraitLensTab] = useState<PortraitLensTab>('overview');
  /** 「我的学生」画像区模块（与学籍生本人画像的 tab 状态分离） */
  const [myStudentsLensTab, setMyStudentsLensTab] = useState<PortraitLensTab>('overview');
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const { term: reportTerm, setTerm: setReportTerm, ready: reportTermReady } = useTermForYear(
    currentYearId ?? '',
    initialReportYearId,
    initialReportTerm,
  );
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [homeroomEditable, setHomeroomEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [reportList, setReportList] = useState<Array<{
    id: string;
    studentId: string;
    academicYearId: string;
    academicYearName: string;
    term: Term;
    templateId: string | null;
    templateTitle: string | null;
    homeroomComment: string | null;
    updatedAt: string | null;
    releasedAt: string | null;
  }>>([]);
  const [reportDetail, setReportDetail] = useState<StudentTermReport | null>(null);
  const [reportTemplate, setReportTemplate] = useState<ReportTemplate | null>(null);
  const [mySubjectAssignments, setMySubjectAssignments] = useState<Array<{ classId: string; subjectKey: string }>>([]);
  const [myHomeroomClassIds, setMyHomeroomClassIds] = useState<string[]>([]);
  const [myGradeHeadClassIds, setMyGradeHeadClassIds] = useState<string[]>([]);
  const [workbenchTemplates, setWorkbenchTemplates] = useState<ReportTemplate[]>([]);
  const [workbenchTemplateId, setWorkbenchTemplateId] = useState<string>('');
  const [workbenchProgress, setWorkbenchProgress] = useState<TeacherReportTemplateProgress | null>(null);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [workbenchError, setWorkbenchError] = useState<string | null>(null);
  /** 保存成功后的未完成项提示（不阻断保存） */
  const [workbenchSaveHint, setWorkbenchSaveHint] = useState<string | null>(null);
  const [workbenchClassId, setWorkbenchClassId] = useState<string>('');
  const [workbenchSubjectKey, setWorkbenchSubjectKey] = useState<string>('');
  const [workbenchTemplateDetail, setWorkbenchTemplateDetail] = useState<ReportTemplate | null>(null);
  const [adminViewTeacherId, setAdminViewTeacherId] = useState('');
  const [adminViewTeachers, setAdminViewTeachers] = useState<Array<{ id: string; name: string }>>([]);
  const [workbenchStudentDrafts, setWorkbenchStudentDrafts] = useState<WorkbenchStudentSubjectDraft[]>([]);
  const [workbenchClassOverallAnalysis, setWorkbenchClassOverallAnalysis] = useState('');
  const [workbenchStudentAnalysisRows, setWorkbenchStudentAnalysisRows] = useState<StudentAnalysisRowDraft[]>([]);
  const [workbenchSaving, setWorkbenchSaving] = useState(false);
  const [workbenchPdfExporting, setWorkbenchPdfExporting] = useState(false);
  const [studentReportPdfExporting, setStudentReportPdfExporting] = useState(false);
  const [classReportOptions, setClassReportOptions] = useState<ReleasedClassReportOption[]>([]);
  const [selectedClassReportKey, setSelectedClassReportKey] = useState('');
  const [classReportTemplate, setClassReportTemplate] = useState<ReportTemplate | null>(null);
  const [classReportSnapshotItems, setClassReportSnapshotItems] = useState<ClassReportSnapshotItem[]>([]);
  const [classReportLoading, setClassReportLoading] = useState(false);
  const [classReportExporting, setClassReportExporting] = useState<false | 'whole' | 'per-student'>(false);
  const [classReportError, setClassReportError] = useState<string | null>(null);
  const [classSubjectAnalyses, setClassSubjectAnalyses] = useState<
    Array<{
      subjectKey: string;
      subjectName: string;
      teacherName: string | null;
      classOverallAnalysis: string | null;
      updatedAt: string | null;
    }>
  >([]);
  const [classSubjectAnalysesLoading, setClassSubjectAnalysesLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewSnapshots, setOverviewSnapshots] = useState<OverviewReportSnapshot[]>([]);
  const [overviewSubjectInsights, setOverviewSubjectInsights] = useState<StudentSubjectInsightItem[]>([]);
  const workbenchPdfExportRef = useRef<HTMLDivElement>(null);
  const studentReportPdfExportRef = useRef<HTMLDivElement>(null);
  /** 教师手动切换学业报告模板后，不再自动改选（直至离开本 tab） */
  const workbenchManualPickRef = useRef(false);
  const pendingHubWorkbenchLinkRef = useRef<{
    templateId: string;
    yearId: string;
    term: Term;
  } | null>(
    initialWorkbenchTemplateId && initialReportYearId && initialReportTerm
      ? {
          templateId: initialWorkbenchTemplateId,
          yearId: initialReportYearId,
          term: initialReportTerm,
        }
      : null,
  );
  const [academicReportsVisitSeq, setAcademicReportsVisitSeq] = useState(0);
  const lastWorkbenchAutoPickSeqRef = useRef(0);
  type YearDimensionExamPreset = {
    academicYearId: string;
    examConfigs: Record<string, ReportExamConfigScope>;
    stageInclusion?: Record<string, string[]>;
    evaluationGradeInclusion?: Record<string, Record<string, string[]>>;
    examGradeInclusion?: Record<string, Record<string, string[]>>;
    subjectKeyToCourseId?: Record<string, string>;
    updatedAt: string | null;
  };
  /** 学年考试维度满分与百分比档（教师端 API，与管理员目标维度配置同源） */
  const [workbenchYearExamPreset, setWorkbenchYearExamPreset] = useState<YearDimensionExamPreset | null>(null);
  const [workbenchYearExamPresetLoaded, setWorkbenchYearExamPresetLoaded] = useState(false);
  /** 学生/班级学业报告展示：考试学科年级设置（决定测评成绩是否出现） */
  const [reportYearExamPreset, setReportYearExamPreset] = useState<YearDimensionExamPreset | null>(null);
  const [reportYearExamPresetLoaded, setReportYearExamPresetLoaded] = useState(false);
  /** 学年学科目标预设中的全学科共用 A–D 说明（用于学业报告开头展示一次） */
  const [academicYearRubric, setAcademicYearRubric] = useState<Record<TargetLevel, string> | null>(null);
  const [gradeConfig, setGradeConfig] = useState<GradeConfig>(() => normalizeGradeConfig(loadGradeConfigSync()));

  useEffect(() => {
    if (isStudentSelf) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadAcademicYears(),
      loadAllClasses(),
      loadStudents(),
      loadEnrollments(),
      loadGradeConfig(),
    ])
      .then(([y, cls, stu, enr, gc]) => {
        if (cancelled) return;
        setYears(y);
        setCurrentYearId(initialReportYearId || latestAcademicYear(y)?.id || null);
        setClasses(cls);
        setStudents(stu);
        setEnrollments(enr);
        setGradeConfig(normalizeGradeConfig(gc));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load student portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, initialReportYearId]);

  useEffect(() => {
    if (!isStudentSelf) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!USE_CLOUD_STORAGE) {
      setLoading(false);
      setError(isZh ? '学生登录需开启云端模式（VITE_USE_CLOUD_STORAGE）并联调服务器。' : 'Student login requires cloud mode and API.');
      return;
    }
    const sid = user?.studentId;
    if (!sid) {
      setLoading(false);
      setError(isZh ? '该账号未关联学籍，无法展示画像。请联系管理员。' : 'This account is not linked to a student record.');
      return;
    }
    api
      .getStudents()
      .then((stuList) => {
        if (cancelled) return;
        setYears([]);
        setCurrentYearId(null);
        setClasses([]);
        setStudents(stuList);
        setEnrollments([]);
        setSelectedStudentId(sid);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load student portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.studentId, user?.id, isZh]);

  useEffect(() => {
    if (tab === 'my-students') {
      setMyStudentsLensTab('overview');
    }
  }, [tab]);

  useEffect(() => {
    setPortraitLensTab('overview');
    setMyStudentsLensTab('overview');
  }, [selectedStudentId]);

  useEffect(() => {
    setMyStudentsLensTab('overview');
  }, [selectedClassId]);

  const yearClasses = useMemo(
    () => classes.filter((c) => !currentYearId || c.academicYearId === currentYearId),
    [classes, currentYearId]
  );

  /** 「我的学生」班级列表：固定为最新学年（与所选学业报告学年解耦） */
  const schoolCurrentYearIdForMyStudents = useMemo(
    () => latestAcademicYear(years)?.id ?? null,
    [years],
  );

  const classIdsSet = useMemo(() => new Set(yearClasses.map((c) => c.id)), [yearClasses]);

  const activeEnrollments = useMemo(
    () => enrollments.filter((e) => classIdsSet.has(e.classId)),
    [enrollments, classIdsSet]
  );

  const selectedClassRecord = useMemo(() => classes.find((c) => c.id === selectedClassId) ?? null, [classes, selectedClassId]);

  const classStudentIds = useMemo(() => {
    if (!selectedClassId) return new Set<string>();
    const ay = selectedClassRecord?.academicYearId;
    if (ay) {
      return new Set(
        enrollments.filter((e) => e.classId === selectedClassId && e.academicYearId === ay).map((e) => e.studentId),
      );
    }
    return new Set(activeEnrollments.filter((e) => e.classId === selectedClassId).map((e) => e.studentId));
  }, [selectedClassId, selectedClassRecord, enrollments, activeEnrollments]);

  const myStudents = useMemo(
    () => students.filter((s) => classStudentIds.has(s.id)),
    [students, classStudentIds]
  );

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s] as const)), [students]);
  const studentIdsByClass = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const enr of activeEnrollments) {
      const arr = map.get(enr.classId) ?? [];
      arr.push(enr.studentId);
      map.set(enr.classId, arr);
    }
    return map;
  }, [activeEnrollments]);
  const workbenchClassStudents = useMemo(() => {
    if (!workbenchClassId) return [] as Student[];
    const ids = studentIdsByClass.get(workbenchClassId) ?? [];
    return ids.map((id) => studentMap.get(id)).filter((s): s is Student => !!s);
  }, [workbenchClassId, studentIdsByClass, studentMap]);

  const isAdminRole = user?.role === 'admin' || user?.role === 'system-admin';
  const canUseTeacherWorkbench = !isStudentSelf && user?.role === 'teacher';
  const canAdminViewTeacherReports = !isStudentSelf && isAdminRole;
  const canAccessAcademicReportsTab = canUseTeacherWorkbench || canAdminViewTeacherReports;
  const workbenchAdminViewing = canAdminViewTeacherReports && tab === 'academic-reports';
  const canViewSchoolDashboard = !isStudentSelf && isAdminRole;
  const showHomeroomComment = reportTemplate?.homeroomCommentMode !== 'disabled';
  const templateSubjectMap = useMemo(
    () => new Map((reportTemplate?.subjects ?? []).map((s) => [s.subjectKey, s] as const)),
    [reportTemplate],
  );
  const reportStudentGradeCatalogId = useMemo(() => {
    if (selectedClassRecord) {
      return getGradeCatalogIdForClass(gradeConfig, selectedClassRecord.grade, {
        className: selectedClassRecord.name,
      });
    }
    if (!selectedStudentId || !currentYearId) return null;
    const enr = enrollments.find(
      (e) => e.studentId === selectedStudentId && (!e.academicYearId || e.academicYearId === currentYearId),
    );
    const cls = classes.find((c) => c.id === enr?.classId);
    if (!cls) return null;
    return getGradeCatalogIdForClass(gradeConfig, cls.grade, { className: cls.name });
  }, [selectedClassRecord, selectedStudentId, currentYearId, enrollments, classes, gradeConfig]);
  const reportViewPresetYearId =
    reportTemplate?.academicYearId ?? classReportTemplate?.academicYearId ?? currentYearId ?? null;
  /** 学生/班级报告：测评成绩列是否与教师工作台、后台考试年级配置一致 */
  const subjectShowsAssessmentScore = useCallback(
    (
      subjectKey: string,
      tpl: ReportTemplate | null,
      gradeCatalogId: string | null,
    ): boolean => {
      const cfg = tpl?.subjects?.find((s) => s.subjectKey === subjectKey);
      if (!cfg || !tpl) return false;
      if (USE_CLOUD_STORAGE && reportViewPresetYearId && !reportYearExamPresetLoaded) return false;
      const term = tpl.term ?? reportTerm;
      const segId =
        String(tpl.schoolSegmentId ?? '').trim()
        || (selectedClassRecord
          ? getSchoolSegmentIdForClass(gradeConfig, selectedClassRecord) ?? ''
          : getSchoolSegmentIdForStudentGradeLevel(gradeConfig, selectedStudent?.currentGrade ?? null) ?? '');
      return effectiveTemplateSubjectEnableScore(
        term,
        segId,
        subjectKey,
        gradeCatalogId,
        getSegmentGradeIds(gradeConfig, segId),
        cfg.enableScore !== false,
        reportYearExamPreset,
      );
    },
    [
      reportYearExamPreset,
      reportYearExamPresetLoaded,
      reportViewPresetYearId,
      reportTerm,
      gradeConfig,
      selectedClassRecord,
      selectedStudent?.currentGrade,
    ],
  );

  /** 「我的学生」班级下拉：仅当前学年；教师为岗位班级子集，管理员为当前学年全部班级 */
  const myStudentsClassOptions = useMemo(() => {
    const yid = schoolCurrentYearIdForMyStudents;
    if (!yid) return [] as ClassItem[];
    const inYear = classes
      .filter((c) => c.academicYearId === yid)
      .slice()
      .sort((a, b) => a.grade - b.grade || String(a.name).localeCompare(String(b.name)));
    if (user?.role === 'teacher') {
      const ids = new Set([
        ...mySubjectAssignments.map((a) => a.classId),
        ...myHomeroomClassIds,
        ...myGradeHeadClassIds,
      ]);
      return inYear.filter((c) => ids.has(c.id));
    }
    return inYear;
  }, [
    schoolCurrentYearIdForMyStudents,
    classes,
    user?.role,
    mySubjectAssignments,
    myHomeroomClassIds,
    myGradeHeadClassIds,
  ]);

  useEffect(() => {
    if (myStudentsClassOptions.length === 0) return;
    if (!myStudentsClassOptions.some((c) => c.id === selectedClassId)) {
      const first = myStudentsClassOptions[0];
      setSelectedClassId(first.id);
      setSelectedStudentId('');
      if (first.academicYearId) setCurrentYearId(first.academicYearId);
    }
  }, [myStudentsClassOptions, selectedClassId]);

  useEffect(() => {
    if (isStudentSelf) return;
    if (!canViewSchoolDashboard && tab === 'overview') {
      setTab('my-students');
    }
    if (!canAccessAcademicReportsTab && tab === 'academic-reports') {
      setTab('my-students');
    }
  }, [isStudentSelf, canViewSchoolDashboard, canAccessAcademicReportsTab, tab]);

  useEffect(() => {
    if (tab === 'academic-reports') {
      setAcademicReportsVisitSeq((s) => s + 1);
      const link = pendingHubWorkbenchLinkRef.current;
      if (link) {
        pendingHubWorkbenchLinkRef.current = null;
        workbenchManualPickRef.current = true;
        setCurrentYearId(link.yearId);
        setReportTerm(link.term);
        setWorkbenchTemplateId(link.templateId);
      } else {
        workbenchManualPickRef.current = false;
      }
    }
  }, [tab]);

  useEffect(() => {
    if (isStudentSelf) {
      setHomeroomEditable(false);
      return;
    }
    if (!USE_CLOUD_STORAGE) {
      setHomeroomEditable(user?.role === 'admin' || user?.role === 'system-admin');
      return;
    }
    if (!selectedClassId || !user?.id || user.role === 'admin' || user.role === 'system-admin') {
      setHomeroomEditable(user?.role === 'admin' || user?.role === 'system-admin');
      return;
    }
    if (user.role === 'teacher') {
      setHomeroomEditable(false);
    }
    api
      .getClassTeachers(selectedClassId)
      .then((teachers) => {
        const isHomeroom = teachers.some((t) => t.teacherId === user.id && t.role === 'homeroom');
        setHomeroomEditable(isHomeroom);
      })
      .catch(() => setHomeroomEditable(false));
  }, [selectedClassId, user?.id, user?.role, isStudentSelf]);

  const gradeHeadOfSelectedClass = useMemo(() => {
    if (!selectedClassId) return false;
    return myGradeHeadClassIds.includes(selectedClassId);
  }, [selectedClassId, myGradeHeadClassIds]);

  const canViewMyStudentsClassAggregate = useMemo(() => {
    if (!selectedClassId) return false;
    if (isAdminRole) return true;
    if (user?.role === 'teacher') return homeroomEditable || gradeHeadOfSelectedClass;
    return false;
  }, [selectedClassId, isAdminRole, user?.role, homeroomEditable, gradeHeadOfSelectedClass]);

  const canExportWholeClassPdf = canViewMyStudentsClassAggregate;

  /** 学生个人概览：本班班主任、年级组长（所管年级）与任课教师均可查看 */
  const canViewStudentOverview = useMemo(() => {
    if (!selectedStudentId) return false;
    if (isStudentSelf) return true;
    if (isAdminRole) return true;
    if (user?.role === 'teacher' && selectedClassId) {
      if (homeroomEditable || gradeHeadOfSelectedClass) return true;
      return mySubjectAssignments.some((a) => a.classId === selectedClassId);
    }
    return false;
  }, [
    selectedStudentId,
    isStudentSelf,
    isAdminRole,
    user?.role,
    selectedClassId,
    homeroomEditable,
    gradeHeadOfSelectedClass,
    mySubjectAssignments,
  ]);

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || user?.role !== 'teacher') {
      setMySubjectAssignments([]);
      return;
    }
    const yid = schoolCurrentYearIdForMyStudents;
    if (!yid) {
      setMySubjectAssignments([]);
      return;
    }
    let cancelled = false;
    api
      .getMySubjectAssignments(yid)
      .then((rows) => {
        if (!cancelled) setMySubjectAssignments(rows);
      })
      .catch(() => {
        if (!cancelled) setMySubjectAssignments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.role, schoolCurrentYearIdForMyStudents]);

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || user?.role !== 'teacher') {
      setMyHomeroomClassIds([]);
      return;
    }
    const yid = schoolCurrentYearIdForMyStudents;
    if (!yid) {
      setMyHomeroomClassIds([]);
      return;
    }
    let cancelled = false;
    api
      .getMyHomeroomClassIds(yid)
      .then((ids) => {
        if (!cancelled) setMyHomeroomClassIds(ids);
      })
      .catch(() => {
        if (!cancelled) setMyHomeroomClassIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.role, schoolCurrentYearIdForMyStudents]);

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || user?.role !== 'teacher') {
      setMyGradeHeadClassIds([]);
      return;
    }
    const yid = schoolCurrentYearIdForMyStudents;
    if (!yid) {
      setMyGradeHeadClassIds([]);
      return;
    }
    let cancelled = false;
    api
      .getMyGradeHeadClassIds(yid)
      .then((ids) => {
        if (!cancelled) setMyGradeHeadClassIds(ids);
      })
      .catch(() => {
        if (!cancelled) setMyGradeHeadClassIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.role, schoolCurrentYearIdForMyStudents]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !currentYearId) {
      setAcademicYearRubric(null);
      return;
    }
    let cancelled = false;
    api
      .getAdminReportYearDimensionPreset(currentYearId)
      .then((p) => {
        if (cancelled) return;
        setAcademicYearRubric(fullUnifiedLevelTextFromPreset(p?.unifiedLevelDescriptions));
      })
      .catch(() => {
        if (cancelled) return;
        setAcademicYearRubric(fullUnifiedLevelTextFromPreset(null));
      });
    return () => {
      cancelled = true;
    };
  }, [currentYearId]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (!selectedStudentId) {
      setReportList([]);
      setReportDetail(null);
      setReportTemplate(null);
      setReportTemplates([]);
      setSelectedTemplateId('');
      return;
    }
    const studentId = selectedStudentId;
    setReportList([]);
    setReportDetail(null);
    setReportTemplate(null);
    setReportTemplates([]);
    let cancelled = false;
    setReportLoading(true);
    api
      .getStudentTermReports(studentId)
      .then((list) => {
        if (cancelled || selectedStudentId !== studentId) return;
        const visible = user?.role === 'teacher' ? list.filter((r) => !!r.releasedAt) : list;
        setReportList(visible);
        if (!currentYearId && visible.length > 0 && isStudentSelf) {
          setCurrentYearId(visible[0].academicYearId);
        }
        if (visible.length === 0) {
          setSelectedTemplateId('');
          setReportDetail(null);
          setReportTemplate(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled || selectedStudentId !== studentId) return;
        setError((e as Error)?.message || 'Failed to load term reports');
      })
      .finally(() => {
        if (!cancelled && selectedStudentId === studentId) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, currentYearId, user?.role, isStudentSelf]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !selectedStudentId) {
      setOverviewSnapshots([]);
      setOverviewSubjectInsights([]);
      setOverviewLoading(false);
      return;
    }
    const released = reportList.filter((r) => !!r.releasedAt && !!r.templateId);
    if (released.length === 0) {
      setOverviewSnapshots([]);
      setOverviewSubjectInsights([]);
      setOverviewLoading(false);
      return;
    }
    const studentId = selectedStudentId;
    let cancelled = false;
    setOverviewLoading(true);
    const sorted = [...released].sort((a, b) =>
      buildOverviewReportSortKey({
        academicYearId: a.academicYearId,
        term: a.term,
        releasedAt: a.releasedAt,
      }).localeCompare(
        buildOverviewReportSortKey({
          academicYearId: b.academicYearId,
          term: b.term,
          releasedAt: b.releasedAt,
        }),
      ),
    );
    const stu = students.find((s) => s.id === studentId);
    const yearIds = Array.from(new Set(sorted.map((r) => r.academicYearId)));
    Promise.all([
      Promise.all(
        sorted.map((r) =>
          api.getStudentTermReportBundle(studentId, r.academicYearId, r.term, r.templateId as string, {
            portraitScope: 'overview',
          }),
        ),
      ),
      Promise.all(yearIds.map((yid) => api.getTeacherReportYearDimensionExamPreset(yid).catch(() => null))),
    ])
      .then(async ([bundles, presets]) => {
        if (cancelled || selectedStudentId !== studentId) return;
        const presetByYear = new Map(yearIds.map((yid, idx) => [yid, presets[idx]] as const));
        const snapshots: OverviewReportSnapshot[] = sorted.map((r, idx) => {
          const bundle = bundles[idx];
          const enrForYear = enrollments.find(
            (e) => e.studentId === studentId && e.academicYearId === r.academicYearId,
          );
          const clsForYear = enrForYear ? classes.find((c) => c.id === enrForYear.classId) : undefined;
          const snapGradeCatalogId = gradeCatalogIdForOverviewStudent(
            gradeConfig,
            clsForYear?.grade ?? stu?.currentGrade ?? null,
            clsForYear?.name,
          );
          return {
            meta: {
              academicYearId: r.academicYearId,
              academicYearName: r.academicYearName,
              term: r.term,
              templateId: r.templateId as string,
              templateTitle: r.templateTitle,
              releasedAt: r.releasedAt,
              label: `${r.academicYearName} · ${reportTermLabel(r.term, isZh)}${r.templateTitle ? ` · ${r.templateTitle}` : ''}`,
              sortKey: buildOverviewReportSortKey({
                academicYearId: r.academicYearId,
                term: r.term,
                releasedAt: r.releasedAt,
              }),
            },
            report: mergeStudentTermReportWithTemplate(
              bundle.report,
              bundle.template,
              snapGradeCatalogId,
              { padMissingSubjects: false, blankUnsetRatings: true },
            ),
            template: bundle.template,
            gradeCatalogId: snapGradeCatalogId,
            examPreset: presetByYear.get(r.academicYearId) ?? null,
          };
        });
        setOverviewSnapshots(snapshots);
        const latest = sorted[sorted.length - 1];
        if (canViewStudentOverview && !isStudentSelf && latest.templateId) {
          const insights = await api.getStudentSubjectInsights(latest.templateId, studentId);
          if (!cancelled && selectedStudentId === studentId) setOverviewSubjectInsights(insights);
        } else if (!cancelled && selectedStudentId === studentId) {
          setOverviewSubjectInsights([]);
        }
      })
      .catch(() => {
        if (!cancelled && selectedStudentId === studentId) {
          setOverviewSnapshots([]);
          setOverviewSubjectInsights([]);
        }
      })
      .finally(() => {
        if (!cancelled && selectedStudentId === studentId) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedStudentId,
    reportList,
    students,
    enrollments,
    classes,
    gradeConfig,
    isZh,
    canViewStudentOverview,
    isStudentSelf,
  ]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (!selectedStudentId || !currentYearId) {
      setReportTemplates([]);
      setSelectedTemplateId('');
      setReportTemplate(null);
      setReportDetail(null);
      return;
    }
    const studentId = selectedStudentId;
    const releasedRows = reportList.filter((r) => !!r.releasedAt && !!r.templateId);
    if (releasedRows.length === 0) {
      setReportTemplates([]);
      setReportDetail(null);
      setReportTemplate(null);
      return;
    }
    const pickMatchesSelection = releasedRows.some(
      (r) =>
        r.academicYearId === currentYearId &&
        r.term === reportTerm &&
        r.templateId === selectedTemplateId,
    );
    if (!selectedTemplateId || !pickMatchesSelection) {
      setReportDetail(null);
      setReportTemplate(null);
      return;
    }
    const effectiveTemplateId = selectedTemplateId;
    let cancelled = false;
    setReportLoading(true);
    const schoolSeg = getSchoolSegmentIdForStudentGradeLevel(
      gradeConfig,
      students.find((x) => x.id === studentId)?.currentGrade ?? null,
    );
    api
      .getReportTemplatesForTerm(currentYearId, reportTerm, schoolSeg ? { schoolSegmentId: schoolSeg } : undefined)
      .then(async (templates) => {
        if (cancelled || selectedStudentId !== studentId) return;
        const releasedOnly = templates.filter((t) => !!t.releasedAt);
        const sortedReleased = [...releasedOnly].sort((a, b) =>
          String(b.releasedAt ?? '').localeCompare(String(a.releasedAt ?? '')),
        );
        setReportTemplates(sortedReleased);
        if (!sortedReleased.some((t) => t.id === effectiveTemplateId)) {
          setReportTemplate(null);
          setReportDetail(null);
          return;
        }
        const bundle = await api.getStudentTermReportBundle(
          studentId,
          currentYearId,
          reportTerm,
          effectiveTemplateId,
        );
        if (cancelled || selectedStudentId !== studentId) return;
        const stu = students.find((x) => x.id === studentId);
        const enrCls = classes.find(
          (c) =>
            c.id
            === enrollments.find(
              (e) => e.studentId === studentId && (!e.academicYearId || e.academicYearId === currentYearId),
            )?.classId,
        );
        const gradeCatalogId = gradeCatalogIdForStudentGrade(gradeConfig, stu?.currentGrade ?? null, enrCls?.name);
        setReportTemplate(bundle.template);
        const merged = mergeStudentTermReportWithTemplate(bundle.report, bundle.template, gradeCatalogId, {
          padMissingSubjects: false,
          blankUnsetRatings: true,
        });
        setReportDetail(merged);
      })
      .catch((e: unknown) => {
        if (cancelled || selectedStudentId !== studentId) return;
        setError((e as Error)?.message || 'Failed to load report detail');
        setReportDetail(null);
        setReportTemplate(null);
      })
      .finally(() => {
        if (!cancelled && selectedStudentId === studentId) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, currentYearId, reportTerm, selectedTemplateId, reportList, students, gradeConfig]);

  useEffect(() => {
    if (tab !== 'academic-reports') return;

    if (!canAccessAcademicReportsTab || !USE_CLOUD_STORAGE || !currentYearId || !reportTermReady) {
      setWorkbenchTemplates([]);
      setWorkbenchTemplateId('');
      setWorkbenchProgress(null);
      setWorkbenchError(null);
      setWorkbenchSaveHint(null);
      setAdminViewTeacherId('');
      setAdminViewTeachers([]);
      return;
    }

    const isTeacherSelfServe = user?.role === 'teacher' && !workbenchAdminViewing;
    const shouldAutoPickOnEnter =
      !workbenchManualPickRef.current &&
      lastWorkbenchAutoPickSeqRef.current !== academicReportsVisitSeq;

    let cancelled = false;
    setWorkbenchLoading(true);
    setWorkbenchError(null);
    setWorkbenchSaveHint(null);

    const filterEligible = (list: ReportTemplate[]) =>
      list.filter((tpl) => (tpl.status === 'published' || tpl.status === 'closed') && !!tpl.id);

    const pickNewestPublishedTemplate = (templates: ReportTemplate[]) => {
      const eligible = filterEligible(templates);
      if (eligible.length === 0) return null;
      const picked = pickPreferredPublishedTask(
        eligible.map((tpl) => ({
          id: tpl.id as string,
          publishedAt: tpl.publishedAt,
          updatedAt: null,
          isComplete: false,
          template: tpl,
        })),
      );
      return picked?.template ?? null;
    };

    /** 教师：仅在本人有岗位班级的报告里，按最近发布 + 未完成优先自动选中 */
    const pickTeacherTemplateWithProgress = async (templates: ReportTemplate[]) => {
      const eligible = filterEligible(templates);
      if (eligible.length === 0) return null;
      const rows = await Promise.all(
        eligible.map(async (tpl) => {
          const progress = await api.getMyReportTemplateProgress(tpl.id as string);
          return {
            id: tpl.id as string,
            publishedAt: tpl.publishedAt,
            updatedAt: null,
            isComplete: progress.pendingStudents <= 0,
            template: tpl,
            hasAssignments: progress.classes.length > 0,
          };
        }),
      );
      const withWork = rows.filter((r) => r.hasAssignments);
      if (withWork.length === 0) return null;
      const picked = pickPreferredPublishedTask(withWork);
      return picked?.template ?? null;
    };

    (async () => {
      try {
        if (shouldAutoPickOnEnter) {
          lastWorkbenchAutoPickSeqRef.current = academicReportsVisitSeq;
          const list = await api.getReportTemplatesForTerm(currentYearId, reportTerm);
          if (cancelled) return;

          const picked = isTeacherSelfServe
            ? await pickTeacherTemplateWithProgress(list)
            : pickNewestPublishedTemplate(list);
          if (cancelled) return;

          if (picked?.id) {
            setWorkbenchTemplates(filterEligible(list));
            setWorkbenchTemplateId(picked.id);
            return;
          }
        }

        const list = await api.getReportTemplatesForTerm(currentYearId, reportTerm);
        if (cancelled) return;
        const editableOrReadonly = filterEligible(list);
        setWorkbenchTemplates(editableOrReadonly);

        if (workbenchManualPickRef.current) {
          setWorkbenchTemplateId((prev) =>
            prev && editableOrReadonly.some((tpl) => tpl.id === prev) ? prev : (editableOrReadonly[0]?.id ?? ''),
          );
          return;
        }

        if (isTeacherSelfServe && editableOrReadonly.length > 0) {
          const picked = await pickTeacherTemplateWithProgress(editableOrReadonly);
          if (cancelled) return;
          setWorkbenchTemplateId(picked?.id ?? editableOrReadonly[0]?.id ?? '');
          return;
        }

        if (workbenchAdminViewing && editableOrReadonly.length > 0) {
          const picked = pickNewestPublishedTemplate(editableOrReadonly);
          if (cancelled) return;
          setWorkbenchTemplateId(picked?.id ?? editableOrReadonly[0]?.id ?? '');
          return;
        }

        setWorkbenchTemplateId((prev) =>
          prev && editableOrReadonly.some((tpl) => tpl.id === prev) ? prev : (editableOrReadonly[0]?.id ?? ''),
        );
      } catch (e: unknown) {
        if (cancelled) return;
        setWorkbenchTemplates([]);
        setWorkbenchTemplateId('');
        setWorkbenchProgress(null);
        setWorkbenchError((e as Error)?.message || 'Failed to load report tasks');
      } finally {
        if (!cancelled) setWorkbenchLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    canAccessAcademicReportsTab,
    currentYearId,
    reportTerm,
    reportTermReady,
    tab,
    user?.role,
    workbenchAdminViewing,
    academicReportsVisitSeq,
  ]);

  useEffect(() => {
    if (!canAdminViewTeacherReports || !USE_CLOUD_STORAGE || !workbenchTemplateId) {
      setAdminViewTeachers([]);
      return;
    }
    let cancelled = false;
    api
      .getReportTemplateAssignedTeachers(workbenchTemplateId)
      .then((list) => {
        if (cancelled) return;
        setAdminViewTeachers(list);
        setAdminViewTeacherId((prev) =>
          prev && list.some((t) => t.id === prev) ? prev : (list[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAdminViewTeachers([]);
          setAdminViewTeacherId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canAdminViewTeacherReports, workbenchTemplateId]);

  useEffect(() => {
    if (!canAccessAcademicReportsTab || !USE_CLOUD_STORAGE || !workbenchTemplateId) {
      setWorkbenchProgress(null);
      return;
    }
    if (workbenchAdminViewing && !adminViewTeacherId.trim()) {
      setWorkbenchProgress(null);
      return;
    }
    let cancelled = false;
    setWorkbenchLoading(true);
    setWorkbenchError(null);
    setWorkbenchSaveHint(null);
    api
      .getMyReportTemplateProgress(
        workbenchTemplateId,
        workbenchAdminViewing ? { teacherId: adminViewTeacherId.trim() } : undefined,
      )
      .then((progress) => {
        if (!cancelled) setWorkbenchProgress(progress);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setWorkbenchProgress(null);
        setWorkbenchError((e as Error)?.message || 'Failed to load report progress');
      })
      .finally(() => {
        if (!cancelled) setWorkbenchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessAcademicReportsTab, workbenchAdminViewing, workbenchTemplateId, adminViewTeacherId]);

  useEffect(() => {
    if (!canAccessAcademicReportsTab || !USE_CLOUD_STORAGE || !workbenchTemplateId) {
      setWorkbenchTemplateDetail(null);
      return;
    }
    let cancelled = false;
    api
      .getReportTemplateById(workbenchTemplateId)
      .then((tpl) => {
        if (!cancelled) setWorkbenchTemplateDetail(tpl);
      })
      .catch(() => {
        if (!cancelled) setWorkbenchTemplateDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessAcademicReportsTab, workbenchTemplateId]);

  useEffect(() => {
    if (!canAccessAcademicReportsTab || !USE_CLOUD_STORAGE || !workbenchTemplateDetail?.academicYearId) {
      setWorkbenchYearExamPreset(null);
      setWorkbenchYearExamPresetLoaded(false);
      return;
    }
    let cancelled = false;
    setWorkbenchYearExamPresetLoaded(false);
    api
      .getTeacherReportYearDimensionExamPreset(workbenchTemplateDetail.academicYearId)
      .then((p) => {
        if (!cancelled) setWorkbenchYearExamPreset(p);
      })
      .catch(() => {
        if (!cancelled) setWorkbenchYearExamPreset(null);
      })
      .finally(() => {
        if (!cancelled) setWorkbenchYearExamPresetLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessAcademicReportsTab, workbenchTemplateDetail?.academicYearId]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !reportViewPresetYearId) {
      setReportYearExamPreset(null);
      setReportYearExamPresetLoaded(!reportViewPresetYearId);
      return;
    }
    let cancelled = false;
    setReportYearExamPresetLoaded(false);
    api
      .getTeacherReportYearDimensionExamPreset(reportViewPresetYearId)
      .then((p) => {
        if (!cancelled) setReportYearExamPreset(p);
      })
      .catch(() => {
        if (!cancelled) setReportYearExamPreset(null);
      })
      .finally(() => {
        if (!cancelled) setReportYearExamPresetLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reportViewPresetYearId]);

  useEffect(() => {
    if (!canAccessAcademicReportsTab || !workbenchProgress) {
      setWorkbenchClassId('');
      return;
    }
    const templateSubjects = workbenchTemplateDetail?.subjects;
    const actionable = filterWorkbenchActionableClasses(workbenchProgress.classes, templateSubjects);
    setWorkbenchClassId((prev) => {
      if (prev && actionable.some((c) => c.classId === prev)) return prev;
      return pickDefaultWorkbenchClassId(actionable, templateSubjects);
    });
  }, [canAccessAcademicReportsTab, workbenchProgress, workbenchTemplateDetail]);

  useEffect(() => {
    if (!workbenchTemplateDetail || !workbenchClassId) {
      setWorkbenchSubjectKey('');
      return;
    }
    const cls = workbenchProgress?.classes.find((c) => c.classId === workbenchClassId);
    const candidates = workbenchTemplateDetail.subjects.filter((s) => cls?.requiredSubjectKeys.includes(s.subjectKey));
    setWorkbenchSubjectKey((prev) => {
      const homeroomOk = Boolean(cls?.homeroomEvaluationAvailable ?? cls?.requiresHomeroomComment);
      if (prev === WORKBENCH_HOMEROOM_SENTINEL && homeroomOk) return prev;
      if (prev && candidates.some((s) => s.subjectKey === prev)) return prev;
      if (candidates[0]?.subjectKey) return candidates[0].subjectKey;
      if (homeroomOk) return WORKBENCH_HOMEROOM_SENTINEL;
      return '';
    });
  }, [workbenchTemplateDetail, workbenchClassId, workbenchProgress]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !workbenchTemplateDetail || !workbenchClassId || !workbenchSubjectKey) {
      setWorkbenchStudentDrafts([]);
      return;
    }
    if (isWorkbenchHomeroomMode(workbenchSubjectKey)) {
      let cancelled = false;
      setWorkbenchLoading(true);
      const firstTplSubject = workbenchTemplateDetail.subjects[0];
      Promise.all(
        workbenchClassStudents.map(async (stu) => {
          const detail = await api.getStudentTermReportDetail(
            stu.id,
            workbenchTemplateDetail.academicYearId,
            workbenchTemplateDetail.term,
            workbenchTemplateDetail.id ?? '',
          );
          const wbCls = workbenchProgress?.classes.find((c) => c.classId === workbenchClassId);
          const merged = mergeStudentTermReportWithTemplate(
            detail,
            workbenchTemplateDetail,
            gradeCatalogIdForStudentGrade(gradeConfig, stu.currentGrade ?? null, wbCls?.className),
            { padMissingSubjects: true },
          );
          const stub: SubjectDraft = {
            id: `hr-${stu.id}`,
            subjectKey: WORKBENCH_HOMEROOM_SENTINEL,
            subjectName: '—',
            midtermScore: null,
            midtermGrade: null,
            finalScore: null,
            finalGrade: null,
            learningQualityGrade: null,
            examDimensionScores: null,
            teacherComment: null,
            teacherId: null,
            dimensions: (firstTplSubject?.dimensions ?? []).map((d) => ({
              id: d.id,
              dimensionKey: d.dimensionKey,
              dimensionLabel: d.dimensionLabel,
              rating: 'A' as TargetLevel,
              levelDescriptions: { ...d.levelDescriptions },
            })),
          };
          return {
            studentId: stu.id,
            studentName: stu.nameZh || stu.name,
            subject: stub,
            homeroomComment: merged.homeroomComment ?? '',
          } as WorkbenchStudentSubjectDraft;
        }),
      )
        .then((rows) => {
          if (!cancelled) setWorkbenchStudentDrafts(rows);
        })
        .catch((e: unknown) => {
          if (!cancelled) setWorkbenchStudentDrafts([]);
          setWorkbenchError((e as Error)?.message || 'Failed to load homeroom drafts');
        })
        .finally(() => {
          if (!cancelled) setWorkbenchLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    setWorkbenchLoading(true);
    const targetSubject = workbenchTemplateDetail.subjects.find((s) => s.subjectKey === workbenchSubjectKey);
    if (!targetSubject) {
      setWorkbenchStudentDrafts([]);
      setWorkbenchLoading(false);
      return;
    }
    Promise.all(
      workbenchClassStudents.map(async (stu) => {
        const detail = await api.getStudentTermReportDetail(stu.id, workbenchTemplateDetail.academicYearId, workbenchTemplateDetail.term, workbenchTemplateDetail.id ?? '');
        const wbCls = workbenchProgress?.classes.find((c) => c.classId === workbenchClassId);
        const merged = mergeStudentTermReportWithTemplate(
          detail,
          workbenchTemplateDetail,
          gradeCatalogIdForStudentGrade(gradeConfig, stu.currentGrade ?? null, wbCls?.className),
          { padMissingSubjects: true },
        );
        const existing = merged.subjectReports.find((s) => s.subjectKey === workbenchSubjectKey);
        const subject: SubjectDraft = existing
          ? {
              id: existing.id,
              subjectKey: existing.subjectKey,
              subjectName: existing.subjectName,
              midtermScore: existing.midtermScore,
              midtermGrade: existing.midtermGrade,
              finalScore: existing.finalScore,
              finalGrade: existing.finalGrade,
              learningQualityGrade: (existing.learningQualityGrade ?? 'A') as TargetLevel,
              examDimensionScores: existing.examDimensionScores ?? null,
              teacherComment: existing.teacherComment,
              teacherId: existing.teacherId,
              dimensions: existing.dimensions.map((d) => ({
                id: d.id,
                dimensionKey: d.dimensionKey,
                dimensionLabel: d.dimensionLabel,
                rating: d.rating ?? 'A',
                levelDescriptions: { ...d.levelDescriptions },
              })),
            }
          : {
              id: `tmp-${stu.id}-${workbenchSubjectKey}`,
              subjectKey: targetSubject.subjectKey,
              subjectName: targetSubject.subjectName,
              midtermScore: null,
              midtermGrade: null,
              finalScore: null,
              finalGrade: null,
              learningQualityGrade: 'A',
              examDimensionScores: null,
              teacherComment: null,
              teacherId: null,
              dimensions: targetSubject.dimensions.map((d) => ({
                id: d.id,
                dimensionKey: d.dimensionKey,
                dimensionLabel: d.dimensionLabel,
                rating: 'A',
                levelDescriptions: d.levelDescriptions,
              })),
            };
        return {
          studentId: stu.id,
          studentName: stu.nameZh || stu.name,
          subject,
          homeroomComment: merged.homeroomComment ?? '',
        } as WorkbenchStudentSubjectDraft;
      })
    )
      .then((rows) => {
        if (!cancelled) setWorkbenchStudentDrafts(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setWorkbenchError((e as Error)?.message || 'Failed to load class report drafts');
      })
      .finally(() => {
        if (!cancelled) setWorkbenchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workbenchTemplateDetail, workbenchClassId, workbenchSubjectKey, workbenchClassStudents]);

  useEffect(() => {
    const roster = workbenchStudentDrafts.map((r) => ({ studentId: r.studentId }));
    if (roster.length > 0) {
      setWorkbenchStudentAnalysisRows((prev) => mergeStudentAnalysisRowsWithRoster(roster, prev));
    } else {
      setWorkbenchStudentAnalysisRows([]);
    }
  }, [workbenchStudentDrafts]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !workbenchTemplateId || !workbenchClassId || !workbenchSubjectKey) {
      setWorkbenchClassOverallAnalysis('');
      return;
    }
    if (isWorkbenchHomeroomMode(workbenchSubjectKey)) {
      setWorkbenchClassOverallAnalysis('');
      return;
    }
    let cancelled = false;
    api
      .getReportClassSubjectInsights(workbenchTemplateId, workbenchClassId, workbenchSubjectKey)
      .then((ins) => {
        if (cancelled) return;
        setWorkbenchClassOverallAnalysis(ins.classOverallAnalysis ?? '');
        const roster = workbenchStudentDrafts.map((r) => ({ studentId: r.studentId }));
        const saved = ins.studentAnalysisRows.map((r) => ({
          studentId: r.studentId,
          learningAnalysis: r.learningAnalysis,
          supportPlan: r.supportPlan,
        }));
        setWorkbenchStudentAnalysisRows(
          roster.length > 0 ? mergeStudentAnalysisRowsWithRoster(roster, saved) : saved,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setWorkbenchClassOverallAnalysis('');
      });
    return () => {
      cancelled = true;
    };
  }, [workbenchTemplateId, workbenchClassId, workbenchSubjectKey, workbenchStudentDrafts]);

  const learningStats = useMemo(() => {
    const inYearStudentIds = new Set(activeEnrollments.map((e) => e.studentId));
    const inYearStudents = students.filter((s) => inYearStudentIds.has(s.id));
    const active = inYearStudents.filter((s) => (s.status ?? 'active') === 'active').length;
    const classById = new Map(classes.map((c) => [c.id, c]));
    const enrollmentClassByStudent = new Map<string, string>();
    for (const e of activeEnrollments) {
      if (!enrollmentClassByStudent.has(e.studentId)) enrollmentClassByStudent.set(e.studentId, e.classId);
    }
    const segmentRows = countStudentsBySchoolSegment(
      gradeConfig,
      inYearStudents,
      (studentId) => {
        const classId = enrollmentClassByStudent.get(studentId);
        const cls = classId ? classById.get(classId) : undefined;
        return cls ? { grade: cls.grade, name: cls.name } : null;
      },
      isZh,
    );
    const byGrade = new Map<string, number>();
    for (const s of inYearStudents) {
      const g = s.currentGrade != null ? `G${s.currentGrade}` : (isZh ? '未设置' : 'Not set');
      byGrade.set(g, (byGrade.get(g) ?? 0) + 1);
    }
    return {
      total: inYearStudents.length,
      active,
      activeRate: inYearStudents.length ? Math.round((active / inYearStudents.length) * 100) : 0,
      byDivision: segmentRows.map((r) => [r.label, r.count] as [string, number]),
      byGrade: Array.from(byGrade.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [activeEnrollments, students, classes, gradeConfig, isZh]);

  const studentCenterPermissionMatrix = useMemo(() => {
    const L = (zh: string, en: string) => (isZh ? zh : en);
    return [
      {
        role: L('班主任', 'Homeroom teacher'),
        classOverview: L('本班整体概览', 'Own class overview'),
        studentOverview: L('本班学生，全科数据', 'Class students, all subjects'),
        reportEntry: L('班主任评语；兼任学科可填', 'Homeroom comments; own subjects if teaching'),
        studentReport: L('已推送报告全科', 'All subjects (released)'),
      },
      {
        role: L('任课教师', 'Subject teacher'),
        classOverview: L('—', '—'),
        studentOverview: L('任课班学生，全科数据', 'Taught classes, all subjects'),
        reportEntry: L('仅任教学科', 'Assigned subjects only'),
        studentReport: L('仅任教学科', 'Assigned subjects only'),
      },
      {
        role: L('年级组长', 'Grade head'),
        classOverview: L('所管年级全部班级', 'All classes in managed grades'),
        studentOverview: L('所管年级学生，全科数据', 'Managed grades, all subjects'),
        reportEntry: L('仅所带班级与任教学科', 'Own classes & assigned subjects only'),
        studentReport: L('所管年级已推送报告全科', 'All subjects (released, managed grades)'),
      },
      {
        role: L('管理员', 'Admin'),
        classOverview: L('全部', 'All'),
        studentOverview: L('全部', 'All'),
        reportEntry: L('全部（含只读查看）', 'All (incl. read-only)'),
        studentReport: L('全部', 'All'),
      },
    ];
  }, [isZh]);

  const exportStudentReportPdf = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!selectedStudent || !selectedTemplateId || !studentReportPdfExportRef.current) return;
    setStudentReportPdfExporting(true);
    setError(null);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const flow = { y: WB_PDF_MARGIN.top };
      const zh = (selectedStudent.nameZh ?? '').trim();
      const en = (selectedStudent.nameEn ?? '').trim();
      const fb = (selectedStudent.name ?? '').trim();
      const displayName = zh && en ? `${zh} ${en}` : zh || en || fb;
      const templateTitle = reportTemplate?.title?.trim() || (isZh ? '学业报告' : 'Academic report');
      const yearName = years.find((y) => y.id === (currentYearId ?? ''))?.name ?? currentYearId ?? '';
      const termLabel =
        reportTerm === 'Semester 1' ? (isZh ? '上学期' : 'Semester 1') : isZh ? '下学期' : 'Semester 2';
      const line1 = isZh ? `${yearName}-${termLabel}-${templateTitle}` : `${yearName} - ${reportTerm} - ${templateTitle}`;
      const cls = classes.find((c) => c.id === selectedClassId);
      const classShort = cls ? workbenchClassShortLabel({ className: cls.name, grade: cls.grade }) : '—';
      await wbPdfAppendStudentReportPdfHeaderAsImage(pdf, {
        line1,
        classShort,
        displayName,
        flow,
      });
      const modules = Array.from(
        studentReportPdfExportRef.current.querySelectorAll<HTMLElement>('[data-student-report-pdf-module]'),
      );
      if (modules.length === 0) {
        await wbPdfAppendElementAsImageSlices(pdf, studentReportPdfExportRef.current, new Set<string>(), flow);
      } else {
        for (const mod of modules) {
          await wbPdfAppendElementAsImageSlices(pdf, mod, new Set<string>(), flow);
        }
      }
      const fileName = `${isZh ? '学业报告' : 'academic-report'}-${displayName}-${new Date().toISOString().slice(0, 10)}.pdf`
        .replace(/[/\\?%*:|"<>]/g, '-');
      pdf.save(fileName);
    } catch (e: unknown) {
      setError((e as Error)?.message || (isZh ? '导出 PDF 失败' : 'Failed to export PDF'));
    } finally {
      setStudentReportPdfExporting(false);
    }
  }, [
    selectedStudent,
    selectedTemplateId,
    reportTemplate?.title,
    isZh,
    reportTerm,
    currentYearId,
    years,
    classes,
    selectedClassId,
  ]);

  const exportWholeClassReportPdf = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const selectedOption = classReportOptions.find((o) => o.key === selectedClassReportKey) ?? null;
    if (!selectedOption || !classReportTemplate || classReportSnapshotItems.length === 0) return;
    setClassReportExporting('whole');
    setClassReportError(null);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const flow = { y: WB_PDF_MARGIN.top };
      const classShort = selectedClassRecord
        ? workbenchClassShortLabel({ className: selectedClassRecord.name, grade: selectedClassRecord.grade })
        : '—';
      const yearName = years.find((y) => y.id === selectedOption.academicYearId)?.name ?? selectedOption.academicYearId;
      const line1 = `${yearName}-${reportTermLabel(selectedOption.term, isZh)}-${
        classReportTemplate.title?.trim() || (isZh ? '学业报告' : 'Academic report')
      }`;
      const ctx: ClassReportPdfExportContext = {
        isZh,
        line1,
        classShort,
        classReportTemplate,
        academicYearRubric,
        reportYearExamPreset,
        gradeConfig,
        selectedClassRecord,
        subjectShowsAssessmentScore,
      };

      for (let i = 0; i < classReportSnapshotItems.length; i += 1) {
        await appendClassReportStudentToPdf(pdf, classReportSnapshotItems[i], ctx, flow);
        if (i < classReportSnapshotItems.length - 1) {
          if (pdf.getNumberOfPages() % 2 === 1) pdf.addPage();
          pdf.addPage();
          flow.y = WB_PDF_MARGIN.top;
        }
      }

      const classSeg = classShort.replace(/[/\\?%*:|"<>]/g, '-');
      const dateSeg = new Date().toISOString().slice(0, 10);
      pdf.save(`${isZh ? '全班学业报告' : 'class-academic-reports'}-${classSeg}-${dateSeg}.pdf`);
    } catch (e: unknown) {
      setClassReportError((e as Error)?.message || (isZh ? '导出全班报告失败' : 'Failed to export class PDF'));
    } finally {
      setClassReportExporting(false);
    }
  }, [
    classReportOptions,
    selectedClassReportKey,
    classReportTemplate,
    classReportSnapshotItems,
    selectedClassRecord,
    years,
    isZh,
    academicYearRubric,
    subjectShowsAssessmentScore,
    reportYearExamPreset,
    gradeConfig,
  ]);

  const exportPerStudentClassReportsZip = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const selectedOption = classReportOptions.find((o) => o.key === selectedClassReportKey) ?? null;
    if (!selectedOption || !classReportTemplate || classReportSnapshotItems.length === 0) return;
    setClassReportExporting('per-student');
    setClassReportError(null);
    try {
      const JSZip = (await import('jszip')).default;
      const { jsPDF } = await import('jspdf');
      const zip = new JSZip();
      const classShort = selectedClassRecord
        ? workbenchClassShortLabel({ className: selectedClassRecord.name, grade: selectedClassRecord.grade })
        : '—';
      const yearName = years.find((y) => y.id === selectedOption.academicYearId)?.name ?? selectedOption.academicYearId;
      const line1 = `${yearName}-${reportTermLabel(selectedOption.term, isZh)}-${
        classReportTemplate.title?.trim() || (isZh ? '学业报告' : 'Academic report')
      }`;
      const ctx: ClassReportPdfExportContext = {
        isZh,
        line1,
        classShort,
        classReportTemplate,
        academicYearRubric,
        reportYearExamPreset,
        gradeConfig,
        selectedClassRecord,
        subjectShowsAssessmentScore,
      };

      for (let i = 0; i < classReportSnapshotItems.length; i += 1) {
        const item = classReportSnapshotItems[i];
        const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
        const flow = { y: WB_PDF_MARGIN.top };
        await appendClassReportStudentToPdf(pdf, item, ctx, flow);
        const displayName = classReportStudentDisplayName(item.student);
        const fileName = safeClassReportPdfFileName(displayName, i, isZh);
        zip.file(fileName, pdf.output('blob'));
      }

      const classSeg = classShort.replace(/[/\\?%*:|"<>]/g, '-');
      const dateSeg = new Date().toISOString().slice(0, 10);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${isZh ? '全班学业报告' : 'class-academic-reports'}-${classSeg}-${dateSeg}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setClassReportError(
        (e as Error)?.message || (isZh ? '分学生导出失败' : 'Failed to export per-student reports'),
      );
    } finally {
      setClassReportExporting(false);
    }
  }, [
    classReportOptions,
    selectedClassReportKey,
    classReportTemplate,
    classReportSnapshotItems,
    selectedClassRecord,
    years,
    isZh,
    academicYearRubric,
    subjectShowsAssessmentScore,
    reportYearExamPreset,
    gradeConfig,
  ]);

  const workbenchClassGradeCatalogId = useMemo(() => {
    const cls = workbenchProgress?.classes.find((c) => c.classId === workbenchClassId);
    if (!cls) return null;
    const classRow = classes.find((c) => c.id === workbenchClassId);
    return getGradeCatalogIdForClass(gradeConfig, cls.grade, {
      className: classRow?.name ?? cls.className,
    });
  }, [workbenchProgress, workbenchClassId, classes, gradeConfig]);

  const workbenchSubject = useMemo(() => {
    if (isWorkbenchHomeroomMode(workbenchSubjectKey)) return null;
    const raw = workbenchTemplateDetail?.subjects.find((s) => s.subjectKey === workbenchSubjectKey);
    if (!raw) return null;
    const dims = resolveTemplateDimensionsForGrade(raw, workbenchClassGradeCatalogId);
    return {
      ...raw,
      dimensions: dims.map((d) => ({
        id: d.id ?? `wb-dim-${d.dimensionKey}`,
        dimensionKey: d.dimensionKey,
        dimensionLabel: d.dimensionLabel,
        dimensionLabelZh: d.dimensionLabelZh ?? d.dimensionLabel,
        dimensionLabelEn: d.dimensionLabelEn ?? d.dimensionLabel,
        sortOrder: d.sortOrder,
        levelDescriptions: d.levelDescriptions ?? {},
      })),
    };
  }, [workbenchTemplateDetail, workbenchSubjectKey, workbenchClassGradeCatalogId]);
  /** 与后台考试设置、API 保存校验、学生端展示共用：effectiveTemplateSubjectEnableScore + 学年模块化配置 */
  const workbenchIsExamSubject = useMemo(() => {
    if (!workbenchSubject || !workbenchTemplateDetail || !workbenchYearExamPresetLoaded) return false;
    const tpl = workbenchTemplateDetail;
    const segmentId = String(tpl.schoolSegmentId ?? '').trim();
    return effectiveTemplateSubjectEnableScore(
      tpl.term,
      segmentId,
      workbenchSubject.subjectKey,
      workbenchClassGradeCatalogId,
      getSegmentGradeIds(gradeConfig, segmentId),
      workbenchSubject.enableScore !== false,
      workbenchYearExamPreset,
    );
  }, [
    workbenchSubject,
    workbenchTemplateDetail,
    workbenchClassGradeCatalogId,
    workbenchYearExamPreset,
    workbenchYearExamPresetLoaded,
    gradeConfig,
  ]);
  const workbenchReadOnly = useMemo(
    () =>
      workbenchAdminViewing
      || (user?.role === 'teacher' && !!workbenchTemplateDetail && workbenchTemplateDetail.status !== 'published'),
    [workbenchAdminViewing, user?.role, workbenchTemplateDetail],
  );
  const workbenchDisplayTeacherName = useMemo(() => {
    if (workbenchAdminViewing) {
      const fromProgress = workbenchProgress?.viewingTeacherName?.trim();
      if (fromProgress) return fromProgress;
      return adminViewTeachers.find((t) => t.id === adminViewTeacherId)?.name ?? '';
    }
    return workbenchTeacherDisplayName;
  }, [
    workbenchAdminViewing,
    workbenchProgress?.viewingTeacherName,
    adminViewTeachers,
    adminViewTeacherId,
    workbenchTeacherDisplayName,
  ]);
  const workbenchActionableClasses = useMemo(
    () => filterWorkbenchActionableClasses(workbenchProgress?.classes ?? [], workbenchTemplateDetail?.subjects),
    [workbenchProgress, workbenchTemplateDetail],
  );

  const workbenchClassProgressItem = useMemo(
    () => workbenchProgress?.classes.find((c) => c.classId === workbenchClassId) ?? null,
    [workbenchProgress, workbenchClassId],
  );
  /** 与后端 my-progress 对齐；旧接口无 homeroomEvaluationAvailable 时退回 requiresHomeroomComment（仅必填场景） */
  const workbenchHomeroomOptionAvailable = useMemo(() => {
    const c = workbenchClassProgressItem;
    if (!c) return false;
    return Boolean(c.homeroomEvaluationAvailable ?? c.requiresHomeroomComment);
  }, [workbenchClassProgressItem]);
  const workbenchScoreRules = useMemo(() => {
    const tpl = workbenchTemplateDetail;
    const cls = workbenchProgress?.classes.find((c) => c.classId === workbenchClassId);
    const sub = tpl?.subjects.find((s) => s.subjectKey === workbenchSubjectKey);
    const letterFallback = mergeReportScoreGradeMinScores(tpl?.scoreGradeMinScores ?? {});
    const emptyDimMax = new Map<string, number>();
    if (!workbenchIsExamSubject) {
      return { dimensionMaxByKey: emptyDimMax, totalMax: 100, examFullScore: null, configuredBands: null, letterMins: letterFallback };
    }
    if (!tpl || !sub || !cls || !workbenchYearExamPreset?.examConfigs) {
      return { dimensionMaxByKey: emptyDimMax, totalMax: 100, examFullScore: null, configuredBands: null, letterMins: letterFallback };
    }
    const classRow = classes.find((c) => c.id === workbenchClassId);
    const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, cls.grade, {
      className: classRow?.name ?? cls.className,
    });
    const examKey = `${tpl.term}::${(tpl.schoolSegmentId ?? '').trim()}`;
    const scope = workbenchYearExamPreset.examConfigs[examKey];
    const examSubject = scope?.subjects?.find((s) => s.subjectKey === workbenchSubjectKey);
    const examG =
      examSubject?.gradeConfigs?.find((g) => g.gradeId === gradeCatalogId) ?? examSubject?.gradeConfigs?.[0] ?? null;
    const configuredBands = configuredReportScoreGradeMins(examG?.percentBands ?? {});
    const hasExamBands = Object.keys(configuredBands).length > 0;
    const totalMax = hasExamBands ? examFullScoreFromGradeConfig(examG?.fullScore, examG?.percentBands) : 100;
    return {
      dimensionMaxByKey: emptyDimMax,
      totalMax,
      examFullScore: hasExamBands ? totalMax : null,
      configuredBands: hasExamBands ? configuredBands : null,
      letterMins: letterFallback,
    };
  }, [
    workbenchTemplateDetail,
    workbenchYearExamPreset,
    workbenchClassId,
    workbenchSubjectKey,
    workbenchProgress,
    workbenchIsExamSubject,
    gradeConfig,
    classes,
  ]);
  const workbenchScores = useMemo(
    () =>
      workbenchStudentDrafts
        .map((r) => r.subject.finalScore)
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
    [workbenchStudentDrafts],
  );
  const workbenchScoreStats = useMemo(() => {
    const TM = workbenchIsExamSubject ? Math.max(1, workbenchScoreRules.totalMax) : 100;
    const rawList = workbenchIsExamSubject
      ? workbenchStudentDrafts
          .map((r) => r.subject.finalScore)
          .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      : workbenchScores;
    const pctList =
      workbenchIsExamSubject && TM > 0
        ? rawList.map((s) => (s / TM) * 100)
        : rawList;
    const n = rawList.length;
    const binsTemplate = () =>
      WORKBENCH_SCORE_PCT_BIN_LABELS.map((def) => ({
        labelZh: def.labelZh,
        labelEn: def.labelEn,
        count: 0,
        barPct: 0,
      }));
    if (n === 0) {
      return {
        avgScore: 0,
        stdScore: 0,
        medianScore: 0,
        excellentRate: 0,
        goodRate: 0,
        passRate: 0,
        weakRate: 0,
        bins: binsTemplate(),
      };
    }
    const avgScore = rawList.reduce((a, b) => a + b, 0) / n;
    const variance = rawList.reduce((a, b) => a + (b - avgScore) ** 2, 0) / n;
    const stdScore = Math.sqrt(variance);
    const sortedRaw = [...rawList].sort((a, b) => a - b);
    const medianRaw =
      n % 2 === 1 ? sortedRaw[(n - 1) / 2] : (sortedRaw[n / 2 - 1] + sortedRaw[n / 2]) / 2;
    const excellentRate =
      n > 0 ? Number(((pctList.filter((p) => p >= 85).length / n) * 100).toFixed(1)) : 0;
    const goodRate = n > 0 ? Number(((pctList.filter((p) => p >= 75).length / n) * 100).toFixed(1)) : 0;
    const passRate = n > 0 ? Number(((pctList.filter((p) => p >= 60).length / n) * 100).toFixed(1)) : 0;
    const weakRate = n > 0 ? Number(((pctList.filter((p) => p < 35).length / n) * 100).toFixed(1)) : 0;

    const bins = WORKBENCH_SCORE_PCT_BIN_LABELS.map((def) => {
      const count = pctList.filter((p) => workbenchPctInScoreBin(p, def)).length;
      return {
        labelZh: def.labelZh,
        labelEn: def.labelEn,
        count,
        barPct: 0,
      };
    });
    const maxBin = Math.max(1, ...bins.map((b) => b.count));
    for (const b of bins) {
      b.barPct = (b.count / maxBin) * 100;
    }
    return {
      avgScore: Number(avgScore.toFixed(2)),
      stdScore: Number(stdScore.toFixed(2)),
      medianScore: Number(medianRaw.toFixed(2)),
      excellentRate,
      goodRate,
      passRate,
      weakRate,
      bins,
    };
  }, [workbenchStudentDrafts, workbenchScores, workbenchIsExamSubject, workbenchScoreRules.totalMax]);

  const exportWorkbenchReportPdf = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const homeroom = isWorkbenchHomeroomMode(workbenchSubjectKey);
    const includedStudentIds = new Set(
      homeroom
        ? workbenchStudentDrafts
            .filter((r) => (r.homeroomComment ?? '').trim().length > 0)
            .map((r) => r.studentId)
        : workbenchStudentDrafts.map((r) => r.studentId),
    );
    setWorkbenchPdfExporting(true);
    setWorkbenchError(null);
    setWorkbenchSaveHint(null);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

      const cls = workbenchProgress?.classes.find((c) => c.classId === workbenchClassId);
      const classLabel = cls ? workbenchClassShortLabel(cls) : workbenchClassId;
      const subjectLabel = homeroom
        ? isZh
          ? '班主任'
          : 'Homeroom'
        : workbenchSubject
          ? workbenchSubjectModuleLabel(workbenchSubject, isZh)
          : workbenchSubjectKey;

      const metaLines = [
        workbenchTemplateDetail?.title?.trim() || (isZh ? '学业报告' : 'Academic report'),
        [classLabel, subjectLabel, workbenchTeacherDisplayName ? (isZh ? `教师：${workbenchTeacherDisplayName}` : `Teacher: ${workbenchTeacherDisplayName}`) : null]
          .filter(Boolean)
          .join(' · '),
      ];
      const flow = { y: WB_PDF_MARGIN.top };
      await wbPdfAppendTitleLinesAsImage(pdf, metaLines, flow);

      if (homeroom) {
        const rows = workbenchStudentDrafts
          .filter((r) => includedStudentIds.has(r.studentId))
          .map((r) => [r.studentName, (r.homeroomComment ?? '').trim()]);
        if (rows.length > 0) {
          await wbPdfAppendChunkedDataTableAsImages(pdf, {
            sectionTitle: isZh ? '班主任综合评价' : 'Homeroom comprehensive evaluation',
            showSectionTitleOnFirstChunkOnly: true,
            head: [isZh ? '学生' : 'Student', isZh ? '班主任评语' : 'Homeroom comment'],
            body: rows,
            rowsPerChunk: 8,
            flow,
          });
        }
      } else if (!workbenchSubject) {
        await wbPdfAppendTitleLinesAsImage(pdf, [isZh ? '当前无学科数据' : 'No subject data'], flow);
      } else {
        const elAuto = document.getElementById('workbench-pdf-auto-analysis');
        if (workbenchIsExamSubject && elAuto) {
          await wbPdfAppendElementAsImageSlices(pdf, elAuto as HTMLElement, includedStudentIds, flow);
        }

        const head: string[] = [isZh ? '学生' : 'Student'];
        for (const d of workbenchSubject.dimensions) {
          head.push(d.dimensionLabel);
        }
        if (workbenchIsExamSubject) {
          head.push(
            isZh
              ? `测评成绩（满分${workbenchScoreRules.totalMax}）`
              : `Assessment score (max ${workbenchScoreRules.totalMax})`,
          );
        }
        head.push(isZh ? '学习品质' : 'Learning quality');

        const body = workbenchStudentDrafts.map((row) => {
          const cells: string[] = [row.studentName];
          for (const d of workbenchSubject.dimensions) {
            cells.push(row.subject.dimensions.find((x) => x.dimensionKey === d.dimensionKey)?.rating ?? 'A');
          }
          if (workbenchIsExamSubject) {
            const total = row.subject.finalScore;
            const totalGradeFine = workbenchExamLetterGrade(total, workbenchScoreRules);
            cells.push(
              total != null ? `${total}${totalGradeFine ? ` ${totalGradeFine}` : ''}`.trim() : '—',
            );
          }
          cells.push(row.subject.learningQualityGrade ?? 'A');
          return cells;
        });

        if (body.length > 0) {
          await wbPdfAppendChunkedDataTableAsImages(pdf, {
            sectionTitle: isZh ? '学业质量评价' : 'Academic quality evaluation',
            showSectionTitleOnFirstChunkOnly: true,
            head,
            body,
            rowsPerChunk: 10,
            flow,
            cellTextAlign: 'center',
          });
        }

        if (workbenchClassOverallAnalysis.trim()) {
          await wbPdfAppendWorkbenchTextSectionAsImage(pdf, {
            title: isZh ? '班级整体分析（校内记录）' : 'Class overall analysis (internal)',
            body: workbenchClassOverallAnalysis,
            flow,
          });
        }

        const studentNameById = new Map(workbenchStudentDrafts.map((r) => [r.studentId, r.studentName]));
        const analysisBody = workbenchStudentAnalysisRows
          .filter((row) => row.studentId && (row.learningAnalysis.trim() || row.supportPlan.trim()))
          .map((row) => [
            studentNameById.get(row.studentId) ?? row.studentId,
            row.learningAnalysis.trim(),
            row.supportPlan.trim(),
          ]);
        if (analysisBody.length > 0) {
          await wbPdfAppendChunkedDataTableAsImages(pdf, {
            sectionTitle: isZh ? '个别学生分析（校内记录）' : 'Individual student analysis (internal)',
            showSectionTitleOnFirstChunkOnly: true,
            head: [isZh ? '学生' : 'Student', isZh ? '学情分析' : 'Learning analysis', isZh ? '支持计划' : 'Support plan'],
            body: analysisBody,
            rowsPerChunk: 8,
            flow,
          });
        }
      }

      const classSeg = classLabel.replace(/[/\\?%*:|"<>]/g, '-');
      const subjSeg = (homeroom ? (isZh ? '班主任' : 'homeroom') : (workbenchSubject?.subjectName ?? workbenchSubjectKey)).replace(
        /[/\\?%*:|"<>]/g,
        '-',
      );
      const tplSeg = (workbenchTemplateDetail?.title ?? 'report').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 48);
      const dateSeg = new Date().toISOString().slice(0, 10);
      const fileName = `${isZh ? '学业报告' : 'academic-report'}-${tplSeg}-${classSeg}-${subjSeg}-${dateSeg}.pdf`;
      pdf.save(fileName);
    } catch (e: unknown) {
      setWorkbenchError((e as Error)?.message || (isZh ? '导出 PDF 失败' : 'Failed to export PDF'));
    } finally {
      setWorkbenchPdfExporting(false);
    }
  }, [
    workbenchProgress,
    workbenchClassId,
    workbenchSubjectKey,
    workbenchSubject,
    workbenchTemplateDetail,
    workbenchStudentDrafts,
    workbenchIsExamSubject,
    workbenchScoreRules,
    workbenchClassOverallAnalysis,
    workbenchStudentAnalysisRows,
    workbenchTeacherDisplayName,
    isZh,
  ]);

  const saveWorkbenchClassReport = async () => {
    if (!workbenchTemplateDetail || !workbenchClassId || !workbenchSubjectKey) return;
    if (workbenchReadOnly) {
      setWorkbenchError(
        workbenchAdminViewing
          ? isZh
            ? '管理员查看模式为只读，无法修改教师填写内容。'
            : 'Admin view is read-only; you cannot edit teacher entries.'
          : isZh
            ? '该学业报告已停发，当前为只读模式。'
            : 'This report is stopped and currently read-only.',
      );
      return;
    }
    setWorkbenchSaving(true);
    setWorkbenchError(null);
    setWorkbenchSaveHint(null);
    try {
      if (isWorkbenchHomeroomMode(workbenchSubjectKey)) {
        await Promise.all(
          workbenchStudentDrafts.map(async (row) => {
            await api.updateStudentTermHomeroomComment(
              row.studentId,
              workbenchTemplateDetail.academicYearId,
              workbenchTemplateDetail.term,
              workbenchTemplateDetail.id ?? '',
              row.homeroomComment?.trim() || null,
            );
          }),
        );
        const progress = await api.getMyReportTemplateProgress(workbenchTemplateDetail.id ?? '');
        setWorkbenchProgress(progress);

        const pendingNames = workbenchStudentDrafts
          .filter((r) => !(r.homeroomComment ?? '').trim())
          .map((r) => r.studentName);
        if (workbenchStudentDrafts.length === 0) {
          setWorkbenchSaveHint(isZh ? '已保存。' : 'Saved.');
        } else if (pendingNames.length === 0) {
          setWorkbenchSaveHint(isZh ? '已保存。本班班主任评价已全部填写。' : 'Saved. Homeroom comments are complete for this class.');
        } else {
          const shown = pendingNames.slice(0, 12).join(isZh ? '、' : ', ');
          const tail =
            pendingNames.length > 12
              ? isZh
                ? `…（共${pendingNames.length}人）`
                : ` … (${pendingNames.length} students)`
              : '';
          setWorkbenchSaveHint(
            isZh
              ? `已保存。尚未填写班主任评价的学生：${shown}${tail}`
              : `Saved. Students still missing homeroom comment: ${shown}${tail}`,
          );
        }
        return;
      }

      await Promise.all(
        workbenchStudentDrafts.map(async (row) => {
          await api.upsertStudentTermSubjectReport(
            row.studentId,
            workbenchTemplateDetail.academicYearId,
            workbenchTemplateDetail.term,
            workbenchTemplateDetail.id ?? '',
            workbenchSubjectKey,
            {
              subjectName: row.subject.subjectName,
              midtermScore: row.subject.midtermScore,
              finalScore: row.subject.finalScore,
              examDimensionScores: null,
              teacherComment: null,
              learningQualityGrade: row.subject.learningQualityGrade ?? 'A',
              dimensions: row.subject.dimensions.map((d) => ({
                dimensionKey: d.dimensionKey,
                dimensionLabel: d.dimensionLabel,
                rating: d.rating,
                levelDescriptions: d.levelDescriptions,
              })),
            },
          );
        }),
      );
      await api.upsertReportClassSubjectInsights(workbenchTemplateDetail.id ?? '', workbenchClassId, workbenchSubjectKey, {
        classOverallAnalysis: workbenchClassOverallAnalysis.trim() || null,
        studentAnalysisRows: workbenchStudentAnalysisRows.filter((row) => row.studentId),
      });
      const progress = await api.getMyReportTemplateProgress(workbenchTemplateDetail.id ?? '');
      setWorkbenchProgress(progress);

      const incomplete: string[] = [];
      if (workbenchIsExamSubject && workbenchSubject) {
        const pendingNames = workbenchStudentDrafts
          .filter((row) => row.subject.finalScore == null || !Number.isFinite(row.subject.finalScore))
          .map((r) => r.studentName);
        if (pendingNames.length > 0) {
          const head = pendingNames.slice(0, 8).join(isZh ? '、' : ', ');
          const tail =
            pendingNames.length > 8
              ? isZh
                ? `…（共${pendingNames.length}人）`
                : ` … (${pendingNames.length} students)`
              : '';
          incomplete.push(
            (isZh ? '学科成绩未录全：' : 'Incomplete subject scores: ') + head + tail,
          );
        }
      }
      setWorkbenchSaveHint(
        incomplete.length > 0
          ? isZh
            ? `已保存。以下尚未完成：${incomplete.join('；')}。`
            : `Saved. Still pending: ${incomplete.join('; ')}.`
          : null,
      );
    } catch (e: unknown) {
      setWorkbenchError((e as Error)?.message || 'Failed to save class report');
    } finally {
      setWorkbenchSaving(false);
    }
  };

  const reportYearOptions = useMemo(() => {
    if (!isStudentSelf) return years.map((y) => ({ id: y.id, name: y.name }));
    const map = new Map<string, string>();
    for (const r of reportList) {
      if (!map.has(r.academicYearId)) map.set(r.academicYearId, r.academicYearName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [isStudentSelf, years, reportList]);

  const releasedReportPickOptions = useMemo(
    () =>
      reportList
        .filter((r) => !!r.releasedAt && !!r.templateId)
        .map((r) => ({
          key: `${r.academicYearId}::${r.term}::${r.templateId}`,
          label: `${r.academicYearName} · ${
            r.term === 'Semester 1' ? (isZh ? '上学期' : 'Semester 1') : isZh ? '下学期' : 'Semester 2'
          } · ${r.templateTitle || (isZh ? '学业报告' : 'Academic report')}`,
          academicYearId: r.academicYearId,
          term: r.term as Term,
          templateId: r.templateId as string,
          releasedAt: r.releasedAt,
        }))
        .sort((a, b) => String(b.releasedAt ?? '').localeCompare(String(a.releasedAt ?? ''))),
    [reportList, isZh],
  );

  useEffect(() => {
    if (!selectedStudentId) return;
    if (releasedReportPickOptions.length === 0) {
      setSelectedTemplateId('');
      setReportDetail(null);
      setReportTemplate(null);
      return;
    }
    const key = `${currentYearId ?? ''}::${reportTerm}::${selectedTemplateId}`;
    if (releasedReportPickOptions.some((o) => o.key === key)) return;
    const best = releasedReportPickOptions[0];
    setCurrentYearId(best.academicYearId);
    setReportTerm(best.term);
    setSelectedTemplateId(best.templateId);
  }, [selectedStudentId, releasedReportPickOptions, currentYearId, reportTerm, selectedTemplateId]);

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || !selectedClassId) {
      setClassReportOptions([]);
      setSelectedClassReportKey('');
      return;
    }
    if (!canViewMyStudentsClassAggregate) {
      setClassReportOptions([]);
      setSelectedClassReportKey('');
      setClassReportLoading(false);
      setClassReportError(null);
      return;
    }
    if (myStudents.length === 0) {
      setClassReportOptions([]);
      setSelectedClassReportKey('');
      return;
    }
    let cancelled = false;
    setClassReportLoading(true);
    setClassReportError(null);
    Promise.all(myStudents.map((stu) => api.getStudentTermReports(stu.id).catch(() => [])))
      .then((allLists) => {
        if (cancelled) return;
        const map = new Map<string, ReleasedClassReportOption>();
        for (const list of allLists) {
          for (const r of list) {
            if (!r.releasedAt || !r.templateId) continue;
            const key = `${r.academicYearId}::${r.term}::${r.templateId}`;
            const existing = map.get(key);
            if (!existing || String(r.releasedAt ?? '') > String(existing.releasedAt ?? '')) {
              map.set(key, {
                key,
                label: `${r.academicYearName} · ${reportTermLabel(r.term, isZh)} · ${r.templateTitle || (isZh ? '学业报告' : 'Academic report')}`,
                academicYearId: r.academicYearId,
                term: r.term,
                templateId: r.templateId,
                releasedAt: r.releasedAt,
                templateTitle: r.templateTitle ?? null,
              });
            }
          }
        }
        const options = Array.from(map.values()).sort((a, b) => String(b.releasedAt ?? '').localeCompare(String(a.releasedAt ?? '')));
        setClassReportOptions(options);
        setSelectedClassReportKey((prev) => (prev && options.some((o) => o.key === prev) ? prev : (options[0]?.key ?? '')));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setClassReportOptions([]);
        setSelectedClassReportKey('');
        setClassReportError((e as Error)?.message || (isZh ? '加载班级报告列表失败' : 'Failed to load class reports'));
      })
      .finally(() => {
        if (!cancelled) setClassReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, selectedClassId, myStudents, isZh, canViewMyStudentsClassAggregate]);

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || !selectedClassReportKey || myStudents.length === 0) {
      setClassReportTemplate(null);
      setClassReportSnapshotItems([]);
      return;
    }
    if (!canViewMyStudentsClassAggregate) {
      setClassReportTemplate(null);
      setClassReportSnapshotItems([]);
      return;
    }
    const [academicYearId, termRaw, templateId] = selectedClassReportKey.split('::');
    if (!academicYearId || !termRaw || !templateId) {
      setClassReportTemplate(null);
      setClassReportSnapshotItems([]);
      return;
    }
    const term = termRaw as Term;
    let cancelled = false;
    setClassReportLoading(true);
    setClassReportError(null);
    Promise.all(
      myStudents.map(async (stu) => {
        const bundle = await api.getStudentTermReportBundle(stu.id, academicYearId, term, templateId);
        const classRow = classes.find((c) => c.id === selectedClassId);
        return {
          student: stu,
          bundle,
          gradeCatalogId: gradeCatalogIdForStudentGrade(
            gradeConfig,
            stu.currentGrade ?? null,
            classRow?.name,
          ),
        };
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        setClassReportTemplate(rows[0]?.bundle.template ?? null);
        const merged = rows.map((x) => ({
          student: x.student,
          report: mergeStudentTermReportWithTemplate(
            x.bundle.report,
            x.bundle.template,
            x.gradeCatalogId,
            { padMissingSubjects: false, blankUnsetRatings: true },
          ),
        }));
        setClassReportSnapshotItems(merged);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setClassReportTemplate(null);
        setClassReportSnapshotItems([]);
        setClassReportError((e as Error)?.message || (isZh ? '加载班级学业报告失败' : 'Failed to load class report data'));
      })
      .finally(() => {
        if (!cancelled) setClassReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, selectedClassReportKey, myStudents, isZh, canViewMyStudentsClassAggregate]);

  const selectedClassReportOption = useMemo(
    () => classReportOptions.find((o) => o.key === selectedClassReportKey) ?? null,
    [classReportOptions, selectedClassReportKey],
  );

  useEffect(() => {
    if (isStudentSelf || !USE_CLOUD_STORAGE || !selectedClassId || !selectedClassReportKey) {
      setClassSubjectAnalyses([]);
      return;
    }
    if (!canViewMyStudentsClassAggregate) {
      setClassSubjectAnalyses([]);
      return;
    }
    const templateId = selectedClassReportKey.split('::')[2];
    if (!templateId) {
      setClassSubjectAnalyses([]);
      return;
    }
    let cancelled = false;
    setClassSubjectAnalysesLoading(true);
    api
      .getReportClassInsightsSummary(templateId, selectedClassId)
      .then((rows) => {
        if (!cancelled) setClassSubjectAnalyses(rows);
      })
      .catch(() => {
        if (!cancelled) setClassSubjectAnalyses([]);
      })
      .finally(() => {
        if (!cancelled) setClassSubjectAnalysesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, selectedClassId, selectedClassReportKey, canViewMyStudentsClassAggregate]);

  const classAcademicInsight = useMemo(() => {
    const total = classReportSnapshotItems.length;
    if (total === 0) {
      return {
        totalStudents: 0,
        completedStudents: 0,
        completionRate: 0,
        homeroomCompleted: 0,
        homeroomCompletionRate: 0,
        subjectScoreAverages: [] as Array<{ subject: string; avg: number; count: number }>,
        levelCounts: { A: 0, B: 0, C: 0, D: 0 } as Record<TargetLevel, number>,
      };
    }
    let completedStudents = 0;
    let homeroomCompleted = 0;
    const scoreBucket = new Map<string, { sum: number; count: number }>();
    const levelCounts: Record<TargetLevel, number> = { A: 0, B: 0, C: 0, D: 0 };

    for (const item of classReportSnapshotItems) {
      const rep = item.report;
      if (hasStudentReportContent(rep)) completedStudents += 1;
      if ((rep.homeroomComment ?? '').trim()) homeroomCompleted += 1;
      for (const s of rep.subjectReports) {
        if (s.finalScore != null && Number.isFinite(s.finalScore)) {
          const k = s.subjectName || s.subjectKey;
          const old = scoreBucket.get(k) ?? { sum: 0, count: 0 };
          old.sum += s.finalScore;
          old.count += 1;
          scoreBucket.set(k, old);
        }
        const lq = s.learningQualityGrade;
        if (lq && (lq === 'A' || lq === 'B' || lq === 'C' || lq === 'D')) levelCounts[lq] += 1;
      }
    }

    const subjectScoreAverages = Array.from(scoreBucket.entries())
      .map(([subject, v]) => ({
        subject,
        avg: Number((v.sum / Math.max(v.count, 1)).toFixed(1)),
        count: v.count,
      }))
      .sort((a, b) => b.avg - a.avg);

    return {
      totalStudents: total,
      completedStudents,
      completionRate: Math.round((completedStudents / Math.max(total, 1)) * 100),
      homeroomCompleted,
      homeroomCompletionRate: Math.round((homeroomCompleted / Math.max(total, 1)) * 100),
      subjectScoreAverages,
      levelCounts,
    };
  }, [classReportSnapshotItems]);

  const classSubjectAnalysesFilled = useMemo(
    () => classSubjectAnalyses.filter((item) => (item.classOverallAnalysis ?? '').trim()),
    [classSubjectAnalyses],
  );

  const overviewLatestSnapshot = useMemo(
    () => (overviewSnapshots.length > 0 ? overviewSnapshots[overviewSnapshots.length - 1] : null),
    [overviewSnapshots],
  );

  const overviewTrendSeries = useMemo(
    () =>
      buildExamScoreTrendSeries({
        snapshots: overviewSnapshots,
        gradeConfig,
        studentGrade: selectedStudent?.currentGrade ?? null,
      }),
    [overviewSnapshots, gradeConfig, selectedStudent?.currentGrade],
  );

  const overviewShowHomeroom = useMemo(() => {
    const tpl = overviewLatestSnapshot?.template;
    if (tpl) return tpl.homeroomCommentMode !== 'disabled';
    return true;
  }, [overviewLatestSnapshot?.template]);

  const schoolCurrentYearNameForMyStudents = useMemo(
    () => years.find((y) => y.id === schoolCurrentYearIdForMyStudents)?.name ?? null,
    [years, schoolCurrentYearIdForMyStudents],
  );

  const studentOverviewSubjectScoreScaleSet = useMemo((): ReportSubjectScoreScaleSet | null => {
    const latest = overviewLatestSnapshot;
    if (!latest?.template) return null;
    return {
      reportLabel: latest.meta.label,
      term: latest.meta.term,
      templateTitle: latest.meta.templateTitle,
      scales: buildSubjectScoreScalesForSnapshot(latest, gradeConfig, selectedStudent?.currentGrade ?? null),
    };
  }, [overviewLatestSnapshot, gradeConfig, selectedStudent?.currentGrade]);

  const classOverviewSubjectScoreScaleSet = useMemo((): ReportSubjectScoreScaleSet | null => {
    if (!classReportTemplate || !reportYearExamPreset || !selectedClassRecord || !selectedClassReportOption) {
      return null;
    }
    const gradeCatalogId = getGradeCatalogIdForClass(gradeConfig, selectedClassRecord.grade, {
      className: selectedClassRecord.name,
    });
    const subjects: Array<{ subjectKey: string; subjectName: string }> = [];
    const seen = new Set<string>();
    for (const item of classReportSnapshotItems) {
      for (const s of item.report.subjectReports) {
        if (!s.subjectKey || seen.has(s.subjectKey)) continue;
        seen.add(s.subjectKey);
        subjects.push({ subjectKey: s.subjectKey, subjectName: s.subjectName || s.subjectKey });
      }
    }
    const termRaw = selectedClassReportKey.split('::')[1] as Term | undefined;
    return {
      reportLabel: selectedClassReportOption.label,
      term: termRaw === 'Semester 1' || termRaw === 'Semester 2' ? termRaw : classReportTemplate.term,
      templateTitle: classReportTemplate.title ?? null,
      scales: buildSubjectScoreScales({
        subjects,
        template: classReportTemplate,
        examPreset: reportYearExamPreset,
        gradeCatalogId,
        gradeConfig,
        studentGrade: selectedClassRecord.grade,
      }),
    };
  }, [
    classReportTemplate,
    reportYearExamPreset,
    selectedClassRecord,
    classReportSnapshotItems,
    gradeConfig,
    selectedClassReportOption,
    selectedClassReportKey,
  ]);

  const subjectScoreScaleSetForAI = useMemo((): ReportSubjectScoreScaleSet | null => {
    if (isStudentSelf || (tab === 'my-students' && selectedStudentId)) {
      return studentOverviewSubjectScoreScaleSet;
    }
    if (tab === 'my-students' && !selectedStudentId) {
      return classOverviewSubjectScoreScaleSet;
    }
    return null;
  }, [
    isStudentSelf,
    tab,
    selectedStudentId,
    studentOverviewSubjectScoreScaleSet,
    classOverviewSubjectScoreScaleSet,
  ]);

  const studentPortraitAIPayload = useMemo(
    () =>
      buildStudentPortraitAIPayload({
        tab,
        isStudentSelf,
        selectedStudentId,
        myStudentsLensTab,
        selectedClassRecord,
        schoolCurrentYearName: schoolCurrentYearNameForMyStudents,
        selectedStudent,
        selectedClassReportOption,
        classAcademicInsight,
        classSubjectAnalysesFilled,
        classReportSnapshotItems,
        overviewSubjectInsights,
        overviewTrendSeries,
        overviewLatestSnapshot,
        subjectScoreScaleSet: subjectScoreScaleSetForAI,
        tabLabels: {
          school: isZh ? '学校看板' : 'School dashboard',
          myStudents: isZh ? '我的学生' : 'My Students',
          reportEntry: isZh ? '报告填写' : 'Report entry',
        },
        isZh,
      }),
    [
      tab,
      isStudentSelf,
      selectedStudentId,
      myStudentsLensTab,
      selectedClassRecord,
      schoolCurrentYearNameForMyStudents,
      selectedStudent,
      selectedClassReportOption,
      classAcademicInsight,
      classSubjectAnalysesFilled,
      classReportSnapshotItems,
      overviewSubjectInsights,
      overviewTrendSeries,
      overviewLatestSnapshot,
      subjectScoreScaleSetForAI,
      isZh,
    ],
  );

  useEffect(() => {
    if (!onToggleAI) return;
    setContextFromApp('student-portrait', studentPortraitAIPayload);
  }, [studentPortraitAIPayload, setContextFromApp, onToggleAI]);

  const renderStudentOverviewPanel = () => (
    <StudentOverviewPanel
      isZh={isZh}
      loading={overviewLoading}
      subjectInsights={overviewSubjectInsights}
      trendSeries={overviewTrendSeries}
      homeroomComment={overviewLatestSnapshot?.report.homeroomComment ?? null}
      showHomeroomSection={overviewShowHomeroom}
      showSubjectSupport={canViewStudentOverview && !isStudentSelf}
    />
  );

  const renderClassOverviewPanel = () => (
    <div className="border border-slate-200 rounded-xl p-3 space-y-3">
      <div className="flex flex-wrap items-stretch gap-2">
        <MenuSelect
          value={selectedClassReportKey}
          onChange={(e) => setSelectedClassReportKey(e.target.value)}
          disabled={classReportOptions.length === 0}
          className="h-9 min-w-0 flex-1 max-w-xl rounded-lg border border-slate-300 px-3 text-sm bg-white disabled:opacity-60"
        >
          {classReportOptions.length === 0 ? (
            <option value="">{isZh ? '该班暂无已推送学业报告' : 'No released reports for this class'}</option>
          ) : (
            classReportOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))
          )}
        </MenuSelect>
        {canExportWholeClassPdf && (
          <>
            <Button
              type="button"
              variant="default"
              size="default"
              className="h-9 shrink-0 bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
              onClick={() => void exportPerStudentClassReportsZip()}
              disabled={
                classReportExporting !== false ||
                classReportLoading ||
                !selectedClassReportOption ||
                classReportSnapshotItems.length === 0 ||
                !canExportWholeClassPdf
              }
            >
              {classReportExporting === 'per-student'
                ? isZh
                  ? '导出中…'
                  : 'Exporting…'
                : isZh
                  ? '分学生导出'
                  : 'Export Per Student'}
            </Button>
            <Button
              type="button"
              variant="default"
              size="default"
              className="h-9 shrink-0 bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
              onClick={() => void exportWholeClassReportPdf()}
              disabled={
                classReportExporting !== false ||
                classReportLoading ||
                !selectedClassReportOption ||
                classReportSnapshotItems.length === 0 ||
                !canExportWholeClassPdf
              }
            >
              {classReportExporting === 'whole'
                ? isZh
                  ? '导出中…'
                  : 'Exporting…'
                : isZh
                  ? '导出为一份文件(打印)'
                  : 'Export as One File (Print)'}
            </Button>
          </>
        )}
      </div>
      {classReportError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
          {classReportError}
        </div>
      )}
      {classReportLoading ? (
        <div className="text-sm text-slate-500">{isZh ? '加载班级报告中…' : 'Loading class report…'}</div>
      ) : classReportSnapshotItems.length === 0 ? (
        <div className="text-sm text-slate-500">
          {isZh ? '请选择已推送学业报告查看班级整体画像。' : 'Select a released report to view class insights.'}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-800">{isZh ? '班级整体情况' : 'Class overview'}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <div className="text-xs text-slate-500">{isZh ? '当前人数' : 'Students'}</div>
                <div className="text-lg font-semibold text-slate-800">{classAcademicInsight.totalStudents}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <div className="text-xs text-slate-500">{isZh ? '报告完成率' : 'Completion rate'}</div>
                <div className="text-lg font-semibold text-slate-800">{classAcademicInsight.completionRate}%</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {classAcademicInsight.completedStudents}/{classAcademicInsight.totalStudents}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <div className="text-xs text-slate-500">{isZh ? '班主任评语完成比例' : 'Homeroom comment rate'}</div>
                <div className="text-lg font-semibold text-slate-800">{classAcademicInsight.homeroomCompletionRate}%</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {classAcademicInsight.homeroomCompleted}/{classAcademicInsight.totalStudents}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-800">{isZh ? '学科均分' : 'Subject average'}</div>
                {classAcademicInsight.subjectScoreAverages.length === 0 ? (
                  <p className="text-sm text-slate-500">{isZh ? '暂无可计算的分数数据。' : 'No scorable data yet.'}</p>
                ) : (
                  classAcademicInsight.subjectScoreAverages.slice(0, 8).map((s) => (
                    <div key={s.subject} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{s.subject}</span>
                      <span className="font-medium text-slate-900">{s.avg}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-800">
                  {isZh ? '学习品质等第分布' : 'Learning-quality level distribution'}
                </div>
                <div className="h-44 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2">
                  {(() => {
                    const levels: TargetLevel[] = ['A', 'B', 'C', 'D'];
                    const maxCount = Math.max(1, ...levels.map((lv) => classAcademicInsight.levelCounts[lv] ?? 0));
                    return (
                      <div className="h-full flex items-end justify-around gap-3">
                        {levels.map((lv) => {
                          const count = classAcademicInsight.levelCounts[lv] ?? 0;
                          const hPct = Math.max(6, Math.round((count / maxCount) * 100));
                          return (
                            <div key={lv} className="flex-1 max-w-[4rem] h-full flex flex-col items-center justify-end gap-1">
                              <span className="text-xs font-medium text-slate-700">{count}</span>
                              <div className="w-full h-[76%] flex items-end">
                                <div
                                  className="w-full rounded-t bg-sky-500/85"
                                  style={{ height: `${hPct}%` }}
                                  title={`Level ${lv}: ${count}`}
                                />
                              </div>
                              <span className="text-xs text-slate-600">Level {lv}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <div className="text-sm font-semibold text-slate-800">
              {isZh ? '学科教师班级分析' : 'Subject teachers’ class analysis'}
            </div>
            {classSubjectAnalysesLoading ? (
              <div className="text-sm text-slate-500">{isZh ? '加载学科分析中…' : 'Loading subject analyses…'}</div>
            ) : classSubjectAnalysesFilled.length === 0 ? (
              <div className="text-sm text-slate-500">
                {isZh ? '暂无学科教师提交的班级整体分析。' : 'No subject teachers have submitted class analysis yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {classSubjectAnalysesFilled.map((item) => (
                  <div key={item.subjectKey} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">{item.subjectName}</span>
                      {item.teacherName ? (
                        <span className="text-xs text-slate-500">
                          {isZh ? `任课教师：${item.teacherName}` : `Teacher: ${item.teacherName}`}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{item.classOverallAnalysis}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`${onToggleAI ? 'h-full min-h-0 max-md:h-auto max-md:min-h-dvh' : 'min-h-screen'} flex w-full flex-col overflow-x-auto bg-slate-50 pt-[var(--app-topbar-height)]`}>
      <AppTopBar
        title={isStudentSelf ? (isZh ? '我的画像' : 'My profile') : isZh ? '学生中心' : 'Student Center'}
        showBack={!isStudentSelf}
        onBack={isStudentSelf ? undefined : onBackToHub}
        onToggleAI={onToggleAI && !isStudentSelf ? onToggleAI : undefined}
        isAIOpen={isAIOpen}
      />
      <main className="mx-auto w-full min-h-0 max-w-6xl flex-1 space-y-4 overflow-auto px-4 py-6">
        {!isStudentSelf && (
          <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex gap-1">
            {canViewSchoolDashboard && (
              <Button variant={tab === 'overview' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('overview')}>
                {isZh ? '学校看板' : 'School dashboard'}
              </Button>
            )}
            <Button variant={tab === 'my-students' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('my-students')}>
              {isZh ? '我的学生' : 'My Students'}
            </Button>
            {canAccessAcademicReportsTab && (
              <Button variant={tab === 'academic-reports' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('academic-reports')}>
                {isZh ? '报告填写' : 'Report entry'}
              </Button>
            )}
          </div>
        )}

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        {!USE_CLOUD_STORAGE && !loading && !isStudentSelf && (
          <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            {isZh
              ? '本地模式：看板与班级学生列表来自 localStorage；学期学业报告等需开启 VITE_USE_CLOUD_STORAGE 并联调后端 API。'
              : 'Local mode: dashboard and class lists use localStorage; term academic reports need API (set VITE_USE_CLOUD_STORAGE=true).'}
          </div>
        )}
        {loading && <div className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</div>}

        {!loading && isStudentSelf && selectedStudent && (
          <section className="space-y-4">
            <p className="text-sm text-slate-600">
              {isZh ? '以下为学生画像（只读）。基础学籍信息如有误请联系班主任或管理员。' : 'Your student portrait (read-only). Contact your teacher or admin if core records are wrong.'}
            </p>
            <PortraitLensWorkspace
              isZh={isZh}
              activeTab={portraitLensTab}
              onTabChange={setPortraitLensTab}
              renderOverview={renderStudentOverviewPanel}
              renderAcademic={() => (
                <>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
              <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-semibold">
                    {(selectedStudent.nameZh || selectedStudent.name).slice(0, 1)}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-800">{selectedStudent.nameZh || selectedStudent.name}</div>
                    <div className="text-sm text-slate-500">
                      {selectedStudent.nameEn || '—'} · {selectedStudent.studentNumber || '—'} · {selectedStudent.status || 'active'}
                    </div>
                  </div>
                </div>
              </div>
            <div id="term-report-panel" className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-semibold text-slate-800">{isZh ? '学业报告（按学期）' : 'Academic report (by term)'}</h3>
                {reportLoading && <span className="text-xs text-slate-500">{isZh ? '加载中…' : 'Loading…'}</span>}
              </div>
              <FilterToolbar>
                <AcademicYearSelect
                  isZh={isZh}
                  years={reportYearOptions}
                  value={currentYearId || ''}
                  onChange={(id) => setCurrentYearId(id || null)}
                  allowEmpty
                  emptyLabel={isZh ? '选择学年' : 'Select year'}
                />
                <TermSelect isZh={isZh} value={reportTerm} onChange={setReportTerm} />
                <FilterSelect
                  width="report"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  <option value="">{isZh ? '选择评价报告' : 'Select report'}</option>
                  {reportTemplates.map((tpl) => (
                    <option key={tpl.id ?? 'null'} value={tpl.id ?? ''}>
                      {tpl.title || (isZh ? '未命名评价' : 'Untitled evaluation')}
                    </option>
                  ))}
                </FilterSelect>
              </FilterToolbar>
              {!reportDetail || reportDetail.subjectReports.length === 0 ? (
                <p className="text-sm text-slate-500">{isZh ? '该学期暂无学业报告。' : 'No report for this term yet.'}</p>
              ) : (
                <div className="space-y-3">
                  {reportDetail.subjectReports.map((s) => (
                    <div key={s.subjectKey} className="rounded-lg border border-slate-200 p-3">
                      {(() => {
                        const subjectConfig = templateSubjectMap.get(s.subjectKey);
                        return (
                          <>
                      <div className="text-sm font-semibold text-slate-800">{s.subjectName}</div>
                      {subjectConfig?.enableLearningQuality !== false && s.learningQualityGrade ? (
                        <div className="text-xs text-slate-500 mt-1">
                          {isZh ? '学习品质' : 'Learning quality'}: <span className="font-medium text-slate-800">{s.learningQualityGrade}</span>
                        </div>
                      ) : null}
                      {subjectShowsAssessmentScore(
                        s.subjectKey,
                        reportTemplate,
                        reportStudentGradeCatalogId,
                      ) && (
                        <div className="text-xs text-slate-500 mt-1">
                          {isZh ? '期中等第' : 'Midterm grade'}:{' '}
                          {resolveSubjectAssessmentGrade(
                            { ...s, finalGrade: s.midtermGrade, finalScore: s.midtermScore },
                            reportTemplate,
                            reportYearExamPreset,
                            reportStudentGradeCatalogId,
                          )}{' '}
                          · {isZh ? '期末等第' : 'Final grade'}:{' '}
                          {resolveSubjectAssessmentGrade(s, reportTemplate, reportYearExamPreset, reportStudentGradeCatalogId)}
                        </div>
                      )}
                      {s.dimensions.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {s.dimensions.map((d) => (
                            <div key={d.id} className="text-xs rounded border border-slate-100 px-2 py-1.5">
                              <span className="text-slate-700">{d.dimensionLabel}</span>
                              <span className="ml-2 font-medium text-slate-900">{d.rating ?? '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {showHomeroomComment && (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500 mb-1">{isZh ? '班主任评语' : 'Homeroom comment'}</div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{reportDetail.homeroomComment || (isZh ? '暂无' : 'N/A')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
                  </div>
                </>
              )}
            />
          </section>
        )}

        {!loading && canViewSchoolDashboard && tab === 'overview' && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '在读学生' : 'Active students'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.active}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '在读率' : 'Active rate'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.activeRate}%</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学部分布' : 'Division distribution'}</h3>
                <ul className="space-y-1 text-sm">
                  {learningStats.byDivision.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-slate-700">{k}</span>
                      <span className="text-slate-500">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '年级分布' : 'Grade distribution'}</h3>
                <ul className="space-y-1 text-sm">
                  {learningStats.byGrade.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-slate-700">{k}</span>
                      <span className="text-slate-500">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6">
              <h3 className="text-base font-semibold text-slate-800 mb-3">{isZh ? '权限说明' : 'Permission reference'}</h3>
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-slate-100 text-left text-xs text-slate-600">
                      <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '角色' : 'Role'}</th>
                      <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '班级整体概览' : 'Class overview'}</th>
                      <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '学生概览' : 'Student overview'}</th>
                      <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '报告填写' : 'Report entry'}</th>
                      <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '学生学业报告' : 'Student report'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentCenterPermissionMatrix.map((row) => (
                      <tr key={row.role} className="border-t border-slate-100">
                        <td className="py-2 px-2 font-medium text-slate-800 whitespace-nowrap">{row.role}</td>
                        <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.classOverview}</td>
                        <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.studentOverview}</td>
                        <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.reportEntry}</td>
                        <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.studentReport}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {!loading && canAccessAcademicReportsTab && tab === 'academic-reports' && (
          <section className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="text-sm text-slate-600">
                {workbenchAdminViewing
                  ? isZh
                    ? '选择教师后，可只读查看其负责的班级学业报告、学业质量评价、班级整体分析与个别学生分析完成情况。'
                    : 'Select a teacher to view assigned classes, quality evaluation, class analysis, individual student notes, and completion (read-only).'
                  : isZh
                    ? '先选择本次学业报告，再查看你需要完成的班级与实时进度。'
                    : 'Select a report first, then work through your assigned classes with live progress.'}
              </div>
              <FilterToolbar>
                <AcademicYearSelect
                  isZh={isZh}
                  years={years}
                  value={currentYearId || ''}
                  onChange={(id) => {
                    workbenchManualPickRef.current = false;
                    setCurrentYearId(id || null);
                  }}
                  allowEmpty
                  emptyLabel={isZh ? '选择学年' : 'Select year'}
                />
                <TermSelect
                  isZh={isZh}
                  value={reportTerm}
                  onChange={(next) => {
                    workbenchManualPickRef.current = false;
                    setReportTerm(next);
                  }}
                />
                <FilterSelect
                  width="report"
                  value={workbenchTemplateId}
                  onChange={(e) => {
                    workbenchManualPickRef.current = true;
                    setWorkbenchTemplateId(e.target.value);
                  }}
                >
                  <option value="">{isZh ? '选择学业报告' : 'Select report'}</option>
                  {workbenchTemplates
                    .filter((tpl) => !!tpl.id)
                    .map((tpl) => (
                      <option key={tpl.id as string} value={tpl.id as string}>
                        {tpl.title || (isZh ? '未命名评价' : 'Untitled evaluation')}
                      </option>
                    ))}
                </FilterSelect>
                {workbenchAdminViewing ? (
                  <FilterSelect
                    width="teacher"
                    value={adminViewTeacherId}
                    onChange={(e) => setAdminViewTeacherId(e.target.value)}
                    disabled={!workbenchTemplateId || adminViewTeachers.length === 0}
                  >
                    <option value="">{isZh ? '选择教师' : 'Select teacher'}</option>
                    {adminViewTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </FilterSelect>
                ) : null}
                {workbenchReadOnly ? (
                  <span className="inline-flex h-10 items-center rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800">
                    {workbenchAdminViewing
                      ? isZh
                        ? '管理员只读查看'
                        : 'Admin read-only view'
                      : isZh
                        ? '当前为只读模式（已停发）'
                        : 'Read-only mode (stopped)'}
                  </span>
                ) : null}
              </FilterToolbar>
              {workbenchError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {workbenchError}
                </div>
              )}
              {workbenchLoading && (
                <div className="text-sm text-slate-500">{isZh ? '加载进度中…' : 'Loading progress…'}</div>
              )}
              {!workbenchLoading && workbenchTemplateId && workbenchProgress &&
                (workbenchProgress.subjectProgress || workbenchProgress.homeroomProgress) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-700 space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {isZh ? '分项进度' : 'Breakdown'}
                  </div>
                  {workbenchProgress.subjectProgress ? (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-700">
                        <span className="font-medium text-slate-800">{isZh ? '学科报告' : 'Subject reports'}</span>
                        <span className="text-emerald-700">
                          {isZh ? `已完成：${workbenchProgress.subjectProgress.completedStudents}` : `Done: ${workbenchProgress.subjectProgress.completedStudents}`}
                        </span>
                        <span className="text-amber-700">
                          {isZh ? `待完成：${workbenchProgress.subjectProgress.pendingStudents}` : `Pending: ${workbenchProgress.subjectProgress.pendingStudents}`}
                        </span>
                        <span>{isZh ? `完成率 ${workbenchProgress.subjectProgress.completionRate}%` : `${workbenchProgress.subjectProgress.completionRate}%`}</span>
                        <span className="text-slate-500">
                          ({isZh ? `共 ${workbenchProgress.subjectProgress.totalStudents} 人` : `${workbenchProgress.subjectProgress.totalStudents} students`})
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200/90 overflow-hidden">
                        <div
                          className="h-full bg-sky-500 transition-[width]"
                          style={{ width: `${Math.min(Math.max(workbenchProgress.subjectProgress.completionRate, 0), 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  {workbenchProgress.homeroomProgress ? (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-700">
                        <span className="font-medium text-slate-800">{isZh ? '班主任综合评价' : 'Homeroom evaluation'}</span>
                        <span className="text-emerald-700">
                          {isZh ? `已完成：${workbenchProgress.homeroomProgress.completedStudents}` : `Done: ${workbenchProgress.homeroomProgress.completedStudents}`}
                        </span>
                        <span className="text-amber-700">
                          {isZh ? `待完成：${workbenchProgress.homeroomProgress.pendingStudents}` : `Pending: ${workbenchProgress.homeroomProgress.pendingStudents}`}
                        </span>
                        <span>{isZh ? `完成率 ${workbenchProgress.homeroomProgress.completionRate}%` : `${workbenchProgress.homeroomProgress.completionRate}%`}</span>
                        <span className="text-slate-500">
                          ({isZh ? `共 ${workbenchProgress.homeroomProgress.totalStudents} 人` : `${workbenchProgress.homeroomProgress.totalStudents} students`})
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200/90 overflow-hidden">
                        <div
                          className="h-full bg-violet-500 transition-[width]"
                          style={{ width: `${Math.min(Math.max(workbenchProgress.homeroomProgress.completionRate, 0), 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {!workbenchLoading && !workbenchTemplateId && (
              <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
                {isZh ? '请选择一个已发布或已停发的学业报告后开始。' : 'Select a published or stopped report to begin.'}
              </div>
            )}

            {!workbenchLoading && workbenchTemplateId && workbenchAdminViewing && !adminViewTeacherId && (
              <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
                {isZh ? '请选择一位教师以查看其学业报告填写情况。' : 'Select a teacher to view their report entries.'}
              </div>
            )}

            {!workbenchLoading && workbenchTemplateId && workbenchProgress && workbenchActionableClasses.length === 0 && (
              <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
                {workbenchAdminViewing
                  ? isZh
                    ? '该教师在本报告下暂无岗位班级（任课或班主任）。'
                    : 'This teacher has no assigned classes for this report.'
                  : isZh
                    ? '当前报告下没有分配到你需要填写的班级。'
                    : 'No assigned classes for this report.'}
              </div>
            )}

            {!workbenchLoading && workbenchTemplateDetail && workbenchClassId && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                <div ref={workbenchPdfExportRef} id="workbench-pdf-export-root" className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                  <span className="text-sm font-semibold text-slate-800 shrink-0 inline-flex h-9 items-center leading-none">
                    {isZh ? '学业报告' : 'Academic report'}
                  </span>
                  <MenuSelect
                    value={workbenchClassId}
                    onChange={(e) => setWorkbenchClassId(e.target.value)}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-sm leading-none bg-white min-w-[120px]"
                    aria-label={isZh ? '班级' : 'Class'}
                  >
                    {workbenchActionableClasses.map((c) => (
                      <option key={c.classId} value={c.classId}>
                        {workbenchClassShortLabel(c)}
                      </option>
                    ))}
                  </MenuSelect>
                  <MenuSelect
                    value={workbenchSubjectKey}
                    onChange={(e) => setWorkbenchSubjectKey(e.target.value)}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-sm leading-none bg-white min-w-[240px] max-w-[min(100%,420px)]"
                    aria-label={isZh ? '学科或班主任' : 'Subject or homeroom'}
                  >
                    {workbenchTemplateDetail.subjects
                      .filter((s) => workbenchClassProgressItem?.requiredSubjectKeys.includes(s.subjectKey))
                      .map((s) => (
                        <option key={s.subjectKey} value={s.subjectKey}>
                          {workbenchSubjectModuleLabel(s, isZh)}
                        </option>
                      ))}
                    {workbenchHomeroomOptionAvailable ? (
                      <option value={WORKBENCH_HOMEROOM_SENTINEL}>
                        {isZh ? '班主任综合评价' : 'Homeroom comprehensive evaluation'}
                      </option>
                    ) : null}
                  </MenuSelect>
                  {workbenchDisplayTeacherName ? (
                    <span className="text-sm text-slate-600 shrink-0 inline-flex h-9 items-center leading-none">
                      {isZh ? `教师：${workbenchDisplayTeacherName}` : `Teacher: ${workbenchDisplayTeacherName}`}
                    </span>
                  ) : null}
                </div>

                {!workbenchSubjectKey ? (
                  <p className="text-sm text-slate-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4">
                    {isZh
                      ? '当前班级在本学期学业报告中没有你需要填写的学科，请选择其他班级。'
                      : 'No subjects assigned for this class in this report; please choose another class.'}
                  </p>
                ) : isWorkbenchHomeroomMode(workbenchSubjectKey) ? (
                  <>
                    <div id="workbench-pdf-homeroom-block" className="rounded-lg border border-slate-200 p-3 space-y-2">
                      <div className="text-sm font-medium text-slate-800">
                        {isZh ? '班主任综合评价' : 'Homeroom comprehensive evaluation'}
                      </div>
                      <p className="text-xs text-slate-500">
                        {isZh
                          ? '为每位学生填写班主任综合评价；可随时保存当前进度，全部填齐后进度将显示为完成。保存后写入本学期学业报告。'
                          : 'Enter homeroom evaluations for each student; save anytime to keep progress. When everyone is filled, progress shows complete. Saved to this term report.'}
                      </p>
                      <div className="space-y-2 max-h-[28rem] overflow-y-auto" data-workbench-pdf-scroll>
                        {workbenchStudentDrafts.map((row) => (
                          <div
                            key={row.studentId}
                            data-workbench-pdf-comment-row={row.studentId}
                            className="grid grid-cols-1 items-start gap-2 md:grid-cols-5"
                          >
                            <div className="shrink-0 pt-2 text-sm leading-snug text-slate-700 md:col-span-1">{row.studentName}</div>
                            <div className="md:col-span-4 min-h-0" data-workbench-pdf-text-box>
                              <textarea
                                value={row.homeroomComment}
                                onChange={(e) =>
                                  setWorkbenchStudentDrafts((prev) =>
                                    prev.map((r) => (r.studentId === row.studentId ? { ...r, homeroomComment: e.target.value } : r)),
                                  )
                                }
                                style={{ minHeight: WORKBENCH_HOMEROOM_COMMENT_TEXTAREA_MIN_PX }}
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                disabled={workbenchReadOnly}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : workbenchSubject ? (
                  <>
                    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                      <div className="text-sm font-medium text-slate-800">
                        {isZh ? '学业质量评价' : 'Academic quality evaluation'}
                      </div>
                      {workbenchIsExamSubject && (
                        <div
                          id="workbench-pdf-auto-analysis"
                          data-academic-report-pdf-scope
                          className="rounded border border-slate-200 bg-slate-50/90 p-2 text-xs text-slate-700 space-y-2"
                        >
                          <table className="w-full table-fixed border border-slate-200 border-collapse bg-white rounded overflow-hidden">
                            <colgroup>
                              {Array.from({ length: 7 }).map((_, i) => (
                                <col key={i} style={{ width: `${100 / 7}%` }} />
                              ))}
                            </colgroup>
                            <tbody>
                              <tr className="bg-slate-100">
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  {isZh ? '平均分' : 'Mean'}
                                </th>
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  {isZh ? '标准差' : 'Std dev'}
                                </th>
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  {isZh ? '中位数' : 'Median'}
                                </th>
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                                    <span>{isZh ? '优秀率' : 'Exc.'}</span>
                                    <span className="text-[10px] text-slate-500 font-normal">
                                      {isZh ? '（得分率≥85%）' : '(score rate ≥85%)'}
                                    </span>
                                  </div>
                                </th>
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                                    <span>{isZh ? '良好率' : 'Good'}</span>
                                    <span className="text-[10px] text-slate-500 font-normal">
                                      {isZh ? '（得分率≥75%）' : '(score rate ≥75%)'}
                                    </span>
                                  </div>
                                </th>
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                                    <span>{isZh ? '及格率' : 'Pass'}</span>
                                    <span className="text-[10px] text-slate-500 font-normal">
                                      {isZh ? '（得分率≥60%）' : '(score rate ≥60%)'}
                                    </span>
                                  </div>
                                </th>
                                <th className="min-w-0 h-14 px-2 py-0 border-b border-slate-200 text-center text-xs font-medium align-middle">
                                  <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                                    <span>{isZh ? '学弱率' : 'Weak'}</span>
                                    <span className="text-[10px] text-slate-500 font-normal">
                                      {isZh ? '（得分率<35%）' : '(score rate <35%)'}
                                    </span>
                                  </div>
                                </th>
                              </tr>
                              <tr>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.avgScore}
                                </td>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.stdScore}
                                </td>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.medianScore}
                                </td>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.excellentRate}%
                                </td>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.goodRate}%
                                </td>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.passRate}%
                                </td>
                                <td className="min-w-0 h-14 px-2 py-0 text-center text-xs tabular-nums border-b border-slate-100 align-middle">
                                  {workbenchScoreStats.weakRate}%
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div className="pt-2">
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                              <div className="text-xs font-medium text-slate-600 mb-2">
                                {isZh ? '分段人数（得分率 %）' : 'Count by score rate (%)'}
                              </div>
                              <div className="rounded-md border border-slate-200/90 bg-slate-100/70 px-3 py-3">
                                <div className="flex items-end justify-center gap-3 sm:gap-4 min-h-[132px] px-0.5">
                                  {workbenchScoreStats.bins.map((b) => (
                                    <div
                                      key={b.labelZh}
                                      className="flex w-[52px] shrink-0 flex-col items-stretch"
                                    >
                                      <div className="flex h-7 shrink-0 items-center justify-center">
                                        <span className="text-sm font-semibold tabular-nums leading-none text-slate-800">
                                          {b.count}
                                        </span>
                                      </div>
                                      <div className="mx-auto flex h-28 w-[15px] shrink-0 flex-col justify-end">
                                        <div
                                          className="w-full rounded-t bg-sky-600 min-h-[2px] transition-[height]"
                                          style={{ height: `${b.barPct}%` }}
                                        />
                                      </div>
                                      <div className="flex min-h-[2.25rem] shrink-0 items-start justify-center px-0.5 pt-1">
                                        <span className="text-center text-[11px] leading-tight text-slate-600">
                                          {isZh ? b.labelZh : b.labelEn}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="overflow-x-auto rounded-lg border border-slate-200" data-workbench-pdf-hscroll>
                        <table
                          className={`w-full border-collapse text-xs leading-normal ${
                            workbenchIsExamSubject ? 'min-w-[820px]' : 'min-w-[520px]'
                          }`}
                        >
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-2 py-[0.4rem] text-center align-middle font-medium">{isZh ? '学生' : 'Student'}</th>
                              {workbenchSubject.dimensions.map((d) => (
                                <th key={d.id} className="px-2 py-[0.4rem] text-center align-middle font-medium">
                                  {d.dimensionLabel}
                                </th>
                              ))}
                              {workbenchIsExamSubject ? (
                                <th className="px-2 py-[0.4rem] text-center align-middle font-medium">
                                  {isZh ? '测评成绩' : 'Assessment score'}
                                  <span className="text-slate-500 font-normal">
                                    {isZh ? `（满分${workbenchScoreRules.totalMax}）` : ` (max ${workbenchScoreRules.totalMax})`}
                                  </span>
                                </th>
                              ) : null}
                              <th className="px-2 py-[0.4rem] text-center align-middle font-medium">{isZh ? '学习品质' : 'Learning quality'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {workbenchStudentDrafts.map((row, idx) => {
                              const total = row.subject.finalScore;
                              const totalGradeFine = workbenchExamLetterGrade(total, workbenchScoreRules);
                              return (
                                <tr key={row.studentId} className="border-t border-slate-100">
                                  <td className="px-2 py-[0.4rem] align-middle text-center text-slate-800 font-medium">
                                    {row.studentName}
                                  </td>
                                  {workbenchSubject.dimensions.map((d) => {
                                    const dimRating = (row.subject.dimensions.find((x) => x.dimensionKey === d.dimensionKey)?.rating ??
                                      'A') as TargetLevel;
                                    return (
                                      <td key={d.id} className="px-2 py-[0.4rem] align-middle text-center">
                                        <MenuSelect
                                          value={dimRating}
                                          onChange={(e) =>
                                            setWorkbenchStudentDrafts((prev) =>
                                              prev.map((r, rIdx) =>
                                                rIdx !== idx
                                                  ? r
                                                  : {
                                                      ...r,
                                                      subject: {
                                                        ...r.subject,
                                                        dimensions: r.subject.dimensions.map((x) =>
                                                          x.dimensionKey === d.dimensionKey
                                                            ? { ...x, rating: e.target.value as TargetLevel }
                                                            : x,
                                                        ),
                                                      },
                                                    },
                                              ),
                                            )
                                          }
                                          className="mx-auto h-[1.6rem] min-w-[2.75rem] rounded border border-slate-300 px-1 text-center text-xs font-semibold leading-none text-slate-800"
                                          disabled={workbenchReadOnly}
                                          title={isZh ? '过程性目标维度等第，默认 A' : 'Process dimension level, default A'}
                                        >
                                          <option value="A">A</option>
                                          <option value="B">B</option>
                                          <option value="C">C</option>
                                          <option value="D">D</option>
                                        </MenuSelect>
                                      </td>
                                    );
                                  })}
                                  {workbenchIsExamSubject ? (
                                    <td className="px-2 py-[0.4rem] align-middle text-center text-slate-700">
                                      <div className="inline-flex items-center justify-center gap-1.5">
                                        <input
                                          type="number"
                                          min={0}
                                          max={workbenchScoreRules.totalMax}
                                          step={0.5}
                                          value={total ?? ''}
                                          onChange={(e) => {
                                            const v = e.target.value.trim();
                                            const next = v === '' ? null : Number(v);
                                            setWorkbenchStudentDrafts((prev) =>
                                              prev.map((r, rIdx) => {
                                                if (rIdx !== idx) return r;
                                                const finalScore =
                                                  next !== null && Number.isFinite(next)
                                                    ? Math.min(workbenchScoreRules.totalMax, Math.max(0, next))
                                                    : null;
                                                return {
                                                  ...r,
                                                  subject: { ...r.subject, finalScore, examDimensionScores: null },
                                                };
                                              }),
                                            );
                                          }}
                                          className="h-[1.6rem] w-14 rounded border border-slate-300 px-1 text-center text-xs leading-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                          disabled={workbenchReadOnly}
                                        />
                                        {totalGradeFine ? (
                                          <span className="text-xs font-medium text-slate-600 tabular-nums">{totalGradeFine}</span>
                                        ) : null}
                                      </div>
                                    </td>
                                  ) : null}
                                  <td className="px-2 py-[0.4rem] align-middle text-center">
                                    <MenuSelect
                                      value={row.subject.learningQualityGrade ?? 'A'}
                                      onChange={(e) =>
                                        setWorkbenchStudentDrafts((prev) =>
                                          prev.map((r, rIdx) =>
                                            rIdx !== idx
                                              ? r
                                              : {
                                                  ...r,
                                                  subject: {
                                                    ...r.subject,
                                                    learningQualityGrade: (['A', 'B', 'C', 'D'].includes(e.target.value)
                                                      ? e.target.value
                                                      : 'A') as TargetLevel,
                                                  },
                                                },
                                          ),
                                        )
                                      }
                                      className="mx-auto h-[1.6rem] min-w-[2.75rem] rounded border border-slate-300 px-1 text-center text-xs font-semibold leading-none text-slate-800"
                                      disabled={workbenchReadOnly}
                                    >
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                      <option value="D">D</option>
                                    </MenuSelect>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div id="workbench-pdf-section-class-analysis" className="rounded-lg border border-slate-200 p-3 space-y-2">
                      <div className="text-sm font-medium text-slate-800">
                        {isZh ? '班级整体分析' : 'Class overall analysis'}
                      </div>
                      <p className="text-xs text-amber-700">
                        {isZh
                          ? '不纳入学生的学业报告，仅供班主任从学科视角了解本班情况。'
                          : 'Not included in student reports—for homeroom teachers to understand this class from the subject teacher’s perspective.'}
                      </p>
                      <WorkbenchAutoGrowTextarea
                        value={workbenchClassOverallAnalysis}
                        onChange={setWorkbenchClassOverallAnalysis}
                        disabled={workbenchReadOnly}
                        ariaLabel={isZh ? '班级整体分析' : 'Class overall analysis'}
                      />
                    </div>

                    <div id="workbench-pdf-section-student-analysis" className="rounded-lg border border-slate-200 p-3 space-y-2">
                      <div className="text-sm font-medium text-slate-800">
                        {isZh ? '个别学生分析' : 'Individual student analysis'}
                      </div>
                      <p className="text-xs text-amber-700">
                        {isZh
                          ? '重点关注学困/学优/波动大学生。不纳入学生的学业报告，仅供班主任与学科教师了解学生情况。'
                          : 'Focus on struggling, high-performing, and high-variance students. Not in student reports—for homeroom and subject teachers to understand students.'}
                      </p>
                      <div
                        className="overflow-x-auto overflow-y-auto rounded-lg border border-slate-200"
                        style={{ maxHeight: WORKBENCH_STUDENT_ANALYSIS_SCROLL_MAX_PX }}
                        data-workbench-pdf-scroll
                      >
                        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
                          <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
                            <tr className="border-b border-slate-200">
                              <th className="w-[14%] min-w-[5rem] px-2 py-2 text-left align-middle text-xs font-medium text-slate-700">
                                {isZh ? '学生' : 'Student'}
                              </th>
                              <th className="w-[43%] px-2 py-2 text-left align-middle text-xs font-medium text-slate-700">
                                {isZh ? '学情分析' : 'Learning analysis'}
                              </th>
                              <th className="w-[43%] px-2 py-2 text-left align-middle text-xs font-medium text-slate-700">
                                {isZh ? '支持计划' : 'Support plan'}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {workbenchStudentAnalysisRows.map((row) => {
                              const name =
                                workbenchStudentDrafts.find((s) => s.studentId === row.studentId)?.studentName ?? row.studentId;
                              return (
                                <tr key={row.studentId} className="border-t border-slate-100 first:border-t-0 align-top">
                                  <td className="px-2 py-2 text-slate-800 font-medium text-sm whitespace-nowrap">
                                    {name}
                                  </td>
                                  <td className="px-2 py-2">
                                    <WorkbenchAutoGrowTextarea
                                      compact
                                      value={row.learningAnalysis}
                                      onChange={(next) =>
                                        setWorkbenchStudentAnalysisRows((prev) =>
                                          prev.map((x) =>
                                            x.studentId === row.studentId ? { ...x, learningAnalysis: next } : x,
                                          ),
                                        )
                                      }
                                      disabled={workbenchReadOnly}
                                      ariaLabel={isZh ? `${name} 学情分析` : `${name} learning analysis`}
                                    />
                                  </td>
                                  <td className="px-2 py-2">
                                    <WorkbenchAutoGrowTextarea
                                      compact
                                      value={row.supportPlan}
                                      onChange={(next) =>
                                        setWorkbenchStudentAnalysisRows((prev) =>
                                          prev.map((x) =>
                                            x.studentId === row.studentId ? { ...x, supportPlan: next } : x,
                                          ),
                                        )
                                      }
                                      disabled={workbenchReadOnly}
                                      ariaLabel={isZh ? `${name} 支持计划` : `${name} support plan`}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </>
                ) : null}
                </div>
                {(isWorkbenchHomeroomMode(workbenchSubjectKey) || workbenchSubject) && (
                  <div className="flex flex-col gap-2 pt-3 border-t border-slate-200 sm:flex-row sm:items-center sm:gap-3">
                    {workbenchSaveHint && (
                      <div className="order-2 min-w-0 flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm leading-snug text-amber-900 sm:order-1">
                        {workbenchSaveHint}
                      </div>
                    )}
                    <div
                      className={`flex flex-wrap gap-2 sm:shrink-0 ${workbenchSaveHint ? 'order-1 justify-end sm:order-2' : 'w-full justify-end'}`}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void exportWorkbenchReportPdf()}
                        disabled={workbenchPdfExporting || workbenchSaving}
                      >
                        {workbenchPdfExporting
                          ? isZh
                            ? '导出中…'
                            : 'Exporting…'
                          : isZh
                            ? '导出为PDF'
                            : 'Export PDF'}
                      </Button>
                      {!workbenchAdminViewing ? (
                        <Button
                          size="sm"
                          onClick={() => void saveWorkbenchClassReport()}
                          disabled={workbenchSaving || workbenchPdfExporting || workbenchReadOnly}
                        >
                          {workbenchSaving
                            ? isZh
                              ? '保存中…'
                              : 'Saving…'
                            : isWorkbenchHomeroomMode(workbenchSubjectKey)
                              ? isZh
                                ? '保存班主任评价'
                                : 'Save homeroom comments'
                              : isZh
                                ? '保存当前学业报告'
                                : 'Save current report'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {!loading && !isStudentSelf && tab === 'my-students' && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-3 lg:col-span-2 flex flex-col gap-3 min-h-0">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{isZh ? '班级' : 'Class'}</label>
                  <MenuSelect
                    value={selectedClassId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedClassId(id);
                      setSelectedStudentId('');
                      setMyStudentsLensTab('overview');
                      const rec = myStudentsClassOptions.find((c) => c.id === id);
                      if (rec?.academicYearId) setCurrentYearId(rec.academicYearId);
                    }}
                    className="w-full h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white"
                  >
                    {myStudentsClassOptions.length === 0 ? (
                      <option value="">{isZh ? '暂无可用班级' : 'No classes'}</option>
                    ) : (
                      myStudentsClassOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {workbenchClassShortLabel({ className: c.name, grade: c.grade })}
                        </option>
                      ))
                    )}
                  </MenuSelect>
                </div>
                <div className="min-h-0 flex flex-col">
                  <h3 className="text-sm font-semibold text-slate-800 mb-2 shrink-0">{isZh ? '学生' : 'Students'}</h3>
                  <div className="space-y-2 max-h-[520px] overflow-y-auto flex-1">
                    {myStudents.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                      onClick={() => {
                        setSelectedStudentId((prev) => (prev === s.id ? '' : s.id));
                        setMyStudentsLensTab('overview');
                      }}
                        className={`w-full text-center rounded-lg border px-3 py-2 text-sm ${
                          selectedStudentId === s.id
                            ? 'border-sky-400 bg-sky-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-medium text-slate-800">{s.nameZh || s.name}</div>
                      </button>
                    ))}
                    {selectedClassId && myStudents.length === 0 && (
                      <div className="text-xs text-slate-500">{isZh ? '该班暂无学生' : 'No students in this class.'}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 lg:col-span-10 min-h-0">
                {!selectedStudent ? (
                  <div className="space-y-4">
                    {!canViewMyStudentsClassAggregate ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600">
                        {isZh
                          ? '请选择左侧学生，查看个人概览与学业报告。'
                          : 'Select a student on the left to view their overview and academic report.'}
                      </div>
                    ) : (
                      renderClassOverviewPanel()
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <PortraitLensWorkspace
                      isZh={isZh}
                      activeTab={myStudentsLensTab}
                      onTabChange={setMyStudentsLensTab}
                      renderOverview={renderStudentOverviewPanel}
                      renderAcademic={() => (
                        <div id="term-report-panel" className="border border-slate-200 rounded-xl p-3 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {reportLoading && (
                              <span className="text-xs text-slate-500 ml-auto">{isZh ? '加载中…' : 'Loading…'}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-stretch gap-2">
                            <MenuSelect
                              value={
                                releasedReportPickOptions.some(
                                  (o) => o.key === `${currentYearId ?? ''}::${reportTerm}::${selectedTemplateId}`,
                                )
                                  ? `${currentYearId ?? ''}::${reportTerm}::${selectedTemplateId}`
                                  : ''
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                const opt = releasedReportPickOptions.find((o) => o.key === v);
                                if (!opt) return;
                                setCurrentYearId(opt.academicYearId);
                                setReportTerm(opt.term);
                                setSelectedTemplateId(opt.templateId);
                              }}
                              disabled={releasedReportPickOptions.length === 0}
                              className="h-9 min-w-0 flex-1 max-w-xl rounded-lg border border-slate-300 px-3 text-sm bg-white disabled:opacity-60"
                            >
                              {releasedReportPickOptions.length === 0 ? (
                                <option value="">
                                  {isZh ? '暂无已正式推送的学业报告' : 'No released academic reports'}
                                </option>
                              ) : (
                                releasedReportPickOptions.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.label}
                                  </option>
                                ))
                              )}
                            </MenuSelect>
                            <Button
                              type="button"
                              variant="default"
                              size="default"
                              className="h-9 shrink-0 bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
                              onClick={() => void exportStudentReportPdf()}
                              disabled={
                                studentReportPdfExporting ||
                                reportLoading ||
                                !selectedStudent ||
                                !selectedTemplateId ||
                                !reportDetail ||
                                releasedReportPickOptions.length === 0
                              }
                            >
                              {studentReportPdfExporting
                                ? isZh
                                  ? '导出中…'
                                  : 'Exporting…'
                                : isZh
                                  ? '导出为 PDF'
                                  : 'Export PDF'}
                            </Button>
                          </div>

                          {reportLoading ? (
                            <p className="text-sm text-slate-500 py-4">{isZh ? '加载中…' : 'Loading…'}</p>
                          ) : releasedReportPickOptions.length === 0 ? (
                            <p className="text-sm text-slate-500 py-4">
                              {isZh ? '暂无成绩报告' : 'No academic report available'}
                            </p>
                          ) : (
                          <div
                            ref={studentReportPdfExportRef}
                            id="student-report-pdf-modules"
                            data-academic-report-pdf-scope
                            className="space-y-[0.9rem]"
                          >
                            {reportDetail &&
                              reportDetail.subjectReports.some((s) => (s.dimensions ?? []).length > 0) && (
                                <div
                                  data-student-report-pdf-module
                                  className="rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-[9px] space-y-1.5 flex flex-col justify-center"
                                >
                                  <div className="text-xs font-semibold text-slate-800 leading-none flex items-center min-h-[1.125rem]">
                                    {isZh ? '学业报告等第说明' : 'Academic report grading rubric'}
                                  </div>
                                  <div className="space-y-1 text-[11px] text-slate-700 leading-snug">
                                    {(['A', 'B', 'C', 'D'] as const).map((lv) => {
                                      const text = (academicYearRubric ?? fullUnifiedLevelTextFromPreset(null))[lv];
                                      return (
                                        <div key={lv} className="flex items-center gap-1.5 break-words m-0 py-[2px]">
                                          <span className="font-semibold text-slate-800 shrink-0 leading-none">{lv}</span>
                                          <span className="text-slate-500 shrink-0 leading-none"> · </span>
                                          <span className="min-w-0 leading-snug">{text}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                            {!reportDetail || reportDetail.subjectReports.length === 0 ? (
                              <p className="text-sm text-slate-500">{isZh ? '暂无已完成报告。' : 'No completed report yet.'}</p>
                            ) : (
                              <div className="space-y-[1.125rem]">
                                {reportDetail.subjectReports.map((s) => {
                                  const subjectConfig = templateSubjectMap.get(s.subjectKey);
                                  const subjectTitle = subjectConfig
                                    ? workbenchSubjectModuleLabel(subjectConfig, isZh)
                                    : s.subjectName || (isZh ? '未命名学科' : 'Untitled subject');
                                  const finalGrade = resolveSubjectAssessmentGrade(
                                    s,
                                    reportTemplate,
                                    reportYearExamPreset,
                                    reportStudentGradeCatalogId,
                                  );
                                  return (
                                    <div key={s.subjectKey} data-student-report-pdf-module>
                                      <div className="text-sm font-semibold text-slate-800">{subjectTitle}</div>
                                      <div className="mt-1.5 overflow-x-auto rounded-lg border border-slate-200">
                                        <table className="w-full min-w-[280px] border-collapse text-xs">
                                          <tbody>
                                            {s.dimensions.map((dim) => (
                                              <tr key={dim.id} className="bg-white">
                                                <td className="border border-slate-200 p-0 align-middle">
                                                  <div className="flex min-h-[1.8rem] w-full items-center px-2 py-[3px] text-sm font-normal text-slate-800 leading-tight">
                                                    {dim.dimensionLabel}
                                                  </div>
                                                </td>
                                                <td className="border border-slate-200 p-0 align-middle w-[7.5rem] bg-white">
                                                  <div className="flex min-h-[1.8rem] w-full items-center justify-center px-2 py-[3px] text-center text-sm font-semibold text-slate-800 leading-none">
                                                    {dim.rating ?? '—'}
                                                  </div>
                                                </td>
                                              </tr>
                                            ))}
                                            {subjectConfig?.enableLearningQuality !== false ? (
                                              <tr
                                                className={`bg-slate-50/95 ${s.dimensions.length > 0 ? 'border-t-2 border-slate-300' : ''}`}
                                              >
                                                <td className="border border-slate-200 p-0 align-middle bg-slate-50/95">
                                                  <div className="flex min-h-[1.9rem] w-full items-center px-2 py-[4px] text-sm font-medium text-slate-800 leading-tight">
                                                    {isZh ? '学习品质：兴趣、习惯与态度' : 'Learning quality: interest, habits, attitude'}
                                                  </div>
                                                </td>
                                                <td className="border border-slate-200 p-0 align-middle w-[7.5rem] bg-slate-50/95">
                                                  <div className="flex min-h-[1.9rem] w-full items-center justify-center px-2 py-[4px] text-center text-sm font-semibold text-slate-800 leading-none">
                                                    {s.learningQualityGrade ?? '—'}
                                                  </div>
                                                </td>
                                              </tr>
                                            ) : null}
                                            {subjectShowsAssessmentScore(
                                              s.subjectKey,
                                              reportTemplate,
                                              reportStudentGradeCatalogId,
                                            ) ? (
                                              <tr
                                                className={`bg-slate-100/80 ${
                                                  subjectConfig?.enableLearningQuality !== false
                                                    ? 'border-t border-slate-300'
                                                    : s.dimensions.length > 0
                                                      ? 'border-t-2 border-slate-300'
                                                      : ''
                                                }`}
                                              >
                                                <td className="border border-slate-200 p-0 align-middle bg-slate-100/80">
                                                  <div className="flex min-h-[1.9rem] w-full items-center px-2 py-[4px] text-sm font-medium text-slate-800 leading-tight">
                                                    {isZh ? '测评成绩' : 'Assessment'}
                                                  </div>
                                                </td>
                                                <td className="border border-slate-200 p-0 align-middle w-[7.5rem] bg-slate-100/80">
                                                  <div className="flex min-h-[1.9rem] w-full items-center justify-center px-2 py-[4px] text-center text-sm font-semibold text-slate-800 leading-none">
                                                    {finalGrade}
                                                  </div>
                                                </td>
                                              </tr>
                                            ) : null}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {reportDetail && showHomeroomComment && (
                              <div data-student-report-pdf-module className="space-y-[7px]">
                                <div className="text-sm font-semibold text-slate-800">
                                  {isZh ? '班主任综合评价' : 'Homeroom comprehensive evaluation'}
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-[7px]">
                                  <div
                                    data-student-report-pdf-body-text
                                    className="flex min-h-[2.025rem] w-full items-center text-sm text-slate-700 leading-tight whitespace-pre-wrap"
                                  >
                                    {reportDetail.homeroomComment?.trim() || (isZh ? '暂无' : 'N/A')}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          )}
                        </div>
                      )}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

