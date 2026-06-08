import { useMemo } from 'react';
import type { AcademicYear, ClassItem, Term } from '../types/classManagement';
import { AcademicYearTermFields } from './academicPeriodSelectors';
import { buildMyPersonalAssignments } from '../lib/teacherPortraitStats';
import TeacherPortraitAssignmentsCard from './TeacherPortraitAssignmentsCard';
import TeachingSelfReflectionBlock from './TeachingSelfReflectionBlock';

export default function TeacherPortraitPersonalDashboard({
  isZh,
  years,
  yearId,
  term,
  myAssignments,
  classById,
  onYearIdChange,
  onTermChange,
}: {
  isZh: boolean;
  years: AcademicYear[];
  yearId: string;
  term: Term;
  myAssignments: Array<{ classId: string; subjectKey: string; subjectName?: string }>;
  classById: Map<string, ClassItem>;
  onYearIdChange: (id: string) => void;
  onTermChange: (t: Term) => void;
}) {
  const assignmentGroups = useMemo(
    () => buildMyPersonalAssignments(myAssignments, classById),
    [myAssignments, classById],
  );

  return (
    <div className="space-y-4">
      <AcademicYearTermFields
        isZh={isZh}
        years={years}
        yearId={yearId}
        term={term}
        onYearIdChange={onYearIdChange}
        onTermChange={onTermChange}
        allowEmptyYear
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">{isZh ? '任课情况' : 'Teaching assignments'}</h3>
          <TeacherPortraitAssignmentsCard groups={assignmentGroups} isZh={isZh} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">{isZh ? '教学诊断' : 'Teaching diagnosis'}</h3>
          <TeachingSelfReflectionBlock isZh={isZh} yearId={yearId} term={term} />
        </div>
      </div>
    </div>
  );
}
