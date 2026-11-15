import { getApiUrl, getAuthHeaders } from './api';
import {
  capabilityName,
  makeGradeTasks,
  makeLenses,
  makeQuestions,
  makeUnderstanding,
  performancesForGrade,
  rankUnitsForGrade,
  resolveSeed,
  unitCoreTitle,
  type GradeQuestion,
  type GradeTask,
  type LensCard,
  type RankedUnit,
  type UnitRef,
} from './inquiryDesign';

/** 设计板固定走 DeepSeek，不跟侧栏里另选的模型。 */
const DEEPSEEK_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

const SYSTEM = `你是学校课程设计师，按夏雪梅的组合序列工作：概念透镜、一句可迁移的跨学科理解、分年级本质问题、挂着真实单元和能力表现的任务。
只返回一个 JSON 对象。必须使用英文半角引号和半角冒号。不要 Markdown，不要解释。
升高的是概念和能力，不是活动形式。不要用说唱画演冒充进阶。`;

export type GenSource = 'model' | 'structure';

function extractContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function parseJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function ask(user: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 70000);
  try {
    const response = await fetch(getApiUrl('/api/ai/generate'), {
      method: 'POST',
      headers: getAuthHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.4,
        max_tokens: 2500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) return null;
    const content = extractContent(await response.json());
    return content ? parseJson(content) : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function asLenses(value: unknown): LensCard[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const lenses: LensCard[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const title = String(rec.title ?? '').trim();
    const angle = String(rec.angle ?? '').trim();
    if (!title || !angle) return;
    lenses.push({ id: `lens-${Date.now()}-${index}`, title, angle });
  });
  return lenses.length >= 3 ? lenses.slice(0, 4) : null;
}

export async function generateLenses(seed: string, revision = 0): Promise<{ lenses: LensCard[]; source: GenSource }> {
  const fallback = makeLenses(seed, revision).lenses;
  const profile = resolveSeed(seed);
  const directions = profile.lenses.map((item) => item.title).join('、');
  const model = await ask(`起点类型：${profile.kind}。起点：${profile.label}。
请只生成 4 个概念透镜，用来切入这个起点。透镜要抽象，能跨年级、换单元仍然成立。
不要写成活动说明，例如「在真实单元里练习」「做一次展示」。
可以参考这些方向，但要用自己的话：${directions}。
返回 {"lenses":[{"title":"","angle":""}]}`);
  const lenses = model ? asLenses(model.lenses) : null;
  return { lenses: lenses ?? fallback, source: lenses ? 'model' : 'structure' };
}

export async function generateUnderstanding(
  seed: string,
  lens: LensCard,
  revision = 0,
): Promise<{ understanding: string; source: GenSource }> {
  const profile = resolveSeed(seed);
  const fallback = makeUnderstanding(profile, lens, revision);
  const model = await ask(`起点：${profile.label}（${profile.kind}）。
选定的概念透镜：${lens.title}。切入：${lens.angle}。
写一句学生最终可以带走的跨学科理解。要能迁移，不要写成活动。
返回 {"understanding":""}`);
  const text = model && typeof model.understanding === 'string' ? model.understanding.trim() : '';
  return { understanding: text || fallback, source: text ? 'model' : 'structure' };
}

export async function generateQuestions(
  seed: string,
  lens: LensCard,
  understanding: string,
  revision = 0,
): Promise<{ questions: GradeQuestion[]; source: GenSource }> {
  const profile = resolveSeed(seed);
  const fallback = makeQuestions(profile, revision);
  const model = await ask(`起点：${profile.label}。透镜：${lens.title}。${lens.angle}
跨学科理解：${understanding}
为 1 到 9 年级各写一个本质问题。一年级是观察和命名，九年级是权衡、迁移并说明限度。问题要指向这句理解，不要逐年换一个不相干的主题。
返回 {"questions":[{"grade":1,"question":""}]}`);
  if (!model || !Array.isArray(model.questions)) return { questions: fallback, source: 'structure' };
  const byGrade = new Map<number, string>();
  model.questions.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const grade = Number(rec.grade);
    const question = String(rec.question ?? '').trim();
    if (grade >= 1 && grade <= 9 && question) byGrade.set(grade, question);
  });
  if (byGrade.size < 9) return { questions: fallback, source: 'structure' };
  return {
    questions: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((grade) => ({ grade, question: byGrade.get(grade)! })),
    source: 'model',
  };
}

function mentionsUnit(text: string, unit: RankedUnit): boolean {
  const core = unitCoreTitle(unit.unitTitle);
  return text.includes(core) || text.includes(unit.unitTitle);
}

export function pickAnchor(units: UnitRef[], grade: number, seed: string, lens: LensCard, pinnedUnitId?: string): RankedUnit | undefined {
  const profile = resolveSeed(seed);
  const ranked = rankUnitsForGrade(units, grade, [...profile.conceptHints, lens.title], `${lens.title} ${lens.angle}`);
  return ranked.find((item) => item.unitId === pinnedUnitId) ?? ranked[0];
}

export async function generateGradeTasks(
  seed: string,
  lens: LensCard,
  understanding: string,
  question: GradeQuestion,
  units: UnitRef[],
  revision = 0,
  pinnedUnitId?: string,
): Promise<{ tasks: GradeTask[]; source: GenSource; anchored: boolean }> {
  const profile = resolveSeed(seed);
  const fallback = makeGradeTasks(seed, lens, question, units, revision);
  const anchor = pickAnchor(units, question.grade, seed, lens, pinnedUnitId);
  const [first, second] = performancesForGrade(profile, question.grade);
  const briefs = [first, second];
  if (!anchor) return { tasks: fallback, source: 'structure', anchored: false };
  const focus = anchor.focus.slice(0, 180);
  const term = anchor.semester === 'Semester 1' ? '上学期' : '下学期';
  const core = unitCoreTitle(anchor.unitTitle);
  const model = await ask(`${question.grade}年级。起点：${profile.label}。透镜：${lens.title}。${lens.angle}
理解：${understanding}
本质问题：${question.question}
必须使用这个单元，不许改成教材里没有的活动：${anchor.courseName}《${core}》，${term}第${anchor.week}周。
单元重点：${focus || '按单元标题理解'}
挂接理由：${anchor.reason}。若理由是情境，任务里要说这是借这个单元的情境。
写 2 个前后衔接的任务。
任务1在这个单元里面完成，标题里要出现「${core}」，并使用单元重点里的具体内容，不要换成单元里没有的材料。过关标准只有这一条：「${first.text}」（${capabilityName(first.capabilityId)}）。
任务2必须离开这个单元。标题不要再写「${core}」。驱动问题里写「离开《${core}》之后」，把同一句理解用到一件新的事上，并说明哪里还成立、哪里必须改。过关标准只有这一条：「${second.text}」（${capabilityName(second.capabilityId)}）。
成果必须能证明那一条过关标准，不要另写一套手工口号。
返回 {"tasks":[{"title":"","driveQuestion":"","product":""},{"title":"","driveQuestion":"","product":""}]}`);
  const rows = model && Array.isArray(model.tasks) ? model.tasks : null;
  if (!rows || rows.length < 1) return { tasks: fallback, source: 'structure', anchored: Boolean(anchor) };
  let anchored = true;
  const tasks: GradeTask[] = rows.slice(0, 2).map((item, index) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const brief = briefs[index] ?? first;
    let title = String(rec.title ?? '').trim() || fallback[index]?.title || `任务 ${index + 1}`;
    let driveQuestion = String(rec.driveQuestion ?? '').trim() || fallback[index]?.driveQuestion || question.question;
    const product = String(rec.product ?? '').trim() || fallback[index]?.product || '';
    if (!mentionsUnit(`${title} ${driveQuestion}`, anchor)) {
      anchored = false;
      if (index === 0) {
        driveQuestion = `在${anchor.courseName}《${core}》里：${driveQuestion}`;
        if (!title.includes(core)) title = `${core}：${title}`;
      } else {
        driveQuestion = `离开《${core}》之后：${driveQuestion}`;
      }
    }
    return {
      id: `task-${question.grade}-${index}-${Date.now()}`,
      grade: question.grade,
      step: index === 0 ? 1 : 2,
      title,
      driveQuestion,
      product,
      capabilityId: brief.capabilityId,
      capabilityPerformance: brief.text,
      unitLinks: [anchor],
    };
  });
  return { tasks, source: 'model', anchored };
}

export async function refineField(current: string, instruction: string): Promise<{ text: string; source: GenSource }> {
  const model = await ask(`改写下面这段，保留教师已经确定的方向，只让它更具体、更可迁移。不要换成另一个主题。
原文：${current}
要求：${instruction || '加深概念，不要堆活动动词'}
返回 {"text":""}`);
  const text = model && typeof model.text === 'string' ? model.text.trim() : '';
  if (text) return { text, source: 'model' };
  const tweaked = current.includes('可迁移') ? `${current}写的时候要能换一个情境再说一遍。` : `${current}这一点要能迁移到另一个情境。`;
  return { text: tweaked, source: 'structure' };
}
