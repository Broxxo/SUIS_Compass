import pool from '../../config/database.js';
import { getCachedDingTalkPreview, seedDingTalkPreviewCache } from './preview.js';
import type { DingTalkPreviewResult } from './types.js';
import { ensureDingTalkUserIdColumn } from './ensureDingTalkUserId.js';
import { resolveDingTalkClassMatch } from './classNameMapping.js';
import { loadMaxSeatByClassPrefix, peekAutoStudentNumber, shouldUseDingTalkStudentNo, effectiveDingTalkStudentNo } from './studentNumber.js';
import type { DingTalkPreviewStudent } from './types.js';

export type DingTalkSyncActionType = 'add' | 'remove' | 'update';

export type DingTalkSyncAction = {
  id: string;
  type: DingTalkSyncActionType;
  selected: boolean;
  dingtalkUserId: string | null;
  studentId: string | null;
  name: string;
  dingtalkClassLabel: string;
  localClassName: string | null;
  localClassId: string | null;
  expectedLocalClassName: string | null;
  studentNo: string | null;
  changes: string[];
  warning: string | null;
};

export type DingTalkSyncPlan = {
  ok: boolean;
  error: string | null;
  academicYearId: string | null;
  academicYearName: string | null;
  dingtalkFetchedAt: string | null;
  dingtalkStudentCount: number;
  /** 钉钉名单去重后人数（同一 userid 跨班只计一次） */
  dingtalkUniqueStudentCount: number;
  localStudentCount: number;
  actions: DingTalkSyncAction[];
  unmappedClasses: Array<{
    dingtalkClassName: string;
    dingtalkClassId: number;
    expectedLocalClassName: string | null;
    studentCount: number;
  }>;
  /** 按本地班级汇总：钉钉映射人数 vs 本地学籍人数 */
  classCountDrifts: Array<{
    localClassName: string;
    localClassId: string;
    dingtalkCount: number;
    localCount: number;
    delta: number;
  }>;
};

type LocalStudentRow = {
  id: string;
  name: string;
  name_zh: string | null;
  student_number: string | null;
  dingtalk_user_id: string | null;
  current_class_id: string | null;
  current_grade: number | null;
  class_id: string | null;
  class_name: string | null;
};

async function getCurrentAcademicYear(): Promise<{ id: string; name: string } | null> {
  const row = (await pool.query(
    `SELECT id, name FROM academic_years WHERE is_current = TRUE ORDER BY updated_at DESC LIMIT 1`,
  )).rows[0] as { id: string; name: string } | undefined;
  return row ?? null;
}

export { getCurrentAcademicYear };

/** 同一 userid 在多个钉钉班级出现时只保留一条（名单已按班级路径排序，取首条） */
function dedupePreviewStudentsByUserId(students: DingTalkPreviewStudent[]): DingTalkPreviewStudent[] {
  const seen = new Set<string>();
  const out: DingTalkPreviewStudent[] = [];
  for (const s of students) {
    if (seen.has(s.userid)) continue;
    seen.add(s.userid);
    out.push(s);
  }
  return out;
}

function buildClassCountDrifts(
  localClasses: Array<{ id: string; name: string }>,
  dingtalkCountByClassId: Map<string, number>,
  localCountByClassId: Map<string, number>,
): DingTalkSyncPlan['classCountDrifts'] {
  const drifts: DingTalkSyncPlan['classCountDrifts'] = [];
  for (const cls of localClasses) {
    const dingtalkCount = dingtalkCountByClassId.get(cls.id) ?? 0;
    const localCount = localCountByClassId.get(cls.id) ?? 0;
    if (dingtalkCount === localCount) continue;
    drifts.push({
      localClassName: cls.name,
      localClassId: cls.id,
      dingtalkCount,
      localCount,
      delta: dingtalkCount - localCount,
    });
  }
  return drifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.localClassName.localeCompare(b.localClassName, 'zh-CN'));
}

async function loadLocalStudentsForYear(academicYearId: string): Promise<LocalStudentRow[]> {
  await ensureDingTalkUserIdColumn();
  const result = await pool.query(
    `SELECT
       s.id,
       s.name,
       s.name_zh,
       s.student_number,
       s.dingtalk_user_id,
       s.current_class_id,
       s.current_grade,
       e.class_id,
       c.name AS class_name
     FROM students s
     LEFT JOIN student_enrollments e
       ON e.student_id = s.id AND e.academic_year_id = $1
     LEFT JOIN classes c ON c.id = e.class_id
     WHERE s.status = 'active'
       AND (
         e.academic_year_id = $1
         OR s.dingtalk_user_id IS NOT NULL
       )`,
    [academicYearId],
  );
  return result.rows as LocalStudentRow[];
}

async function loadLocalClasses(academicYearId: string) {
  const result = await pool.query(
    `SELECT id, name, grade, academic_year_id FROM classes WHERE academic_year_id = $1 ORDER BY grade, name`,
    [academicYearId],
  );
  return result.rows as Array<{ id: string; name: string; grade: number; academic_year_id: string }>;
}

function makeActionId(type: DingTalkSyncActionType, key: string): string {
  return `${type}:${key}`;
}

function dingtalkClassLabel(s: DingTalkPreviewStudent): string {
  return s.gradeName ? `${s.gradeName}${s.className}` : s.className;
}

export type BuildDingTalkSyncPlanOptions = {
  /** 浏览器 localStorage 中的钉钉快照（服务端无内存缓存时使用，仅做本地比对） */
  clientPreview?: DingTalkPreviewResult | null;
};

export async function buildDingTalkSyncPlan(options?: BuildDingTalkSyncPlanOptions): Promise<DingTalkSyncPlan> {
  const year = await getCurrentAcademicYear();
  if (!year) {
    return {
      ok: false,
      error: '未设置当前学年，请先在「学校设置 → 学年管理」中指定当前学年。',
      academicYearId: null,
      academicYearName: null,
      dingtalkFetchedAt: null,
      dingtalkStudentCount: 0,
      dingtalkUniqueStudentCount: 0,
      localStudentCount: 0,
      actions: [],
      unmappedClasses: [],
      classCountDrifts: [],
    };
  }

  let preview = getCachedDingTalkPreview();
  if ((!preview?.fetchedAt || preview.students.length === 0) && options?.clientPreview?.fetchedAt) {
    seedDingTalkPreviewCache(options.clientPreview);
    preview = options.clientPreview;
  }
  if (!preview?.fetchedAt || preview.students.length === 0) {
    return {
      ok: false,
      error: '暂无钉钉学生缓存。请先在「钉钉 API」点击「刷新」拉取最新数据，再执行同步。',
      academicYearId: year.id,
      academicYearName: year.name,
      dingtalkFetchedAt: preview?.fetchedAt ?? null,
      dingtalkStudentCount: 0,
      dingtalkUniqueStudentCount: 0,
      localStudentCount: 0,
      actions: [],
      unmappedClasses: [],
      classCountDrifts: [],
    };
  }

  const previewStudents = dedupePreviewStudentsByUserId(preview.students);
  const previewUserIds = new Set(previewStudents.map((s) => s.userid));

  const localClasses = await loadLocalClasses(year.id);
  const localStudents = await loadLocalStudentsForYear(year.id);
  const maxSeatByClass = await loadMaxSeatByClassPrefix(pool, year.id);
  const planClassNextSeat = new Map<string, number>();

  const localByDingTalkId = new Map<string, LocalStudentRow>();
  const localByStudentNo = new Map<string, LocalStudentRow>();
  for (const row of localStudents) {
    if (row.dingtalk_user_id) localByDingTalkId.set(row.dingtalk_user_id, row);
    if (row.student_number) localByStudentNo.set(row.student_number.trim(), row);
  }

  const actions: DingTalkSyncAction[] = [];
  const unmappedMap = new Map<number, { dingtalkClassName: string; expected: string | null; count: number }>();
  const matchedLocalIds = new Set<string>();
  const dingtalkCountByClassId = new Map<string, number>();
  const localCountByClassId = new Map<string, number>();
  for (const row of localStudents) {
    if (row.class_id) {
      localCountByClassId.set(row.class_id, (localCountByClassId.get(row.class_id) ?? 0) + 1);
    }
  }

  for (const dt of previewStudents) {
    const { expectedLocalClassName: expectedLocal, classMatch } = resolveDingTalkClassMatch(
      {
        className: dt.className,
        gradeName: dt.gradeName,
        gradeLevel: dt.gradeLevel,
        classPath: dt.classPath,
      },
      localClasses,
    );

    if (!classMatch) {
      const prev = unmappedMap.get(dt.classId);
      unmappedMap.set(dt.classId, {
        dingtalkClassName: dingtalkClassLabel(dt),
        expected: expectedLocal,
        count: (prev?.count ?? 0) + 1,
      });
    } else {
      dingtalkCountByClassId.set(
        classMatch.classId,
        (dingtalkCountByClassId.get(classMatch.classId) ?? 0) + 1,
      );
    }

    const local =
      localByDingTalkId.get(dt.userid)
      ?? (() => {
        const key = effectiveDingTalkStudentNo(dt.studentNo);
        return key ? localByStudentNo.get(key) : undefined;
      })()
      ?? null;

    if (!local) {
      const dtStudentNo = effectiveDingTalkStudentNo(dt.studentNo);
      const autoStudentNo = !dtStudentNo && classMatch
        ? peekAutoStudentNumber({
          startYear: dt.startYear,
          academicYearName: year.name,
          classId: classMatch.classId,
          className: classMatch.className,
          grade: classMatch.grade,
          classNextSeat: planClassNextSeat,
          maxSeatByClass,
        })
        : null;
      const displayStudentNo = dtStudentNo || autoStudentNo;
      const addChanges = ['新增学生'];
      if (autoStudentNo) {
        if (dt.studentNo?.trim() && !shouldUseDingTalkStudentNo(dt.studentNo)) {
          addChanges.push(`学号 ${dt.studentNo.trim()} → ${autoStudentNo}（钉钉班内序号，规范为本校格式）`);
        } else {
          addChanges.push(`学号 ${autoStudentNo}（自动生成）`);
        }
      }

      actions.push({
        id: makeActionId('add', dt.userid),
        type: 'add',
        selected: Boolean(classMatch),
        dingtalkUserId: dt.userid,
        studentId: null,
        name: dt.name,
        dingtalkClassLabel: dingtalkClassLabel(dt),
        localClassName: classMatch?.className ?? null,
        localClassId: classMatch?.classId ?? null,
        expectedLocalClassName: expectedLocal,
        studentNo: displayStudentNo,
        changes: addChanges,
        warning: classMatch ? null : `无法匹配本地班级（期望 ${expectedLocal ?? '未知'}）`,
      });
      continue;
    }

    matchedLocalIds.add(local.id);
    const changes: string[] = [];
    const localClassName = local.class_name ?? null;

    if (classMatch && local.class_id && classMatch.classId !== local.class_id) {
      changes.push(`班级 ${localClassName ?? '—'} → ${classMatch.className}`);
    } else if (classMatch && !local.class_id) {
      changes.push(`补录学籍至 ${classMatch.className}`);
    }

    const dtName = dt.name.trim();
    const localName = (local.name_zh ?? local.name).trim();
    if (dtName && localName && dtName !== localName) {
      changes.push(`姓名 ${localName} → ${dtName}`);
    }

    const dtStudentNo = effectiveDingTalkStudentNo(dt.studentNo);

    if (dtStudentNo && dtStudentNo !== (local.student_number ?? '')) {
      changes.push(`学号 ${local.student_number ?? '—'} → ${dtStudentNo}`);
    }

    let previewAutoNo: string | null = null;
    if (
      classMatch
      && !dtStudentNo
      && (!local.student_number?.trim() || !shouldUseDingTalkStudentNo(local.student_number))
    ) {
      previewAutoNo = peekAutoStudentNumber({
        startYear: dt.startYear,
        academicYearName: year.name,
        classId: classMatch.classId,
        className: classMatch.className,
        grade: classMatch.grade,
        classNextSeat: planClassNextSeat,
        maxSeatByClass,
      });
      if (local.student_number?.trim() && !shouldUseDingTalkStudentNo(local.student_number)) {
        changes.push(`学号 ${local.student_number} → ${previewAutoNo}（钉钉班内序号，规范为本校格式）`);
      } else {
        changes.push(`学号 — → ${previewAutoNo}（自动生成）`);
      }
    }

    if (!local.dingtalk_user_id) {
      changes.push('关联钉钉 userid');
    }

    if (changes.length > 0) {
      actions.push({
        id: makeActionId('update', local.id),
        type: 'update',
        selected: true,
        dingtalkUserId: dt.userid,
        studentId: local.id,
        name: dt.name,
        dingtalkClassLabel: dingtalkClassLabel(dt),
        localClassName: classMatch?.className ?? localClassName,
        localClassId: classMatch?.classId ?? local.class_id,
        expectedLocalClassName: expectedLocal,
        studentNo: dtStudentNo || previewAutoNo || local.student_number,
        changes,
        warning: !classMatch ? `班级未匹配（期望 ${expectedLocal ?? '未知'}）` : null,
      });
    }
  }

  for (const local of localStudents) {
    if (!local.dingtalk_user_id) continue;
    if (matchedLocalIds.has(local.id)) continue;
    if (!previewUserIds.has(local.dingtalk_user_id)) {
      actions.push({
        id: makeActionId('remove', local.id),
        type: 'remove',
        selected: false,
        dingtalkUserId: local.dingtalk_user_id,
        studentId: local.id,
        name: local.name_zh ?? local.name,
        dingtalkClassLabel: '—',
        localClassName: local.class_name,
        localClassId: local.class_id,
        expectedLocalClassName: null,
        studentNo: local.student_number,
        changes: ['钉钉侧已不存在，建议从本系统删除'],
        warning: '删除不可恢复，请确认',
      });
    }
  }

  const unmappedClasses = Array.from(unmappedMap.entries()).map(([classId, v]) => ({
    dingtalkClassId: classId,
    dingtalkClassName: v.dingtalkClassName,
    expectedLocalClassName: v.expected,
    studentCount: v.count,
  }));

  const classCountDrifts = buildClassCountDrifts(localClasses, dingtalkCountByClassId, localCountByClassId);

  return {
    ok: true,
    error: null,
    academicYearId: year.id,
    academicYearName: year.name,
    dingtalkFetchedAt: preview.fetchedAt,
    dingtalkStudentCount: preview.students.length,
    dingtalkUniqueStudentCount: previewStudents.length,
    localStudentCount: localStudents.filter((s) => s.class_id).length,
    actions,
    unmappedClasses,
    classCountDrifts,
  };
}
