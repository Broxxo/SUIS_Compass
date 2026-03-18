/**
 * 课堂助手加减分轻反馈音（Web Audio，无需音频文件）
 */

const STORAGE_KEY = 'class-assistant-sound-enabled'

export function isFeedbackSoundEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === null) return true
    return v === 'true'
  } catch {
    return true
  }
}

export function setFeedbackSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {}
}

let audioContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch {
      return null
    }
  }
  return audioContext
}

/** 短促上扬音（加分） */
export function playAddSound(): void {
  if (!isFeedbackSoundEnabled()) return
  const ctx = getContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(400, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08)
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.12)
  } catch {}
}

/** 短促下沉音（减分） */
export function playMinusSound(): void {
  if (!isFeedbackSoundEnabled()) return
  const ctx = getContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(350, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.1)
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.14)
  } catch {}
}
