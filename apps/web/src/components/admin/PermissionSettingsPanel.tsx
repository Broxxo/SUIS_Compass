import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { AdminUser } from '../../lib/adminStorage';
import { api } from '../../lib/api';
import { MenuSelect } from '../MenuSelect';
import { Button } from '../ui/button';

export type ModulePermissionGrantRow = {
  id: string;
  moduleKey: string;
  userId: string;
  userName: string;
  grantedBy: string | null;
  createdAt: string | null;
};

export type ModulePermissionOverview = {
  key: string;
  labelZh: string;
  labelEn: string;
  defaultAccessZh: string;
  defaultAccessEn: string;
  elevatedZh: string;
  elevatedEn: string;
  grants: ModulePermissionGrantRow[];
};

type PermissionSettingsPanelProps = {
  isZh: boolean;
  teachers: AdminUser[];
};

type RoleMatrixKey = 'system-admin' | 'admin' | 'teacher';

const ROLE_MATRIX_ORDER: RoleMatrixKey[] = ['system-admin', 'admin', 'teacher'];

const ROLE_MATRIX_LABELS: Record<RoleMatrixKey, { zh: string; en: string }> = {
  'system-admin': { zh: '系统管理员', en: 'System Admin' },
  admin: { zh: '管理员', en: 'Admin' },
  teacher: { zh: '教职工', en: 'Staff' },
};

/** 角色 × 模块总览（短说明，与当前默认权限一致） */
const ROLE_MODULE_MATRIX: Record<
  RoleMatrixKey,
  Record<string, { zh: string; en: string }>
> = {
  'system-admin': {
    'calendar-month': { zh: '可查看与修改', en: 'View & edit' },
    'calendar-week': { zh: '可查看与修改', en: 'View & edit' },
    'open-lessons': { zh: '可管理全部', en: 'Manage all' },
    curriculum: { zh: '可管理（含整包导入）', en: 'Manage (incl. full import)' },
    'student-center': { zh: '全校范围', en: 'School-wide' },
    'teacher-center': { zh: '全校范围', en: 'School-wide' },
    mailbox: { zh: '全部信件与处理', en: 'All mail & handle' },
    lighthouse: { zh: '可查看与编辑', en: 'View & edit' },
    admin: { zh: '全部后台（含数据库）', en: 'Full admin (incl. DB)' },
  },
  admin: {
    'calendar-month': { zh: '可查看与修改', en: 'View & edit' },
    'calendar-week': { zh: '可查看与修改', en: 'View & edit' },
    'open-lessons': { zh: '可管理全部', en: 'Manage all' },
    curriculum: { zh: '可管理', en: 'Manage' },
    'student-center': { zh: '全校范围', en: 'School-wide' },
    'teacher-center': { zh: '全校范围', en: 'School-wide' },
    mailbox: { zh: '全部信件与处理', en: 'All mail & handle' },
    lighthouse: { zh: '可查看与编辑', en: 'View & edit' },
    admin: { zh: '可进入后台', en: 'Can open admin' },
  },
  teacher: {
    'calendar-month': { zh: '仅查看；协调员可改全部', en: 'View; coordinators edit all' },
    'calendar-week': {
      zh: '组长改自己创建的（含过往、不限模块）；协调员改分管模块里组长创建的',
      en: 'Leads edit what they created (any module, incl. past); coordinators edit lead-created items on their modules',
    },
    'open-lessons': {
      zh: '填自己的课；组长管本组',
      en: 'Own lessons; leads manage group',
    },
    curriculum: {
      zh: '可查看；学科组长可编辑单元',
      en: 'View; subject leads edit units',
    },
    'student-center': {
      zh: '按班主任/任课/年级组长范围',
      en: 'By homeroom / teaching / grade head',
    },
    'teacher-center': {
      zh: '默认看自己；学科组长看本组',
      en: 'Self; subject leads see group',
    },
    mailbox: { zh: '写信与看自己的信', en: 'Write & own mail' },
    lighthouse: { zh: '仅查看', en: 'View only' },
    admin: { zh: '—', en: '—' },
  },
};

function teacherLabel(
  teacher: Pick<AdminUser, 'nameZh' | 'nameEn' | 'displayName' | 'username'>,
  isZh: boolean,
): string {
  const zh = (teacher.nameZh ?? '').trim();
  const en = (teacher.nameEn ?? '').trim();
  return isZh ? zh || en || teacher.displayName || teacher.username : en || zh || teacher.displayName || teacher.username;
}

export default function PermissionSettingsPanel({ isZh, teachers }: PermissionSettingsPanelProps) {
  const [modules, setModules] = useState<ModulePermissionOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draftUserByModule, setDraftUserByModule] = useState<Record<string, string>>({});
  const [addingModuleKey, setAddingModuleKey] = useState<string | null>(null);

  const staffOptions = useMemo(
    () =>
      teachers
        .filter((user) => user.role === 'teacher' || user.role === 'admin' || user.role === 'system-admin')
        .slice()
        .sort((a, b) => teacherLabel(a, isZh).localeCompare(teacherLabel(b, isZh), isZh ? 'zh' : 'en')),
    [teachers, isZh],
  );

  const matrixColumns = useMemo(() => {
    const fallbackLabels: Record<string, { zh: string; en: string }> = {
      'calendar-month': { zh: '校历 · 月历', en: 'Calendar · Month' },
      'calendar-week': { zh: '校历 · 周历', en: 'Calendar · Week' },
      'open-lessons': { zh: '公开课', en: 'Open lessons' },
      curriculum: { zh: '课程河流', en: 'Curriculum river' },
      'student-center': { zh: '学生中心', en: 'Student center' },
      'teacher-center': { zh: '教师中心', en: 'Teacher center' },
      mailbox: { zh: '信箱', en: 'Mailbox' },
      lighthouse: { zh: '协和灯塔', en: 'Xiehe Lighthouse' },
      admin: { zh: '后台入口', en: 'Admin panel' },
    };
    const keys = Object.keys(ROLE_MODULE_MATRIX['system-admin']);
    return keys.map((key) => {
      const fromApi = modules.find((mod) => mod.key === key);
      return {
        key,
        label: fromApi
          ? isZh
            ? fromApi.labelZh
            : fromApi.labelEn
          : isZh
            ? fallbackLabels[key]?.zh ?? key
            : fallbackLabels[key]?.en ?? key,
      };
    });
  }, [modules, isZh]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await api.getModulePermissionOverview()) as { modules?: ModulePermissionOverview[] };
      setModules(Array.isArray(data.modules) ? data.modules : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const addGrant = async (moduleKey: string) => {
    const userId = (draftUserByModule[moduleKey] ?? '').trim();
    if (!userId) return;
    setBusyKey(moduleKey);
    setError(null);
    try {
      await api.addModulePermissionGrant(moduleKey, userId);
      setDraftUserByModule((prev) => ({ ...prev, [moduleKey]: '' }));
      setAddingModuleKey(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed');
    } finally {
      setBusyKey(null);
    }
  };

  const removeGrant = async (grant: ModulePermissionGrantRow) => {
    setBusyKey(grant.id);
    setError(null);
    try {
      await api.deleteModulePermissionGrant(grant.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete_failed');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base sm:text-lg font-semibold text-slate-800">
        {isZh ? '权限设置' : 'Permission settings'}
      </h2>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          {isZh ? '角色权限总览' : 'Role overview'}
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[960px] w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left text-xs text-slate-600">
                <th className="sticky left-0 z-10 bg-slate-100 py-2 px-2 font-medium whitespace-nowrap border border-slate-200">
                  {isZh ? '角色' : 'Role'}
                </th>
                {matrixColumns.map((col) => (
                  <th
                    key={col.key}
                    className="py-2 px-2 font-medium whitespace-nowrap border border-slate-200 min-w-[7.5rem]"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_MATRIX_ORDER.map((role) => (
                <tr key={role} className="border-t border-slate-100">
                  <td className="sticky left-0 z-10 bg-white py-2 px-2 font-medium text-slate-800 whitespace-nowrap border border-slate-200">
                    {ROLE_MATRIX_LABELS[role][isZh ? 'zh' : 'en']}
                  </td>
                  {matrixColumns.map((col) => {
                    const cell = ROLE_MODULE_MATRIX[role][col.key];
                    return (
                      <td
                        key={`${role}-${col.key}`}
                        className="py-2 px-2 text-slate-600 align-top border border-slate-200 leading-snug"
                      >
                        {cell ? (isZh ? cell.zh : cell.en) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">{isZh ? '正在读取权限…' : 'Loading permissions…'}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {modules.map((mod) => {
            const grantedIds = new Set(mod.grants.map((grant) => grant.userId));
            const candidates = staffOptions.filter((user) => !grantedIds.has(user.id));
            const draft = draftUserByModule[mod.key] ?? '';
            const isAdding = addingModuleKey === mod.key;
            return (
              <section
                key={mod.key}
                className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4"
              >
                <h3 className="text-sm font-semibold text-slate-900">
                  {isZh ? mod.labelZh : mod.labelEn}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  {isZh ? mod.defaultAccessZh : mod.defaultAccessEn}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">
                    {isZh ? '额外授权权限：' : 'Extra permissions: '}
                  </span>
                  {isZh ? mod.elevatedZh : mod.elevatedEn}
                </p>

                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500">
                      {isZh ? '额外授权人' : 'Extra people'}
                      {mod.grants.length > 0 ? (
                        <span className="ml-1 font-normal text-slate-400">({mod.grants.length})</span>
                      ) : null}
                    </p>
                    {!isAdding ? (
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        disabled={candidates.length === 0 || busyKey === mod.key}
                        onClick={() => {
                          setAddingModuleKey(mod.key);
                          setDraftUserByModule((prev) => ({ ...prev, [mod.key]: '' }));
                        }}
                        title={
                          candidates.length === 0
                            ? isZh
                              ? '已无可添加人员'
                              : 'No candidates left'
                            : isZh
                              ? '添加授权人'
                              : 'Add person'
                        }
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {isZh ? '添加' : 'Add'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label={isZh ? '取消' : 'Cancel'}
                        onClick={() => {
                          setAddingModuleKey(null);
                          setDraftUserByModule((prev) => ({ ...prev, [mod.key]: '' }));
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {isAdding ? (
                    <div className="mt-2 flex items-center gap-2">
                      <MenuSelect
                        className="min-w-0 flex-1"
                        searchable
                        value={draft}
                        onChange={(e) =>
                          setDraftUserByModule((prev) => ({ ...prev, [mod.key]: e.target.value }))
                        }
                      >
                        <option value="">{isZh ? '选择人员' : 'Choose person'}</option>
                        {candidates.map((user) => (
                          <option key={user.id} value={user.id}>
                            {teacherLabel(user, isZh)}
                          </option>
                        ))}
                      </MenuSelect>
                      <Button
                        type="button"
                        size="sm"
                        className="shrink-0"
                        disabled={!draft || busyKey === mod.key}
                        onClick={() => void addGrant(mod.key)}
                      >
                        {isZh ? '确认' : 'OK'}
                      </Button>
                    </div>
                  ) : null}

                  {mod.grants.length === 0 && !isAdding ? (
                    <p className="mt-1.5 text-xs text-slate-400">{isZh ? '暂无' : 'None'}</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {mod.grants.map((grant) => (
                        <li
                          key={grant.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-sm text-slate-800"
                        >
                          <span className="min-w-0 truncate">{grant.userName}</span>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-red-600"
                            aria-label={isZh ? '撤销授权' : 'Revoke'}
                            disabled={busyKey === grant.id}
                            onClick={() => void removeGrant(grant)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
