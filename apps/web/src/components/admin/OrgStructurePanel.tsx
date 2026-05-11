import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, USE_CLOUD_STORAGE } from '../../lib/api';
import type { OrgDepartment, OrgDepartmentNode } from '../../types/classManagement';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

function buildOrgTree(flat: OrgDepartment[]): OrgDepartmentNode[] {
  const byParent = new Map<string | null, OrgDepartment[]>();
  for (const d of flat) {
    const p = d.parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(d);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name)));
  }
  const roots = byParent.get(null) ?? [];
  function attach(n: OrgDepartment): OrgDepartmentNode {
    const kids = (byParent.get(n.id) ?? []).map(attach);
    return { ...n, children: kids };
  }
  return roots.map(attach);
}

function subtreeCount(n: OrgDepartmentNode): number {
  return 1 + n.children.reduce((acc, c) => acc + subtreeCount(c), 0);
}

function isRootRow(flat: OrgDepartment[], id: string): boolean {
  const row = flat.find((d) => d.id === id);
  return !!row && (row.parentId == null || row.parentId === '');
}

type OrgStructurePanelProps = {
  isZh: boolean;
  canMutate: boolean;
  onError: (message: string) => void;
  /** 部门增删改后回调，用于刷新用户管理中的部门下拉等 */
  onDepartmentsChange?: () => void;
};

export default function OrgStructurePanel({ isZh, canMutate, onError, onDepartmentsChange }: OrgStructurePanelProps) {
  const [flat, setFlat] = useState<OrgDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [schoolCreateOpen, setSchoolCreateOpen] = useState(false);
  const [schoolCreateName, setSchoolCreateName] = useState('');
  const [schoolCreateBusy, setSchoolCreateBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addParentId, setAddParentId] = useState<string>('');
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState('');
  const [renameName, setRenameName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteNode, setDeleteNode] = useState<OrgDepartmentNode | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const tree = useMemo(() => buildOrgTree(flat), [flat]);

  const notifyChange = useCallback(() => {
    onDepartmentsChange?.();
  }, [onDepartmentsChange]);

  const refresh = useCallback(async () => {
    if (!USE_CLOUD_STORAGE) {
      setFlat([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.getAdminOrgDepartments();
      setFlat(list);
    } catch (e: unknown) {
      onError((e as Error)?.message || 'Failed to load org departments');
      setFlat([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreateSchool = () => {
    setSchoolCreateName(isZh ? '学校' : 'School');
    setSchoolCreateOpen(true);
  };

  const submitCreateSchool = async () => {
    const name = schoolCreateName.trim() || (isZh ? '学校' : 'School');
    setSchoolCreateBusy(true);
    try {
      const created = await api.createAdminOrgDepartment({ name, parentId: null });
      setFlat((prev) => [...prev, created]);
      setSchoolCreateOpen(false);
      notifyChange();
    } catch (e: unknown) {
      onError((e as Error)?.message || 'Failed to create school');
    } finally {
      setSchoolCreateBusy(false);
    }
  };

  const openAddUnderParent = (parentId: string) => {
    setAddParentId(parentId);
    setAddName('');
    setAddOpen(true);
  };

  const addDialogDirectUnderSchool = useMemo(() => {
    if (!addParentId) return false;
    return isRootRow(flat, addParentId);
  }, [addParentId, flat]);

  const submitAdd = async () => {
    const name = addName.trim();
    if (!name || !addParentId) return;
    setAddBusy(true);
    try {
      const created = await api.createAdminOrgDepartment({ name, parentId: addParentId });
      setFlat((prev) => [...prev, created]);
      setAddOpen(false);
      notifyChange();
    } catch (e: unknown) {
      onError((e as Error)?.message || 'Failed to create department');
    } finally {
      setAddBusy(false);
    }
  };

  const openRename = (n: OrgDepartment) => {
    setRenameId(n.id);
    setRenameName(n.name);
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const name = renameName.trim();
    if (!name || !renameId) return;
    setRenameBusy(true);
    try {
      const updated = await api.updateAdminOrgDepartment(renameId, { name });
      setFlat((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setRenameOpen(false);
      notifyChange();
    } catch (e: unknown) {
      onError((e as Error)?.message || 'Failed to rename');
    } finally {
      setRenameBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteNode) return;
    setDeleteBusy(true);
    try {
      await api.deleteAdminOrgDepartment(deleteNode.id);
      setFlat((prev) => {
        const drop = new Set<string>();
        const walk = (x: OrgDepartmentNode) => {
          drop.add(x.id);
          x.children.forEach(walk);
        };
        walk(deleteNode);
        return prev.filter((d) => !drop.has(d.id));
      });
      setDeleteNode(null);
      notifyChange();
    } catch (e: unknown) {
      onError((e as Error)?.message || 'Failed to delete');
    } finally {
      setDeleteBusy(false);
    }
  };

  const renderDepartmentNode = (node: OrgDepartmentNode, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0;
    const nSub = subtreeCount(node) - 1;
    const indent = Math.min(Math.max(0, depth - 1) * 20, 200);
    return (
      <li key={node.id} className="list-none">
        <div
          className="group relative flex rounded-xl border border-slate-200 bg-white shadow-sm hover:border-sky-300 hover:shadow-md transition-all overflow-hidden mb-3"
          style={{ marginLeft: indent }}
        >
          <div className="w-2 shrink-0 bg-gradient-to-b from-sky-500 to-indigo-600" aria-hidden />
          <div className="flex-1 min-w-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                <Building2 className="h-3.5 w-3.5 text-sky-600 shrink-0" aria-hidden />
                {isZh ? '部门' : 'Department'}
              </div>
              <div className="text-base font-semibold text-slate-900 truncate" title={node.name}>
                {node.name}
              </div>
              {hasChildren && (
                <div className="text-xs text-slate-500 mt-0.5">
                  {isZh ? `下辖 ${nSub} 个子部门` : `${nSub} sub-unit(s)`}
                </div>
              )}
            </div>
            {canMutate && (
              <div className="flex flex-wrap gap-1.5 shrink-0 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <Button type="button" size="sm" variant="outline" onClick={() => openAddUnderParent(node.id)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {isZh ? '子部门' : 'Sub'}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => openRename(node)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  {isZh ? '重命名' : 'Rename'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-red-700 border-red-200 hover:bg-red-50"
                  onClick={() => setDeleteNode(node)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {isZh ? '删除' : 'Delete'}
                </Button>
              </div>
            )}
          </div>
        </div>
        {hasChildren ? (
          <ul className="relative ml-3 sm:ml-6 pl-4 sm:pl-6 border-l-2 border-dashed border-slate-300 space-y-0 pb-1">
            {node.children.map((ch) => renderDepartmentNode(ch, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  const renderSchoolCard = (school: OrgDepartmentNode): ReactNode => (
    <div className="w-full max-w-xl mx-auto">
      <div className="group relative flex flex-col rounded-2xl border-2 border-sky-200 bg-gradient-to-br from-white via-sky-50/80 to-indigo-50/90 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
        <div className="flex items-center justify-center gap-2 pt-4 text-xs font-semibold uppercase tracking-wider text-sky-700">
          <GraduationCap className="h-4 w-4" aria-hidden />
          {isZh ? '学校' : 'School'}
        </div>
        <div className="px-6 pb-5 pt-2 text-center">
          <div className="text-xl font-bold text-slate-900 tracking-tight">{school.name}</div>
          {canMutate && (
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              <Button type="button" size="sm" variant="default" onClick={() => openAddUnderParent(school.id)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {isZh ? '新建部门' : 'Add department'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => openRename(school)}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {isZh ? '重命名' : 'Rename'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-red-700 border-red-200 hover:bg-red-50"
                onClick={() => setDeleteNode(school)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {isZh ? '删除' : 'Delete'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!USE_CLOUD_STORAGE) {
    return (
      <p className="text-sm text-slate-500">
        {isZh
          ? '组织架构需开启云端模式（VITE_USE_CLOUD_STORAGE=true）并与服务器同步。'
          : 'Organization chart requires cloud mode and API sync.'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-slate-800">
          {isZh ? '部门管理' : 'Departments'}
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          {isZh
            ? '先创建学校；在学校下维护部门。部门名称会出现在「用户管理」的部门选项中。仅系统管理员可编辑。'
            : 'Create the school first, then departments under it. Names appear in Users → Department. System admin only.'}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 min-h-[280px] flex flex-col items-center justify-start px-4 py-8 sm:py-10">
        {loading ? (
          <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center max-w-md">
            <Building2 className="h-12 w-12 text-slate-300 mb-4" aria-hidden />
            <p className="text-sm text-slate-600 mb-6">
              {canMutate
                ? (isZh ? '尚未创建学校。请先创建学校，再在学校下添加部门。' : 'Create your school first, then add departments under it.')
                : (isZh ? '尚未配置学校架构。' : 'No organization yet.')}
            </p>
            {canMutate && (
              <Button type="button" size="lg" onClick={openCreateSchool} className="min-w-[10rem]">
                <Plus className="h-4 w-4 mr-2" />
                {isZh ? '新建学校' : 'New school'}
              </Button>
            )}
          </div>
        ) : (
          <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
            {tree.map((school) => (
              <div key={school.id} className="w-full flex flex-col items-center">
                {renderSchoolCard(school)}
                {school.children.length > 0 ? (
                  <div className="w-full mt-8">
                    <p className="text-center text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">
                      {isZh ? '下属部门' : 'Departments'}
                    </p>
                    <ul className="space-y-0 w-full max-w-3xl mx-auto">
                      {school.children.map((ch) => renderDepartmentNode(ch, 1))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 mt-8 text-center">
                    {isZh ? '暂无部门，请点击学校卡片上的「新建部门」。' : 'No departments yet. Use “Add department” on the school card.'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {tree.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <span className="inline-flex items-center gap-1.5">
            <GraduationCap className="h-3.5 w-3.5 text-sky-600" />
            {isZh ? '学校：全校根节点' : 'School: root'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-4 rounded-sm bg-gradient-to-b from-sky-500 to-indigo-600" />
            {isZh ? '色条：部门' : 'Bar: dept.'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-px h-4 border-l-2 border-dashed border-slate-400" />
            {isZh ? '虚线：下级' : 'Dashed: nested'}
          </span>
        </div>
      )}

      <Dialog open={schoolCreateOpen} onOpenChange={setSchoolCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '新建学校' : 'New school'}</DialogTitle>
            <DialogDescription>
              {isZh ? '学校将显示在架构图最上方。全校仅允许一所学校（根节点）。' : 'The school appears at the top. Only one root school is allowed.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={schoolCreateName}
            onChange={(e) => setSchoolCreateName(e.target.value)}
            placeholder={isZh ? '例如：某某国际学校' : 'e.g. Example International School'}
            className="mt-2"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSchoolCreateOpen(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" onClick={() => void submitCreateSchool()} disabled={schoolCreateBusy}>
              {schoolCreateBusy ? (isZh ? '创建中…' : 'Creating…') : isZh ? '创建' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {addDialogDirectUnderSchool
                ? (isZh ? '新建部门' : 'New department')
                : (isZh ? '新建子部门' : 'New sub-unit')}
            </DialogTitle>
            <DialogDescription>
              {isZh ? '保存后名称将出现在用户管理的部门列表中。' : 'The name will appear in Users → Department options.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder={isZh ? '例如：中方教师' : 'e.g. Chinese faculty'}
            className="mt-2"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" onClick={() => void submitAdd()} disabled={!addName.trim() || addBusy}>
              {addBusy ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '重命名' : 'Rename'}</DialogTitle>
          </DialogHeader>
          <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} className="mt-2" />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" onClick={() => void submitRename()} disabled={!renameName.trim() || renameBusy}>
              {renameBusy ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteNode != null} onOpenChange={(o) => { if (!o) setDeleteNode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '确认删除' : 'Confirm delete'}</DialogTitle>
            <DialogDescription>
              {deleteNode
                ? (isZh
                  ? `将删除「${deleteNode.name}」及其全部下级（共 ${subtreeCount(deleteNode)} 个节点），不可恢复。`
                  : `Delete “${deleteNode.name}” and all nested units (${subtreeCount(deleteNode)} nodes). This cannot be undone.`)
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteNode(null)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void submitDelete()} disabled={deleteBusy}>
              {deleteBusy ? (isZh ? '删除中…' : 'Deleting…') : isZh ? '确认删除' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
