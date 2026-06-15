import type { DingTalkPreviewData } from '../types/dingtalk';

const STORAGE_KEY = 'suis_compass_dingtalk_preview_v1';

export function loadDingTalkPreviewFromStorage(): DingTalkPreviewData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DingTalkPreviewData;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDingTalkPreviewToStorage(data: DingTalkPreviewData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota or private mode — ignore
  }
}

export function clearDingTalkPreviewStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
