export const TEACHER_PORTRAIT_COLLECTION_TYPES = {
  'teaching-diagnosis-kiss': {
    id: 'teaching-diagnosis-kiss',
    labelZh: '阶段教学诊断',
    labelEn: 'Phase teaching diagnosis (KISS)',
  },
  'custom-form': {
    id: 'custom-form',
    labelZh: '自定义收集',
    labelEn: 'Custom collection',
  },
} as const;

/** 一份收集任务里的题目。没有这份结构的旧任务，按单独一块 KISS 处理。 */
export type TeacherCollectionBlock =
  | { id: string; kind: 'kiss' }
  | { id: string; kind: 'text'; label: string };

const TEACHER_COLLECTION_BLOCK_ID = /^[a-zA-Z0-9_-]{1,40}$/;

export function parseTeacherCollectionBlocks(raw: unknown): TeacherCollectionBlock[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return null;
  const blocks: TeacherCollectionBlock[] = [];
  const ids = new Set<string>();
  let kissCount = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!TEACHER_COLLECTION_BLOCK_ID.test(id) || ids.has(id)) return null;
    ids.add(id);
    if (rec.kind === 'kiss') {
      kissCount += 1;
      if (kissCount > 1) return null;
      blocks.push({ id, kind: 'kiss' });
      continue;
    }
    if (rec.kind === 'text') {
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      if (!label || label.length > 80) return null;
      blocks.push({ id, kind: 'text', label });
      continue;
    }
    return null;
  }
  return blocks;
}

export function collectionTypeForBlocks(
  blocks: TeacherCollectionBlock[],
): 'teaching-diagnosis-kiss' | 'custom-form' {
  return blocks.length === 1 && blocks[0]?.kind === 'kiss' ? 'teaching-diagnosis-kiss' : 'custom-form';
}

/** 旧任务（没有题目结构）视为包含 KISS。 */
export function templateIncludesKiss(input: {
  formBlocks?: TeacherCollectionBlock[] | null;
  collectionType?: string | null;
}): boolean {
  if (input.formBlocks && input.formBlocks.length > 0) {
    return input.formBlocks.some((block) => block.kind === 'kiss');
  }
  return input.collectionType !== 'custom-form';
}

export type TeacherPortraitCollectionType = keyof typeof TEACHER_PORTRAIT_COLLECTION_TYPES;

export function teacherPortraitCollectionTypeLabel(
  type: TeacherPortraitCollectionType,
  isZh: boolean,
): string {
  const def = TEACHER_PORTRAIT_COLLECTION_TYPES[type];
  return isZh ? def.labelZh : def.labelEn;
}
