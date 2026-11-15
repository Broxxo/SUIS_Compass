/**
 * 课程河流 2.0 的能力线。
 *
 * 框架采用 Cambridge Lower Secondary Global Perspectives (1129) 的六项技能：
 * 探究 Research、分析 Analysis、评价 Evaluation、反思 Reflection、合作 Collaboration、沟通 Communication。
 * G7–G9 的表现按该框架 Stage 7/8 与 Stage 9 的学习目标写成中文，供学校使用，不是剑桥原文的逐句照搬。
 * G1–G6 沿同一技能结构向下延伸：剑桥小学阶段与中国年级不是一一对应，国家课程也没有这张跨学科年级表。
 * 「自我管理」不单列。剑桥把它放在反思里：个人贡献、个人学习、改进目标。设计板输入「自我管理」时走反思。
 */

export type CapabilityId =
  | 'research'
  | 'analysis'
  | 'evaluation'
  | 'reflection'
  | 'collaboration'
  | 'communication';

export interface CapabilityDef {
  id: CapabilityId;
  zh: string;
  en: string;
  /** 这项技能在剑桥框架里的分项 */
  strands: string;
  conceptHints: string[];
  /** 也可被识别成这项能力的说法 */
  aliases: string[];
  summary: string;
  grades: Record<number, string[]>;
}

const g = (rows: string[][]): Record<number, string[]> => {
  const out: Record<number, string[]> = {};
  rows.forEach((bullets, index) => {
    out[index + 1] = bullets;
  });
  return out;
};

export const CAPABILITY_SOURCE =
  'Cambridge Lower Secondary Global Perspectives 1129。G7–G9 对应 Stage 7/8 与 Stage 9 的学习目标；G1–G6 按同一六项技能向下延伸。';

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'research',
    zh: '探究',
    en: 'Research',
    strands: '提出研究问题 · 信息技能 · 开展探究 · 记录发现',
    conceptHints: ['形式', '变化', '关联', 'Form', 'Change', 'Connections'],
    aliases: ['探究', '研究', 'research'],
    summary: '能提出值得追的问题，选择来源和方法，并把发现记下来。',
    grades: g([
      ['能对着身边一件事提出「这是什么」。', '能说出这是自己看到的，还是别人告诉的。'],
      ['能提出一个可以用眼睛或手回答的问题。', '能用图画或一句话记下看到的。'],
      ['能提出一个问题，并找到一处答案。', '能说出答案从哪来：书、人，还是自己的观察。'],
      ['能把一个大问题改成一个更小、可以去查的问题。', '能用清单记下两条信息，并标出出处。'],
      ['能提出两个相关问题，并选出先查哪一个。', '能从两种资料里抄下和问题有关的句子，注明出处。'],
      ['能写出一个可以检验的预测，并选一种办法去看它是否成立。', '能把找到的信息分成「有用」和「先放下」。'],
      ['能提出与议题相关的研究问题。', '能找到多种印刷或多媒体来源，开始注明出处，并用它们定位信息。', '能选择一种合适的方法开展探究，检验预测。', '能挑选、整理并记录来自不同来源的信息。'],
      ['能提出不止一个研究问题，并说明为什么先追其中一个。', '能比较两种来源，开始判断哪一个更贴着问题。', '能组织记录，让别人看得出哪条信息回答了哪个问题。'],
      ['能提出一组相关研究问题，并选出最值得追的一个。', '能准确注明多种来源，并用它们回答研究问题。', '能选择最合适的方法检验预测、回答问题，并说明为什么用这种方法。', '能从广泛来源中挑选、整理并有效记录信息。'],
    ]),
  },
  {
    id: 'analysis',
    zh: '分析',
    en: 'Analysis',
    strands: '识别视角 · 解读数据 · 建立联系 · 解决问题',
    conceptHints: ['视角', '创造力', '系统', '关系', 'Perspective', 'Creativity', 'Systems', 'Relationships'],
    aliases: ['分析', 'analysis'],
    summary: '能看出不同立场和证据，解释因果，并提出可以说出理由的行动。',
    grades: g([
      ['能说出一件事里的两个部分。', '能听出一个和自己不一样的说法。'],
      ['能指出「谁」和「发生了什么」。', '能用自己的话复述别人的一个想法。'],
      ['能说出两个看法哪里不同。', '能说出一件事可能带来的一个结果。'],
      ['能从一段话或一张图里找出一个证据。', '能用「因为…所以…」说出一个原因。'],
      ['能把两种资料里的想法分开摆出来。', '能说出一个本地问题怎样影响到另一个人。'],
      ['能解释一张简单图表支持了什么说法。', '能提出一个行动，并说出它想改变什么。'],
      ['能在不同来源里识别不同视角的想法和证据。', '能解释图表或数字怎样支持一个论点。', '能说明一个本地或全球议题的原因，以及对他人的后果。', '能提出并说明不同行动如何带来积极改变。'],
      ['能比较两种视角各自依赖的证据。', '能从数据里指出一个趋势，并说它支持或削弱了哪个论点。'],
      ['能综合多种来源中的论点和证据，而不是只并列。', '能识别图表或数字中的模式和趋势，用来支持论点。', '能把原因和后果连到个人、本地和全球三个层面。', '能建议一条行动路线，并说明它可能带来的后果。'],
    ]),
  },
  {
    id: 'evaluation',
    zh: '评价',
    en: 'Evaluation',
    strands: '评价来源 · 评价论证',
    conceptHints: ['逻辑', '视角', 'Logic', 'Perspective'],
    aliases: ['评价', '评估', 'evaluation'],
    summary: '能看来源是谁写的、想干什么，并讨论论证是否站得住。',
    grades: g([
      ['能说出这句话是谁说的。', '能说出自己信或不信的一个理由。'],
      ['能区分「故事」和「说明」。', '能指出一张图里自己看不懂的地方。'],
      ['能问：这个人为什么要这样说？', '能说出一个说法里缺少的证据。'],
      ['能比较两个说法，指出哪一个给了例子。', '能说出「我觉得」和「资料上写」的差别。'],
      ['能根据作者是谁，猜测他可能偏向哪一边。', '能指出一个论证里跳过去的一步。'],
      ['能说明一个来源适合回答哪类问题、不适合回答哪类。', '能讨论一个说法说服人的地方和薄弱的地方。'],
      ['能评价来源：考虑作者和目的，并认出其中可能的偏向。', '能讨论一个来源是否有效，并明确说到它怎样展开论证。'],
      ['能说明一个来源的偏向会怎样改变读者的结论。', '能指出论证里使用的一种手法，例如只举有利的例子。'],
      ['能评价一组来源：作者、目的、是否被其他来源支持，并解释为什么有的来源有偏向。', '能评价论证的推理，包括它的结构和所用手法。'],
    ]),
  },
  {
    id: 'reflection',
    zh: '反思',
    en: 'Reflection',
    strands: '个人贡献 · 团队合作 · 个人观点 · 个人学习',
    conceptHints: ['发展', '身份认同', 'Development', 'Identity'],
    aliases: ['反思', 'reflection', '自我管理', '自我管理能力', 'self-management', 'self management'],
    summary: '能回头看自己的贡献、观点和学习过程，并定出下一步改进。剑桥不单列自我管理，计划、坚持和调整写在这里。',
    grades: g([
      ['能说出自己刚才做了哪一小步。', '能在提醒下完成下一步，并告诉别人做完了。'],
      ['能按一张两项清单做完事情。', '能说出今天哪一件做得比较好。'],
      ['能把自己的任务分成两步，并勾出完成的。', '能说出小组里自己做了什么。'],
      ['能估计一件事大概要多久，超时后说出原因。', '能说出自己的看法有没有变过一点点。'],
      ['能为一周的小任务排顺序，结束时检查漏了什么。', '能说出合作里一件顺利的事和一件困难的事。'],
      ['能在卡住时说出卡在哪里，并选一个继续的办法。', '能指出这次活动里自己新会的一项本领。'],
      ['能说明自己在团队合作中的贡献，并找出一个改进目标。', '能考虑合作完成一件事时的好处和困难。', '能考虑自己对议题的看法是否因为探究或听到别的视角而改变。', '能指出活动中学会或变好的技能，并连到自己的长处和待改进处。'],
      ['能对照自己的计划，保留有效的做法、停掉无效的。', '能写出一个具体的改进目标，而不是「下次更好」。'],
      ['能把个人贡献连到自己的长处和待改进处。', '能把合作的好处和困难连到自己的经历，并定出改进目标。', '能解释自己的观点如何因为探究和不同视角而改变。', '能指出已提高的技能，并考虑下一步怎样继续发展。'],
    ]),
  },
  {
    id: 'collaboration',
    zh: '合作',
    en: 'Collaboration',
    strands: '分工与相互依赖 · 参与团队',
    conceptHints: ['社区', '关系', 'Communities', 'Relationships'],
    aliases: ['合作', 'collaboration', '协作'],
    summary: '能公平分工，提出有用的想法，并在分歧里把团队拉回共同目标。',
    grades: g([
      ['能轮流说话，不抢走别人的材料。', '能完成分给自己的一小步。'],
      ['能和另一个人一起完成必须两个人才做得成的事。', '能把工具递给需要的人。'],
      ['能和同伴商量谁做什么。', '能说出自己的那一份贡献。'],
      ['不同意时能说出理由，而不是退出。', '能按约好的时间做完自己的部分。'],
      ['能按每个人会做什么来分任务。', '能邀请还没说话的人说一句。'],
      ['能在计划赶不上时，和同伴改一次分工。', '能用一件具体的事帮助小组往前走，而不是只说「加油」。'],
      ['团队能考虑成员的本领和可用时间，公平分工，一起完成共同目标。', '成员能提出有用的想法，并在需要时积极处理冲突、解决问题、鼓励他人参加。'],
      ['能说明为什么这样分工，而不是只按座位分。', '冲突出现时，能先把问题说清楚，再决定改任务还是改做法。'],
      ['团队能给出分工的理由，并在需要时灵活调整，彼此补位以完成共同目标。', '成员能提出有用想法，敏感而积极地处理冲突和问题，并支持他人参与。'],
    ]),
  },
  {
    id: 'communication',
    zh: '沟通',
    en: 'Communication',
    strands: '表达信息 · 倾听并回应',
    conceptHints: ['交流', '形式', 'Communication', 'Form'],
    aliases: ['沟通', '交流', 'communication'],
    summary: '能把信息和论证说清楚，也能听进去并给出推进讨论的回应。',
    grades: g([
      ['能把一件事说完整：谁、做什么、结果怎样。', '能看着说话的人，听完再开口。'],
      ['能用一幅图加一句话让别人看懂。', '能重复同伴刚才说的一个词，表示自己听到了。'],
      ['能按顺序讲清一个做法的两步。', '能对同伴的想法说一句相关的话，而不是另起话题。'],
      ['能用口头和图各讲一次同一个意思。', '听完后能问一个听懂了才会问的问题。'],
      ['能对着同学讲清一个想法，并举起一个例子。', '能根据对方是同伴还是低年级，换一种说法。'],
      ['能在说明里标出哪一句来自资料。', '能在讨论里接住上一句，而不是只等着说自己的。'],
      ['能清楚呈现信息和论证，带一些推理，并在使用来源时注明。', '能倾听信息和想法，给出相关、有判断的回应，表明自己理解了议题。'],
      ['能按「观点—理由—例子」讲一段话。', '回应时能先说出自己听到的观点，再补充或质疑。'],
      ['能呈现连贯、有推理、结构清楚的论证，并详细注明来源。', '能倾听并提出有判断的贡献，推动讨论、加深对议题的理解。'],
    ]),
  },
];

export const CAPABILITY_GRADE_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function getCapability(id: CapabilityId): CapabilityDef {
  const found = CAPABILITIES.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown capability ${id}`);
  return found;
}

export function performanceBullets(id: CapabilityId, grade: number): string[] {
  const cap = getCapability(id);
  return cap.grades[grade] ?? cap.grades[9];
}

export function performanceAt(id: CapabilityId, grade: number): string {
  return performanceBullets(id, grade).join('');
}

export function matchCapabilityByName(text: string): CapabilityDef | undefined {
  const raw = text.trim().toLowerCase();
  if (!raw) return undefined;
  return CAPABILITIES.find((item) => {
    const names = [item.zh, item.en, item.id, ...item.aliases].map((name) => name.toLowerCase());
    return names.some((name) => raw === name || raw.includes(name));
  });
}
