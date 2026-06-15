import { getDingTalkConfig, isDingTalkConfigured } from './config.js';
import { withDingTalkRateLimitRetry } from './rateLimit.js';

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function parseFeature(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || raw === '{}') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export { parseFeature };

export async function getDingTalkAccessToken(): Promise<string> {
  if (!isDingTalkConfigured()) {
    throw new Error('DingTalk credentials not configured (DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET)');
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.token;
  }

  const { clientId, clientSecret } = getDingTalkConfig();
  const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    accessToken?: string;
    expireIn?: number;
    message?: string;
    code?: string;
  };

  if (!response.ok || !data.accessToken) {
    const detail = data.message || data.code || response.statusText;
    throw new Error(`Failed to obtain DingTalk accessToken: ${detail}`);
  }

  const ttlSec = typeof data.expireIn === 'number' && data.expireIn > 0 ? data.expireIn : 7200;
  tokenCache = {
    token: data.accessToken,
    expiresAtMs: now + ttlSec * 1000,
  };
  return data.accessToken;
}

export async function dingTalkTopApiPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  return withDingTalkRateLimitRetry(async () => {
    const token = await getDingTalkAccessToken();
    const url = `https://oapi.dingtalk.com${path}?access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json().catch(() => ({}))) as T & {
      errcode?: number;
      errmsg?: string;
    };

    if (!response.ok) {
      throw new Error(`DingTalk API HTTP ${response.status}: ${path}`);
    }

    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      throw new Error(`DingTalk API ${path}: [${data.errcode}] ${data.errmsg ?? 'unknown error'}`);
    }

    return data;
  });
}
