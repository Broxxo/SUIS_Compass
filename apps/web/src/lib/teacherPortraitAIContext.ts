import type {
  SubjectGroupDataSource,
  SubjectGroupPortraitDashboard,
  Term,
} from '../types/classManagement';
import type { ReportSubjectScoreScaleSet } from './studentPortraitOverview';
import {
  appendReportSubjectScoreScalesBlock,
  formatScoreWithFullMark,
} from './studentPortraitOverview';

export type TeacherPortraitAIView =
  | 'school-dashboard'
  | 'subject-dashboard'
  | 'personal-dashboard'
  | 'collections'
  | 'idle';

export type TeacherPortraitSubjectDashboardSlice = {
  term: Term;
  dataSource: SubjectGroupDataSource;
  sourceTitle: string | null;
  groupName: string;
  subjectLabels: string[];
  memberCount: number;
  dashboard: SubjectGroupPortraitDashboard | null;
  loading: boolean;
};

export type TeacherPortraitAIPayload = {
  view: TeacherPortraitAIView;
  tabLabel?: string;
  academicYearName?: string | null;
  term?: Term | null;
  schoolStats?: {
    teacherCount: number;
    staffingTeacherCount: number;
    classCount: number;
    studentCount: number;
    subjectCount: number;
    reportTitle: string | null;
    completionRate: number | null;
    completedStudents: number | null;
    totalStudents: number | null;
    pendingStudents: number | null;
    attentionClasses: Array<{ className: string; completionRate: number; pendingStudents: number }>;
  };
  personalAssignments?: Array<{
    className: string;
    grade: number;
    subjects: string[];
  }>;
  subjectDashboard?: TeacherPortraitSubjectDashboardSlice;
  /** 学科看板所选学业报告下的考试学科满分 */
  subjectScoreScaleSet?: ReportSubjectScoreScaleSet | null;
};

function clip(text: string | null | undefined, max = 400): string {
  const s = String(text ?? '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function buildTeacherPortraitAIPayload(input: {
  tab: string;
  isAdmin: boolean;
  isZh: boolean;
  academicYearName: string | null;
  term: Term;
  schoolStats: TeacherPortraitAIPayload['schoolStats'];
  personalAssignments: TeacherPortraitAIPayload['personalAssignments'];
  subjectDashboard: TeacherPortraitSubjectDashboardSlice | null;
  subjectScoreScaleSet: ReportSubjectScoreScaleSet | null;
  tabLabels: { school: string; subject: string; personal: string; collections: string };
}): TeacherPortraitAIPayload {
  if (input.tab === 'school' && input.isAdmin) {
    return {
      view: 'school-dashboard',
      tabLabel: input.tabLabels.school,
      academicYearName: input.academicYearName,
      schoolStats: input.schoolStats,
    };
  }
  if (input.tab === 'subject') {
    return {
      view: 'subject-dashboard',
      tabLabel: input.tabLabels.subject,
      academicYearName: input.academicYearName,
      term: input.subjectDashboard?.term ?? input.term,
      subjectDashboard: input.subjectDashboard ?? undefined,
      subjectScoreScaleSet: input.subjectScoreScaleSet,
    };
  }
  if (input.tab === 'dashboard') {
    return {
      view: 'personal-dashboard',
      tabLabel: input.tabLabels.personal,
      academicYearName: input.academicYearName,
      term: input.term,
      personalAssignments: input.personalAssignments,
    };
  }
  if (input.tab === 'collections') {
    return {
      view: 'collections',
      tabLabel: input.tabLabels.collections,
      academicYearName: input.academicYearName,
      term: input.term,
    };
  }
  return { view: 'idle', tabLabel: input.tabLabels.personal };
}

export function buildTeacherPortraitAIContextString(payload: TeacherPortraitAIPayload, isZh: boolean): string {
  const L = (zh: string, en: string) => (isZh ? zh : en);
  let ctx = L('当前正在使用「教师中心」应用。\n', 'Current app: Teacher Center.\n');

  if (payload.tabLabel) {
    ctx += L(`当前标签页：${payload.tabLabel}\n`, `Current tab: ${payload.tabLabel}\n`);
  }
  if (payload.academicYearName) {
    ctx += L(`学年：${payload.academicYearName}\n`, `Academic year: ${payload.academicYearName}\n`);
  }
  if (payload.term) {
    ctx += L(
      `学期：${payload.term === 'Semester 1' ? '上学期' : '下学期'}\n`,
      `Term: ${payload.term}\n`,
    );
  }

  if (payload.view === 'school-dashboard' && payload.schoolStats) {
    const s = payload.schoolStats;
    ctx += L('\n【学校看板】\n', '\n[School dashboard]\n');
    ctx += L(
      `专任教师 ${s.teacherCount} 人（本学年有岗位 ${s.staffingTeacherCount}）；班级 ${s.classCount}；学生 ${s.studentCount}；任课学科 ${s.subjectCount}\n`,
      `Teachers ${s.teacherCount} (${s.staffingTeacherCount} with assignments); classes ${s.classCount}; students ${s.studentCount}; subjects ${s.subjectCount}\n`,
    );
    if (s.reportTitle) {
      ctx += L(`学业报告：${s.reportTitle}`, `Academic report: ${s.reportTitle}`);
      if (s.completionRate != null) {
        ctx += L(
          `；完成率 ${s.completionRate}%（${s.completedStudents}/${s.totalStudents}，待完成 ${s.pendingStudents}）\n`,
          `; completion ${s.completionRate}% (${s.completedStudents}/${s.totalStudents}, pending ${s.pendingStudents})\n`,
        );
      } else {
        ctx += '\n';
      }
    }
    if (s.attentionClasses.length > 0) {
      ctx += L('待关注班级（完成率<85%）：\n', 'Classes needing attention (<85%):\n');
      for (const c of s.attentionClasses) {
        ctx += `- ${c.className}：${c.completionRate}% · 待完成 ${c.pendingStudents}\n`;
      }
    }
    return ctx;
  }

  if (payload.view === 'subject-dashboard') {
    ctx += L('\n【学科看板】\n', '\n[Subject dashboard]\n');
    const sd = payload.subjectDashboard;
    if (!sd || sd.loading) {
      ctx += L('数据加载中或尚未选择学科组/报告。\n', 'Data loading or no group/report selected.\n');
      return ctx;
    }
    ctx += L(`学科组：${sd.groupName}\n`, `Subject group: ${sd.groupName}\n`);
    if (sd.subjectLabels.length > 0) {
      ctx += L(`涵盖学科：${sd.subjectLabels.join('、')}\n`, `Subjects: ${sd.subjectLabels.join(', ')}\n`);
    }
    ctx += L(`成员 ${sd.memberCount} 人\n`, `Members: ${sd.memberCount}\n`);
    if (sd.sourceTitle) {
      ctx += L(
        `数据来源：${sd.dataSource === 'diagnosis' ? '教学诊断' : '学业报告'} · ${sd.sourceTitle}\n`,
        `Source: ${sd.dataSource === 'diagnosis' ? 'Teaching diagnosis' : 'Academic report'} · ${sd.sourceTitle}\n`,
      );
    }
    const dash = sd.dashboard;
    if (!dash) {
      ctx += L('暂无看板明细数据。\n', 'No dashboard detail yet.\n');
      return ctx;
    }
    if (sd.dataSource === 'diagnosis') {
      ctx += L('\n组员教学诊断提交情况：\n', '\nTeaching diagnosis submissions:\n');
      for (const m of dash.members) {
        const subjects = [...new Set(m.assignments.map((a) => a.subjectName))].join(isZh ? '、' : ', ');
        ctx += `- ${m.teacherName}${subjects ? `（${subjects}）` : ''}：${m.diagnosisHasContent ? L('已提交', 'submitted') : L('未提交', 'not submitted')}\n`;
        if (m.diagnosisHasContent && m.diagnosis) {
          const k = clip(m.diagnosis.keep, 120);
          const i = clip(m.diagnosis.improve, 120);
          if (k) ctx += `  Keep: ${k}\n`;
          if (i) ctx += `  Improve: ${i}\n`;
        }
      }
      return ctx;
    }
    if (dash.gradeRows.length === 0) {
      ctx += L('当前报告下暂无班级质量数据。\n', 'No class quality data for this report.\n');
      return ctx;
    }
    ctx = appendReportSubjectScoreScalesBlock(ctx, payload.subjectScoreScaleSet, isZh);
    const scaleList = payload.subjectScoreScaleSet?.scales;
    ctx += L('\n年级 × 班级 学科均分（右侧为年级均分）：\n', '\nGrade × class subject averages (right column = grade avg):\n');
    for (const row of dash.gradeRows) {
      ctx += `\n${row.gradeLabel}\n`;
      for (const cell of row.classes) {
        const lines = cell.subjectScores
          .map((s) => {
            const scoreText = formatScoreWithFullMark(
              s.avgScore,
              s.subjectKey,
              s.subjectName,
              scaleList,
              isZh,
            );
            return `${s.subjectName} ${scoreText}（${s.teacherName}）`;
          })
          .join('；');
        ctx += `- ${cell.className}：${lines || '—'}\n`;
      }
      if (row.subjectAverages.length > 0) {
        const avgLine = row.subjectAverages
          .map((s) => {
            const scoreText = formatScoreWithFullMark(s.avgScore, s.subjectKey, s.subjectName, scaleList, isZh);
            return `${s.subjectName} ${scoreText}`;
          })
          .join('；');
        ctx += L(`  年级均分：${avgLine}\n`, `  Grade avg: ${avgLine}\n`);
      }
    }
    return ctx;
  }

  if (payload.view === 'personal-dashboard') {
    ctx += L('\n【个人看板】\n', '\n[Personal dashboard]\n');
    if (payload.personalAssignments?.length) {
      ctx += L('任课情况：\n', 'Teaching assignments:\n');
      for (const g of payload.personalAssignments) {
        ctx += `- G${g.grade} ${g.className}：${g.subjects.join('、')}\n`;
      }
    } else {
      ctx += L('暂无任课安排数据。\n', 'No assignment data.\n');
    }
    ctx += L('（教学诊断内容请在界面中查看；进入学科看板可分析学科组数据。）\n', '(See teaching diagnosis in UI; use Subject dashboard for group analytics.)\n');
    return ctx;
  }

  if (payload.view === 'collections') {
    ctx += L('\n【教师发展】填报任务视图；具体表单内容未同步至 AI。\n', '\n[Teacher development] task view; form content not synced to AI.\n');
    return ctx;
  }

  ctx += L(
    '用户位于教师中心，当前无具体看板明细。若需分析学科组数据，请进入「学科看板」并打开侧拉 AI。\n',
    'Teacher Center without dashboard detail. Open Subject dashboard with AI panel for live analytics.\n',
  );
  return ctx;
}
