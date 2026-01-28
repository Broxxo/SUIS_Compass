// AI模型配置
export interface AIModel {
  id: string;
  name: string;
  code: string;
  description?: string;
}

export const AI_MODELS: AIModel[] = [
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    code: 'deepseek-ai/DeepSeek-V3.2',
    description: '强大的推理能力，适合复杂任务'
  },
  {
    id: 'glm-4.7',
    name: 'GLM 4.7',
    code: 'Pro/zai-org/GLM-4.7',
    description: '智谱AI最新模型，性能优异'
  },
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    code: 'moonshotai/Kimi-K2-Thinking',
    description: '支持联网搜索，长文本处理'
  }
];

export const DEFAULT_MODEL_ID = 'kimi-k2';

// 从localStorage获取保存的模型ID
export function getSavedModelId(): string {
  try {
    const saved = localStorage.getItem('ai-model-selection');
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
