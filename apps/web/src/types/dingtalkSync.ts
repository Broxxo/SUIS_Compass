export type DingTalkSyncAction = {
  id: string;
  type: 'add' | 'remove' | 'update';
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
  dingtalkUniqueStudentCount?: number;
  localStudentCount: number;
  actions: DingTalkSyncAction[];
  unmappedClasses: Array<{
    dingtalkClassName: string;
    dingtalkClassId: number;
    expectedLocalClassName: string | null;
    studentCount: number;
  }>;
  classCountDrifts?: Array<{
    localClassName: string;
    localClassId: string;
    dingtalkCount: number;
    localCount: number;
    delta: number;
  }>;
};

export type DingTalkSyncApplyResult = {
  ok: boolean;
  error: string | null;
  applied: Array<{ actionId: string; type: string; studentId: string | null; message: string }>;
  skipped: Array<{ actionId: string; reason: string }>;
  failed: Array<{ actionId: string; error: string }>;
};
