/**
 * 跨学科设计板的数据结构与结构化生成。
 * 生成遵循夏雪梅的组合序列：概念透镜 → 跨学科理解 → 分年级本质问题 → 任务链。
 * 任务同时引用能力线的年级表现，以及课程河流里的真实单元。
 * 模型不可用时，这条结构化生成仍能产出可编辑、可保存的完整序列。
 */

import {
  CAPABILITIES,
  type CapabilityId,
  getCapability,
  matchCapabilityByName,
  performanceBullets,
} from './capabilityLine';

export type SeedKind = 'concept' | 'aim' | 'capability';
export type UnitFit = 'direct' | 'context';

export interface UnitRef {
  courseId: string;
  courseName: string;
  unitId: string;
  unitTitle: string;
  focus: string;
  keyConcepts: string[];
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  week: string;
}

export interface LensCard {
  id: string;
  title: string;
  angle: string;
}

export interface GradeQuestion {
  grade: number;
  question: string;
}

export interface TaskLink {
  courseId: string;
  courseName: string;
  unitId: string;
  unitTitle: string;
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  week: string;
  fit: UnitFit;
}

export interface GradeTask {
  id: string;
  grade: number;
  step: 1 | 2;
  title: string;
  driveQuestion: string;
  product: string;
  capabilityId: CapabilityId;
  capabilityPerformance: string;
  unitLinks: TaskLink[];
}

export interface InquiryScheme {
  id: string;
  title: string;
  seedKind: SeedKind;
  seedText: string;
  lenses: LensCard[];
  selectedLensId: string;
  understanding: string;
  questions: GradeQuestion[];
  tasks: GradeTask[];
  updatedAt: string;
  source: 'structure' | 'model';
}

export const INQUIRY_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const STORAGE_KEY = 'suis.curriculum2.schemes.v1';
const DRAFT_KEY = 'suis.curriculum2.draft.v2';

function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

interface LensSeed {
  title: string;
  angle: string;
}

interface SeedProfile {
  kind: SeedKind;
  label: string;
  /** 任务链第一步要看见的能力 */
  capabilityId: CapabilityId;
  /** 第二步迁移成果要看见的能力 */
  transferCapabilityId: CapabilityId;
  conceptHints: string[];
  lenses: LensSeed[];
  understanding: [string, string];
  questions: [string, string][];
}

const AIM_PROFILES: Record<string, Omit<SeedProfile, 'kind' | 'label'> & { label: string }> = {
  国际视野: {
    label: '国际视野',
    capabilityId: 'analysis',
    transferCapabilityId: 'communication',
    conceptHints: ['全球互动', '文化', '视角', '身份认同', 'Global', 'Culture', 'Perspective', 'Identity'],
    lenses: [
      { title: '视角', angle: '同一件事，不同地方的人怎样看，结论会有什么不同。' },
      { title: '文化', angle: '哪些做法来自文化，因而不是唯一正确答案。' },
      { title: '全球互动', angle: '校园里的一个选择，怎样连着远处的人与环境。' },
      { title: '身份认同', angle: '我是谁，和比班级更大的世界是什么关系。' },
    ],
    understanding: [
      '国际视野是学生能从多于一种文化和立场理解一件真实的事，并说明自己的看法如何因此改变。',
      '国际视野不是多知道几个国家的名字，而是能在真实问题里听见另一种立场，并用证据说明自己的看法变了什么、没变什么。',
    ],
    questions: [
      ['我身边的一件事，别人会怎么说？', '同一件校园里的事，另一个人会怎么讲？'],
      ['我怎样把别人的说法画出来或说出来？', '我怎样用一幅图讲清一个和我不同的看法？'],
      ['两种说法哪里一样，哪里不一样？', '这两个地方的做法，哪一部分是一样的？'],
      ['我听到不同说法之后，自己的看法有没有动一动？', '哪一句别人的话让我改了一点点想法？'],
      ['这件事和更远的人有没有关系？', '我们的一个选择，会碰到学校外面的谁？'],
      ['如果我站到另一种文化里，规则会怎样变？', '换一个地方，哪条规则还在，哪条规则要改？'],
      ['我怎样用证据说明另一种立场，而不是只说「他们不同」？', '我凭什么说另一种看法也讲得通？'],
      ['本地的一个做法，放到别处会帮助谁、难住谁？', '这个做法迁走之后，谁受益，谁承担代价？'],
      ['我怎样为自己的立场辩护，同时承认它的限度？', '我的看法在哪里成立，在哪里不够用？'],
    ],
  },
  文化自信: {
    label: '文化自信',
    capabilityId: 'analysis',
    transferCapabilityId: 'communication',
    conceptHints: ['文化', '身份认同', '审美', 'Culture', 'Identity', 'Aesthetics'],
    lenses: [
      { title: '文化', angle: '我们自己的文化里，什么值得讲清楚，而不是只陈列出来。' },
      { title: '身份认同', angle: '认识自己的文化，和认识别人的文化是同一件事的两面。' },
      { title: '审美', angle: '形式和美感怎样承载一种生活，而不只是装饰。' },
      { title: '视角', angle: '自己人觉得自然的做法，外人会怎样理解。' },
    ],
    understanding: [
      '文化自信是学生能讲清自己文化里一个真实的做法为什么如此，也能把它和另一种文化放在一起比较，而不贬低任何一边。',
      '文化自信不是把传统背下来，而是能说明一个文化做法解决了什么问题，并听得进另一种做法。',
    ],
    questions: [
      ['我们这里的人怎样做这一件事？', '这一件日常的事，我们是怎样做的？'],
      ['我怎样把这个做法讲给没见过的人？', '如果对方没见过，我第一句说什么？'],
      ['这个做法里，哪一部分不能丢掉？', '丢掉哪一步，这件事就不成了？'],
      ['另一种文化怎样做同一件事？', '别人用什么办法解决同一个问题？'],
      ['两种做法各自照顾了谁？', '这两种做法，各让谁更方便？'],
      ['我能不能不评价高低，只把差别说清楚？', '我怎样只描述差别，不急着说谁对？'],
      ['哪一部分可以分享，哪一部分需要解释背景？', '什么可以直接给别人看，什么必须先讲来历？'],
      ['如果要向另一个社区介绍它，我选哪个证据？', '我用哪一件实物或哪一段话来说明？'],
      ['我怎样既站稳自己的文化，又改掉其中不再合适的部分？', '哪一点我要坚持，哪一点我要改？'],
    ],
  },
};

const CONCEPT_LENSES: Record<string, LensSeed[]> = {
  创造力: [
    { title: '视角', angle: '创造力常常来自换一个角度看同一批材料。' },
    { title: '形式', angle: '创造力是把已有的东西改成一种新的形式。' },
    { title: '系统', angle: '创造力是在限制里重组各个部分，让系统做一件新的事。' },
    { title: '迁移', angle: '创造力是把一个情境里有效的做法带到另一个情境，并改掉不合适的部分。' },
  ],
  视角: [
    { title: '视角', angle: '谁在看，会决定看见什么、忽略什么。' },
    { title: '关系', angle: '不同的人因为关系不同，对同一件事有不同的利害。' },
    { title: '文化', angle: '视角往往来自一个人所处的文化和经验，不是随便的意见。' },
    { title: '责任', angle: '一旦看见了别人的视角，我们要为这个看见做什么。' },
  ],
  系统: [
    { title: '系统', angle: '部分如何配合，才让整件事运转。' },
    { title: '变化', angle: '改动一个要素，会牵动哪些别的部分。' },
    { title: '关系', angle: '要素之间的关系，比要素本身更决定结果。' },
    { title: '责任', angle: '谁维护这个系统，谁在系统失灵时承担后果。' },
  ],
};

const TRANSFER_CAPABILITY: Record<CapabilityId, CapabilityId> = {
  research: 'communication',
  analysis: 'evaluation',
  evaluation: 'reflection',
  reflection: 'collaboration',
  collaboration: 'communication',
  communication: 'reflection',
};

/** 能力起点也要有概念透镜，否则序列只是一串活动口号，换单元就散。 */
const CAPABILITY_LENSES: Record<CapabilityId, LensSeed[]> = {
  research: [
    { title: '问题与证据', angle: '一个值得追的问题，要能被某一种证据回答。' },
    { title: '来源与方法', angle: '答案从哪来，决定了我们能说什么、不能说什么。' },
    { title: '记录与整理', angle: '记下的方式会改变后来还能不能用这些发现。' },
    { title: '预测与检验', angle: '先说会怎样，再选一种办法看它是否成立。' },
  ],
  analysis: [
    { title: '部分与整体', angle: '先把一件事拆开，才能看出它为什么是这样。' },
    { title: '视角', angle: '不同的人看见的部分不一样，结论就会不同。' },
    { title: '因果', angle: '一个原因怎样连到一个结果，中间不能跳步。' },
    { title: '行动的后果', angle: '提出做法时，要说出会改变什么、影响谁。' },
  ],
  evaluation: [
    { title: '来源与目的', angle: '谁在说、为什么说，会改变这句话能被怎样使用。' },
    { title: '证据与空缺', angle: '一个说法缺了哪一条证据，就不该被当成已经成立。' },
    { title: '偏向', angle: '偏向不是指责，而是这条来源会把读者带向哪一边。' },
    { title: '论证', angle: '从理由到结论中间的那一步，要能被指出来。' },
  ],
  reflection: [
    { title: '计划与调整', angle: '先定下一步。做的时候发现不行，就改这一步，而不是重说一句口号。' },
    { title: '证据与改进', angle: '改进要指着一件具体的事，而不是「下次更好」。' },
    { title: '个人贡献', angle: '自己做的那一份怎样影响了整件事的结果。' },
    { title: '观点是否改变', angle: '做完之后，原来的看法哪一点动了，哪一点没动。' },
  ],
  collaboration: [
    { title: '分工与理由', angle: '谁做什么，要按这件事需要什么，而不是按座位。' },
    { title: '相互依赖', angle: '有的步骤必须别人先做完，自己才能开始。' },
    { title: '分歧', angle: '不同意时把问题说清楚，团队还要回到共同目标。' },
    { title: '补位', angle: '计划变了的时候，谁接上缺的那一步。' },
  ],
  communication: [
    { title: '把一件事说完整', angle: '谁、做什么、结果怎样，缺一项别人就接不住。' },
    { title: '对象', angle: '同一件事，对同伴和对更小的同学，说法要变。' },
    { title: '来源可见', angle: '哪一句是自己的，哪一句来自资料，要能被指出来。' },
    { title: '听完再回应', angle: '回应要接住上一句，讨论才会往前。' },
  ],
};

function capabilityQuestions(label: string): [string, string][] {
  return [
    [`在身边的一件事里，${label}的第一步是什么？`, `我刚才做的哪一小步，算是${label}？`],
    [`这件事里，哪一部分要靠${label}才看得清？`, `如果不做这一步，我们会漏掉什么？`],
    [`两种做法里，${label}帮我们看出了什么不同？`, `这一步做完，我们知道了什么原来不知道的？`],
    [`我凭什么说这一步做对了？证据在哪？`, `没有证据时，这个判断还成立吗？`],
    [`换一个同学来做，这一步会怎样变？`, `别人的做法让我改了哪一点？`],
    [`如果时间或材料不够，${label}先保住哪一步？`, `卡住的时候，我改哪一步，而不是放弃整件事？`],
    [`我怎样向别人说明这一步为什么必要？`, `哪一条证据支持我继续这样做？`],
    [`把这一步带到另一个单元，哪里还一样？`, `新的单元里，哪一条必须改？`],
    [`这一步的限度是什么？它帮不到谁？`, `我怎样既完成这一步，又说明它没解决的部分？`],
  ];
}

function conceptKey(text: string): string {
  const trimmed = text.trim();
  const zh = trimmed.split(/\s+/)[0] ?? trimmed;
  return zh;
}

function genericLenses(label: string): LensSeed[] {
  return [
    { title: '系统', angle: `「${label}」由哪些部分组成，这些部分怎样互相影响。` },
    { title: '变化', angle: `「${label}」在什么条件下会改变，改变之后谁受到影响。` },
    { title: '视角', angle: `不同的人怎样看待「${label}」，他们的看法为什么不同。` },
    { title: '责任', angle: `理解了「${label}」之后，我们在真实情境里可以做什么、不该做什么。` },
  ];
}

function genericQuestions(label: string): [string, string][] {
  return [
    [`「${label}」在我们身边长什么样？`, `我在哪里能看见「${label}」？`],
    [`「${label}」有哪些看得到的部分？`, `我能指出「${label}」的两个部分吗？`],
    [`这些部分怎样连在一起？`, `一个部分变了，旁边的部分会怎样？`],
    [`两种和「${label}」有关的做法，哪里不同？`, `这两种做法，谁更适合这件事？`],
    [`如果改动一个部分，会有什么后果？`, `改动哪一个部分，结果变化最大？`],
    [`不同的人会怎样解释「${label}」？`, `换一个人来看，结论会变成什么？`],
    [`我们怎样用证据选择一种解释？`, `哪条证据让我放弃原来的想法？`],
    [`这个理解能带到一个新情境吗？哪里要改？`, `新情境里，哪一条还成立？`],
    [`我们怎样改进这件事，并说明改进的限度？`, `这个改进帮助了谁，又忽略了谁？`],
  ];
}

export function resolveSeed(seedText: string): SeedProfile {
  const label = conceptKey(seedText) || '未命名';
  const capability = matchCapabilityByName(seedText);
  if (capability) {
    return {
      kind: 'capability',
      label: capability.zh,
      capabilityId: capability.id,
      transferCapabilityId: TRANSFER_CAPABILITY[capability.id],
      conceptHints: capability.conceptHints,
      lenses: CAPABILITY_LENSES[capability.id],
      understanding: [
        `${capability.zh}要能迁移：换一个学科单元，学生仍知道这一步在看什么。${capability.summary}`,
        `把${capability.zh}放进真实单元，是为了让表现被看见。低年级先做到一条，高年级要说明为什么这样做、限度在哪。`,
      ],
      questions: capabilityQuestions(capability.zh),
    };
  }

  const aim = AIM_PROFILES[label];
  if (aim) {
    return { kind: 'aim', ...aim };
  }

  const known = CONCEPT_LENSES[label];
  const capabilityId: CapabilityId = 'analysis';
  const transferCapabilityId: CapabilityId = label === '视角' ? 'evaluation' : 'communication';
  return {
    kind: 'concept',
    label,
    capabilityId,
    transferCapabilityId,
    conceptHints: [label, seedText.trim()].filter(Boolean),
    lenses: known ?? genericLenses(label),
    understanding: [
      `学生最终带走的，不是「${label}」这个词，而是能用一种概念透镜解释真实的事：部分如何构成整体，改变如何发生，不同的人为什么看见不同的东西。`,
      `围绕「${label}」的跨学科理解应当能迁移：换一个年级、换一门学科，学生仍能问出更深的问题，而不是重复同一个活动。`,
    ],
    questions: genericQuestions(label),
  };
}

function pick<T>(items: T[], revision: number): T {
  return items[((revision % items.length) + items.length) % items.length];
}

export function selectedLens(scheme: Pick<InquiryScheme, 'lenses' | 'selectedLensId'>): LensCard {
  return scheme.lenses.find((lens) => lens.id === scheme.selectedLensId) ?? scheme.lenses[0];
}

export function makeLenses(seedText: string, revision = 0): { profile: SeedProfile; lenses: LensCard[] } {
  const profile = resolveSeed(seedText);
  const rotated = profile.lenses.map((_, index) => profile.lenses[(index + revision) % profile.lenses.length]);
  const lenses = rotated.map((lens) => ({
    id: uid('lens'),
    title: lens.title,
    angle: revision % 2 === 1 ? `${lens.angle}切入时要能回到校园里的一件具体的事。` : lens.angle,
  }));
  return { profile, lenses };
}

export function makeUnderstanding(profile: SeedProfile, lens: LensCard, revision = 0): string {
  const base = pick(profile.understanding, revision);
  return `${base}本次从「${lens.title}」切入：${lens.angle}`;
}

export function makeQuestions(profile: SeedProfile, revision = 0): GradeQuestion[] {
  return INQUIRY_GRADES.map((grade, index) => ({
    grade,
    question: profile.questions[index][revision % 2],
  }));
}

const INQUIRY_SUBJECTS = ['综合实践', '科学', '道法', '道德与法治', '美术', '信息科技', '历史', '地理', '生物', '物理', '化学', '劳动'];
const SUBJECT_ORDER = ['科学', '综合实践', '劳动', '道法', '道德与法治', '信息科技', '历史', '地理', '生物', '物理', '化学', '美术'];

/** 透镜和单元用同一组说法时加分，避免只凭「创造力」标签挑到节日课。 */
const LENS_CUES: Array<{ lens: string[]; unit: string[] }> = [
  { lens: ['约束', '限制', '材料', '重组', '生成', '发明', '设计', '形式'], unit: ['设计', '制作', '材料', '变形', '发明', '改进', '实验', '工具', '结构'] },
  { lens: ['视角', '看法', '立场', '不同'], unit: ['看法', '倾听', '表达', '交往', '不同', '人物'] },
  { lens: ['文化', '传统', '身份', '认同'], unit: ['文化', '传统', '节日', '家乡', '习俗', '祖先'] },
  { lens: ['计划', '调整', '改进', '贡献', '反思'], unit: ['方法', '习惯', '计划', '劳动', '学习'] },
  { lens: ['证据', '来源', '论证', '评价'], unit: ['资料', '调查', '数据', '来源', '实验'] },
  { lens: ['全球', '互动', '国际'], unit: ['世界', '全球', '环境', '地球', '国际'] },
];

export interface RankedUnit extends TaskLink {
  score: number;
  reason: string;
  focus: string;
}

function subjectOrder(name: string): number {
  const index = SUBJECT_ORDER.findIndex((item) => name.includes(item));
  return index === -1 ? SUBJECT_ORDER.length : index;
}

function conceptHead(concept: string): string {
  return concept.split(/\s|\//)[0] ?? concept;
}

export function unitCoreTitle(title: string): string {
  const head = title.split('/')[0]?.trim() ?? title;
  return head.replace(/^第.+?单元\s*/, '').trim() || head;
}

export function rankUnitsForGrade(units: UnitRef[], grade: number, hints: string[], lensText = ''): RankedUnit[] {
  const atGrade = units.filter((unit) => unit.grade === grade);
  const lens = lensText.trim();
  const ranked = atGrade.map((unit) => {
    let score = 0;
    const reasons: string[] = [];
    const blob = `${unit.unitTitle} ${unit.focus}`;
    hints.forEach((hint) => {
      const key = hint.trim();
      if (key.length < 2) return;
      const conceptHit = unit.keyConcepts.some((concept) => concept.includes(key) || key.includes(conceptHead(concept)));
      if (conceptHit) {
        score += 6;
        reasons.push(`概念含「${key}」`);
      } else if (blob.includes(key)) {
        score += 3;
        reasons.push(`单元内容写到「${key}」`);
      }
    });
    if (lens.length >= 2 && blob.includes(lens.slice(0, Math.min(lens.length, 8)))) {
      score += 4;
      reasons.push('切入写在单元里');
    }
    const inquirySubject = INQUIRY_SUBJECTS.some((subject) => unit.courseName.includes(subject));
    const coverageSubject = ['语文', '数学', '英语'].some((subject) => unit.courseName.includes(subject));
    if (score > 0 && inquirySubject) score += 2;
    if (score > 0 && coverageSubject) score -= 1;
    const cueText = `${lens} ${hints.join(' ')}`;
    const unitText = `${unit.unitTitle} ${unit.focus}`;
    LENS_CUES.forEach((cue) => {
      const lensHit = cue.lens.some((word) => cueText.includes(word));
      const hits = cue.unit.filter((word) => unitText.includes(word));
      if (lensHit && hits.length > 0) {
        score += 4 + Math.min(hits.length - 1, 2) * 2;
        reasons.unshift(`单元在做「${hits[0]}」`);
      }
    });
    return { unit, score, reason: reasons[0] ?? '' };
  }).sort((a, b) => {
    const scoreGap = b.score - a.score;
    if (scoreGap !== 0) return scoreGap;
    const subjectGap = subjectOrder(a.unit.courseName) - subjectOrder(b.unit.courseName);
    return subjectGap !== 0 ? subjectGap : a.unit.courseName.localeCompare(b.unit.courseName, 'zh');
  });

  const direct = ranked.filter((item) => item.score > 0).slice(0, 4);
  const chosen = direct.length > 0
    ? direct
    : ranked.filter((item) => INQUIRY_SUBJECTS.some((subject) => item.unit.courseName.includes(subject))).slice(0, 3);
  return chosen.map(({ unit, score, reason }) => ({
    courseId: unit.courseId,
    courseName: unit.courseName,
    unitId: unit.unitId,
    unitTitle: unit.unitTitle,
    grade: unit.grade,
    semester: unit.semester,
    week: unit.week,
    fit: score > 0 ? 'direct' : 'context',
    score,
    focus: unit.focus,
    reason: reason || (score > 0 ? '概念对得上' : '这一年级没有命中概念，只能当情境'),
  }));
}

export function linkUnitsForGrade(units: UnitRef[], grade: number, hints: string[], kind: SeedKind): TaskLink[] {
  const ranked = rankUnitsForGrade(units, grade, hints);
  const direct = ranked.filter((item) => item.fit === 'direct');
  const pool = direct.length > 0 ? direct : ranked;
  const limit = kind === 'capability' && direct.length === 0 ? 1 : 2;
  return pool.slice(0, limit).map((item) => ({
    courseId: item.courseId,
    courseName: item.courseName,
    unitId: item.unitId,
    unitTitle: item.unitTitle,
    grade: item.grade,
    semester: item.semester,
    week: item.week,
    fit: item.fit,
  }));
}

export function performancesForGrade(profile: SeedProfile, grade: number): [{ capabilityId: CapabilityId; text: string }, { capabilityId: CapabilityId; text: string }] {
  const primary = performanceBullets(profile.capabilityId, grade);
  const transfer = performanceBullets(profile.transferCapabilityId, grade);
  return [
    { capabilityId: profile.capabilityId, text: primary[0] ?? '' },
    { capabilityId: profile.transferCapabilityId, text: transfer[0] ?? primary[1] ?? primary[0] ?? '' },
  ];
}

export function makeGradeTasks(
  seedText: string,
  lens: LensCard,
  question: GradeQuestion,
  units: UnitRef[],
  revision = 0,
): GradeTask[] {
  return makeTasks(resolveSeed(seedText), lens, [question], units, revision);
}

export function makeTasks(
  profile: SeedProfile,
  lens: LensCard,
  questions: GradeQuestion[],
  units: UnitRef[],
  revision = 0,
): GradeTask[] {
  const tasks: GradeTask[] = [];
  questions.forEach((item) => {
    const ranked = rankUnitsForGrade(units, item.grade, [...profile.conceptHints, lens.title], lens.angle);
    const anchor = ranked[0];
    const [first, second] = performancesForGrade(profile, item.grade);
    const term = anchor?.semester === 'Semester 1' ? '上学期' : '下学期';
    const core = anchor ? unitCoreTitle(anchor.unitTitle) : '';
    tasks.push({
      id: uid('task'),
      grade: item.grade,
      step: 1,
      title: anchor ? `在「${core}」里看见` : `看见「${profile.label}」`,
      driveQuestion: anchor
        ? `在${anchor.courseName}《${core}》（${term} 第${anchor.week}周）里：${item.question}做到「${first.text}」才算完成。`
        : `${item.question}做到「${first.text}」才算完成。`,
      product: anchor
        ? `一份嵌在《${core}》里的说明：用透镜「${lens.title}」回答本质问题，并让别人看见「${first.text}」。`
        : `一份简短说明：用「${lens.title}」回答本质问题。本年级还没有可挂的单元。`,
      capabilityId: first.capabilityId,
      capabilityPerformance: first.text,
      unitLinks: anchor ? [anchor] : [],
    });
    tasks.push({
      id: uid('task'),
      grade: item.grade,
      step: 2,
      title: revision % 2 === 0 ? '迁到一件新的事上' : '换一个情境再说一遍',
      driveQuestion: anchor
        ? `离开《${core}》这个例子，把同一句理解用到一件新的事上：哪里还成立，哪里必须改？做到「${second.text}」。`
        : `把同一句理解用到一件新的事上：哪里还成立，哪里必须改？做到「${second.text}」。`,
      product: `一件给别人看的成果。成果本身要证明「${second.text}」，并写明限度。`,
      capabilityId: second.capabilityId,
      capabilityPerformance: second.text,
      unitLinks: anchor ? [anchor] : [],
    });
  });
  return tasks;
}

export function buildFullScheme(seedText: string, units: UnitRef[], revision = 0): InquiryScheme {
  const trimmed = seedText.trim();
  const { profile, lenses } = makeLenses(trimmed || '系统', revision);
  const lens = lenses[0];
  const understanding = makeUnderstanding(profile, lens, revision);
  const questions = makeQuestions(profile, revision);
  const tasks = makeTasks(profile, lens, questions, units, revision);
  return {
    id: uid('scheme'),
    title: `${profile.label} · 跨学科序列`,
    seedKind: profile.kind,
    seedText: trimmed || profile.label,
    lenses,
    selectedLensId: lens.id,
    understanding,
    questions,
    tasks,
    updatedAt: new Date().toISOString(),
    source: 'structure',
  };
}

export function rebuildFromLens(scheme: InquiryScheme, lensId: string, units: UnitRef[], revision = 0): InquiryScheme {
  const profile = resolveSeed(scheme.seedText);
  const lens = scheme.lenses.find((item) => item.id === lensId) ?? scheme.lenses[0];
  const understanding = makeUnderstanding(profile, lens, revision);
  const questions = makeQuestions(profile, revision);
  return {
    ...scheme,
    selectedLensId: lens.id,
    understanding,
    questions,
    tasks: makeTasks(profile, lens, questions, units, revision),
    updatedAt: new Date().toISOString(),
  };
}

export function rebuildTasks(scheme: InquiryScheme, units: UnitRef[], revision = 0): GradeTask[] {
  const profile = resolveSeed(scheme.seedText);
  return makeTasks(profile, selectedLens(scheme), scheme.questions, units, revision);
}

export function loadSchemes(): InquiryScheme[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InquiryScheme[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSchemes(schemes: InquiryScheme[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schemes));
}

export function upsertScheme(scheme: InquiryScheme): InquiryScheme[] {
  const next = loadSchemes().filter((item) => item.id !== scheme.id);
  next.unshift({ ...scheme, updatedAt: new Date().toISOString() });
  saveSchemes(next);
  return next;
}

export function deleteScheme(id: string): InquiryScheme[] {
  const next = loadSchemes().filter((item) => item.id !== id);
  saveSchemes(next);
  return next;
}

export function capabilityName(id: CapabilityId): string {
  return getCapability(id).zh;
}

export interface DesignDraft {
  seed: string;
  lenses: LensCard[];
  selectedLensId: string;
  understanding: string;
  questions: GradeQuestion[];
  tasks: GradeTask[];
  activeGrade: number;
  /** 理解是按哪一条透镜写成的。透镜再改，下面的内容就过时，但不删除。 */
  basisLensKey: string;
  /** 本质问题是按哪一句理解写成的。 */
  basisUnderstanding: string;
  /** 某一年老师钉住的单元 */
  pinnedUnitByGrade: Record<string, string>;
}

export function emptyDraft(seed = ''): DesignDraft {
  return {
    seed,
    lenses: [],
    selectedLensId: '',
    understanding: '',
    questions: [],
    tasks: [],
    activeGrade: 1,
    basisLensKey: '',
    basisUnderstanding: '',
    pinnedUnitByGrade: {},
  };
}

export function loadDraft(): DesignDraft {
  if (typeof localStorage === 'undefined') return emptyDraft();
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as DesignDraft;
    if (!parsed || typeof parsed !== 'object') return emptyDraft();
    return {
      ...emptyDraft(),
      ...parsed,
      lenses: parsed.lenses ?? [],
      questions: parsed.questions ?? [],
      tasks: parsed.tasks ?? [],
      pinnedUnitByGrade: parsed.pinnedUnitByGrade ?? {},
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: DesignDraft): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function allCapabilityNames(): string[] {
  return CAPABILITIES.map((item) => item.zh);
}
