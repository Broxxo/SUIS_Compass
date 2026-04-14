import { useEffect, useMemo, useState } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import type { AcademicYear, ClassItem, Enrollment, Student } from '../types/classManagement';
import { loadAcademicYears, loadCurrentAcademicYearId, loadAllClasses, loadStudents, loadEnrollments } from '../lib/classStorage';
import { api, USE_CLOUD_STORAGE } from '../lib/api';

type PortraitTab = 'overview' | 'my-students';

type ModuleField = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: 'text' | 'number' | 'single-select' | 'multi-select' | 'score';
  scoreMin?: number | null;
  scoreMax?: number | null;
  sortOrder: number;
};

type ProfileModule = {
  id: string;
  key: string;
  name: string;
  fields: ModuleField[];
  /** 来自 API；全本地模式下无此项 */
  isEnabled?: boolean;
};

function RadarChart({
  dimensions,
  scores,
  maxScore,
}: {
  dimensions: string[];
  scores: number[];
  maxScore: number;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;
  const levels = 5;
  const angleStep = (Math.PI * 2) / dimensions.length;

  const toPoint = (idx: number, value: number) => {
    const ratio = Math.max(0, Math.min(1, value / maxScore));
    const a = -Math.PI / 2 + idx * angleStep;
    return {
      x: cx + Math.cos(a) * radius * ratio,
      y: cy + Math.sin(a) * radius * ratio,
    };
  };

  const polygon = scores
    .map((v, i) => {
      const p = toPoint(i, v);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="max-w-full h-auto">
      {[...Array(levels)].map((_, i) => {
        const ratio = (i + 1) / levels;
        const pts = dimensions
          .map((__, idx) => {
            const a = -Math.PI / 2 + idx * angleStep;
            const x = cx + Math.cos(a) * radius * ratio;
            const y = cy + Math.sin(a) * radius * ratio;
            return `${x},${y}`;
          })
          .join(' ');
        return <polygon key={i} points={pts} fill="none" stroke="#cbd5e1" strokeWidth="1" />;
      })}
      {dimensions.map((label, idx) => {
        const a = -Math.PI / 2 + idx * angleStep;
        const x = cx + Math.cos(a) * (radius + 18);
        const y = cy + Math.sin(a) * (radius + 18);
        return (
          <g key={label}>
            <line x1={cx} y1={cy} x2={cx + Math.cos(a) * radius} y2={cy + Math.sin(a) * radius} stroke="#e2e8f0" />
            <text x={x} y={y} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {label}
            </text>
          </g>
        );
      })}
      <polygon points={polygon} fill="rgba(14, 165, 233, 0.25)" stroke="#0284c7" strokeWidth="2" />
    </svg>
  );
}

export default function StudentPortrait({
  onBackToHub,
  initialTab = 'overview',
}: {
  onBackToHub: () => void;
  initialTab?: PortraitTab;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const isStudentSelf = user?.role === 'student';
  const [tab, setTab] = useState<PortraitTab>(initialTab);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [modules, setModules] = useState<ProfileModule[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [studentValues, setStudentValues] = useState<Record<string, Record<string, unknown>>>({});
  const [homeroomEditable, setHomeroomEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isStudentSelf) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadAcademicYears(),
      loadCurrentAcademicYearId(),
      loadAllClasses(),
      loadStudents(),
      loadEnrollments(),
      USE_CLOUD_STORAGE ? api.getStudentProfileModules() : Promise.resolve([]),
    ])
      .then(([y, current, cls, stu, enr, mods]) => {
        if (cancelled) return;
        setYears(y);
        setCurrentYearId(current || y[0]?.id || null);
        setClasses(cls);
        setStudents(stu);
        setEnrollments(enr);
        setModules((mods as ProfileModule[]).filter((m) => m.isEnabled !== false));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load student portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf]);

  useEffect(() => {
    if (!isStudentSelf) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!USE_CLOUD_STORAGE) {
      setLoading(false);
      setError(isZh ? '学生登录需开启云端模式（VITE_USE_CLOUD_STORAGE）并联调服务器。' : 'Student login requires cloud mode and API.');
      return;
    }
    const sid = user?.studentId;
    if (!sid) {
      setLoading(false);
      setError(isZh ? '该账号未关联学籍，无法展示画像。请联系管理员。' : 'This account is not linked to a student record.');
      return;
    }
    Promise.all([
      api.getStudentProfileModules(),
      api.getStudents(),
      api.getStudentProfileValues(sid),
    ])
      .then(([mods, stuList, values]) => {
        if (cancelled) return;
        setYears([]);
        setCurrentYearId(null);
        setClasses([]);
        setStudents(stuList);
        setEnrollments([]);
        setModules((mods as ProfileModule[]).filter((m) => m.isEnabled !== false));
        setSelectedStudentId(sid);
        setStudentValues(values);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || 'Failed to load student portrait data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentSelf, user?.studentId, user?.id, isZh]);

  const yearClasses = useMemo(
    () => classes.filter((c) => !currentYearId || c.academicYearId === currentYearId),
    [classes, currentYearId]
  );

  const classIdsSet = useMemo(() => new Set(yearClasses.map((c) => c.id)), [yearClasses]);

  const activeEnrollments = useMemo(
    () => enrollments.filter((e) => classIdsSet.has(e.classId)),
    [enrollments, classIdsSet]
  );

  const classStudentIds = useMemo(() => {
    if (!selectedClassId) return new Set<string>();
    return new Set(activeEnrollments.filter((e) => e.classId === selectedClassId).map((e) => e.studentId));
  }, [activeEnrollments, selectedClassId]);

  const myStudents = useMemo(
    () => students.filter((s) => classStudentIds.has(s.id)),
    [students, classStudentIds]
  );

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  const abilityModule = useMemo(
    () => modules.find((m) => m.key === 'ability') ?? null,
    [modules]
  );

  const canEditProfile = useMemo(
    () =>
      !isStudentSelf && (user?.role === 'admin' || user?.role === 'system-admin' || homeroomEditable),
    [user?.role, homeroomEditable, isStudentSelf]
  );

  useEffect(() => {
    if (isStudentSelf) {
      setHomeroomEditable(false);
      return;
    }
    if (!USE_CLOUD_STORAGE) {
      setHomeroomEditable(user?.role === 'admin' || user?.role === 'system-admin');
      return;
    }
    if (!selectedClassId || !user?.id || user.role === 'admin' || user.role === 'system-admin') {
      setHomeroomEditable(user?.role === 'admin' || user?.role === 'system-admin');
      return;
    }
    api
      .getClassTeachers(selectedClassId)
      .then((teachers) => {
        const isHomeroom = teachers.some((t) => t.teacherId === user.id && t.role === 'homeroom');
        setHomeroomEditable(isHomeroom);
      })
      .catch(() => setHomeroomEditable(false));
  }, [selectedClassId, user?.id, user?.role, isStudentSelf]);

  useEffect(() => {
    if (isStudentSelf) return;
    if (!selectedStudentId) return;
    if (!USE_CLOUD_STORAGE) {
      setStudentValues({});
      return;
    }
    api
      .getStudentProfileValues(selectedStudentId)
      .then((values) => setStudentValues(values))
      .catch((e: unknown) => setError((e as Error)?.message || 'Failed to load profile values'));
  }, [selectedStudentId, isStudentSelf]);

  const learningStats = useMemo(() => {
    const inYearStudentIds = new Set(activeEnrollments.map((e) => e.studentId));
    const inYearStudents = students.filter((s) => inYearStudentIds.has(s.id));
    const active = inYearStudents.filter((s) => (s.status ?? 'active') === 'active').length;
    const byDivision = new Map<string, number>();
    const byGrade = new Map<string, number>();
    for (const s of inYearStudents) {
      const div = s.division || (isZh ? '未设置' : 'Not set');
      byDivision.set(div, (byDivision.get(div) ?? 0) + 1);
      const g = s.currentGrade != null ? `G${s.currentGrade}` : (isZh ? '未设置' : 'Not set');
      byGrade.set(g, (byGrade.get(g) ?? 0) + 1);
    }
    return {
      total: inYearStudents.length,
      active,
      activeRate: inYearStudents.length ? Math.round((active / inYearStudents.length) * 100) : 0,
      byDivision: Array.from(byDivision.entries()).sort((a, b) => b[1] - a[1]),
      byGrade: Array.from(byGrade.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [activeEnrollments, students, isZh]);

  const abilityFields = useMemo(
    () => (abilityModule?.fields ?? []).filter((f) => f.fieldType === 'score').sort((a, b) => a.sortOrder - b.sortOrder),
    [abilityModule]
  );

  const abilityValues = useMemo(() => {
    if (!abilityModule) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    const modVals = studentValues[abilityModule.id] ?? {};
    for (const f of abilityFields) {
      const raw = modVals[f.fieldKey];
      const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
      map[f.fieldKey] = Number.isNaN(n) ? 0 : n;
    }
    return map;
  }, [studentValues, abilityModule, abilityFields]);

  const saveAbility = async () => {
    if (!selectedStudentId || !abilityModule) return;
    if (!USE_CLOUD_STORAGE) {
      setError(isZh ? '全本地模式下画像分值无法同步到服务器，联调 API 时请打开 VITE_USE_CLOUD_STORAGE。' : 'Profile scores need API when cloud storage is off.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.putStudentProfileModuleValues(selectedStudentId, abilityModule.id, abilityValues);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pt-14">
      <AppTopBar
        title={isStudentSelf ? (isZh ? '我的画像' : 'My profile') : isZh ? '学生画像' : 'Student Portrait'}
        showBack={!isStudentSelf}
        onBack={isStudentSelf ? undefined : onBackToHub}
      />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {!isStudentSelf && (
          <div className="bg-white border border-slate-200 rounded-xl p-2 inline-flex gap-1">
            <Button variant={tab === 'overview' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('overview')}>
              {isZh ? '全校学习看板' : 'School Learning Dashboard'}
            </Button>
            <Button variant={tab === 'my-students' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('my-students')}>
              {isZh ? '我的学生档案' : 'My Students'}
            </Button>
          </div>
        )}

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        {!USE_CLOUD_STORAGE && !loading && !isStudentSelf && (
          <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            {isZh
              ? '本地模式：看板与班级学生列表来自 localStorage；能力雷达等画像模块需开启 VITE_USE_CLOUD_STORAGE 并联调后端 API。'
              : 'Local mode: dashboard and class lists use localStorage; profile modules need API (set VITE_USE_CLOUD_STORAGE=true).'}
          </div>
        )}
        {loading && <div className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</div>}

        {!loading && isStudentSelf && selectedStudent && (
          <section className="space-y-4">
            <p className="text-sm text-slate-600">
              {isZh ? '以下为你在校能力画像（只读）。基础学籍信息如有误请联系班主任或管理员。' : 'Your learning profile (read-only). Contact your teacher or admin if core records are wrong.'}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 lg:col-span-3">
                <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-r from-slate-50 to-white mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-semibold">
                      {(selectedStudent.nameZh || selectedStudent.name).slice(0, 1)}
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-slate-800">{selectedStudent.nameZh || selectedStudent.name}</div>
                      <div className="text-sm text-slate-500">
                        {selectedStudent.nameEn || '—'} · {selectedStudent.studentNumber || '—'} · {selectedStudent.status || 'active'}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="border border-slate-200 rounded-xl p-3">
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学习能力雷达（0-10）' : 'Learning Radar (0-10)'}</h4>
                    {abilityFields.length === 0 ? (
                      <p className="text-xs text-slate-500">{isZh ? '暂未配置能力维度。' : 'No ability dimensions yet.'}</p>
                    ) : (
                      <RadarChart
                        dimensions={abilityFields.map((f) => f.label)}
                        scores={abilityFields.map((f) => abilityValues[f.fieldKey] ?? 0)}
                        maxScore={10}
                      />
                    )}
                  </div>
                  <div className="border border-slate-200 rounded-xl p-3 text-sm text-slate-600">
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '说明' : 'Note'}</h4>
                    <p>{isZh ? '画像分值由班主任或学校管理员维护；你可在此查看最新记录。' : 'Scores are maintained by your teachers and admins; this page shows the latest records.'}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !isStudentSelf && tab === 'overview' && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '学年在册学生' : 'Students in year'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.total}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '在读学生' : 'Active students'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.active}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{isZh ? '在读率' : 'Active rate'}</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{learningStats.activeRate}%</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学部分布' : 'Division distribution'}</h3>
                <ul className="space-y-1 text-sm">
                  {learningStats.byDivision.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-slate-700">{k}</span>
                      <span className="text-slate-500">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '年级分布' : 'Grade distribution'}</h3>
                <ul className="space-y-1 text-sm">
                  {learningStats.byGrade.map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-slate-700">{k}</span>
                      <span className="text-slate-500">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              {isZh
                ? '教学建议：优先关注“在读状态非 active”的学生；结合能力维度雷达图，识别低于班级均值的维度并设置针对性学习支持。'
                : 'Teaching tip: prioritize students not in active status; combine radar dimensions to identify below-average skills and plan targeted support.'}
            </div>
          </section>
        )}

        {!loading && !isStudentSelf && tab === 'my-students' && (
          <section className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '学年' : 'Academic year'}</label>
                <select
                  value={currentYearId || ''}
                  onChange={(e) => setCurrentYearId(e.target.value || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
                >
                  <option value="">—</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{isZh ? '班级' : 'Class'}</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value);
                    setSelectedStudentId('');
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[220px]"
                >
                  <option value="">{isZh ? '请选择班级' : 'Select class'}</option>
                  {yearClasses.map((c) => (
                    <option key={c.id} value={c.id}>G{c.grade} {c.name}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-slate-500">
                {canEditProfile
                  ? (isZh ? '当前角色可编辑画像（基础档案仍由管理员维护）' : 'You can edit profile only (core record remains admin-managed).')
                  : (isZh ? '当前角色只读查看画像' : 'Read-only profile view for current role.')}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-3 lg:col-span-1">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学生列表' : 'Students'}</h3>
                <div className="space-y-2 max-h-[520px] overflow-y-auto">
                  {myStudents.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStudentId(s.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-sm ${
                        selectedStudentId === s.id
                          ? 'border-sky-400 bg-sky-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-medium text-slate-800">{s.nameZh || s.name}</div>
                      <div className="text-xs text-slate-500">{s.studentNumber || '—'} · {s.division || (isZh ? '未设学部' : 'No division')}</div>
                    </button>
                  ))}
                  {selectedClassId && myStudents.length === 0 && (
                    <div className="text-xs text-slate-500">{isZh ? '该班暂无学生' : 'No students in this class.'}</div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 lg:col-span-2">
                {!selectedStudent ? (
                  <div className="text-sm text-slate-500">{isZh ? '请选择左侧学生查看电子档案' : 'Select a student to open the profile card.'}</div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-r from-slate-50 to-white">
                      <div className="flex items-center gap-3">
                        <div className="h-14 w-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-semibold">
                          {(selectedStudent.nameZh || selectedStudent.name).slice(0, 1)}
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-slate-800">{selectedStudent.nameZh || selectedStudent.name}</div>
                          <div className="text-sm text-slate-500">
                            {selectedStudent.nameEn || '—'} · {selectedStudent.studentNumber || '—'} · {selectedStudent.status || 'active'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="border border-slate-200 rounded-xl p-3">
                        <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学习能力雷达（0-10）' : 'Learning Radar (0-10)'}</h4>
                        {abilityFields.length === 0 ? (
                          <p className="text-xs text-slate-500">{isZh ? '暂未配置能力维度，请在后台新增能力字段。' : 'No ability dimensions yet. Add score fields in admin.'}</p>
                        ) : (
                          <>
                            <RadarChart
                              dimensions={abilityFields.map((f) => f.label)}
                              scores={abilityFields.map((f) => abilityValues[f.fieldKey] ?? 0)}
                              maxScore={10}
                            />
                            <div className="space-y-2 mt-2">
                              {abilityFields.map((f) => (
                                <div key={f.id} className="flex items-center justify-between gap-2">
                                  <label className="text-xs text-slate-600">{f.label}</label>
                                  <input
                                    type="number"
                                    min={f.scoreMin ?? 0}
                                    max={f.scoreMax ?? 10}
                                    step={0.5}
                                    disabled={!canEditProfile}
                                    value={abilityValues[f.fieldKey] ?? 0}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      setStudentValues((prev) => ({
                                        ...prev,
                                        [abilityModule!.id]: {
                                          ...(prev[abilityModule!.id] ?? {}),
                                          [f.fieldKey]: Number.isNaN(n) ? 0 : n,
                                        },
                                      }));
                                    }}
                                    className="w-20 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-60"
                                  />
                                </div>
                              ))}
                            </div>
                            {canEditProfile && (
                              <div className="mt-3">
                                <Button size="sm" onClick={saveAbility} disabled={saving}>
                                  {saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存画像' : 'Save profile')}
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="border border-slate-200 rounded-xl p-3">
                        <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '教学建议（学习中心）' : 'Learning-focused teaching cues'}</h4>
                        <ul className="space-y-2 text-sm text-slate-700">
                          <li>{isZh ? '先看学生最弱 1-2 个能力维度，设计下周的差异化任务。' : 'Prioritize the weakest 1-2 dimensions for next-week differentiation.'}</li>
                          <li>{isZh ? '将能力分数与课堂表现证据配对记录，避免仅凭印象判断。' : 'Pair scores with classroom evidence to avoid impression-only judgments.'}</li>
                          <li>{isZh ? '和学生共同设定一个短周期目标（2-4 周），并滚动更新画像。' : 'Set a short-cycle (2-4 week) goal with the student and update profile iteratively.'}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

