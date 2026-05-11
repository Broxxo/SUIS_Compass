import type { TargetLevel } from '../types/classManagement';

/** 学年学科目标预设：全学科共用的 A–D 等第说明默认值 */
export const REPORT_PRESET_UNIFIED_LEVEL_DEFAULTS: Record<TargetLevel, string> = {
  A: '超越期望，游刃有余：深度掌握目标，具备自主探究意识。能将知识与技能迁移至新情境，创造性地解决问题。',
  B: '达成期望，稳步前行：有效达成目标，具备独立学习能力。能稳定运用所学，展现良好的应用基础。',
  C: '接近期望，尚需巩固：基本掌握目标，尚需提示引导。在适当帮助下，能够完成相关学习任务。',
  D: '未达期望，需要干预：尚未掌握目标，面临学习挑战。独立完成任务存在困难，需要持续的个性化干预与支持。',
};

export function fullUnifiedLevelTextFromPreset(
  raw?: Partial<Record<TargetLevel, string>> | null,
): Record<TargetLevel, string> {
  const out: Record<TargetLevel, string> = { ...REPORT_PRESET_UNIFIED_LEVEL_DEFAULTS };
  for (const lv of ['A', 'B', 'C', 'D'] as const) {
    const t = String(raw?.[lv] ?? '').trim();
    if (t) out[lv] = t;
  }
  return out;
}

export function unifiedLevelToApiPayload(u: Record<TargetLevel, string>): Partial<Record<TargetLevel, string>> {
  const o: Partial<Record<TargetLevel, string>> = {};
  for (const lv of ['A', 'B', 'C', 'D'] as const) {
    const t = (u[lv] ?? '').trim();
    if (t) o[lv] = t;
  }
  return o;
}
