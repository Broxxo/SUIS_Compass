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

export type ProjectStatus = 'active' | 'done' | 'paused';

export type ProjectPerson = { id: string; name: string };

export type SchoolProjectItem = {
  id: string;
  projectId: string;
  groupLabel: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  owners: ProjectPerson[];
  sortOrder: number;
};

export type SchoolProject = {
  id: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  lead: ProjectPerson | null;
  participants: ProjectPerson[];
  canEditProject: boolean;
  canEditItems: boolean;
  sortOrder: number;
  items: SchoolProjectItem[];
};

export type ProjectDraft = {
  title: string;
  summary: string;
  groupLabel?: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  ownerIds: string[];
  participantIds: string[];
};

export type ProjectBoard = {
  projects: SchoolProject[];
  staff: ProjectPerson[];
};

async function readJson(response: Response): Promise<ProjectBoard & { error?: string }> {
  const data = (await response.json().catch(() => ({}))) as ProjectBoard & { error?: string };
  if (!response.ok) throw new Error(data.error || `request failed (${response.status})`);
  return data;
}

export async function fetchProjectBoard(): Promise<ProjectBoard> {
  const response = await fetch(apiUrl('/api/projects'), { headers: getHeaders() });
  const data = await readJson(response);
  return { projects: data.projects ?? [], staff: data.staff ?? [] };
}

function payload(draft: ProjectDraft) {
  return {
    title: draft.title,
    summary: draft.summary,
    groupLabel: draft.groupLabel ?? '',
    status: draft.status,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    ownerIds: draft.ownerIds,
    participantIds: draft.participantIds,
  };
}

export async function createProject(draft: ProjectDraft): Promise<SchoolProject[]> {
  const response = await fetch(apiUrl('/api/projects'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload(draft)),
  });
  return (await readJson(response)).projects ?? [];
}

export async function updateProject(projectId: string, draft: ProjectDraft): Promise<SchoolProject[]> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(payload(draft)),
  });
  return (await readJson(response)).projects ?? [];
}

export async function deleteProject(projectId: string): Promise<SchoolProject[]> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return (await readJson(response)).projects ?? [];
}

export async function createProjectItem(projectId: string, draft: ProjectDraft): Promise<SchoolProject[]> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/items`), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload(draft)),
  });
  return (await readJson(response)).projects ?? [];
}

export async function updateProjectItem(projectId: string, itemId: string, draft: ProjectDraft): Promise<SchoolProject[]> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`), {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(payload(draft)),
  });
  return (await readJson(response)).projects ?? [];
}

export async function claimProjectItem(projectId: string, itemId: string): Promise<SchoolProject[]> {
  const response = await fetch(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/claim`),
    { method: 'POST', headers: getHeaders() },
  );
  return (await readJson(response)).projects ?? [];
}

export async function deleteProjectItem(projectId: string, itemId: string): Promise<SchoolProject[]> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`), {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return (await readJson(response)).projects ?? [];
}
