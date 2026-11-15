import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import {
  capabilityName,
  emptyDraft,
  loadDraft,
  makeLenses,
  performancesForGrade,
  rankUnitsForGrade,
  resolveSeed,
  saveDraft,
  upsertScheme,
  loadSchemes,
  deleteScheme,
  unitCoreTitle,
  type DesignDraft,
  type GradeTask,
  type InquiryScheme,
  type LensCard,
  type UnitRef,
} from '../lib/inquiryDesign';
import {
  generateGradeTasks,
  generateLenses,
  generateQuestions,
  generateUnderstanding,
  refineField,
  type GenSource,
} from '../lib/inquiryAi';

const EXAMPLES = ['创造力', '视角', '国际视野', '自我管理'];

function Field({
  label,
  value,
  onChange,
  onRefine,
  busy,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onRefine?: () => void;
  busy: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
        {label}
        {onRefine ? (
          <button type="button" className="text-primary disabled:opacity-40" disabled={busy} onClick={onRefine}>优化这一点</button>
        ) : null}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6"
      />
    </label>
  );
}

export default function DesignBoard({ units }: { units: UnitRef[] }) {
  const [draft, setDraft] = useState<DesignDraft>(() => loadDraft());
  const [saved, setSaved] = useState<InquiryScheme[]>(() => loadSchemes());
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  const selected = draft.lenses.find((lens) => lens.id === draft.selectedLensId) ?? draft.lenses[0];
  const question = draft.questions.find((item) => item.grade === draft.activeGrade);
  const gradeTasks = draft.tasks.filter((task) => task.grade === draft.activeGrade);
  const profileHint = useMemo(() => draft.seed.trim(), [draft.seed]);
  const lensKey = selected ? `${selected.id}|${selected.title}|${selected.angle}` : '';
  const lensStale = Boolean(draft.basisLensKey && lensKey && draft.basisLensKey !== lensKey && draft.understanding);
  const questionStale = Boolean(draft.basisUnderstanding && draft.understanding && draft.basisUnderstanding !== draft.understanding && draft.questions.length > 0);
  const profile = resolveSeed(draft.seed || '系统');
  const gradePerformances = question ? performancesForGrade(profile, question.grade) : null;
  const candidates = question && selected
    ? rankUnitsForGrade(units, question.grade, [...profile.conceptHints, selected.title], `${selected.title} ${selected.angle}`)
    : [];
  const pinnedId = question ? draft.pinnedUnitByGrade[String(question.grade)] : '';
  const anchor = candidates.find((item) => item.unitId === pinnedId) ?? candidates[0];

  function patch(partial: Partial<DesignDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function mark(source: GenSource, what: string) {
    setNote(source === 'model' ? `${what}由 DeepSeek 写成，你可以直接改。` : `${what}时模型没有返回可用结果，已用能力线和单元结构补上，你仍然可以改。`);
  }

  async function runLenses() {
    if (!draft.seed.trim()) return;
    setBusy('透镜');
    const { lenses, source } = await generateLenses(draft.seed, revision);
    patch({ lenses, selectedLensId: lenses[0]?.id ?? '' });
    mark(source, '概念透镜');
    setBusy('');
  }

  async function runUnderstanding() {
    if (!selected) return;
    setBusy('理解');
    const { understanding, source } = await generateUnderstanding(draft.seed, selected, revision);
    patch({ understanding, basisLensKey: `${selected.id}|${selected.title}|${selected.angle}` });
    mark(source, '跨学科理解');
    setBusy('');
  }

  async function runQuestions() {
    if (!selected || !draft.understanding.trim()) return;
    setBusy('问题');
    const { questions, source } = await generateQuestions(draft.seed, selected, draft.understanding, revision);
    patch({ questions, activeGrade: draft.activeGrade || 1, basisUnderstanding: draft.understanding });
    mark(source, '各年级本质问题');
    setBusy('');
  }

  async function runGradeTasks(grade = draft.activeGrade) {
    if (!selected || !draft.understanding.trim()) return;
    const currentQuestion = draft.questions.find((item) => item.grade === grade);
    if (!currentQuestion) return;
    setBusy(`任务${grade}`);
    const pinned = draft.pinnedUnitByGrade[String(grade)];
    const { tasks, source, anchored } = await generateGradeTasks(draft.seed, selected, draft.understanding, currentQuestion, units, revision, pinned);
    setDraft((current) => ({
      ...current,
      tasks: [...current.tasks.filter((task) => task.grade !== grade), ...tasks],
    }));
    if (source === 'model' && !anchored) {
      setNote(`${grade}年级任务已写成。模型没有写进单元，已把单元名补进标题和驱动问题，你还可以改。`);
    } else {
      mark(source, `${grade}年级任务链`);
    }
    setBusy('');
  }

  async function refine(current: string, apply: (text: string) => void, hint: string) {
    setBusy('优化');
    const { text, source } = await refineField(current, hint);
    setRevision((value) => value + 1);
    apply(text);
    mark(source, '这一处');
    setBusy('');
  }

  function updateLens(id: string, partial: Partial<LensCard>) {
    patch({ lenses: draft.lenses.map((lens) => (lens.id === id ? { ...lens, ...partial } : lens)) });
  }

  function updateTask(id: string, partial: Partial<GradeTask>) {
    patch({ tasks: draft.tasks.map((task) => (task.id === id ? { ...task, ...partial } : task)) });
  }

  function addLens() {
    const extra = makeLenses(draft.seed || '系统', draft.lenses.length).lenses[0];
    const lens = { ...extra, id: `lens-local-${Date.now()}`, title: '新的透镜', angle: '写清从哪个角度理解这个起点，要抽象，能换情境。' };
    patch({ lenses: [...draft.lenses, lens], selectedLensId: lens.id });
  }

  function saveScheme() {
    if (!draft.seed.trim() || draft.lenses.length === 0) return;
    const scheme: InquiryScheme = {
      id: `scheme-${draft.seed}-${draft.selectedLensId || 'draft'}`,
      title: `${draft.seed.trim()} · 跨学科序列`,
      seedKind: resolveSeed(draft.seed).kind,
      seedText: draft.seed.trim(),
      lenses: draft.lenses,
      selectedLensId: selected?.id || draft.lenses[0].id,
      understanding: draft.understanding,
      questions: draft.questions,
      tasks: draft.tasks,
      updatedAt: new Date().toISOString(),
      source: 'structure',
    };
    setSaved(upsertScheme(scheme));
    setNote('方案已保存在这台浏览器。换页或刷新都会留着当前这块设计板。');
  }

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:18px_18px]">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5">
        <section className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[16rem] flex-1 text-sm">
              <span className="mb-1 block text-slate-500">起点 · 概念、培养目标或能力</span>
              <input
                value={draft.seed}
                onChange={(event) => patch({ seed: event.target.value })}
                className="h-10 w-full rounded-md border border-slate-200 px-3"
                placeholder="创造力、视角、国际视野、自我管理"
              />
            </label>
            <Button type="button" disabled={!!busy || !draft.seed.trim()} onClick={runLenses}>
              {busy === '透镜' ? '正在生成透镜…' : draft.lenses.length ? '重新生成透镜' : '第一步 · 生成透镜'}
            </Button>
            <Button type="button" variant="outline" disabled={!draft.lenses.length} onClick={saveScheme}>保存方案</Button>
            <Button type="button" variant="ghost" onClick={() => { setDraft(emptyDraft()); setNote('已清空当前设计板。已保存的方案还在。'); }}>清空画板</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700" onClick={() => patch({ seed: example })}>
                {example}
              </button>
            ))}
            {profileHint ? <span className="text-xs leading-6 text-slate-400">可挂接单元 {units.length} 条 · 模型 DeepSeek</span> : null}
          </div>
          {saved.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">已保存</span>
              {saved.map((item) => (
                <span key={item.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setDraft({
                      seed: item.seedText,
                      lenses: item.lenses,
                      selectedLensId: item.selectedLensId,
                      understanding: item.understanding,
                      questions: item.questions,
                      tasks: item.tasks,
                      activeGrade: 1,
                      basisLensKey: '',
                      basisUnderstanding: item.understanding,
                      pinnedUnitByGrade: {},
                    })}
                  >
                    {item.title}
                  </button>
                  <button type="button" className="text-slate-400" aria-label="删除" onClick={() => setSaved(deleteScheme(item.id))}>×</button>
                </span>
              ))}
            </div>
          )}
          {note ? <p className="mt-3 text-sm text-slate-600">{note}</p> : null}
        </section>

        <div className="ml-6 border-l-2 border-dashed border-slate-300 pl-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-800">概念透镜</h2>
              <Button type="button" size="sm" variant="outline" onClick={addLens}>加一条</Button>
            </div>
            {draft.lenses.length === 0 ? (
              <p className="text-sm text-slate-500">先生成透镜。生成后可以改标题和切入角度，再决定用哪一条往下走。</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {draft.lenses.map((lens) => {
                  const active = lens.id === (selected?.id ?? '');
                  return (
                    <div key={lens.id} className={`rounded-xl border p-3 ${active ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                      <input
                        value={lens.title}
                        onChange={(event) => updateLens(lens.id, { title: event.target.value })}
                        className="w-full bg-transparent text-base font-medium outline-none"
                      />
                      <textarea
                        value={lens.angle}
                        rows={3}
                        onChange={(event) => updateLens(lens.id, { angle: event.target.value })}
                        className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm leading-6"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={() => patch({ selectedLensId: lens.id })}>
                          {active ? '当前透镜' : '用这一条'}
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={!!busy || !active} onClick={runUnderstanding}>
                          {busy === '理解' ? '生成中…' : '第二步 · 生成理解'}
                        </Button>
                        <button type="button" className="text-xs text-slate-400" onClick={() => patch({ lenses: draft.lenses.filter((item) => item.id !== lens.id) })}>删除</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-medium text-slate-800">跨学科理解</h2>
            <Field
              label={selected ? `从「${selected.title}」长出来的理解` : '先选定一条透镜'}
              value={draft.understanding}
              rows={4}
              busy={!!busy}
              onChange={(understanding) => patch({ understanding })}
              onRefine={draft.understanding ? () => refine(draft.understanding, (understanding) => patch({ understanding }), '改成一句学生可以带走、换情境仍成立的理解') : undefined}
            />
            {lensStale ? <p className="mt-2 text-xs text-amber-700">透镜已经改过。下面这句理解还是上一条透镜的，可以重新生成，也可以留着改。</p> : null}
            <Button className="mt-3" type="button" disabled={!!busy || !draft.understanding.trim()} onClick={runQuestions}>
              {busy === '问题' ? '正在生成本质问题…' : '第三步 · 生成各年级本质问题'}
            </Button>
          </section>

          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-medium text-slate-800">本质问题与任务链</h2>
            {draft.questions.length === 0 ? (
              <p className="text-sm text-slate-500">理解确定之后，再生成 1–9 年级的本质问题。九年排成一条，点开某一年，先钉单元，再生成这一年的两步任务。</p>
            ) : (
              <div className="space-y-2">
                {questionStale ? <p className="text-xs text-amber-700">理解已经改过。下面的问题还是上一句理解的，可以重新生成，也可以留着逐年级改。</p> : null}
                {draft.questions.map((item) => {
                  const open = item.grade === draft.activeGrade;
                  const hasTasks = draft.tasks.some((task) => task.grade === item.grade);
                  return (
                    <div key={item.grade} className={`rounded-xl border p-3 ${open ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                      <button type="button" className="mb-2 flex items-center gap-2 text-sm" onClick={() => patch({ activeGrade: item.grade })}>
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${open ? 'bg-primary text-primary-foreground' : 'bg-slate-100'}`}>{item.grade}</span>
                        <span>{item.grade}年级</span>
                        {hasTasks ? <span className="text-xs text-slate-400">已有任务</span> : null}
                      </button>
                      <textarea
                        value={item.question}
                        rows={open ? 2 : 1}
                        onChange={(event) => patch({
                          questions: draft.questions.map((row) => row.grade === item.grade ? { ...row, question: event.target.value } : row),
                        })}
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm leading-6"
                      />
                      {open ? (
                        <div className="mt-3 space-y-3">
                          <button
                            type="button"
                            className="text-xs text-primary disabled:opacity-40"
                            disabled={!!busy}
                            onClick={() => refine(item.question, (value) => patch({
                              questions: draft.questions.map((row) => row.grade === item.grade ? { ...row, question: value } : row),
                            }), `保持${item.grade}年级的认知难度，问题要指向当前的跨学科理解`)}
                          >
                            优化这一点
                          </button>
                          {gradePerformances ? (
                            <div className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                              <p>任务 1 · {capabilityName(gradePerformances[0].capabilityId)}：{gradePerformances[0].text}</p>
                              <p>任务 2 · {capabilityName(gradePerformances[1].capabilityId)}：{gradePerformances[1].text}</p>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {candidates.length === 0 ? (
                              <span className="text-xs text-slate-400">这一年级课程河流里还没有单元</span>
                            ) : candidates.map((candidate) => {
                              const activeUnit = candidate.unitId === (anchor?.unitId ?? '');
                              return (
                                <button
                                  key={`${candidate.unitId}-${candidate.semester}`}
                                  type="button"
                                  onClick={() => patch({ pinnedUnitByGrade: { ...draft.pinnedUnitByGrade, [String(item.grade)]: candidate.unitId } })}
                                  className={`rounded-full px-2 py-1 text-left text-xs ${activeUnit ? 'bg-primary text-primary-foreground' : 'bg-white text-slate-700'}`}
                                >
                                  {candidate.courseName} · {unitCoreTitle(candidate.unitTitle)}
                                  {candidate.fit === 'context' ? ' · 情境' : ''}
                                </button>
                              );
                            })}
                          </div>
                          {anchor ? <p className="text-xs text-slate-500">将进入「{unitCoreTitle(anchor.unitTitle)}」。{anchor.reason}</p> : null}
                          <Button type="button" disabled={!!busy} onClick={() => runGradeTasks(item.grade)}>
                            {busy === `任务${item.grade}` ? '正在生成任务…' : `第四步 · 生成${item.grade}年级任务链`}
                          </Button>
                          {gradeTasks.map((task) => (
                            <article key={task.id} className="rounded-xl bg-white p-3">
                              <div className="text-xs text-slate-500">任务 {task.step} · {capabilityName(task.capabilityId)} · 过关：{task.capabilityPerformance}</div>
                              <input
                                value={task.title}
                                onChange={(event) => updateTask(task.id, { title: event.target.value })}
                                className="mt-1 w-full bg-transparent font-medium outline-none"
                              />
                              <Field
                                label="驱动问题"
                                value={task.driveQuestion}
                                busy={!!busy}
                                onChange={(driveQuestion) => updateTask(task.id, { driveQuestion })}
                                onRefine={() => refine(task.driveQuestion, (driveQuestion) => updateTask(task.id, { driveQuestion }), '驱动问题要在当前单元里真的去做，并指向本质问题')}
                              />
                              <Field
                                label="成果"
                                value={task.product}
                                busy={!!busy}
                                rows={2}
                                onChange={(product) => updateTask(task.id, { product })}
                              />
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
