import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { createTeachingSubjectGroupId, type TeachingSubjectGroup } from '@repo/shared';
import type { AdminUser } from '../../lib/adminStorage';
import { getRoadmapSegmentsInDisplayOrder, normalizeGradeConfig } from '../../lib/gradeConfig';
import { loadGradeConfigSync } from '../../lib/storage';
import {
  filterTeachersForSubjectGroup,
  formatTeachingGroupSubjectLabels,
  type SubjectOption,
} from '../../lib/teachingSubjectGroupUtils';
import type { ClassItem, StaffingAssignment } from '../../types/classManagement';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

type TeachingManagementPanelProps = {
  isZh: boolean;
  groups: TeachingSubjectGroup[];
  subjectOptions: SubjectOption[];
  teachers: AdminUser[];
  assignments: StaffingAssignment[];
  classes: ClassItem[];
  displayKeyToSubjectKeys: Map<string, Set<string>>;
  functionalTeacherByKey: Map<string, string>;
  membersByGroupId: Map<string, string[]>;
  savingGroupId: string | null;
  functionalSavingKeys: Set<string>;
  onSaveGroupDefinition: (groups: TeachingSubjectGroup[]) => Promise<void>;
  onSaveLead: (groupId: string, groupLabel: string, teacherId: string | null) => Promise<void>;
  onSaveMembers: (groupId: string, teacherIds: string[]) => Promise<void>;
};

function teacherDisplayName(
  teacher: Pick<AdminUser, 'nameZh' | 'nameEn' | 'displayName' | 'username'>,
  isZh: boolean,
): string {
  const zh = (teacher.nameZh ?? '').trim();
  const en = (teacher.nameEn ?? '').trim();
  return isZh ? zh || en || teacher.displayName || teacher.username : en || zh || teacher.displayName || teacher.username;
}

const selectClassName =
  'w-full min-w-0 rounded-md border border-slate-200 bg-white py-1.5 text-sm font-medium text-slate-800 text-center cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400 appearance-none bg-no-repeat pl-5 pr-5 bg-[length:0.65rem] bg-[right_0.4rem_center]';
const selectChevronStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
};

function TeacherSelect({
  value,
  teachers,
  isZh,
  disabled,
  onChange,
}: {
  value: string;
  teachers: AdminUser[];
  isZh: boolean;
  disabled?: boolean;
  onChange: (teacherId: string | null) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className={`${selectClassName} text-xs py-0.5 max-w-[9rem] mx-auto`}
      style={selectChevronStyle}
    >
      <option value="">—</option>
      {teachers.map((teacher) => (
        <option key={teacher.id} value={teacher.id}>
          {teacherDisplayName(teacher, isZh)}
        </option>
      ))}
    </select>
  );
}

function leadTeachersFromMembers(
  memberIds: string[],
  leadId: string,
  teachers: AdminUser[],
): AdminUser[] {
  const orderedIds = [...memberIds];
  if (leadId && !orderedIds.includes(leadId)) orderedIds.unshift(leadId);
  return orderedIds
    .map((id) => teachers.find((t) => t.id === id))
    .filter((t): t is AdminUser => Boolean(t));
}

type GroupDraft = {
  id: string;
  nameZh: string;
  segmentIds: string[];
  subjectKeys: string[];
  leadTeacherId: string;
  memberTeacherIds: string[];
};

export default function TeachingManagementPanel({
  isZh,
  groups,
  subjectOptions,
  teachers,
  assignments,
  classes,
  displayKeyToSubjectKeys,
  functionalTeacherByKey,
  membersByGroupId,
  savingGroupId,
  functionalSavingKeys,
  onSaveGroupDefinition,
  onSaveLead,
  onSaveMembers,
}: TeachingManagementPanelProps) {
  const gradeConfig = normalizeGradeConfig(loadGradeConfigSync());
  const schoolSegments = useMemo(
    () => getRoadmapSegmentsInDisplayOrder(gradeConfig),
    [gradeConfig],
  );
  const defaultSegmentIds = useMemo(() => schoolSegments.map((s) => s.id), [schoolSegments]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setDraft({
      id: createTeachingSubjectGroupId(),
      nameZh: '',
      segmentIds: [...defaultSegmentIds],
      subjectKeys: [],
      leadTeacherId: '',
      memberTeacherIds: [],
    });
    setDialogOpen(true);
  };

  const openEdit = (group: TeachingSubjectGroup) => {
    const leadKey = `subject-group-head::${group.id}`;
    setDraft({
      id: group.id,
      nameZh: group.nameZh,
      segmentIds: [...group.segmentIds],
      subjectKeys: [...group.subjectKeys],
      leadTeacherId: functionalTeacherByKey.get(leadKey) ?? '',
      memberTeacherIds: [...(membersByGroupId.get(group.id) ?? [])],
    });
    setDialogOpen(true);
  };

  const draftGroupShape = useMemo((): TeachingSubjectGroup | null => {
    if (!draft) return null;
    return {
      id: draft.id,
      nameZh: draft.nameZh.trim(),
      segmentIds: draft.segmentIds,
      subjectKeys: draft.subjectKeys,
    };
  }, [draft]);

  const candidateTeachers = useMemo(() => {
    if (!draftGroupShape) return [] as AdminUser[];
    return filterTeachersForSubjectGroup(
      draftGroupShape,
      teachers,
      assignments,
      classes,
      gradeConfig,
      displayKeyToSubjectKeys,
    );
  }, [draftGroupShape, teachers, assignments, classes, gradeConfig, displayKeyToSubjectKeys]);

  const toggleSegment = (segmentId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.segmentIds.includes(segmentId);
      return {
        ...prev,
        segmentIds: has
          ? prev.segmentIds.filter((id) => id !== segmentId)
          : [...prev.segmentIds, segmentId],
        memberTeacherIds: [],
        leadTeacherId: '',
      };
    });
  };

  const toggleSubject = (key: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.subjectKeys.includes(key);
      return {
        ...prev,
        subjectKeys: has ? prev.subjectKeys.filter((k) => k !== key) : [...prev.subjectKeys, key],
        memberTeacherIds: [],
        leadTeacherId: '',
      };
    });
  };

  const toggleMember = (teacherId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.memberTeacherIds.includes(teacherId);
      return {
        ...prev,
        memberTeacherIds: has
          ? prev.memberTeacherIds.filter((id) => id !== teacherId)
          : [...prev.memberTeacherIds, teacherId],
      };
    });
  };

  const segmentSelectionValid =
    !draft || schoolSegments.length === 0 || draft.segmentIds.length > 0;

  const handleSaveDialog = async () => {
    if (!draft || !draft.nameZh.trim() || !segmentSelectionValid) return;
    setBusy(true);
    try {
      const nextGroup: TeachingSubjectGroup = {
        id: draft.id,
        nameZh: draft.nameZh.trim(),
        segmentIds: draft.segmentIds,
        subjectKeys: draft.subjectKeys,
        sortOrder: groups.find((g) => g.id === draft.id)?.sortOrder ?? (groups.length + 1) * 10,
      };
      const exists = groups.some((g) => g.id === draft.id);
      const nextGroups = exists
        ? groups.map((g) => (g.id === draft.id ? nextGroup : g))
        : [...groups, nextGroup];
      await onSaveGroupDefinition(nextGroups);
      await onSaveLead(draft.id, nextGroup.nameZh, draft.leadTeacherId || null);
      await onSaveMembers(draft.id, draft.memberTeacherIds);
      setDialogOpen(false);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (group: TeachingSubjectGroup) => {
    const ok = window.confirm(
      isZh ? `确认删除「${group.nameZh}」？` : `Delete group "${group.nameZh}"?`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await onSaveGroupDefinition(groups.filter((g) => g.id !== group.id));
      await onSaveLead(group.id, group.nameZh, null);
      await onSaveMembers(group.id, []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-slate-100 pt-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {isZh
            ? '按需建立学科组，配置学段、相关学科、学科组长与组员。'
            : 'Create subject groups with segments, subjects, lead and members.'}
        </p>
        <Button type="button" size="sm" onClick={openCreate} disabled={busy}>
          <Plus className="h-4 w-4 mr-1" />
          {isZh ? '新建学科组' : 'New group'}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-500">{isZh ? '暂无学科组，点击上方按钮创建。' : 'No groups yet.'}</p>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="py-2.5 px-3 font-medium text-center whitespace-nowrap min-w-[7.7rem]">
                  {isZh ? '学科组' : 'Group'}
                </th>
                <th className="py-2.5 px-3 font-medium text-center min-w-[8rem]">
                  {isZh ? '学科' : 'Subjects'}
                </th>
                <th className="py-2.5 px-3 font-medium text-center whitespace-nowrap w-[8.5rem]">
                  {isZh ? '学科组长' : 'Lead'}
                </th>
                <th className="py-2.5 px-3 font-medium text-left min-w-[12rem]">
                  {isZh ? '组员' : 'Members'}
                </th>
                <th className="py-2.5 px-2 font-medium text-center w-[4.5rem]">
                  <span className="sr-only">{isZh ? '操作' : 'Actions'}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const leadKey = `subject-group-head::${group.id}`;
                const leadId = functionalTeacherByKey.get(leadKey) ?? '';
                const memberIds = membersByGroupId.get(group.id) ?? [];
                const memberNames = memberIds
                  .map((id) => teachers.find((t) => t.id === id))
                  .filter(Boolean)
                  .map((t) => teacherDisplayName(t!, isZh));
                const isSaving = savingGroupId === group.id;
                const groupName = isZh ? group.nameZh : group.nameEn || group.nameZh;
                const subjectLabels = formatTeachingGroupSubjectLabels(
                  group.subjectKeys,
                  subjectOptions,
                  isZh,
                );
                const memberCount = memberIds.length;
                const membersText =
                  memberNames.length > 0 ? memberNames.join(isZh ? '、' : ', ') : '—';
                const membersTitle =
                  memberCount > 0
                    ? isZh
                      ? `${memberCount}人：${membersText}`
                      : `${memberCount} members: ${membersText}`
                    : undefined;
                const leadCandidates = leadTeachersFromMembers(memberIds, leadId, teachers);
                const leadSaveKey = `subject-group-head::${group.id}`;
                const leadSaving = functionalSavingKeys.has(leadSaveKey);
                return (
                  <tr key={group.id} className="border-t border-slate-100 bg-white">
                    <td className="py-2.5 px-3 text-center align-middle">
                      <span className="font-semibold text-slate-900">{groupName}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center align-middle text-slate-600 text-xs sm:text-sm">
                      {subjectLabels ?? '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center align-middle">
                      <TeacherSelect
                        value={leadId}
                        teachers={leadCandidates}
                        isZh={isZh}
                        disabled={leadSaving || leadCandidates.length === 0}
                        onChange={(tid) => void onSaveLead(group.id, group.nameZh, tid)}
                      />
                      {leadSaving ? (
                        <div className="text-[10px] text-slate-400 mt-0.5">{isZh ? '保存中…' : 'Saving…'}</div>
                      ) : leadCandidates.length === 0 ? (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {isZh ? '请先添加组员' : 'Add members first'}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 text-left align-middle text-slate-700 text-xs sm:text-sm">
                      <div className="flex items-start gap-1.5 w-full" title={membersTitle}>
                        <span className="shrink-0 w-[2.75rem] font-semibold text-indigo-600 tabular-nums text-left">
                          {isZh ? `${memberCount}人` : memberCount}
                        </span>
                        <span className="min-w-0 flex-1 line-clamp-2">{membersText}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center align-middle whitespace-nowrap">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => openEdit(group)}
                          disabled={busy || isSaving}
                          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
                          title={isZh ? '编辑' : 'Edit'}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(group)}
                          disabled={busy || isSaving}
                          className="p-1.5 rounded-md hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                          title={isZh ? '删除' : 'Delete'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draft && groups.some((g) => g.id === draft.id)
                ? isZh
                  ? '编辑学科组'
                  : 'Edit group'
                : isZh
                  ? '新建学科组'
                  : 'New group'}
            </DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isZh ? '组名' : 'Name'}
                </label>
                <input
                  value={draft.nameZh}
                  onChange={(e) => setDraft({ ...draft, nameZh: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder={isZh ? '如：艺体组、理综组' : 'e.g. Arts & PE'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isZh ? '学段（可多选）' : 'Segments'}
                </label>
                {schoolSegments.length === 0 ? (
                  <p className="text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    {isZh
                      ? '尚未在基础设置中配置学段，本组将覆盖全校班级。'
                      : 'No segments configured; this group applies to the whole school.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {schoolSegments.map((seg) => (
                      <label
                        key={seg.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer ${
                          draft.segmentIds.includes(seg.id)
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draft.segmentIds.includes(seg.id)}
                          onChange={() => toggleSegment(seg.id)}
                        />
                        {seg.label}
                      </label>
                    ))}
                  </div>
                )}
                {schoolSegments.length > 0 && draft.segmentIds.length === 0 ? (
                  <p className="text-[11px] text-amber-700 mt-1">
                    {isZh ? '请至少选择一个学段。' : 'Select at least one segment.'}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isZh ? '相关学科（可多选）' : 'Subjects'}
                </label>
                {subjectOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">{isZh ? '请先在课程管理中添加课程。' : 'Add courses first.'}</p>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2">
                    {subjectOptions.map((opt) => (
                      <label
                        key={opt.key}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer ${
                          draft.subjectKeys.includes(opt.key)
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draft.subjectKeys.includes(opt.key)}
                          onChange={() => toggleSubject(opt.key)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isZh ? '学科组长' : 'Lead'}
                </label>
                <select
                  value={draft.leadTeacherId}
                  onChange={(e) => setDraft({ ...draft, leadTeacherId: e.target.value })}
                  className={selectClassName}
                  style={selectChevronStyle}
                  disabled={candidateTeachers.length === 0}
                >
                  <option value="">—</option>
                  {candidateTeachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {teacherDisplayName(t, isZh)}
                    </option>
                  ))}
                </select>
                {draft.subjectKeys.length > 0 && candidateTeachers.length === 0 ? (
                  <p className="text-[11px] text-amber-700 mt-1">
                    {isZh
                      ? '所选学段与学科在课程岗位中暂无任课教师，请先在课程岗位排课。'
                      : 'No teachers found for selected segments and subjects in course staffing.'}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isZh ? '组员（可多选）' : 'Members'}
                </label>
                {candidateTeachers.length === 0 ? (
                  <p className="text-xs text-slate-500">—</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                    {candidateTeachers.map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={draft.memberTeacherIds.includes(t.id)}
                          onChange={() => toggleMember(t.id)}
                        />
                        <span>{teacherDisplayName(t, isZh)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveDialog()}
              disabled={busy || !draft?.nameZh.trim() || !segmentSelectionValid}
            >
              {busy ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
