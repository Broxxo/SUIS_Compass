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
    id: 'glm-5.3',
    name: 'GLM 5.3',
    code: 'zai-org/GLM-5.3',
    description: '智谱 AI 通用模型',
    kind: 'chat',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    code: 'deepseek-ai/DeepSeek-V4-Flash',
    description: 'DeepSeek V4 快速对话模型',
    kind: 'chat',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    code: 'deepseek-ai/DeepSeek-V4-Pro',
    description: 'DeepSeek V4 增强对话模型',
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

export const DEFAULT_MODEL_ID = 'deepseek-v4-flash';

const LEGACY_MODEL_ID_MAP: Record<string, string> = {
  'glm-4.7': 'glm-5.3',
  'glm-5': 'glm-5.3',
  'glm-5.1': 'glm-5.3',
  'kimi-k25': DEFAULT_MODEL_ID,
  'kimi-k2-thinking': DEFAULT_MODEL_ID,
  'kimi-k26': DEFAULT_MODEL_ID,
  'deepseek-r1': DEFAULT_MODEL_ID,
};

// 从localStorage获取保存的模型ID（兼容旧版选型）
export function getSavedModelId(): string {
  try {
    let saved = localStorage.getItem('ai-model-selection');
    if (saved && LEGACY_MODEL_ID_MAP[saved]) saved = LEGACY_MODEL_ID_MAP[saved];
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
  const resolvedId = LEGACY_MODEL_ID_MAP[modelId] ?? modelId;
  const model = AI_MODELS.find(m => m.id === resolvedId);
  return model?.code || AI_MODELS.find(m => m.id === DEFAULT_MODEL_ID)!.code;
}
