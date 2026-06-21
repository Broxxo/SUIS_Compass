import { useMemo, useState } from 'react';
import type {
  ElectiveAgeBandId,
  ElectiveCourse,
  ElectiveDurationPeriods,
} from '@repo/shared';
import {
  ELECTIVE_AGE_BANDS,
  countElectiveBandEnrollment,
  electiveAgeBandLabel,
  electiveBandGradeLevels,
  electiveDurationTypeHint,
  electiveDurationTypeLabel,
  electiveDurationTypeLabelCompact,
  electiveScheduleMode,
  electiveTeacherWeeklyLoads,
  findElectiveTeacherConflicts,
  formatElectiveCourseCardTitle,
  formatElectiveTeachersCompact,
  groupElectiveCoursesByBand,
  resolveCourseElectiveBand,
  summarizeElectiveBandCapacity,
} from '@repo/shared';
import type { AdminUser } from '../../lib/adminStorage';
import type { GradeConfigItem } from '../../types';
import GradePeriodsFields from '../GradePeriodsFields';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { AlertTriangle, Cog, Plus, Trash2 } from 'lucide-react';

type ElectiveStaffingPanelProps = {
  isZh: boolean;
  teachers: AdminUser[];
  gradeItems: GradeConfigItem[];
  classes: ReadonlyArray<{ id: string; grade: number }>;
  enrollments: ReadonlyArray<{ classId: string; studentId: string }>;
  courses: ElectiveCourse[];
  saving: boolean;
  onSaveCourse: (input: {
    id?: string;
    name: string;
    applicableGrades: string[];
    durationPeriods: ElectiveDurationPeriods;
    teacherId: string | null;
    teacher2Id: string | null;
    capacity: number;
    location: string;
  }) => Promise<void>;
  onDeleteCourse: (id: string) => Promise<void>;
};

type CourseDraft = {
  id?: string;
  name: string;
  applicableGrades: string[];
  durationPeriods: ElectiveDurationPeriods;
  teacherId: string;
  teacher2Id: string;
  capacity: string;
  location: string;
};

function teacherDisplayName(
  teacher: Pick<AdminUser, 'nameZh' | 'nameEn' | 'displayName' | 'username'>,
  isZh: boolean,
): string {
  const zh = (teacher.nameZh ?? '').trim();
  const en = (teacher.nameEn ?? '').trim();
  return isZh ? zh || en || teacher.displayName || teacher.username : en || zh || teacher.displayName || teacher.username;
}

function formatGradeItemsForCard(gradeItems: GradeConfigItem[]) {
  return gradeItems.map((g) => ({ id: g.id, label: g.label, level: g.level }));
}

function ElectiveCourseCardGrid({
  isZh,
  gradeItems,
  courses,
  onEdit,
}: {
  isZh: boolean;
  gradeItems: GradeConfigItem[];
  courses: ElectiveCourse[];
  onEdit: (course: ElectiveCourse) => void;
}) {
  const gradeRefs = formatGradeItemsForCard(gradeItems);

  if (courses.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-2 px-1">
        {isZh ? '该学段暂无选修课。' : 'No electives in this band yet.'}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {courses.map((course) => {
        const title = formatElectiveCourseCardTitle(course, gradeRefs, isZh);
        const teachers = formatElectiveTeachersCompact(course, isZh);
        const typeLabel = electiveDurationTypeLabelCompact(course.durationPeriods, isZh);
        const capacityText = isZh ? `容量 ${course.capacity}` : `Cap. ${course.capacity}`;
        const locationText = course.location.trim() || (isZh ? '地点未填' : 'No location');

        return (
          <div
            key={course.id}
            className="relative flex w-[10.75rem] flex-col items-center justify-start gap-0.5 rounded-lg border border-sky-100 bg-sky-50/80 px-2.5 py-2 text-center shadow-sm"
          >
            <button
              type="button"
              onClick={() => onEdit(course)}
              className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-sky-100 hover:text-slate-700"
              title={isZh ? '编辑' : 'Edit'}
            >
              <Cog className="h-3.5 w-3.5" />
            </button>
            <p className="w-full text-sm font-semibold leading-snug text-slate-900 line-clamp-2">{title}</p>
            <p className="w-full text-xs text-slate-500">{typeLabel}</p>
            <p className="w-full text-sm font-bold leading-snug text-slate-900 line-clamp-2">{teachers}</p>
            <p className="w-full text-xs text-slate-600">{capacityText}</p>
            <p className="w-full truncate text-xs text-slate-500" title={locationText}>
              {locationText}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const emptyDraft = (): CourseDraft => ({
  name: '',
  applicableGrades: [],
  durationPeriods: 1,
  teacherId: '',
  teacher2Id: '',
  capacity: '30',
  location: '',
});

const selectClassName = 'w-full rounded-md border border-slate-200 px-2 py-2 text-sm';

export default function ElectiveStaffingPanel({
  isZh,
  teachers,
  gradeItems,
  classes,
  enrollments,
  courses,
  saving,
  onSaveCourse,
  onDeleteCourse,
}: ElectiveStaffingPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<CourseDraft>(emptyDraft());
  const [createBandId, setCreateBandId] = useState<ElectiveAgeBandId | null>(null);

  const draftMode = electiveScheduleMode({ durationPeriods: draft.durationPeriods });
  const gradeCatalog = useMemo(() => gradeItems.map((g) => ({ id: g.id, level: g.level })), [gradeItems]);

  const { byBand, unclassified } = useMemo(
    () => groupElectiveCoursesByBand(courses, gradeCatalog),
    [courses, gradeCatalog],
  );

  const bandEnrollment = useMemo(
    () => countElectiveBandEnrollment({ classes, enrollments }),
    [classes, enrollments],
  );

  const bandCapacitySummaries = useMemo(
    () =>
      bandEnrollment.map((row) =>
        summarizeElectiveBandCapacity({
          bandId: row.bandId,
          studentCount: row.studentCount,
          classCount: row.classCount,
          courses,
          gradeItems: gradeCatalog,
        }),
      ),
    [bandEnrollment, courses, gradeCatalog],
  );

  const teacherConflicts = useMemo(
    () => findElectiveTeacherConflicts(courses, gradeCatalog),
    [courses, gradeCatalog],
  );

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);

  const dialogGradeItems = useMemo(() => {
    if (!createBandId) return gradeItems;
    const levels = new Set(electiveBandGradeLevels(createBandId));
    return gradeItems.filter((g) => levels.has(g.level));
  }, [gradeItems, createBandId]);

  const draftBand = useMemo(
    () => resolveCourseElectiveBand(draft.applicableGrades, gradeCatalog),
    [draft.applicableGrades, gradeCatalog],
  );

  const teacherLoadSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const course of courses) {
      for (const { teacherId, periods } of electiveTeacherWeeklyLoads(course)) {
        map.set(teacherId, (map.get(teacherId) ?? 0) + periods);
      }
    }
    return map;
  }, [courses]);

  const openCreate = (bandId?: ElectiveAgeBandId) => {
    setDraft(emptyDraft());
    setCreateBandId(bandId ?? null);
    setDialogOpen(true);
  };

  const openEdit = (course: ElectiveCourse) => {
    const band = resolveCourseElectiveBand(course.applicableGrades ?? [], gradeCatalog);
    setCreateBandId(band === 'g1' || band === 'g2-3' || band === 'g4-6' ? band : null);
    setDraft({
      id: course.id,
      name: course.name,
      applicableGrades: [...(course.applicableGrades ?? [])],
      durationPeriods: course.durationPeriods,
      teacherId: course.teacherId ?? '',
      teacher2Id: course.teacher2Id ?? '',
      capacity: String(course.capacity),
      location: course.location,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const name = draft.name.trim();
    if (!name || draft.applicableGrades.length === 0) return;
    if (draftBand === 'cross-band') {
      const ok = window.confirm(
        isZh
          ? '开设年级跨越多个选修学段（G1 / G2-3 / G4-6），建议每门课只面向一个学段。是否仍要保存？'
          : 'Grades span multiple elective bands. Save anyway?',
      );
      if (!ok) return;
    }
    await onSaveCourse({
      id: draft.id,
      name,
      applicableGrades: draft.applicableGrades,
      durationPeriods: draft.durationPeriods,
      teacherId: draft.teacherId || null,
      teacher2Id: draft.teacher2Id || null,
      capacity: Math.max(0, parseInt(draft.capacity, 10) || 0),
      location: draft.location.trim(),
    });
    setDialogOpen(false);
  };

  const handleDeleteDraft = async () => {
    if (!draft.id) return;
    const ok = window.confirm(
      isZh ? `删除选修课「${draft.name.trim() || '未命名'}」？` : `Delete "${draft.name.trim() || 'Untitled'}"?`,
    );
    if (!ok) return;
    await onDeleteCourse(draft.id);
    setDialogOpen(false);
  };

  const teacher1Label =
    draftMode === 'repeat'
      ? isZh
        ? '第 1 课时教师'
        : 'Teacher (session 1)'
      : isZh
        ? '任课教师'
        : 'Teacher';
  const teacher2Label =
    draftMode === 'repeat'
      ? isZh
        ? '第 2 课时教师'
        : 'Teacher (session 2)'
      : isZh
        ? '合作教师（可选）'
        : 'Co-teacher (optional)';

  const formatBandHeaderCoverage = (summary: (typeof bandCapacitySummaries)[number]) => {
    const ratio = `${summary.capacityTotal}/${summary.studentCount}`;
    if (summary.studentCount === 0) {
      return isZh ? `${ratio}（暂无在籍学生）` : `${ratio} (no students)`;
    }
    if (summary.deficit > 0) {
      return isZh ? `${ratio}，还需${summary.deficit}人课程` : `${ratio}, need ${summary.deficit} more seats`;
    }
    if (summary.surplus > 0) {
      return isZh ? `${ratio}，已超出${summary.surplus}人` : `${ratio}, ${summary.surplus} over`;
    }
    return ratio;
  };

  const bandCoverageTone = (summary: (typeof bandCapacitySummaries)[number]) => {
    if (summary.studentCount === 0) return 'text-slate-500 font-normal';
    if (summary.deficit > 0) return 'text-amber-700 font-normal';
    if (summary.surplus > 0) return 'text-blue-700 font-normal';
    if (summary.capacityTotal > 0) return 'text-emerald-700 font-normal';
    return 'text-slate-500 font-normal';
  };

  return (
    <div className="border-t border-slate-100 pt-4 space-y-6">
      <div className="space-y-8">
        {ELECTIVE_AGE_BANDS.map((band) => {
          const summary = bandCapacitySummaries.find((s) => s.bandId === band.id)!;
          return (
          <section key={band.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold text-slate-800 flex flex-wrap items-baseline gap-x-2">
                <span>{isZh ? `${band.labelZh} 选修` : `${band.labelEn} electives`}</span>
                <span className={`text-xs tabular-nums ${bandCoverageTone(summary)}`}>
                  {formatBandHeaderCoverage(summary)}
                </span>
              </h3>
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => openCreate(band.id)}>
                <Plus className="h-4 w-4 mr-1" />
                {isZh ? `新建 ${band.labelZh} 课程` : `Add ${band.labelEn}`}
              </Button>
            </div>
            <ElectiveCourseCardGrid
              isZh={isZh}
              gradeItems={gradeItems}
              courses={byBand[band.id]}
              onEdit={openEdit}
            />
          </section>
          );
        })}

        {unclassified.length > 0 ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-2">
              <h3 className="text-sm font-semibold text-amber-900">
                {isZh ? '未归类 / 跨学段课程' : 'Unclassified / cross-band'}
              </h3>
            </div>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              {isZh
                ? '以下课程的开设年级未落在单一选修学段内，不参与容量核算，请调整年级范围。'
                : 'These courses span multiple bands and are excluded from capacity checks.'}
            </p>
            <ElectiveCourseCardGrid
              isZh={isZh}
              gradeItems={gradeItems}
              courses={unclassified}
              onEdit={openEdit}
            />
          </section>
        ) : null}
      </div>

      {teacherConflicts.length > 0 ? (
        <section className="rounded-lg border border-red-200 bg-red-50/80 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {isZh ? '走班课时冲突（全校同时段）' : 'Simultaneous elective conflicts'}
          </div>
          <p className="text-xs text-red-800/90">
            {isZh
              ? '第 1、第 2 课时全校统一时段。重复型：同一教师不能在同一课时兼多门课。连堂型：占用第 1、第 2 两节，任课教师不能再排任何其他选修。'
              : 'Sessions 1 and 2 are school-wide. Repeat: one elective per session. Block: uses both sessions; no other electives for those teachers.'}
          </p>
          <ul className="text-sm text-red-900 space-y-2">
            {teacherConflicts.map((row) => {
              const teacher = teacherById.get(row.teacherId);
              const name = teacher ? teacherDisplayName(teacher, isZh) : row.teacherId;
              const sessionLabel = isZh ? `第 ${row.session} 课时` : `Session ${row.session}`;
              const detail = row.entries
                .map((e) => {
                  const band =
                    e.bandId === 'cross-band' || e.bandId === 'unset'
                      ? isZh
                        ? '未归类'
                        : 'Unclassified'
                      : electiveAgeBandLabel(e.bandId, isZh);
                  return `${band}「${e.courseName}」`;
                })
                .join(isZh ? '、' : ', ');
              return (
                <li key={`${row.teacherId}-${row.session}`}>
                  <span className="font-medium">{name}</span>
                  <span className="text-red-800"> · {sessionLabel}：</span>
                  {detail}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {teacherLoadSummary.size > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-3">
          <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '教师选修周课时' : 'Teacher elective weekly load'}</h4>
          <ul className="text-sm text-slate-700 space-y-1">
            {[...teacherLoadSummary.entries()].map(([tid, periods]) => {
              const teacher = teachers.find((t) => t.id === tid);
              return (
                <li key={tid}>
                  {teacher ? teacherDisplayName(teacher, isZh) : tid}: {periods} {isZh ? '节/周' : 'periods/week'}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCreateBandId(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {draft.id
                ? isZh
                  ? '编辑选修课'
                  : 'Edit elective'
                : createBandId
                  ? isZh
                    ? `新建 ${electiveAgeBandLabel(createBandId, true)} 选修课`
                    : `New ${electiveAgeBandLabel(createBandId, false)} elective`
                  : isZh
                    ? '新建选修课'
                    : 'New elective'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 overflow-y-auto min-h-0">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">{isZh ? '课程名称' : 'Course name'}</label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-2">{isZh ? '开设年级' : 'Open to grades'}</label>
              {createBandId ? (
                <p className="text-xs text-slate-500 mb-2">
                  {isZh
                    ? `仅显示 ${electiveAgeBandLabel(createBandId, true)} 学段年级；请勿跨学段选择。`
                    : `Showing grades for ${electiveAgeBandLabel(createBandId, false)} only.`}
                </p>
              ) : null}
              <GradePeriodsFields
                gradesOnly
                applicableGrades={draft.applicableGrades}
                weeklyPeriodsByGrade={{}}
                gradeItems={dialogGradeItems}
                onChange={({ applicableGrades }) => setDraft((prev) => ({ ...prev, applicableGrades }))}
              />
              {draftBand === 'cross-band' ? (
                <p className="text-xs text-amber-700 mt-2">{isZh ? '当前年级跨学段，请只选同一学段。' : 'Grades span multiple bands.'}</p>
              ) : null}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">{isZh ? '时长类型' : 'Duration type'}</label>
              <select
                value={draft.durationPeriods}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    durationPeriods: Number(e.target.value) === 2 ? 2 : 1,
                  })
                }
                className={selectClassName}
              >
                <option value={1}>{electiveDurationTypeLabel(1, isZh)}</option>
                <option value={2}>{electiveDurationTypeLabel(2, isZh)}</option>
              </select>
              <p className="text-xs text-slate-500 mt-1.5">{electiveDurationTypeHint(draft.durationPeriods, isZh)}</p>
              {draftMode === 'repeat' ? (
                <p className="text-xs text-slate-500 mt-1">
                  {isZh
                    ? '全校同时走班：第 1 课时与第 2 课时各为统一时段，教师不能跨学段在同一课时重复排课。'
                    : 'Sessions 1 and 2 are school-wide; no cross-band same-session assignments.'}
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  {isZh
                    ? '连堂占用第 1、第 2 两个走班时段，任课教师无法再承担其他任何选修课。'
                    : 'Block electives use both sessions; assigned teachers cannot take other electives.'}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">{teacher1Label}</label>
                <select
                  value={draft.teacherId}
                  onChange={(e) => setDraft({ ...draft, teacherId: e.target.value })}
                  className={selectClassName}
                >
                  <option value="">—</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {teacherDisplayName(t, isZh)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">{teacher2Label}</label>
                <select
                  value={draft.teacher2Id}
                  onChange={(e) => setDraft({ ...draft, teacher2Id: e.target.value })}
                  className={selectClassName}
                >
                  <option value="">—</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {teacherDisplayName(t, isZh)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">{isZh ? '可报名学生总数' : 'Enrollment capacity'}</label>
              <Input value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} type="number" min={0} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">{isZh ? '上课地点' : 'Location'}</label>
              <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            {draft.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteDraft()}
                disabled={saving}
                className="sm:mr-auto"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {isZh ? '删除' : 'Delete'}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!draft.name.trim() || draft.applicableGrades.length === 0 || saving}
              >
                {isZh ? '保存' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
