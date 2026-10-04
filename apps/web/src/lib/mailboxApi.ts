import { getCurrentUserId, getToken } from './authUtils';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string) ?? '';

function getHeaders(): HeadersInit {
  const token = getToken();
  const userId = getCurrentUserId();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : import.meta.env.DEV && userId ? { 'X-User-Id': userId } : {}),
  };
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE_URL.replace(/\/$/, '');
  if (!base) return normalizedPath;
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) return `${base.slice(0, -4)}${normalizedPath}`;
  return `${base}${normalizedPath}`;
}

export type MailboxStatus = 'open' | 'done';

export type MailboxReply = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  own: boolean;
  fromAdmin: boolean;
};

export type MailboxMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorRole: string;
  status: MailboxStatus;
  own: boolean;
  replies: MailboxReply[];
};

export type MailboxBoard = {
  viewerIsAdmin: boolean;
  messages: MailboxMessage[];
};

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || 'internal';
  } catch {
    return 'internal';
  }
}

export async function fetchMailbox(): Promise<MailboxBoard> {
  const response = await fetch(apiUrl('/api/mailbox'), { headers: getHeaders() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<MailboxBoard>;
}

export async function createMailboxMessage(body: string): Promise<MailboxMessage> {
  const response = await fetch(apiUrl('/api/mailbox'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<MailboxMessage>;
}

export async function updateMailboxMessage(messageId: string, body: string): Promise<{ id: string; body: string }> {
  const response = await fetch(apiUrl(`/api/mailbox/${encodeURIComponent(messageId)}`), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<{ id: string; body: string }>;
}

export async function deleteMailboxMessage(messageId: string): Promise<{ id: string }> {
  const response = await fetch(apiUrl(`/api/mailbox/${encodeURIComponent(messageId)}`), {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<{ id: string }>;
}

export async function replyToMailboxMessage(messageId: string, body: string): Promise<MailboxReply> {
  const response = await fetch(apiUrl(`/api/mailbox/${encodeURIComponent(messageId)}/replies`), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<MailboxReply>;
}

export async function setMailboxStatus(messageId: string, status: MailboxStatus): Promise<{ id: string; status: MailboxStatus }> {
  const response = await fetch(apiUrl(`/api/mailbox/${encodeURIComponent(messageId)}/status`), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<{ id: string; status: MailboxStatus }>;
}
