import { useEffect, useMemo, useState } from 'react';
import type { SelfStudyGradeConfig, SelfStudyModule, SelfStudySlot, SelfStudyWeekday } from '@repo/shared';
import { selfStudyWeekdayLabel } from '@repo/shared';
import type { AdminUser } from '../../lib/adminStorage';
import type { ClassItem } from '../../types/classManagement';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Pencil, Plus, Trash2, X } from 'lucide-react';

type GradeLevelRow = { level: number; label: string };

type SelfStudyStaffingPanelProps = {
  isZh: boolean;
  teachers: AdminUser[];
  gradeLevels: GradeLevelRow[];
  classes: ClassItem[];
  modules: SelfStudyModule[];
  gradeConfigs: SelfStudyGradeConfig[];
  slots: SelfStudySlot[];
  savingKeys: Set<string>;
  onCreateModule: (input: {
    name: string;
    gradeConfigs: Array<{ grade: number; sessionsPerWeek: number }>;
  }) => Promise<SelfStudyModule | void>;
  onRenameModule: (id: string, name: string) => Promise<void>;
  onDeleteModule: (id: string) => Promise<void>;
  onUpsertSlot: (input: {
    id?: string;
    moduleId: string;
    classId: string;
    weekday: SelfStudyWeekday;
    teacherId: string | null;
  }) => Promise<void>;
  onDeleteSlot: (id: string) => Promise<void>;
};

const WEEKDAYS: SelfStudyWeekday[] = [1, 2, 3, 4, 5, 6, 7];

function teacherDisplayName(
  teacher: Pick<AdminUser, 'nameZh' | 'nameEn' | 'displayName' | 'username'>,
  isZh: boolean,
): string {
  const zh = (teacher.nameZh ?? '').trim();
  const en = (teacher.nameEn ?? '').trim();
  return isZh ? zh || en || teacher.displayName || teacher.username : en || zh || teacher.displayName || teacher.username;
}

const selectClassName =
  'w-full min-w-0 rounded-md border border-slate-200 bg-white py-2 text-sm text-slate-800 cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400 appearance-none bg-no-repeat pl-2 pr-6 bg-[length:0.65rem] bg-[right_0.35rem_center]';
const selectChevronStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
};

type AssignCellState = {
  classId: string;
  classLabel: string;
  weekday: SelfStudyWeekday;
  slot: SelfStudySlot | null;
  teacherId: string;
};

export default function SelfStudyStaffingPanel({
  isZh,
  teachers,
  gradeLevels,
  classes,
  modules,
  gradeConfigs,
  slots,
  savingKeys,
  onCreateModule,
  onRenameModule,
  onDeleteModule,
  onUpsertSlot,
  onDeleteSlot,
}: SelfStudyStaffingPanelProps) {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(modules[0]?.id ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createGradeLevels, setCreateGradeLevels] = useState<Set<number>>(new Set());
  const [assignCell, setAssignCell] = useState<AssignCellState | null>(null);

  useEffect(() => {
    if (!createOpen) return;
    setCreateGradeLevels(new Set());
    setCreateName('');
  }, [createOpen]);

  const activeModuleId = selectedModuleId && modules.some((m) => m.id === selectedModuleId)
    ? selectedModuleId
    : modules[0]?.id ?? null;

  const moduleGradeLevels = useMemo(() => {
    const levels = new Set(
      gradeConfigs.filter((g) => g.moduleId === activeModuleId).map((g) => g.grade),
    );
    return levels;
  }, [gradeConfigs, activeModuleId]);

  const moduleSlots = useMemo(
    () => slots.filter((s) => s.moduleId === activeModuleId),
    [slots, activeModuleId],
  );

  const gradeSections = useMemo(() => {
    const labelByLevel = new Map(gradeLevels.map((g) => [g.level, g.label]));
    const byGrade = new Map<
      number,
      Array<{ id: string; grade: number; name: string; gradeLabel: string; label: string }>
    >();
    for (const cls of classes) {
      if (!moduleGradeLevels.has(cls.grade)) continue;
      const gradeLabel = labelByLevel.get(cls.grade) || `G${cls.grade}`;
      const list = byGrade.get(cls.grade) ?? [];
      list.push({
        id: cls.id,
        grade: cls.grade,
        name: cls.name,
        gradeLabel,
        label: `${gradeLabel} ${cls.name}`,
      });
      byGrade.set(cls.grade, list);
    }
    return [...byGrade.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([grade, classList]) => ({
        grade,
        gradeLabel: labelByLevel.get(grade) || `G${grade}`,
        classList: classList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      }));
  }, [classes, moduleGradeLevels, gradeLevels]);

  const classCountForModule = useMemo(
    () => gradeSections.reduce((sum, section) => sum + section.classList.length, 0),
    [gradeSections],
  );

  const slotByClassWeekday = useMemo(() => {
    const map = new Map<string, SelfStudySlot>();
    for (const slot of moduleSlots) {
      map.set(`${slot.classId}::${slot.weekday}`, slot);
    }
    return map;
  }, [moduleSlots]);

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);

  const handleCreateModule = async () => {
    const name = createName.trim();
    if (!name || createGradeLevels.size === 0) return;
    const configs = [...createGradeLevels].map((grade) => ({
      grade,
      sessionsPerWeek: 7,
    }));
    const created = await onCreateModule({ name, gradeConfigs: configs });
    if (created?.id) setSelectedModuleId(created.id);
    setCreateOpen(false);
  };

  const openAssignCell = (classId: string, classLabel: string, weekday: SelfStudyWeekday) => {
    const slot = slotByClassWeekday.get(`${classId}::${weekday}`) ?? null;
    setAssignCell({
      classId,
      classLabel,
      weekday,
      slot,
      teacherId: slot?.teacherId ?? '',
    });
  };

  const assignSaving =
    assignCell != null &&
    (assignCell.slot
      ? savingKeys.has(`ss-slot-${assignCell.slot.id}`)
      : savingKeys.has(`ss-slot-new-${activeModuleId}-${assignCell.classId}-${assignCell.weekday}`));

  const handleAssignSave = async () => {
    if (!assignCell || !activeModuleId) return;
    const teacherId = assignCell.teacherId.trim() || null;
    if (!teacherId && !assignCell.slot) {
      setAssignCell(null);
      return;
    }
    if (!teacherId && assignCell.slot) {
      await onDeleteSlot(assignCell.slot.id);
      setAssignCell(null);
      return;
    }
    await onUpsertSlot({
      id: assignCell.slot?.id,
      moduleId: activeModuleId,
      classId: assignCell.classId,
      weekday: assignCell.weekday,
      teacherId,
    });
    setAssignCell(null);
  };

  return (
    <div className="border-t border-slate-100 pt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-2">
          {modules.map((mod) => (
            <div key={mod.id} className="flex items-center gap-1">
              {renamingId === mod.id ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    className="h-8 w-36 text-sm"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={async () => {
                      const name = renameDraft.trim();
                      if (name) await onRenameModule(mod.id, name);
                      setRenamingId(null);
                    }}
                  >
                    {isZh ? '保存' : 'Save'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setRenamingId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={activeModuleId === mod.id ? 'default' : 'outline'}
                    onClick={() => setSelectedModuleId(mod.id)}
                  >
                    {mod.name}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      setRenamingId(mod.id);
                      setRenameDraft(mod.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                    onClick={() => {
                      if (window.confirm(isZh ? `删除模块「${mod.name}」及其全部节次？` : `Delete module "${mod.name}" and all slots?`)) {
                        void onDeleteModule(mod.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="ml-auto">
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {isZh ? '新建自习' : 'Add self-study'}
          </Button>
        </div>
      </div>

      {!activeModuleId ? (
        <p className="text-sm text-slate-500">{isZh ? '请先新建一个自习模块。' : 'Create a self-study module first.'}</p>
      ) : moduleGradeLevels.size === 0 ? (
        <p className="text-sm text-slate-500">{isZh ? '该模块尚未配置年级。' : 'No grades configured for this module.'}</p>
      ) : classCountForModule === 0 ? (
        <p className="text-sm text-slate-500">
          {isZh ? '所选年级下暂无班级，请先在年级管理中创建班级。' : 'No classes in selected grades. Create classes under Grade management first.'}
        </p>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="min-w-max w-full text-sm border-collapse">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th
                  className="sticky left-0 z-20 bg-slate-50 border-b border-r border-slate-200 px-2 py-2 align-bottom min-w-[4.5rem] whitespace-nowrap text-center font-medium"
                  scope="col"
                >
                  {isZh ? '年级' : 'Grade'}
                </th>
                <th
                  className="sticky left-[4.5rem] z-10 bg-slate-50 border-b border-r border-slate-200 px-2 py-2 align-bottom min-w-[5.5rem] text-center font-medium"
                  scope="col"
                >
                  {isZh ? '班级' : 'Class'}
                </th>
                {WEEKDAYS.map((d) => (
                  <th
                    key={d}
                    className="border-b border-slate-200 px-2 py-2 text-center font-medium min-w-[5.5rem] whitespace-nowrap align-bottom"
                  >
                    {selfStudyWeekdayLabel(d, isZh)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gradeSections.flatMap((section) =>
                section.classList.map((classRow, idxInSection) => (
                  <tr key={classRow.id} className="border-t border-slate-100">
                    {idxInSection === 0 ? (
                      <th
                        rowSpan={section.classList.length}
                        scope="row"
                        className="sticky left-0 z-[1] bg-white border-r border-slate-100 px-2 py-2 align-top text-center text-sm font-semibold text-slate-800 whitespace-nowrap"
                      >
                        {section.gradeLabel}
                      </th>
                    ) : null}
                    <td className="sticky left-[4.5rem] z-[1] bg-white border-r border-slate-100 px-2 py-2 align-top text-center min-w-[5.5rem]">
                      <div className="font-medium text-slate-800 leading-snug">{classRow.name}</div>
                    </td>
                    {WEEKDAYS.map((weekday) => {
                      const slot = slotByClassWeekday.get(`${classRow.id}::${weekday}`) ?? null;
                      const teacher = slot?.teacherId ? teacherById.get(slot.teacherId) : undefined;
                      const saveKey = slot
                        ? `ss-slot-${slot.id}`
                        : `ss-slot-new-${activeModuleId}-${classRow.id}-${weekday}`;
                      const saving = savingKeys.has(saveKey);
                      return (
                        <td key={weekday} className="px-1 py-1 align-middle">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => openAssignCell(classRow.id, classRow.label, weekday)}
                            className={[
                              'w-full min-h-[2.25rem] rounded-md border px-1.5 py-0.5 text-xs transition-colors',
                              'focus:outline-none focus:ring-2 focus:ring-primary/30',
                              saving ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:border-slate-300 hover:bg-slate-50',
                              teacher
                                ? 'border-primary/25 bg-primary/5 text-slate-800 font-medium'
                                : slot
                                  ? 'border-amber-200 bg-amber-50/80 text-amber-900'
                                  : 'border-dashed border-slate-200 text-slate-400',
                            ].join(' ')}
                            title={
                              teacher
                                ? teacherDisplayName(teacher, isZh)
                                : isZh
                                  ? '点击安排教师'
                                  : 'Click to assign teacher'
                            }
                          >
                            <span className="line-clamp-2 leading-snug">
                              {teacher
                                ? teacherDisplayName(teacher, isZh)
                                : slot
                                  ? (isZh ? '待指定' : 'Unassigned')
                                  : '—'}
                            </span>
                          </button>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{isZh ? '新建自习' : 'New self-study'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 overflow-y-auto min-h-0">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">{isZh ? '名称' : 'Name'}</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={isZh ? '如：晚自习' : 'e.g. Evening study'}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">{isZh ? '参与年级' : 'Grades'}</p>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {gradeLevels.map((grade) => {
                  const checked = createGradeLevels.has(grade.level);
                  return (
                    <label
                      key={grade.level}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setCreateGradeLevels((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(grade.level);
                            else next.delete(grade.level);
                            return next;
                          });
                        }}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-800">{grade.label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {isZh
                  ? '创建后在下方周历表格中按班级点击格子，为每个班安排每日负责教师。'
                  : 'After creating, click cells in the weekly grid to assign teachers per class and day.'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateModule()}
              disabled={!createName.trim() || createGradeLevels.size === 0}
            >
              {isZh ? '创建' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignCell != null} onOpenChange={(open) => !open && setAssignCell(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isZh ? '安排自习教师' : 'Assign teacher'}</DialogTitle>
          </DialogHeader>
          {assignCell ? (
            <div className="space-y-3 py-1">
              <p className="text-sm text-slate-600">
                {assignCell.classLabel}
                <span className="mx-1.5 text-slate-300">·</span>
                {selfStudyWeekdayLabel(assignCell.weekday, isZh)}
              </p>
              <select
                value={assignCell.teacherId}
                disabled={assignSaving}
                onChange={(e) =>
                  setAssignCell((prev) => (prev ? { ...prev, teacherId: e.target.value } : prev))
                }
                className={selectClassName}
                style={selectChevronStyle}
                autoFocus
              >
                <option value="">{isZh ? '不安排 / 清除' : 'None / clear'}</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {teacherDisplayName(t, isZh)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            {assignCell?.slot ? (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 hover:text-red-700 sm:mr-auto"
                disabled={assignSaving}
                onClick={async () => {
                  await onDeleteSlot(assignCell.slot!.id);
                  setAssignCell(null);
                }}
              >
                {isZh ? '清除该日' : 'Clear day'}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setAssignCell(null)} disabled={assignSaving}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button
              type="button"
              onClick={() => void handleAssignSave()}
              disabled={assignSaving || (!assignCell?.teacherId && !assignCell?.slot)}
            >
              {assignSaving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '确定' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
