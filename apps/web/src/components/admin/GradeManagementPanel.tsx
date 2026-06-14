import { STAFFING_HOMEROOM_SUBJECT_KEY } from '@repo/shared';
import type { AdminUser } from '../../lib/adminStorage';
import {
  getGradeCatalogIdForClass,
  getGradeLabelByLevel,
  groupClassesForClassManagement,
  normalizeGradeConfig,
} from '../../lib/gradeConfig';
import { loadGradeConfigSync } from '../../lib/storage';
import type { ClassItem, FunctionalRoleType } from '../../types/classManagement';

type HomeroomBlock = {
  key: string;
  title: string;
  classes: ClassItem[];
};

type GradeManagementPanelProps = {
  isZh: boolean;
  homeroomBlocks: HomeroomBlock[];
  teachers: AdminUser[];
  homeroomTeacherByClassId: Map<string, string>;
  functionalTeacherByKey: Map<string, string>;
  homeroomSavingKeys: Set<string>;
  functionalSavingKeys: Set<string>;
  onHomeroomChange: (classId: string, teacherId: string | null) => void;
  onFunctionalRoleChange: (
    roleType: FunctionalRoleType,
    scopeKey: string,
    scopeLabel: string,
    teacherId: string | null,
  ) => void;
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
      className={`${selectClassName} text-xs py-0.5`}
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

function classesInGradeSection<T extends { name: string }>(
  section: ReturnType<typeof groupClassesForClassManagement<T>>[number],
): T[] {
  if (section.tracks) {
    return [...section.tracks.flatMap((track) => track.classes), ...section.classList];
  }
  return section.classList;
}

export default function GradeManagementPanel({
  isZh,
  homeroomBlocks,
  teachers,
  homeroomTeacherByClassId,
  functionalTeacherByKey,
  homeroomSavingKeys,
  functionalSavingKeys,
  onHomeroomChange,
  onFunctionalRoleChange,
}: GradeManagementPanelProps) {
  const gradeNorm = normalizeGradeConfig(loadGradeConfigSync());

  return (
    <div className="border-t border-slate-100 pt-4">
      {homeroomBlocks.every((b) => b.classes.length === 0) ? (
        <p className="text-sm text-slate-500">{isZh ? '该学年下暂无班级。' : 'No classes in this year.'}</p>
      ) : (
        <div className="space-y-8">
          {homeroomBlocks.map((block) => {
            const gradeSections = groupClassesForClassManagement(gradeNorm, block.classes);
            if (block.classes.length === 0) return null;
            return (
              <div key={String(block.key)} className="space-y-3">
                {block.title ? (
                  <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-2">
                    {block.title}
                  </h4>
                ) : null}
                <div className="space-y-2">
                  {gradeSections.map((section) => {
                    const gradeClasses = classesInGradeSection(section);
                    if (gradeClasses.length === 0) return null;
                    const gradeLabel = getGradeLabelByLevel(gradeNorm, section.sortLevel);
                    const gradeScopeKey = getGradeCatalogIdForClass(gradeNorm, section.sortLevel, {
                      className: gradeClasses[0]?.name ?? '',
                    });
                    const gradeHeadSaveKey = `grade-head::${gradeScopeKey}`;
                    const gradeHeadSaving = functionalSavingKeys.has(gradeHeadSaveKey);
                    return (
                      <div
                        key={section.sectionKey}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-col items-center gap-1 shrink-0 border-r border-slate-200/90 pr-2 min-w-[6.5rem] max-w-[8rem] text-center">
                            <span className="inline-flex items-center justify-center rounded-md bg-slate-200 text-slate-700 px-2 py-0.5 text-xs font-semibold whitespace-nowrap">
                              {gradeLabel}
                            </span>
                            <TeacherSelect
                              value={functionalTeacherByKey.get(gradeHeadSaveKey) ?? ''}
                              teachers={teachers}
                              isZh={isZh}
                              disabled={gradeHeadSaving}
                              onChange={(tid) =>
                                onFunctionalRoleChange('grade-head', gradeScopeKey, gradeLabel, tid)
                              }
                            />
                          </div>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
                            {gradeClasses.map((cls) => {
                              const homeroomRowKey = `${cls.id}::${STAFFING_HOMEROOM_SUBJECT_KEY}::0`;
                              const homeroomSaving = homeroomSavingKeys.has(homeroomRowKey);
                              return (
                                <div
                                  key={cls.id}
                                  className="shrink-0 min-w-[7.5rem] max-w-[10rem] rounded-md border border-slate-200 bg-white px-2 py-1 space-y-0.5 text-center"
                                >
                                  <div className="text-xs font-semibold text-slate-800 leading-tight text-center">
                                    {cls.name}
                                  </div>
                                  <TeacherSelect
                                    value={homeroomTeacherByClassId.get(cls.id) ?? ''}
                                    teachers={teachers}
                                    isZh={isZh}
                                    disabled={homeroomSaving}
                                    onChange={(tid) => onHomeroomChange(cls.id, tid)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
