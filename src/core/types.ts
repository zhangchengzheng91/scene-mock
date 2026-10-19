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

/** 一组「被代理的域名 → 代理到的域名」。同一项目可有多组。 */
export interface ProjectProxy {
  /** 规范化后的被代理域名（小写、无协议、无端口；可带路径前缀） */
  host: string;
  /** 转发地址；`scene-mock://` 表示只进插件；空则走全局 unmatched */
  target: string;
}

export interface ProjectDef {
  /** 目录名 projects/<id>/ */
  id: string;
  name: string;
  /** 第一组域名，与 proxies[0] 保持一致，兼容只读 host/target 的调用方 */
  host: string;
  /** 第一组的代理目标 */
  target: string;
  proxies: ProjectProxy[];
  activeScenes: string[];
}

/** 全局 mocks/config.json */
export interface GlobalConfig {
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
  projectId: string;
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
  projectId: string;
  incoming: { id: string; name: string };
  conflicts: ConflictItem[];
  closeScenesIfKeepNew: string[];
}

export interface ActiveSetConflictPayload {
  error: 'active_set_conflict';
  projectId: string;
  involvedScenes: { id: string; name: string }[];
  conflicts: ConflictItem[];
}

export const DEFAULT_CONFIG: GlobalConfig = {
  matchPatterns: ['/api/'],
  unmatched: 'passthrough',
};

export function freshConfig(): GlobalConfig {
  return {
    matchPatterns: DEFAULT_CONFIG.matchPatterns.slice(),
    unmatched: DEFAULT_CONFIG.unmatched,
  };
}

export const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
