/**
 * 并发安全的「只执行一次」初始化：多个请求同时触发时共用一个 in-flight Promise。
 */
export function createRunOnce(): { run: (fn: () => Promise<void>) => Promise<void> } {
  let done = false;
  let inflight: Promise<void> | null = null;

  return {
    async run(fn: () => Promise<void>): Promise<void> {
      if (done) return;
      if (inflight) {
        await inflight;
        return;
      }
      inflight = (async () => {
        await fn();
        done = true;
      })();
      try {
        await inflight;
      } catch (e) {
        done = false;
        throw e;
      } finally {
        inflight = null;
      }
    },
  };
}
