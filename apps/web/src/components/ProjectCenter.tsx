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
  type SchoolProject,
  type SchoolProjectItem,
} from '../lib/schoolProjectsApi';
import MultiSelectPersonGrid from './MultiSelectPersonGrid';

const EMPTY_DRAFT: ProjectDraft = {
  title: '',
  summary: '',
  groupLabel: '',
  status: 'active',
  startDate: '',
  endDate: '',
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
    startDate: project.startDate ?? '',
    endDate: project.endDate ?? '',
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
  | { kind: 'project'; projectId: string | null; draft: ProjectDraft }
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
  const [projects, setProjects] = useState<SchoolProject[]>([]);
  const [staff, setStaff] = useState<ProjectPerson[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState('');

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
      source = staff.filter((person) => person.id !== user?.id);
    } else if (editor?.kind === 'item') {
      const project = projects.find((item) => item.id === editor.projectId);
      const members: ProjectPerson[] = [];
      if (project?.lead) members.push(project.lead);
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
  }, [editor, ownerQuery, projects, staff, user?.id]);

  const applyProjects = (next: SchoolProject[]) => {
    setProjects(next);
    setEditor(null);
  };

  const saveEditor = async () => {
    if (!editor || !editor.draft.title.trim()) return;
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
            ? '子项目负责人只能从项目负责人和参与人里选'
            : 'Subproject owners must be the project lead or a participant'
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
      const key = current.kind === 'project' ? 'participantIds' : 'ownerIds';
      const selected = current.draft[key];
      const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
      return { ...current, draft: { ...current.draft, [key]: next } };
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

  return (
    <div className="min-h-dvh bg-slate-50 pt-[var(--app-topbar-height)]">
      <AppTopBar
        title={isZh ? '项目中心' : 'Projects'}
        showBack
        onBack={onBackToHub}
        onToggleAI={onToggleAI}
        isAIOpen={isAIOpen}
        rightChildren={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOwnerQuery('');
              setEditor({ kind: 'project', projectId: null, draft: { ...EMPTY_DRAFT } });
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            {isZh ? '新建项目' : 'New project'}
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {loading ? <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p> : null}
        {!loading && projects.length === 0 ? (
          <p className="text-sm text-slate-500">{isZh ? '还没有项目。' : 'No projects yet.'}</p>
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
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {isZh ? '项目负责人' : 'Project lead'}：{project.lead?.name || (isZh ? '待定' : 'Unassigned')}
                    {' · '}
                    {isZh ? '参与人' : 'Participants'}：{namesOf(project.participants, isZh)}
                  </p>
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
                  {project.canEditProject || project.canEditItems ? (
                    <div className="mb-3 flex justify-end gap-2">
                      {project.canEditProject ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setOwnerQuery('');
                            setEditor({ kind: 'project', projectId: project.id, draft: draftFromProject(project) });
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
                            setEditor({
                              kind: 'item',
                              projectId: project.id,
                              itemId: null,
                              draft: { ...EMPTY_DRAFT, ownerIds: user?.id ? [user.id] : [], groupLabel: groups[0]?.label ?? '' },
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
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">{isZh ? '分组' : 'Group'}</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={editor.draft.groupLabel ?? ''}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, groupLabel: event.target.value } })
                    }
                  />
                </label>
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
              {editor.kind === 'project' ? (
                <p className="text-sm text-slate-600">
                  {isZh ? '项目负责人' : 'Project lead'}：
                  {(editor.projectId
                    ? projects.find((project) => project.id === editor.projectId)?.lead?.name
                    : user?.displayName || user?.username) || (isZh ? '当前用户' : 'You')}
                </p>
              ) : null}
              <div>
                <div className="mb-1 text-sm text-slate-600">
                  {editor.kind === 'project'
                    ? isZh
                      ? '参与人（可多选）'
                      : 'Participants'
                    : isZh
                      ? '负责人（从项目负责人和参与人中选）'
                      : 'Owners (project lead and participants)'}
                </div>
                <input
                  className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder={isZh ? '搜索姓名' : 'Search names'}
                  value={ownerQuery}
                  onChange={(event) => setOwnerQuery(event.target.value)}
                />
                <MultiSelectPersonGrid
                  people={filteredStaff}
                  selectedIds={editor.kind === 'project' ? editor.draft.participantIds : editor.draft.ownerIds}
                  onToggle={togglePerson}
                  getLabel={(person) => person.name}
                  emptyLabel={isZh ? '没有匹配的人' : 'No matches'}
                />
              </div>
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
