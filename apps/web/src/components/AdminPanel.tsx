import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type { Course, GradeConfigSegment, User } from '../types';
import {
  staffingSubjectKeyFromCourse,
  STAFFING_HOMEROOM_SUBJECT_KEY,
  reportExamScopeKey,
  resolveEvaluationGradesForCourse,
  resolveExamGradesForCourse,
  isEvaluationGradeIncluded,
  isExamGradeIncluded,
  courseIdsInEvaluationPool,
  courseIdsWithEvaluationGrades,
  courseIdsWithExamGrades,
  inferExamGradeInclusionFromLegacyScope,
} from '@repo/shared';
import type { AdminUser } from '../lib/adminStorage';
import {
  loadUsers,
  createUser,
  updateUserDepartment,
  updateUserPrimarySubject,
  updateUserStaffNameFields,
  updateUserRole,
  batchUpdateDepartment,
  deleteUser,
  importStudentAccounts,
} from '../lib/adminStorage';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import {
  loadAcademicYears,
  loadCurrentAcademicYearId,
  setCurrentAcademicYearId,
  setCurrentAcademicYearIdAndSync,
  getCurrentAcademicYearId,
  createAcademicYear,
  deleteAcademicYear,
  loadStudents,
  loadEnrollmentsSync,
  loadAllClasses,
  loadAllClassesSync,
  updateStudent,
  deleteStudent,
  addEnrollment,
} from '../lib/classStorage';
import { loadCategoryOrder, hydrateCategoryOrderFromCloud, loadGradeConfigSync } from '../lib/storage';
import {
  getGradeLabelByLevel,
  normalizeGradeConfig,
  gradeConfigHasSegments,
  getRoadmapSegmentsInDisplayOrder,
  getGradeLevelById,
  getGradeIdByLevel,
} from '../lib/gradeConfig';
import {
  sortCoursesLikeCurriculumRoadmap,
  getSubjectCategoryText,
  getCategoryCanonicalKey,
  formatCourseBilingualDisplayName,
  getCourseReportSubjectLabels,
} from '../lib/utils';
import {
  allocateLoginNames,
  downloadStaffImportTemplate,
  downloadStaffUsersExport,
  generateRandomImportPassword,
  nameSlugSource,
  parseStaffImportWorkbook,
  parsedRowsToDrafts,
  type StaffCreateDraftRow,
} from '../lib/staffUserImport';
import {
  buildStaffingRosterSheetsFromBlocks,
  downloadStaffingRosterExport,
  parseStaffingRosterWorkbook,
  type StaffingRosterTeacherRef,
} from '../lib/staffingRosterExcel';
import { courseAppliesToGrade, getWeeklyPeriodsForGrade } from '../lib/courseGradeUtils';
import type { AcademicYear, Student, Enrollment, ClassItem, EvaluationTemplateSummary, HomeroomCommentMode, ReportExamConfigScope, ReportGrade, ReportTemplateProgress, ReportTemplateStatus, ReportYearDimensionPreset, ReportYearDimensionPresetSubject, StaffingAssignment, TargetLevel, Term } from '../types/classManagement';
import ClassManagement from './ClassManagement';
import CurriculumRoadmap from './CurriculumRoadmap';
import CreateStudentDialog from './CreateStudentDialog';
import FoundationSettingsPanel, { type FoundationSubTab } from './admin/FoundationSettingsPanel';
import { ArrowDown, ArrowUp, Eye, EyeOff, LogIn, Pencil, Plus, Settings, Trash2, X } from 'lucide-react';
import {
  REPORT_PRESET_UNIFIED_LEVEL_DEFAULTS,
  fullUnifiedLevelTextFromPreset,
  unifiedLevelToApiPayload,
} from '../lib/reportPresetUnifiedLevels';
import {
  REPORT_SCORE_LETTER_GRADES,
  defaultReportScoreGradeMinScores,
  reportLetterGradeFromScore,
} from '@repo/shared';

/** 岗位安排：按年级分组班级行（用于 rowspan 首列） */
function groupStaffingClassesByGrade(classes: ClassItem[]): Array<{ grade: number; items: ClassItem[] }> {
  const map = new Map<number, ClassItem[]>();
  for (const c of classes) {
    const arr = map.get(c.grade);
    if (arr) arr.push(c);
    else map.set(c.grade, [c]);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([grade, items]) => ({
      grade,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
}

/**
 * 当尚无该学段的 stageInclusion 记录时，根据「该学段年级上已填写名称的目标维度」推断纳入课程，
 * 避免跨学段沿用「全选」与课程开设年级混用导致的错显（如仅配小学却在中预览出现语文）。
 */
function inferStageInclusionCourseIdsForSegment(
  segment: GradeConfigSegment,
  preset: ReportYearDimensionPreset | null,
  courses: Course[],
): string[] {
  if (!preset?.subjects?.length) return [];
  const gc = normalizeGradeConfig(loadGradeConfigSync());
  const segGradeSet = new Set(segment.gradeIds.map((g) => String(g).trim()).filter(Boolean));
  const stageCourseIdSet = new Set(
    courses
      .filter((course) =>
        segment.gradeIds.some((gid) => courseAppliesToGrade(course, getGradeLevelById(gc, gid), gc)),
      )
      .map((c) => c.id),
  );
  const out: string[] = [];
  for (const sub of preset.subjects) {
    const cid = String(sub.courseId ?? '').trim();
    if (!cid || !stageCourseIdSet.has(cid)) continue;
    const gd = sub.gradeDimensions ?? [];
    const has = gd.some(
      (row) =>
        segGradeSet.has(String(row.gradeId ?? '').trim()) &&
        (row.dimensions ?? []).some((d) => (d.dimensionLabelZh ?? '').trim() || (d.dimensionLabelEn ?? '').trim()),
    );
    if (has) out.push(cid);
  }
  return out;
}

/** 显式 stageInclusion 优先；缺省则按年级目标推断 */
function getEffectiveStageCheckedCourseIds(
  segment: GradeConfigSegment | null,
  segmentId: string,
  preset: ReportYearDimensionPreset | null,
  courses: Course[],
): string[] {
  if (!segment) return [];
  const gc = normalizeGradeConfig(loadGradeConfigSync());
  const stageCourseIdSet = new Set(
    courses
      .filter((course) =>
        segment.gradeIds.some((gid) => courseAppliesToGrade(course, getGradeLevelById(gc, gid), gc)),
      )
      .map((c) => c.id),
  );
  const raw = preset?.stageInclusion?.[segmentId.trim()];
  if (raw !== undefined) {
    return raw.filter((id) => stageCourseIdSet.has(id));
  }
  return inferStageInclusionCourseIdsForSegment(segment, preset, courses);
}

/** 新建报告预览：仅含参加评价（可按预览年级再筛）的课程 id */
function getEffectiveEvaluationCourseIdsForPreview(
  segment: GradeConfigSegment | null,
  segmentId: string,
  preset: ReportYearDimensionPreset | null,
  courses: Course[],
  previewGradeId?: string,
): string[] {
  if (!segment) return [];
  const gc = normalizeGradeConfig(loadGradeConfigSync());
  const stageCourseIdSet = new Set(
    courses
      .filter((course) =>
        segment.gradeIds.some((gid) => courseAppliesToGrade(course, getGradeLevelById(gc, gid), gc)),
      )
      .map((c) => c.id),
  );
  const gids = segment.gradeIds;
  let ids = courseIdsWithEvaluationGrades(
    segmentId.trim(),
    gids,
    preset?.stageInclusion,
    preset?.evaluationGradeInclusion,
  ).filter((id) => stageCourseIdSet.has(id));
  const pg = String(previewGradeId ?? '').trim();
  if (pg) {
    ids = ids.filter((cid) =>
      isEvaluationGradeIncluded(
        segmentId.trim(),
        cid,
        pg,
        gids,
        preset?.stageInclusion,
        preset?.evaluationGradeInclusion,
      ),
    );
  }
  return ids;
}

/** 学年预设里：在该学段年级上已保存有效维度名称的课程 id（新建报告预览仅展示这些，避免小学语文误入中学） */
function courseIdsWithPersistedSegmentTargetDimensions(
  segment: GradeConfigSegment | null,
  preset: ReportYearDimensionPreset | null,
): Set<string> {
  if (!segment || !preset?.subjects?.length) return new Set();
  const segGradeSet = new Set(segment.gradeIds.map((g) => String(g).trim()).filter(Boolean));
  const out = new Set<string>();
  for (const sub of preset.subjects) {
    const cid = String(sub.courseId ?? '').trim();
    if (!cid) continue;
    const gd = sub.gradeDimensions ?? [];
    const ok = gd.some(
      (row) =>
        segGradeSet.has(String(row.gradeId ?? '').trim()) &&
        (row.dimensions ?? []).some((d) => (d.dimensionLabelZh ?? '').trim() || (d.dimensionLabelEn ?? '').trim()),
    );
    if (ok) out.add(cid);
  }
  return out;
}

function findPresetYearSubjectForPreview(
  preset: ReportYearDimensionPreset | null,
  courseId: string,
  subjectKey: string,
) {
  const cid = String(courseId ?? '').trim();
  const sk = String(subjectKey ?? '').trim();
  const subs = preset?.subjects ?? [];
  if (cid) {
    const m = subs.find((s) => String(s.courseId ?? '').trim() === cid);
    if (m) return m;
  }
  if (sk) return subs.find((s) => String(s.subjectKey ?? '').trim() === sk);
  return undefined;
}

/** 学年预设中某年级上的目标维度行（用于新建/编辑报告预览） */
function getPresetDimensionsForReportPreviewGrade(
  preset: ReportYearDimensionPreset | null,
  courseId: string,
  subjectKey: string,
  gradeId: string,
): Array<{ dimensionLabelZh: string; dimensionLabelEn: string; levelDescriptions: Partial<Record<TargetLevel, string>> }> {
  const gid = String(gradeId ?? '').trim();
  if (!gid) return [];
  const sub = findPresetYearSubjectForPreview(preset, courseId, subjectKey);
  const row = sub?.gradeDimensions?.find((r) => String(r.gradeId ?? '').trim() === gid);
  if (!row?.dimensions?.length) return [];
  return row.dimensions.map((d) => ({
    dimensionLabelZh: d.dimensionLabelZh ?? '',
    dimensionLabelEn: d.dimensionLabelEn ?? '',
    levelDescriptions: (d.levelDescriptions ?? {}) as Partial<Record<TargetLevel, string>>,
  }));
}

function examScopeKey(term: Term, schoolSegmentId: string): string {
  return reportExamScopeKey(term, schoolSegmentId);
}

function createEmptyExamGradeDraft(): ExamGradeConfigDraft {
  const defaults = defaultReportScoreGradeMinScores();
  const percentBands = {} as Record<ReportGrade, string>;
  for (const g of REPORT_SCORE_LETTER_GRADES) {
    percentBands[g as ReportGrade] = String(defaults[g]);
  }
  return { percentBands, dimensionScores: [] };
}

function formatWeeklyLoadValue(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return v.toFixed(1);
}

function staffingTeacherDisplayName(
  teacher: Pick<AdminUser, 'nameZh' | 'nameEn' | 'displayName' | 'username'>,
  isZh: boolean,
): string {
  const zh = (teacher.nameZh ?? '').trim();
  const en = (teacher.nameEn ?? '').trim();
  return isZh ? zh || en || teacher.displayName || teacher.username : en || zh || teacher.displayName || teacher.username;
}

/** 班名常见前缀 G6 / G10，展示周课时构成时去掉年级前缀，如 G6P6B → P6B */
function stripLeadingGradeFromClassName(className: string): string {
  const t = className.trim();
  const stripped = t.replace(/^G\d+\s*/i, '').trim();
  return stripped || t;
}

/** 周课时统计：按课程分类汇总，如「语文: P5C-6节, P5D-6节；班会: P5C-1节」 */
function formatStaffingLoadBreakdownByCategory(items: StaffingLoadLineItem[], language: string): string {
  if (items.length === 0) return '—';
  const byCategory = new Map<string, { label: string; classParts: Map<string, number> }>();
  for (const it of items) {
    let entry = byCategory.get(it.subjectCategoryKey);
    if (!entry) {
      entry = { label: it.subjectCategoryLabel, classParts: new Map() };
      byCategory.set(it.subjectCategoryKey, entry);
    }
    const cls = stripLeadingGradeFromClassName(it.className);
    entry.classParts.set(cls, (entry.classParts.get(cls) ?? 0) + it.periods);
  }
  const categories = [...byCategory.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
  );
  const sepCat = language === 'zh' ? '；' : '; ';
  const sepCls = language === 'zh' ? ', ' : ', ';
  return categories
    .map((cat) => {
      const parts = [...cat.classParts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([cls, periods]) =>
          language === 'zh'
            ? `${cls}-${formatWeeklyLoadValue(periods)}节`
            : `${cls} ${formatWeeklyLoadValue(periods)}`,
        );
      return `${cat.label}: ${parts.join(sepCls)}`;
    })
    .join(sepCat);
}

/** 周课时统计：单行构成（过程明细） */
type StaffingLoadLineItem = {
  teacherId: string;
  subjectCategoryKey: string;
  subjectCategoryLabel: string;
  courseKey: string;
  courseDisplayName: string;
  className: string;
  gradeLevel: number;
  periods: number;
};

function randomSixDigitPassword(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const ROLE_LABELS: Record<User['role'], { zh: string; en: string }> = {
  'system-admin': { zh: '系统管理员', en: 'System Admin' },
  admin: { zh: '管理员', en: 'Admin' },
  teacher: { zh: '教师', en: 'Teacher' },
  student: { zh: '学生', en: 'Student' },
};

/** 筛选「未设置」部门/主学科 */
const USER_FILTER_NONE = '__none__';

/** 周课时统计：按教师主学科分组的内部键（未设置主学科） */
const STAFFING_LOAD_PRIMARY_NONE = '__primary_none__';

function formatPrimarySubjectCell(isZh: boolean, v: string | null | undefined): string {
  return (v ?? '').trim() || (isZh ? '无' : 'None');
}

type EvaluationDesignerModule = 'homeroom_comment' | 'subject_evaluation';
type ReportSettingPortraitTab = 'academic' | 'interests' | 'generalLearning' | 'socialEmotional';
type ReportSettingSubjectDraft = {
  /** 对应课程管理中的课程 id；从下拉选择时写入，用于生成与岗位安排一致的 subject_key */
  courseId: string;
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  moduleType: 'subject_score' | 'subject_comment' | 'non_score_comment';
  enableScore: boolean;
  /** 学习品质（A–D），与学科成绩同卡展示 */
  enableLearningQuality: boolean;
  enableTeacherComment: boolean;
  enableTarget: boolean;
  scorePreview: string;
  commentPreview: string;
  scoreVisibility: 'teacher_homeroom_admin';
  dimensions: Array<{
    dimensionLabelZh: string;
    dimensionLabelEn: string;
    levelDescriptions: Partial<Record<TargetLevel, string>>;
  }>;
};
type PresetGradeDimensionDraft = {
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  levelDescriptions: Partial<Record<TargetLevel, string>>;
};
type PresetSubjectGradeConfig = Record<string, PresetGradeDimensionDraft[]>;
type ExamDimensionScoreDraft = {
  dimensionLabelZh: string;
  dimensionLabelEn: string;
  score: string;
};
type ExamGradeConfigDraft = {
  percentBands: Record<ReportGrade, string>;
  dimensionScores: ExamDimensionScoreDraft[];
};
type ExamSubjectConfigDraft = {
  courseId: string;
  subjectKey: string;
  subjectNameZh: string;
  subjectNameEn: string;
  gradeConfigs: Record<string, ExamGradeConfigDraft>;
};

function buildExamSubjectRowForApi(
  cid: string,
  draft: ExamSubjectConfigDraft | undefined,
  segment: GradeConfigSegment,
  courses: Course[],
) {
  const c = courses.find((x) => x.id === cid);
  const sk = c ? staffingSubjectKeyFromCourse(c.id, c.name) : String(draft?.subjectKey ?? '').trim();
  const labels = c ? getCourseReportSubjectLabels(c) : { subjectNameZh: '', subjectNameEn: '' };
  const gradeConfigs = segment.gradeIds.map((gid) => {
    const g = draft?.gradeConfigs?.[gid] ?? createEmptyExamGradeDraft();
    const percentBands: Partial<Record<ReportGrade, number>> = {};
    for (const rg of REPORT_SCORE_LETTER_GRADES) {
      const n = Number(g.percentBands[rg as ReportGrade]);
      if (Number.isFinite(n)) percentBands[rg as ReportGrade] = n;
    }
    return {
      gradeId: gid,
      percentBands,
      dimensionScores: g.dimensionScores
        .map((d) => ({
          dimensionLabelZh: d.dimensionLabelZh.trim(),
          dimensionLabelEn: (d.dimensionLabelEn || d.dimensionLabelZh).trim(),
          score: Number(d.score),
        }))
        .filter((d) => d.dimensionLabelZh && d.dimensionLabelEn && Number.isFinite(d.score) && d.score >= 0),
    };
  });
  return {
    courseId: cid,
    subjectKey: draft?.subjectKey || sk,
    subjectNameZh: draft?.subjectNameZh || labels.subjectNameZh,
    subjectNameEn: draft?.subjectNameEn || labels.subjectNameEn,
    gradeConfigs,
  };
}

/** 合并本地草稿与已持久化的考试学科行，避免只保存一门时把未编辑学科写成空配置 */
function mergeExamScopeSubjectsForPersist(args: {
  checkedCourseIds: string[];
  draftsByCourse: Record<string, ExamSubjectConfigDraft>;
  existingSubjects: ReportExamConfigScope['subjects'] | undefined;
  segment: GradeConfigSegment;
  courses: Course[];
  examGradeByCourse?: Record<string, string[]>;
}) {
  const persistedByCid = new Map(
    (args.existingSubjects ?? [])
      .map((s) => [String(s.courseId ?? '').trim(), s] as const)
      .filter(([id]) => id),
  );
  const out: ReturnType<typeof buildExamSubjectRowForApi>[] = [];
  for (const cid of args.checkedCourseIds) {
    const id = String(cid ?? '').trim();
    if (!id) continue;
    const examGrades = new Set(args.examGradeByCourse?.[id] ?? []);
    const filterGrades = <T extends { gradeId: string }>(rows: T[]) =>
      examGrades.size > 0 ? rows.filter((g) => examGrades.has(g.gradeId)) : rows;
    if (Object.prototype.hasOwnProperty.call(args.draftsByCourse, id)) {
      const row = buildExamSubjectRowForApi(id, args.draftsByCourse[id], args.segment, args.courses);
      out.push({ ...row, gradeConfigs: filterGrades(row.gradeConfigs) });
      continue;
    }
    const persisted = persistedByCid.get(id);
    if (persisted) {
      out.push({
        courseId: String(persisted.courseId ?? '').trim() || id,
        subjectKey: String(persisted.subjectKey ?? '').trim(),
        subjectNameZh: String(persisted.subjectNameZh ?? ''),
        subjectNameEn: String(persisted.subjectNameEn ?? ''),
        gradeConfigs: filterGrades(Array.isArray(persisted.gradeConfigs) ? persisted.gradeConfigs : []),
      });
      continue;
    }
    const row = buildExamSubjectRowForApi(id, undefined, args.segment, args.courses);
    out.push({ ...row, gradeConfigs: filterGrades(row.gradeConfigs) });
  }
  return out;
}

/** 新建/无数据时，每年级默认占位维度数 */
const PRESET_TARGET_DEFAULT_DIMENSION_COLS = 4;

interface AdminPanelProps {
  onBackToHub: () => void;
}

export default function AdminPanel({ onBackToHub }: AdminPanelProps) {
  const { user: currentUser } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);
  const [createUserDraftRows, setCreateUserDraftRows] = useState<StaffCreateDraftRow[]>([]);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);
  const excelImportInputRef = useRef<HTMLInputElement>(null);
  /** 教职工列表筛选 */
  const [userStaffFilterDepartment, setUserStaffFilterDepartment] = useState('');
  const [userStaffFilterPrimarySubject, setUserStaffFilterPrimarySubject] = useState('');
  const [userStaffFilterRole, setUserStaffFilterRole] = useState<'' | 'admin' | 'teacher'>('');
  const [userStaffFilterSearch, setUserStaffFilterSearch] = useState('');
  /** 教职工列表：表头排序（部门 / 主学科） */
  const [userStaffSortKey, setUserStaffSortKey] = useState<'department' | 'primarySubject' | null>(null);
  const [userStaffSortDir, setUserStaffSortDir] = useState<'asc' | 'desc'>('asc');
  /** 学生账号列表：关键词 */
  const [userStudentFilterSearch, setUserStudentFilterSearch] = useState('');
  /** 每行密码是否可见（仅影响展示，默认隐藏） */
  const [passwordRevealed, setPasswordRevealed] = useState<Record<string, boolean>>({});
  /** 批量操作：选中的用户 id */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 批量设置部门时的输入值 */
  const [batchDepartment, setBatchDepartment] = useState('');
  /** 组织架构中非根节点名称（与用户管理部门下拉同步） */
  const [orgDepartmentLabels, setOrgDepartmentLabels] = useState<string[]>([]);
  /** 批量设置部门请求中 */
  const [batchDeptLoading, setBatchDeptLoading] = useState(false);
  /** 删除确认：当前要删的用户；确认输入框内容 */
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [adminTab, setAdminTab] = useState<
    'users' | 'foundation' | 'classes' | 'courses' | 'staffing' | 'students' | 'report-settings' | 'database'
  >('users');
  const [foundationSubTab, setFoundationSubTab] = useState<FoundationSubTab>('years');
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const [yearLoading, setYearLoading] = useState(false);
  const [dialogCreateYear, setDialogCreateYear] = useState(false);
  const [dialogYearManagement, setDialogYearManagement] = useState(false);
  const [newYearName, setNewYearName] = useState('');
  const [yearSubmitLoading, setYearSubmitLoading] = useState(false);
  const [currentYearClassCount, setCurrentYearClassCount] = useState<number | null>(null);
  const [currentYearStudentCount, setCurrentYearStudentCount] = useState<number | null>(null);
  const [currentYearClasses, setCurrentYearClasses] = useState<{ cls: ClassItem; studentCount: number }[]>([]);

  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [allYears, setAllYears] = useState<AcademicYear[]>([]);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentFilterName, setStudentFilterName] = useState('');
  const [studentFilterGrade, setStudentFilterGrade] = useState('');
  const [studentFilterClass, setStudentFilterClass] = useState('');
  const [studentSortField, setStudentSortField] = useState<'nameZh' | 'nameEn' | 'currentGrade' | 'gender' | 'studentNumber' | 'dateOfBirth'>('nameZh');
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc');
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editNameZh, setEditNameZh] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editCurrentGrade, setEditCurrentGrade] = useState('');
  const [editGender, setEditGender] = useState<Student['gender']>('male');
  const [editDivision, setEditDivision] = useState('');
  const [editEntryDate, setEditEntryDate] = useState('');
  const [editStatus, setEditStatus] = useState<Student['status']>('active');
  const [editStudentNumber, setEditStudentNumber] = useState('');
  const [editDateOfBirth, setEditDateOfBirth] = useState('');
  const [editSubmitLoading, setEditSubmitLoading] = useState(false);
  const [studentCurrentYearId, setStudentCurrentYearId] = useState<string | null>(null);
  const [dialogCreateStudent, setDialogCreateStudent] = useState(false);
  const [reportSettingYearId, setReportSettingYearId] = useState<string>('');
  const [reportSettingTerm, setReportSettingTerm] = useState<Term>('Semester 1');
  const [reportSettingPortraitTab, setReportSettingPortraitTab] = useState<ReportSettingPortraitTab>('academic');
  const [reportSettingStatus, setReportSettingStatus] = useState<ReportTemplateStatus>('draft');
  const [reportSettingHomeroomCommentMode, setReportSettingHomeroomCommentMode] = useState<HomeroomCommentMode>('optional');
  const [reportSettingTitle, setReportSettingTitle] = useState('');
  const [reportTemplateList, setReportTemplateList] = useState<EvaluationTemplateSummary[]>([]);
  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState<string>('');
  const [createEvaluationOpen, setCreateEvaluationOpen] = useState(false);
  const [createEvaluationMode, setCreateEvaluationMode] = useState<'create' | 'edit' | 'preset' | 'exam'>('create');
  const [, setPresetEditingSubjectKey] = useState('');
  const [enabledEvaluationModules, setEnabledEvaluationModules] = useState<Record<EvaluationDesignerModule, boolean>>({
    homeroom_comment: false,
    subject_evaluation: true,
  });
  const [evaluationModuleOrder, setEvaluationModuleOrder] = useState<EvaluationDesignerModule[]>([
    'subject_evaluation',
  ]);
  const [homeroomCommentPreview, setHomeroomCommentPreview] = useState('');
  /** 学业报告预览：课程目标达成表格中等第下拉（仅本地预览，不入库） */
  const [academicPreviewTargetLevels, setAcademicPreviewTargetLevels] = useState<Record<string, string>>({});
  /** 学业报告预览：学习品质等第（仅本地预览，不入库） */
  const [academicPreviewLearningQuality, setAcademicPreviewLearningQuality] = useState<Record<string, string>>({});
  const [addModuleMenuOpen, setAddModuleMenuOpen] = useState(false);
  const [createEvaluationTitle, setCreateEvaluationTitle] = useState('');
  const [createEvaluationFromTemplateId, setCreateEvaluationFromTemplateId] = useState<string>('');
  /** 新建/编辑学业报告：模板所属学段（与课程设置学段 id 一致） */
  const [newReportSchoolSegmentId, setNewReportSchoolSegmentId] = useState('');
  /** 学业报告预览：当前模板学段内的年级 id（用于按年级预览课程与目标维度） */
  const [newReportPreviewGradeId, setNewReportPreviewGradeId] = useState('');
  /** 设计器内分数→等第预览用（按学年+学期+学段加载） */
  const [designerScoreMinScores, setDesignerScoreMinScores] = useState<Record<string, number> | null>(null);
  const [scoreBandDialogOpen, setScoreBandDialogOpen] = useState(false);
  const [scoreBandSegmentId, setScoreBandSegmentId] = useState('');
  const [scoreBandDraft, setScoreBandDraft] = useState<Record<string, string>>({});
  const [scoreBandLoading, setScoreBandLoading] = useState(false);
  const [scoreBandSaving, setScoreBandSaving] = useState(false);
  const [reportSettingSubjects, setReportSettingSubjects] = useState<ReportSettingSubjectDraft[]>([]);
  const [reportYearDimensionPreset, setReportYearDimensionPreset] = useState<ReportYearDimensionPreset | null>(null);
  const [reportYearPresetLoading, setReportYearPresetLoading] = useState(false);
  const [reportYearPresetSaving, setReportYearPresetSaving] = useState(false);
  const [reportTargetInclusionSaving, setReportTargetInclusionSaving] = useState(false);
  /** 学年共用 A–D 等第说明（学科维度不再单独配置） */
  const [reportTargetUnifiedLevel, setReportTargetUnifiedLevel] = useState<Record<TargetLevel, string>>(
    () => ({ ...REPORT_PRESET_UNIFIED_LEVEL_DEFAULTS }),
  );
  const [reportTargetUnifiedEditOpen, setReportTargetUnifiedEditOpen] = useState(false);
  const [reportTargetUnifiedDraft, setReportTargetUnifiedDraft] = useState<Record<TargetLevel, string>>(
    () => ({ ...REPORT_PRESET_UNIFIED_LEVEL_DEFAULTS }),
  );
  const [reportTargetUnifiedDialogSaving, setReportTargetUnifiedDialogSaving] = useState(false);
  /** 学科目标维度表列数（含空列）；与各年级实际维度数取 max 展示 */
  const [presetTargetDimTableColumnCount, setPresetTargetDimTableColumnCount] = useState(4);
  /** 学科目标设置（preset 模式）专用状态 */
  const [reportTargetStageId, setReportTargetStageId] = useState('');
  const [reportTargetCheckedCourseIds, setReportTargetCheckedCourseIds] = useState<string[]>([]);
  /** 当前学段：courseId → 参加评价的年级 id（仅 stageInclusion 池内课程） */
  const [reportTargetEvaluationGradeByCourse, setReportTargetEvaluationGradeByCourse] = useState<Record<string, string[]>>({});
  /** 当前学期+学段：courseId → 参加考试的年级 id */
  const [reportExamGradeByCourse, setReportExamGradeByCourse] = useState<Record<string, string[]>>({});
  const [reportTargetActiveSubjectKey, setReportTargetActiveSubjectKey] = useState('');
  const [reportTargetGradeConfigBySubject, setReportTargetGradeConfigBySubject] = useState<Record<string, PresetSubjectGradeConfig>>({});
  const [reportTargetDirtySubjectKeys, setReportTargetDirtySubjectKeys] = useState<Set<string>>(new Set());
  const [reportTargetPersistedSubjects, setReportTargetPersistedSubjects] = useState<ReportYearDimensionPresetSubject[]>([]);
  /** 考试学科设置（exam 模式） */
  const [reportExamCheckedCourseIds, setReportExamCheckedCourseIds] = useState<string[]>([]);
  const [reportExamActiveCourseId, setReportExamActiveCourseId] = useState('');
  const [reportExamConfigByCourse, setReportExamConfigByCourse] = useState<Record<string, ExamSubjectConfigDraft>>({});
  const [reportExamSaving, setReportExamSaving] = useState(false);
  const reportTargetGradeConfigBySubjectRef = useRef<Record<string, PresetSubjectGradeConfig>>({});
  reportTargetGradeConfigBySubjectRef.current = reportTargetGradeConfigBySubject;
  const lastPresetTargetDimNavKeyRef = useRef<{ nav: string; preset: string }>({ nav: '', preset: '' });
  /** 新建学业报告简化预览：学段切换时清空班主任预览，避免沿用上一学段的示例文案 */
  const homeroomPreviewLastSegmentIdRef = useRef<string | null>(null);
  /** 设置学科目标：用于在未保存 stageInclusion 时区分「换学段」与「同学段内状态更新」 */
  const presetTargetChecklistStageRef = useRef<string | null>(null);
  /** 从考试学科页「前往学科目标设置」时，在 preset 模式把该课程纳入勾选并选中 */
  const pendingOpenPresetFocusCourseIdRef = useRef<string | null>(null);
  /** 评价模板设计器：课程下拉数据源 */
  const [evaluationDesignerCourses, setEvaluationDesignerCourses] = useState<Course[]>([]);
  const [reportSettingLoading, setReportSettingLoading] = useState(false);
  const [reportSettingSaving, setReportSettingSaving] = useState(false);
  /** 学业报告 / 学科目标设置弹窗内提示（校验、保存失败），避免只显示在后台页顶栏 */
  const [evaluationDesignerError, setEvaluationDesignerError] = useState<string | null>(null);
  const [progressConfirmOpen, setProgressConfirmOpen] = useState(false);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressData, setProgressData] = useState<ReportTemplateProgress | null>(null);
  const [progressTemplateTitle, setProgressTemplateTitle] = useState('');
  /** 本学期当前列表下所有学业报告的学生完成度汇总（仅进度条，无文案） */
  const [termReportOverallRate, setTermReportOverallRate] = useState<number | null>(null);
  const [termReportOverallLoading, setTermReportOverallLoading] = useState(false);
  const [dbTables, setDbTables] = useState<Array<{ tableName: string; rowCount: number }>>([]);
  const [dbSelectedTable, setDbSelectedTable] = useState<string>('');
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [dbRows, setDbRows] = useState<Array<Record<string, unknown>>>([]);
  const [dbPrimaryKey, setDbPrimaryKey] = useState<string | null>(null);
  const [dbLimit, setDbLimit] = useState(20);
  const [dbOffset, setDbOffset] = useState(0);
  const [dbTotal, setDbTotal] = useState(0);
  const [dbTableLoading, setDbTableLoading] = useState(false);
  const [dbRowsLoading, setDbRowsLoading] = useState(false);

  /** 岗位安排：学年 + 班级列表（后续接入班主任/学科教师编辑与复制上年） */
  const [staffingYearId, setStaffingYearId] = useState<string>('');
  const [staffingLoading, setStaffingLoading] = useState(false);
  const [staffingCourses, setStaffingCourses] = useState<Course[]>([]);
  const [staffingTeachers, setStaffingTeachers] = useState<AdminUser[]>([]);
  const [staffingAssignments, setStaffingAssignments] = useState<StaffingAssignment[]>([]);
  /** 学业报告配置所用学年的岗位安排（用于评价学科页「未安排教师」提示） */
  const [reportYearStaffingAssignments, setReportYearStaffingAssignments] = useState<StaffingAssignment[]>([]);
  const [staffingSavingKeys, setStaffingSavingKeys] = useState<Set<string>>(new Set());
  /** 云端下学科顺序从 DB 拉取后 bump，岗位安排列与课程管理对齐 */
  const [staffingCategoryOrderNonce, setStaffingCategoryOrderNonce] = useState(0);
  /** 岗位管理内：岗位安排表 vs 周课时统计 */
  const [staffingSubTab, setStaffingSubTab] = useState<'roster' | 'load'>('roster');
  /** 周课时统计·全校表：按主学科筛选、排序 */
  const [staffingLoadGrandFilterPrimary, setStaffingLoadGrandFilterPrimary] = useState<string>('');
  const [staffingExcelImporting, setStaffingExcelImporting] = useState(false);
  const staffingExcelInputRef = useRef<HTMLInputElement>(null);
  const [staffingLoadGrandSort, setStaffingLoadGrandSort] = useState<
    'total-desc' | 'total-asc' | 'name-asc' | 'primary-asc'
  >('total-desc');

  /** 用户管理：教职工列表 | 学生账号列表 */
  const [userListScope, setUserListScope] = useState<'staff' | 'students'>('staff');
  const [studentLoginOpen, setStudentLoginOpen] = useState(false);
  const [studentLoginPreview, setStudentLoginPreview] = useState<
    Array<{ studentId: string; nameZh: string; nameEn: string; studentNumber: string; password: string }>
  >([]);
  const [studentLoginPhase, setStudentLoginPhase] = useState<'preview' | 'done'>('preview');
  const [studentLoginResult, setStudentLoginResult] = useState<{ created: number; skipped: number } | null>(null);
  const [studentLoginBusy, setStudentLoginBusy] = useState(false);

  /** 仅系统管理员可创建/修改学年 */
  const canEditYears = currentUser?.role === 'system-admin';
  const canEditSchoolStructure =
    currentUser?.role === 'system-admin' || currentUser?.role === 'admin';
  const isSystemAdmin = currentUser?.role === 'system-admin';

  /** 当前用户可创建的权限类型：系统管理员可创建管理员+教师，管理员只能创建教师 */
  const assignableRoles = useMemo((): User['role'][] => {
    if (currentUser?.role === 'system-admin') return ['admin', 'teacher'];
    if (currentUser?.role === 'admin') return ['teacher'];
    return [];
  }, [currentUser?.role]);

  /** 列表展示：学生账号为独立 scope；教职工仍按权限过滤 */
  const displayedUsers = useMemo(() => {
    if (userListScope === 'students') return users;
    if (currentUser?.role === 'system-admin') return users.filter((u) => u.role === 'admin' || u.role === 'teacher');
    if (currentUser?.role === 'admin') return users.filter((u) => u.role === 'teacher');
    return users;
  }, [users, currentUser?.role, userListScope]);

  /** 当前用户可否编辑该行（权限、部门等）：学生账号不可在此编辑 */
  const canEditUser = (u: AdminUser) => {
    if (u.role === 'student') return false;
    if (u.role === 'system-admin') return false;
    if (currentUser?.role === 'system-admin') return true;
    if (currentUser?.role === 'admin' && u.role === 'teacher') return true;
    return false;
  };

  /** 当前用户可否删除该行：系统管理员可删管理员/教师/学生，管理员可删教师与学生 */
  const canDeleteUser = (u: AdminUser) => {
    if (u.role === 'system-admin') return false;
    if (u.role === 'student') {
      return currentUser?.role === 'system-admin' || currentUser?.role === 'admin';
    }
    if (currentUser?.role === 'system-admin') return true;
    if (currentUser?.role === 'admin' && u.role === 'teacher') return true;
    return false;
  };

  const loadOrgDepartmentLabels = useCallback(async () => {
    if (!USE_CLOUD_STORAGE) {
      setOrgDepartmentLabels([]);
      return;
    }
    try {
      const flat = await api.getAdminOrgDepartments();
      const names = new Set<string>();
      for (const d of flat) {
        if (d.parentId != null && d.parentId !== '' && d.name.trim()) {
          names.add(d.name.trim());
        }
      }
      setOrgDepartmentLabels(Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    } catch {
      setOrgDepartmentLabels([]);
    }
  }, []);

  /** 当前列表中出现的所有部门 + 组织架构部门（去重，用于下拉选项） */
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    displayedUsers.forEach((u) => {
      if (u.department && u.department.trim()) set.add(u.department.trim());
    });
    orgDepartmentLabels.forEach((d) => set.add(d));
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [displayedUsers, orgDepartmentLabels]);

  /** 教职工主学科去重（用于筛选下拉） */
  const primarySubjectOptions = useMemo(() => {
    const set = new Set<string>();
    displayedUsers.forEach((u) => {
      if (u.role === 'student') return;
      const v = (u.primarySubject ?? '').trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [displayedUsers]);

  const usersShownInUsersSection = useMemo(() => {
    let list: AdminUser[];
    if (userListScope === 'students') {
      const q = userStudentFilterSearch.trim().toLowerCase();
      if (!q) list = [...displayedUsers];
      else {
        list = displayedUsers.filter((u) => {
          const hay = [
            u.username,
            u.displayName || '',
            u.nameZh || '',
            u.nameEn || '',
            u.studentNameZh || '',
            u.studentNameEn || '',
          ]
            .join('\n')
            .toLowerCase();
          return hay.includes(q);
        });
      }
    } else {
      list = displayedUsers.filter((u) => {
        if (userStaffFilterRole && u.role !== userStaffFilterRole) return false;
        if (userStaffFilterDepartment) {
          const d = (u.department ?? '').trim();
          if (userStaffFilterDepartment === USER_FILTER_NONE) {
            if (d) return false;
          } else if (d !== userStaffFilterDepartment) return false;
        }
        if (userStaffFilterPrimarySubject) {
          const s = (u.primarySubject ?? '').trim();
          if (userStaffFilterPrimarySubject === USER_FILTER_NONE) {
            if (s) return false;
          } else if (s !== userStaffFilterPrimarySubject) return false;
        }
        if (userStaffFilterSearch.trim()) {
          const fq = userStaffFilterSearch.trim().toLowerCase();
          const roleLabel = ROLE_LABELS[u.role as User['role']]?.[isZh ? 'zh' : 'en'] ?? u.role;
          const blob = [
            u.username,
            u.displayName || '',
            u.nameZh || '',
            u.nameEn || '',
            u.department || '',
            u.primarySubject || '',
            roleLabel,
          ]
            .join(' ')
            .toLowerCase();
          if (!blob.includes(fq)) return false;
        }
        return true;
      });
    }

    if (userListScope === 'staff' && userStaffSortKey) {
      const sortVal = (u: AdminUser) =>
        userStaffSortKey === 'department'
          ? (u.department ?? '').trim().toLowerCase()
          : (u.primarySubject ?? '').trim().toLowerCase();
      list = [...list].sort((a, b) => {
        const c = sortVal(a).localeCompare(sortVal(b), undefined, { numeric: true, sensitivity: 'base' });
        if (c !== 0) return userStaffSortDir === 'asc' ? c : -c;
        return a.username.localeCompare(b.username, undefined, { numeric: true, sensitivity: 'base' });
      });
    }

    return list;
  }, [
    displayedUsers,
    userListScope,
    userStudentFilterSearch,
    userStaffFilterDepartment,
    userStaffFilterPrimarySubject,
    userStaffFilterRole,
    userStaffFilterSearch,
    userStaffSortKey,
    userStaffSortDir,
    isZh,
  ]);

  useEffect(() => {
    setUserStaffFilterDepartment('');
    setUserStaffFilterPrimarySubject('');
    setUserStaffFilterRole('');
    setUserStaffFilterSearch('');
    setUserStudentFilterSearch('');
    setUserStaffSortKey(null);
    setUserStaffSortDir('asc');
  }, [userListScope]);

  const toggleStaffTableSort = (key: 'department' | 'primarySubject') => {
    if (userStaffSortKey === key) {
      setUserStaffSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserStaffSortKey(key);
      setUserStaffSortDir('asc');
    }
  };

  useEffect(() => {
    if (!USE_CLOUD_STORAGE) return;
    if (adminTab !== 'users' && !(adminTab === 'foundation' && foundationSubTab === 'organization')) return;
    void loadOrgDepartmentLabels();
  }, [adminTab, foundationSubTab, loadOrgDepartmentLabels]);

  useEffect(() => {
    if (adminTab !== 'users') return;
    setLoading(true);
    setError(null);
    loadUsers(userListScope)
      .then((data) => setUsers(data))
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  }, [adminTab, userListScope]);

  const refreshYears = async () => {
    const list = await loadAcademicYears();
    setYears(list);
    const cur = await loadCurrentAcademicYearId();
    if (cur) setCurrentYearId(cur);
    else if (list.length > 0) {
      if (!getCurrentAcademicYearId()) setCurrentAcademicYearId(list[0].id);
      setCurrentYearId(list[0].id);
    }
  };

  const loadReportTemplateList = async (yearId: string, term: Term) => {
    if (!yearId) return;
    const templates = await api.getAdminReportTemplates({ academicYearId: yearId, term });
    setReportTemplateList(templates);
    const chosen = selectedReportTemplateId && templates.some((t) => t.id === selectedReportTemplateId)
      ? selectedReportTemplateId
      : (templates[0]?.id ?? '');
    setSelectedReportTemplateId(chosen);
    return chosen;
  };

  const loadReportYearDimensionPreset = useCallback(async (yearId: string) => {
    if (!yearId || !USE_CLOUD_STORAGE) {
      setReportYearDimensionPreset(null);
      return null;
    }
    setReportYearPresetLoading(true);
    try {
      const preset = await api.getAdminReportYearDimensionPreset(yearId);
      setReportYearDimensionPreset(preset);
      return preset;
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load year dimension preset');
      setReportYearDimensionPreset(null);
      return null;
    } finally {
      setReportYearPresetLoading(false);
    }
  }, []);

  const loadReportTemplateSetting = async (templateId: string) => {
    if (!templateId) {
      setReportSettingSubjects([]);
      setEvaluationDesignerCourses([]);
      setReportSettingTitle('');
      setNewReportSchoolSegmentId('');
      setReportSettingStatus('draft');
      setReportSettingHomeroomCommentMode('optional');
      const defaultModules = {
        homeroom_comment: false,
        subject_evaluation: true,
      } as Record<EvaluationDesignerModule, boolean>;
      setEnabledEvaluationModules(defaultModules);
      setEvaluationModuleOrder(deriveModuleOrderFromEnabled(defaultModules));
      return;
    }
    setReportSettingLoading(true);
    try {
      const courses = USE_CLOUD_STORAGE
        ? await api.getCourses().catch(() => [] as Course[])
        : ([] as Course[]);
      setEvaluationDesignerCourses(courses);
      const tpl = await api.getAdminReportTemplate(templateId);
      const mappedSubjects = (tpl.subjects ?? []).map((s) => {
        const key = (s.subjectKey ?? '').trim();
        const matchCourse = courses.find((c) => staffingSubjectKeyFromCourse(c.id, c.name) === key);
        const labels = matchCourse
          ? getCourseReportSubjectLabels(matchCourse)
          : {
              subjectNameZh: s.subjectNameZh || s.subjectName || '',
              subjectNameEn: s.subjectNameEn || s.subjectName || '',
            };
        return {
          courseId: matchCourse?.id ?? '',
          subjectKey: key,
          subjectNameZh: labels.subjectNameZh,
          subjectNameEn: labels.subjectNameEn,
          moduleType: s.moduleType ?? 'subject_score',
          enableScore: s.enableScore ?? true,
          enableLearningQuality: s.enableLearningQuality !== false,
          enableTeacherComment: s.enableTeacherComment ?? true,
          enableTarget: (s.dimensions ?? []).length > 0,
          scorePreview: '',
          commentPreview: '',
          scoreVisibility: s.scoreVisibility ?? 'teacher_homeroom_admin',
          dimensions: (s.dimensions ?? []).map((d) => ({
            dimensionLabelZh: d.dimensionLabelZh || d.dimensionLabel,
            dimensionLabelEn: d.dimensionLabelEn || d.dimensionLabel,
            levelDescriptions: d.levelDescriptions ?? {},
          })),
        };
      });
      const homeroomMode = tpl.homeroomCommentMode ?? 'optional';
      setReportSettingStatus(tpl.status);
      setReportSettingHomeroomCommentMode('optional');
      setReportSettingTitle(tpl.title ?? '');
      setNewReportSchoolSegmentId(String(tpl.schoolSegmentId ?? '').trim());
      setReportSettingSubjects(mappedSubjects);
      const enabled = deriveEnabledModulesFromTemplate(homeroomMode, mappedSubjects);
      setEnabledEvaluationModules(enabled);
      setEvaluationModuleOrder(deriveModuleOrderFromEnabled(enabled));
      return tpl;
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load report template');
    } finally {
      setReportSettingLoading(false);
    }
  };

  useEffect(() => {
    if (!createEvaluationOpen || !USE_CLOUD_STORAGE) return;
    void api
      .getCourses()
      .then((list) => setEvaluationDesignerCourses(list))
      .catch(() => setEvaluationDesignerCourses([]));
  }, [createEvaluationOpen]);

  const evaluationCoursesSorted = useMemo(
    () => sortCoursesLikeCurriculumRoadmap(evaluationDesignerCourses, loadCategoryOrder()),
    [evaluationDesignerCourses],
  );
  const reportTargetGradeConfigSyncKey =
    adminTab === 'report-settings' ? JSON.stringify(normalizeGradeConfig(loadGradeConfigSync())) : '';
  const reportTargetSegments = useMemo<GradeConfigSegment[]>(() => {
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    return getRoadmapSegmentsInDisplayOrder(gc);
  }, [reportTargetGradeConfigSyncKey]);

  const reportSegmentLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of reportTargetSegments) m.set(s.id, s.label);
    return m;
  }, [reportTargetSegments]);
  const reportExamScopeStorageKey = useMemo(
    () => examScopeKey(reportSettingTerm, reportTargetStageId || reportTargetSegments[0]?.id || ''),
    [reportSettingTerm, reportTargetStageId, reportTargetSegments],
  );
  const reportExamScope = useMemo<ReportExamConfigScope | null>(() => {
    const key = reportExamScopeStorageKey.trim();
    if (!key) return null;
    return reportYearDimensionPreset?.examConfigs?.[key] ?? null;
  }, [reportYearDimensionPreset?.examConfigs, reportExamScopeStorageKey]);

  const newReportPreviewSegment = useMemo(
    () => reportTargetSegments.find((seg) => seg.id === newReportSchoolSegmentId.trim()) ?? null,
    [reportTargetSegments, newReportSchoolSegmentId],
  );
  const newReportPreviewGradeOptions = useMemo(() => {
    const seg = newReportPreviewSegment;
    if (!seg?.gradeIds?.length) return [] as Array<{ id: string; label: string }>;
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    return seg.gradeIds.map((id) => ({
      id: String(id).trim(),
      label: getGradeLabelByLevel(gc, getGradeLevelById(gc, id)),
    }));
  }, [newReportPreviewSegment, reportTargetGradeConfigSyncKey]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode === 'preset') return;
    const ids = newReportPreviewGradeOptions.map((g) => g.id);
    if (ids.length === 0) {
      setNewReportPreviewGradeId('');
      return;
    }
    setNewReportPreviewGradeId((prev) => (prev && ids.includes(prev) ? prev : ids[0]!));
  }, [createEvaluationOpen, createEvaluationMode, newReportPreviewGradeOptions]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode === 'preset') return;
    setAcademicPreviewTargetLevels({});
    setAcademicPreviewLearningQuality({});
  }, [createEvaluationOpen, createEvaluationMode, newReportPreviewGradeId]);

  useEffect(() => {
    if (!createEvaluationOpen || !USE_CLOUD_STORAGE || !reportSettingYearId) return;
    if (createEvaluationMode === 'preset') return;
    const seg = newReportSchoolSegmentId.trim();
    if (!seg) {
      setDesignerScoreMinScores(null);
      return;
    }
    let cancelled = false;
    void api
      .getAdminReportScoreGradeBands({
        academicYearId: reportSettingYearId,
        term: reportSettingTerm,
        schoolSegmentId: seg,
      })
      .then((r) => {
        if (!cancelled) setDesignerScoreMinScores(r.minScores as Record<string, number>);
      })
      .catch(() => {
        if (!cancelled) setDesignerScoreMinScores(defaultReportScoreGradeMinScores());
      });
    return () => {
      cancelled = true;
    };
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportSettingYearId,
    reportSettingTerm,
    newReportSchoolSegmentId,
  ]);

  const reportTargetCurrentSegment = useMemo(
    () => reportTargetSegments.find((seg) => seg.id === reportTargetStageId) ?? null,
    [reportTargetSegments, reportTargetStageId],
  );
  const reportTargetStageCourses = useMemo(() => {
    if (!reportTargetCurrentSegment) return [] as Course[];
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    return evaluationCoursesSorted.filter((course) =>
      reportTargetCurrentSegment.gradeIds.some((gid) => courseAppliesToGrade(course, getGradeLevelById(gc, gid), gc)),
    );
  }, [evaluationCoursesSorted, reportTargetCurrentSegment, reportTargetGradeConfigSyncKey]);
  const reportTargetStageEvaluationPoolCourses = useMemo(
    () => reportTargetStageCourses.filter((c) => reportTargetCheckedCourseIds.includes(c.id)),
    [reportTargetStageCourses, reportTargetCheckedCourseIds],
  );
  /** 第二步：本学段内至少有一个年级参加评价的课程（来自第一步配置） */
  const reportExamEvaluationCourses = useMemo(() => {
    if (!reportTargetCurrentSegment) return [] as Course[];
    const ids = new Set(
      courseIdsWithEvaluationGrades(
        reportTargetStageId,
        reportTargetCurrentSegment.gradeIds,
        reportYearDimensionPreset?.stageInclusion,
        reportYearDimensionPreset?.evaluationGradeInclusion,
      ),
    );
    return reportTargetStageCourses.filter((c) => ids.has(c.id));
  }, [
    reportTargetStageCourses,
    reportTargetCurrentSegment,
    reportTargetStageId,
    reportYearDimensionPreset?.stageInclusion,
    reportYearDimensionPreset?.evaluationGradeInclusion,
  ]);
  const reportExamStageCompletion = useMemo(() => {
    const seg = reportTargetCurrentSegment;
    if (!seg) {
      return { total: 0, completed: 0, pending: 0, percent: 0 };
    }
    const scopeKey = examScopeKey(reportSettingTerm, reportTargetStageId);
    const evalPoolIds = new Set(reportExamEvaluationCourses.map((c) => c.id));
    const examCourseIds = reportExamCheckedCourseIds.filter((id) => evalPoolIds.has(id));
    const total = examCourseIds.length;
    const completed = examCourseIds.filter((cid) => {
      const cfg = reportExamConfigByCourse[cid];
      if (!cfg) return false;
      const examGrades =
        reportExamGradeByCourse[cid]
        ?? resolveExamGradesForCourse(
          scopeKey,
          cid,
          seg.gradeIds,
          resolveEvaluationGradesForCourse(
            reportTargetStageId,
            cid,
            seg.gradeIds,
            reportYearDimensionPreset?.stageInclusion,
            reportYearDimensionPreset?.evaluationGradeInclusion,
          ),
          reportYearDimensionPreset?.examGradeInclusion,
          reportYearDimensionPreset?.examConfigs,
        );
      if (examGrades.length === 0) return false;
      return examGrades.every((gid) => {
        const g = cfg.gradeConfigs[gid];
        return !!g && g.dimensionScores.length > 0;
      });
    }).length;
    return {
      total,
      completed,
      pending: Math.max(0, total - completed),
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [
    reportExamCheckedCourseIds,
    reportExamEvaluationCourses,
    reportExamConfigByCourse,
    reportTargetCurrentSegment,
    reportTargetStageId,
    reportSettingTerm,
    reportYearDimensionPreset,
    reportExamGradeByCourse,
  ]);

  /** 当前选中的考试学科在学年预设中是否尚未配置任何年级的目标维度（无法配置维度分值） */
  const reportExamActiveCourseMissingPresetDimensions = useMemo(() => {
    if (!reportExamActiveCourseId.trim() || !reportTargetCurrentSegment) return false;
    const c = reportTargetStageCourses.find((x) => x.id === reportExamActiveCourseId);
    if (!c) return false;
    const sk = staffingSubjectKeyFromCourse(c.id, c.name);
    return !reportTargetCurrentSegment.gradeIds.some((gid) => {
      const dims = getPresetDimensionsForReportPreviewGrade(reportYearDimensionPreset, c.id, sk, gid);
      return dims.length > 0;
    });
  }, [
    reportExamActiveCourseId,
    reportTargetCurrentSegment,
    reportTargetStageCourses,
    reportYearDimensionPreset,
  ]);

  /** 当前学段已勾选学科：merge 列表中的行优先；其余按学年预设或空草稿合成（避免仅语文在 merge 里导致进度 1/1） */
  const reportTargetStageSubjects = useMemo(() => {
    const checked = new Set(reportTargetCheckedCourseIds);
    const byCourseId = new Map(
      reportSettingSubjects.map((s) => [String(s.courseId ?? '').trim(), s] as const).filter(([id]) => id),
    );
    const presetSubjects = reportYearDimensionPreset?.subjects ?? [];
    const draftFromPresetCourse = (course: Course): ReportSettingSubjectDraft => {
      const sk = staffingSubjectKeyFromCourse(course.id, course.name);
      const { subjectNameZh, subjectNameEn } = getCourseReportSubjectLabels(course);
      const saved =
        presetSubjects.find((s) => String(s.courseId ?? '').trim() === course.id)
        ?? presetSubjects.find((s) => String(s.subjectKey ?? '').trim() === sk);
      const mapDim = (d: {
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions?: Partial<Record<TargetLevel, string>>;
      }) => ({
        dimensionLabelZh: d.dimensionLabelZh ?? '',
        dimensionLabelEn: d.dimensionLabelEn ?? '',
        levelDescriptions: d.levelDescriptions ?? {},
      });
      const flat = (saved?.dimensions ?? []).map(mapDim);
      const rows = saved?.gradeDimensions ?? [];
      let fromGrades: ReturnType<typeof mapDim>[] = [];
      if (rows.length > 0) {
        let best = rows[0].dimensions ?? [];
        for (let i = 1; i < rows.length; i += 1) {
          const d = rows[i].dimensions ?? [];
          if (d.length > best.length) best = d;
        }
        fromGrades = (best ?? []).map(mapDim);
      }
      const flatHasLabels = flat.some((d) => (d.dimensionLabelZh ?? '').trim() || (d.dimensionLabelEn ?? '').trim());
      const dimensions = flatHasLabels ? flat : fromGrades.length > 0 ? fromGrades : flat;
      let enableTarget: boolean;
      if (saved?.enableTarget === false) {
        enableTarget = false;
      } else if (saved?.enableTarget === true) {
        enableTarget = true;
      } else {
        enableTarget = dimensions.length > 0;
      }
      if (enableTarget && dimensions.length === 0) {
        enableTarget = false;
      }
      return {
        courseId: course.id,
        subjectKey: sk,
        subjectNameZh: (saved ? subjectNameZh || saved.subjectNameZh : subjectNameZh) || '',
        subjectNameEn: (saved ? subjectNameEn || saved.subjectNameEn : subjectNameEn) || '',
        moduleType: 'subject_score' as const,
        enableScore: !saved || saved.enableScore !== false,
        enableLearningQuality: true,
        enableTeacherComment: !saved || saved.enableTeacherComment !== false,
        enableTarget,
        scorePreview: '',
        commentPreview: '',
        scoreVisibility: 'teacher_homeroom_admin' as const,
        dimensions,
      };
    };
    return reportTargetStageEvaluationPoolCourses
      .filter((c) => {
        if (!checked.has(c.id)) return false;
        const evalGrades = reportTargetEvaluationGradeByCourse[c.id] ?? reportTargetCurrentSegment?.gradeIds ?? [];
        return evalGrades.length > 0;
      })
      .map((course) => {
        const existing = byCourseId.get(course.id);
        if (existing) return existing;
        return draftFromPresetCourse(course);
      });
  }, [
    reportTargetStageEvaluationPoolCourses,
    reportTargetCheckedCourseIds,
    reportTargetEvaluationGradeByCourse,
    reportTargetCurrentSegment,
    reportSettingSubjects,
    reportYearDimensionPreset?.subjects,
  ]);
  const reportTargetActiveSubject = useMemo(
    () => reportTargetStageSubjects.find((s) => s.subjectKey === reportTargetActiveSubjectKey) ?? null,
    [reportTargetStageSubjects, reportTargetActiveSubjectKey],
  );
  /** 当前学科：参加评价但岗位安排中该年级无任何班级任课教师的提示 */
  const reportTargetActiveSubjectStaffingWarnings = useMemo(() => {
    if (!reportTargetActiveSubject || !reportTargetCurrentSegment || !reportSettingYearId) return [];
    const subjectKey = String(reportTargetActiveSubject.subjectKey ?? '').trim();
    if (!subjectKey) return [];
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    const yearClasses = allClasses.filter((c) => c.academicYearId === reportSettingYearId);
    const activeCourseId = String(reportTargetActiveSubject.courseId ?? '').trim();
    const evaluationGradeIds =
      activeCourseId && reportTargetEvaluationGradeByCourse[activeCourseId]
        ? reportTargetEvaluationGradeByCourse[activeCourseId]
        : activeCourseId
          ? resolveEvaluationGradesForCourse(
              reportTargetStageId,
              activeCourseId,
              reportTargetCurrentSegment.gradeIds,
              reportYearDimensionPreset?.stageInclusion,
              reportYearDimensionPreset?.evaluationGradeInclusion,
            )
          : reportTargetCurrentSegment.gradeIds;
    const evalGradeSet = new Set(evaluationGradeIds);
    const missingGradeLabels: string[] = [];
    for (const gradeId of reportTargetCurrentSegment.gradeIds) {
      if (evalGradeSet.size > 0 && !evalGradeSet.has(gradeId)) continue;
      const gradeLevel = getGradeLevelById(gc, gradeId);
      const gradeLabel = getGradeLabelByLevel(gc, gradeLevel);
      const classesAtGrade = yearClasses.filter((c) => c.grade === gradeLevel);
      if (classesAtGrade.length === 0) continue;
      const hasTeacher = classesAtGrade.some((cls) =>
        reportYearStaffingAssignments.some(
          (a) =>
            a.classId === cls.id &&
            a.subjectKey === subjectKey &&
            String(a.teacherId ?? '').trim(),
        ),
      );
      if (!hasTeacher) {
        missingGradeLabels.push(gradeLabel);
      }
    }
    if (missingGradeLabels.length === 0) return [];
    const joined = missingGradeLabels.join(isZh ? '、' : ', ');
    return [
      isZh
        ? `${joined}未安排教师，无法进行学业报告评价`
        : `${joined}: no teacher assigned; academic report evaluation is unavailable.`,
    ];
  }, [
    reportTargetActiveSubject,
    reportTargetCurrentSegment,
    reportSettingYearId,
    allClasses,
    reportTargetEvaluationGradeByCourse,
    reportTargetStageId,
    reportYearDimensionPreset?.stageInclusion,
    reportYearDimensionPreset?.evaluationGradeInclusion,
    reportYearStaffingAssignments,
    isZh,
    reportTargetGradeConfigSyncKey,
  ]);
  /** 当前学段下：持久化里参加评价年级已有有效维度名的学科 */
  const reportTargetStagePersistedSavedKeys = useMemo(() => {
    const seg = reportTargetCurrentSegment;
    if (!seg) return new Set<string>();
    const out = new Set<string>();
    for (const sub of reportTargetPersistedSubjects) {
      const sk = String(sub.subjectKey ?? '').trim();
      const cid = String(sub.courseId ?? '').trim();
      if (!sk || !cid) continue;
      if (!reportTargetCheckedCourseIds.includes(cid)) continue;
      const evalGrades =
        reportTargetEvaluationGradeByCourse[cid]
        ?? resolveEvaluationGradesForCourse(
          reportTargetStageId,
          cid,
          seg.gradeIds,
          reportYearDimensionPreset?.stageInclusion,
          reportYearDimensionPreset?.evaluationGradeInclusion,
        );
      const gd = sub.gradeDimensions ?? [];
      const ok = gd.some(
        (row) =>
          evalGrades.includes(String(row.gradeId ?? '').trim()) &&
          (row.dimensions ?? []).some((d) => (d.dimensionLabelZh ?? '').trim() || (d.dimensionLabelEn ?? '').trim()),
      );
      if (ok) out.add(sk);
    }
    return out;
  }, [
    reportTargetPersistedSubjects,
    reportTargetCurrentSegment,
    reportTargetCheckedCourseIds,
    reportTargetEvaluationGradeByCourse,
    reportTargetStageId,
    reportYearDimensionPreset,
    reportTargetGradeConfigSyncKey,
  ]);
  const reportTargetStageCompletion = useMemo(() => {
    const total = reportTargetStageSubjects.length;
    const completed = reportTargetStageSubjects.filter(
      (s) =>
        reportTargetStagePersistedSavedKeys.has(s.subjectKey) && !reportTargetDirtySubjectKeys.has(s.subjectKey),
    ).length;
    return {
      total,
      completed,
      pending: Math.max(0, total - completed),
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [reportTargetStageSubjects, reportTargetDirtySubjectKeys, reportTargetStagePersistedSavedKeys]);

  const loadDatabaseTables = async () => {
    setDbTableLoading(true);
    try {
      const list = await api.getDatabaseTables();
      setDbTables(list);
      const chosen = dbSelectedTable && list.some((t) => t.tableName === dbSelectedTable)
        ? dbSelectedTable
        : (list[0]?.tableName ?? '');
      setDbSelectedTable(chosen);
      if (!chosen) {
        setDbColumns([]);
        setDbRows([]);
        setDbPrimaryKey(null);
        setDbOffset(0);
        setDbTotal(0);
      }
      return chosen;
    } finally {
      setDbTableLoading(false);
    }
  };

  const loadDatabaseRows = async (tableName: string, offset: number, limit: number) => {
    if (!tableName) return;
    setDbRowsLoading(true);
    try {
      const data = await api.getDatabaseTableRows(tableName, { offset, limit });
      setDbColumns(data.columns);
      setDbRows(data.rows);
      setDbPrimaryKey(data.primaryKey);
      setDbOffset(data.page.offset);
      setDbLimit(data.page.limit);
      setDbTotal(data.page.total);
    } finally {
      setDbRowsLoading(false);
    }
  };

  useEffect(() => {
    if (adminTab !== 'foundation' || foundationSubTab !== 'years') return;
    setYearLoading(true);
    refreshYears().finally(() => setYearLoading(false));
  }, [adminTab, foundationSubTab]);

  useEffect(() => {
    if (adminTab !== 'report-settings') return;
    setReportSettingPortraitTab('academic');
    if (!USE_CLOUD_STORAGE) {
      setReportSettingYearId('');
      setReportTemplateList([]);
      setSelectedReportTemplateId('');
      setReportSettingSubjects([]);
      setEvaluationDesignerCourses([]);
      setReportSettingTitle('');
      setReportSettingStatus('draft');
      setReportSettingHomeroomCommentMode('optional');
      setReportYearDimensionPreset(null);
      return;
    }
    setReportSettingLoading(true);
    Promise.all([loadAcademicYears(), loadCurrentAcademicYearId()])
      .then(([list, cur]) => {
        setYears(list);
        const id = cur || list[0]?.id || '';
        setReportSettingYearId(id);
        if (id) {
          return Promise.all([
            loadReportTemplateList(id, reportSettingTerm),
            loadReportYearDimensionPreset(id),
          ]);
        }
      })
      .finally(() => setReportSettingLoading(false));
  }, [adminTab, loadReportYearDimensionPreset, reportSettingTerm]);

  useEffect(() => {
    if (adminTab !== 'report-settings' || !reportSettingYearId) return;
    if (!USE_CLOUD_STORAGE) return;
    void loadReportTemplateList(reportSettingYearId, reportSettingTerm);
    void loadReportYearDimensionPreset(reportSettingYearId);
  }, [reportSettingYearId, reportSettingTerm, adminTab, loadReportYearDimensionPreset]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !reportSettingYearId) {
      setReportYearStaffingAssignments([]);
      return;
    }
    let cancelled = false;
    api
      .getAdminStaffingAssignments(reportSettingYearId)
      .then((assignments) => {
        if (!cancelled) setReportYearStaffingAssignments(assignments);
      })
      .catch(() => {
        if (!cancelled) setReportYearStaffingAssignments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reportSettingYearId]);

  useEffect(() => {
    if (adminTab !== 'report-settings') return;
    if (!USE_CLOUD_STORAGE) return;
    void loadReportTemplateSetting(selectedReportTemplateId);
  }, [selectedReportTemplateId, adminTab]);

  useEffect(() => {
    if (adminTab !== 'database') return;
    if (!isSystemAdmin) return;
    setError(null);
    setDbOffset(0);
    loadDatabaseTables()
      .then((chosen) => {
        if (chosen) return loadDatabaseRows(chosen, 0, dbLimit);
      })
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load database tables'));
  }, [adminTab, isSystemAdmin]);

  // 选定学年后，统计该学年的班级数和学生数（按学籍去重）
  useEffect(() => {
    if (adminTab !== 'foundation' || foundationSubTab !== 'years' || !currentYearId) {
      setCurrentYearClassCount(null);
      setCurrentYearStudentCount(null);
      return;
    }
    try {
      const allClasses = loadAllClassesSync();
      const classesForYear = allClasses.filter((c) => c.academicYearId === currentYearId);
      const enrolls = loadEnrollmentsSync(currentYearId);
      const validClassIds = new Set(classesForYear.map((c) => c.id));

      const classToStudentSet = new Map<string, Set<string>>();
      enrolls.forEach((e) => {
        if (!validClassIds.has(e.classId)) return;
        let set = classToStudentSet.get(e.classId);
        if (!set) {
          set = new Set<string>();
          classToStudentSet.set(e.classId, set);
        }
        set.add(e.studentId);
      });

      const studentIds = new Set<string>();
      classToStudentSet.forEach((set) => set.forEach((id) => studentIds.add(id)));

      setCurrentYearClassCount(classesForYear.length);
      setCurrentYearStudentCount(studentIds.size);
      setCurrentYearClasses(
        classesForYear
          .slice()
          .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name))
          .map((cls) => ({
            cls,
            studentCount: classToStudentSet.get(cls.id)?.size ?? 0,
          })),
      );
    } catch {
      setCurrentYearClassCount(null);
      setCurrentYearStudentCount(null);
      setCurrentYearClasses([]);
    }
  }, [adminTab, foundationSubTab, currentYearId]);

  useEffect(() => {
    if (adminTab !== 'students') return;
    setStudentLoading(true);
    Promise.all([
      loadStudents(),
      loadAcademicYears(),
      loadAllClasses(),
      loadCurrentAcademicYearId(),
    ]).then(([stList, yList, clsList, curYearId]) => {
      setStudents(stList);
      setAllYears(yList);
      setAllClasses(clsList);
      setEnrollments(loadEnrollmentsSync());
      setStudentCurrentYearId(curYearId || (yList.length > 0 ? yList[0].id : null));
    }).finally(() => setStudentLoading(false));
  }, [adminTab]);

  useEffect(() => {
    if (adminTab !== 'staffing') return;
    setStaffingLoading(true);
    Promise.all([
      loadAcademicYears(),
      loadAllClasses(),
      loadCurrentAcademicYearId(),
      USE_CLOUD_STORAGE ? api.getCourses() : Promise.resolve([] as Course[]),
      loadUsers('staff'),
    ])
      .then(async ([yList, clsList, curYearId, courseList, userList]) => {
        setAllYears(yList);
        setAllClasses(clsList);
        setStaffingCourses(courseList);
        setStaffingTeachers(userList.filter((u) => u.role === 'teacher'));
        const id = curYearId || yList[0]?.id || '';
        setStaffingYearId(id);
        if (id && USE_CLOUD_STORAGE) {
          const assignments = await api.getAdminStaffingAssignments(id);
          setStaffingAssignments(assignments);
        } else {
          setStaffingAssignments([]);
        }
      })
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load staffing data'))
      .finally(() => setStaffingLoading(false));
  }, [adminTab]);

  useEffect(() => {
    if (adminTab !== 'staffing') return;
    if (!USE_CLOUD_STORAGE || !staffingYearId) {
      setStaffingAssignments([]);
      return;
    }
    setStaffingLoading(true);
    api.getAdminStaffingAssignments(staffingYearId)
      .then((assignments) => setStaffingAssignments(assignments))
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load staffing assignments'))
      .finally(() => setStaffingLoading(false));
  }, [adminTab, staffingYearId]);

  useEffect(() => {
    setStaffingLoadGrandFilterPrimary('');
  }, [staffingYearId]);

  useEffect(() => {
    if (adminTab !== 'staffing' || !USE_CLOUD_STORAGE) return;
    let cancelled = false;
    void hydrateCategoryOrderFromCloud().then(() => {
      if (!cancelled) setStaffingCategoryOrderNonce((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [adminTab]);

  const handleCreateYear = async () => {
    if (!newYearName.trim()) return;
    setYearSubmitLoading(true);
    setError(null);
    try {
      const id = `ay-${Date.now()}`;
      await createAcademicYear({
        id,
        name: newYearName.trim(),
        isCurrent: years.length === 0,
      });
      setNewYearName('');
      setDialogCreateYear(false);
      await refreshYears();
      if (years.length === 0) await setCurrentAcademicYearIdAndSync(id);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create year');
    } finally {
      setYearSubmitLoading(false);
    }
  };

  const filteredAndSortedStudents = useMemo(() => {
    let list = [...students];
    if (studentFilterName.trim()) {
      const q = studentFilterName.trim().toLowerCase();
      list = list.filter((s) =>
        (s.nameZh ?? '').toLowerCase().includes(q) ||
        (s.nameEn ?? '').toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.studentNumber?.toLowerCase().includes(q))
      );
    }
    if (studentFilterGrade.trim()) {
      const q = studentFilterGrade.trim().toLowerCase();
      list = list.filter((s) => String(s.currentGrade ?? '').toLowerCase().includes(q));
    }
    if (studentFilterClass.trim()) {
      const classId = studentFilterClass;
      const enrolledIds = new Set(enrollments.filter((e) => e.classId === classId).map((e) => e.studentId));
      list = list.filter((s) => enrolledIds.has(s.id));
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (studentSortField) {
        case 'nameZh':
          cmp = (a.nameZh || '').localeCompare(b.nameZh || '');
          break;
        case 'nameEn':
          cmp = (a.nameEn || '').localeCompare(b.nameEn || '');
          break;
        case 'currentGrade':
          cmp = (a.currentGrade ?? 0) - (b.currentGrade ?? 0);
          break;
        case 'gender':
          cmp = (a.gender || '').localeCompare(b.gender || '');
          break;
        case 'studentNumber':
          cmp = (a.studentNumber ?? '').localeCompare(b.studentNumber ?? '');
          break;
        case 'dateOfBirth':
          cmp = (a.dateOfBirth ?? '').localeCompare(b.dateOfBirth ?? '');
          break;
        default:
          cmp = 0;
      }
      return studentSortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [students, enrollments, studentFilterName, studentFilterGrade, studentFilterClass, studentSortField, studentSortDir]);

  const openEditStudent = (s: Student) => {
    setEditStudent(s);
    setEditNameZh(s.nameZh ?? '');
    setEditNameEn(s.nameEn ?? '');
    setEditCurrentGrade(s.currentGrade == null ? '' : String(s.currentGrade));
    setEditGender(s.gender);
    setEditDivision(s.division ?? '');
    setEditEntryDate(s.entryDate ?? '');
    setEditStatus(s.status ?? 'active');
    setEditStudentNumber(s.studentNumber ?? '');
    setEditDateOfBirth(s.dateOfBirth ?? '');
  };

  const handleSaveStudent = async () => {
    if (!editStudent) return;
    const zh = editNameZh.trim();
    const en = editNameEn.trim();
    if (!zh && !en) return;
    setEditSubmitLoading(true);
    setError(null);
    try {
      await updateStudent(editStudent.id, {
        name: zh || en,
        nameZh: zh || null,
        nameEn: en || null,
        currentGrade: editCurrentGrade.trim() ? Number(editCurrentGrade) : null,
        gender: editGender,
        division: editDivision.trim() || null,
        entryDate: editEntryDate.trim() || null,
        status: editStatus || 'active',
        studentNumber: editStudentNumber.trim() || null,
        dateOfBirth: editDateOfBirth.trim() || null,
      });
      setStudents((prev) => prev.map((s) => (
        s.id === editStudent.id
          ? {
              ...s,
              name: zh || en,
              nameZh: zh || null,
              nameEn: en || null,
              currentGrade: editCurrentGrade.trim() ? Number(editCurrentGrade) : null,
              gender: editGender,
              division: editDivision.trim() || null,
              entryDate: editEntryDate.trim() || null,
              status: editStatus || 'active',
              studentNumber: editStudentNumber.trim() || null,
              dateOfBirth: editDateOfBirth.trim() || null,
            }
          : s
      )));
      setEditStudent(null);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update student');
    } finally {
      setEditSubmitLoading(false);
    }
  };

  const handleDeleteStudentInAdmin = async () => {
    if (!editStudent) return;
    const msg = isZh ? `确定删除学生「${editStudent.name}」？其所有学籍将删除。` : `Delete student "${editStudent.name}"? All enrollments will be removed.`;
    if (!window.confirm(msg)) return;
    setEditSubmitLoading(true);
    setError(null);
    try {
      await deleteStudent(editStudent.id);
      setStudents((prev) => prev.filter((s) => s.id !== editStudent.id));
      setEnrollments((prev) => prev.filter((e) => e.studentId !== editStudent.id));
      setEditStudent(null);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete student');
    } finally {
      setEditSubmitLoading(false);
    }
  };

  const handleDeleteYear = async (y: AcademicYear) => {
    const msg = isZh
      ? `确定删除学年「${y.name}」？该学年下所有班级与学籍将一并删除，学生档案保留。`
      : `Delete academic year "${y.name}"? All classes and enrollments in this year will be removed; student records kept.`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await deleteAcademicYear(y.id);
      await refreshYears();
      setDialogYearManagement(false);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete year');
    }
  };

  const getGradeLabel = (level: number): string =>
    getGradeLabelByLevel(normalizeGradeConfig(loadGradeConfigSync()), level);

  const makeEmptyStaffDraft = (): StaffCreateDraftRow => {
    const first = assignableRoles[0];
    const role: 'admin' | 'teacher' =
      first === 'admin' ? 'admin' : first === 'teacher' ? 'teacher' : 'teacher';
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    return {
      id,
      nameZh: '',
      nameEn: '',
      username: '',
      role,
      department: '',
      primarySubject: '',
      password: '',
    };
  };

  const openCreateUserDialog = () => {
    setError(null);
    setCreateUserDraftRows([makeEmptyStaffDraft()]);
    setCreateUserDialogOpen(true);
  };

  const handleExportStaffUsersExcel = () => {
    setError(null);
    const list = usersShownInUsersSection.filter((u) => u.role === 'admin' || u.role === 'teacher');
    if (list.length === 0) {
      setError(isZh ? '当前列表中没有可导出的教职工（管理员/教师）。' : 'No admin/teacher rows in the current list to export.');
      return;
    }
    downloadStaffUsersExport(list, isZh);
  };

  const updateStaffDraftRow = (id: string, patch: Partial<StaffCreateDraftRow>) => {
    setCreateUserDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeStaffDraftRow = (id: string) => {
    setCreateUserDraftRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const handleStaffExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const allowed = assignableRoles.filter((x): x is 'admin' | 'teacher' => x === 'admin' || x === 'teacher');
      const parsed = parseStaffImportWorkbook(buf, allowed.length > 0 ? allowed : ['teacher']);
      if (parsed.length === 0) {
        setError(
          isZh
            ? '未解析到有效数据行，请确认首行为表头且列为：中文名、英文名、权限、部门、主学科、密码（中文名与英文名至少填其一）。'
            : 'No data rows. Use the template header: Name (ZH), Name (EN), Role, Department, Subject, Password (at least one name).',
        );
        return;
      }
      const taken = new Set(users.map((u) => u.username.toLowerCase().trim()));
      const logins = allocateLoginNames(
        parsed.map((p) => nameSlugSource(p.nameZh, p.nameEn)),
        taken,
      );
      const makeId = () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      setCreateUserDraftRows(parsedRowsToDrafts(parsed, logins, makeId));
    } catch (err: unknown) {
      setError((err as Error)?.message || (isZh ? '读取 Excel 失败' : 'Failed to read Excel'));
    }
  };

  const rowHasDisplayName = (r: StaffCreateDraftRow) => Boolean(r.nameZh.trim() || r.nameEn.trim());

  const handleSubmitCreateUsers = async () => {
    const rawRows = createUserDraftRows.filter(rowHasDisplayName);
    if (rawRows.length === 0) {
      setError(isZh ? '请至少填写一行：中文名或英文名至少填其一。' : 'Each row needs at least Chinese or English name.');
      return;
    }
    const taken = new Set(users.map((u) => u.username.toLowerCase().trim()));
    const rows: StaffCreateDraftRow[] = [];
    for (const r of rawRows) {
      if (r.username.trim()) {
        rows.push(r);
        taken.add(r.username.trim().toLowerCase());
      } else {
        const [u] = allocateLoginNames([nameSlugSource(r.nameZh, r.nameEn)], taken);
        rows.push({ ...r, username: u });
      }
    }
    const lowerSeen = new Set<string>();
    for (const r of rows) {
      const u = r.username.trim().toLowerCase();
      if (lowerSeen.has(u)) {
        setError(isZh ? `登录名重复：${r.username}` : `Duplicate username: ${r.username}`);
        return;
      }
      if (users.some((x) => x.username.toLowerCase().trim() === u)) {
        setError(isZh ? `登录名已被占用：${r.username}` : `Username already taken: ${r.username}`);
        return;
      }
      lowerSeen.add(u);
    }
    setCreateUserSubmitting(true);
    setError(null);
    const created: AdminUser[] = [];
    const failLines: string[] = [];
    for (const row of rows) {
      const pw = row.password.trim() || generateRandomImportPassword();
      const un = row.username.trim();
      const nz = row.nameZh.trim();
      const ne = row.nameEn.trim();
      const dept = row.department.trim() || null;
      const ps = row.primarySubject.trim() || null;
      try {
        const user = await createUser({
          username: un,
          nameZh: nz || null,
          nameEn: ne || null,
          role: row.role,
          password: pw,
          department: dept,
          primarySubject: ps,
        });
        created.push(user);
      } catch (err: unknown) {
        failLines.push(`${un}: ${(err as Error)?.message || 'error'}`);
      }
    }
    if (created.length > 0) {
      setUsers((prev) => [...created, ...prev]);
    }
    if (failLines.length > 0) {
      setError(
        isZh
          ? `部分创建失败：\n${failLines.join('\n')}`
          : `Some rows failed:\n${failLines.join('\n')}`,
      );
    }
    if (failLines.length === 0) {
      setCreateUserDialogOpen(false);
      setCreateUserDraftRows([]);
    }
    setCreateUserSubmitting(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const editableUserIds = useMemo(
    () => new Set(usersShownInUsersSection.filter((u) => canEditUser(u)).map((u) => u.id)),
    [usersShownInUsersSection, currentUser?.role],
  );

  const toggleSelectAll = () => {
    const allEditableSelected = editableUserIds.size > 0 && Array.from(editableUserIds).every((id) => selectedIds.has(id));
    if (allEditableSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(editableUserIds));
  };

  const handleBatchDepartment = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeptLoading(true);
    setError(null);
    try {
      const dept = batchDepartment.trim() || null;
      await batchUpdateDepartment(Array.from(selectedIds), dept);
      setUsers((prev) =>
        prev.map((u) => (selectedIds.has(u.id) ? { ...u, department: dept } : u)),
      );
      setSelectedIds(new Set());
      setBatchDepartment('');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update departments');
    } finally {
      setBatchDeptLoading(false);
    }
  };

  const handleDepartmentChange = async (user: AdminUser, newDept: string | null) => {
    const value = newDept === '' ? null : newDept;
    try {
      await updateUserDepartment(user.id, value);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, department: value } : u)));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update department');
    }
  };

  const handlePrimarySubjectChange = async (user: AdminUser, newVal: string | null) => {
    try {
      await updateUserPrimarySubject(user.id, newVal);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, primarySubject: newVal } : u)));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update primary subject');
    }
  };

  const handleStaffNameEnBlur = async (user: AdminUser, nameEn: string | null) => {
    const prevEn = (user.nameEn ?? '').trim() || null;
    if (nameEn === prevEn) return;
    setError(null);
    try {
      await updateUserStaffNameFields(user.id, { nameEn });
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== user.id) return u;
          const nz = (u.nameZh ?? '').trim() || null;
          const ne = nameEn;
          const displayName = nz || ne || u.username;
          return { ...u, nameEn: ne, displayName };
        }),
      );
    } catch (e: unknown) {
      setError((e as Error)?.message || (isZh ? '保存英文名失败' : 'Failed to save English name'));
    }
  };

  const handleRoleChange = async (user: AdminUser, newRole: 'admin' | 'teacher') => {
    if (user.role === newRole) return;
    try {
      await updateUserRole(user.id, newRole);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update role');
    }
  };

  const openDeleteConfirm = (user: AdminUser) => {
    setDeleteTarget(user);
    setDeleteConfirmInput('');
  };
  const closeDeleteConfirm = () => {
    setDeleteTarget(null);
    setDeleteConfirmInput('');
  };
  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleteConfirmInput !== deleteTarget.username) return;
    setDeleteLoading(true);
    setError(null);
    try {
      await deleteUser(deleteTarget.id, deleteConfirmInput);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      closeDeleteConfirm();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete user');
    } finally {
      setDeleteLoading(false);
    }
  };

  const openStudentLoginDialog = async () => {
    if (!USE_CLOUD_STORAGE) return;
    setStudentLoginBusy(true);
    setStudentLoginPhase('preview');
    setStudentLoginResult(null);
    setError(null);
    try {
      const list = await loadStudents();
      const withNumber = list.filter((s) => s.studentNumber != null && String(s.studentNumber).trim() !== '');
      setStudentLoginPreview(
        withNumber.map((s) => ({
          studentId: s.id,
          nameZh: s.nameZh ?? '',
          nameEn: s.nameEn ?? '',
          studentNumber: String(s.studentNumber).trim(),
          password: randomSixDigitPassword(),
        })),
      );
      setStudentLoginOpen(true);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load students');
    } finally {
      setStudentLoginBusy(false);
    }
  };

  const confirmStudentLoginImport = async () => {
    if (studentLoginPreview.length === 0) return;
    setStudentLoginBusy(true);
    setError(null);
    try {
      const { created, skipped } = await importStudentAccounts(
        studentLoginPreview.map((r) => ({ studentId: r.studentId, password: r.password })),
      );
      setStudentLoginResult({ created: created.length, skipped: skipped.length });
      setStudentLoginPhase('done');
      if (adminTab === 'users' && userListScope === 'students') {
        const next = await loadUsers('students');
        setUsers(next);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Import failed');
    } finally {
      setStudentLoginBusy(false);
    }
  };

  const closeStudentLoginDialog = () => {
    setStudentLoginOpen(false);
    setStudentLoginPreview([]);
    setStudentLoginPhase('preview');
    setStudentLoginResult(null);
  };

  const createEmptySubject = () => ({
    courseId: '',
    subjectKey: '',
    subjectNameZh: '',
    subjectNameEn: '',
    moduleType: 'subject_score' as const,
    enableScore: true,
    enableLearningQuality: true,
    enableTeacherComment: true,
    /** 学业报告预览中三项默认开启；无维度时保存前需关闭目标维度或补全维度 */
    enableTarget: true,
    scorePreview: '',
    commentPreview: '',
    scoreVisibility: 'teacher_homeroom_admin' as const,
    dimensions: [] as Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions: Partial<Record<TargetLevel, string>>;
    }>,
  });

  const toReportSettingSubjectDraft = (subject: {
    courseId?: string;
    subjectKey?: string;
    subjectNameZh: string;
    subjectNameEn: string;
    enableScore?: boolean;
    enableLearningQuality?: boolean;
    enableTeacherComment?: boolean;
    enableTarget?: boolean;
    dimensions?: Array<{
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions?: Partial<Record<TargetLevel, string>>;
    }>;
    gradeDimensions?: Array<{
      gradeId: string;
      dimensions: Array<{
        dimensionLabelZh: string;
        dimensionLabelEn: string;
        levelDescriptions?: Partial<Record<TargetLevel, string>>;
      }>;
    }>;
  }): ReportSettingSubjectDraft => {
    const mapDim = (d: {
      dimensionLabelZh: string;
      dimensionLabelEn: string;
      levelDescriptions?: Partial<Record<TargetLevel, string>>;
    }) => ({
      dimensionLabelZh: d.dimensionLabelZh ?? '',
      dimensionLabelEn: d.dimensionLabelEn ?? '',
      levelDescriptions: d.levelDescriptions ?? {},
    });
    const flat = (subject.dimensions ?? []).map(mapDim);
    const rows = subject.gradeDimensions ?? [];
    let fromGrades: typeof flat = [];
    if (rows.length > 0) {
      let best = rows[0].dimensions ?? [];
      for (let i = 1; i < rows.length; i += 1) {
        const d = rows[i].dimensions ?? [];
        if (d.length > best.length) best = d;
      }
      fromGrades = (best ?? []).map(mapDim);
    }
    const flatHasLabels = flat.some((d) => (d.dimensionLabelZh ?? '').trim() || (d.dimensionLabelEn ?? '').trim());
    const dimensions = flatHasLabels ? flat : fromGrades.length > 0 ? fromGrades : flat;
    let enableTarget: boolean;
    if (subject.enableTarget === false) {
      enableTarget = false;
    } else if (subject.enableTarget === true) {
      enableTarget = true;
    } else {
      enableTarget = dimensions.length > 0;
    }
    if (enableTarget && dimensions.length === 0) {
      enableTarget = false;
    }
    return {
      ...createEmptySubject(),
      courseId: subject.courseId ?? '',
      subjectKey: subject.subjectKey ?? '',
      subjectNameZh: subject.subjectNameZh ?? '',
      subjectNameEn: subject.subjectNameEn ?? '',
      enableScore: subject.enableScore !== false,
      enableLearningQuality: subject.enableLearningQuality !== false,
      enableTeacherComment: subject.enableTeacherComment !== false,
      enableTarget,
      dimensions,
    };
  };
  const createEmptyPresetDimension = (): PresetGradeDimensionDraft => ({
    dimensionLabelZh: '',
    dimensionLabelEn: '',
    levelDescriptions: {},
  });
  const markSubjectTargetDirty = (subjectKey: string) => {
    setReportTargetDirtySubjectKeys((prev) => {
      const next = new Set(prev);
      next.add(subjectKey);
      return next;
    });
  };

  /** 学年学科目标预设：学科列表与课程管理一致，已保存配置按 courseId / subjectKey 覆盖 */
  const mergeYearPresetSubjectsWithCourses = useCallback(
    (preset: ReportYearDimensionPreset | null, courses: Course[]): ReportSettingSubjectDraft[] => {
      const unifiedResolved = fullUnifiedLevelTextFromPreset(preset?.unifiedLevelDescriptions);
      const injectUnified = (draft: ReportSettingSubjectDraft): ReportSettingSubjectDraft => {
        if (!draft.enableTarget || draft.dimensions.length === 0) return draft;
        return {
          ...draft,
          dimensions: draft.dimensions.map((d) => ({
            ...d,
            levelDescriptions: {
              A: unifiedResolved.A,
              B: unifiedResolved.B,
              C: unifiedResolved.C,
              D: unifiedResolved.D,
            },
          })),
        };
      };
      /** 学业报告预览：学习品质 / 评价维度 / 学科评语默认开启；测评成绩由考试学科设置决定 */
      const withAcademicPreviewDefaults = (draft: ReportSettingSubjectDraft): ReportSettingSubjectDraft => ({
        ...draft,
        enableLearningQuality: true,
        enableTeacherComment: true,
        enableTarget: true,
      });
      if (courses.length === 0) {
        return (preset?.subjects ?? []).map((s) => withAcademicPreviewDefaults(injectUnified(toReportSettingSubjectDraft(s))));
      }
      const sorted = sortCoursesLikeCurriculumRoadmap(courses, loadCategoryOrder());
      const byCourse = new Map<string, ReportYearDimensionPresetSubject>();
      const byKey = new Map<string, ReportYearDimensionPresetSubject>();
      for (const sub of preset?.subjects ?? []) {
        const cid = String(sub.courseId ?? '').trim();
        if (cid) byCourse.set(cid, sub);
        const k = String(sub.subjectKey ?? '').trim();
        if (k) byKey.set(k, sub);
      }
      const presetConfigured = (preset?.subjects ?? []).length > 0;
      const mapCourse = (c: Course) => {
        const sk = staffingSubjectKeyFromCourse(c.id, c.name);
        const { subjectNameZh, subjectNameEn } = getCourseReportSubjectLabels(c);
        const saved = byCourse.get(c.id) ?? byKey.get(sk);
        if (saved) {
          return withAcademicPreviewDefaults(
            injectUnified(
              toReportSettingSubjectDraft({
                ...saved,
                courseId: c.id,
                subjectKey: sk,
                subjectNameZh: subjectNameZh || saved.subjectNameZh,
                subjectNameEn: subjectNameEn || saved.subjectNameEn,
              }),
            ),
          );
        }
        return withAcademicPreviewDefaults(
          injectUnified(
            toReportSettingSubjectDraft({
              courseId: c.id,
              subjectKey: sk,
              subjectNameZh,
              subjectNameEn,
            }),
          ),
        );
      };
      if (presetConfigured) {
        return sorted
          .map((c) => {
            const sk = staffingSubjectKeyFromCourse(c.id, c.name);
            const saved = byCourse.get(c.id) ?? byKey.get(sk);
            if (!saved) return null;
            return mapCourse(c);
          })
          .filter((row): row is ReportSettingSubjectDraft => row !== null);
      }
      return sorted.map((c) => mapCourse(c));
    },
    [],
  );

  /** 学科目标设置 / 新建报告（有学年预设）：学科行与课程管理同步，课程列表异步到达后自动合并 */
  useEffect(() => {
    if (!createEvaluationOpen || !USE_CLOUD_STORAGE) return;
    if (createEvaluationMode === 'preset' || createEvaluationMode === 'exam') return;
    if ((createEvaluationMode === 'create' || createEvaluationMode === 'edit') && !reportYearDimensionPreset) {
      return;
    }
    const resolveEnableScoreFromExam = (subjects: ReportSettingSubjectDraft[]) => {
      const segId = newReportSchoolSegmentId.trim();
      const seg = reportTargetSegments.find((s) => s.id === segId);
      if (!seg) return subjects.map((s) => ({ ...s, enableScore: false }));
      const previewGid = newReportPreviewGradeId.trim();
      return subjects.map((s) => {
        const cid = String(s.courseId ?? '').trim();
        if (!cid) return { ...s, enableScore: false };
        const enableScore = previewGid
          ? isExamGradeIncluded(
              reportSettingTerm,
              segId,
              cid,
              previewGid,
              seg.gradeIds,
              reportYearDimensionPreset?.stageInclusion,
              reportYearDimensionPreset?.evaluationGradeInclusion,
              reportYearDimensionPreset?.examGradeInclusion,
              reportYearDimensionPreset?.examConfigs,
            )
          : courseIdsWithExamGrades(
              reportSettingTerm,
              segId,
              seg.gradeIds,
              reportYearDimensionPreset?.stageInclusion,
              reportYearDimensionPreset?.evaluationGradeInclusion,
              reportYearDimensionPreset?.examGradeInclusion,
              reportYearDimensionPreset?.examConfigs,
            ).includes(cid);
        return { ...s, enableScore };
      });
    };
    if (createEvaluationMode === 'edit') {
      setReportSettingSubjects((prev) => resolveEnableScoreFromExam(prev));
      return;
    }
    const merged = mergeYearPresetSubjectsWithCourses(reportYearDimensionPreset, evaluationDesignerCourses);
    const withExamDefaults = resolveEnableScoreFromExam(merged);
    setReportSettingSubjects(withExamDefaults);
    setPresetEditingSubjectKey((prev) => {
      if (createEvaluationMode !== 'preset') return prev;
      if (withExamDefaults.length === 0) return '';
      const idx = prev.startsWith('idx-') ? Number(prev.slice(4)) : NaN;
      if (Number.isFinite(idx) && idx >= 0 && idx < withExamDefaults.length) return prev;
      return 'idx-0';
    });
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    newReportSchoolSegmentId,
    reportSettingTerm,
    reportYearDimensionPreset,
    evaluationDesignerCourses,
    mergeYearPresetSubjectsWithCourses,
    newReportPreviewGradeId,
    reportTargetSegments,
  ]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset') return;
    const firstStageId = reportTargetSegments[0]?.id ?? '';
    setReportTargetStageId((prev) => prev || firstStageId);
    const persisted = (reportYearDimensionPreset?.subjects ?? []) as ReportYearDimensionPresetSubject[];
    setReportTargetPersistedSubjects(persisted);
    setReportTargetDirtySubjectKeys(new Set());
    const nextGradeConfigBySubject: Record<string, PresetSubjectGradeConfig> = {};
    persisted.forEach((subject) => {
      const subjectKey = String(subject.subjectKey ?? '').trim();
      if (!subjectKey) return;
      const gradeRows = Array.isArray(subject.gradeDimensions) ? subject.gradeDimensions : [];
      const mapByGrade: PresetSubjectGradeConfig = {};
      gradeRows.forEach((row) => {
        const gradeId = String(row.gradeId ?? '').trim();
        if (!gradeId) return;
        mapByGrade[gradeId] = (row.dimensions ?? []).map((d) => ({
          dimensionLabelZh: d.dimensionLabelZh ?? '',
          dimensionLabelEn: d.dimensionLabelEn ?? '',
          levelDescriptions: {} as Partial<Record<TargetLevel, string>>,
        }));
      });
      if (Object.keys(mapByGrade).length > 0) {
        nextGradeConfigBySubject[subjectKey] = mapByGrade;
      }
    });
    setReportTargetGradeConfigBySubject(nextGradeConfigBySubject);
  }, [createEvaluationOpen, createEvaluationMode, reportYearDimensionPreset, reportTargetSegments]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'exam') return;
    const firstStageId = reportTargetSegments[0]?.id ?? '';
    setReportTargetStageId((prev) => prev || firstStageId);
  }, [createEvaluationOpen, createEvaluationMode, reportTargetSegments]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'exam' || !reportTargetCurrentSegment) return;
    const pool = getEffectiveStageCheckedCourseIds(
      reportTargetCurrentSegment,
      reportTargetStageId,
      reportYearDimensionPreset,
      evaluationDesignerCourses,
    );
    setReportTargetCheckedCourseIds(pool);
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportTargetStageId,
    reportTargetCurrentSegment,
    reportYearDimensionPreset?.stageInclusion,
    evaluationDesignerCourses,
    reportTargetGradeConfigSyncKey,
  ]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset' || !reportTargetCurrentSegment) return;
    const seg = reportTargetCurrentSegment;
    const stageKey = reportTargetStageId.trim();
    const presetGradeMap = reportYearDimensionPreset?.evaluationGradeInclusion?.[stageKey];
    setReportTargetEvaluationGradeByCourse((prev) => {
      const next: Record<string, string[]> = {};
      for (const cid of reportTargetCheckedCourseIds) {
        if (presetGradeMap && presetGradeMap[cid] !== undefined) {
          next[cid] = presetGradeMap[cid];
        } else if (prev[cid] !== undefined) {
          next[cid] = prev[cid];
        } else {
          next[cid] = resolveEvaluationGradesForCourse(
            reportTargetStageId,
            cid,
            seg.gradeIds,
            reportYearDimensionPreset?.stageInclusion,
            reportYearDimensionPreset?.evaluationGradeInclusion,
          );
        }
      }
      return next;
    });
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportTargetCheckedCourseIds,
    reportTargetStageId,
    reportTargetCurrentSegment,
    reportYearDimensionPreset?.stageInclusion,
    reportYearDimensionPreset?.evaluationGradeInclusion,
  ]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'exam') return;
    const seg = reportTargetCurrentSegment;
    if (!seg) return;
    const evalCourseIds = courseIdsWithEvaluationGrades(
      reportTargetStageId,
      seg.gradeIds,
      reportYearDimensionPreset?.stageInclusion,
      reportYearDimensionPreset?.evaluationGradeInclusion,
    );
    const poolSet = new Set(evalCourseIds);
    const scopeKey = examScopeKey(reportSettingTerm, reportTargetStageId);
    const stored = reportYearDimensionPreset?.examGradeInclusion?.[scopeKey];
    const legacy =
      stored == null
        ? inferExamGradeInclusionFromLegacyScope(
            scopeKey,
            reportYearDimensionPreset?.examConfigs,
            seg.gradeIds,
          )
        : {};
    const byCourse: Record<string, string[]> = {};
    for (const cid of evalCourseIds) {
      const evalGrades = resolveEvaluationGradesForCourse(
        reportTargetStageId,
        cid,
        seg.gradeIds,
        reportYearDimensionPreset?.stageInclusion,
        reportYearDimensionPreset?.evaluationGradeInclusion,
      );
      const raw = stored?.[cid] ?? legacy[cid];
      byCourse[cid] =
        raw !== undefined
          ? raw.filter((g) => evalGrades.includes(g))
          : [];
    }
    setReportExamGradeByCourse(byCourse);
    const savedInclusion = (reportExamScope?.subjectInclusion ?? []).filter((id) => poolSet.has(id));
    const checked =
      reportExamScope != null
        ? savedInclusion
        : Object.entries(byCourse)
            .filter(([, grades]) => grades.length > 0)
            .map(([cid]) => cid)
            .filter((cid) => poolSet.has(cid));
    setReportExamCheckedCourseIds(checked);
    const stageIds = new Set(evalCourseIds);
    const draftsByCourse: Record<string, ExamSubjectConfigDraft> = {};
    (reportExamScope?.subjects ?? []).forEach((s) => {
      const cid = String(s.courseId ?? '').trim();
      if (!cid || !stageIds.has(cid)) return;
      const gradeConfigs: Record<string, ExamGradeConfigDraft> = {};
      (s.gradeConfigs ?? []).forEach((g) => {
        const gid = String(g.gradeId ?? '').trim();
        if (!gid) return;
        const draft = createEmptyExamGradeDraft();
        for (const rg of REPORT_SCORE_LETTER_GRADES) {
          const val = (g.percentBands ?? {})[rg as ReportGrade];
          if (Number.isFinite(Number(val))) {
            draft.percentBands[rg as ReportGrade] = String(val);
          }
        }
        draft.dimensionScores = (g.dimensionScores ?? []).map((d) => ({
          dimensionLabelZh: d.dimensionLabelZh ?? '',
          dimensionLabelEn: d.dimensionLabelEn ?? '',
          score: Number.isFinite(Number(d.score)) ? String(d.score) : '',
        }));
        gradeConfigs[gid] = draft;
      });
      draftsByCourse[cid] = {
        courseId: cid,
        subjectKey: String(s.subjectKey ?? '').trim(),
        subjectNameZh: String(s.subjectNameZh ?? '').trim(),
        subjectNameEn: String(s.subjectNameEn ?? '').trim(),
        gradeConfigs,
      };
    });
    setReportExamConfigByCourse(draftsByCourse);
    setReportExamActiveCourseId((prev) => (prev && checked.includes(prev) ? prev : checked[0] ?? ''));
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportExamScope,
    reportTargetStageCourses,
    reportTargetCheckedCourseIds,
    reportTargetCurrentSegment,
    reportTargetStageId,
    reportSettingTerm,
    reportYearDimensionPreset,
  ]);

  const presetTargetGradeDimsReloadKey = useMemo(
    () =>
      JSON.stringify(
        (reportYearDimensionPreset?.subjects ?? []).map((s) => ({
          k: s.subjectKey,
          gd: s.gradeDimensions,
        })),
      ),
    [reportYearDimensionPreset?.subjects],
  );

  const reportTargetUnifiedPresetKey = useMemo(
    () => JSON.stringify(reportYearDimensionPreset?.unifiedLevelDescriptions ?? {}),
    [reportYearDimensionPreset?.unifiedLevelDescriptions],
  );
  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset') return;
    setReportTargetUnifiedLevel(fullUnifiedLevelTextFromPreset(reportYearDimensionPreset?.unifiedLevelDescriptions));
  }, [createEvaluationOpen, createEvaluationMode, reportTargetUnifiedPresetKey]);

  const reportTargetStageInclusionKey = useMemo(
    () => JSON.stringify(reportYearDimensionPreset?.stageInclusion ?? {}),
    [reportYearDimensionPreset?.stageInclusion],
  );
  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset') return;
    if (reportTargetStageCourses.length === 0) {
      setReportTargetCheckedCourseIds([]);
      presetTargetChecklistStageRef.current = null;
      return;
    }
    if (!reportTargetCurrentSegment) {
      setReportTargetCheckedCourseIds([]);
      presetTargetChecklistStageRef.current = null;
      return;
    }
    const stageIds = new Set(reportTargetStageCourses.map((c) => c.id));
    const rawForStage = reportYearDimensionPreset?.stageInclusion?.[reportTargetStageId];
    if (rawForStage !== undefined) {
      presetTargetChecklistStageRef.current = reportTargetStageId;
      setReportTargetCheckedCourseIds(rawForStage.filter((id) => stageIds.has(id)));
      return;
    }
    const inferred = inferStageInclusionCourseIdsForSegment(
      reportTargetCurrentSegment,
      reportYearDimensionPreset,
      evaluationDesignerCourses,
    );
    const stageSwitched = presetTargetChecklistStageRef.current !== reportTargetStageId;
    presetTargetChecklistStageRef.current = reportTargetStageId;
    setReportTargetCheckedCourseIds((prev) => {
      const prevFiltered = prev.filter((id) => stageIds.has(id));
      if (stageSwitched || prevFiltered.length === 0) {
        return inferred;
      }
      return prevFiltered;
    });
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportTargetStageId,
    reportTargetStageInclusionKey,
    reportTargetCurrentSegment,
    reportYearDimensionPreset,
    evaluationDesignerCourses,
    reportTargetGradeConfigSyncKey,
  ]);
  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset') return;
    if (reportTargetStageCourses.length === 0) {
      setReportTargetActiveSubjectKey('');
      return;
    }
    const checkedSet = new Set(reportTargetCheckedCourseIds);
    setReportTargetActiveSubjectKey((prev) => {
      const stillOk = reportTargetStageCourses.some(
        (c) => checkedSet.has(c.id) && staffingSubjectKeyFromCourse(c.id, c.name) === prev,
      );
      if (stillOk) return prev;
      const first = reportTargetStageCourses.find((c) => checkedSet.has(c.id));
      return first ? staffingSubjectKeyFromCourse(first.id, first.name) : '';
    });
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportTargetStageCourses,
    reportTargetCheckedCourseIds,
  ]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset') return;
    const cid = pendingOpenPresetFocusCourseIdRef.current;
    if (!cid) return;
    const stageIds = new Set(reportTargetStageCourses.map((c) => c.id));
    if (!stageIds.has(cid)) return;
    pendingOpenPresetFocusCourseIdRef.current = null;
    const course = reportTargetStageCourses.find((c) => c.id === cid);
    if (!course) return;
    const sk = staffingSubjectKeyFromCourse(course.id, course.name);
    setReportTargetCheckedCourseIds((prev) => {
      const filtered = prev.filter((id) => stageIds.has(id));
      if (filtered.includes(cid)) return filtered;
      return [...filtered, cid];
    });
    setReportTargetActiveSubjectKey(sk);
  }, [createEvaluationOpen, createEvaluationMode, reportTargetStageCourses, reportTargetStageId]);

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'preset') return;
    const sk = reportTargetActiveSubjectKey;
    if (!sk) return;
    const navKey = `${sk}|${reportTargetStageId}`;
    const presetKey = presetTargetGradeDimsReloadKey;
    const prevNav = lastPresetTargetDimNavKeyRef.current;
    if (prevNav.nav === navKey && prevNav.preset === presetKey) return;
    lastPresetTargetDimNavKeyRef.current = { nav: navKey, preset: presetKey };
    const seg = reportTargetSegments.find((s) => s.id === reportTargetStageId);
    const gids = seg?.gradeIds ?? [];
    const cfg = reportTargetGradeConfigBySubjectRef.current[sk];
    const maxL = gids.reduce((m, gid) => Math.max(m, (cfg?.[gid] ?? []).length), 0);
    setPresetTargetDimTableColumnCount(Math.max(PRESET_TARGET_DEFAULT_DIMENSION_COLS, maxL));
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    reportTargetActiveSubjectKey,
    reportTargetStageId,
    reportTargetSegments,
    presetTargetGradeDimsReloadKey,
  ]);

  const addReportTemplateSubject = () => {
    const next = createEmptySubject();
    setReportSettingSubjects((prev) => {
      const idx = prev.length;
      setPresetEditingSubjectKey(`idx-${idx}`);
      return [...prev, next];
    });
  };

  const addModuleToDesigner = (moduleKey: EvaluationDesignerModule) => {
    setEnabledEvaluationModules((prev) => ({ ...prev, [moduleKey]: true }));
    setEvaluationModuleOrder((prev) => (prev.includes(moduleKey) ? prev : [...prev, moduleKey]));
    if (moduleKey === 'subject_evaluation') {
      setReportSettingSubjects((prev) => (prev.length > 0 ? prev : [createEmptySubject()]));
    }
  };

  const removeModuleFromDesigner = (moduleKey: EvaluationDesignerModule) => {
    setEnabledEvaluationModules((prev) => ({ ...prev, [moduleKey]: false }));
    setEvaluationModuleOrder((prev) => prev.filter((k) => k !== moduleKey));
    if (moduleKey === 'homeroom_comment') {
      setReportSettingHomeroomCommentMode('optional');
    }
    if (moduleKey === 'subject_evaluation') {
      setReportSettingSubjects([]);
    }
  };

  const moveModuleCard = (moduleKey: EvaluationDesignerModule, direction: 'up' | 'down') => {
    setEvaluationModuleOrder((prev) => {
      const idx = prev.indexOf(moduleKey);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const toReportGrade = (rawScore: string): ReportGrade | null => {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) return null;
    const mins = designerScoreMinScores ?? defaultReportScoreGradeMinScores();
    return reportLetterGradeFromScore(score, mins);
  };

  const addReportTemplateDimension = (subjectIdx: number) => {
    setReportSettingSubjects((prev) => {
      const next = [...prev];
      const subject = next[subjectIdx];
      if (!subject) return prev;
      const nextDimensions = [
        ...subject.dimensions,
        { dimensionLabelZh: '', dimensionLabelEn: '', levelDescriptions: {} },
      ];
      next[subjectIdx] = { ...subject, dimensions: nextDimensions };
      return next;
    });
  };
  const getPresetStageGradeIds = useCallback((): string[] => {
    if (!reportTargetCurrentSegment) return [];
    return reportTargetCurrentSegment.gradeIds;
  }, [reportTargetCurrentSegment]);
  const ensurePresetSubjectGradeConfig = useCallback((subjectKey: string): PresetSubjectGradeConfig => {
    const existing = reportTargetGradeConfigBySubject[subjectKey];
    const next: PresetSubjectGradeConfig = { ...(existing ?? {}) };
    const stageGradeIds = getPresetStageGradeIds();
    stageGradeIds.forEach((gid) => {
      let arr = [...(next[gid] ?? [])];
      if (arr.length === 0) {
        arr = Array.from({ length: PRESET_TARGET_DEFAULT_DIMENSION_COLS }, () => createEmptyPresetDimension());
      }
      next[gid] = arr;
    });
    return next;
  }, [reportTargetGradeConfigBySubject, getPresetStageGradeIds]);
  const updatePresetSubjectGradeConfig = useCallback((subjectKey: string, updater: (prev: PresetSubjectGradeConfig) => PresetSubjectGradeConfig) => {
    setReportTargetGradeConfigBySubject((prev) => {
      const current = prev[subjectKey] ?? {};
      const nextValue = updater(current);
      return { ...prev, [subjectKey]: nextValue };
    });
    markSubjectTargetDirty(subjectKey);
  }, []);
  const removePresetTargetDimensionColumn = useCallback(
    (subjectKey: string, columnIndex: number) => {
      const stageGradeIds = getPresetStageGradeIds();
      if (stageGradeIds.length === 0 || columnIndex < 0) return;
      let newDataMax = 0;
      updatePresetSubjectGradeConfig(subjectKey, (prevGlobal) => {
        const next: PresetSubjectGradeConfig = { ...prevGlobal };
        for (const gid of stageGradeIds) {
          const existing = [...(next[gid] ?? [])];
          const seededLength = Math.max(
            existing.length,
            PRESET_TARGET_DEFAULT_DIMENSION_COLS,
            presetTargetDimTableColumnCount,
          );
          const arr = Array.from({ length: seededLength }, (_, i) => existing[i] ?? createEmptyPresetDimension());
          if (columnIndex < arr.length) arr.splice(columnIndex, 1);
          next[gid] = arr;
          newDataMax = Math.max(newDataMax, arr.length);
        }
        return next;
      });
      setPresetTargetDimTableColumnCount((c) => Math.max(1, c - 1, newDataMax));
    },
    [getPresetStageGradeIds, updatePresetSubjectGradeConfig, presetTargetDimTableColumnCount],
  );
  const saveCurrentSubjectTargetSettings = useCallback(async () => {
    if (!reportSettingYearId || !reportTargetActiveSubject) return;
    const subject = reportTargetActiveSubject;
    const subjectKey = subject.subjectKey;
    const stageGradeIds = getPresetStageGradeIds();
    if (stageGradeIds.length === 0) {
      setEvaluationDesignerError(isZh ? '当前学段未配置年级，无法保存。' : 'No grades found in selected stage.');
      return;
    }
    const courseId = String(subject.courseId ?? '').trim();
    const evalGradeIds =
      reportTargetEvaluationGradeByCourse[courseId]
      ?? resolveEvaluationGradesForCourse(
        reportTargetStageId,
        courseId,
        stageGradeIds,
        reportYearDimensionPreset?.stageInclusion,
        reportYearDimensionPreset?.evaluationGradeInclusion,
      );
    const merged = ensurePresetSubjectGradeConfig(subjectKey);
    const gradeDimensions = stageGradeIds.map((gid) => ({
      gradeId: gid,
      dimensions: (merged[gid] ?? [])
        .map((d) => ({
          dimensionLabelZh: d.dimensionLabelZh.trim(),
          dimensionLabelEn: (d.dimensionLabelEn || d.dimensionLabelZh).trim(),
          levelDescriptions: {} as Partial<Record<TargetLevel, string>>,
        }))
        .filter((d) => d.dimensionLabelZh && d.dimensionLabelEn),
    }));
    const gradeDimensionsForSave = gradeDimensions.filter((row) => evalGradeIds.includes(row.gradeId));
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    for (let i = 0; i < gradeDimensionsForSave.length; i += 1) {
      const row = gradeDimensionsForSave[i];
      if (row.dimensions.length === 0) {
        const gradeLabel = getGradeLabelByLevel(gc, getGradeLevelById(gc, row.gradeId));
        setEvaluationDesignerError(
          isZh
            ? `${subject.subjectNameZh}：${gradeLabel} 至少需要填写一个目标维度名称后再保存。`
            : `${subject.subjectNameEn}: add at least one target dimension for ${gradeLabel}.`,
        );
        return;
      }
    }
    const dimensionsForReportFallback =
      gradeDimensionsForSave.find((g) => g.dimensions.length > 0)
      ?? gradeDimensions.find((g) => g.dimensions.length > 0);
    const subjectPayload: ReportYearDimensionPresetSubject = {
      courseId: subject.courseId,
      subjectKey: subject.subjectKey,
      subjectNameZh: subject.subjectNameZh,
      subjectNameEn: subject.subjectNameEn,
      enableScore: false,
      enableTeacherComment: false,
      enableTarget: gradeDimensions.some((g) => g.dimensions.length > 0),
      /** 保留各年级维度草稿；是否纳入学业报告由 evaluationGradeInclusion 控制 */
      gradeDimensions,
      dimensions: dimensionsForReportFallback?.dimensions ?? [],
    };
    const withoutCurrent = reportTargetPersistedSubjects.filter((s) => s.subjectKey !== subjectPayload.subjectKey);
    const nextSubjects = [...withoutCurrent, subjectPayload];
    const evaluationGradesForCourse = [...evalGradeIds];
    const nextEvaluationGradeInclusion = {
      ...(reportYearDimensionPreset?.evaluationGradeInclusion ?? {}),
      [reportTargetStageId]: {
        ...(reportYearDimensionPreset?.evaluationGradeInclusion?.[reportTargetStageId] ?? {}),
        ...(courseId ? { [courseId]: evaluationGradesForCourse } : {}),
      },
    };
    setReportYearPresetSaving(true);
    setEvaluationDesignerError(null);
    try {
      await api.upsertAdminReportYearDimensionPreset({
        academicYearId: reportSettingYearId,
        homeroomCommentMode: 'disabled',
        subjects: nextSubjects,
        evaluationGradeInclusion: nextEvaluationGradeInclusion,
        unifiedLevelDescriptions: unifiedLevelToApiPayload(reportTargetUnifiedLevel),
      });
      setReportTargetPersistedSubjects(nextSubjects);
      setReportYearDimensionPreset((prev) =>
        prev
          ? {
              ...prev,
              subjects: nextSubjects,
              evaluationGradeInclusion: nextEvaluationGradeInclusion,
              unifiedLevelDescriptions: unifiedLevelToApiPayload(reportTargetUnifiedLevel),
            }
          : null,
      );
      if (courseId) {
        setReportTargetEvaluationGradeByCourse((prev) => ({
          ...prev,
          [courseId]: evaluationGradesForCourse,
        }));
      }
      setReportTargetDirtySubjectKeys((prev) => {
        const next = new Set(prev);
        next.delete(subjectKey);
        return next;
      });
      const savedCourseId = String(subject.courseId ?? '').trim();
      const rawInc = reportYearDimensionPreset?.stageInclusion?.[reportTargetStageId.trim()];
      if (rawInc === undefined && savedCourseId) {
        setReportTargetCheckedCourseIds((prev) => {
          const stageIds = new Set(reportTargetStageCourses.map((c) => c.id));
          if (!stageIds.has(savedCourseId)) return prev;
          if (prev.includes(savedCourseId)) return prev;
          return [...prev, savedCourseId];
        });
      }
      setEvaluationDesignerError(isZh ? `已保存「${subject.subjectNameZh}」目标设置。` : `Saved targets for ${subject.subjectNameEn}.`);
    } catch (e: unknown) {
      setEvaluationDesignerError((e as Error)?.message || (isZh ? '保存当前学科设置失败' : 'Failed to save current subject settings'));
    } finally {
      setReportYearPresetSaving(false);
    }
  }, [
    reportSettingYearId,
    reportTargetActiveSubject,
    getPresetStageGradeIds,
    ensurePresetSubjectGradeConfig,
    reportTargetPersistedSubjects,
    reportTargetUnifiedLevel,
    reportYearDimensionPreset?.stageInclusion,
    reportTargetStageId,
    reportTargetStageCourses,
    reportTargetEvaluationGradeByCourse,
    reportYearDimensionPreset?.evaluationGradeInclusion,
    isZh,
  ]);

  const saveReportTargetStageInclusion = useCallback(async () => {
    if (!reportSettingYearId) return;
    setReportTargetInclusionSaving(true);
    setEvaluationDesignerError(null);
    try {
      const seg = reportTargetCurrentSegment;
      const nextInclusion = {
        ...(reportYearDimensionPreset?.stageInclusion ?? {}),
        [reportTargetStageId]: reportTargetCheckedCourseIds,
      };
      const gradeMap: Record<string, string[]> = {};
      for (const cid of reportTargetCheckedCourseIds) {
        gradeMap[cid] =
          reportTargetEvaluationGradeByCourse[cid]
          ?? (seg ? [...seg.gradeIds] : []);
      }
      const nextEvaluationGradeInclusion = {
        ...(reportYearDimensionPreset?.evaluationGradeInclusion ?? {}),
        [reportTargetStageId]: gradeMap,
      };
      await api.upsertAdminReportYearDimensionPreset({
        academicYearId: reportSettingYearId,
        homeroomCommentMode: 'disabled',
        subjects: reportTargetPersistedSubjects,
        stageInclusion: nextInclusion,
        evaluationGradeInclusion: nextEvaluationGradeInclusion,
        unifiedLevelDescriptions: unifiedLevelToApiPayload(reportTargetUnifiedLevel),
      });
      await loadReportYearDimensionPreset(reportSettingYearId);
      setEvaluationDesignerError(isZh ? '已保存参与学业报告的学科。' : 'Saved subjects included in the academic report.');
    } catch (e: unknown) {
      setEvaluationDesignerError(
        (e as Error)?.message || (isZh ? '保存参与学科失败' : 'Failed to save subject inclusion'),
      );
    } finally {
      setReportTargetInclusionSaving(false);
    }
  }, [
    reportSettingYearId,
    reportYearDimensionPreset?.stageInclusion,
    reportTargetStageId,
    reportTargetCheckedCourseIds,
    reportTargetEvaluationGradeByCourse,
    reportTargetCurrentSegment,
    reportTargetPersistedSubjects,
    reportTargetUnifiedLevel,
    loadReportYearDimensionPreset,
    isZh,
  ]);

  const saveReportTargetUnifiedFromDialog = useCallback(async () => {
    if (!reportSettingYearId) return;
    setReportTargetUnifiedDialogSaving(true);
    setEvaluationDesignerError(null);
    try {
      await api.upsertAdminReportYearDimensionPreset({
        academicYearId: reportSettingYearId,
        homeroomCommentMode: 'disabled',
        subjects: reportTargetPersistedSubjects,
        unifiedLevelDescriptions: unifiedLevelToApiPayload(reportTargetUnifiedDraft),
      });
      setReportTargetUnifiedLevel({ ...reportTargetUnifiedDraft });
      setReportYearDimensionPreset((prev) =>
        prev
          ? {
              ...prev,
              unifiedLevelDescriptions: unifiedLevelToApiPayload(reportTargetUnifiedDraft),
            }
          : null,
      );
      setReportTargetUnifiedEditOpen(false);
      setEvaluationDesignerError(isZh ? '已保存等第说明。' : 'Saved shared level descriptions.');
    } catch (e: unknown) {
      setEvaluationDesignerError((e as Error)?.message || (isZh ? '保存等第说明失败' : 'Failed to save rubric'));
    } finally {
      setReportTargetUnifiedDialogSaving(false);
    }
  }, [reportSettingYearId, reportTargetPersistedSubjects, reportTargetUnifiedDraft, isZh]);

  const persistReportExamScopeWithMessage = useCallback(
    async (successMessage: string) => {
      if (!reportSettingYearId || !reportTargetCurrentSegment) return;
      setReportExamSaving(true);
      setEvaluationDesignerError(null);
      try {
        const key = examScopeKey(reportSettingTerm, reportTargetStageId);
        const existingScope = reportYearDimensionPreset?.examConfigs?.[key];
        const evalPoolSet = new Set(
          courseIdsWithEvaluationGrades(
            reportTargetStageId,
            reportTargetCurrentSegment.gradeIds,
            reportYearDimensionPreset?.stageInclusion,
            reportYearDimensionPreset?.evaluationGradeInclusion,
          ),
        );
        const examCourseIds = reportExamCheckedCourseIds.filter((id) => evalPoolSet.has(id));
        const examGradeInclusionForScope: Record<string, string[]> = {};
        for (const cid of examCourseIds) {
          const evalGrades = resolveEvaluationGradesForCourse(
            reportTargetStageId,
            cid,
            reportTargetCurrentSegment.gradeIds,
            reportYearDimensionPreset?.stageInclusion,
            reportYearDimensionPreset?.evaluationGradeInclusion,
          );
          const picked = (reportExamGradeByCourse[cid] ?? []).filter((g) => evalGrades.includes(g));
          if (picked.length > 0) examGradeInclusionForScope[cid] = picked;
        }
        const nextExamGradeInclusion = {
          ...(reportYearDimensionPreset?.examGradeInclusion ?? {}),
          [key]: examGradeInclusionForScope,
        };
        const scopeSubjects = mergeExamScopeSubjectsForPersist({
          checkedCourseIds: examCourseIds,
          draftsByCourse: reportExamConfigByCourse,
          existingSubjects: existingScope?.subjects,
          segment: reportTargetCurrentSegment,
          courses: evaluationDesignerCourses,
          examGradeByCourse: reportExamGradeByCourse,
        });
        const nextExamConfigs: Record<string, ReportExamConfigScope> = {
          ...(reportYearDimensionPreset?.examConfigs ?? {}),
          [key]: {
            subjectInclusion: examCourseIds,
            subjects: scopeSubjects,
          },
        };
        await api.upsertAdminReportYearDimensionPreset({
          academicYearId: reportSettingYearId,
          homeroomCommentMode: 'disabled',
          subjects: reportTargetPersistedSubjects,
          stageInclusion: reportYearDimensionPreset?.stageInclusion,
          examGradeInclusion: nextExamGradeInclusion,
          examConfigs: nextExamConfigs,
          unifiedLevelDescriptions: unifiedLevelToApiPayload(reportTargetUnifiedLevel),
        });
        setReportYearDimensionPreset((prev) =>
          prev
            ? { ...prev, examConfigs: nextExamConfigs, examGradeInclusion: nextExamGradeInclusion }
            : prev,
        );
        setEvaluationDesignerError(successMessage);
      } catch (e: unknown) {
        setEvaluationDesignerError((e as Error)?.message || (isZh ? '保存考试学科设置失败' : 'Failed to save exam settings'));
      } finally {
        setReportExamSaving(false);
      }
    },
    [
      reportSettingYearId,
      reportTargetCurrentSegment,
      reportSettingTerm,
      reportTargetStageId,
      reportExamCheckedCourseIds,
      reportExamGradeByCourse,
      reportExamConfigByCourse,
      evaluationDesignerCourses,
      reportYearDimensionPreset,
      reportTargetPersistedSubjects,
      reportTargetUnifiedLevel,
      isZh,
    ],
  );

  const saveReportExamSettings = useCallback(async () => {
    await persistReportExamScopeWithMessage(isZh ? '已保存考试学科设置。' : 'Saved exam subject settings.');
  }, [persistReportExamScopeWithMessage, isZh]);

  const saveReportExamActiveSubjectSettings = useCallback(async () => {
    if (!reportExamActiveCourseId.trim()) {
      setEvaluationDesignerError(isZh ? '请先选择一门学科再保存。' : 'Select a subject before saving.');
      return;
    }
    await persistReportExamScopeWithMessage(isZh ? '已保存本学科考试设置。' : 'Saved this subject’s exam settings.');
  }, [persistReportExamScopeWithMessage, reportExamActiveCourseId, isZh]);

  const useSimplifiedAcademicTargetPreview = useMemo(
    () =>
      USE_CLOUD_STORAGE &&
      createEvaluationOpen &&
      createEvaluationMode !== 'preset' &&
      createEvaluationMode !== 'exam' &&
      (reportYearDimensionPreset?.subjects?.length ?? 0) > 0,
    [createEvaluationOpen, createEvaluationMode, reportYearDimensionPreset?.subjects],
  );

  const reportSettingSubjectEntries = useMemo(() => {
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    const gid = newReportPreviewGradeId.trim();
    const previewGradeLevel = gid ? getGradeLevelById(gc, gid) : null;

    if (!useSimplifiedAcademicTargetPreview) {
      const base = reportSettingSubjects.map((subject, idx) => ({ subject, idx }));
      if (previewGradeLevel === null) return base;
      return base.filter(({ subject }) => {
        const cid = String(subject.courseId ?? '').trim();
        if (!cid) return true;
        const c = evaluationDesignerCourses.find((x) => x.id === cid);
        return c ? courseAppliesToGrade(c, previewGradeLevel, gc) : false;
      });
    }
    const seg = reportTargetSegments.find((s) => s.id === newReportSchoolSegmentId.trim());
    if (!seg) return [] as Array<{ subject: ReportSettingSubjectDraft; idx: number }>;
    const checkedSet = new Set(
      getEffectiveEvaluationCourseIdsForPreview(
        seg,
        newReportSchoolSegmentId,
        reportYearDimensionPreset,
        evaluationDesignerCourses,
        newReportPreviewGradeId.trim() || undefined,
      ),
    );
    const withSegmentTargets = courseIdsWithPersistedSegmentTargetDimensions(seg, reportYearDimensionPreset);
    const out: Array<{ subject: ReportSettingSubjectDraft; idx: number }> = [];
    reportSettingSubjects.forEach((subject, idx) => {
      const cid = String(subject.courseId ?? '').trim();
      if (!cid || !checkedSet.has(cid) || !withSegmentTargets.has(cid)) return;
      if (previewGradeLevel !== null) {
        const c = evaluationDesignerCourses.find((x) => x.id === cid);
        if (!c || !courseAppliesToGrade(c, previewGradeLevel, gc)) return;
      }
      out.push({ subject, idx });
    });
    return out;
  }, [
    useSimplifiedAcademicTargetPreview,
    reportSettingSubjects,
    newReportSchoolSegmentId,
    newReportPreviewGradeId,
    reportTargetSegments,
    reportYearDimensionPreset,
    evaluationDesignerCourses,
    reportTargetStageInclusionKey,
    reportTargetGradeConfigSyncKey,
  ]);

  const reportSettingSubjectsInSelectedSegment = useMemo(
    () => reportSettingSubjectEntries.map((e) => e.subject),
    [reportSettingSubjectEntries],
  );

  useEffect(() => {
    if (!createEvaluationOpen || createEvaluationMode !== 'create' || !useSimplifiedAcademicTargetPreview) {
      homeroomPreviewLastSegmentIdRef.current = null;
      return;
    }
    const seg = newReportSchoolSegmentId.trim();
    const prev = homeroomPreviewLastSegmentIdRef.current;
    homeroomPreviewLastSegmentIdRef.current = seg;
    if (prev !== null && prev !== seg) {
      setHomeroomCommentPreview('');
      setAcademicPreviewTargetLevels({});
      setAcademicPreviewLearningQuality({});
    }
  }, [
    createEvaluationOpen,
    createEvaluationMode,
    useSimplifiedAcademicTargetPreview,
    newReportSchoolSegmentId,
  ]);

  /** 学业报告预览与模块顺序：学科评价在前，班主任综合评价在后 */
  const evaluationModuleOptions: Array<{
    key: EvaluationDesignerModule;
    title: string;
    description: string;
  }> = [
    {
      key: 'subject_evaluation',
      title: isZh ? '学科评价' : 'Subject evaluation',
      description: '',
    },
    {
      key: 'homeroom_comment',
      title: isZh ? '班主任综合评价' : 'Homeroom evaluation',
      description: isZh ? '用于填写班主任综合评价。' : 'Homeroom summary evaluation.',
    },
  ];

  const hasSubjectEvaluationEnabled = enabledEvaluationModules.subject_evaluation;

  const deriveEnabledModulesFromTemplate = (
    homeroomMode: HomeroomCommentMode,
    subjects: Array<{ enableScore: boolean; enableTeacherComment: boolean; dimensions: unknown[] }>,
  ): Record<EvaluationDesignerModule, boolean> => ({
    homeroom_comment: homeroomMode !== 'disabled',
    subject_evaluation: subjects.length > 0,
  });

  const deriveModuleOrderFromEnabled = (enabled: Record<EvaluationDesignerModule, boolean>) => (
    evaluationModuleOptions
      .map((m) => m.key)
      .filter((k) => enabled[k])
  );

  const activeEvaluationModules = evaluationModuleOrder.filter((m) => enabledEvaluationModules[m]);

  const inactiveEvaluationModules = evaluationModuleOptions.filter((m) => !enabledEvaluationModules[m.key]);

  const buildTemplateSubjectsByModules = () => {
    if (!hasSubjectEvaluationEnabled) return [];
    const source = useSimplifiedAcademicTargetPreview
      ? reportSettingSubjectsInSelectedSegment
      : reportSettingSubjects;
    return source.map((s) => {
      const normalizedModuleType: 'subject_score' | 'subject_comment' | 'non_score_comment' = s.enableScore
        ? 'subject_score'
        : (s.enableTeacherComment ? 'subject_comment' : 'non_score_comment');
      const subjectKey =
        String(s.subjectKey ?? '').trim()
        || (s.courseId ? staffingSubjectKeyFromCourse(s.courseId, s.subjectNameEn || s.subjectNameZh || '') : '');
      return {
        subjectKey: subjectKey || undefined,
        subjectNameZh: s.subjectNameZh,
        subjectNameEn: s.subjectNameEn,
        moduleType: normalizedModuleType,
        enableScore: s.enableScore,
        enableLearningQuality: s.enableLearningQuality,
        enableTeacherComment: s.enableTeacherComment,
        scoreVisibility: s.scoreVisibility,
        dimensions: s.enableTarget ? s.dimensions : [],
      };
    });
  };

  const validateSubjectEvaluationBeforeSave = (): string | null => {
    if (!hasSubjectEvaluationEnabled) return null;
    const rows = useSimplifiedAcademicTargetPreview
      ? reportSettingSubjectsInSelectedSegment
      : reportSettingSubjects;
    if (rows.length === 0) {
      if (!useSimplifiedAcademicTargetPreview || reportSettingSubjects.length === 0) {
        return isZh
          ? '已启用「学科评价」，但课程设置中暂无课程。请先在课程管理中维护课程后再保存。'
          : 'Subject evaluation is on, but there are no courses in curriculum. Add courses in course settings first.';
      }
      return null;
    }
    const usedKeys = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const s = rows[i];
      const hasCourse = String(s.courseId ?? '').trim();
      const legacy = !hasCourse && String(s.subjectKey ?? '').trim() && String(s.subjectNameZh ?? '').trim();
      if (!hasCourse && !legacy) {
        return isZh
          ? `第 ${i + 1} 个学科请从「课程设置」中选择一门课程（用于与岗位安排对齐）。`
          : `Subject #${i + 1}: pick a course from the curriculum list (required for staffing alignment).`;
      }
      if (!String(s.subjectNameZh ?? '').trim() || !String(s.subjectNameEn ?? '').trim()) {
        return isZh ? `第 ${i + 1} 个学科缺少名称，请重新选择课程。` : `Subject #${i + 1} is missing names; re-select the course.`;
      }
      const sk =
        String(s.subjectKey ?? '').trim()
        || (s.courseId ? staffingSubjectKeyFromCourse(s.courseId, s.subjectNameEn || '') : '');
      if (sk) {
        if (usedKeys.has(sk)) {
          return isZh ? `学科「${sk}」在模板中重复，请选择不同课程。` : `Duplicate subject key in template: ${sk}`;
        }
        usedKeys.add(sk);
      }
      if (s.enableTarget && s.dimensions.length === 0) {
        return isZh ? `第 ${i + 1} 个学科已开启“目标达成”，请至少添加一个维度。` : `Subject #${i + 1} has target enabled. Add at least one dimension.`;
      }
    }
    return null;
  };

  const saveReportTemplate = async (): Promise<boolean> => {
    if (!USE_CLOUD_STORAGE) {
      setEvaluationDesignerError(isZh ? '学业报告模板需开启云端模式（VITE_USE_CLOUD_STORAGE=true）并连接 API。' : 'Report templates require cloud mode and API.');
      return false;
    }
    if (!selectedReportTemplateId) return false;
    const validationError = validateSubjectEvaluationBeforeSave();
    if (validationError) {
      setEvaluationDesignerError(validationError);
      return false;
    }
    setReportSettingSaving(true);
    setEvaluationDesignerError(null);
    try {
      await api.upsertAdminReportTemplate({
        templateId: selectedReportTemplateId,
        title: reportSettingTitle || null,
        status: reportSettingStatus,
        homeroomCommentMode: enabledEvaluationModules.homeroom_comment ? reportSettingHomeroomCommentMode : 'disabled',
        subjects: buildTemplateSubjectsByModules(),
      });
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      await loadReportTemplateSetting(selectedReportTemplateId);
      return true;
    } catch (e: unknown) {
      setEvaluationDesignerError((e as Error)?.message || (isZh ? '保存报告失败' : 'Failed to save report template'));
      return false;
    } finally {
      setReportSettingSaving(false);
    }
  };

  const createEvaluationTemplate = async (): Promise<boolean> => {
    if (!reportSettingYearId) return false;
    const validationError = validateSubjectEvaluationBeforeSave();
    if (validationError) {
      setEvaluationDesignerError(validationError);
      return false;
    }
    if (reportTargetSegments.length > 0 && !newReportSchoolSegmentId.trim()) {
      setEvaluationDesignerError(isZh ? '请选择学段后再新建学业报告。' : 'Select a school segment before creating the report.');
      return false;
    }
    setReportSettingSaving(true);
    setEvaluationDesignerError(null);
    try {
      const created = await api.createAdminReportTemplate({
        academicYearId: reportSettingYearId,
        term: reportSettingTerm,
        title: createEvaluationTitle.trim() || null,
        sourceTemplateId: createEvaluationFromTemplateId || null,
        schoolSegmentId: newReportSchoolSegmentId.trim() || null,
      });
      if (created.id) {
        await api.upsertAdminReportTemplate({
          templateId: created.id,
          title: createEvaluationTitle.trim() || null,
          status: 'draft',
          homeroomCommentMode: enabledEvaluationModules.homeroom_comment ? reportSettingHomeroomCommentMode : 'disabled',
          subjects: buildTemplateSubjectsByModules(),
        });
      }
      setEvaluationDesignerError(null);
      setCreateEvaluationOpen(false);
      setCreateEvaluationTitle('');
      setCreateEvaluationFromTemplateId('');
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (created.id) {
        setSelectedReportTemplateId(created.id);
        await loadReportTemplateSetting(created.id);
      }
      return true;
    } catch (e: unknown) {
      setEvaluationDesignerError((e as Error)?.message || (isZh ? '创建报告失败' : 'Failed to create evaluation template'));
      return false;
    } finally {
      setReportSettingSaving(false);
    }
  };

  const openCreateEvaluationDesigner = async () => {
    setCreateEvaluationMode('create');
    setEvaluationDesignerError(null);
    setReportSettingSubjects([]);
    setPresetEditingSubjectKey('');
    setCreateEvaluationTitle('');
    setReportSettingTitle('');
    setCreateEvaluationFromTemplateId('');
    setNewReportSchoolSegmentId(reportTargetSegments[0]?.id ?? '');
    setReportSettingHomeroomCommentMode('optional');
    const defaultModules = {
      homeroom_comment: true,
      subject_evaluation: true,
    } as Record<EvaluationDesignerModule, boolean>;
    setEnabledEvaluationModules(defaultModules);
    setEvaluationModuleOrder(deriveModuleOrderFromEnabled(defaultModules));
    setCreateEvaluationOpen(true);
  };

  const openSubjectEvaluationSettings = async () => {
    if (!reportSettingYearId) return;
    setCreateEvaluationMode('preset');
    setEvaluationDesignerError(null);
    setReportTargetStageId('');
    setReportTargetCheckedCourseIds([]);
    setReportTargetActiveSubjectKey('');
    setReportTargetGradeConfigBySubject({});
    setReportTargetDirtySubjectKeys(new Set());
    setReportTargetPersistedSubjects([]);
    setReportSettingSubjects([]);
    setPresetEditingSubjectKey('');
    setCreateEvaluationOpen(true);
    setCreateEvaluationTitle(isZh ? '本学年学科目标维度框架' : 'Yearly subject target framework');
    setReportSettingTitle('');
    setCreateEvaluationFromTemplateId('');
    const subjectOnly = {
      homeroom_comment: false,
      subject_evaluation: true,
    } as Record<EvaluationDesignerModule, boolean>;
    setEnabledEvaluationModules(subjectOnly);
    setEvaluationModuleOrder(deriveModuleOrderFromEnabled(subjectOnly));
    setReportSettingHomeroomCommentMode('optional');
  };

  const openExamSubjectSettings = async () => {
    if (!reportSettingYearId) return;
    setCreateEvaluationMode('exam');
    setEvaluationDesignerError(null);
    setReportTargetStageId(reportTargetSegments[0]?.id ?? '');
    setReportExamCheckedCourseIds([]);
    setReportExamActiveCourseId('');
    setReportExamConfigByCourse({});
    setCreateEvaluationOpen(true);
  };

  useEffect(() => {
    if (!scoreBandDialogOpen || !USE_CLOUD_STORAGE || !reportSettingYearId || !scoreBandSegmentId.trim()) return;
    let cancelled = false;
    setScoreBandLoading(true);
    void api
      .getAdminReportScoreGradeBands({
        academicYearId: reportSettingYearId,
        term: reportSettingTerm,
        schoolSegmentId: scoreBandSegmentId.trim(),
      })
      .then((r) => {
        if (cancelled) return;
        const d: Record<string, string> = {};
        for (const g of REPORT_SCORE_LETTER_GRADES) {
          d[g] = String((r.minScores as Record<string, number>)[g] ?? '');
        }
        setScoreBandDraft(d);
      })
      .catch(() => {
        if (cancelled) return;
        const def = defaultReportScoreGradeMinScores();
        const d: Record<string, string> = {};
        for (const g of REPORT_SCORE_LETTER_GRADES) d[g] = String(def[g]);
        setScoreBandDraft(d);
      })
      .finally(() => {
        if (!cancelled) setScoreBandLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scoreBandDialogOpen, reportSettingYearId, reportSettingTerm, scoreBandSegmentId]);

  const saveScoreGradeBands = async () => {
    if (!reportSettingYearId || !scoreBandSegmentId.trim()) return;
    const nums: Partial<Record<ReportGrade, number>> = {};
    for (const g of REPORT_SCORE_LETTER_GRADES) {
      const n = Number(scoreBandDraft[g]);
      if (!Number.isFinite(n)) {
        setError(isZh ? `「${g}」得分下限无效` : `Invalid min score for ${g}`);
        return;
      }
      nums[g as ReportGrade] = n;
    }
    setScoreBandSaving(true);
    setError(null);
    try {
      await api.putAdminReportScoreGradeBands({
        academicYearId: reportSettingYearId,
        term: reportSettingTerm,
        schoolSegmentId: scoreBandSegmentId.trim(),
        minScores: nums,
      });
      setScoreBandDialogOpen(false);
    } catch (e: unknown) {
      setError((e as Error)?.message || (isZh ? '保存分数等第失败' : 'Failed to save score bands'));
    } finally {
      setScoreBandSaving(false);
    }
  };

  const openEditEvaluationDesigner = async (templateId: string) => {
    setCreateEvaluationMode('edit');
    setEvaluationDesignerError(null);
    setCreateEvaluationOpen(true);
    setSelectedReportTemplateId(templateId);
    const tpl = await loadReportTemplateSetting(templateId);
    const initialTitle = tpl?.title ?? '';
    setCreateEvaluationTitle(initialTitle);
    setReportSettingTitle(initialTitle);
    setPresetEditingSubjectKey((tpl?.subjects?.length ?? 0) > 0 ? 'idx-0' : '');
  };

  const submitEvaluationDesigner = async () => {
    if (createEvaluationMode === 'preset') {
      setCreateEvaluationOpen(false);
      return;
    }
    if (createEvaluationMode === 'exam') {
      setCreateEvaluationOpen(false);
      return;
    }
    if (createEvaluationMode === 'edit') {
      const ok = await saveReportTemplate();
      if (ok) setCreateEvaluationOpen(false);
      return;
    }
    await createEvaluationTemplate();
  };

  const setTemplateStatus = async (templateId: string, nextStatus: ReportTemplateStatus) => {
    if (!templateId) return;
    setReportSettingSaving(true);
    setError(null);
    try {
      if (nextStatus === 'published') await api.publishAdminReportTemplate(templateId);
      if (nextStatus === 'closed') await api.closeAdminReportTemplate(templateId);
      if (nextStatus === 'draft') {
        const tpl = await api.getAdminReportTemplate(templateId);
        await api.upsertAdminReportTemplate({
          templateId,
          title: tpl.title ?? null,
          status: 'draft',
          homeroomCommentMode: tpl.homeroomCommentMode,
          subjects: (tpl.subjects ?? []).map((s) => ({
            subjectKey: s.subjectKey,
            subjectNameZh: s.subjectNameZh || s.subjectName,
            subjectNameEn: s.subjectNameEn || s.subjectName,
            moduleType: s.moduleType,
            enableScore: s.enableScore,
            enableLearningQuality: s.enableLearningQuality !== false,
            enableTeacherComment: s.enableTeacherComment,
            scoreVisibility: s.scoreVisibility,
            dimensions: (s.dimensions ?? []).map((d) => ({
              dimensionLabelZh: d.dimensionLabelZh || d.dimensionLabel,
              dimensionLabelEn: d.dimensionLabelEn || d.dimensionLabel,
              levelDescriptions: d.levelDescriptions ?? {},
            })),
          })),
        });
      }
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (selectedReportTemplateId === templateId) {
        await loadReportTemplateSetting(templateId);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to update template status');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const releaseTemplateToStudents = async (templateId: string) => {
    if (!templateId) return;
    setReportSettingSaving(true);
    setError(null);
    try {
      await api.releaseAdminReportTemplate(templateId);
      await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (selectedReportTemplateId === templateId) {
        await loadReportTemplateSetting(templateId);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to release report template');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const openProgressConfirm = async (templateId: string, templateTitle: string | null) => {
    if (!templateId) return;
    setProgressConfirmOpen(true);
    setProgressLoading(true);
    setProgressData(null);
    setProgressTemplateTitle(templateTitle || (isZh ? '未命名评价' : 'Untitled evaluation'));
    setError(null);
    try {
      const progress = await api.getAdminReportTemplateProgress(templateId);
      setProgressData(progress);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load report progress');
    } finally {
      setProgressLoading(false);
    }
  };

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || adminTab !== 'report-settings' || reportSettingPortraitTab !== 'academic' || !reportSettingYearId) {
      setTermReportOverallRate(null);
      setTermReportOverallLoading(false);
      return;
    }
    const ids = reportTemplateList.map((t) => t.id).filter(Boolean) as string[];
    if (ids.length === 0) {
      setTermReportOverallRate(null);
      setTermReportOverallLoading(false);
      return;
    }
    let cancelled = false;
    setTermReportOverallLoading(true);
    Promise.all(ids.map((id) => api.getAdminReportTemplateProgress(id).catch(() => null)))
      .then((list) => {
        if (cancelled) return;
        let tot = 0;
        let done = 0;
        for (const p of list) {
          if (!p) continue;
          tot += p.totalStudents;
          done += p.completedStudents;
        }
        setTermReportOverallRate(tot > 0 ? Number(((done / tot) * 100).toFixed(1)) : 0);
      })
      .finally(() => {
        if (!cancelled) setTermReportOverallLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminTab, reportSettingPortraitTab, reportSettingYearId, reportSettingTerm, reportTemplateList]);

  const remindTeachers = async (message: string) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setError(isZh ? '提醒文案已复制，可直接粘贴发送给老师。' : 'Reminder message copied. Paste to send to teachers.');
      window.setTimeout(() => setError((prev) => (
        prev === (isZh ? '提醒文案已复制，可直接粘贴发送给老师。' : 'Reminder message copied. Paste to send to teachers.')
          ? null
          : prev
      )), 1800);
    } catch {
      setError(isZh ? '复制失败，请手动复制提醒文案。' : 'Copy failed. Please copy the reminder manually.');
    }
  };

  const normalizeSubjectKey = (input: string): string => {
    const normalized = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    return normalized || 'subject';
  };

  const upsertStaffingAssignment = async (input: {
    academicYearId: string;
    classId: string;
    subjectKey: string;
    subjectName: string;
    teacherId: string | null;
    teacherSlot?: 0 | 1;
    coTeaching: boolean;
  }) => {
    const teacherSlot: 0 | 1 = input.teacherSlot === 1 ? 1 : 0;
    const key = `${input.classId}::${input.subjectKey}::${teacherSlot}`;
    setStaffingSavingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setError(null);
    try {
      if (!input.teacherId) {
        if (input.coTeaching) {
          await api.deleteAdminStaffingAssignment({
            academicYearId: input.academicYearId,
            classId: input.classId,
            subjectKey: input.subjectKey,
            teacherSlot,
          });
        } else {
          await api.deleteAdminStaffingAssignment({
            academicYearId: input.academicYearId,
            classId: input.classId,
            subjectKey: input.subjectKey,
          });
        }
        const cleared = await api.getAdminStaffingAssignments(input.academicYearId);
        setStaffingAssignments(cleared);
        return;
      }
      await api.upsertAdminStaffingAssignment({
        academicYearId: input.academicYearId,
        classId: input.classId,
        subjectKey: input.subjectKey,
        subjectName: input.subjectName,
        teacherId: input.teacherId,
        teacherSlot,
      });
      const refreshed = await api.getAdminStaffingAssignments(input.academicYearId);
      setStaffingAssignments(refreshed);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save staffing assignment');
    } finally {
      setStaffingSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const deleteEvaluationTemplate = async (templateId: string) => {
    if (!templateId) return;
    const ok = window.confirm(
      isZh
        ? '确认删除这个评价模板？删除后不可恢复。'
        : 'Delete this evaluation template? This action cannot be undone.',
    );
    if (!ok) return;
    setReportSettingSaving(true);
    setError(null);
    try {
      await api.deleteAdminReportTemplate(templateId);
      const chosen = await loadReportTemplateList(reportSettingYearId, reportSettingTerm);
      if (selectedReportTemplateId === templateId) {
        setSelectedReportTemplateId(chosen || '');
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to delete evaluation template');
    } finally {
      setReportSettingSaving(false);
    }
  };

  const staffingClassList = useMemo(
    () => allClasses
      .filter((c) => c.academicYearId === staffingYearId)
      .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)),
    [allClasses, staffingYearId],
  );

  /** 与课程管理 / 课程河流整体视图一致：按全局 categoryOrder + 学科分组展开为列 */
  const curriculumCategoryOrderKey =
    adminTab === 'staffing' ? JSON.stringify(loadCategoryOrder()) : '';
  const staffingCourseColumns = useMemo(() => {
    const sorted = sortCoursesLikeCurriculumRoadmap(staffingCourses, loadCategoryOrder());
    return sorted.map((course) => ({
      course,
      key: normalizeSubjectKey(course.id || course.name),
      name: getSubjectCategoryText(course.subjectCategory, language) || course.name,
    }));
  }, [staffingCourses, curriculumCategoryOrderKey, staffingCategoryOrderNonce, language]);

  const staffingAssignmentsMap = useMemo(() => {
    const map = new Map<string, StaffingAssignment>();
    staffingAssignments.forEach((assignment) => {
      const slot: 0 | 1 = assignment.teacherSlot === 1 ? 1 : 0;
      map.set(`${assignment.classId}::${assignment.subjectKey}::${slot}`, assignment);
    });
    return map;
  }, [staffingAssignments]);

  /** 年级配置变化时岗位学段划分与周课时需重算 */
  const staffingGradeConfigSyncKey =
    adminTab === 'staffing' ? JSON.stringify(normalizeGradeConfig(loadGradeConfigSync())) : '';

  /** 按学段分块；无学段配置时退化为单块「全校」；每块首列为班主任岗位 */
  const staffingSegmentBlocks = useMemo(() => {
    const norm = normalizeGradeConfig(loadGradeConfigSync());
    const hasSeg = gradeConfigHasSegments(norm);
    const segmentsOrdered = getRoadmapSegmentsInDisplayOrder(norm);
    const homeroomCol = {
      kind: 'homeroom' as const,
      key: STAFFING_HOMEROOM_SUBJECT_KEY,
      name: isZh ? '班主任' : 'Homeroom',
    };

    const buildColumnsForGradeIds = (gradeIds: string[]) =>
      staffingCourseColumns.filter((col) =>
        gradeIds.some((gid) => {
          const lv = getGradeLevelById(norm, gid);
          return courseAppliesToGrade(col.course, lv, norm);
        }),
      );

    if (!hasSeg || segmentsOrdered.length === 0) {
      return [
        {
          key: '__all__' as const,
          title: '',
          classes: staffingClassList,
          columns: [
            homeroomCol,
            ...staffingCourseColumns.map((c) => ({ kind: 'course' as const, course: c.course, key: c.key, name: c.name })),
          ],
        },
      ];
    }

    return segmentsOrdered.map((seg) => ({
      key: seg.id,
      title: seg.label,
      classes: staffingClassList.filter((cls) => {
        const gid = getGradeIdByLevel(norm, cls.grade);
        return seg.gradeIds.includes(gid);
      }),
      columns: [
        homeroomCol,
        ...buildColumnsForGradeIds(seg.gradeIds).map((c) => ({ kind: 'course' as const, course: c.course, key: c.key, name: c.name })),
      ],
    }));
  }, [
    staffingClassList,
    staffingCourseColumns,
    staffingGradeConfigSyncKey,
    curriculumCategoryOrderKey,
    staffingCategoryOrderNonce,
    isZh,
  ]);

  const staffingRosterSheetsForExcel = useMemo(
    () => buildStaffingRosterSheetsFromBlocks(staffingSegmentBlocks, isZh),
    [staffingSegmentBlocks, isZh],
  );

  const staffingAssignmentsForExcel = useMemo(() => {
    const m = new Map<string, { teacherId: string }>();
    for (const a of staffingAssignments) {
      const slot: 0 | 1 = a.teacherSlot === 1 ? 1 : 0;
      m.set(`${a.classId}::${a.subjectKey}::${slot}`, { teacherId: a.teacherId });
    }
    return m;
  }, [staffingAssignments]);

  const staffingTeachersForExcel = useMemo(
    (): StaffingRosterTeacherRef[] =>
      staffingTeachers.map((t) => ({
        id: t.id,
        nameZh: (t.nameZh ?? '').trim(),
        nameEn: (t.nameEn ?? '').trim(),
        displayName: (t.displayName ?? '').trim(),
        username: t.username,
      })),
    [staffingTeachers],
  );

  const handleStaffingRosterExport = () => {
    const year = allYears.find((y) => y.id === staffingYearId);
    downloadStaffingRosterExport({
      academicYearLabel: year?.name ?? staffingYearId,
      sheets: staffingRosterSheetsForExcel,
      assignments: staffingAssignmentsForExcel,
      teachers: staffingTeachersForExcel,
      gradeConfig: normalizeGradeConfig(loadGradeConfigSync()),
      isZh,
    });
  };

  const handleStaffingRosterExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !staffingYearId) return;
    e.target.value = '';
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseStaffingRosterWorkbook(buf, {
        academicYearId: staffingYearId,
        sheets: staffingRosterSheetsForExcel,
        allClasses: staffingClassList,
        courses: staffingCourses,
        teachers: staffingTeachersForExcel,
        gradeConfig: loadGradeConfigSync(),
        isZh,
      });
      if (parsed.errors.length > 0) {
        const head = parsed.errors.slice(0, 12).join('\n');
        const tail = parsed.errors.length > 12 ? (isZh ? '\n…' : '\n…') : '';
        alert((isZh ? '导入失败：\n' : 'Import failed:\n') + head + tail);
        return;
      }
      if (parsed.operations.length === 0) {
        alert(isZh ? '未解析到可导入的数据行。' : 'No rows to import.');
        return;
      }
      if (parsed.warnings.length > 0) {
        const ok = window.confirm(
          `${isZh ? '提示：\n' : 'Notice:\n'}${parsed.warnings.slice(0, 10).join('\n')}${parsed.warnings.length > 10 ? '\n…' : ''}\n\n${isZh ? '是否继续导入？' : 'Continue import?'}`,
        );
        if (!ok) return;
      }
      setStaffingExcelImporting(true);
      for (const op of parsed.operations) {
        if (!op.teacherId) {
          if (op.coTeaching) {
            await api.deleteAdminStaffingAssignment({
              academicYearId: op.academicYearId,
              classId: op.classId,
              subjectKey: op.subjectKey,
              teacherSlot: op.teacherSlot,
            });
          } else {
            await api.deleteAdminStaffingAssignment({
              academicYearId: op.academicYearId,
              classId: op.classId,
              subjectKey: op.subjectKey,
            });
          }
        } else {
          await api.upsertAdminStaffingAssignment({
            academicYearId: op.academicYearId,
            classId: op.classId,
            subjectKey: op.subjectKey,
            subjectName: op.subjectName,
            teacherId: op.teacherId,
            teacherSlot: op.teacherSlot,
          });
        }
      }
      const refreshed = await api.getAdminStaffingAssignments(staffingYearId);
      setStaffingAssignments(refreshed);
      alert(
        isZh
          ? `已导入 ${parsed.operations.length} 条岗位记录。`
          : `Imported ${parsed.operations.length} assignment(s).`,
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || (isZh ? '导入失败' : 'Import failed'));
    } finally {
      setStaffingExcelImporting(false);
    }
  };

  /** 周课时统计：逐条任课单元（用于按学科分组与明细文案） */
  const staffingLoadLineItems = useMemo((): StaffingLoadLineItem[] => {
    const gc = normalizeGradeConfig(loadGradeConfigSync());
    const items: StaffingLoadLineItem[] = [];
    for (const a of staffingAssignments) {
      if (!a.teacherId || a.academicYearId !== staffingYearId) continue;
      const cls = staffingClassList.find((c) => c.id === a.classId);
      const col = staffingCourseColumns.find((c) => c.key === a.subjectKey);
      if (!cls || !col) continue;
      const slot = a.teacherSlot === 1 ? 1 : 0;
      if (slot === 1 && !col.course.coTeaching) continue;
      if (!courseAppliesToGrade(col.course, cls.grade, gc)) continue;
      const periods = getWeeklyPeriodsForGrade(col.course, cls.grade, gc);
      if (periods <= 0) continue;
      const subjectCategoryKey = getCategoryCanonicalKey(col.course.subjectCategory) || col.course.name;
      const subjectCategoryLabel = getSubjectCategoryText(col.course.subjectCategory, language) || subjectCategoryKey;
      items.push({
        teacherId: a.teacherId,
        subjectCategoryKey,
        subjectCategoryLabel,
        courseKey: col.key,
        courseDisplayName: col.name,
        className: cls.name,
        gradeLevel: cls.grade,
        periods,
      });
    }
    items.sort((x, y) => {
      const g = x.gradeLevel - y.gradeLevel;
      if (g !== 0) return g;
      const c = x.className.localeCompare(y.className, undefined, { numeric: true });
      if (c !== 0) return c;
      return (x.courseDisplayName || '').localeCompare(y.courseDisplayName || '');
    });
    return items;
  }, [
    staffingAssignments,
    staffingYearId,
    staffingClassList,
    staffingCourseColumns,
    staffingGradeConfigSyncKey,
    curriculumCategoryOrderKey,
    staffingCategoryOrderNonce,
    language,
  ]);

  /** 全校周课时表：原始行（含主学科，未应用筛选/排序） */
  const staffingLoadGrandRowsBase = useMemo(() => {
    const byTeacher = new Map<string, StaffingLoadLineItem[]>();
    for (const it of staffingLoadLineItems) {
      const arr = byTeacher.get(it.teacherId);
      if (arr) arr.push(it);
      else byTeacher.set(it.teacherId, [it]);
    }
    const rows = staffingTeachers.map((t) => {
      const list = (byTeacher.get(t.id) ?? []).sort((a, b) => {
        const c = a.subjectCategoryKey.localeCompare(b.subjectCategoryKey);
        if (c !== 0) return c;
        const g = a.gradeLevel - b.gradeLevel;
        if (g !== 0) return g;
        return a.className.localeCompare(b.className, undefined, { numeric: true });
      });
      const total = list.reduce((s, x) => s + x.periods, 0);
      const detail = formatStaffingLoadBreakdownByCategory(list, language);
      const zh = (t.nameZh ?? '').trim();
      const en = (t.nameEn ?? '').trim();
      const primaryRaw = (t.primarySubject ?? '').trim();
      const primarySubjectKey = primaryRaw ? primaryRaw : STAFFING_LOAD_PRIMARY_NONE;
      const primarySubjectLabel = formatPrimarySubjectCell(isZh, primaryRaw || null);
      return {
        teacherId: t.id,
        teacherName: zh || en || t.displayName || t.username,
        primarySubjectKey,
        primarySubjectLabel,
        detail,
        total,
      };
    });
    return rows;
  }, [staffingLoadLineItems, staffingTeachers, language, isZh]);

  const staffingLoadGrandPrimaryFilterOptions = useMemo(() => {
    const keys = [...new Set(staffingLoadGrandRowsBase.map((r) => r.primarySubjectKey))];
    keys.sort((a, b) => {
      if (a === STAFFING_LOAD_PRIMARY_NONE && b !== STAFFING_LOAD_PRIMARY_NONE) return 1;
      if (b === STAFFING_LOAD_PRIMARY_NONE && a !== STAFFING_LOAD_PRIMARY_NONE) return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return keys;
  }, [staffingLoadGrandRowsBase]);

  /** 全校表展示行：主学科筛选 + 用户排序 */
  const staffingLoadGrandRows = useMemo(() => {
    let rows = staffingLoadGrandRowsBase;
    if (staffingLoadGrandFilterPrimary) {
      rows = rows.filter((r) => r.primarySubjectKey === staffingLoadGrandFilterPrimary);
    }
    rows = [...rows].sort((a, b) => {
      switch (staffingLoadGrandSort) {
        case 'total-desc':
          return b.total - a.total || a.teacherName.localeCompare(b.teacherName, undefined, { sensitivity: 'base' });
        case 'total-asc':
          return a.total - b.total || a.teacherName.localeCompare(b.teacherName, undefined, { sensitivity: 'base' });
        case 'name-asc':
          return a.teacherName.localeCompare(b.teacherName, undefined, { sensitivity: 'base' });
        case 'primary-asc': {
          const pk = a.primarySubjectKey.localeCompare(b.primarySubjectKey, undefined, { numeric: true, sensitivity: 'base' });
          if (pk !== 0) return pk;
          return b.total - a.total || a.teacherName.localeCompare(b.teacherName, undefined, { sensitivity: 'base' });
        }
        default:
          return 0;
      }
    });
    return rows;
  }, [staffingLoadGrandRowsBase, staffingLoadGrandFilterPrimary, staffingLoadGrandSort]);

  const permissionMatrix = useMemo(() => {
    const L = (zh: string, en: string) => (isZh ? zh : en);
    return [
      {
        role: 'system-admin' as const,
        panel: true,
        users: L('全管', 'Full'),
        foundation: L('全管', 'Full'),
        classes: L('全管', 'Full'),
        courses: L('新建/维护', 'Create/edit'),
        staffing: L('全管', 'Full'),
        students: L('增删改', 'Full'),
        portrait: L('创建与管理', 'Create & manage'),
        database: L('只读', 'Read'),
      },
      {
        role: 'admin' as const,
        panel: true,
        users: L('可管教师', 'Manage teachers'),
        foundation: L('学年只读；学段可编', 'Years view; stages edit'),
        classes: L('全管', 'Full'),
        courses: L('无新建；可编单元', 'No new course; units'),
        staffing: L('全管', 'Full'),
        students: L('可增不可删', 'Add, not delete'),
        portrait: L('创建与管理', 'Create & manage'),
        database: L('—', '—'),
      },
      {
        role: 'teacher' as const,
        panel: false,
        users: L('—', '—'),
        foundation: L('—', '—'),
        classes: L('仅查看', 'View'),
        courses: L('—', '—'),
        staffing: L('—', '—'),
        students: L('关联班级', 'Linked classes'),
        portrait: L('任课范围', 'Teaching scope'),
        database: L('—', '—'),
      },
    ];
  }, [isZh]);
  /**
   * 除「课程管理」全宽外，各 tab 共用同一最大宽度。
   * 根布局为 flex-col 时，子项仅写 max-w + mx-auto 会在交叉轴上收缩为「内容宽度」；
   * 学生管理因有宽表格看似正常，班级管理等窄内容会把 main 压成一条——必须加 w-full。
   */
  const adminContentFrameClass = 'w-full max-w-7xl mx-auto px-4 sm:px-6';

  return (
    <div className={`${adminTab === 'courses' ? 'h-screen overflow-hidden' : 'min-h-screen'} bg-slate-50 pt-14 flex flex-col`}>
      <AppTopBar
        title={isZh ? '后台管理' : 'Admin'}
        showBack
        onBack={onBackToHub}
      />
      <div className="border-b border-slate-200 bg-white flex-shrink-0">
        <div className={`${adminContentFrameClass} flex gap-1 flex-wrap`}>
          <button
            type="button"
            onClick={() => { setAdminTab('users'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'users' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '用户管理' : 'Users'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('foundation'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'foundation' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '基础设置' : 'Foundation'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('classes'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'classes' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '班级管理' : 'Classes'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('courses'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'courses' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '课程管理' : 'Courses'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('staffing'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'staffing' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '岗位安排' : 'Staffing'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('students'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'students' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '学生管理' : 'Students'}
          </button>
          <button
            type="button"
            onClick={() => { setAdminTab('report-settings'); setError(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'report-settings' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {isZh ? '学生画像' : 'Portrait'}
          </button>
          {isSystemAdmin && (
            <button
              type="button"
              onClick={() => { setAdminTab('database'); setError(null); }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'database' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {isZh ? '数据库' : 'Database'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className={`${adminContentFrameClass} pt-4`}>
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-800" aria-label={isZh ? '关闭' : 'Dismiss'}>
              ×
            </button>
          </div>
        </div>
      )}
      <main
        className={
          adminTab === 'courses'
            ? 'flex-1 flex flex-col min-h-0 w-full px-2 py-2 overflow-hidden'
            : `${adminContentFrameClass} py-6 space-y-6`
        }
      >
        {adminTab === 'courses' && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <CurriculumRoadmap surface="admin-course-management" embedded />
          </div>
        )}
        {adminTab === 'users' && (
        <>
        {userListScope === 'staff' && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-slate-800 mb-3">
            {isZh ? '权限说明' : 'Permission reference'}
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-slate-100 text-left text-xs text-slate-600">
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '权限' : 'Access level'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '后台' : 'Panel'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '用户管理' : 'Users'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '基础设置' : 'Foundation'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '班级管理' : 'Classes'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '课程管理' : 'Courses'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '岗位与课时' : 'Staffing'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '学生管理' : 'Students'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '学生画像' : 'Portrait'}</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">{isZh ? '数据库' : 'Database'}</th>
                </tr>
              </thead>
              <tbody>
                {permissionMatrix.map((row) => (
                  <tr key={row.role} className="border-t border-slate-100">
                    <td className="py-2 px-2 font-medium text-slate-800 whitespace-nowrap">{ROLE_LABELS[row.role][isZh ? 'zh' : 'en']}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{row.panel ? (isZh ? '✓' : 'Yes') : '—'}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.users}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.foundation}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[6rem]">{row.classes}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[7rem]">{row.courses}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[6rem]">{row.staffing}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[6rem]">{row.students}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[6rem]">{row.portrait}</td>
                    <td className="py-2 px-2 text-slate-600 min-w-[5rem]">{row.database}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {isZh
              ? '列名对应后台顶部各板块。「权限」为登录身份：系统管理员可升降「管理员 / 教师」；学生账号在「学生管理 → 学生登录」开通，在「用户管理 → 学生账号」查看。'
              : 'Columns match admin tabs. Access level is the signed-in role: system admin can promote/demote Admin or Teacher. Student logins: Students → Student login; list: Users → Student accounts.'}
          </p>
        </section>
        )}

        <Dialog
          open={createUserDialogOpen}
          onOpenChange={(open) => {
            setCreateUserDialogOpen(open);
            if (!open) setError(null);
          }}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{isZh ? '新建用户 / Excel 导入' : 'Create users / Excel import'}</DialogTitle>
              <DialogDescription>
                {isZh
                  ? '核对下表后点击创建。支持逐行填写或从 Excel 导入；列与模板一致：中文名、英文名（至少填其一）、权限、部门、主学科、密码（留空则随机生成）。未填登录名时按姓名自动生成。'
                  : 'Review the table, then create. Add rows manually or import from Excel. Columns match the template: Name ZH, Name EN (at least one), role, department, subject, password (leave blank for a random password). Empty username is generated from names.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100">
              <Button type="button" variant="outline" size="sm" onClick={() => downloadStaffImportTemplate(isZh)}>
                {isZh ? '下载 Excel 模板' : 'Download template'}
              </Button>
              <input
                ref={excelImportInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleStaffExcelImport}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => excelImportInputRef.current?.click()}>
                {isZh ? '从 Excel 导入' : 'Import Excel'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateUserDraftRows((prev) => [...prev, makeEmptyStaffDraft()])}
              >
                <Plus className="h-4 w-4 mr-1" />
                {isZh ? '添加一行' : 'Add row'}
              </Button>
            </div>
            <datalist id="admin-create-user-dept-datalist">
              {departmentOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <div className="overflow-auto flex-1 min-h-0 max-h-[55vh] -mx-2 px-2">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '中文名' : 'Name (ZH)'}</th>
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '英文名' : 'Name (EN)'}</th>
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '登录用户名' : 'Username'}</th>
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '权限' : 'Role'}</th>
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '部门' : 'Dept.'}</th>
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '主学科' : 'Subject'}</th>
                    <th className="py-2 pr-2 font-medium whitespace-nowrap">{isZh ? '密码' : 'Password'}</th>
                    <th className="py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {createUserDraftRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="py-1.5 pr-2">
                        <input
                          value={row.nameZh}
                          onChange={(e) => updateStaffDraftRow(row.id, { nameZh: e.target.value })}
                          className="w-full min-w-[5rem] rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={isZh ? '可与英文名二选一' : 'Optional if EN set'}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={row.nameEn}
                          onChange={(e) => updateStaffDraftRow(row.id, { nameEn: e.target.value })}
                          className="w-full min-w-[5rem] rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={isZh ? '可与中文名二选一' : 'Optional if ZH set'}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={row.username}
                          onChange={(e) => updateStaffDraftRow(row.id, { username: e.target.value })}
                          className="w-full min-w-[5rem] rounded border border-slate-300 px-2 py-1 text-xs font-mono"
                          placeholder="login"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <select
                          value={row.role}
                          onChange={(e) =>
                            updateStaffDraftRow(row.id, { role: e.target.value as 'admin' | 'teacher' })
                          }
                          className="rounded border border-slate-300 px-1 py-1 text-xs bg-white"
                        >
                          {assignableRoles
                            .filter((r): r is 'admin' | 'teacher' => r === 'admin' || r === 'teacher')
                            .map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r][isZh ? 'zh' : 'en']}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          list="admin-create-user-dept-datalist"
                          value={row.department}
                          onChange={(e) => updateStaffDraftRow(row.id, { department: e.target.value })}
                          className="w-full min-w-[5rem] max-w-[10rem] rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={isZh ? '部门' : 'Department'}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={row.primarySubject}
                          onChange={(e) => updateStaffDraftRow(row.id, { primarySubject: e.target.value })}
                          className="w-full min-w-[4rem] max-w-[7rem] rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={isZh ? '无' : 'None'}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          type="text"
                          value={row.password}
                          onChange={(e) => updateStaffDraftRow(row.id, { password: e.target.value })}
                          className="w-full min-w-[5rem] max-w-[8rem] rounded border border-slate-300 px-2 py-1 text-xs font-mono"
                          placeholder={isZh ? '空则随机' : 'Random if empty'}
                          autoComplete="new-password"
                        />
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          onClick={() => removeStaffDraftRow(row.id)}
                          disabled={createUserDraftRows.length <= 1}
                          className="p-1 rounded text-slate-400 hover:text-red-600 disabled:opacity-30"
                          title={isZh ? '删除行' : 'Remove row'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setCreateUserDialogOpen(false)}>
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button type="button" onClick={() => void handleSubmitCreateUsers()} disabled={createUserSubmitting}>
                {createUserSubmitting
                  ? isZh
                    ? '提交中…'
                    : 'Submitting…'
                  : isZh
                    ? `创建 ${createUserDraftRows.filter(rowHasDisplayName).length} 个用户`
                    : `Create ${createUserDraftRows.filter(rowHasDisplayName).length} user(s)`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <div className="flex flex-col gap-3 mb-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {isZh ? '列表' : 'List'}
              </span>
              <button
                type="button"
                onClick={() => { setUserListScope('staff'); setSelectedIds(new Set()); }}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${userListScope === 'staff' ? 'border-slate-800 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {isZh ? '教职工' : 'Staff'}
              </button>
              <button
                type="button"
                onClick={() => { setUserListScope('students'); setSelectedIds(new Set()); }}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${userListScope === 'students' ? 'border-slate-800 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {isZh ? '学生账号' : 'Student accounts'}
              </button>
              {userListScope === 'staff' && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleExportStaffUsersExcel}>
                    {isZh ? '导出 Excel' : 'Export Excel'}
                  </Button>
                  <Button type="button" size="sm" onClick={openCreateUserDialog}>
                    {isZh ? '新建 / 批量导入' : 'Add or import'}
                  </Button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                {userListScope === 'staff' ? (isZh ? '所有用户（教职工）' : 'All users (staff)') : (isZh ? '所有用户（学生账号）' : 'All users (students)')}
              </h2>
              {loading && (
                <span className="text-xs text-slate-500">
                  {isZh ? '加载中…' : 'Loading…'}
                </span>
              )}
              {!loading && userListScope === 'staff' && usersShownInUsersSection.length > 0 && selectedIds.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500">
                    {isZh ? `已选 ${selectedIds.size} 人` : `Selected ${selectedIds.size}`}
                  </span>
                  <input
                    value={batchDepartment}
                    onChange={(e) => setBatchDepartment(e.target.value)}
                    list="admin-batch-department-options"
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-40"
                    placeholder={isZh ? '部门名称' : 'Department'}
                  />
                  <datalist id="admin-batch-department-options">
                    {departmentOptions.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  <Button
                    size="sm"
                    onClick={handleBatchDepartment}
                    disabled={batchDeptLoading}
                  >
                    {batchDeptLoading ? (isZh ? '处理中…' : 'Updating…') : isZh ? '设为分组' : 'Set group'}
                  </Button>
                </div>
              )}
            </div>
            {!loading && userListScope === 'staff' && displayedUsers.length > 0 && (
              <div className="flex flex-wrap items-end gap-2 pb-2 border-b border-slate-100">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase text-slate-400">{isZh ? '部门' : 'Dept.'}</span>
                  <select
                    value={userStaffFilterDepartment}
                    onChange={(e) => setUserStaffFilterDepartment(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white min-w-[7rem]"
                  >
                    <option value="">{isZh ? '全部' : 'All'}</option>
                    <option value={USER_FILTER_NONE}>{isZh ? '未设置' : 'Unset'}</option>
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase text-slate-400">{isZh ? '主学科' : 'Subject'}</span>
                  <select
                    value={userStaffFilterPrimarySubject}
                    onChange={(e) => setUserStaffFilterPrimarySubject(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white min-w-[7rem]"
                  >
                    <option value="">{isZh ? '全部' : 'All'}</option>
                    <option value={USER_FILTER_NONE}>{isZh ? '无' : 'None'}</option>
                    {primarySubjectOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase text-slate-400">{isZh ? '权限' : 'Access'}</span>
                  <select
                    value={userStaffFilterRole}
                    onChange={(e) => setUserStaffFilterRole(e.target.value as '' | 'admin' | 'teacher')}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white min-w-[6rem]"
                  >
                    <option value="">{isZh ? '全部' : 'All'}</option>
                    <option value="admin">{ROLE_LABELS.admin[isZh ? 'zh' : 'en']}</option>
                    <option value="teacher">{ROLE_LABELS.teacher[isZh ? 'zh' : 'en']}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-w-[10rem]">
                  <span className="text-[10px] uppercase text-slate-400">{isZh ? '关键词' : 'Search'}</span>
                  <input
                    value={userStaffFilterSearch}
                    onChange={(e) => setUserStaffFilterSearch(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full max-w-xs"
                    placeholder={isZh ? '用户名、中英文名、部门、学科、权限…' : 'Username, names, dept., subject…'}
                  />
                </div>
              </div>
            )}
            {!loading && userListScope === 'students' && displayedUsers.length > 0 && (
              <div className="flex flex-wrap items-end gap-2 pb-2 border-b border-slate-100">
                <div className="flex flex-col gap-0.5 flex-1 min-w-[12rem]">
                  <span className="text-[10px] uppercase text-slate-400">{isZh ? '筛选' : 'Filter'}</span>
                  <input
                    value={userStudentFilterSearch}
                    onChange={(e) => setUserStudentFilterSearch(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full max-w-md"
                    placeholder={isZh ? '用户名、账号姓名、学籍姓名…' : 'Login, account or student names…'}
                  />
                </div>
              </div>
            )}
          </div>
          {!loading && userListScope === 'students' && !USE_CLOUD_STORAGE && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
              {isZh ? '当前为本地模式，学生账号列表与导入仅在使用云端存储时可用。请在 .env 中启用 VITE_USE_CLOUD_STORAGE=true 并登录。' : 'Local mode: student account list and import require cloud mode. Set VITE_USE_CLOUD_STORAGE=true and sign in.'}
            </p>
          )}
          {!loading && displayedUsers.length === 0 && (
            <p className="text-sm text-slate-500">
              {userListScope === 'students'
                ? (isZh ? '暂无学生登录账号。可在「学生管理」中使用「学生登录」批量开通。' : 'No student accounts yet. Use Student login under Students.')
                : (isZh ? '暂时没有用户数据。' : 'No users yet.')}
            </p>
          )}
          {!loading && usersShownInUsersSection.length === 0 && displayedUsers.length > 0 && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
              {isZh ? '当前筛选条件下没有匹配的用户。' : 'No users match the current filters.'}
            </p>
          )}
          {usersShownInUsersSection.length > 0 && userListScope === 'staff' && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={editableUserIds.size > 0 && Array.from(editableUserIds).every((id) => selectedIds.has(id))}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="py-2 pr-4">{isZh ? '用户名' : 'Username'}</th>
                    <th className="py-2 pr-4">{isZh ? '密码' : 'Password'}</th>
                    <th className="py-2 pr-4">{isZh ? '中文名' : 'Name (ZH)'}</th>
                    <th className="py-2 pr-4">{isZh ? '英文名' : 'Name (EN)'}</th>
                    <th className="py-2 pr-4">{isZh ? '权限' : 'Access'}</th>
                    <th className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => toggleStaffTableSort('department')}
                        className="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-slate-800 -ml-1 px-1 py-0.5 rounded-md hover:bg-slate-50"
                      >
                        {isZh ? '部门' : 'Department'}
                        {userStaffSortKey === 'department' &&
                          (userStaffSortDir === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          ))}
                      </button>
                    </th>
                    <th className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => toggleStaffTableSort('primarySubject')}
                        className="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-slate-800 -ml-1 px-1 py-0.5 rounded-md hover:bg-slate-50"
                      >
                        {isZh ? '主学科' : 'Primary subject'}
                        {userStaffSortKey === 'primarySubject' &&
                          (userStaffSortDir === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          ))}
                      </button>
                    </th>
                    <th className="py-2 pr-4">{isZh ? '创建时间' : 'Created at'}</th>
                    <th className="py-2 pr-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {usersShownInUsersSection.map((u) => {
                    const hasPassword = u.password != null && u.password !== '';
                    const revealed = passwordRevealed[u.id];
                    return (
                      <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={() => toggleSelect(u.id)}
                            disabled={!canEditUser(u)}
                            className="rounded border-slate-300 disabled:opacity-50"
                          />
                        </td>
                        <td className="py-2 pr-4">{u.username}</td>
                        <td className="py-2 pr-4">
                          {hasPassword ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-mono text-xs">
                                {revealed ? u.password : '••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPasswordRevealed((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                                title={revealed ? (isZh ? '隐藏密码' : 'Hide password') : (isZh ? '显示密码' : 'Show password')}
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">{isZh ? '不可查看' : 'N/A'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-slate-700">
                          {(u.nameZh ?? '').trim() || (!(u.nameEn ?? '').trim() && (u.displayName ?? '').trim()
                            ? u.displayName
                            : '—')}
                        </td>
                        <td className="py-2 pr-4 min-w-[7rem]">
                          {canEditUser(u) ? (
                            <input
                              key={`ne-${u.id}-${(u.nameEn ?? '').trim()}`}
                              type="text"
                              defaultValue={(u.nameEn ?? '').trim()}
                              onBlur={(e) => {
                                const trimmed = e.target.value.trim();
                                void handleStaffNameEnBlur(u, trimmed === '' ? null : trimmed);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              }}
                              className="text-sm w-full min-w-[6.5rem] max-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                              placeholder={isZh ? '英文名' : 'English name'}
                              title={isZh ? '点击输入，失焦或按 Enter 保存' : 'Edit; blur or Enter to save'}
                              autoComplete="off"
                            />
                          ) : (
                            <span className="text-slate-700">{(u.nameEn ?? '').trim() || '—'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {currentUser?.role === 'system-admin' && u.role !== 'system-admin' && u.role !== 'student' ? (
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'teacher')}
                              className="text-sm rounded border border-slate-300 px-2 py-1 bg-white min-w-[100px]"
                            >
                              <option value="admin">{ROLE_LABELS.admin[isZh ? 'zh' : 'en']}</option>
                              <option value="teacher">{ROLE_LABELS.teacher[isZh ? 'zh' : 'en']}</option>
                            </select>
                          ) : (
                            ROLE_LABELS[u.role][isZh ? 'zh' : 'en']
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {canEditUser(u) ? (
                            <select
                              value={u.department ?? ''}
                              onChange={(e) => handleDepartmentChange(u, e.target.value || null)}
                              className="text-sm rounded border border-slate-300 px-2 py-1 bg-white min-w-[100px]"
                            >
                              <option value="">—</option>
                              {departmentOptions.map((d) => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                              {u.department && u.department.trim() && !departmentOptions.includes(u.department.trim()) && (
                                <option value={u.department}>{u.department}</option>
                              )}
                            </select>
                          ) : (
                            <span className="text-slate-600">{u.department ?? '—'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 min-w-[7rem]">
                          {canEditUser(u) ? (
                            <input
                              key={`ps-${u.id}-${u.primarySubject ?? ''}`}
                              type="text"
                              defaultValue={u.primarySubject ?? ''}
                              onBlur={(e) => {
                                const trimmed = e.target.value.trim();
                                const nextVal = trimmed === '' ? null : trimmed;
                                const norm = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);
                                if (norm(nextVal) === norm(u.primarySubject)) return;
                                void handlePrimarySubjectChange(u, nextVal);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              }}
                              className="text-sm w-full min-w-[6.5rem] max-w-[10rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                              placeholder={isZh ? '无' : 'None'}
                              title={isZh ? '点击输入学科，失焦或按 Enter 保存' : 'Primary subject; blur or Enter to save'}
                              autoComplete="off"
                            />
                          ) : (
                            <span className="text-slate-600">{formatPrimarySubjectCell(isZh, u.primarySubject)}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-xs text-slate-500">
                          {u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-2 pr-2">
                          {canDeleteUser(u) ? (
                            <button
                              type="button"
                              onClick={() => openDeleteConfirm(u)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                              title={isZh ? '删除' : 'Delete'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {usersShownInUsersSection.length > 0 && userListScope === 'students' && USE_CLOUD_STORAGE && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">{isZh ? '学号（登录名）' : 'Student no. (login)'}</th>
                    <th className="py-2 pr-4">{isZh ? '密码' : 'Password'}</th>
                    <th className="py-2 pr-4">{isZh ? '账号中文名' : 'Account (ZH)'}</th>
                    <th className="py-2 pr-4">{isZh ? '账号英文名' : 'Account (EN)'}</th>
                    <th className="py-2 pr-4">{isZh ? '权限' : 'Access'}</th>
                    <th className="py-2 pr-4">{isZh ? '学籍中文名' : 'Student (ZH)'}</th>
                    <th className="py-2 pr-4">{isZh ? '学籍英文名' : 'Student (EN)'}</th>
                    <th className="py-2 pr-4">{isZh ? '学籍 ID' : 'Student record'}</th>
                    <th className="py-2 pr-4">{isZh ? '创建时间' : 'Created at'}</th>
                    <th className="py-2 pr-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {usersShownInUsersSection.map((u) => {
                    const hasPassword = u.password != null && u.password !== '';
                    const revealed = passwordRevealed[u.id];
                    return (
                      <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-4 font-mono text-xs text-slate-500 truncate max-w-[100px]">{u.id}</td>
                        <td className="py-2 pr-4 font-mono">{u.username}</td>
                        <td className="py-2 pr-4">
                          {hasPassword ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-mono text-xs">
                                {revealed ? u.password : '••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPasswordRevealed((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                                title={revealed ? (isZh ? '隐藏密码' : 'Hide password') : (isZh ? '显示密码' : 'Show password')}
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">{isZh ? '不可查看' : 'N/A'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{(u.nameZh ?? '').trim() || '—'}</td>
                        <td className="py-2 pr-4">{(u.nameEn ?? '').trim() || '—'}</td>
                        <td className="py-2 pr-4 text-slate-600">{ROLE_LABELS.student[isZh ? 'zh' : 'en']}</td>
                        <td className="py-2 pr-4">{u.studentNameZh ?? '—'}</td>
                        <td className="py-2 pr-4">{u.studentNameEn ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-600">{u.studentId ?? '—'}</td>
                        <td className="py-2 pr-4 text-xs text-slate-500">
                          {u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-2 pr-2">
                          {canDeleteUser(u) ? (
                            <button
                              type="button"
                              onClick={() => openDeleteConfirm(u)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                              title={isZh ? '删除登录账号' : 'Remove login'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}

        {adminTab === 'foundation' && (
          <FoundationSettingsPanel
            isZh={isZh}
            subTab={foundationSubTab}
            onSubTabChange={setFoundationSubTab}
            canEditYears={canEditYears}
            canEditStructure={canEditSchoolStructure}
            canMutateOrg={isSystemAdmin}
            years={years}
            yearLoading={yearLoading}
            currentYearId={currentYearId}
            setCurrentYearId={setCurrentYearId}
            setCurrentAcademicYearIdAndSync={setCurrentAcademicYearIdAndSync}
            onOpenCreateYear={() => setDialogCreateYear(true)}
            onOpenYearManagement={() => setDialogYearManagement(true)}
            currentYearClassCount={currentYearClassCount}
            currentYearStudentCount={currentYearStudentCount}
            currentYearClasses={currentYearClasses}
            getGradeLabel={getGradeLabel}
            onOrgError={(msg) => setError(msg)}
            onDepartmentsChange={loadOrgDepartmentLabels}
          />
        )}

        {adminTab === 'classes' && (
          <div className="mt-4 w-full min-w-0">
            <ClassManagement
              onBackToHub={() => {}}
              embedded
              hideYearGear={false}
              pageTitle={isZh ? '班级管理' : 'Classes'}
            />
          </div>
        )}

        {adminTab === 'staffing' && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            <div className="flex flex-row items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800 shrink-0">
                {isZh ? '岗位与课时' : 'Staffing & weekly loads'}
              </h2>
              <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                <label className="text-sm font-medium text-slate-700 whitespace-nowrap">{isZh ? '学年' : 'Year'}</label>
                <select
                  value={staffingYearId}
                  onChange={(e) => setStaffingYearId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[140px] sm:min-w-[180px]"
                  disabled={staffingLoading || allYears.length === 0}
                >
                  {allYears.length === 0 ? (
                    <option value="">{isZh ? '暂无学年' : 'No years'}</option>
                  ) : (
                    allYears.map((y) => (
                      <option key={y.id} value={y.id}>{y.name}</option>
                    ))
                  )}
                </select>
                {USE_CLOUD_STORAGE && staffingYearId ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleStaffingRosterExport}
                      disabled={
                        staffingLoading ||
                        staffingClassList.length === 0 ||
                        staffingRosterSheetsForExcel.length === 0
                      }
                    >
                      {isZh ? '导出 Excel' : 'Export Excel'}
                    </Button>
                    <input
                      ref={staffingExcelInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => void handleStaffingRosterExcelImport(e)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => staffingExcelInputRef.current?.click()}
                      disabled={staffingExcelImporting || staffingLoading || staffingClassList.length === 0}
                    >
                      {staffingExcelImporting ? (isZh ? '导入中…' : 'Importing…') : isZh ? '导入 Excel' : 'Import Excel'}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {staffingLoading ? (
              <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
            ) : !staffingYearId ? (
              <p className="text-sm text-slate-500">{isZh ? '请先创建学年。' : 'Create an academic year first.'}</p>
            ) : !USE_CLOUD_STORAGE ? (
              <p className="text-sm text-slate-500">
                {isZh ? '岗位安排需要云端模式（VITE_USE_CLOUD_STORAGE=true）才能保存。' : 'Staffing requires cloud mode to persist.'}
              </p>
            ) : (
              <>
                <div className="flex gap-0 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => setStaffingSubTab('roster')}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      staffingSubTab === 'roster'
                        ? 'border-slate-800 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {isZh ? '岗位安排' : 'Staffing roster'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffingSubTab('load')}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      staffingSubTab === 'load'
                        ? 'border-slate-800 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {isZh ? '周课时统计' : 'Weekly load'}
                  </button>
                </div>

                {staffingSubTab === 'roster' && (
                  <>
                    {staffingClassList.length === 0 ? (
                      <p className="text-sm text-slate-500 pt-2">{isZh ? '该学年下暂无班级。' : 'No classes in this year.'}</p>
                    ) : (
                      <div className="space-y-8 pt-2">
                        {staffingSegmentBlocks.map((block) => {
                          const gradeNorm = normalizeGradeConfig(loadGradeConfigSync());
                          const gradeGroups = groupStaffingClassesByGrade(block.classes);
                          return (
                            <div key={String(block.key)} className="space-y-2">
                              {block.title ? (
                                <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-2">
                                  {block.title}
                                </h3>
                              ) : null}
                              {block.classes.length === 0 ? (
                                <p className="text-sm text-slate-500">
                                  {isZh ? '该学段暂无班级。' : 'No classes in this segment.'}
                                </p>
                              ) : (
                                <div className="rounded-lg border border-slate-200 overflow-x-auto">
                                  <table className="min-w-max w-full text-sm border-collapse">
                                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                                      <tr>
                                        <th
                                          className="sticky left-0 z-20 bg-slate-50 border-b border-r border-slate-200 px-2 py-2 align-bottom min-w-[4.5rem] whitespace-nowrap text-center"
                                          scope="col"
                                        >
                                          {isZh ? '年级' : 'Grade'}
                                        </th>
                                        <th
                                          className="sticky left-[4.5rem] z-10 bg-slate-50 border-b border-r border-slate-200 px-2 py-2 align-bottom min-w-[4.55rem] text-center"
                                          scope="col"
                                        >
                                          {isZh ? '班级' : 'Class'}
                                        </th>
                                        {block.columns.map((col) =>
                                          col.kind === 'homeroom' ? (
                                            <th
                                              key={col.key}
                                              className="border-b border-slate-200 px-1.5 py-2 font-medium align-bottom min-w-[5.5rem] max-w-[7rem] text-center"
                                            >
                                              <div className="text-[12px] font-semibold text-slate-800 leading-snug line-clamp-2" title={col.name}>
                                                {col.name}
                                              </div>
                                            </th>
                                          ) : (
                                            <th
                                              key={col.key}
                                              className={
                                                col.course.coTeaching
                                                  ? 'border-b border-slate-200 px-1.5 py-2 font-medium align-bottom min-w-[13rem] max-w-[22rem]'
                                                  : 'border-b border-slate-200 px-1.5 py-2 font-medium align-bottom min-w-[96px] max-w-[144px]'
                                              }
                                            >
                                              <div className="text-[12px] font-semibold text-slate-800 leading-snug line-clamp-2" title={col.name}>
                                                {col.name}
                                              </div>
                                            </th>
                                          ),
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {gradeGroups.flatMap(({ grade, items }) =>
                                        items.map((cls, idxInGrade) => (
                                          <tr key={cls.id} className="border-t border-slate-100">
                                            {idxInGrade === 0 ? (
                                              <th
                                                rowSpan={items.length}
                                                scope="row"
                                                className="sticky left-0 z-[1] bg-white border-r border-slate-100 px-2 py-2 align-top text-center text-sm font-semibold text-slate-800 whitespace-nowrap"
                                              >
                                                {getGradeLabel(grade)}
                                              </th>
                                            ) : null}
                                            <td className="sticky left-[4.5rem] z-[1] bg-white border-r border-slate-100 px-2 py-2 align-top font-medium text-slate-800 text-center">
                                              {cls.name}
                                            </td>
                                            {block.columns.map((col) => {
                                              if (col.kind === 'homeroom') {
                                                const rowKey = `${cls.id}::${col.key}::0`;
                                                const assigned = staffingAssignmentsMap.get(rowKey);
                                                const currentTeacherId = assigned?.teacherId ?? '';
                                                const isSaving = staffingSavingKeys.has(rowKey);
                                                return (
                                                  <td
                                                    key={`${cls.id}::${col.key}`}
                                                    className="px-1.5 py-2 align-middle border-l border-slate-100 text-center"
                                                  >
                                                    <div className="mx-auto flex w-full max-w-[9.5rem] flex-col">
                                                      <select
                                                        value={currentTeacherId}
                                                        onChange={(e) => {
                                                          void upsertStaffingAssignment({
                                                            academicYearId: staffingYearId,
                                                            classId: cls.id,
                                                            subjectKey: col.key,
                                                            subjectName: col.name,
                                                            teacherId: e.target.value || null,
                                                            teacherSlot: 0,
                                                            coTeaching: false,
                                                          });
                                                        }}
                                                        disabled={isSaving}
                                                        title={col.name}
                                                        className="w-full min-w-0 rounded-md border border-slate-200 bg-white px-1 py-1.5 text-xs sm:text-sm font-medium text-slate-800 text-center cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400 appearance-none bg-no-repeat pr-5 bg-[length:0.65rem] bg-[right_0.35rem_center]"
                                                        style={{
                                                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                                        }}
                                                      >
                                                        <option value="">{isZh ? '—' : '—'}</option>
                                                        {staffingTeachers.map((teacher) => (
                                                          <option key={teacher.id} value={teacher.id}>
                                                            {staffingTeacherDisplayName(teacher, isZh)}
                                                          </option>
                                                        ))}
                                                      </select>
                                                      {isSaving ? (
                                                        <div className="text-[10px] text-slate-400 leading-none">{isZh ? '…' : '…'}</div>
                                                      ) : null}
                                                    </div>
                                                  </td>
                                                );
                                              }
                                              const applies = courseAppliesToGrade(col.course, cls.grade, gradeNorm);
                                              if (!applies) {
                                                return (
                                                  <td key={`${cls.id}-${col.key}`} className="px-1.5 py-2 align-top bg-slate-50/60 text-center text-slate-300 text-xs">
                                                    —
                                                  </td>
                                                );
                                              }
                                              const coTeaching = Boolean(col.course.coTeaching);
                                              const teacherSlots: (0 | 1)[] = coTeaching ? [0, 1] : [0];
                                              const weeklyP = getWeeklyPeriodsForGrade(col.course, cls.grade, gradeNorm);
                                              const weeklyPeriodsBadge =
                                                weeklyP > 0 ? (
                                                  <span
                                                    className="shrink-0 text-[10px] sm:text-xs font-medium text-slate-600 tabular-nums leading-none"
                                                    title={isZh ? '周课时' : 'Weekly periods'}
                                                  >
                                                    {formatWeeklyLoadValue(weeklyP)}
                                                  </span>
                                                ) : null;
                                              const selectClassName =
                                                'min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1 py-1.5 text-xs sm:text-sm font-medium text-slate-800 text-center cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400 appearance-none bg-no-repeat pr-5 bg-[length:0.65rem] bg-[right_0.35rem_center]';
                                              const selectChevronStyle = {
                                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                              };
                                              const coTeachingSaving = teacherSlots.some((slot) =>
                                                staffingSavingKeys.has(`${cls.id}::${col.key}::${slot}`),
                                              );
                                              return (
                                                <td
                                                  key={`${cls.id}::${col.key}`}
                                                  className="px-1.5 py-2 align-middle border-l border-slate-100 text-center"
                                                >
                                                  {coTeaching ? (
                                                    <div className="mx-auto flex w-full min-w-[11rem] max-w-[14rem] flex-col items-center">
                                                      <div className="flex w-full items-center justify-center gap-1 min-w-0">
                                                        {teacherSlots.map((slot) => {
                                                          const rowKey = `${cls.id}::${col.key}::${slot}`;
                                                          const assigned = staffingAssignmentsMap.get(rowKey);
                                                          const currentTeacherId = assigned?.teacherId ?? '';
                                                          const isSaving = staffingSavingKeys.has(rowKey);
                                                          return (
                                                            <select
                                                              key={rowKey}
                                                              value={currentTeacherId}
                                                              onChange={(e) => {
                                                                void upsertStaffingAssignment({
                                                                  academicYearId: staffingYearId,
                                                                  classId: cls.id,
                                                                  subjectKey: col.key,
                                                                  subjectName: col.name,
                                                                  teacherId: e.target.value || null,
                                                                  teacherSlot: slot,
                                                                  coTeaching: true,
                                                                });
                                                              }}
                                                              disabled={isSaving}
                                                              title={`${col.name} (${slot + 1})`}
                                                              className={`${selectClassName} max-w-[5.25rem]`}
                                                              style={selectChevronStyle}
                                                            >
                                                              <option value="">{isZh ? '—' : '—'}</option>
                                                              {staffingTeachers.map((teacher) => (
                                                                <option key={teacher.id} value={teacher.id}>
                                                                  {staffingTeacherDisplayName(teacher, isZh)}
                                                                </option>
                                                              ))}
                                                            </select>
                                                          );
                                                        })}
                                                        {weeklyPeriodsBadge}
                                                      </div>
                                                      {coTeachingSaving ? (
                                                        <div className="text-[10px] text-slate-400 leading-none">{isZh ? '…' : '…'}</div>
                                                      ) : null}
                                                    </div>
                                                  ) : (
                                                    <div className="mx-auto flex w-full max-w-[10.5rem] flex-col items-center">
                                                      {(() => {
                                                        const slot = 0;
                                                        const rowKey = `${cls.id}::${col.key}::${slot}`;
                                                        const assigned = staffingAssignmentsMap.get(rowKey);
                                                        const currentTeacherId = assigned?.teacherId ?? '';
                                                        const isSaving = staffingSavingKeys.has(rowKey);
                                                        return (
                                                          <>
                                                            <div className="flex w-full items-center justify-center gap-1 min-w-0">
                                                              <select
                                                                value={currentTeacherId}
                                                                onChange={(e) => {
                                                                  void upsertStaffingAssignment({
                                                                    academicYearId: staffingYearId,
                                                                    classId: cls.id,
                                                                    subjectKey: col.key,
                                                                    subjectName: col.name,
                                                                    teacherId: e.target.value || null,
                                                                    teacherSlot: slot,
                                                                    coTeaching: false,
                                                                  });
                                                                }}
                                                                disabled={isSaving}
                                                                title={col.name}
                                                                className={selectClassName}
                                                                style={selectChevronStyle}
                                                              >
                                                                <option value="">{isZh ? '—' : '—'}</option>
                                                                {staffingTeachers.map((teacher) => (
                                                                  <option key={teacher.id} value={teacher.id}>
                                                                    {staffingTeacherDisplayName(teacher, isZh)}
                                                                  </option>
                                                                ))}
                                                              </select>
                                                              {weeklyPeriodsBadge}
                                                            </div>
                                                            {isSaving ? (
                                                              <div className="text-[10px] text-slate-400 leading-none">{isZh ? '…' : '…'}</div>
                                                            ) : null}
                                                          </>
                                                        );
                                                      })()}
                                                    </div>
                                                  )}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        )),
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {staffingSubTab === 'load' && (
                  <div className="space-y-6 pt-2">
                    {staffingCourseColumns.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        {isZh ? '暂无课程数据，请先在「课程管理」中添加课程并设置年级跨度。' : 'No courses yet. Add courses under Admin → Courses with grade ranges.'}
                      </p>
                    ) : staffingTeachers.length === 0 ? (
                      <p className="text-sm text-slate-500">{isZh ? '暂无教师账号。' : 'No teacher accounts.'}</p>
                    ) : (
                      <>
                        {staffingLoadLineItems.length === 0 && (
                          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            {isZh
                              ? '当前学年在岗位安排中尚未指定任课教师，下方合计均为 0。切换到「岗位安排」进行排课。'
                              : 'No staffing assignments for this year yet; totals are zero. Use the Staffing roster tab to assign teachers.'}
                          </p>
                        )}

                        <div className="rounded-lg border-2 border-slate-300 bg-slate-50/80 overflow-hidden shadow-sm">
                          <div className="bg-slate-200/90 px-3 py-2 border-b border-slate-300">
                            <h3 className="text-sm font-semibold text-slate-900">
                              {isZh ? '全校周课时统计' : 'School-wide weekly load'}
                            </h3>
                          </div>
                          <div className="flex flex-wrap items-end gap-3 px-3 pt-3 text-sm">
                            <div className="flex flex-col gap-1 min-w-[10rem]">
                              <label className="text-xs font-medium text-slate-600">
                                {isZh ? '主学科筛选' : 'Primary subject'}
                              </label>
                              <select
                                value={staffingLoadGrandFilterPrimary}
                                onChange={(e) => setStaffingLoadGrandFilterPrimary(e.target.value)}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm max-w-[16rem]"
                              >
                                <option value="">{isZh ? '全部' : 'All'}</option>
                                {staffingLoadGrandPrimaryFilterOptions.map((key) => (
                                  <option key={key} value={key}>
                                    {key === STAFFING_LOAD_PRIMARY_NONE
                                      ? (isZh ? '未设置主学科' : 'Not set')
                                      : key}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1 min-w-[11rem]">
                              <label className="text-xs font-medium text-slate-600">
                                {isZh ? '排序' : 'Sort'}
                              </label>
                              <select
                                value={staffingLoadGrandSort}
                                onChange={(e) =>
                                  setStaffingLoadGrandSort(
                                    e.target.value as 'total-desc' | 'total-asc' | 'name-asc' | 'primary-asc',
                                  )
                                }
                                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                              >
                                <option value="total-desc">{isZh ? '周课时（多→少）' : 'Periods (high → low)'}</option>
                                <option value="total-asc">{isZh ? '周课时（少→多）' : 'Periods (low → high)'}</option>
                                <option value="name-asc">{isZh ? '教师姓名（A→Z）' : 'Teacher name (A → Z)'}</option>
                                <option value="primary-asc">{isZh ? '主学科（A→Z）' : 'Primary subject (A → Z)'}</option>
                              </select>
                            </div>
                          </div>
                          <div className="overflow-x-auto p-3 pt-2">
                            <table className="min-w-full text-sm">
                              <thead className="bg-white text-left text-xs text-slate-600 border border-slate-200 rounded-t-md">
                                <tr>
                                  <th className="py-2 px-3 font-medium whitespace-nowrap w-[8.5rem]">
                                    {isZh ? '教师' : 'Teacher'}
                                  </th>
                                  <th className="py-2 px-3 font-medium whitespace-nowrap w-[7rem]">
                                    {isZh ? '主学科' : 'Primary'}
                                  </th>
                                  <th className="py-2 px-3 font-medium min-w-[12rem]">
                                    {isZh ? '课时构成' : 'Breakdown'}
                                  </th>
                                  <th className="py-2 px-3 font-medium whitespace-nowrap text-right w-[7.5rem]">
                                    {isZh ? '周课时（节/周）' : 'Periods / wk'}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {staffingLoadGrandRows.length === 0 ? (
                                  <tr className="border-t border-slate-200 bg-white">
                                    <td colSpan={4} className="py-3 px-3 text-sm text-slate-500">
                                      {isZh
                                        ? '当前筛选下暂无教师行，请调整主学科筛选或确认岗位安排。'
                                        : 'No rows for this filter. Change the primary-subject filter or check staffing.'}
                                    </td>
                                  </tr>
                                ) : (
                                  staffingLoadGrandRows.map((r) => (
                                    <tr key={r.teacherId} className="border-t border-slate-200 bg-white">
                                      <td className="py-2 px-3 text-slate-800 align-top whitespace-nowrap font-medium">
                                        {r.teacherName}
                                      </td>
                                      <td className="py-2 px-3 text-slate-700 align-top text-xs sm:text-sm whitespace-nowrap">
                                        {r.primarySubjectLabel}
                                      </td>
                                      <td className="py-2 px-3 text-slate-600 text-xs sm:text-sm leading-relaxed align-top break-words max-w-[min(48rem,85vw)]">
                                        {r.detail}
                                      </td>
                                      <td className="py-2 px-3 font-semibold text-slate-900 tabular-nums text-right align-top">
                                        {formatWeeklyLoadValue(r.total)}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {adminTab === 'students' && (
          <>
            {/* 与班级管理一致：第一块仅「当前学年」 */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-slate-700">{isZh ? '当前学年' : 'Academic year'}</label>
                <select
                  value={studentCurrentYearId || ''}
                  onChange={(e) => setStudentCurrentYearId(e.target.value || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                >
                  <option value="">—</option>
                  {allYears.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </div>
            </section>

            {/* 第二块：标题 + 创建按钮 + 筛选 + 表格（与「班级列表」卡片结构一致） */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold text-slate-800">
                  {studentCurrentYearId
                    ? `${allYears.find((y) => y.id === studentCurrentYearId)?.name ?? ''} — ${isZh ? '学生列表' : 'Students'}`
                    : (isZh ? '学生列表' : 'Student list')}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openStudentLoginDialog()}
                    disabled={!USE_CLOUD_STORAGE || studentLoginBusy}
                    title={
                      !USE_CLOUD_STORAGE
                        ? (isZh ? '需开启云端存储后从服务器导入登录账号' : 'Requires cloud mode')
                        : (isZh ? '为有学号的学生生成密码并导入服务器' : 'Import login accounts for students with student number')
                    }
                  >
                    <LogIn className="h-4 w-4 mr-1" />
                    {studentLoginBusy ? (isZh ? '准备中…' : 'Loading…') : isZh ? '学生登录' : 'Student login'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setDialogCreateStudent(true)}
                    disabled={!studentCurrentYearId}
                    title={!studentCurrentYearId ? (isZh ? '请先选择当前学年' : 'Select current year first') : undefined}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {isZh ? '创建学生' : 'Create student'}
                  </Button>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">{isZh ? '筛选：' : 'Filter:'}</span>
                <input
                  value={studentFilterName}
                  onChange={(e) => setStudentFilterName(e.target.value)}
                  placeholder={isZh ? '中文名/英文名/学号' : 'Chinese/English name or ID'}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-36 placeholder:text-slate-400"
                />
                <input
                  value={studentFilterGrade}
                  onChange={(e) => setStudentFilterGrade(e.target.value)}
                  placeholder={isZh ? '当前年级' : 'Current grade'}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-24 placeholder:text-slate-400"
                />
                <select
                  value={studentFilterClass}
                  onChange={(e) => setStudentFilterClass(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white min-w-[120px] text-slate-700"
                >
                  <option value="">{isZh ? '全部班级' : 'All classes'}</option>
                  {allClasses.map((c) => {
                    const year = allYears.find((y) => y.id === c.academicYearId);
                    return (
                      <option key={c.id} value={c.id}>
                        {year ? `${year.name} · ` : ''}{c.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {studentLoading ? (
                <p className="text-sm text-slate-500 py-4">{isZh ? '加载中…' : 'Loading…'}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-left text-xs text-slate-600">
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('nameZh');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '中文名' : 'Chinese name'}
                            {studentSortField === 'nameZh' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('nameEn');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '英文名' : 'English name'}
                            {studentSortField === 'nameEn' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('currentGrade');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '当前年级' : 'Current grade'}
                            {studentSortField === 'currentGrade' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('gender');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '性别' : 'Gender'}
                            {studentSortField === 'gender' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('studentNumber');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '学号' : 'Number'}
                            {studentSortField === 'studentNumber' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setStudentSortField('dateOfBirth');
                              setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            }}
                            className="flex items-center gap-1 hover:text-slate-800"
                          >
                            {isZh ? '出生日期' : 'DOB'}
                            {studentSortField === 'dateOfBirth' && (studentSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium">{isZh ? '学部' : 'Division'}</th>
                        <th className="py-2.5 px-3 font-medium">{isZh ? '状态' : 'Status'}</th>
                        <th className="py-2.5 px-3 font-medium">{isZh ? '所在班级' : 'Classes'}</th>
                        <th className="py-2.5 px-3 font-medium w-14">{isZh ? '操作' : ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedStudents.length === 0 ? (
                        <tr><td colSpan={11} className="py-8 text-center text-slate-500 text-sm">{isZh ? '暂无学生' : 'No students'}</td></tr>
                      ) : (
                        filteredAndSortedStudents.map((s) => {
                          const myEnrollments = enrollments.filter((e) => e.studentId === s.id);
                          const classLabels = myEnrollments.map((e) => {
                            const cls = allClasses.find((c) => c.id === e.classId);
                            const year = allYears.find((y) => y.id === e.academicYearId);
                            return year && cls ? `${year.name} · ${cls.name}` : cls?.name ?? e.classId;
                          });
                          return (
                            <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-medium text-slate-800">{s.nameZh ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.nameEn ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.currentGrade != null ? `G${s.currentGrade}` : '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {s.gender === 'male' ? (isZh ? '男' : 'M') : s.gender === 'female' ? (isZh ? '女' : 'F') : (isZh ? '其他' : 'Other')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{s.studentNumber ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.dateOfBirth ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{s.division ?? '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {s.status === 'graduated'
                                  ? (isZh ? '毕业' : 'Graduated')
                                  : s.status === 'leave'
                                    ? (isZh ? '休学' : 'Leave')
                                    : s.status === 'withdrawn'
                                      ? (isZh ? '离校' : 'Withdrawn')
                                      : (isZh ? '在读' : 'Active')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 text-xs">{classLabels.join('; ') || '—'}</td>
                              <td className="py-2.5 px-3">
                                <button
                                  type="button"
                                  onClick={() => openEditStudent(s)}
                                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                                  title={isZh ? '编辑' : 'Edit'}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {adminTab === 'report-settings' && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            {!USE_CLOUD_STORAGE && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {isZh
                  ? '当前为本地模式。请在 apps/web/.env 启用 VITE_USE_CLOUD_STORAGE=true，并配置 VITE_API_URL（如 http://127.0.0.1:8080/api）后刷新，即可测试学业报告模板。'
                  : 'Local mode now. Enable VITE_USE_CLOUD_STORAGE=true and set VITE_API_URL (e.g. http://127.0.0.1:8080/api) to test report templates.'}
              </div>
            )}

            {reportSettingPortraitTab === 'academic' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{isZh ? '学年' : 'Academic year'}</label>
                    <select
                      value={reportSettingYearId}
                      onChange={(e) => setReportSettingYearId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    >
                      <option value="">{isZh ? '请选择' : 'Select'}</option>
                      {years.map((y) => (
                        <option key={y.id} value={y.id}>{y.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{isZh ? '学期' : 'Term'}</label>
                    <select
                      value={reportSettingTerm}
                      onChange={(e) => setReportSettingTerm(e.target.value as Term)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    >
                      <option value="Semester 1">{isZh ? '上学期' : 'Semester 1'}</option>
                      <option value="Semester 2">{isZh ? '下学期' : 'Semester 2'}</option>
                    </select>
                  </div>
                  <div className="flex items-end justify-end">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-1 inline-flex gap-1">
                      <Button size="sm" variant="default" onClick={() => setReportSettingPortraitTab('academic')}>
                        {isZh ? '学业报告' : 'Academic report'}
                      </Button>
                    </div>
                  </div>
                </div>
                {reportSettingLoading && <div className="text-xs text-slate-500">{isZh ? '加载中…' : 'Loading…'}</div>}
                {reportYearPresetLoading && (
                  <div className="text-xs text-slate-500">{isZh ? '加载学科评价设置中…' : 'Loading subject evaluation settings...'}</div>
                )}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                  <div className="text-sm font-semibold text-slate-800">{isZh ? '学业报告配置流程' : 'Academic report configuration flow'}</div>
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-2 items-center">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <Button type="button" size="sm" variant="outline" className="w-full justify-start" onClick={() => void openSubjectEvaluationSettings()} disabled={!reportSettingYearId}>
                        {isZh ? '第一步 设置评价学科' : 'Step 1 Evaluation subjects'}
                      </Button>
                    </div>
                    <div className="hidden lg:flex items-center justify-center text-slate-400">→</div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <Button type="button" size="sm" variant="outline" className="w-full justify-start" onClick={() => void openExamSubjectSettings()} disabled={!reportSettingYearId}>
                        {isZh ? '第二步 设置考试学科' : 'Step 2 Exam subjects'}
                      </Button>
                    </div>
                    <div className="hidden lg:flex items-center justify-center text-slate-400">→</div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <Button type="button" size="sm" variant="outline" className="w-full justify-start" onClick={() => void openCreateEvaluationDesigner()} disabled={!reportSettingYearId}>
                        {isZh ? '第三步 新建学业报告' : 'Step 3 New academic report'}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-700">
                      {isZh ? '本学期报告' : 'Reports this term'}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {isZh
                        ? '建议先按流程完成学科目标与考试学科设置，再为各学段新建学期报告并发布；下列为逐条独立管理的报告。'
                        : 'Complete subject targets and exam subject settings first, then create and publish term reports per segment. Each item is managed independently.'}
                    </p>
                  </div>
                  {USE_CLOUD_STORAGE && reportSettingYearId && reportTemplateList.length > 0 && (
                    <div
                      className={`h-2 w-full rounded-full overflow-hidden ${
                        termReportOverallLoading ? 'bg-slate-200 animate-pulse' : 'bg-slate-200'
                      }`}
                      aria-hidden
                    >
                      {!termReportOverallLoading && termReportOverallRate != null && (
                        <div
                          className="h-full bg-emerald-600 transition-[width] duration-500 ease-out"
                          style={{ width: `${Math.min(Math.max(termReportOverallRate, 0), 100)}%` }}
                        />
                      )}
                    </div>
                  )}
                  {reportTemplateList.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      {isZh
                        ? '当前暂无报告。请先在上方完成前两步配置，再点击「新建学业报告」。'
                        : 'No reports yet. Complete the first two setup steps above, then use “New academic report”.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {reportTemplateList.map((tpl) => (
                        <div
                          key={tpl.id}
                          className={`rounded border px-2 py-2 flex items-center justify-between gap-2 ${tpl.id === selectedReportTemplateId ? 'border-slate-400 bg-slate-50' : 'border-slate-200'}`}
                        >
                          <button
                            type="button"
                            className="text-left flex-1 min-w-0"
                            onClick={() => setSelectedReportTemplateId(tpl.id)}
                          >
                            <div className="text-sm font-medium text-slate-800 truncate">
                              {tpl.title || (isZh ? '未命名报告' : 'Untitled report')}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {(tpl.schoolSegmentId
                                ? `${isZh ? '学段' : 'Segment'}: ${reportSegmentLabelById.get(tpl.schoolSegmentId) ?? tpl.schoolSegmentId} · `
                                : '') +
                                (isZh
                                  ? `状态：${tpl.releasedAt ? '已正式推送' : tpl.status === 'published' ? '已发布待填写' : tpl.status === 'closed' ? '已关闭待推送' : '草稿'}`
                                  : `Status: ${tpl.releasedAt ? 'released' : tpl.status}`)}
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => void openEditEvaluationDesigner(tpl.id)}>
                              {isZh ? '编辑' : 'Edit'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void setTemplateStatus(tpl.id, 'published')}>
                              {isZh ? '发布' : 'Publish'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void setTemplateStatus(tpl.id, 'closed')}>
                              {isZh ? '停发' : 'Stop'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void openProgressConfirm(tpl.id, tpl.title)}>
                              {isZh ? '进度确认' : 'Progress'}
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => void releaseTemplateToStudents(tpl.id)}
                              disabled={tpl.status !== 'closed' || !!tpl.releasedAt}
                              className="bg-amber-600 text-white hover:bg-amber-700"
                            >
                              {isZh ? '正式推送' : 'Release'}
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => void deleteEvaluationTemplate(tpl.id)}>
                              {isZh ? '删除' : 'Delete'}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {adminTab === 'database' && isSystemAdmin && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                {isZh ? '数据库只读浏览' : 'Database read-only browser'}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  void loadDatabaseTables()
                    .then((chosen) => {
                      if (chosen) return loadDatabaseRows(chosen, 0, dbLimit);
                    })
                    .catch((e: unknown) => setError((e as Error)?.message || 'Failed to refresh database view'));
                }}
                disabled={dbTableLoading || dbRowsLoading}
              >
                {isZh ? '刷新' : 'Refresh'}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {isZh
                ? '仅用于查看数据，不支持增删改。'
                : 'Read-only view. Create/update/delete actions are disabled.'}
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  {isZh ? '数据表与行数' : 'Tables and row counts'}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {dbTableLoading ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
                  ) : dbTables.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '未发现数据表。' : 'No tables found.'}</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {dbTables.map((t) => (
                        <li key={t.tableName}>
                          <button
                            type="button"
                            className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${dbSelectedTable === t.tableName ? 'bg-slate-50' : ''}`}
                            onClick={() => {
                              setDbSelectedTable(t.tableName);
                              setDbOffset(0);
                              setError(null);
                              void loadDatabaseRows(t.tableName, 0, dbLimit).catch((e: unknown) =>
                                setError((e as Error)?.message || 'Failed to load table rows')
                              );
                            }}
                          >
                            <div className="font-mono text-xs text-slate-800">{t.tableName}</div>
                            <div className="text-xs text-slate-500">
                              {isZh ? `行数：${t.rowCount}` : `Rows: ${t.rowCount}`}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="lg:col-span-8 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-slate-600">
                    {dbSelectedTable
                      ? (
                        isZh
                          ? <>表：<span className="font-mono text-slate-800">{dbSelectedTable}</span>{dbPrimaryKey ? <>（主键：<span className="font-mono">{dbPrimaryKey}</span>）</> : ''}</>
                          : <>Table: <span className="font-mono text-slate-800">{dbSelectedTable}</span>{dbPrimaryKey ? <> (PK: <span className="font-mono">{dbPrimaryKey}</span>)</> : ''}</>
                      )
                      : (isZh ? '请选择左侧数据表' : 'Select a table on the left')}
                  </div>
                  {dbSelectedTable && (
                    <div className="text-xs text-slate-500">
                      {isZh ? `共 ${dbTotal} 行` : `Total ${dbTotal} rows`}
                    </div>
                  )}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {dbRowsLoading ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
                  ) : !dbSelectedTable ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '请先选择数据表。' : 'Please choose a table first.'}</p>
                  ) : dbColumns.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '该表无字段。' : 'This table has no columns.'}</p>
                  ) : (
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          {dbColumns.map((col) => (
                            <th key={col} className="px-2 py-2 font-medium whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dbRows.length === 0 ? (
                          <tr>
                            <td colSpan={dbColumns.length} className="px-2 py-6 text-center text-slate-500">
                              {isZh ? '暂无数据。' : 'No rows.'}
                            </td>
                          </tr>
                        ) : (
                          dbRows.map((row, idx) => (
                            <tr key={`${dbOffset + idx}`} className="border-b border-slate-100 align-top">
                              {dbColumns.map((col) => {
                                const value = row[col];
                                const display = value == null
                                  ? 'NULL'
                                  : typeof value === 'object'
                                    ? JSON.stringify(value)
                                    : String(value);
                                return (
                                  <td key={`${idx}-${col}`} className="px-2 py-1.5 text-slate-700 max-w-[260px]">
                                    <div className="truncate" title={display}>{display}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                {dbSelectedTable && (
                  <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {isZh
                        ? `第 ${dbTotal === 0 ? 0 : dbOffset + 1} - ${Math.min(dbOffset + dbLimit, dbTotal)} 条`
                        : `${dbTotal === 0 ? 0 : dbOffset + 1}-${Math.min(dbOffset + dbLimit, dbTotal)}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dbRowsLoading || dbOffset <= 0}
                        onClick={() => {
                          const nextOffset = Math.max(0, dbOffset - dbLimit);
                          void loadDatabaseRows(dbSelectedTable, nextOffset, dbLimit).catch((e: unknown) =>
                            setError((e as Error)?.message || 'Failed to load previous page')
                          );
                        }}
                      >
                        {isZh ? '上一页' : 'Prev'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dbRowsLoading || dbOffset + dbLimit >= dbTotal}
                        onClick={() => {
                          const nextOffset = dbOffset + dbLimit;
                          void loadDatabaseRows(dbSelectedTable, nextOffset, dbLimit).catch((e: unknown) =>
                            setError((e as Error)?.message || 'Failed to load next page')
                          );
                        }}
                      >
                        {isZh ? '下一页' : 'Next'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <Dialog open={dialogCreateYear} onOpenChange={setDialogCreateYear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isZh ? '新建学年' : 'New academic year'}</DialogTitle>
            <DialogDescription>{isZh ? '输入学年名称' : 'Enter year name'}</DialogDescription>
          </DialogHeader>
          <input
            value={newYearName}
            onChange={(e) => setNewYearName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder={isZh ? '2024–2025 学年' : '2024–2025'}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCreateYear(false)}>{isZh ? '取消' : 'Cancel'}</Button>
            <Button onClick={handleCreateYear} disabled={!newYearName.trim() || yearSubmitLoading}>
              {yearSubmitLoading ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogYearManagement} onOpenChange={setDialogYearManagement}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '学年管理' : 'Academic years'}</DialogTitle>
            <DialogDescription>{isZh ? '删除学年将同时删除该学年下所有班级与学籍。' : 'Deleting a year removes all its classes and enrollments.'}</DialogDescription>
          </DialogHeader>
          {years.length === 0 ? (
            <p className="text-sm text-slate-500">{isZh ? '暂无学年。' : 'No academic years.'}</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {years.map((y) => (
                <li key={y.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                  <span className="font-medium text-slate-800">{y.name}</span>
                  {canEditYears && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => handleDeleteYear(y)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {isZh ? '删除' : 'Delete'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogYearManagement(false)}>{isZh ? '关闭' : 'Close'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={studentLoginOpen}
        onOpenChange={(open) => {
          if (!open) closeStudentLoginDialog();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{isZh ? '学生登录账号导入' : 'Import student logins'}</DialogTitle>
            <DialogDescription>
              {studentLoginPhase === 'preview'
                ? (isZh
                  ? '以下为当前档案中有学号的学生；确认后将把学号作为用户名、并写入随机 6 位数字密码到服务器。已开通或学号冲突的条目将被跳过。'
                  : 'Students with a student number below. Confirm to create accounts (username = number, random 6-digit password). Existing or conflicting rows are skipped.')
                : (isZh ? '导入已完成。' : 'Import finished.')}
            </DialogDescription>
          </DialogHeader>
          {studentLoginPhase === 'preview' && studentLoginPreview.length === 0 && (
            <p className="text-sm text-slate-500 py-4">
              {isZh ? '没有可导入的学生（需填写学号）。' : 'No students with a student number to import.'}
            </p>
          )}
          {studentLoginPhase === 'preview' && studentLoginPreview.length > 0 && (
            <div className="overflow-auto flex-1 min-h-0 border border-slate-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 text-left text-xs text-slate-600">
                  <tr>
                    <th className="py-2 px-3 font-medium">{isZh ? '学号' : 'No.'}</th>
                    <th className="py-2 px-3 font-medium">{isZh ? '中文名' : 'ZH'}</th>
                    <th className="py-2 px-3 font-medium">{isZh ? '英文名' : 'EN'}</th>
                    <th className="py-2 px-3 font-medium">{isZh ? '随机密码' : 'Password'}</th>
                  </tr>
                </thead>
                <tbody>
                  {studentLoginPreview.map((r) => (
                    <tr key={r.studentId} className="border-t border-slate-100">
                      <td className="py-2 px-3 font-mono">{r.studentNumber}</td>
                      <td className="py-2 px-3">{r.nameZh || '—'}</td>
                      <td className="py-2 px-3">{r.nameEn || '—'}</td>
                      <td className="py-2 px-3 font-mono">{r.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {studentLoginPhase === 'done' && studentLoginResult && (
            <p className="text-sm text-slate-700 py-2">
              {isZh
                ? `成功开通 ${studentLoginResult.created} 个账号；跳过 ${studentLoginResult.skipped} 条。可在「用户管理 → 学生账号」中查看。`
                : `Created ${studentLoginResult.created} account(s); skipped ${studentLoginResult.skipped}. See Users → Student accounts.`}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {studentLoginPhase === 'preview' ? (
              <>
                <Button variant="outline" onClick={closeStudentLoginDialog} disabled={studentLoginBusy}>
                  {isZh ? '取消' : 'Cancel'}
                </Button>
                <Button
                  onClick={() => void confirmStudentLoginImport()}
                  disabled={studentLoginBusy || studentLoginPreview.length === 0}
                >
                  {studentLoginBusy ? (isZh ? '导入中…' : 'Importing…') : isZh ? '确认导入' : 'Confirm import'}
                </Button>
              </>
            ) : (
              <Button onClick={closeStudentLoginDialog}>{isZh ? '关闭' : 'Close'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createEvaluationOpen}
        onOpenChange={(open) => {
          setCreateEvaluationOpen(open);
          if (!open) {
            setCreateEvaluationTitle('');
            setCreateEvaluationFromTemplateId('');
            setAddModuleMenuOpen(false);
            setEvaluationDesignerError(null);
            setReportTargetStageId('');
            setReportTargetCheckedCourseIds([]);
            setReportTargetActiveSubjectKey('');
            setReportTargetGradeConfigBySubject({});
            setReportTargetDirtySubjectKeys(new Set());
            setReportTargetUnifiedEditOpen(false);
            setPresetTargetDimTableColumnCount(PRESET_TARGET_DEFAULT_DIMENSION_COLS);
            lastPresetTargetDimNavKeyRef.current = { nav: '', preset: '' };
            setAcademicPreviewTargetLevels({});
            setAcademicPreviewLearningQuality({});
            setNewReportSchoolSegmentId('');
            setNewReportPreviewGradeId('');
            setDesignerScoreMinScores(null);
            setScoreBandDialogOpen(false);
            setScoreBandSegmentId('');
            setScoreBandDraft({});
            presetTargetChecklistStageRef.current = null;
            setReportExamCheckedCourseIds([]);
            setReportExamActiveCourseId('');
            setReportExamConfigByCourse({});
          }
        }}
      >
        <DialogContent className="sm:max-w-[1120px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {createEvaluationMode === 'edit'
                ? (isZh ? '编辑学业报告' : 'Edit academic report')
                : createEvaluationMode === 'preset'
                  ? (isZh ? '设置评价学科' : 'Evaluation subject settings')
                  : createEvaluationMode === 'exam'
                    ? (isZh ? '设置考试学科' : 'Exam subject settings')
                  : (isZh ? '新建学业报告' : 'New academic report')}
            </DialogTitle>
            {createEvaluationMode === 'preset' ? (
              <DialogDescription>
                {isZh
                  ? '按课程配置本学年可选的课程目标维度及 ABCD 说明；保存后各科学期报告可复用。成绩与学科评语在「新建/编辑学业报告」中配置。'
                  : 'Optional target dimensions per course for this year. Configure scores and comments in each term report.'}
              </DialogDescription>
            ) : createEvaluationMode === 'exam' ? (
              <DialogDescription>
                {isZh
                  ? '先勾选本次需要考试评价的学科，再按年级配置百分比等第与维度分值。'
                  : 'Select exam subjects first, then configure grade percent bands and dimension scores by grade.'}
              </DialogDescription>
            ) : createEvaluationMode === 'edit' ? (
              <DialogDescription>
                {isZh ? '预览并定义整份学业报告结构。' : 'Preview and define the full academic report structure.'}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-3">
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学年 / 学期' : 'Year / Term'}</label>
                <div className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 flex items-center">
                  {isZh
                    ? `${years.find((y) => y.id === reportSettingYearId)?.name || '—'} · ${reportSettingTerm === 'Semester 1' ? '上学期' : '下学期'}`
                    : `${years.find((y) => y.id === reportSettingYearId)?.name || '-'} · ${reportSettingTerm}`}
                </div>
              </div>
              {createEvaluationMode === 'preset' || createEvaluationMode === 'exam' ? (
                <div className="lg:col-span-9">
                  <label className="block text-xs text-slate-500 mb-1">{isZh ? '学段（来自课程设置）' : 'Stage (from curriculum)'}</label>
                  <select
                    value={reportTargetStageId}
                    onChange={(e) => setReportTargetStageId(e.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white"
                  >
                    {reportTargetSegments.length === 0 && (
                      <option value="">
                        {isZh ? '尚未配置学段，请先在课程管理里设置年级学段。' : 'No stage found. Configure grade segments in curriculum first.'}
                      </option>
                    )}
                    {reportTargetSegments.map((seg) => (
                      <option key={seg.id} value={seg.id}>{seg.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="lg:col-span-3">
                    <label className="block text-xs text-slate-500 mb-1">{isZh ? '学段' : 'School segment'}</label>
                    <select
                      value={newReportSchoolSegmentId}
                      onChange={(e) => setNewReportSchoolSegmentId(e.target.value)}
                      disabled={createEvaluationMode === 'edit'}
                      className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-600"
                    >
                      {reportTargetSegments.length === 0 && (
                        <option value="">
                          {isZh ? '未配置学段' : 'No segment'}
                        </option>
                      )}
                      {reportTargetSegments.map((seg) => (
                        <option key={seg.id} value={seg.id}>{seg.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-6">
                    <label className="block text-xs text-slate-500 mb-1">{isZh ? '报告名称' : 'Report name'}</label>
                    <input
                      value={createEvaluationTitle}
                      onChange={(e) => {
                        setCreateEvaluationTitle(e.target.value);
                        setReportSettingTitle(e.target.value);
                      }}
                      className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"
                      placeholder={isZh ? '如：初中期末学业报告' : 'e.g. Middle school final report'}
                    />
                  </div>
                </>
              )}
            </div>
            {createEvaluationMode === 'preset' && (
              <>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-700 leading-tight">
                    {isZh ? '评价学科（纳入学业报告的课程）' : 'Evaluation subjects (included in reports)'}
                  </div>
                  {reportTargetStageCourses.length === 0 ? (
                    <p className="text-[11px] text-slate-500 leading-snug">
                      {isZh ? '当前学段暂无课程。请先在课程管理里给该学段配置课程。' : 'No courses in this stage. Add courses in curriculum settings first.'}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                          {reportTargetStageCourses.map((course) => {
                            const checked = reportTargetCheckedCourseIds.includes(course.id);
                            return (
                              <label key={course.id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-tight ${checked ? 'border-slate-400 bg-white' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const enabled = e.target.checked;
                                    const sk = staffingSubjectKeyFromCourse(course.id, course.name);
                                    const nextChecked = enabled
                                      ? Array.from(new Set([...reportTargetCheckedCourseIds, course.id]))
                                      : reportTargetCheckedCourseIds.filter((id) => id !== course.id);
                                    setReportTargetCheckedCourseIds(nextChecked);
                                    setReportTargetEvaluationGradeByCourse((prevGrades) => {
                                      const nextGrades = { ...prevGrades };
                                      if (enabled && reportTargetCurrentSegment) {
                                        nextGrades[course.id] = [...reportTargetCurrentSegment.gradeIds];
                                      } else {
                                        delete nextGrades[course.id];
                                      }
                                      return nextGrades;
                                    });
                                    if (!enabled && reportTargetActiveSubjectKey === sk) {
                                      const checkedSet = new Set(nextChecked);
                                      const fallback =
                                        reportTargetStageCourses.find(
                                          (c) => checkedSet.has(c.id) && staffingSubjectKeyFromCourse(c.id, c.name) !== sk,
                                        );
                                      setReportTargetActiveSubjectKey(
                                        fallback ? staffingSubjectKeyFromCourse(fallback.id, fallback.name) : '',
                                      );
                                    }
                                  }}
                                  className="h-3.5 w-3.5 rounded border-slate-300"
                                />
                                <span>{formatCourseBilingualDisplayName(course)}</span>
                              </label>
                            );
                          })}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 self-start h-8 text-xs px-2.5"
                          onClick={() => void saveReportTargetStageInclusion()}
                          disabled={!reportSettingYearId || reportTargetInclusionSaving}
                        >
                          {reportTargetInclusionSaving
                            ? (isZh ? '保存中…' : 'Saving…')
                            : (isZh ? '保存当前学科设置' : 'Save current subject selection')}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 w-full min-w-0">
                        <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                          {isZh ? '进度' : 'Done'} {reportTargetStageCompletion.completed}/{reportTargetStageCompletion.total}
                        </span>
                        <div className="flex-1 min-w-0 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full bg-slate-700 transition-all" style={{ width: `${reportTargetStageCompletion.percent}%` }} />
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                          {isZh ? `余 ${reportTargetStageCompletion.pending}` : `${reportTargetStageCompletion.pending} left`}
                        </span>
                      </div>
                      {reportTargetStageCourses.length > 0 && reportTargetStageSubjects.length === 0 && (
                        <p className="text-[11px] text-slate-500 leading-snug">
                          {isZh
                            ? '当前学段下尚无已保存的年级目标，或尚未勾选纳入学科。请勾选上方课程、填写目标并保存；纳入范围变更后请点击「保存当前学科设置」。'
                            : 'No saved targets for this segment yet, or no courses included. Check courses above, fill targets, save; after changing inclusion use “Save current subject selection”.'}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-800 pt-0.5">
                      {isZh ? '等第说明（全学科共用）' : 'Shared A–D rubric'}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-slate-600"
                      title={isZh ? '修改等第说明' : 'Edit rubric'}
                      aria-label={isZh ? '修改等第说明' : 'Edit rubric'}
                      onClick={() => {
                        setReportTargetUnifiedDraft({ ...reportTargetUnifiedLevel });
                        setReportTargetUnifiedEditOpen(true);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-slate-700 leading-snug">
                    {(['A', 'B', 'C', 'D'] as const).map((lv) => (
                      <p key={lv} className="break-words">
                        <span className="font-semibold text-slate-800">{lv}</span>
                        <span className="text-slate-500"> · </span>
                        {reportTargetUnifiedLevel[lv]}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{isZh ? '选择学科进行配置' : 'Subject to configure'}</label>
                    <select
                      value={reportTargetActiveSubjectKey}
                      onChange={(e) => setReportTargetActiveSubjectKey(e.target.value)}
                      className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white"
                    >
                      {reportTargetStageSubjects.length === 0 && (
                        <option value="">{isZh ? '请先勾选至少一门课程' : 'Select at least one course first'}</option>
                      )}
                      {reportTargetStageSubjects.map((s) => (
                        <option key={s.subjectKey} value={s.subjectKey}>
                          {s.subjectNameZh} {s.subjectNameEn && s.subjectNameEn !== s.subjectNameZh ? `(${s.subjectNameEn})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {reportTargetActiveSubject && (
                    <div className="space-y-3 border-t border-slate-100 pt-3">
                      <div className="text-sm font-semibold text-slate-800">
                        {isZh ? `${reportTargetActiveSubject.subjectNameZh} 学科目标维度` : `${reportTargetActiveSubject.subjectNameEn} target dimensions`}
                      </div>
                      {(() => {
                        const gc = normalizeGradeConfig(loadGradeConfigSync());
                        const gradeIds = reportTargetCurrentSegment?.gradeIds ?? [];
                        const sk = reportTargetActiveSubject.subjectKey;
                        const byGrade = ensurePresetSubjectGradeConfig(sk);
                        const dataMax = gradeIds.reduce(
                          (m, gid) => Math.max(m, (byGrade[gid] ?? []).length),
                          0,
                        );
                        const dimColCount = Math.max(1, presetTargetDimTableColumnCount, dataMax);
                        return (
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[520px] border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700">
                                  <th className="border border-slate-200 px-1 py-1.5 text-center font-semibold w-10" title={isZh ? '参加评价' : 'In evaluation'}>
                                    {isZh ? '评价' : 'Eval'}
                                  </th>
                                  <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold whitespace-nowrap w-14">
                                    {isZh ? '年级' : 'Grade'}
                                  </th>
                                  {Array.from({ length: dimColCount }, (_, i) => (
                                    <th key={i} className="border border-slate-200 px-1.5 py-1.5 text-left font-medium min-w-[100px]">
                                      <div className="flex items-center justify-between gap-1">
                                        <span>{isZh ? `维度${i + 1}` : `Dim ${i + 1}`}</span>
                                        {dimColCount > 1 ? (
                                          <button
                                            type="button"
                                            className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                                            title={isZh ? '移除此维度列（全年级）' : 'Remove this dimension column (all grades)'}
                                            onClick={() => removePresetTargetDimensionColumn(sk, i)}
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </th>
                                  ))}
                                  <th className="border border-slate-200 px-1 py-1.5 w-10 text-center align-middle">
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                      title={isZh ? '增加维度列' : 'Add dimension column'}
                                      onClick={() => setPresetTargetDimTableColumnCount((c) => c + 1)}
                                    >
                                      <Plus className="h-4 w-4" />
                                    </button>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {gradeIds.map((gradeId) => {
                                  const gradeLevel = getGradeLevelById(gc, gradeId);
                                  const gradeLabel = getGradeLabelByLevel(gc, gradeLevel);
                                  const rowDims = byGrade[gradeId] ?? [];
                                  const activeCourseId = String(reportTargetActiveSubject?.courseId ?? '').trim();
                                  const evalGrades =
                                    reportTargetEvaluationGradeByCourse[activeCourseId]
                                    ?? gradeIds;
                                  const evalOn = evalGrades.includes(gradeId);
                                  return (
                                    <tr key={gradeId} className={evalOn ? 'bg-white' : 'bg-slate-100 text-slate-400'}>
                                      <td className="border border-slate-200 px-1 py-1 text-center align-top">
                                        <input
                                          type="checkbox"
                                          checked={evalOn}
                                          disabled={!activeCourseId}
                                          onChange={(e) => {
                                            if (!activeCourseId) return;
                                            const on = e.target.checked;
                                            setReportTargetEvaluationGradeByCourse((prev) => {
                                              const current = new Set(prev[activeCourseId] ?? gradeIds);
                                              if (on) current.add(gradeId);
                                              else current.delete(gradeId);
                                              return { ...prev, [activeCourseId]: [...current] };
                                            });
                                          }}
                                          className="h-3.5 w-3.5 rounded border-slate-300"
                                        />
                                      </td>
                                      <td className="border border-slate-200 px-2 py-1 font-semibold whitespace-nowrap align-top">
                                        {gradeLabel}
                                      </td>
                                      {Array.from({ length: dimColCount }, (_, dimIdx) => {
                                        const d = rowDims[dimIdx] ?? createEmptyPresetDimension();
                                        return (
                                          <td key={dimIdx} className="border border-slate-200 p-1 align-top">
                                            <textarea
                                              rows={2}
                                              value={d.dimensionLabelZh}
                                              disabled={!evalOn}
                                              onChange={(e) =>
                                                updatePresetSubjectGradeConfig(sk, (prev) => {
                                                  const next = { ...prev };
                                                  const arr = [...(next[gradeId] ?? [])];
                                                  while (arr.length <= dimIdx) {
                                                    arr.push(createEmptyPresetDimension());
                                                  }
                                                  arr[dimIdx] = {
                                                    ...arr[dimIdx],
                                                    dimensionLabelZh: e.target.value,
                                                    dimensionLabelEn: e.target.value,
                                                  };
                                                  next[gradeId] = arr;
                                                  return next;
                                                })
                                              }
                                              className="w-full min-h-[40px] rounded border border-slate-300 px-1.5 py-1 text-xs leading-snug"
                                              placeholder={isZh ? '名称' : 'Name'}
                                            />
                                          </td>
                                        );
                                      })}
                                      <td className="border border-slate-200 bg-slate-50/50" aria-hidden />
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                      {reportTargetActiveSubjectStaffingWarnings.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                          {reportTargetActiveSubjectStaffingWarnings.map((msg) => (
                            <p key={msg} className="text-xs text-amber-950 leading-snug">
                              {msg}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          onClick={() => void saveCurrentSubjectTargetSettings()}
                          disabled={!reportTargetActiveSubject || reportYearPresetSaving}
                        >
                          {reportYearPresetSaving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存学科目标设置' : 'Save subject target settings')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {createEvaluationMode === 'exam' && (
              <section className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-700 leading-tight">
                    {isZh ? '考试学科设置' : 'Exam subject setup'}
                  </div>
                  {reportExamEvaluationCourses.length === 0 ? (
                    <p className="text-[11px] text-slate-500 leading-snug">
                      {isZh
                        ? '请先在「设置评价学科」中勾选纳入评价的课程并保存。'
                        : 'Select evaluation subjects in Step 1 and save first.'}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                          {reportExamEvaluationCourses.map((course) => {
                            const checked = reportExamCheckedCourseIds.includes(course.id);
                            return (
                              <label
                                key={`exam-pick-${course.id}`}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-tight ${checked ? 'border-slate-400 bg-white' : 'border-slate-200 bg-slate-100 text-slate-500'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const enabled = e.target.checked;
                                    const next = enabled
                                      ? Array.from(new Set([...reportExamCheckedCourseIds, course.id]))
                                      : reportExamCheckedCourseIds.filter((id) => id !== course.id);
                                    setReportExamCheckedCourseIds(next);
                                    setReportExamGradeByCourse((prevGrades) => {
                                      const nextGrades = { ...prevGrades };
                                      if (!reportTargetCurrentSegment) return nextGrades;
                                      const evalGrades = resolveEvaluationGradesForCourse(
                                        reportTargetStageId,
                                        course.id,
                                        reportTargetCurrentSegment.gradeIds,
                                        reportYearDimensionPreset?.stageInclusion,
                                        reportYearDimensionPreset?.evaluationGradeInclusion,
                                      );
                                      if (enabled) {
                                        nextGrades[course.id] =
                                          prevGrades[course.id]?.length
                                            ? prevGrades[course.id]
                                            : [...evalGrades];
                                      } else {
                                        delete nextGrades[course.id];
                                      }
                                      return nextGrades;
                                    });
                                    if (!enabled && reportExamActiveCourseId === course.id) {
                                      setReportExamActiveCourseId(next[0] ?? '');
                                    }
                                  }}
                                  className="h-3.5 w-3.5 rounded border-slate-300"
                                />
                                <span>{formatCourseBilingualDisplayName(course)}</span>
                              </label>
                            );
                          })}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 self-start h-8 text-xs px-2.5"
                          onClick={() => void saveReportExamSettings()}
                          disabled={!reportSettingYearId || reportExamSaving}
                        >
                          {reportExamSaving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存考试学科设置' : 'Save exam settings')}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 w-full min-w-0">
                        <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                          {isZh ? '进度' : 'Done'} {reportExamStageCompletion.completed}/{reportExamStageCompletion.total}
                        </span>
                        <div className="flex-1 min-w-0 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full bg-slate-700 transition-all" style={{ width: `${reportExamStageCompletion.percent}%` }} />
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                          {isZh ? `余 ${reportExamStageCompletion.pending}` : `${reportExamStageCompletion.pending} left`}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{isZh ? '选择考试学科进行配置' : 'Exam subject to configure'}</label>
                    <select
                      value={reportExamActiveCourseId}
                      onChange={(e) => setReportExamActiveCourseId(e.target.value)}
                      className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white"
                    >
                      {reportExamCheckedCourseIds.length === 0 && (
                        <option value="">{isZh ? '请先在上方勾选并保存考试学科' : 'Select exam subjects above and save first'}</option>
                      )}
                      {reportExamCheckedCourseIds.map((cid) => {
                        const c = reportExamEvaluationCourses.find((x) => x.id === cid);
                        if (!c) return null;
                        return (
                          <option key={cid} value={cid}>
                            {formatCourseBilingualDisplayName(c)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {reportExamActiveCourseId ? (
                    (() => {
                      const activeCourse = reportTargetStageCourses.find((c) => c.id === reportExamActiveCourseId);
                      if (!activeCourse || !reportTargetCurrentSegment) return null;
                      const activeKey = staffingSubjectKeyFromCourse(activeCourse.id, activeCourse.name);
                      const activeLabels = getCourseReportSubjectLabels(activeCourse);
                      const byCourse = reportExamConfigByCourse[activeCourse.id] ?? {
                        courseId: activeCourse.id,
                        subjectKey: activeKey,
                        subjectNameZh: activeLabels.subjectNameZh,
                        subjectNameEn: activeLabels.subjectNameEn,
                        gradeConfigs: {},
                      };
                      const updateGrade = (gid: string, updater: (g: ExamGradeConfigDraft) => ExamGradeConfigDraft) => {
                        setReportExamConfigByCourse((prev) => {
                          const current = prev[activeCourse.id] ?? byCourse;
                          const base = current.gradeConfigs[gid] ?? createEmptyExamGradeDraft();
                          return {
                            ...prev,
                            [activeCourse.id]: {
                              ...current,
                              gradeConfigs: {
                                ...current.gradeConfigs,
                                [gid]: updater(base),
                              },
                            },
                          };
                        });
                      };
                      return (
                        <div className="space-y-3">
                          <div className="text-sm font-semibold text-slate-800">{isZh ? '等第标准（百分比）' : 'Percent grade bands'}</div>
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[720px] border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700">
                                  <th className="border border-slate-200 px-1 py-1.5 text-center font-semibold w-10">{isZh ? '考试' : 'Exam'}</th>
                                  <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold">{isZh ? '年级' : 'Grade'}</th>
                                  {REPORT_SCORE_LETTER_GRADES.map((rg) => (
                                    <th key={rg} className="border border-slate-200 px-2 py-1.5 text-left font-semibold">{rg}%</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {reportTargetCurrentSegment.gradeIds.map((gid) => {
                                  const gc = normalizeGradeConfig(loadGradeConfigSync());
                                  const gradeLabel = getGradeLabelByLevel(gc, getGradeLevelById(gc, gid));
                                  const g = byCourse.gradeConfigs[gid] ?? createEmptyExamGradeDraft();
                                  const evalGrades = resolveEvaluationGradesForCourse(
                                    reportTargetStageId,
                                    activeCourse.id,
                                    reportTargetCurrentSegment.gradeIds,
                                    reportYearDimensionPreset?.stageInclusion,
                                    reportYearDimensionPreset?.evaluationGradeInclusion,
                                  );
                                  if (!evalGrades.includes(gid)) return null;
                                  const examGrades = reportExamGradeByCourse[activeCourse.id] ?? evalGrades;
                                  const examOn = examGrades.includes(gid);
                                  return (
                                    <tr key={`exam-grade-${gid}`} className={examOn ? 'bg-white' : 'bg-slate-100 text-slate-400'}>
                                      <td className="border border-slate-200 px-1 py-1 text-center">
                                        <input
                                          type="checkbox"
                                          checked={examOn}
                                          onChange={(e) => {
                                            const on = e.target.checked;
                                            setReportExamGradeByCourse((prev) => {
                                              const current = new Set(prev[activeCourse.id] ?? evalGrades);
                                              if (on) current.add(gid);
                                              else current.delete(gid);
                                              return { ...prev, [activeCourse.id]: [...current] };
                                            });
                                          }}
                                          className="h-3.5 w-3.5 rounded border-slate-300"
                                        />
                                      </td>
                                      <td className="border border-slate-200 px-2 py-1.5 font-semibold">{gradeLabel}</td>
                                      {REPORT_SCORE_LETTER_GRADES.map((rg) => (
                                        <td key={`${gid}-${rg}`} className="border border-slate-200 p-1">
                                          <input
                                            value={g.percentBands[rg as ReportGrade] ?? ''}
                                            disabled={!examOn}
                                            onChange={(e) => updateGrade(gid, (prev) => ({ ...prev, percentBands: { ...prev.percentBands, [rg as ReportGrade]: e.target.value } }))}
                                            className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                                            placeholder="0-100"
                                          />
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="text-sm font-semibold text-slate-800">{isZh ? '目标维度分值配置' : 'Dimension score allocation'}</div>
                          {reportExamActiveCourseMissingPresetDimensions ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs text-amber-950 leading-snug flex-1 min-w-0">
                                {isZh
                                  ? '当前学科在「设置学科目标」中尚未为本学段年级配置目标维度。请先到第一步「设置学科目标」中勾选该课程并填写各年级维度，保存后再回到此处配置分值。'
                                  : 'This subject has no target dimensions for this stage’s grades in Subject target settings. Open Step 1, include this course, add dimensions per grade, save, then return here.'}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0 border-amber-300 bg-white hover:bg-amber-100/80 text-amber-950"
                                onClick={() => {
                                  pendingOpenPresetFocusCourseIdRef.current = activeCourse.id;
                                  setCreateEvaluationMode('preset');
                                  setCreateEvaluationTitle(
                                    isZh ? '本学年学科目标维度框架' : 'Yearly subject target framework',
                                  );
                                  const subjectOnly = {
                                    homeroom_comment: false,
                                    subject_evaluation: true,
                                  } as Record<EvaluationDesignerModule, boolean>;
                                  setEnabledEvaluationModules(subjectOnly);
                                  setEvaluationModuleOrder(deriveModuleOrderFromEnabled(subjectOnly));
                                }}
                              >
                                {isZh ? '前往学科目标设置' : 'Open subject target settings'}
                              </Button>
                            </div>
                          ) : null}
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[860px] border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700">
                                  <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold">{isZh ? '年级' : 'Grade'}</th>
                                  {(() => {
                                    const dimColCount = reportTargetCurrentSegment.gradeIds.reduce((m, gid) => {
                                      const dims = getPresetDimensionsForReportPreviewGrade(reportYearDimensionPreset, activeCourse.id, activeKey, gid);
                                      return Math.max(m, dims.length);
                                    }, 0);
                                    return Array.from({ length: dimColCount }, (_, idx) => (
                                      <th key={`dim-col-${idx}`} className="border border-slate-200 px-2 py-1.5 text-left font-semibold min-w-[180px]">
                                        {isZh ? `维度${idx + 1}` : `Dimension ${idx + 1}`}
                                      </th>
                                    ));
                                  })()}
                                  <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold w-24">{isZh ? '总分' : 'Total'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportTargetCurrentSegment.gradeIds.map((gid) => {
                                  const gc = normalizeGradeConfig(loadGradeConfigSync());
                                  const gradeLabel = getGradeLabelByLevel(gc, getGradeLevelById(gc, gid));
                                  const evalGrades = resolveEvaluationGradesForCourse(
                                    reportTargetStageId,
                                    activeCourse.id,
                                    reportTargetCurrentSegment.gradeIds,
                                    reportYearDimensionPreset?.stageInclusion,
                                    reportYearDimensionPreset?.evaluationGradeInclusion,
                                  );
                                  if (!evalGrades.includes(gid)) return null;
                                  const examGrades = reportExamGradeByCourse[activeCourse.id] ?? evalGrades;
                                  const examOn = examGrades.includes(gid);
                                  const dims = getPresetDimensionsForReportPreviewGrade(reportYearDimensionPreset, activeCourse.id, activeKey, gid);
                                  const g = byCourse.gradeConfigs[gid] ?? createEmptyExamGradeDraft();
                                  const scoreByLabel = new Map(g.dimensionScores.map((d) => [`${d.dimensionLabelZh}\u0001${d.dimensionLabelEn}`, d.score] as const));
                                  const rows = dims.map((d) => ({
                                    dimensionLabelZh: d.dimensionLabelZh,
                                    dimensionLabelEn: d.dimensionLabelEn,
                                    score: scoreByLabel.get(`${d.dimensionLabelZh}\u0001${d.dimensionLabelEn}`) ?? '',
                                  }));
                                  const dimColCount = reportTargetCurrentSegment.gradeIds.reduce((m, gid2) => {
                                    const dims2 = getPresetDimensionsForReportPreviewGrade(reportYearDimensionPreset, activeCourse.id, activeKey, gid2);
                                    return Math.max(m, dims2.length);
                                  }, 0);
                                  const total = rows.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
                                  return (
                                    <tr key={`exam-dim-${gid}`} className={examOn ? 'bg-white' : 'bg-slate-100 text-slate-400'}>
                                      <td className="border border-slate-200 px-2 py-1.5 font-semibold align-top">{gradeLabel}</td>
                                      {Array.from({ length: dimColCount }, (_, i) => {
                                        const row = rows[i];
                                        return (
                                          <td key={`${gid}-dim-cell-${i}`} className="border border-slate-200 p-1.5 align-top">
                                            {row ? (
                                              <div className="space-y-1.5">
                                                <div className="truncate text-[11px] text-slate-700">
                                                  {(isZh ? row.dimensionLabelZh : row.dimensionLabelEn) || '—'}
                                                </div>
                                                <input
                                                  value={row.score}
                                                  disabled={!examOn}
                                                  onChange={(e) => {
                                                    const nextRows = rows.map((x, idx) => idx === i ? { ...x, score: e.target.value } : x);
                                                    updateGrade(gid, (prev) => ({
                                                      ...prev,
                                                      dimensionScores: nextRows.map((x) => ({
                                                        dimensionLabelZh: x.dimensionLabelZh,
                                                        dimensionLabelEn: x.dimensionLabelEn,
                                                        score: x.score,
                                                      })),
                                                    }));
                                                  }}
                                                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                                                  placeholder={isZh ? '分值' : 'Score'}
                                                />
                                              </div>
                                            ) : (
                                              <div className="text-[11px] text-slate-400">{rows.length === 0 ? (isZh ? '先配置维度' : 'No dims') : '—'}</div>
                                            )}
                                          </td>
                                        );
                                      })}
                                      <td className="border border-slate-200 px-2 py-1.5 align-top tabular-nums">{examOn && rows.length > 0 ? total : '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex justify-end pt-1">
                            <Button
                              type="button"
                              onClick={() => void saveReportExamActiveSubjectSettings()}
                              disabled={!reportSettingYearId || reportExamSaving}
                            >
                              {reportExamSaving
                                ? (isZh ? '保存中…' : 'Saving…')
                                : (isZh ? '保存本学科考试设置' : 'Save this subject’s exam settings')}
                            </Button>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                </div>
              </section>
            )}

            {(createEvaluationMode === 'create' || createEvaluationMode === 'edit') && (
            <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="text-sm font-semibold text-slate-800 shrink-0">
                  {isZh ? '学业报告预览' : 'Academic report preview'}
                </div>
                {newReportPreviewGradeOptions.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <label htmlFor="new-report-preview-grade" className="text-xs text-slate-500 whitespace-nowrap">
                      {isZh ? '预览年级' : 'Preview grade'}
                    </label>
                    <select
                      id="new-report-preview-grade"
                      value={newReportPreviewGradeId}
                      onChange={(e) => setNewReportPreviewGradeId(e.target.value)}
                      className="h-9 min-w-[10rem] max-w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                    >
                      {newReportPreviewGradeOptions.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              {activeEvaluationModules.map((moduleKey, moduleIdx) => {
                const moduleMeta = evaluationModuleOptions.find((m) => m.key === moduleKey);
                if (!moduleMeta) return null;
                return (
                  <div key={moduleKey} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800">{moduleMeta.title}</div>
                        {moduleMeta.description ? (
                          <p className="text-xs text-slate-500 mt-1">{moduleMeta.description}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => moveModuleCard(moduleKey, 'up')} disabled={moduleIdx === 0} title={isZh ? '上移' : 'Move up'}>
                          ↑
                        </Button>
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => moveModuleCard(moduleKey, 'down')} disabled={moduleIdx === activeEvaluationModules.length - 1} title={isZh ? '下移' : 'Move down'}>
                          ↓
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => removeModuleFromDesigner(moduleKey)}
                          title={isZh ? '移除模块' : 'Remove module'}
                          aria-label={isZh ? '移除模块' : 'Remove module'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {moduleKey === 'homeroom_comment' && (
                      <textarea
                        value={homeroomCommentPreview}
                        onChange={(e) => setHomeroomCommentPreview(e.target.value)}
                        className="w-full min-h-[92px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder={isZh ? '请输入班主任综合评价内容（模板预览）' : 'Type homeroom evaluation text (preview)'}
                      />
                    )}

                    {moduleKey === 'subject_evaluation' && (
                      <div className="space-y-3">
                        {!useSimplifiedAcademicTargetPreview ? (
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-slate-500">
                              {isZh
                                ? '学科须从「课程设置」中的课程选择，学科 key 与岗位安排一致；任课教师仅可填写对应班级该学科的学期报告。'
                                : 'Pick each subject from curriculum courses (keys match staffing). Only assigned teachers can fill that subject for that class.'}
                            </div>
                            <Button size="sm" variant="outline" onClick={addReportTemplateSubject}>
                              <Plus className="h-4 w-4 mr-1" />
                              {isZh ? '添加学科' : 'Add subject'}
                            </Button>
                          </div>
                        ) : null}
                        {(useSimplifiedAcademicTargetPreview
                          ? reportSettingSubjectEntries.length === 0
                          : reportSettingSubjects.length === 0) && (
                          <p className="text-sm text-slate-500">
                            {useSimplifiedAcademicTargetPreview
                              ? isZh
                                ? '当前学段暂无学科（学年预设中未包含该学段课程或尚未勾选）。'
                                : 'No subjects for this segment (yearly preset has no courses for this segment, or none selected).'
                              : isZh
                                ? '暂无学科，请先添加。'
                                : 'No subjects yet. Add one to continue.'}
                          </p>
                        )}
                        {reportSettingSubjectEntries.map(({ subject: s, idx: subjectIdx }) => {
                          const matchedCourse = evaluationDesignerCourses.find((x) => x.id === s.courseId);
                          const courseBilingualTitle = matchedCourse
                            ? formatCourseBilingualDisplayName(matchedCourse)
                            : [s.subjectNameZh, s.subjectNameEn].filter(Boolean).join(isZh ? ' ' : ' · ') || '—';
                          const previewGid = newReportPreviewGradeId.trim();
                          const previewDims = useSimplifiedAcademicTargetPreview
                            ? previewGid
                              ? getPresetDimensionsForReportPreviewGrade(
                                  reportYearDimensionPreset,
                                  s.courseId,
                                  s.subjectKey,
                                  previewGid,
                                )
                              : ([] as typeof s.dimensions)
                            : s.dimensions;
                          const lqPreviewKey =
                            useSimplifiedAcademicTargetPreview && previewGid
                              ? `lq:${previewGid}:${s.subjectKey || `i${subjectIdx}`}`
                              : `lq:${s.subjectKey || `i${subjectIdx}`}`;
                          return (
                          <div key={`subject-${subjectIdx}`} className="relative rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                            {!useSimplifiedAcademicTargetPreview ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="absolute right-2 top-2 h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() => setReportSettingSubjects((prev) => prev.filter((_, i) => i !== subjectIdx))}
                                title={isZh ? '删除学科' : 'Remove subject'}
                                aria-label={isZh ? '删除学科' : 'Remove subject'}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <div
                              className={`flex flex-wrap items-start justify-between gap-2 gap-y-2 ${!useSimplifiedAcademicTargetPreview ? 'pr-10' : ''}`}
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                {useSimplifiedAcademicTargetPreview ? (
                                  <div className="text-sm font-semibold text-slate-900 leading-snug">{courseBilingualTitle}</div>
                                ) : (
                                  <>
                                    <label className="text-xs font-medium text-slate-600">
                                      {isZh ? '课程（来自课程设置）' : 'Course (from curriculum)'}
                                    </label>
                                    <select
                                      value={s.courseId}
                                      onChange={(e) => {
                                        const courseId = e.target.value;
                                        setReportSettingSubjects((prev) => {
                                          const next = [...prev];
                                          if (!courseId) {
                                            next[subjectIdx] = {
                                              ...next[subjectIdx],
                                              courseId: '',
                                              subjectKey: '',
                                              subjectNameZh: '',
                                              subjectNameEn: '',
                                            };
                                            return next;
                                          }
                                          const c = evaluationDesignerCourses.find((x) => x.id === courseId);
                                          if (!c) return next;
                                          const sk = staffingSubjectKeyFromCourse(c.id, c.name);
                                          const { subjectNameZh, subjectNameEn } = getCourseReportSubjectLabels(c);
                                          next[subjectIdx] = {
                                            ...next[subjectIdx],
                                            courseId: c.id,
                                            subjectKey: sk,
                                            subjectNameZh,
                                            subjectNameEn,
                                          };
                                          return next;
                                        });
                                      }}
                                      className="w-full max-w-xl rounded border border-slate-300 px-2 py-1.5 text-sm bg-white"
                                    >
                                      <option value="">{isZh ? '请选择课程…' : 'Select course…'}</option>
                                      {evaluationCoursesSorted.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {formatCourseBilingualDisplayName(c)}
                                        </option>
                                      ))}
                                    </select>
                                  </>
                                )}
                              </div>
                              {!useSimplifiedAcademicTargetPreview ? (
                                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={s.enableTarget ? 'default' : 'outline'}
                                    onClick={() =>
                                      setReportSettingSubjects((prev) => {
                                        const next = [...prev];
                                        next[subjectIdx] = { ...next[subjectIdx], enableTarget: !next[subjectIdx].enableTarget };
                                        return next;
                                      })
                                    }
                                  >
                                    {isZh ? '目标维度' : 'Dimensions'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={s.enableScore ? 'default' : 'outline'}
                                    onClick={() =>
                                      setReportSettingSubjects((prev) => {
                                        const next = [...prev];
                                        next[subjectIdx] = { ...next[subjectIdx], enableScore: !next[subjectIdx].enableScore };
                                        return next;
                                      })
                                    }
                                  >
                                    {isZh ? '学科成绩' : 'Score'}
                                  </Button>
                                  <span className="hidden sm:inline w-px h-5 bg-slate-200 shrink-0" aria-hidden />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={s.enableLearningQuality ? 'default' : 'outline'}
                                    onClick={() =>
                                      setReportSettingSubjects((prev) => {
                                        const next = [...prev];
                                        next[subjectIdx] = {
                                          ...next[subjectIdx],
                                          enableLearningQuality: !next[subjectIdx].enableLearningQuality,
                                        };
                                        return next;
                                      })
                                    }
                                  >
                                    {isZh ? '学习品质' : 'Learning quality'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={s.enableTeacherComment ? 'default' : 'outline'}
                                    onClick={() =>
                                      setReportSettingSubjects((prev) => {
                                        const next = [...prev];
                                        next[subjectIdx] = {
                                          ...next[subjectIdx],
                                          enableTeacherComment: !next[subjectIdx].enableTeacherComment,
                                        };
                                        return next;
                                      })
                                    }
                                  >
                                    {isZh ? '学科评语' : 'Comment'}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                            {useSimplifiedAcademicTargetPreview &&
                            (s.enableTarget || s.enableLearningQuality || s.enableScore) && (
                              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-slate-600">
                                    {isZh ? '评价维度' : 'Evaluation dimensions'}
                                  </span>
                                </div>
                                <div className="overflow-x-auto rounded-lg border border-slate-200">
                                  <table className="w-full min-w-[280px] border-collapse text-xs">
                                    <tbody>
                                      {s.enableTarget && previewDims.length === 0 ? (
                                        <tr className="bg-white">
                                          <td colSpan={2} className="border border-slate-200 px-2 py-2 text-slate-500">
                                            {previewGid
                                              ? isZh
                                                ? '当前预览年级下，该学科在「设置学科目标」中尚未配置评价维度。'
                                                : 'No evaluation dimensions for this preview grade in yearly subject settings.'
                                              : isZh
                                                ? '该学科在「设置学科目标」中尚未配置评价维度。'
                                                : 'No evaluation dimensions configured for this subject in yearly settings.'}
                                          </td>
                                        </tr>
                                      ) : null}
                                      {s.enableTarget &&
                                        previewDims.map((d, dimIdx) => {
                                          const previewKey = `${previewGid || '_'}:${s.subjectKey || `i${subjectIdx}`}:${dimIdx}`;
                                          const dimLabel = ((isZh ? d.dimensionLabelZh : d.dimensionLabelEn).trim() || '—');
                                          return (
                                            <tr key={`subject-${subjectIdx}-dim-${dimIdx}`} className="bg-white">
                                              <td className="border border-slate-200 px-2 py-1.5 align-middle text-slate-800">
                                                {dimLabel}
                                              </td>
                                              <td className="border border-slate-200 p-1 align-middle w-[7.5rem]">
                                                <select
                                                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                                                  value={academicPreviewTargetLevels[previewKey] ?? ''}
                                                  onChange={(e) =>
                                                    setAcademicPreviewTargetLevels((prev) => ({
                                                      ...prev,
                                                      [previewKey]: e.target.value,
                                                    }))
                                                  }
                                                  aria-label={isZh ? `${dimLabel} 等第` : `${dimLabel} level`}
                                                >
                                                  <option value="">{isZh ? '—' : '—'}</option>
                                                  {(['A', 'B', 'C', 'D'] as const).map((lv) => (
                                                    <option key={lv} value={lv}>
                                                      {lv}
                                                    </option>
                                                  ))}
                                                </select>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      {s.enableLearningQuality ? (
                                        <tr
                                          className={`bg-slate-50/95 ${s.enableTarget ? 'border-t-2 border-slate-300' : ''}`}
                                        >
                                          <td className="border border-slate-200 px-2 py-2 align-middle text-slate-800 text-[11px] sm:text-xs font-medium leading-snug">
                                            {isZh ? '学习品质：兴趣、习惯与态度' : 'Learning quality: interest, habits, attitude'}
                                          </td>
                                          <td className="border border-slate-200 p-1.5 align-middle w-[7.5rem] bg-slate-50/95">
                                            <select
                                              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                                              value={academicPreviewLearningQuality[lqPreviewKey] ?? ''}
                                              onChange={(e) =>
                                                setAcademicPreviewLearningQuality((prev) => ({
                                                  ...prev,
                                                  [lqPreviewKey]: e.target.value,
                                                }))
                                              }
                                              aria-label={
                                                isZh
                                                  ? '学习品质：兴趣、习惯与态度 等第'
                                                  : 'Learning quality (interest, habits, attitude) level'
                                              }
                                            >
                                              <option value="">{isZh ? '—' : '—'}</option>
                                              {(['A', 'B', 'C', 'D'] as const).map((lv) => (
                                                <option key={lv} value={lv}>
                                                  {lv}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                        </tr>
                                      ) : null}
                                      {s.enableScore ? (
                                        <tr
                                          className={`bg-slate-100/80 ${
                                            s.enableLearningQuality
                                              ? 'border-t border-slate-300'
                                              : s.enableTarget
                                                ? 'border-t-2 border-slate-300'
                                                : ''
                                          }`}
                                        >
                                          <td className="border border-slate-200 px-2 py-2 align-middle text-slate-800 text-xs font-medium">
                                            {isZh ? '测评成绩' : 'Assessment score'}
                                          </td>
                                          <td className="border border-slate-200 p-1.5 align-middle min-w-[10rem] bg-slate-100/80">
                                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                                              <input
                                                value={s.scorePreview}
                                                onChange={(e) =>
                                                  setReportSettingSubjects((prev) => {
                                                    const next = [...prev];
                                                    next[subjectIdx] = { ...next[subjectIdx], scorePreview: e.target.value };
                                                    return next;
                                                  })
                                                }
                                                className="h-8 w-full min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs bg-white"
                                                placeholder={isZh ? '分数' : 'Score'}
                                              />
                                              <input
                                                value={toReportGrade(s.scorePreview) ?? ''}
                                                readOnly
                                                className="h-8 w-full min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-600 sm:max-w-[4.5rem]"
                                                placeholder={isZh ? '等第' : 'Grade'}
                                              />
                                            </div>
                                          </td>
                                        </tr>
                                      ) : null}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                            {!useSimplifiedAcademicTargetPreview && s.enableTarget && (
                              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-slate-600">
                                    {isZh ? '目标维度' : 'Target dimensions'}
                                  </span>
                                  <Button size="sm" variant="outline" onClick={() => addReportTemplateDimension(subjectIdx)}>
                                    {isZh ? '新增维度' : 'Add dimension'}
                                  </Button>
                                </div>
                                {s.dimensions.map((d, dimIdx) => (
                                    <div key={`subject-${subjectIdx}-dim-${dimIdx}`} className="relative rounded border border-slate-100 p-2 space-y-2">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="absolute right-2 top-2 h-6 w-6 text-red-600 hover:bg-red-50 hover:text-red-700"
                                        onClick={() =>
                                          setReportSettingSubjects((prev) => {
                                            const next = [...prev];
                                            const subject = next[subjectIdx];
                                            next[subjectIdx] = {
                                              ...subject,
                                              dimensions: subject.dimensions.filter((_, i) => i !== dimIdx),
                                            };
                                            return next;
                                          })
                                        }
                                        title={isZh ? '删除维度' : 'Remove dimension'}
                                        aria-label={isZh ? '删除维度' : 'Remove dimension'}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                      <div className="pr-8">
                                        <textarea
                                          rows={2}
                                          value={d.dimensionLabelZh}
                                          onChange={(e) =>
                                            setReportSettingSubjects((prev) => {
                                              const next = [...prev];
                                              const subject = next[subjectIdx];
                                              const dims = [...subject.dimensions];
                                              dims[dimIdx] = {
                                                ...dims[dimIdx],
                                                dimensionLabelZh: e.target.value,
                                                dimensionLabelEn: e.target.value,
                                              };
                                              next[subjectIdx] = { ...subject, dimensions: dims };
                                              return next;
                                            })
                                          }
                                          className="w-full min-h-[64px] resize-y rounded border border-slate-300 px-3 py-2.5 text-sm leading-snug"
                                          placeholder={
                                            isZh
                                              ? '维度名称（请中英文双语输入，如：问题解决 Problem Solving）'
                                              : 'Dimension name (bilingual, e.g. Problem Solving 问题解决)'
                                          }
                                        />
                                      </div>
                                      <div className="space-y-2 w-full">
                                        {(['A', 'B', 'C', 'D'] as TargetLevel[]).map((lv) => (
                                          <div key={lv} className="flex w-full items-start gap-3">
                                            <span
                                              className="shrink-0 select-none pt-1.5 text-center text-lg font-bold tabular-nums text-slate-800 w-9"
                                              aria-hidden
                                            >
                                              {lv}
                                            </span>
                                            <textarea
                                              value={d.levelDescriptions[lv] ?? ''}
                                              onChange={(e) =>
                                                setReportSettingSubjects((prev) => {
                                                  const next = [...prev];
                                                  const subject = next[subjectIdx];
                                                  const dims = [...subject.dimensions];
                                                  dims[dimIdx] = {
                                                    ...dims[dimIdx],
                                                    levelDescriptions: { ...dims[dimIdx].levelDescriptions, [lv]: e.target.value },
                                                  };
                                                  next[subjectIdx] = { ...subject, dimensions: dims };
                                                  return next;
                                                })
                                              }
                                              className="min-h-[48px] min-w-0 flex-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                                              placeholder={isZh ? '评价说明（选填）' : 'Description (optional)'}
                                              aria-label={isZh ? `${lv} 等第说明` : `Level ${lv} description`}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                              </div>
                            )}
                            {!useSimplifiedAcademicTargetPreview && (s.enableLearningQuality || s.enableScore) && (
                              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-start sm:gap-x-4">
                                  {s.enableLearningQuality && (
                                    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
                                      <div className="text-xs font-medium leading-tight text-slate-600">
                                        {isZh ? '学习品质' : 'Learning quality'}
                                      </div>
                                      <select
                                        className="h-9 w-full max-w-md rounded border border-slate-300 bg-white px-2 text-sm"
                                        value={academicPreviewLearningQuality[lqPreviewKey] ?? ''}
                                        onChange={(e) =>
                                          setAcademicPreviewLearningQuality((prev) => ({
                                            ...prev,
                                            [lqPreviewKey]: e.target.value,
                                          }))
                                        }
                                        aria-label={isZh ? '学习品质等第' : 'Learning quality level'}
                                      >
                                        <option value="">{isZh ? '—' : '—'}</option>
                                        {(['A', 'B', 'C', 'D'] as const).map((lv) => (
                                          <option key={lv} value={lv}>
                                            {lv}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                  {s.enableScore && (
                                    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
                                      <div className="text-xs font-medium leading-tight text-slate-600">
                                        {isZh ? '学科成绩' : 'Score'}
                                      </div>
                                      <div className="grid h-9 grid-cols-2 gap-2">
                                        <input
                                          value={s.scorePreview}
                                          onChange={(e) =>
                                            setReportSettingSubjects((prev) => {
                                              const next = [...prev];
                                              next[subjectIdx] = { ...next[subjectIdx], scorePreview: e.target.value };
                                              return next;
                                            })
                                          }
                                          className="min-w-0 rounded border border-slate-300 px-2 text-sm bg-white"
                                          placeholder={isZh ? '分数' : 'Score'}
                                        />
                                        <input
                                          value={toReportGrade(s.scorePreview) ?? ''}
                                          readOnly
                                          className="min-w-0 rounded border border-slate-200 bg-slate-100 px-2 text-sm text-slate-600"
                                          placeholder={isZh ? '等第' : 'Grade'}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            {s.enableTeacherComment && (
                              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                                <div className="text-xs font-medium text-slate-600">
                                  {isZh ? '学科评语预览' : 'Comment preview'}
                                </div>
                                <textarea
                                  value={s.commentPreview}
                                  onChange={(e) =>
                                    setReportSettingSubjects((prev) => {
                                      const next = [...prev];
                                      next[subjectIdx] = { ...next[subjectIdx], commentPreview: e.target.value };
                                      return next;
                                    })
                                  }
                                  className="w-full min-h-[78px] rounded border border-slate-300 px-2 py-1.5 text-sm bg-white"
                                  placeholder={isZh ? '输入该学科评语示例内容' : 'Type a sample comment for this subject'}
                                />
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="relative flex justify-center py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddModuleMenuOpen((v) => !v)}
                    disabled={inactiveEvaluationModules.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {isZh ? '添加新模块' : 'Add module'}
                  </Button>
                  {addModuleMenuOpen && inactiveEvaluationModules.length > 0 && (
                    <div className="absolute z-20 top-full mt-2 min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-lg p-1">
                      {inactiveEvaluationModules.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                          onClick={() => {
                            addModuleToDesigner(m.key);
                            setAddModuleMenuOpen(false);
                          }}
                        >
                          {m.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
            </section>
            )}
          </div>

          <DialogFooter className="flex flex-col items-stretch gap-3 sm:flex-col sm:space-x-0">
            {evaluationDesignerError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 w-full text-left"
              >
                {evaluationDesignerError}
              </div>
            )}
            <div className="flex flex-row justify-end gap-2 w-full">
              <Button variant="outline" onClick={() => setCreateEvaluationOpen(false)}>
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button
                onClick={() => void submitEvaluationDesigner()}
                disabled={
                  !reportSettingYearId ||
                  reportSettingSaving ||
                  reportExamSaving ||
                  reportYearPresetSaving ||
                  reportTargetInclusionSaving ||
                  reportTargetUnifiedDialogSaving
                }
              >
                {(reportSettingSaving || reportExamSaving || reportYearPresetSaving || reportTargetInclusionSaving || reportTargetUnifiedDialogSaving)
                  ? (isZh ? '保存中…' : 'Saving…')
                  : createEvaluationMode === 'preset' || createEvaluationMode === 'exam'
                    ? (isZh ? '完成并关闭' : 'Done')
                    : createEvaluationMode === 'edit'
                      ? (isZh ? '保存报告' : 'Save report')
                      : (isZh ? '创建并保存' : 'Create and save')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scoreBandDialogOpen}
        onOpenChange={(open) => {
          setScoreBandDialogOpen(open);
          if (!open) setScoreBandDraft({});
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isZh ? '设置分数等第' : 'Score grade bands'}</DialogTitle>
            <DialogDescription>
              {isZh
                ? '按学年、学期、学段设置得分下限（含）；用于将百分制成绩换算为 A+、A、A−… 等等第。小学与初中可使用不同分段。'
                : 'Set inclusive minimum scores per year, term, and school segment for mapping numeric scores to letter grades.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '学段' : 'Segment'}</label>
              <select
                value={scoreBandSegmentId}
                onChange={(e) => setScoreBandSegmentId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {reportTargetSegments.map((seg) => (
                  <option key={seg.id} value={seg.id}>{seg.label}</option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-500">
              {isZh
                ? `${years.find((y) => y.id === reportSettingYearId)?.name ?? '—'} · ${reportSettingTerm === 'Semester 1' ? '上学期' : '下学期'}`
                : `${years.find((y) => y.id === reportSettingYearId)?.name ?? '—'} · ${reportSettingTerm}`}
            </div>
            {scoreBandLoading ? (
              <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {REPORT_SCORE_LETTER_GRADES.map((g) => (
                  <div key={g} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-sm font-semibold text-slate-800">{g}</span>
                    <span className="text-xs text-slate-500 shrink-0">{isZh ? '≥' : '≥'}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={scoreBandDraft[g] ?? ''}
                      onChange={(e) => setScoreBandDraft((prev) => ({ ...prev, [g]: e.target.value }))}
                      className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setScoreBandDialogOpen(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button onClick={() => void saveScoreGradeBands()} disabled={scoreBandSaving || scoreBandLoading || !scoreBandSegmentId.trim()}>
              {scoreBandSaving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reportTargetUnifiedEditOpen}
        onOpenChange={(open) => {
          if (!open && reportTargetUnifiedDialogSaving) return;
          setReportTargetUnifiedEditOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isZh ? '编辑等第说明' : 'Edit A–D rubric'}</DialogTitle>
            <DialogDescription>
              {isZh ? '以下说明适用于本学年所有学科的课程目标达成评价。' : 'These descriptions apply to all subjects for this academic year.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-1">
            {(['A', 'B', 'C', 'D'] as const).map((lv) => (
              <div key={lv} className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">{lv}</label>
                <textarea
                  rows={3}
                  value={reportTargetUnifiedDraft[lv]}
                  onChange={(e) => setReportTargetUnifiedDraft((prev) => ({ ...prev, [lv]: e.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={reportTargetUnifiedDialogSaving}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reportTargetUnifiedDialogSaving}
              onClick={() => setReportTargetUnifiedDraft({ ...REPORT_PRESET_UNIFIED_LEVEL_DEFAULTS })}
            >
              {isZh ? '恢复默认' : 'Reset to defaults'}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={reportTargetUnifiedDialogSaving}
                onClick={() => setReportTargetUnifiedEditOpen(false)}
              >
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button type="button" disabled={reportTargetUnifiedDialogSaving} onClick={() => void saveReportTargetUnifiedFromDialog()}>
                {reportTargetUnifiedDialogSaving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={progressConfirmOpen}
        onOpenChange={(open) => {
          setProgressConfirmOpen(open);
          if (!open) {
            setProgressData(null);
            setProgressTemplateTitle('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[980px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isZh ? '进度确认' : 'Progress confirmation'}</DialogTitle>
            <DialogDescription>
              {isZh
                ? `学业报告：${progressTemplateTitle || '—'}（仅后台可见）`
                : `Academic report: ${progressTemplateTitle || '-'} (admin only)`}
            </DialogDescription>
          </DialogHeader>
          {progressLoading ? (
            <div className="text-sm text-slate-500 py-4">{isZh ? '加载进度中…' : 'Loading progress...'}</div>
          ) : !progressData ? (
            <div className="text-sm text-slate-500 py-4">{isZh ? '暂无进度数据。' : 'No progress data yet.'}</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{isZh ? `总学生：${progressData.totalStudents}` : `Total: ${progressData.totalStudents}`}</span>
                <span className="text-emerald-700">{isZh ? `已完成：${progressData.completedStudents}` : `Completed: ${progressData.completedStudents}`}</span>
                <span className="text-amber-700">{isZh ? `未完成：${progressData.pendingStudents}` : `Pending: ${progressData.pendingStudents}`}</span>
                <span className="font-semibold">{isZh ? `完成率：${progressData.completionRate}%` : `Rate: ${progressData.completionRate}%`}</span>
              </div>
              {progressData.classes.length === 0 ? (
                <div className="text-sm text-slate-500">{isZh ? '当前学年暂无班级或学生数据。' : 'No classes/students in this academic year.'}</div>
              ) : (
                <div className="rounded-lg border border-slate-200 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">{isZh ? '班级' : 'Class'}</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">{isZh ? '完成情况' : 'Progress'}</th>
                        <th className="px-3 py-2 font-medium min-w-[120px]">{isZh ? '班主任' : 'Homeroom'}</th>
                        <th className="px-3 py-2 font-medium min-w-[200px] max-w-[320px]">
                          {isZh ? '学科待填（任课教师）' : 'Subject gaps (assigned)'}
                        </th>
                        <th className="px-3 py-2 font-medium min-w-[140px]">{isZh ? '未完成学生' : 'Pending students'}</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">{isZh ? '操作' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressData.classes.map((cls) => (
                        <tr key={cls.classId} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="font-medium text-slate-800">{`G${cls.grade} ${cls.className}`}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="text-slate-700">
                              {cls.completedStudents}/{cls.totalStudents}
                            </div>
                            <div className={`text-xs ${cls.completionRate >= 100 ? 'text-emerald-700' : cls.completionRate >= 60 ? 'text-amber-700' : 'text-rose-700'}`}>
                              {cls.completionRate}%
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {(cls.homeroomTeacherNames?.length ?? 0) > 0 ? (
                              <div>{cls.homeroomTeacherNames!.join(isZh ? '、' : ', ')}</div>
                            ) : (
                              <span className="text-slate-400">{isZh ? '未设班主任' : 'No homeroom'}</span>
                            )}
                            {cls.homeroomPending ? (
                              <div className="mt-1 text-amber-900 font-medium">
                                {isZh ? '综合评价未齐' : 'Homeroom pending'}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {cls.subjectGaps && cls.subjectGaps.length > 0 ? (
                              <ul className="space-y-1.5 list-none m-0 p-0">
                                {cls.subjectGaps.map((g) => (
                                  <li key={g.subjectKey}>
                                    <span className="font-medium text-slate-800">{g.subjectLabel}</span>
                                    {g.teacherNames ? (
                                      <span className="text-slate-500">（{g.teacherNames}）</span>
                                    ) : (
                                      <span className="text-slate-400">（{isZh ? '岗位未维护' : 'No staffing'}）</span>
                                    )}
                                    <span className="text-rose-700"> · {g.pendingStudentCount}{isZh ? '人' : ' stu'}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {cls.pendingStudents > 0
                              ? cls.pendingStudentNames.slice(0, 8).join(isZh ? '、' : ', ')
                              : (isZh ? '全部完成' : 'All done')}
                            {cls.pendingStudentNames.length > 8 ? (isZh ? ' 等' : ' ...') : ''}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void remindTeachers(cls.reminderMessage)}
                              disabled={cls.pendingStudents === 0}
                            >
                              {isZh ? '提醒老师' : 'Remind'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                {isZh
                  ? '班级按完成率从低到高排列，便于优先跟进落后班级。「学科待填」仅统计本班年级在「设置评价学科」中勾选过的学科，并依据岗位安排显示任课教师；若未维护岗位则仅显示学科与学生数。点击「提醒老师」可复制该班催办文案。'
                  : 'Classes are sorted by completion rate (low first). Subject gaps count only evaluation-enabled subjects for that grade, with staffing names when available. Remind copies a class-specific message.'}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProgressConfirmOpen(false)}>
              {isZh ? '关闭' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateStudentDialog
        open={dialogCreateStudent}
        onClose={() => setDialogCreateStudent(false)}
        currentYearId={studentCurrentYearId}
        classesInYear={allClasses.filter((c) => c.academicYearId === studentCurrentYearId)}
        onSuccess={(student) => {
          setStudents((prev) => [...prev, student]);
          setDialogCreateStudent(false);
        }}
        onError={(msg) => setError(msg)}
        onEnroll={async (studentId, classId, academicYearId) => {
          const enrollmentId = `enr-${Date.now()}`;
          await addEnrollment({ id: enrollmentId, studentId, classId, academicYearId });
          setEnrollments(loadEnrollmentsSync());
        }}
      />

      <Dialog open={!!editStudent} onOpenChange={(open) => !open && setEditStudent(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{isZh ? '编辑学生' : 'Edit student'}</DialogTitle>
            <DialogDescription>
              {editStudent && (isZh ? `修改「${editStudent.nameZh || editStudent.nameEn || editStudent.name}」的信息` : `Edit "${editStudent.nameZh || editStudent.nameEn || editStudent.name}"`)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '中文名' : 'Chinese name'}</label>
                <input
                  value={editNameZh}
                  onChange={(e) => setEditNameZh(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '英文名' : 'English name'}</label>
                <input
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-1">
              {isZh ? '中文名和英文名至少填写一个。' : 'Please provide at least one of Chinese or English name.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '当前年级（数值）' : 'Current grade (number)'}</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={editCurrentGrade}
                  onChange={(e) => setEditCurrentGrade(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学部' : 'Division'}</label>
                <input
                  value={editDivision}
                  onChange={(e) => setEditDivision(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '性别' : 'Gender'}</label>
              <select
                value={editGender}
                onChange={(e) => setEditGender(e.target.value as Student['gender'])}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="male">{isZh ? '男' : 'Male'}</option>
                <option value="female">{isZh ? '女' : 'Female'}</option>
                <option value="other">{isZh ? '其他' : 'Other'}</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '入学时间' : 'Entry date'}</label>
                <input
                  type="date"
                  value={editEntryDate}
                  onChange={(e) => setEditEntryDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '在读状态' : 'Status'}</label>
                <select
                  value={editStatus || 'active'}
                  onChange={(e) => setEditStatus(e.target.value as Student['status'])}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="active">{isZh ? '在读' : 'Active'}</option>
                  <option value="leave">{isZh ? '休学' : 'Leave'}</option>
                  <option value="graduated">{isZh ? '毕业' : 'Graduated'}</option>
                  <option value="withdrawn">{isZh ? '离校' : 'Withdrawn'}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '学号' : 'Student number'}</label>
              <input
                value={editStudentNumber}
                onChange={(e) => setEditStudentNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{isZh ? '出生日期' : 'Date of birth'}</label>
              <input
                type="date"
                value={editDateOfBirth}
                onChange={(e) => setEditDateOfBirth(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            {isSystemAdmin ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteStudentInAdmin}
                disabled={editSubmitLoading}
                className="mr-auto"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {isZh ? '删除学生' : 'Delete'}
              </Button>
            ) : (
              <span className="mr-auto" />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditStudent(null)}>{isZh ? '取消' : 'Cancel'}</Button>
              <Button onClick={handleSaveStudent} disabled={(!editNameZh.trim() && !editNameEn.trim()) || editSubmitLoading}>
                {editSubmitLoading ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认：需输入账户名一致才可确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDeleteConfirm()}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{isZh ? '确认删除用户' : 'Confirm delete user'}</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {isZh ? '删除后该用户及其课程等数据将无法恢复。请输入账户名 ' : 'This user and their data will be permanently removed. Type the username '}
                  <strong className="text-slate-800">{deleteTarget.username}</strong>
                  {isZh ? ' 以确认。' : ' to confirm.'}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <input
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder={deleteTarget?.username}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeDeleteConfirm}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={!deleteTarget || deleteConfirmInput !== deleteTarget.username || deleteLoading}
            >
              {deleteLoading ? (isZh ? '删除中…' : 'Deleting…') : isZh ? '确认删除' : 'Confirm delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

