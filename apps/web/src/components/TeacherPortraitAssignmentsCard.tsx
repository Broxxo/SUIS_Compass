import type { TeacherAssignmentGroup } from '../lib/teacherPortraitStats';

export default function TeacherPortraitAssignmentsCard({
  groups,
  isZh,
}: {
  groups: TeacherAssignmentGroup[];
  isZh: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500">{isZh ? '暂无任课安排' : 'No assignments yet'}</p>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {groups.map((g) => (
        <div key={g.subjectKey} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-800">
              {g.isHomeroom ? (isZh ? '班主任' : 'Homeroom') : g.subjectName}
            </h4>
            <span className="text-xs text-slate-500 shrink-0">
              {isZh ? `${g.classes.length} 个班` : `${g.classes.length} classes`}
            </span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {g.classes.map((c) => (
              <li
                key={c.classId}
                className="rounded-md bg-slate-50 border border-slate-100 px-2.5 py-1 text-sm text-slate-700"
              >
                {c.className}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
