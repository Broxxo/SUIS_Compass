import { useEffect, useMemo, useState } from 'react';
import { api, USE_CLOUD_STORAGE } from '../lib/api';
import { buildTeacherPersonalAssignments } from '../lib/teacherPortraitStats';
import type { AcademicYear, ClassItem, StaffingAssignment, Term } from '../types/classManagement';
import {
  AcademicYearSelectField,
  FilterField,
  FilterSelect,
  FilterToolbar,
  TermSelectField,
} from './academicPeriodSelectors';
import TeacherPortraitAssignmentsCard from './TeacherPortraitAssignmentsCard';
import TeachingSelfReflectionBlock from './TeachingSelfReflectionBlock';

type TeacherOption = { id: string; name: string; hasReflection?: boolean };

export default function TeacherPortraitAdminPersonalDashboard({
  isZh,
  years,
  yearId,
  onYearIdChange,
  assignments,
  classById,
  teachers,
}: {
  isZh: boolean;
  years: AcademicYear[];
  yearId: string;
  onYearIdChange: (id: string) => void;
  assignments: StaffingAssignment[];
  classById: Map<string, ClassItem>;
  teachers: Array<{ id: string; primarySubject?: string | null }>;
}) {
  const [term, setTerm] = useState<Term>('Semester 1');
  const [teacherId, setTeacherId] = useState('');
  const [teacherOptions, setTeacherOptions] = useState<TeacherOption[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments) {
      if (a.teacherId && a.teacherName) m.set(a.teacherId, a.teacherName);
    }
    return m;
  }, [assignments]);

  useEffect(() => {
    if (!USE_CLOUD_STORAGE || !yearId) {
      setTeacherOptions([]);
      setTeacherId('');
      return;
    }
    let cancelled = false;
    setLoadingTeachers(true);
    (async () => {
      try {
        const templates = await api.getAdminTeacherPortraitTemplates({ academicYearId: yearId, term });
        const active =
          templates.find((t) => t.status === 'published' || t.status === 'closed') ?? null;
        const reflectionByTeacher = new Map<string, boolean>();
        if (active?.id) {
          const submissions = await api.getAdminTeacherPortraitTemplateSubmissions(active.id);
          for (const s of submissions) reflectionByTeacher.set(s.teacherId, s.hasContent);
        }

        const fromStaffing = new Map<string, string>();
        for (const a of assignments) {
          if (!a.teacherId) continue;
          fromStaffing.set(a.teacherId, a.teacherName || nameById.get(a.teacherId) || a.teacherId);
        }
        for (const t of teachers) {
          if (!fromStaffing.has(t.id)) {
            fromStaffing.set(t.id, nameById.get(t.id) || t.id);
          }
        }

        const options = Array.from(fromStaffing.entries())
          .map(([id, name]) => ({
            id,
            name,
            hasReflection: reflectionByTeacher.get(id) ?? false,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) {
          setTeacherOptions(options);
          setTeacherId((prev) => {
            if (options.length === 0) return '';
            if (prev && options.some((o) => o.id === prev)) return prev;
            return options[0].id;
          });
        }
      } catch {
        if (!cancelled) {
          const fallback = teachers
            .map((t) => ({
              id: t.id,
              name: nameById.get(t.id) || t.id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setTeacherOptions(fallback);
          setTeacherId((prev) => {
            if (fallback.length === 0) return '';
            if (prev && fallback.some((o) => o.id === prev)) return prev;
            return fallback[0].id;
          });
        }
      } finally {
        if (!cancelled) setLoadingTeachers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [yearId, term, assignments, teachers, nameById]);

  const assignmentGroups = useMemo(() => {
    if (!teacherId) return [];
    return buildTeacherPersonalAssignments(teacherId, assignments, classById);
  }, [teacherId, assignments, classById]);

  const selectedTeacher = teacherOptions.find((t) => t.id === teacherId);

  return (
    <div className="space-y-4">
      <FilterToolbar>
        <AcademicYearSelectField
          isZh={isZh}
          years={years}
          value={yearId}
          onChange={onYearIdChange}
        />
        <TermSelectField isZh={isZh} value={term} onChange={setTerm} />
        <FilterField label={isZh ? '教师' : 'Teacher'}>
          <FilterSelect
            width="teacher"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            disabled={loadingTeachers || teacherOptions.length === 0}
          >
            {teacherOptions.length === 0 ? (
              <option value="">{isZh ? '暂无教师' : 'No teachers'}</option>
            ) : (
              teacherOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.hasReflection ? (isZh ? ' · 已填诊断' : ' · Diagnosis done') : ''}
                </option>
              ))
            )}
          </FilterSelect>
        </FilterField>
      </FilterToolbar>

      {selectedTeacher && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">
              {isZh ? '任课情况' : 'Teaching assignments'} · {selectedTeacher.name}
            </h3>
            <TeacherPortraitAssignmentsCard groups={assignmentGroups} isZh={isZh} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">
              {isZh ? '教学诊断' : 'Teaching diagnosis'} · {selectedTeacher.name}
            </h3>
            <TeachingSelfReflectionBlock
              isZh={isZh}
              yearId={yearId}
              term={term}
              teacherId={teacherId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
