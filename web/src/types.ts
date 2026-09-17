export type Unmatched = 'passthrough' | '404';

export interface FileError {
  relativePath: string;
  reason: string;
}

export interface Workspace {
  mocksRoot: string;
  bound: boolean;
  ready: boolean;
  errors: FileError[];
  recent: string[];
}

export interface Status {
  bound: boolean;
  ready: boolean;
  mocksRoot: string;
  activeScenes: string[];
  routeCount: number;
  sceneCount: number;
  apiCount: number;
  activeCount: number;
  errors: FileError[];
  ambiguousRoutes: { method: string; pattern: string; apiIds: string[] }[];
  pendingConflict: ConflictPayload | ActiveSetConflict | null;
  orphans: { apiId: string; variant: string; dataPath: string }[];
  httpsCapture: unknown;
}

export interface ApiItem {
  id: string;
  method: string;
  url: string;
  desc?: string;
  usedBy?: string[];
}

export interface SceneListItem {
  id: string;
  name: string;
  desc?: string;
  apiCount: number;
  enabledCount: number;
  active: boolean;
  mtimeMs: number;
}

export interface SceneEntryView {
  entryId: string;
  apiId: string;
  method: string;
  url: string;
  desc?: string;
  status: number;
  delay: number;
  headers: Record<string, string>;
  variant?: string;
  dataPath?: string;
  refCount: number;
  usedBy: string[];
  missing: boolean;
  unset: boolean;
  enabled: boolean;
  keyword: string;
  describe: string;
}

export interface SceneDetail {
  id: string;
  name: string;
  desc?: string;
  apis: Record<string, unknown>;
  filePath: string;
  active: boolean;
  mtimeMs?: number;
  entries: SceneEntryView[];
}

export interface AppConfig {
  proxyTarget: string;
  activeScenes: string[];
  matchPatterns: string[];
  unmatched: Unmatched;
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

export interface ConflictPayload {
  error: 'scene_conflict';
  incoming: { id: string; name: string };
  conflicts: ConflictItem[];
  closeScenesIfKeepNew: string[];
}

export interface ActiveSetConflict {
  error: 'active_set_conflict';
  involvedScenes: { id: string; name: string }[];
  conflicts: ConflictItem[];
}

export interface ApiError {
  status: number;
  error: string;
  message: string;
  details?: unknown;
}

export function isApiError(err: unknown): err is ApiError {
  return Boolean(err && typeof err === 'object' && 'status' in err && 'error' in err);
}
