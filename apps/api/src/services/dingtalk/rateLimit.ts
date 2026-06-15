/** 钉钉 OpenAPI 调用节流：同一应用默认约 20 次/秒，保守间隔 200ms（≈5 QPS） */
const MIN_INTERVAL_MS = Math.max(
  50,
  Number(process.env.DINGTALK_API_MIN_INTERVAL_MS) || 200,
);

let lastCallAt = 0;
let scheduleChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimitSlot(): Promise<void> {
  scheduleChain = scheduleChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - now);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  await scheduleChain;
}

/** 从 errcode 88 / subcode 90018 文案中解析「限制将在 … 结束」时间 */
export function parseDingTalkRateLimitWaitMs(message: string): number | null {
  const match = message.match(/限制将在\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*结束/);
  if (!match) return null;
  const endMs = new Date(match[1].replace(' ', 'T')).getTime();
  if (Number.isNaN(endMs)) return null;
  return Math.max(0, endMs - Date.now()) + 300;
}

export function isDingTalkRateLimitError(message: string): boolean {
  return message.includes('[88]')
    || message.includes('90018')
    || message.includes('qps流控')
    || message.includes('次数过多');
}

export async function withDingTalkRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 8,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await waitForRateLimitSlot();
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!isDingTalkRateLimitError(msg) || attempt >= maxAttempts - 1) {
        throw e;
      }
      const parsed = parseDingTalkRateLimitWaitMs(msg);
      const backoff = parsed ?? Math.min(15_000, 800 * (attempt + 1));
      await sleep(backoff);
    }
  }
  throw lastError;
}
