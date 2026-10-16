import { ApiError } from './types';

const BASE = './cgi-bin';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      error: data?.error || 'error',
      message: data?.message || res.statusText,
      details: data?.details ?? data,
    };
    throw err;
  }
  return data as T;
}

const enc = encodeURIComponent;
const proj = (pid: string) => `/projects/${enc(pid)}`;

export const api = {
  // ── 工作区与全局 ──
  workspace: () => request<import('./types').Workspace>('/workspace'),
  bindWorkspace: (mocksRoot: string) =>
    request('/workspace', {
      method: 'PUT',
      body: JSON.stringify({ mocksRoot }),
    }),
  initWorkspace: () => request('/workspace/init', { method: 'POST', body: '{}' }),
  status: () => request<import('./types').Status>('/status'),
  config: () => request<import('./types').GlobalConfig>('/config'),
  saveConfig: (body: object) =>
    request('/config', { method: 'PUT', body: JSON.stringify(body) }),
  whistleRules: () => request<{ text: string }>('/whistle-rules'),

  // ── 项目 ──
  projects: () => request<import('./types').ProjectSummary[]>('/projects'),
  project: (pid: string) =>
    request<import('./types').ProjectDetail>(proj(pid)),
  createProject: (body: object) =>
    request<import('./types').ProjectDetail>('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProject: (pid: string, body: object) =>
    request<import('./types').ProjectDetail>(proj(pid), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProject: (pid: string, confirm = false) =>
    request<{ ok: true; removed: { scenes: number; apis: number; variants: number } }>(
      `${proj(pid)}${confirm ? '?confirm=1' : ''}`,
      { method: 'DELETE' },
    ),

  // ── 接口池（项目内） ──
  apis: (pid: string) => request<import('./types').ApiItem[]>(`${proj(pid)}/apis`),
  createApi: (pid: string, body: object) =>
    request(`${proj(pid)}/apis`, { method: 'POST', body: JSON.stringify(body) }),
  updateApi: (pid: string, id: string, body: object) =>
    request(`${proj(pid)}/apis/${enc(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteApi: (pid: string, id: string, force = false) =>
    request(`${proj(pid)}/apis/${enc(id)}${force ? '?force=1' : ''}`, {
      method: 'DELETE',
    }),

  // ── Scene（项目内） ──
  scenes: (pid: string) =>
    request<import('./types').SceneListItem[]>(`${proj(pid)}/scenes`),
  scene: (pid: string, id: string) =>
    request<import('./types').SceneDetail>(`${proj(pid)}/scenes/${enc(id)}`),
  createScene: (pid: string, body: object) =>
    request(`${proj(pid)}/scenes`, { method: 'POST', body: JSON.stringify(body) }),
  updateScene: (pid: string, id: string, body: object) =>
    request(`${proj(pid)}/scenes/${enc(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteScene: (pid: string, id: string) =>
    request(`${proj(pid)}/scenes/${enc(id)}`, { method: 'DELETE' }),
  upsertSceneApi: (pid: string, sceneId: string, apiId: string, body: object) =>
    request(
      `${proj(pid)}/scenes/${enc(sceneId)}/apis/${enc(apiId)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  removeSceneApi: (pid: string, sceneId: string, apiId: string) =>
    request(
      `${proj(pid)}/scenes/${enc(sceneId)}/apis/${enc(apiId)}`,
      { method: 'DELETE' },
    ),
  duplicateSceneApi: (pid: string, sceneId: string, entryId: string) =>
    request(
      `${proj(pid)}/scenes/${enc(sceneId)}/apis/${enc(entryId)}/duplicate`,
      { method: 'POST', body: '{}' },
    ),
  shareSceneApi: (pid: string, sceneId: string, apiId: string, variant: string) =>
    request(
      `${proj(pid)}/scenes/${enc(sceneId)}/apis/${enc(apiId)}/share`,
      { method: 'PUT', body: JSON.stringify({ variant }) },
    ),
  setSceneProxies: (pid: string, sceneId: string, enabled: boolean) =>
    request(`${proj(pid)}/scenes/${enc(sceneId)}/proxies`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  variants: (pid: string, apiId: string) =>
    request<any[]>(`${proj(pid)}/data/${enc(apiId)}`),
  activate: (pid: string, sceneId: string) =>
    request(`${proj(pid)}/activate`, {
      method: 'POST',
      body: JSON.stringify({ sceneId }),
    }),
  resolveActivate: (pid: string, body: object) =>
    request(`${proj(pid)}/activate/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deactivate: (pid: string, sceneId: string) =>
    request(`${proj(pid)}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ sceneId }),
    }),
};

export function eventsUrl() {
  return `${BASE}/events`;
}
