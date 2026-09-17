export type HttpMethod = string;

export interface ApiDef {
  id: string;
  method: string;
  url: string;
  desc?: string;
}

export interface SceneApiEntry {
  /** 接口池 id；缺省等于 Scene.apis 的 key */
  apiId?: string;
  status?: number;
  delay?: number;
  headers?: Record<string, string>;
  data: string;
  /** 缺省为 true，兼容旧 Scene 文件 */
  enabled?: boolean;
  /** 仅展示，不参与匹配 */
  keyword?: string;
  /** 仅展示，不参与匹配 */
  describe?: string;
}

export function isEntryEnabled(entry?: SceneApiEntry | null): boolean {
  return Boolean(entry) && entry!.enabled !== false;
}

export function entryApiId(entryId: string, entry?: SceneApiEntry | null): string {
  const explicit = String(entry?.apiId || '').trim();
  return explicit || entryId;
}

export function findApiEntry(
  scene: { apis?: Record<string, SceneApiEntry> },
  apiId: string,
): SceneApiEntry | undefined {
  let fallback: SceneApiEntry | undefined;
  for (const [entryId, entry] of Object.entries(scene.apis || {})) {
    if (entryApiId(entryId, entry) !== apiId) {
      continue;
    }
    if (isEntryEnabled(entry)) {
      return entry;
    }
    fallback = entry;
  }
  return fallback;
}

export interface SceneDef {
  id: string;
  name: string;
  desc?: string;
  apis: Record<string, SceneApiEntry>;
  mtimeMs?: number;
}

export interface AppConfig {
  proxyTarget: string;
  activeScenes: string[];
  matchPatterns: string[];
  unmatched: 'passthrough' | '404';
}

export interface ResponseDoc {
  status: number;
  delay: number;
  headers?: Record<string, string>;
  variant: string;
  body?: unknown;
}

export interface CompiledRoute {
  apiId: string;
  sceneId: string;
  variant: string;
  method: string;
  pattern: string;
  regex: RegExp;
  staticScore: number;
  apiIndex: number;
  response: ResponseDoc;
}

export interface FileError {
  relativePath: string;
  reason: string;
}

export interface AmbiguousRoute {
  method: string;
  pattern: string;
  apiIds: string[];
}

export interface ConflictSide {
  id?: string;
  name?: string;
  status: number;
  preview: string;
}

export interface ConflictItem {
  apiId: string;
  method: string;
  url: string;
  existingScene: ConflictSide & { id: string; name: string };
  incomingScene: ConflictSide;
}

export interface SceneConflictPayload {
  error: 'scene_conflict';
  incoming: { id: string; name: string };
  conflicts: ConflictItem[];
  closeScenesIfKeepNew: string[];
}

export interface ActiveSetConflictPayload {
  error: 'active_set_conflict';
  involvedScenes: { id: string; name: string }[];
  conflicts: ConflictItem[];
}

export const DEFAULT_CONFIG: AppConfig = {
  proxyTarget: '',
  activeScenes: [],
  matchPatterns: ['/api/'],
  unmatched: 'passthrough',
};

export const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
