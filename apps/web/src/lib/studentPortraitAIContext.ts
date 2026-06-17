import type {
  ExamSubjectTrendSeries,
  ReportSubjectScoreScaleSet,
  StudentSubjectInsightItem,
} from './studentPortraitOverview';
import {
  appendReportSubjectScoreScalesBlock,
  formatScoreWithFullMark,
  scaleForSubjectKey,
} from './studentPortraitOverview';

export type StudentPortraitAIView =
  | 'school-dashboard'
  | 'my-students-class-overview'
  | 'my-students-student-overview'
  | 'report-entry'
  | 'student-self'
  | 'idle';

export type StudentPortraitClassInsightPayload = {
  totalStudents: number;
  completedStudents: number;
  completionRate: number;
  homeroomCompleted: number;
  homeroomCompletionRate: number;
  subjectScoreAverages: Array<{ subject: string; avg: number; count: number }>;
  levelCounts: { A: number; B: number; C: number; D: number };
};

export type StudentPortraitAIPayload = {
  view: StudentPortraitAIView;
  tabLabel?: string;
  academicYearName?: string | null;
  className?: string | null;
  classGrade?: number | null;
  studentName?: string | null;
  reportLabel?: string | null;
  classInsight?: StudentPortraitClassInsightPayload | null;
  subjectAnalyses?: Array<{
    subjectName: string;
    teacherName: string | null;
    classOverallAnalysis: string | null;
  }>;
  classStudentSummaries?: Array<{
    name: string;
    subjects: Array<{
      subjectName: string;
      finalScore: number | null;
      learningQualityGrade: string | null;
    }>;
    homeroomComment: string | null;
  }>;
  subjectInsights?: StudentSubjectInsightItem[];
  examTrends?: ExamSubjectTrendSeries[];
  homeroomComment?: string | null;
  latestReportLabel?: string | null;
  latestReportSubjects?: Array<{
    subjectKey: string;
    subjectName: string;
    finalScore: number | null;
    finalGrade: string | null;
    learningQualityGrade: string | null;
    teacherComment: string | null;
  }>;
  /** 当前聚焦学业报告下的考试学科满分（随报告/学期变化，非全学年统一） */
  subjectScoreScaleSet?: ReportSubjectScoreScaleSet | null;
};

function clip(text: string | null | undefined, max = 400): string {
  const s = String(text ?? '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function studentDisplayName(input: {
  nameZh?: string | null;
  nameEn?: string | null;
  name?: string | null;
}): string {
  const zh = (input.nameZh ?? '').trim();
  const en = (input.nameEn ?? '').trim();
  const fb = (input.name ?? '').trim();
  return zh && en ? `${zh} ${en}` : zh || en || fb || '—';
}

export function buildStudentPortraitAIPayload(input: {
  tab: string;
  isStudentSelf: boolean;
  selectedStudentId: string;
  myStudentsLensTab: string;
  selectedClassRecord: { name: string; grade: number } | null;
  schoolCurrentYearName: string | null;
  selectedStudent: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    currentGrade?: number | null;
  } | null;
  selectedClassReportOption: { label: string } | null;
  classAcademicInsight: StudentPortraitClassInsightPayload;
  classSubjectAnalysesFilled: Array<{
    subjectName: string;
    teacherName: string | null;
    classOverallAnalysis: string | null;
  }>;
  classReportSnapshotItems: Array<{
    student: { name?: string | null; nameZh?: string | null; nameEn?: string | null };
    report: {
      homeroomComment?: string | null;
      subjectReports: Array<{
        subjectName?: string;
        subjectKey?: string;
        finalScore?: number | null;
        learningQualityGrade?: string | null;
      }>;
    };
  }>;
  overviewSubjectInsights: StudentSubjectInsightItem[];
  overviewTrendSeries: ExamSubjectTrendSeries[];
  overviewLatestSnapshot: {
    meta: { label: string };
    report: {
      homeroomComment?: string | null;
      subjectReports: Array<{
        subjectName?: string;
        subjectKey?: string;
        finalScore?: number | null;
        finalGrade?: string | null;
        learningQualityGrade?: string | null;
        teacherComment?: string | null;
      }>;
    };
  } | null;
  subjectScoreScaleSet: ReportSubjectScoreScaleSet | null;
  tabLabels: { school: string; myStudents: string; reportEntry: string };
  isZh: boolean;
}): StudentPortraitAIPayload {
  if (input.isStudentSelf) {
    return {
      view: 'student-self',
      tabLabel: input.tabLabels.myStudents,
      studentName: input.selectedStudent ? studentDisplayName(input.selectedStudent) : null,
      subjectInsights: input.overviewSubjectInsights,
      examTrends: input.overviewTrendSeries,
      homeroomComment: input.overviewLatestSnapshot?.report.homeroomComment ?? null,
      latestReportLabel: input.overviewLatestSnapshot?.meta.label ?? null,
      latestReportSubjects: (input.overviewLatestSnapshot?.report.subjectReports ?? []).map((s) => ({
        subjectKey: s.subjectKey || s.subjectName || '—',
        subjectName: s.subjectName || s.subjectKey || '—',
        finalScore: s.finalScore ?? null,
        finalGrade: s.finalGrade ?? null,
        learningQualityGrade: s.learningQualityGrade ?? null,
        teacherComment: s.teacherComment ?? null,
      })),
      subjectScoreScaleSet: input.subjectScoreScaleSet,
    };
  }

  if (input.tab === 'overview') {
    return { view: 'school-dashboard', tabLabel: input.tabLabels.school };
  }

  if (input.tab === 'academic-reports') {
    return { view: 'report-entry', tabLabel: input.tabLabels.reportEntry };
  }

  if (input.tab === 'my-students' && input.selectedStudentId) {
    return {
      view: 'my-students-student-overview',
      tabLabel:
        input.myStudentsLensTab === 'academic'
          ? `${input.tabLabels.myStudents} · ${input.isZh ? '学业报告' : 'Academic report'}`
          : input.tabLabels.myStudents,
      academicYearName: input.schoolCurrentYearName,
      className: input.selectedClassRecord?.name ?? null,
      classGrade: input.selectedClassRecord?.grade ?? input.selectedStudent?.currentGrade ?? null,
      studentName: input.selectedStudent ? studentDisplayName(input.selectedStudent) : null,
      subjectInsights: input.overviewSubjectInsights,
      examTrends: input.overviewTrendSeries,
      homeroomComment: input.overviewLatestSnapshot?.report.homeroomComment ?? null,
      latestReportLabel: input.overviewLatestSnapshot?.meta.label ?? null,
      latestReportSubjects: (input.overviewLatestSnapshot?.report.subjectReports ?? []).map((s) => ({
        subjectKey: s.subjectKey || s.subjectName || '—',
        subjectName: s.subjectName || s.subjectKey || '—',
        finalScore: s.finalScore ?? null,
        finalGrade: s.finalGrade ?? null,
        learningQualityGrade: s.learningQualityGrade ?? null,
        teacherComment: s.teacherComment ?? null,
      })),
      subjectScoreScaleSet: input.subjectScoreScaleSet,
    };
  }

  if (input.tab === 'my-students' && !input.selectedStudentId) {
    return {
      view: 'my-students-class-overview',
      tabLabel: input.tabLabels.myStudents,
      academicYearName: input.schoolCurrentYearName,
      className: input.selectedClassRecord?.name ?? null,
      classGrade: input.selectedClassRecord?.grade ?? null,
      reportLabel: input.selectedClassReportOption?.label ?? null,
      classInsight: input.classAcademicInsight,
      subjectAnalyses: input.classSubjectAnalysesFilled.map((s) => ({
        subjectName: s.subjectName,
        teacherName: s.teacherName,
        classOverallAnalysis: s.classOverallAnalysis,
      })),
      classStudentSummaries: input.classReportSnapshotItems.map((item) => ({
        name: studentDisplayName(item.student),
        homeroomComment: item.report.homeroomComment ?? null,
        subjects: item.report.subjectReports.map((s) => ({
          subjectName: s.subjectName || s.subjectKey || '—',
          finalScore: s.finalScore ?? null,
          learningQualityGrade: s.learningQualityGrade ?? null,
        })),
      })),
      subjectScoreScaleSet: input.subjectScoreScaleSet,
    };
  }

  return { view: 'idle', tabLabel: input.tabLabels.myStudents };
}

export function buildStudentPortraitAIContextString(payload: StudentPortraitAIPayload, isZh: boolean): string {
  const L = (zh: string, en: string) => (isZh ? zh : en);
  let ctx = L('当前正在使用「学生中心」应用。\n', 'Current app: Student Center.\n');

  if (payload.tabLabel) {
    ctx += L(`当前标签页：${payload.tabLabel}\n`, `Current tab: ${payload.tabLabel}\n`);
  }
  if (payload.academicYearName) {
    ctx += L(`学年：${payload.academicYearName}\n`, `Academic year: ${payload.academicYearName}\n`);
  }

  if (payload.view === 'school-dashboard') {
    ctx += L(
      '用户正在查看学校看板（全校统计），暂无具体班级或学生明细。\n',
      'User is on the school dashboard (school-wide stats); no class/student detail.\n',
    );
    return ctx;
  }

  if (payload.view === 'report-entry') {
    ctx += L(
      '用户正在「报告填写」工作台，尚未聚焦到具体学生的概览界面。\n',
      'User is on the report entry workbench, not a student overview.\n',
    );
    return ctx;
  }

  if (payload.view === 'my-students-class-overview') {
    ctx += L('当前视图：我的学生 · 班级整体情况（未选中具体学生）\n', 'View: My Students · class overview (no student selected)\n');
    if (payload.className) {
      ctx += L(
        `班级：${payload.className}${payload.classGrade != null ? `（G${payload.classGrade}）` : ''}\n`,
        `Class: ${payload.className}${payload.classGrade != null ? ` (G${payload.classGrade})` : ''}\n`,
      );
    }
    if (payload.reportLabel) {
      ctx += L(`所选学业报告：${payload.reportLabel}\n`, `Selected report: ${payload.reportLabel}\n`);
    }
    ctx = appendReportSubjectScoreScalesBlock(ctx, payload.subjectScoreScaleSet, isZh);
    const scaleList = payload.subjectScoreScaleSet?.scales;
    const ins = payload.classInsight;
    if (ins && ins.totalStudents > 0) {
      ctx += L(
        `\n班级统计：人数 ${ins.totalStudents}；报告完成 ${ins.completedStudents}/${ins.totalStudents}（${ins.completionRate}%）；班主任评语 ${ins.homeroomCompleted}/${ins.totalStudents}（${ins.homeroomCompletionRate}%）\n`,
        `\nClass stats: ${ins.totalStudents} students; report completion ${ins.completedStudents}/${ins.totalStudents} (${ins.completionRate}%); homeroom comments ${ins.homeroomCompleted}/${ins.totalStudents} (${ins.homeroomCompletionRate}%)\n`,
      );
      if (ins.subjectScoreAverages.length > 0) {
        ctx += L('学科均分：\n', 'Subject averages:\n');
        for (const s of ins.subjectScoreAverages) {
          const scale = scaleForSubjectKey(undefined, s.subject, scaleList);
          const avgText =
            scale?.fullScore != null && scale.fullScore > 0
              ? `${s.avg}/${scale.fullScore}（${((s.avg / scale.fullScore) * 100).toFixed(1)}%）`
              : String(s.avg);
          ctx += `- ${s.subject}: ${avgText}（n=${s.count}）\n`;
        }
      }
      const lv = ins.levelCounts;
      ctx += L(
        `学习品质等第分布：A ${lv.A}、B ${lv.B}、C ${lv.C}、D ${lv.D}\n`,
        `Learning-quality levels: A ${lv.A}, B ${lv.B}, C ${lv.C}, D ${lv.D}\n`,
      );
    }
    if (payload.subjectAnalyses?.length) {
      ctx += L('\n学科教师班级分析：\n', '\nSubject teachers’ class analyses:\n');
      for (const s of payload.subjectAnalyses) {
        ctx += `- ${s.subjectName}${s.teacherName ? `（${s.teacherName}）` : ''}：${clip(s.classOverallAnalysis) || L('（无）', '(none)')}\n`;
      }
    }
    if (payload.classStudentSummaries?.length) {
      ctx += L('\n学生成绩摘要（所选报告）：\n', '\nStudent score summary (selected report):\n');
      for (const stu of payload.classStudentSummaries.slice(0, 40)) {
        const scoreLine = stu.subjects
          .filter((s) => s.finalScore != null)
          .map((s) => {
            const scoreText = formatScoreWithFullMark(
              s.finalScore,
              undefined,
              s.subjectName,
              scaleList,
              isZh,
            );
            return `${s.subjectName} ${scoreText}${s.learningQualityGrade ? `/${s.learningQualityGrade}` : ''}`;
          })
          .join('；');
        ctx += `- ${stu.name}${scoreLine ? `：${scoreLine}` : ''}\n`;
      }
      if (payload.classStudentSummaries.length > 40) {
        ctx += L(`…共 ${payload.classStudentSummaries.length} 名学生\n`, `…${payload.classStudentSummaries.length} students total\n`);
      }
    }
    return ctx;
  }

  if (payload.view === 'my-students-student-overview' || payload.view === 'student-self') {
    ctx += L('当前视图：学生个人概览\n', 'View: individual student overview\n');
    if (payload.studentName) ctx += L(`学生：${payload.studentName}\n`, `Student: ${payload.studentName}\n`);
    if (payload.className) {
      ctx += L(
        `班级：${payload.className}${payload.classGrade != null ? `（G${payload.classGrade}）` : ''}\n`,
        `Class: ${payload.className}${payload.classGrade != null ? ` (G${payload.classGrade})` : ''}\n`,
      );
    }
    if (payload.latestReportLabel) {
      ctx += L(`最近报告：${payload.latestReportLabel}\n`, `Latest report: ${payload.latestReportLabel}\n`);
    }
    ctx = appendReportSubjectScoreScalesBlock(ctx, payload.subjectScoreScaleSet, isZh);
    const scaleList = payload.subjectScoreScaleSet?.scales;
    if (payload.latestReportSubjects?.length) {
      ctx += L('\n最近报告学科数据：\n', '\nLatest report by subject:\n');
      for (const s of payload.latestReportSubjects) {
        const scoreText = formatScoreWithFullMark(
          s.finalScore,
          s.subjectKey,
          s.subjectName,
          scaleList,
          isZh,
        );
        const parts = [
          s.finalScore != null ? (isZh ? `分数 ${scoreText}` : `score ${scoreText}`) : null,
          s.finalGrade ? (isZh ? `等第 ${s.finalGrade}` : `grade ${s.finalGrade}`) : null,
          s.learningQualityGrade ? (isZh ? `品质 ${s.learningQualityGrade}` : `quality ${s.learningQualityGrade}`) : null,
        ].filter(Boolean);
        ctx += `- ${s.subjectName}${parts.length ? `：${parts.join('，')}` : ''}\n`;
        const c = clip(s.teacherComment, 200);
        if (c) ctx += `  ${L('评语', 'Comment')}: ${c}\n`;
      }
    }
    if (payload.examTrends?.length) {
      ctx += L(
        '\n考试学科成绩趋势（各数据点满分随对应学业报告/学期而定）：\n',
        '\nExam score trends (full score per point follows its report/term):\n',
      );
      for (const series of payload.examTrends) {
        const pts = series.points
          .map((p) => {
            const scoreText = formatScoreWithFullMark(
              p.score,
              series.subjectKey,
              series.subjectName,
              scaleList,
              isZh,
              p.fullScore,
            );
            return `${p.label} ${scoreText}${p.gradeLabel ? `(${p.gradeLabel})` : ''}`;
          })
          .join(' → ');
        ctx += `- ${series.subjectName}: ${pts || L('无数据', 'no data')}\n`;
      }
    }
    if (payload.subjectInsights?.length) {
      ctx += L('\n学科支持与个别分析：\n', '\nSubject support & individual notes:\n');
      for (const s of payload.subjectInsights) {
        ctx += `- ${s.subjectName}${s.teacherName ? `（${s.teacherName}）` : ''}\n`;
        const a = clip(s.learningAnalysis, 300);
        const p = clip(s.supportPlan, 300);
        if (a) ctx += `  ${L('学情', 'Analysis')}: ${a}\n`;
        if (p) ctx += `  ${L('支持计划', 'Support')}: ${p}\n`;
      }
    }
    const hc = clip(payload.homeroomComment, 500);
    if (hc) ctx += L(`\n班主任综合评价：\n${hc}\n`, `\nHomeroom comment:\n${hc}\n`);
    return ctx;
  }

  ctx += L(
    '用户位于学生中心，当前无具体班级/学生明细。若需分析某班或某生学情，请进入「学生中心」并打开侧拉 AI。\n',
    'Student Center context selected without class/student detail. Open Student Center with the AI panel for live data.\n',
  );
  return ctx;
}
