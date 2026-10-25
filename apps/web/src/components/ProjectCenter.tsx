import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import {
  claimProjectItem,
  createProject,
  createProjectItem,
  deleteProject,
  deleteProjectItem,
  fetchProjectBoard,
  updateProject,
  updateProjectItem,
  type ProjectDraft,
  type ProjectPerson,
  type ProjectStatus,
  type ProjectVisibility,
  type SchoolProject,
  type SchoolProjectItem,
} from '../lib/schoolProjectsApi';
import MultiSelectPersonGrid from './MultiSelectPersonGrid';
import ProjectPreviewSection from './ProjectPreviewSection';

const EMPTY_DRAFT: ProjectDraft = {
  title: '',
  summary: '',
  groupLabel: '',
  status: 'active',
  visibility: 'all',
  startDate: '',
  endDate: '',
  leadIds: [],
  ownerIds: [],
  participantIds: [],
};

function statusLabel(status: ProjectStatus, isZh: boolean): string {
  if (status === 'done') return isZh ? '已完成' : 'Done';
  if (status === 'paused') return isZh ? '暂停' : 'Paused';
  return isZh ? '进行中' : 'Active';
}

function statusClass(status: ProjectStatus): string {
  if (status === 'done') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'paused') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-sky-50 text-sky-800 ring-sky-200';
}

function visibilityLabel(visibility: ProjectVisibility, isZh: boolean): string {
  return visibility === 'members'
    ? isZh
      ? '仅负责人可见'
      : 'Leads only'
    : isZh
      ? '全员可见'
      : 'Everyone';
}

/** 总负责人在前，其余负责人随后，去重后同一行展示 */
function projectPeopleLine(project: Pick<SchoolProject, 'leads' | 'participants'>, isZh: boolean): string {
  const seen = new Set<string>();
  const people: ProjectPerson[] = [];
  for (const person of [...project.leads, ...project.participants]) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    people.push(person);
  }
  if (people.length === 0) return isZh ? '负责人待定' : 'No leads yet';
  return `${isZh ? '负责人' : 'Leads'}：${people.map((person) => person.name).join(isZh ? '、' : ', ')}`;
}

function periodText(start: string | null, end: string | null, isZh: boolean): string {
  if (start && end) return `${start} – ${end}`;
  if (start) return isZh ? `${start} 起` : `From ${start}`;
  if (end) return isZh ? `至 ${end}` : `Until ${end}`;
  return isZh ? '周期待定' : 'Dates open';
}

function ownerText(owners: ProjectPerson[], isZh: boolean): string {
  if (owners.length === 0) return isZh ? '负责人待定' : 'No owners';
  return owners.map((owner) => owner.name).join(isZh ? '、' : ', ');
}

function namesOf(people: ProjectPerson[], isZh: boolean): string {
  if (people.length === 0) return isZh ? '待定' : 'None';
  return people.map((person) => person.name).join(isZh ? '、' : ', ');
}

function draftFromProject(project: SchoolProject): ProjectDraft {
  return {
    ...EMPTY_DRAFT,
    title: project.title,
    summary: project.summary,
    status: project.status,
    visibility: project.visibility ?? 'all',
    startDate: project.startDate ?? '',
    endDate: project.endDate ?? '',
    leadIds: project.leads.map((person) => person.id),
    participantIds: project.participants.map((person) => person.id),
    ownerIds: [],
  };
}

function draftFromItem(item: SchoolProjectItem): ProjectDraft {
  return {
    ...EMPTY_DRAFT,
    title: item.title,
    summary: item.summary,
    groupLabel: item.groupLabel,
    status: item.status,
    startDate: item.startDate ?? '',
    endDate: item.endDate ?? '',
    ownerIds: item.owners.map((owner) => owner.id),
  };
}

type Editor =
  | { kind: 'project'; projectId: string | null; draft: ProjectDraft; canManageLeads: boolean }
  | { kind: 'item'; projectId: string; itemId: string | null; draft: ProjectDraft };

export default function ProjectCenter({
  onBackToHub,
  isAIOpen,
  onToggleAI,
}: {
  onBackToHub: () => void;
  isAIOpen?: boolean;
  onToggleAI?: () => void;
}) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isZh = language === 'zh';
  const isAdmin = user?.role === 'admin' || user?.role === 'system-admin';
  const [projects, setProjects] = useState<SchoolProject[]>([]);
  const [staff, setStaff] = useState<ProjectPerson[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [personPick, setPersonPick] = useState<'leads' | 'participants' | 'owners'>('participants');
  const [customGroup, setCustomGroup] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = await fetchProjectBoard();
        if (cancelled) return;
        setProjects(board.projects);
        setStaff(board.staff);
        setOpenIds(board.projects[0] ? [board.projects[0].id] : []);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message || (isZh ? '项目中心加载失败' : 'Could not load projects'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isZh]);

  const filteredStaff = useMemo(() => {
    const q = ownerQuery.trim().toLowerCase();
    let source = staff;
    if (editor?.kind === 'project') {
      if (personPick === 'leads') {
        source = staff;
      } else {
        const leadIds = new Set(editor.draft.leadIds);
        source = staff.filter((person) => !leadIds.has(person.id));
      }
    } else if (editor?.kind === 'item') {
      const project = projects.find((item) => item.id === editor.projectId);
      const members: ProjectPerson[] = [];
      for (const person of project?.leads ?? []) {
        if (!members.some((member) => member.id === person.id)) members.push(person);
      }
      for (const person of project?.participants ?? []) {
        if (!members.some((member) => member.id === person.id)) members.push(person);
      }
      for (const id of editor.draft.ownerIds) {
        if (members.some((member) => member.id === id)) continue;
        const known =
          staff.find((person) => person.id === id) ??
          project?.items.flatMap((item) => item.owners).find((owner) => owner.id === id);
        if (known) members.push(known);
      }
      source = members;
    }
    if (!q) return source;
    return source.filter((person) => person.name.toLowerCase().includes(q));
  }, [editor, ownerQuery, personPick, projects, staff]);

  const existingGroups = useMemo(() => {
    if (editor?.kind !== 'item') return [] as string[];
    const project = projects.find((item) => item.id === editor.projectId);
    const labels: string[] = [];
    for (const item of project?.items ?? []) {
      const label = String(item.groupLabel ?? '').trim();
      if (label && !labels.includes(label)) labels.push(label);
    }
    return labels;
  }, [editor, projects]);

  const applyProjects = (next: SchoolProject[]) => {
    setProjects(next);
    setEditor(null);
  };

  const saveEditor = async () => {
    if (!editor || !editor.draft.title.trim()) return;
    if (editor.kind === 'project' && editor.canManageLeads && editor.draft.leadIds.length === 0) {
      setError(isZh ? '请至少选择一位总负责人' : 'Choose at least one chief lead');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editor.kind === 'project') {
        const next = editor.projectId
          ? await updateProject(editor.projectId, editor.draft)
          : await createProject(editor.draft);
        applyProjects(next);
        if (!editor.projectId && next.length > 0) setOpenIds((ids) => [...ids, next[next.length - 1].id]);
      } else {
        const next = editor.itemId
          ? await updateProjectItem(editor.projectId, editor.itemId, editor.draft)
          : await createProjectItem(editor.projectId, editor.draft);
        applyProjects(next);
        setOpenIds((ids) => (ids.includes(editor.projectId) ? ids : [...ids, editor.projectId]));
      }
    } catch (e: unknown) {
      const code = (e as Error).message;
      setError(
        code === 'owner_not_member'
          ? isZh
            ? '子项目负责人必须是总负责人或负责人'
            : 'Subproject owners must be a chief lead or a project lead'
          : code || (isZh ? '保存失败' : 'Save failed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const removeCurrent = async () => {
    if (!editor) return;
    const label = editor.kind === 'project' ? (isZh ? '删除这个项目？' : 'Delete this project?') : isZh ? '删除这个子项目？' : 'Delete this subproject?';
    if (!window.confirm(label)) return;
    setSaving(true);
    setError(null);
    try {
      const next =
        editor.kind === 'project' && editor.projectId
          ? await deleteProject(editor.projectId)
          : editor.kind === 'item' && editor.itemId
            ? await deleteProjectItem(editor.projectId, editor.itemId)
            : null;
      if (next) applyProjects(next);
    } catch (e: unknown) {
      setError((e as Error).message || (isZh ? '删除失败' : 'Delete failed'));
    } finally {
      setSaving(false);
    }
  };

  const togglePerson = (id: string) => {
    setEditor((current) => {
      if (!current) return current;
      if (current.kind === 'item') {
        const selected = current.draft.ownerIds;
        const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
        return { ...current, draft: { ...current.draft, ownerIds: next } };
      }
      if (personPick === 'leads') {
        const selected = current.draft.leadIds;
        const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
        const leadSet = new Set(next);
        return {
          ...current,
          draft: {
            ...current.draft,
            leadIds: next,
            participantIds: current.draft.participantIds.filter((pid) => !leadSet.has(pid)),
          },
        };
      }
      const selected = current.draft.participantIds;
      const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
      return { ...current, draft: { ...current.draft, participantIds: next } };
    });
  };

  const claimItem = async (projectId: string, itemId: string) => {
    setError(null);
    try {
      setProjects(await claimProjectItem(projectId, itemId));
    } catch (e: unknown) {
      setError((e as Error).message || (isZh ? '认领失败' : 'Could not claim'));
    }
  };

  const openNewProject = () => {
    setOwnerQuery('');
    setPersonPick(isAdmin ? 'leads' : 'participants');
    setEditor({
      kind: 'project',
      projectId: null,
      canManageLeads: Boolean(isAdmin),
      draft: {
        ...EMPTY_DRAFT,
        leadIds: isAdmin && user?.id ? [user.id] : user?.id ? [user.id] : [],
      },
    });
  };

  return (
    <div className="min-h-dvh bg-slate-50 pt-[var(--app-topbar-height)]">
      <AppTopBar
        title={isZh ? '项目中心' : 'Projects'}
        showBack
        onBack={onBackToHub}
        onToggleAI={onToggleAI}
        isAIOpen={isAIOpen}
        rightChildren={
          <Button type="button" size="sm" onClick={openNewProject}>
            <Plus className="mr-1 h-4 w-4" />
            {isZh ? '新建项目' : 'New project'}
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {loading ? <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p> : null}
        {!loading && projects.length === 0 ? (
          <p className="text-sm text-slate-500">{isZh ? '还没有可见的项目。' : 'No visible projects yet.'}</p>
        ) : null}

        {projects.map((project) => {
          const open = openIds.includes(project.id);
          const done = project.items.filter((item) => item.status === 'done').length;
          const groups: Array<{ label: string; items: SchoolProjectItem[] }> = [];
          for (const item of project.items) {
            const label = item.groupLabel || (isZh ? '未分组' : 'Ungrouped');
            const group = groups.find((entry) => entry.label === label);
            if (group) group.items.push(item);
            else groups.push({ label, items: [item] });
          }
          return (
            <section key={project.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-slate-50"
                onClick={() => setOpenIds((ids) => (open ? ids.filter((id) => id !== project.id) : [...ids, project.id]))}
              >
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition ${open ? '' : '-rotate-90'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-base font-semibold text-slate-900">{project.title}</h2>
                    <span className="text-sm text-slate-500">{periodText(project.startDate, project.endDate, isZh)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${statusClass(project.status)}`}>
                      {statusLabel(project.status, isZh)}
                    </span>
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
                      {visibilityLabel(project.visibility ?? 'all', isZh)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{projectPeopleLine(project, isZh)}</p>
                  {project.summary ? <p className="mt-1 text-sm leading-6 text-slate-500">{project.summary}</p> : null}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: project.items.length ? `${Math.round((done / project.items.length) * 100)}%` : '0%' }}
                      />
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">
                      {isZh ? `${done}/${project.items.length}已完成` : `${done}/${project.items.length} done`}
                    </span>
                  </div>
                </div>
              </button>

              {open ? (
                <div className="border-t border-slate-100 px-4 py-3">
                  <ProjectPreviewSection
                    projectId={project.id}
                    mode="view"
                    isZh={isZh}
                    revision={previewRevision}
                  />
                  {project.canEditProject || project.canEditItems ? (
                    <div className="mb-3 flex justify-end gap-2">
                      {project.canEditProject ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setOwnerQuery('');
                            setPersonPick(project.canManageLeads ? 'leads' : 'participants');
                            setEditor({
                              kind: 'project',
                              projectId: project.id,
                              canManageLeads: project.canManageLeads,
                              draft: draftFromProject(project),
                            });
                          }}
                        >
                          {isZh ? '编辑项目' : 'Edit project'}
                        </Button>
                      ) : null}
                      {project.canEditItems ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setOwnerQuery('');
                            setPersonPick('owners');
                            setCustomGroup(false);
                            setEditor({
                              kind: 'item',
                              projectId: project.id,
                              itemId: null,
                              draft: {
                                ...EMPTY_DRAFT,
                                ownerIds: user?.id ? [user.id] : [],
                                groupLabel: groups[0]?.label ?? '',
                              },
                            });
                          }}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          {isZh ? '新建子项目' : 'New subproject'}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {groups.map((group) => (
                    <div key={group.label} className="mb-4 last:mb-0">
                      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500">{group.label}</h3>
                      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
                        {group.items.map((item) => {
                          const claimed = Boolean(user && item.owners.some((owner) => owner.id === user.id));
                          return (
                            <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-3">
                              <button
                                type="button"
                                disabled={!project.canEditItems}
                                className="min-w-0 flex-1 text-left enabled:hover:opacity-80 disabled:cursor-default"
                                onClick={() => {
                                  if (!project.canEditItems) return;
                                  setOwnerQuery('');
                                  setPersonPick('owners');
                                  const label = String(item.groupLabel ?? '').trim();
                                  setCustomGroup(Boolean(label) && !groups.some((entry) => entry.label === label));
                                  setEditor({
                                    kind: 'item',
                                    projectId: project.id,
                                    itemId: item.id,
                                    draft: draftFromItem(item),
                                  });
                                }}
                              >
                                <div className="text-sm font-medium text-slate-800">{item.title}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {ownerText(item.owners, isZh)}
                                  {' · '}
                                  {periodText(item.startDate, item.endDate, isZh)}
                                </div>
                                {item.summary ? <p className="mt-1 text-xs leading-5 text-slate-500">{item.summary}</p> : null}
                              </button>
                              <div className="flex shrink-0 items-center gap-2">
                                {project.canEditItems && !claimed ? (
                                  <Button type="button" variant="outline" size="sm" onClick={() => void claimItem(project.id, item.id)}>
                                    {isZh ? '认领' : 'Claim'}
                                  </Button>
                                ) : null}
                                <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${statusClass(item.status)}`}>
                                  {statusLabel(item.status, isZh)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <Dialog open={editor != null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editor?.kind === 'item'
                ? editor.itemId
                  ? isZh
                    ? '编辑子项目'
                    : 'Edit subproject'
                  : isZh
                    ? '新建子项目'
                    : 'New subproject'
                : editor?.projectId
                  ? isZh
                    ? '编辑项目'
                    : 'Edit project'
                  : isZh
                    ? '新建项目'
                    : 'New project'}
            </DialogTitle>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">{isZh ? '名称' : 'Title'}</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={editor.draft.title}
                  onChange={(event) =>
                    setEditor({ ...editor, draft: { ...editor.draft, title: event.target.value } })
                  }
                />
              </label>
              {editor.kind === 'item' ? (
                <div className="space-y-2 text-sm">
                  <span className="mb-1 block text-slate-600">{isZh ? '分组' : 'Group'}</span>
                  {(() => {
                    const currentGroup = String(editor.draft.groupLabel ?? '').trim();
                    const pickingCustom =
                      customGroup || (Boolean(currentGroup) && !existingGroups.includes(currentGroup));
                    return (
                      <>
                        <select
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={pickingCustom ? '__custom__' : currentGroup}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === '__custom__') {
                              setCustomGroup(true);
                              setEditor({
                                ...editor,
                                draft: {
                                  ...editor.draft,
                                  groupLabel: existingGroups.includes(currentGroup) ? '' : editor.draft.groupLabel,
                                },
                              });
                              return;
                            }
                            setCustomGroup(false);
                            setEditor({ ...editor, draft: { ...editor.draft, groupLabel: value } });
                          }}
                        >
                          <option value="">{isZh ? '未分组' : 'Ungrouped'}</option>
                          {existingGroups.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                          <option value="__custom__">{isZh ? '新建分组…' : 'New group…'}</option>
                        </select>
                        {pickingCustom ? (
                          <input
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            placeholder={isZh ? '输入新分组名称' : 'New group name'}
                            value={editor.draft.groupLabel ?? ''}
                            onChange={(event) => {
                              setCustomGroup(true);
                              setEditor({
                                ...editor,
                                draft: { ...editor.draft, groupLabel: event.target.value },
                              });
                            }}
                          />
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">{isZh ? '说明' : 'Notes'}</span>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={editor.draft.summary}
                  onChange={(event) =>
                    setEditor({ ...editor, draft: { ...editor.draft, summary: event.target.value } })
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">{isZh ? '状态' : 'Status'}</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={editor.draft.status}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, status: event.target.value as ProjectStatus },
                    })
                  }
                >
                  <option value="active">{statusLabel('active', isZh)}</option>
                  <option value="paused">{statusLabel('paused', isZh)}</option>
                  <option value="done">{statusLabel('done', isZh)}</option>
                </select>
              </label>
              {editor.kind === 'project' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">{isZh ? '可见范围' : 'Visibility'}</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={editor.draft.visibility}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: { ...editor.draft, visibility: event.target.value as ProjectVisibility },
                      })
                    }
                  >
                    <option value="all">{visibilityLabel('all', isZh)}</option>
                    <option value="members">{visibilityLabel('members', isZh)}</option>
                  </select>
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">{isZh ? '开始' : 'Start'}</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={editor.draft.startDate}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, startDate: event.target.value } })
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">{isZh ? '结束' : 'End'}</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={editor.draft.endDate}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, endDate: event.target.value } })
                    }
                  />
                </label>
              </div>
              {editor.kind === 'project' && editor.projectId ? (
                <ProjectPreviewSection
                  projectId={editor.projectId}
                  mode="edit"
                  isZh={isZh}
                  revision={previewRevision}
                  onChanged={() => setPreviewRevision((n) => n + 1)}
                />
              ) : null}
              {editor.kind === 'project' ? (
                editor.canManageLeads ? (
                  <div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={personPick === 'leads' ? 'default' : 'outline'}
                        onClick={() => setPersonPick('leads')}
                      >
                        {isZh ? `总负责人（${editor.draft.leadIds.length}）` : `Chief (${editor.draft.leadIds.length})`}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={personPick === 'participants' ? 'default' : 'outline'}
                        onClick={() => setPersonPick('participants')}
                      >
                        {isZh
                          ? `负责人（${editor.draft.participantIds.length}）`
                          : `Leads (${editor.draft.participantIds.length})`}
                      </Button>
                    </div>
                    <input
                      className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder={isZh ? '搜索姓名' : 'Search names'}
                      value={ownerQuery}
                      onChange={(event) => setOwnerQuery(event.target.value)}
                    />
                    <MultiSelectPersonGrid
                      people={filteredStaff}
                      selectedIds={personPick === 'leads' ? editor.draft.leadIds : editor.draft.participantIds}
                      onToggle={togglePerson}
                      getLabel={(person) => person.name}
                      emptyLabel={isZh ? '没有匹配的人' : 'No matches'}
                    />
                  </div>
                ) : (
                  <div>
                    <p className="mb-2 text-sm text-slate-600">
                      {isZh ? '总负责人' : 'Chief leads'}：
                      {namesOf(
                        editor.draft.leadIds
                          .map((id) => staff.find((person) => person.id === id) ?? { id, name: id })
                          .filter(Boolean),
                        isZh,
                      )}
                      <span className="ml-1 text-xs text-slate-400">
                        {isZh ? '（由管理员调整）' : '(set by admins)'}
                      </span>
                    </p>
                    <div className="mb-1 text-sm text-slate-600">{isZh ? '负责人（可多选）' : 'Leads'}</div>
                    <input
                      className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder={isZh ? '搜索姓名' : 'Search names'}
                      value={ownerQuery}
                      onChange={(event) => setOwnerQuery(event.target.value)}
                    />
                    <MultiSelectPersonGrid
                      people={filteredStaff}
                      selectedIds={editor.draft.participantIds}
                      onToggle={togglePerson}
                      getLabel={(person) => person.name}
                      emptyLabel={isZh ? '没有匹配的人' : 'No matches'}
                    />
                  </div>
                )
              ) : (
                <div>
                  <div className="mb-1 text-sm text-slate-600">
                    {isZh ? '子项目负责人' : 'Subproject owners'}
                  </div>
                  <input
                    className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder={isZh ? '搜索姓名' : 'Search names'}
                    value={ownerQuery}
                    onChange={(event) => setOwnerQuery(event.target.value)}
                  />
                  <MultiSelectPersonGrid
                    people={filteredStaff}
                    selectedIds={editor.draft.ownerIds}
                    onToggle={togglePerson}
                    getLabel={(person) => person.name}
                    emptyLabel={isZh ? '没有匹配的人' : 'No matches'}
                  />
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            {editor && ((editor.kind === 'project' && editor.projectId) || (editor.kind === 'item' && editor.itemId)) ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => void removeCurrent()}>
                <Trash2 className="mr-1 h-4 w-4" />
                {isZh ? '删除' : 'Delete'}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" disabled={saving || !editor?.draft.title.trim()} onClick={() => void saveEditor()}>
              {isZh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
