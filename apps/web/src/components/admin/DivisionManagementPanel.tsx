import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import type { AdminUser } from '../../lib/adminStorage';
import type { CoordinatorPermission, DivisionCoordinatorPost } from '../../types/classManagement';
import { MenuSelect } from '../MenuSelect';
import { Button } from '../ui/button';

type SegmentOption = { id: string; label: string };

type DivisionManagementPanelProps = {
  isZh: boolean;
  posts: DivisionCoordinatorPost[];
  segments: SegmentOption[];
  teachers: AdminUser[];
  saving: boolean;
  onSave: (input: {
    id?: string;
    title: string;
    segmentIds: string[];
    chargeModules: string[];
    permissions: CoordinatorPermission[];
    teacherId: string | null;
  }) => Promise<void>;
  onDelete: (post: DivisionCoordinatorPost) => Promise<void>;
};

type Draft = {
  id?: string;
  title: string;
  segmentIds: string[];
  chargeModules: string[];
  moduleDraft: string;
  permissions: CoordinatorPermission[];
  teacherId: string;
};

const PERMISSIONS: Array<{ id: CoordinatorPermission; zh: string; en: string; hintZh: string; hintEn: string }> = [
  {
    id: 'grade-management',
    zh: '年级管理',
    en: 'Grade management',
    hintZh: '等同于所选学部里全部年级组长：可查看这些年级的学生。周历可在这些学部的模块新建，并修改其中组长创建的事项；月历可改全部。',
    hintEn: 'Same as every grade head in the selected divisions for student records. Week calendar: create on those division modules and edit events leads created there. Month calendar: full edit.',
  },
  {
    id: 'teaching-management',
    zh: '教学管理',
    en: 'Teaching management',
    hintZh: '等同于所选学部里的学科组长：可查看这些学科组的教师画像，并在公开课中管理这些学科组。周历可在这些学部的模块新建，并修改其中组长创建的事项；月历可改全部。',
    hintEn: 'Same as subject-group leads covering the selected divisions: group portraits and open lessons. Week calendar: create on those division modules and edit events leads created there. Month calendar: full edit.',
  },
];

function teacherDisplayName(
  teacher: Pick<AdminUser, 'nameZh' | 'nameEn' | 'displayName' | 'username'>,
  isZh: boolean,
): string {
  const zh = (teacher.nameZh ?? '').trim();
  const en = (teacher.nameEn ?? '').trim();
  return isZh ? zh || en || teacher.displayName || teacher.username : en || zh || teacher.displayName || teacher.username;
}

function emptyDraft(): Draft {
  return {
    title: '',
    segmentIds: [],
    chargeModules: [],
    moduleDraft: '',
    permissions: [],
    teacherId: '',
  };
}

export default function DivisionManagementPanel({
  isZh,
  posts,
  segments,
  teachers,
  saving,
  onSave,
  onDelete,
}: DivisionManagementPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');

  const segmentLabel = (id: string) => segments.find((segment) => segment.id === id)?.label ?? id;
  const permissionLabel = (id: CoordinatorPermission) => {
    const item = PERMISSIONS.find((permission) => permission.id === id);
    return item ? (isZh ? item.zh : item.en) : id;
  };

  const openCreate = () => {
    setFormError('');
    setDraft(emptyDraft());
  };

  const openEdit = (post: DivisionCoordinatorPost) => {
    setFormError('');
    setDraft({
      id: post.id,
      title: post.title,
      segmentIds: [...post.segmentIds],
      chargeModules: [...post.chargeModules],
      moduleDraft: '',
      permissions: [...post.permissions],
      teacherId: post.teacherId ?? '',
    });
  };

  const addModule = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const name = prev.moduleDraft.trim();
      if (!name || prev.chargeModules.includes(name)) return { ...prev, moduleDraft: '' };
      return { ...prev, chargeModules: [...prev.chargeModules, name], moduleDraft: '' };
    });
  };

  const toggleSegment = (segmentId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.segmentIds.includes(segmentId);
      return {
        ...prev,
        segmentIds: has ? prev.segmentIds.filter((id) => id !== segmentId) : [...prev.segmentIds, segmentId],
      };
    });
  };

  const togglePermission = (permission: CoordinatorPermission) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.permissions.includes(permission);
      return {
        ...prev,
        permissions: has ? prev.permissions.filter((id) => id !== permission) : [...prev.permissions, permission],
      };
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    const chargeModules = [...draft.chargeModules];
    const pending = draft.moduleDraft.trim();
    if (pending && !chargeModules.includes(pending)) chargeModules.push(pending);
    if (!title) {
      setFormError(isZh ? '请填写协调员岗位名称。' : 'Enter a coordinator title.');
      return;
    }
    if (draft.segmentIds.length === 0) {
      setFormError(isZh ? '请选择这个协调员分管的学部。' : 'Select at least one division.');
      return;
    }
    if (chargeModules.length === 0) {
      setFormError(isZh ? '请填写至少一个分管模块。' : 'Add at least one module.');
      return;
    }
    if (draft.permissions.length === 0) {
      setFormError(isZh ? '请选择管理权限。' : 'Select a permission set.');
      return;
    }
    setFormError('');
    try {
      await onSave({
        id: draft.id,
        title,
        segmentIds: draft.segmentIds,
        chargeModules,
        permissions: draft.permissions,
        teacherId: draft.teacherId || null,
      });
      setDraft(null);
    } catch {
      setFormError(isZh ? '没有保存成功，请看页面上方的提示。' : 'Could not save. See the message above.');
    }
  };

  const handleDelete = async (post: DivisionCoordinatorPost) => {
    const ok = window.confirm(isZh ? `确认删除「${post.title}」？` : `Delete "${post.title}"?`);
    if (!ok) return;
    await onDelete(post);
  };

  return (
    <div className="border-t border-slate-100 pt-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {isZh
            ? '新建协调员岗位，记录牵头的项目，并赋予与年级管理或教学管理相同的系统权限。'
            : 'Create coordinator posts, record the projects they lead, and grant grade or teaching management access.'}
        </p>
        <Button type="button" size="sm" onClick={openCreate} disabled={saving}>
          <Plus className="h-4 w-4 mr-1" />
          {isZh ? '新建协调员' : 'New coordinator'}
        </Button>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-slate-500">{isZh ? '暂无协调员岗位。' : 'No coordinator posts yet.'}</p>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">{isZh ? '岗位' : 'Post'}</th>
                <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">{isZh ? '学部' : 'Division'}</th>
                <th className="py-2.5 px-3 font-medium text-left min-w-[10rem]">{isZh ? '分管模块' : 'Modules'}</th>
                <th className="py-2.5 px-3 font-medium text-left min-w-[8rem]">{isZh ? '管理权限' : 'Access'}</th>
                <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">{isZh ? '协调员' : 'Coordinator'}</th>
                <th className="py-2.5 px-2 font-medium text-center w-[4.5rem]">
                  <span className="sr-only">{isZh ? '操作' : 'Actions'}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-t border-slate-100">
                  <td className="py-2.5 px-3 font-medium text-slate-800 whitespace-nowrap">{post.title}</td>
                  <td className="py-2.5 px-3 text-slate-700">{post.segmentIds.map(segmentLabel).join(isZh ? '、' : ', ') || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-700">{post.chargeModules.join(isZh ? '、' : ', ') || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-700">{post.permissions.map(permissionLabel).join(isZh ? '、' : ', ') || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{post.teacherName || '—'}</td>
                  <td className="py-2 px-2 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => openEdit(post)}
                        disabled={saving}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
                        title={isZh ? '编辑' : 'Edit'}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(post)}
                        disabled={saving}
                        className="p-1.5 rounded-md hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                        title={isZh ? '删除' : 'Delete'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {draft.id ? (isZh ? '编辑协调员' : 'Edit coordinator') : isZh ? '新建协调员' : 'New coordinator'}
          </h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isZh ? '岗位名称' : 'Title'}</label>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder={isZh ? '如：年级组协调员、教师发展协调员' : 'e.g. Grade coordinator'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isZh ? '协调员' : 'Coordinator'}</label>
                <MenuSelect
                  searchable
                  value={draft.teacherId}
                  onChange={(e) => setDraft({ ...draft, teacherId: e.target.value })}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">—</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacherDisplayName(teacher, isZh)}
                    </option>
                  ))}
                </MenuSelect>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isZh ? '学部（可多选）' : 'Divisions'}</label>
                {segments.length === 0 ? (
                  <p className="text-xs text-slate-500">{isZh ? '请先在学校设置中配置学段。' : 'Configure divisions first.'}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {segments.map((segment) => (
                      <label
                        key={segment.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer ${
                          draft.segmentIds.includes(segment.id)
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draft.segmentIds.includes(segment.id)}
                          onChange={() => toggleSegment(segment.id)}
                        />
                        {segment.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isZh ? '分管模块' : 'Modules led'}</label>
                <p className="text-[11px] text-slate-500 mb-2">
                  {isZh ? '记录这个协调员牵头的项目，可以填多个。这里只作岗位说明，不单独打开系统权限。' : 'Projects this coordinator leads. This is a record, not a separate permission.'}
                </p>
                <div className="flex gap-2">
                  <input
                    value={draft.moduleDraft}
                    onChange={(e) => setDraft({ ...draft, moduleDraft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addModule();
                      }
                    }}
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2"
                    placeholder={isZh ? '如：年级组、教师发展' : 'e.g. Teacher development'}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addModule}>
                    {isZh ? '添加' : 'Add'}
                  </Button>
                </div>
                {draft.chargeModules.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {draft.chargeModules.map((name) => (
                      <span key={name} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        {name}
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-700"
                          onClick={() =>
                            setDraft({ ...draft, chargeModules: draft.chargeModules.filter((item) => item !== name) })
                          }
                          aria-label={isZh ? `移除${name}` : `Remove ${name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isZh ? '管理权限（可多选）' : 'Access'}</label>
                <div className="space-y-2">
                  {PERMISSIONS.map((permission) => {
                    const selected = draft.permissions.includes(permission.id);
                    return (
                      <label
                        key={permission.id}
                        className={`block rounded-lg border px-3 py-2 cursor-pointer ${
                          selected ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => togglePermission(permission.id)}
                          />
                          {isZh ? permission.zh : permission.en}
                        </span>
                        <span className="block mt-1 pl-6 text-[11px] leading-relaxed text-slate-500">
                          {isZh ? permission.hintZh : permission.hintEn}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
            </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
