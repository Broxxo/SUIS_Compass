// AI模型配置
export type AIModelKind = 'chat' | 'image';

export interface AIModel {
  id: string;
  name: string;
  code: string;
  description?: string;
  /** 用于区分对话模型和生图模型，默认 chat */
  kind?: AIModelKind;
}

export const AI_MODELS: AIModel[] = [
  {
    id: 'kimi-k25',
    name: 'Kimi K2.5',
    code: 'Pro/moonshotai/Kimi-K2.5',
    description: 'Kimi 新一代通用对话模型',
    kind: 'chat',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    code: 'Pro/deepseek-ai/DeepSeek-R1',
    description: 'DeepSeek 推理模型（含思考过程）',
    kind: 'chat',
  },
  {
    id: 'glm-5',
    name: 'GLM 5',
    code: 'Pro/zai-org/GLM-5',
    description: '智谱 AI 通用模型',
    kind: 'chat',
  },
  {
    id: 'kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    code: 'moonshotai/Kimi-K2-Thinking',
    description: 'Kimi 推理模型（Thinking 版本）',
    kind: 'chat',
  },
  {
    id: 'qwen-image-edit',
    name: 'Qwen Image Edit',
    code: 'Qwen/Qwen-Image-Edit-2509',
    description: 'Qwen 图像编辑 / 生图模型',
    kind: 'image',
  },
];

export const DEFAULT_MODEL_ID = 'kimi-k25';

// 从localStorage获取保存的模型ID（兼容旧版 glm-4.7 -> glm-5）
export function getSavedModelId(): string {
  try {
    let saved = localStorage.getItem('ai-model-selection');
    if (saved === 'glm-4.7') saved = 'glm-5';
    if (saved && AI_MODELS.find(m => m.id === saved)) {
      return saved;
    }
  } catch (e) {
    console.error('Failed to load saved model:', e);
  }
  return DEFAULT_MODEL_ID;
}

// 保存模型ID到localStorage
export function saveModelId(modelId: string): void {
  try {
    localStorage.setItem('ai-model-selection', modelId);
  } catch (e) {
    console.error('Failed to save model selection:', e);
  }
}

// 根据ID获取模型代码
export function getModelCode(modelId: string): string {
  const model = AI_MODELS.find(m => m.id === modelId);
  return model?.code || AI_MODELS.find(m => m.id === DEFAULT_MODEL_ID)!.code;
}
