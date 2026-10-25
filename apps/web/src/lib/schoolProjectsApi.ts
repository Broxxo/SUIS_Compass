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
export type ProjectVisibility = 'all' | 'members';

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
  visibility: ProjectVisibility;
  startDate: string | null;
  endDate: string | null;
  leads: ProjectPerson[];
  participants: ProjectPerson[];
  canEditProject: boolean;
  canManageLeads: boolean;
  canEditItems: boolean;
  sortOrder: number;
  items: SchoolProjectItem[];
};

export type ProjectDraft = {
  title: string;
  summary: string;
  groupLabel?: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  startDate: string;
  endDate: string;
  leadIds: string[];
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
    visibility: draft.visibility,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    leadIds: draft.leadIds,
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

export type ProjectPreviewAsset = {
  id: string;
  moduleKey: string;
  entityId: string;
  kind: 'text' | 'pdf';
  title: string;
  bodyText: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  createdAt: string | null;
};

export type ProjectPreviewBoard = {
  assets: ProjectPreviewAsset[];
  canEdit: boolean;
};

async function readPreviewJson(response: Response): Promise<ProjectPreviewBoard & { error?: string; asset?: ProjectPreviewAsset }> {
  const data = (await response.json().catch(() => ({}))) as ProjectPreviewBoard & {
    error?: string;
    asset?: ProjectPreviewAsset;
  };
  if (!response.ok) throw new Error(data.error || `request failed (${response.status})`);
  return data;
}

export async function fetchProjectPreview(projectId: string): Promise<ProjectPreviewBoard> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/preview`), {
    headers: getHeaders(),
  });
  const data = await readPreviewJson(response);
  return { assets: data.assets ?? [], canEdit: Boolean(data.canEdit) };
}

export async function createProjectPreviewText(
  projectId: string,
  input: { title: string; bodyText: string },
): Promise<ProjectPreviewAsset[]> {
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/preview/text`), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  return (await readPreviewJson(response)).assets ?? [];
}

export async function updateProjectPreviewText(
  projectId: string,
  assetId: string,
  input: { title: string; bodyText: string },
): Promise<ProjectPreviewAsset[]> {
  const response = await fetch(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(assetId)}`),
    {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(input),
    },
  );
  return (await readPreviewJson(response)).assets ?? [];
}

export async function uploadProjectPreviewPdf(projectId: string, file: File, title?: string): Promise<ProjectPreviewAsset[]> {
  const token = getToken();
  const userId = getCurrentUserId();
  const form = new FormData();
  form.append('file', file);
  if (title?.trim()) form.append('title', title.trim());
  const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/preview/pdf`), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : import.meta.env.DEV && userId ? { 'X-User-Id': userId } : {}),
    },
    body: form,
  });
  return (await readPreviewJson(response)).assets ?? [];
}

export async function deleteProjectPreviewAsset(projectId: string, assetId: string): Promise<ProjectPreviewAsset[]> {
  const response = await fetch(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(assetId)}`),
    { method: 'DELETE', headers: getHeaders() },
  );
  return (await readPreviewJson(response)).assets ?? [];
}

export function projectPreviewFileUrl(projectId: string, assetId: string): string {
  return apiUrl(`/api/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(assetId)}/file`);
}

export async function fetchAuthedArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) throw new Error(`open failed (${response.status})`);
  return response.arrayBuffer();
}

export async function openAuthedFile(url: string, fallbackName = 'document.pdf'): Promise<void> {
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) throw new Error(`open failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const win = window.open(objectUrl, '_blank', 'noopener,noreferrer');
  if (!win) {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fallbackName;
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function downloadAuthedFile(url: string, filename = 'document.pdf'): Promise<void> {
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
