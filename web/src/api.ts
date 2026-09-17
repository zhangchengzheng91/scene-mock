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

export const api = {
  workspace: () => request<import('./types').Workspace>('/workspace'),
  bindWorkspace: (mocksRoot: string) =>
    request('/workspace', {
      method: 'PUT',
      body: JSON.stringify({ mocksRoot }),
    }),
  initWorkspace: () => request('/workspace/init', { method: 'POST', body: '{}' }),
  status: () => request<import('./types').Status>('/status'),
  apis: () => request<import('./types').ApiItem[]>('/apis'),
  createApi: (body: object) =>
    request('/apis', { method: 'POST', body: JSON.stringify(body) }),
  updateApi: (id: string, body: object) =>
    request(`/apis/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteApi: (id: string, force = false) =>
    request(`/apis/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, {
      method: 'DELETE',
    }),
  scenes: () => request<import('./types').SceneListItem[]>('/scenes'),
  scene: (id: string) =>
    request<import('./types').SceneDetail>(`/scenes/${encodeURIComponent(id)}`),
  createScene: (body: object) =>
    request('/scenes', { method: 'POST', body: JSON.stringify(body) }),
  updateScene: (id: string, body: object) =>
    request(`/scenes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteScene: (id: string) =>
    request(`/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  upsertSceneApi: (sceneId: string, apiId: string, body: object) =>
    request(
      `/scenes/${encodeURIComponent(sceneId)}/apis/${encodeURIComponent(apiId)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  removeSceneApi: (sceneId: string, apiId: string) =>
    request(
      `/scenes/${encodeURIComponent(sceneId)}/apis/${encodeURIComponent(apiId)}`,
      { method: 'DELETE' },
    ),
  copySceneApi: (sceneId: string, apiId: string, fromSceneId: string) =>
    request(
      `/scenes/${encodeURIComponent(sceneId)}/apis/${encodeURIComponent(apiId)}/copy`,
      { method: 'POST', body: JSON.stringify({ fromSceneId }) },
    ),
  duplicateSceneApi: (sceneId: string, entryId: string) =>
    request(
      `/scenes/${encodeURIComponent(sceneId)}/apis/${encodeURIComponent(entryId)}/duplicate`,
      { method: 'POST', body: '{}' },
    ),
  shareSceneApi: (sceneId: string, apiId: string, variant: string) =>
    request(
      `/scenes/${encodeURIComponent(sceneId)}/apis/${encodeURIComponent(apiId)}/share`,
      { method: 'PUT', body: JSON.stringify({ variant }) },
    ),
  setSceneProxies: (sceneId: string, enabled: boolean) =>
    request(`/scenes/${encodeURIComponent(sceneId)}/proxies`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  variants: (apiId: string) => request(`/data/${encodeURIComponent(apiId)}`),
  activate: (sceneId: string) =>
    request('/activate', { method: 'POST', body: JSON.stringify({ sceneId }) }),
  resolveActivate: (body: object) =>
    request('/activate/resolve', { method: 'POST', body: JSON.stringify(body) }),
  deactivate: (sceneId: string) =>
    request('/deactivate', { method: 'POST', body: JSON.stringify({ sceneId }) }),
  config: () => request<import('./types').AppConfig>('/config'),
  saveConfig: (body: object) =>
    request('/config', { method: 'PUT', body: JSON.stringify(body) }),
  whistleRules: () => request<{ text: string }>('/whistle-rules'),
};

export function eventsUrl() {
  return `${BASE}/events`;
}
