export type HttpMethod = string;

export interface ApiDef {
  id: string;
  method: string;
  url: string;
  desc?: string;
}

export interface SceneApiEntry {
  status?: number;
  delay?: number;
  headers?: Record<string, string>;
  data: string;
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
