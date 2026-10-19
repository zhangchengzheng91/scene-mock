import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import {
  applyKeepNew,
  detectActivateConflict,
  detectActiveSetConflicts,
  DataIndex,
} from './conflict';
import { atomicWrite, exists, readText, rmrf, toPrettyJson } from './fs-utils';
import { rulePatterns } from './host-pattern';
import { HttpError } from './http-error';
import { assertSafeId, nextVariantName } from './ids';
import { normalizeDelay, normalizeHeaders, normalizeStatus } from './normalize';
import {
  hostLookupKeys,
  normalizeHost,
  normalizeTarget,
  projectIdFromName,
} from './project';
import { RouteTable } from './route-table';
import {
  ActiveSetConflictPayload,
  ApiDef,
  GlobalConfig,
  DEFAULT_CONFIG,
  freshConfig,
  FileError,
  isEntryEnabled,
  entryApiId,
  ProjectDef,
  ProjectProxy,
  SceneApiEntry,
  SceneConflictPayload,
  SceneDef,
} from './types';

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

export interface VariantView {
  variant: string;
  usedBy: string[];
  dataPath: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  host: string;
  target: string;
  proxies: ProjectProxy[];
  sceneCount: number;
  activeSceneCount: number;
  routeCount: number;
  hasError: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  activeScenes: string[];
  errors: FileError[];
}

export interface OrphanItem {
  projectId: string;
  apiId: string;
  variant: string;
  dataPath: string;
}

export interface StoreSnapshot {
  bound: boolean;
  ready: boolean;
  mocksRoot: string;
  config: GlobalConfig;
  projects: ProjectDetail[];
  errors: FileError[];
  orphans: OrphanItem[];
  unresolvedHosts: string[];
}

type Watcher = fs.FSWatcher;

export type PendingConflict = SceneConflictPayload | ActiveSetConflictPayload | null;

export interface Bucket {
  id: string;
  def: ProjectDef;
  apis: ApiDef[];
  scenes: Map<string, SceneDef>;
  dataIndex: DataIndex;
  routes: RouteTable;
  errors: FileError[];
  /** project.json 是否成功加载；失败 = 项目停用（不进规则、路由清空） */
  loaded: boolean;
  apisLoaded: boolean;
  pendingConflict: PendingConflict;
  pendingEnable: {
    sceneId: string;
    enableApiIds: string[];
    isolateOthers: boolean;
  } | null;
}

function proxyListOf(def: { host: string; target: string; proxies?: ProjectProxy[] }): ProjectProxy[] {
  if (def.proxies && def.proxies.length) {
    return def.proxies;
  }
  if (def.host || def.target) {
    return [{ host: def.host, target: def.target }];
  }
  return [];
}

function readProxies(parsed: { host?: unknown; target?: unknown; proxies?: unknown }): ProjectProxy[] {
  const list: ProjectProxy[] = [];
  if (Array.isArray(parsed.proxies)) {
    for (const item of parsed.proxies) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const host = normalizeHost(String((item as { host?: unknown }).host || ''));
      if (!host) {
        continue;
      }
      list.push({
        host,
        target: normalizeTarget(String((item as { target?: unknown }).target || '')),
      });
    }
  }
  if (list.length) {
    return list;
  }
  return [{
    host: normalizeHost(String(parsed.host || '')),
    target: normalizeTarget(String(parsed.target || '')),
  }];
}

function proxyInputOf(
  input: { host?: string; target?: string; proxies?: { host?: string; target?: string }[] },
  current: ProjectProxy[] = [],
): { host?: string; target?: string }[] {
  if (Array.isArray(input.proxies)) {
    return input.proxies;
  }
  const base = current.length
    ? current.map((item) => ({ host: item.host, target: item.target }))
    : [{ host: '', target: '' }];
  if (input.host !== undefined) {
    base[0].host = input.host;
  }
  if (input.target !== undefined) {
    base[0].target = input.target;
  }
  return base;
}

function emptyBucket(id: string): Bucket {
  return {
    id,
    def: { id, name: id, host: '', target: '', proxies: [], activeScenes: [] },
    apis: [],
    scenes: new Map(),
    dataIndex: new Map(),
    routes: new RouteTable(),
    errors: [],
    loaded: false,
    apisLoaded: false,
    pendingConflict: null,
    pendingEnable: null,
  };
}

export class Store extends EventEmitter {
  mocksRoot = '';
  private config: GlobalConfig = freshConfig();
  private configLoaded = false;
  private projects = new Map<string, Bucket>();
  private hostIndex = new Map<string, string>();
  private errors: FileError[] = [];
  private unresolvedHosts = new Map<string, number>();
  private watcher: Watcher | null = null;
  private extraWatchers: Watcher[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private writing = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  get ready(): boolean {
    return Boolean(this.mocksRoot) && this.configLoaded;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => { /* keep queue alive */ },
      () => { /* keep queue alive */ },
    );
    return run;
  }

  async bind(mocksRoot: string): Promise<void> {
    const resolved = path.resolve(mocksRoot);
    const parent = path.dirname(resolved);
    if (!exists(resolved)) {
      if (!exists(parent)) {
        throw new HttpError(400, 'not_found', `目录不存在：${resolved}`);
      }
      this.closeWatch();
      this.resetMemory(resolved);
      this.errors = [{
        relativePath: '.',
        reason: 'mocks 目录不存在，请先初始化骨架',
      }];
      this.emitChange();
      return;
    }
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      throw new HttpError(400, 'not_dir', `不是目录：${resolved}`);
    }
    this.closeWatch();
    this.resetMemory(resolved);
    await this.reloadAll();
    this.watch();
  }

  unbind(): void {
    this.closeWatch();
    this.resetMemory('');
    this.emitChange();
  }

  private resetMemory(mocksRoot: string) {
    this.mocksRoot = mocksRoot;
    this.config = freshConfig();
    this.configLoaded = false;
    this.projects = new Map();
    this.hostIndex = new Map();
    this.errors = [];
    this.unresolvedHosts = new Map();
  }

  close(): void {
    this.closed = true;
    this.closeWatch();
  }

  snapshot(): StoreSnapshot {
    return {
      bound: Boolean(this.mocksRoot),
      ready: this.ready,
      mocksRoot: this.mocksRoot,
      config: this.getConfig(),
      projects: this.listProjectDetails(),
      errors: this.getErrors(),
      orphans: this.listOrphans(),
      unresolvedHosts: [...this.unresolvedHosts.keys()],
    };
  }

  getConfig(): GlobalConfig {
    return {
      matchPatterns: this.config.matchPatterns.slice(),
      unmatched: this.config.unmatched,
    };
  }

  getErrors() {
    const out = this.errors.slice();
    for (const bucket of this.projects.values()) {
      out.push(...bucket.errors);
    }
    return out;
  }

  getUnresolvedHosts(): string[] {
    return [...this.unresolvedHosts.keys()];
  }

  // ── 项目定位 ──────────────────────────────────────────

  /**
   * host（可带端口）+ 可选 pathname → 项目 Bucket。
   * `host` 匹配该 host 下全部路径；`host/任意路径` 只匹配该路径及其子路径，且更长的路径优先。
   * 未知 host 记录到 unresolvedHosts 后返回 null（请求透传，不归入任何项目）。
   */
  resolveProject(host: string, pathname = '/'): Bucket | null {
    return this.matchProxy(host, pathname)?.project || null;
  }

  /**
   * 同一项目可挂多组域名。路径更长的一组优先，转发时用这一组自己的 target。
   */
  matchProxy(host: string, pathname = '/'): { project: Bucket; proxy: ProjectProxy } | null {
    if (!this.ready) {
      return null;
    }
    const keys = new Set(hostLookupKeys(host));
    const reqPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    let bestPid = '';
    let bestPattern = '';
    let bestLen = -1;
    for (const [pattern, pid] of this.hostIndex) {
      const slash = pattern.indexOf('/');
      const patternHost = slash === -1 ? pattern : pattern.slice(0, slash);
      const patternPath = slash === -1 ? '' : pattern.slice(slash);
      if (!keys.has(patternHost)) {
        continue;
      }
      if (patternPath && reqPath !== patternPath && !reqPath.startsWith(`${patternPath}/`)) {
        continue;
      }
      const bucket = this.projects.get(pid);
      if (!bucket?.loaded) {
        continue;
      }
      if (patternPath.length > bestLen) {
        bestLen = patternPath.length;
        bestPid = pid;
        bestPattern = pattern;
      }
    }
    const project = bestPid ? this.projects.get(bestPid) : undefined;
    const proxy = project?.def.proxies.find((item) => item.host === bestPattern);
    if (project && proxy) {
      return { project, proxy };
    }
    const normalized = normalizeHost(host).split('/')[0] || String(host || '').trim().toLowerCase();
    if (normalized) {
      this.unresolvedHosts.set(normalized, Date.now());
    }
    return null;
  }

  projectRoutes(pid: string): RouteTable {
    return this.requireBucket(pid).routes;
  }

  // ── 项目 CRUD ─────────────────────────────────────────

  listProjects(): ProjectSummary[] {
    return [...this.projects.values()]
      .map((bucket) => this.projectSummary(bucket))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  listProjectDetails(): ProjectDetail[] {
    return [...this.projects.values()]
      .map((bucket) => ({
        ...this.projectSummary(bucket),
        activeScenes: bucket.def.activeScenes.slice(),
        errors: bucket.errors.slice(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  getProject(pid: string): ProjectDetail {
    const bucket = this.requireBucket(pid);
    return {
      ...this.projectSummary(bucket),
      activeScenes: bucket.def.activeScenes.slice(),
      errors: bucket.errors.slice(),
    };
  }

  async createProject(input: {
    id?: string;
    name: string;
    host?: string;
    target?: string;
    proxies?: { host?: string; target?: string }[];
  }): Promise<ProjectDetail> {
    return this.enqueue(async () => {
      this.ensureReady();
      const name = String(input.name || '').trim();
      if (!name) {
        throw new HttpError(400, 'invalid', '项目名称不能为空');
      }
      const id = input.id
        ? assertSafeId(String(input.id), '项目 id')
        : projectIdFromName(name, new Set(this.projects.keys()));
      if (this.projects.has(id) || exists(this.projectDir(id))) {
        throw new HttpError(409, 'duplicate_id', `项目 id 已存在：${id}`);
      }
      const proxies = this.normalizeProxyList(proxyInputOf(input));
      const bucket = emptyBucket(id);
      bucket.def = { id, name, host: '', target: '', proxies: [], activeScenes: [] };
      this.assignProxies(bucket.def, proxies);
      bucket.loaded = true;
      bucket.apisLoaded = true;
      await fs.promises.mkdir(this.scenesDir(id), { recursive: true });
      await fs.promises.mkdir(this.dataDir(id), { recursive: true });
      await this.writeJson(this.apisFile(id), []);
      await this.writeProjectFile(bucket);
      this.projects.set(id, bucket);
      this.rebuildHostIndex();
      this.emitChange();
      return this.getProject(id);
    });
  }

  async updateProject(
    pid: string,
    patch: {
      newId?: string;
      name?: string;
      host?: string;
      target?: string;
      proxies?: { host?: string; target?: string }[];
    },
  ): Promise<ProjectDetail> {
    return this.enqueue(async () => {
      this.ensureReady();
      let bucket = this.requireBucket(pid);
      const next: ProjectDef = {
        ...bucket.def,
        proxies: bucket.def.proxies.map((item) => ({ ...item })),
        activeScenes: bucket.def.activeScenes.slice(),
      };
      if (patch.name !== undefined) {
        const name = String(patch.name || '').trim();
        if (!name) {
          throw new HttpError(400, 'invalid', '项目名称不能为空');
        }
        next.name = name;
      }
      if (patch.proxies !== undefined || patch.host !== undefined || patch.target !== undefined) {
        const proxies = this.normalizeProxyList(proxyInputOf(patch, next.proxies), pid);
        this.assignProxies(next, proxies);
      }
      let id = pid;
      if (patch.newId !== undefined && patch.newId !== pid) {
        id = assertSafeId(String(patch.newId), '项目 id');
        if (this.projects.has(id) || exists(this.projectDir(id))) {
          throw new HttpError(409, 'duplicate_id', `项目 id 已存在：${id}`);
        }
        await fs.promises.rename(this.projectDir(pid), this.projectDir(id));
        this.projects.delete(pid);
        bucket.id = id;
        next.id = id;
        this.projects.set(id, bucket);
      }
      bucket.def = next;
      await this.writeProjectFile(bucket);
      this.rebuildHostIndex();
      if (id !== pid) {
        this.rebuildProject(bucket);
      }
      this.emitChange();
      return this.getProject(id);
    });
  }

  /** 无 confirm 时抛 409 + 删除统计预览 */
  async deleteProject(pid: string, confirm = false) {
    return this.enqueue(async () => {
      this.ensureReady();
      const bucket = this.requireBucket(pid);
      let variants = 0;
      for (const map of bucket.dataIndex.values()) {
        variants += map.size;
      }
      const removed = {
        scenes: bucket.scenes.size,
        apis: bucket.apis.length,
        variants,
      };
      if (!confirm) {
        throw new HttpError(409, 'confirm_required', '删除项目需二次确认', { removed });
      }
      await rmrf(this.projectDir(pid));
      this.projects.delete(pid);
      this.rebuildHostIndex();
      this.emitChange();
      return { ok: true as const, removed };
    });
  }

  // ── 接口池（项目内） ───────────────────────────────────

  getApis(pid: string) {
    return this.requireBucket(pid).apis.slice();
  }

  getApiMap(pid: string) {
    return new Map(this.requireBucket(pid).apis.map((api) => [api.id, api]));
  }

  usedByApi(pid: string, apiId: string): string[] {
    const bucket = this.requireBucket(pid);
    const used: string[] = [];
    for (const scene of bucket.scenes.values()) {
      const hit = Object.entries(scene.apis || {}).some(
        ([entryId, entry]) => entryApiId(entryId, entry) === apiId,
      );
      if (hit) {
        used.push(scene.id);
      }
    }
    return used;
  }

  refCount(pid: string, apiId: string, variant: string): string[] {
    const bucket = this.requireBucket(pid);
    const used: string[] = [];
    for (const scene of bucket.scenes.values()) {
      const hit = Object.entries(scene.apis || {}).some(
        ([entryId, entry]) => (
          entryApiId(entryId, entry) === apiId && entry.data === variant
        ),
      );
      if (hit) {
        used.push(scene.id);
      }
    }
    return used;
  }

  async createApi(pid: string, input: { id: string; method: string; url: string; desc?: string }) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const id = assertSafeId(input.id, '接口 id');
      if (bucket.apis.some((api) => api.id === id)) {
        throw new HttpError(409, 'duplicate_id', `接口 id 已存在：${id}`);
      }
      const api = normalizeApi({ ...input, id });
      bucket.apis.push(api);
      await this.writeJson(this.apisFile(pid), bucket.apis);
      this.rebuildProject(bucket);
      this.emitChange();
      return api;
    });
  }

  async updateApi(pid: string, id: string, patch: Partial<ApiDef> & { newId?: string }) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const index = bucket.apis.findIndex((api) => api.id === id);
      if (index < 0) {
        throw new HttpError(404, 'not_found', `接口不存在：${id}`);
      }
      const requestedId = patch.newId ?? patch.id;
      const nextId = requestedId && requestedId !== id
        ? assertSafeId(requestedId, '接口 id')
        : id;
      if (nextId !== id) {
        await this.renameApi(bucket, id, nextId);
      }
      const current = bucket.apis.find((api) => api.id === nextId)!;
      const merged = normalizeApi({
        ...current,
        method: patch.method ?? current.method,
        url: patch.url ?? current.url,
        desc: patch.desc !== undefined ? patch.desc : current.desc,
      });
      bucket.apis = bucket.apis.map((api) => (api.id === nextId ? merged : api));
      await this.writeJson(this.apisFile(pid), bucket.apis);
      this.rebuildProject(bucket);
      this.emitChange();
      return merged;
    });
  }

  async deleteApi(pid: string, id: string, force = false) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      this.requireApi(bucket, id);
      const usedBy = this.usedByApi(pid, id);
      if (usedBy.length && !force) {
        throw new HttpError(
          409,
          'api_in_use',
          `接口仍被 ${usedBy.length} 个 Scene 引用`,
          { usedBy },
        );
      }
      for (const scene of bucket.scenes.values()) {
        let changed = false;
        for (const [entryId, entry] of Object.entries(scene.apis || {})) {
          if (entryApiId(entryId, entry) === id) {
            delete scene.apis[entryId];
            changed = true;
          }
        }
        if (changed) {
          await this.writeSceneFile(bucket, scene);
        }
      }
      bucket.apis = bucket.apis.filter((api) => api.id !== id);
      await this.writeJson(this.apisFile(pid), bucket.apis);
      await rmrf(path.join(this.dataDir(pid), id));
      bucket.dataIndex.delete(id);
      this.rebuildProject(bucket);
      this.emitChange();
    });
  }

  // ── Scene（项目内） ────────────────────────────────────

  getScenes(pid: string) {
    return this.requireBucket(pid).scenes;
  }

  listScenes(pid: string): SceneListItem[] {
    const bucket = this.requireBucket(pid);
    const active = new Set(bucket.def.activeScenes);
    return [...bucket.scenes.values()]
      .map((scene) => {
        const apis = Object.values(scene.apis || {});
        return {
          id: scene.id,
          name: scene.name,
          desc: scene.desc,
          apiCount: apis.length,
          enabledCount: apis.filter((entry) => isEntryEnabled(entry)).length,
          active: active.has(scene.id),
          mtimeMs: scene.mtimeMs || 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  getSceneDetail(pid: string, id: string) {
    const bucket = this.requireBucket(pid);
    const scene = this.requireScene(bucket, id);
    const apiMap = this.getApiMap(pid);
    const entries: SceneEntryView[] = Object.keys(scene.apis || {}).map((entryId) => {
      const entry = scene.apis[entryId];
      const apiId = entryApiId(entryId, entry);
      const api = apiMap.get(apiId);
      const unset = !entry?.data;
      const missing = !unset && !bucket.dataIndex.get(apiId)?.has(entry.data);
      const usedBy = entry?.data ? this.refCount(pid, apiId, entry.data) : [];
      return {
        entryId,
        apiId,
        method: api?.method || '',
        url: api?.url || '',
        desc: api?.desc,
        status: normalizeStatus(entry?.status),
        delay: normalizeDelay(entry?.delay),
        headers: normalizeHeaders(entry?.headers),
        variant: entry?.data,
        dataPath: entry?.data
          ? this.relDataPath(pid, apiId, entry.data)
          : undefined,
        refCount: usedBy.length,
        usedBy,
        missing,
        unset,
        enabled: isEntryEnabled(entry),
        keyword: entry?.keyword || '',
        describe: entry?.describe || '',
      };
    });
    return {
      ...scene,
      filePath: `projects/${pid}/scenes/${id}.json`,
      active: bucket.def.activeScenes.includes(id),
      entries,
    };
  }

  async createScene(pid: string, input: {
    id: string;
    name: string;
    desc?: string;
    copyFrom?: string;
  }) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const id = assertSafeId(input.id, 'Scene id');
      if (bucket.scenes.has(id)) {
        throw new HttpError(409, 'duplicate_id', `Scene 已存在：${id}`);
      }
      if (!input.name || !input.name.trim()) {
        throw new HttpError(400, 'invalid', 'Scene 名称不能为空');
      }
      const scene: SceneDef = {
        id,
        name: input.name.trim(),
        desc: input.desc,
        apis: {},
      };
      if (input.copyFrom) {
        const source = this.requireScene(bucket, input.copyFrom);
        for (const [apiId, entry] of Object.entries(source.apis || {})) {
          const copied = await this.copyEntryToScene(bucket, id, apiId, entry);
          scene.apis[apiId] = copied;
        }
      }
      await this.writeSceneFile(bucket, scene);
      bucket.scenes.set(id, scene);
      this.rebuildProject(bucket);
      this.emitChange();
      return this.getSceneDetail(pid, id);
    });
  }

  async updateScene(
    pid: string,
    id: string,
    patch: { name?: string; desc?: string; apis?: Record<string, SceneApiEntry> },
  ) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, id);
      if (patch.name !== undefined) {
        if (!patch.name.trim()) {
          throw new HttpError(400, 'invalid', 'Scene 名称不能为空');
        }
        scene.name = patch.name.trim();
      }
      if (patch.desc !== undefined) {
        scene.desc = patch.desc;
      }
      if (patch.apis) {
        const next: Record<string, SceneApiEntry> = {};
        for (const [entryId, entry] of Object.entries(patch.apis)) {
          this.requireApi(bucket, entryApiId(entryId, entry));
          next[entryId] = sanitizeEntry(entry);
        }
        scene.apis = next;
      }
      await this.writeSceneFile(bucket, scene);
      this.rebuildProject(bucket);
      this.emitChange();
      return this.getSceneDetail(pid, id);
    });
  }

  async deleteScene(pid: string, id: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      this.requireScene(bucket, id);
      const beforeOrphans = new Set(
        this.listOrphans(pid).map((o) => `${o.apiId}/${o.variant}`),
      );
      bucket.scenes.delete(id);
      if (bucket.def.activeScenes.includes(id)) {
        bucket.def.activeScenes = bucket.def.activeScenes.filter((s) => s !== id);
        await this.writeProjectFile(bucket);
      }
      const file = path.join(this.scenesDir(pid), `${id}.json`);
      await fs.promises.unlink(file).catch(() => { /* ignore */ });
      this.rebuildProject(bucket);
      const orphans = this.listOrphans(pid).filter(
        (o) => !beforeOrphans.has(`${o.apiId}/${o.variant}`),
      );
      this.emitChange();
      return { ok: true as const, orphans };
    });
  }

  async upsertSceneApi(
    pid: string,
    sceneId: string,
    entryId: string,
    patch: {
      status?: number;
      delay?: number;
      headers?: Record<string, string>;
      data?: string;
      body?: unknown;
      enabled?: boolean;
      keyword?: string;
      describe?: string;
    },
  ) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, sceneId);
      const existed = Boolean(scene.apis[entryId]);
      const current = scene.apis[entryId] || { data: '' };
      const apiId = entryApiId(entryId, current);
      this.requireApi(bucket, apiId);
      let variant = patch.data || current.data;
      let forked = false;
      if (variant) {
        assertSafeId(variant, 'variant');
      }
      if (patch.body !== undefined) {
        if (!variant) {
          variant = nextVariantName(this.variantNames(bucket, apiId), sceneId);
        } else {
          const usedBy = this.refCount(pid, apiId, variant);
          const others = usedBy.filter((sid) => sid !== sceneId);
          if (others.length > 0) {
            variant = nextVariantName(this.variantNames(bucket, apiId), sceneId);
            forked = true;
          }
        }
        await this.writeDataFile(bucket, apiId, variant, patch.body);
      } else if (!variant) {
        variant = nextVariantName(this.variantNames(bucket, apiId), sceneId);
        await this.writeDataFile(bucket, apiId, variant, {});
      }
      const next = sanitizeEntry({
        apiId: current.apiId,
        status: patch.status !== undefined ? patch.status : current.status,
        delay: patch.delay !== undefined ? patch.delay : current.delay,
        headers: patch.headers !== undefined ? patch.headers : current.headers,
        data: variant,
        enabled: patch.enabled !== undefined
          ? patch.enabled
          : (existed ? current.enabled : false),
        keyword: patch.keyword !== undefined ? patch.keyword : current.keyword,
        describe: patch.describe !== undefined ? patch.describe : current.describe,
      });
      if (patch.enabled === true) {
        const isolate = !bucket.def.activeScenes.includes(sceneId);
        const previewApis: Record<string, SceneApiEntry> = {};
        for (const [id, entry] of Object.entries(scene.apis || {})) {
          previewApis[id] = isolate && id !== entryId
            ? sanitizeEntry({ ...entry, enabled: false })
            : (id === entryId ? next : entry);
        }
        previewApis[entryId] = next;
        const conflict = detectActivateConflict(
          pid,
          { ...scene, apis: previewApis },
          bucket.def.activeScenes,
          bucket.scenes,
          this.getApiMap(pid),
          bucket.dataIndex,
        );
        if (conflict) {
          bucket.pendingEnable = {
            sceneId,
            enableApiIds: [entryId],
            isolateOthers: isolate,
          };
          throw new HttpError(409, 'scene_conflict', '与已激活 Scene 存在接口重合', conflict);
        }
        if (isolate) {
          scene.apis = previewApis;
        } else {
          scene.apis[entryId] = next;
        }
        if (!bucket.def.activeScenes.includes(sceneId)) {
          bucket.def.activeScenes = [...bucket.def.activeScenes, sceneId];
          await this.writeProjectFile(bucket);
        }
      } else {
        scene.apis[entryId] = next;
        if (
          patch.enabled === false
          && !Object.values(scene.apis).some((entry) => isEntryEnabled(entry))
        ) {
          bucket.def.activeScenes = bucket.def.activeScenes.filter((id) => id !== sceneId);
          await this.writeProjectFile(bucket);
        }
      }
      await this.writeSceneFile(bucket, scene);
      this.rebuildProject(bucket);
      this.emitChange();
      return { forked, variant, entry: this.getSceneDetail(pid, sceneId) };
    });
  }

  async setSceneApisEnabled(pid: string, sceneId: string, enabled: boolean) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, sceneId);
      if (enabled) {
        const preview: SceneDef = {
          ...scene,
          apis: Object.fromEntries(
            Object.entries(scene.apis || {}).map(([apiId, entry]) => [
              apiId,
              sanitizeEntry({ ...entry, enabled: true }),
            ]),
          ),
        };
        const conflict = detectActivateConflict(
          pid,
          preview,
          bucket.def.activeScenes,
          bucket.scenes,
          this.getApiMap(pid),
          bucket.dataIndex,
        );
        if (conflict) {
          bucket.pendingEnable = {
            sceneId,
            enableApiIds: Object.keys(scene.apis || {}),
            isolateOthers: false,
          };
          throw new HttpError(409, 'scene_conflict', '与已激活 Scene 存在接口重合', conflict);
        }
        if (!bucket.def.activeScenes.includes(sceneId)) {
          bucket.def.activeScenes = [...bucket.def.activeScenes, sceneId];
          await this.writeProjectFile(bucket);
        }
      }
      for (const apiId of Object.keys(scene.apis || {})) {
        scene.apis[apiId] = sanitizeEntry({ ...scene.apis[apiId], enabled });
      }
      await this.writeSceneFile(bucket, scene);
      if (!enabled) {
        bucket.def.activeScenes = bucket.def.activeScenes.filter((id) => id !== sceneId);
        await this.writeProjectFile(bucket);
      }
      bucket.pendingConflict = null;
      this.rebuildProject(bucket);
      this.emitChange();
      return this.getSceneDetail(pid, sceneId);
    });
  }

  async copySceneApi(pid: string, sceneId: string, entryId: string, fromSceneId: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, sceneId);
      const dest = scene.apis[entryId];
      const apiId = entryApiId(entryId, dest);
      this.requireApi(bucket, apiId);
      const source = this.requireScene(bucket, fromSceneId);
      const entry = Object.entries(source.apis || {}).find(
        ([id, item]) => entryApiId(id, item) === apiId,
      )?.[1];
      if (!entry) {
        throw new HttpError(
          404,
          'not_found',
          `源 Scene 未包含接口 ${apiId}`,
        );
      }
      scene.apis[entryId] = await this.copyEntryToScene(bucket, sceneId, apiId, {
        ...entry,
        apiId: dest?.apiId,
      });
      await this.writeSceneFile(bucket, scene);
      this.rebuildProject(bucket);
      this.emitChange();
      return this.getSceneDetail(pid, sceneId);
    });
  }

  async duplicateSceneApi(pid: string, sceneId: string, entryId: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, sceneId);
      const source = scene.apis[entryId];
      if (!source) {
        throw new HttpError(404, 'not_found', `Scene 未包含该接口条目`);
      }
      const apiId = entryApiId(entryId, source);
      this.requireApi(bucket, apiId);
      const nextId = nextVariantName(new Set(Object.keys(scene.apis || {})), `${apiId}-copy`);
      const copied = await this.copyEntryToScene(bucket, sceneId, apiId, source);
      const describeBase = String(source.describe || '').trim() || apiId;
      scene.apis[nextId] = sanitizeEntry({
        ...copied,
        apiId,
        describe: `${describeBase}-复制`,
        enabled: false,
      });
      await this.writeSceneFile(bucket, scene);
      this.rebuildProject(bucket);
      this.emitChange();
      return this.getSceneDetail(pid, sceneId);
    });
  }

  async shareSceneApi(pid: string, sceneId: string, entryId: string, variant: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, sceneId);
      const current = scene.apis[entryId] || { data: variant };
      const apiId = entryApiId(entryId, current);
      this.requireApi(bucket, apiId);
      assertSafeId(variant, 'variant');
      if (!bucket.dataIndex.get(apiId)?.has(variant)) {
        throw new HttpError(404, 'not_found', `variant 不存在：${variant}`);
      }
      scene.apis[entryId] = sanitizeEntry({ ...current, data: variant });
      await this.writeSceneFile(bucket, scene);
      this.rebuildProject(bucket);
      this.emitChange();
      return this.getSceneDetail(pid, sceneId);
    });
  }

  // ── variant / data 文件（项目内） ──────────────────────

  listVariants(pid: string, apiId: string): VariantView[] {
    const bucket = this.requireBucket(pid);
    this.requireApi(bucket, apiId);
    const variants = bucket.dataIndex.get(apiId);
    const names = new Set<string>([...(variants?.keys() || [])]);
    for (const scene of bucket.scenes.values()) {
      for (const [entryId, entry] of Object.entries(scene.apis || {})) {
        if (entryApiId(entryId, entry) === apiId && entry?.data) {
          names.add(entry.data);
        }
      }
    }
    return [...names].sort().map((variant) => ({
      variant,
      usedBy: this.refCount(pid, apiId, variant),
      dataPath: this.relDataPath(pid, apiId, variant),
    }));
  }

  getVariantBody(pid: string, apiId: string, variant: string): unknown {
    const bucket = this.requireBucket(pid);
    const variants = bucket.dataIndex.get(apiId);
    if (!variants || !variants.has(variant)) {
      throw new HttpError(404, 'not_found', `variant 不存在：${apiId}/${variant}`);
    }
    return variants.get(variant);
  }

  async writeVariant(
    pid: string,
    apiId: string,
    variant: string,
    body: unknown,
    opts: { fork?: boolean; sceneId?: string } = {},
  ) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      this.requireApi(bucket, apiId);
      assertSafeId(variant, 'variant');
      const usedBy = this.refCount(pid, apiId, variant);
      if (usedBy.length > 1 && !opts.fork) {
        throw new HttpError(
          409,
          'shared_variant',
          `此数据被 ${usedBy.length} 个 Scene 引用，保存前需 fork`,
          { usedBy },
        );
      }
      let target = variant;
      let forked = false;
      if (usedBy.length > 1 && opts.fork) {
        if (!opts.sceneId) {
          throw new HttpError(400, 'invalid', 'fork 需要 sceneId');
        }
        const scene = this.requireScene(bucket, opts.sceneId);
        const match = Object.entries(scene.apis || {}).find(
          ([id, entry]) => entryApiId(id, entry) === apiId && entry.data === variant,
        );
        if (!match) {
          throw new HttpError(400, 'invalid', '该 Scene 未引用此 variant');
        }
        target = nextVariantName(this.variantNames(bucket, apiId), opts.sceneId);
        scene.apis[match[0]] = { ...match[1], data: target };
        await this.writeSceneFile(bucket, scene);
        forked = true;
      }
      await this.writeDataFile(bucket, apiId, target, body);
      this.rebuildProject(bucket);
      this.emitChange();
      return { forked, variant: target, dataPath: this.relDataPath(pid, apiId, target) };
    });
  }

  async deleteVariant(pid: string, apiId: string, variant: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      this.requireApi(bucket, apiId);
      assertSafeId(variant, 'variant');
      const usedBy = this.refCount(pid, apiId, variant);
      if (usedBy.length) {
        throw new HttpError(
          409,
          'variant_in_use',
          '仍被 Scene 引用，无法删除',
          { usedBy },
        );
      }
      const file = path.join(this.dataDir(pid), apiId, `${variant}.json`);
      await fs.promises.unlink(file).catch(() => { /* ignore */ });
      bucket.dataIndex.get(apiId)?.delete(variant);
      this.rebuildProject(bucket);
      this.emitChange();
    });
  }

  // ── 激活与冲突（项目内） ────────────────────────────────

  async activate(pid: string, sceneId: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      const scene = this.requireScene(bucket, sceneId);
      if (bucket.def.activeScenes.includes(sceneId)) {
        return { ok: true as const, activeScenes: bucket.def.activeScenes };
      }
      const conflict = detectActivateConflict(
        pid,
        scene,
        bucket.def.activeScenes,
        bucket.scenes,
        this.getApiMap(pid),
        bucket.dataIndex,
      );
      if (conflict) {
        throw new HttpError(409, 'scene_conflict', '与已激活 Scene 存在接口重合', conflict);
      }
      bucket.def.activeScenes = [...bucket.def.activeScenes, sceneId];
      await this.writeProjectFile(bucket);
      bucket.pendingConflict = null;
      this.rebuildProject(bucket);
      this.emitChange();
      return { ok: true as const, activeScenes: bucket.def.activeScenes };
    });
  }

  async resolveActivate(pid: string, input: {
    sceneId?: string;
    action: 'keep-new' | 'keep-old' | 'replace';
    activeScenes?: string[];
  }) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      if (input.action === 'keep-old') {
        bucket.pendingEnable = null;
        return { ok: true as const, activeScenes: bucket.def.activeScenes };
      }
      if (input.action === 'replace') {
        const list = input.activeScenes || [];
        this.assertConflictFree(bucket, list);
        bucket.def.activeScenes = list;
        await this.writeProjectFile(bucket);
        bucket.pendingConflict = null;
        bucket.pendingEnable = null;
        this.rebuildProject(bucket);
        this.emitChange();
        return { ok: true as const, activeScenes: bucket.def.activeScenes };
      }
      if (!input.sceneId) {
        throw new HttpError(400, 'invalid', 'keep-new 需要 sceneId');
      }
      const scene = this.requireScene(bucket, input.sceneId);
      const pending = bucket.pendingEnable;
      bucket.pendingEnable = null;
      if (pending && pending.sceneId === input.sceneId) {
        for (const apiId of Object.keys(scene.apis || {})) {
          const on = pending.enableApiIds.includes(apiId);
          if (pending.isolateOthers || on) {
            scene.apis[apiId] = sanitizeEntry({
              ...scene.apis[apiId],
              enabled: on,
            });
          }
        }
        await this.writeSceneFile(bucket, scene);
      }
      const conflict = detectActivateConflict(
        pid,
        scene,
        bucket.def.activeScenes,
        bucket.scenes,
        this.getApiMap(pid),
        bucket.dataIndex,
      );
      const close = conflict?.closeScenesIfKeepNew || [];
      bucket.def.activeScenes = applyKeepNew(
        bucket.def.activeScenes,
        input.sceneId,
        close,
      );
      await this.writeProjectFile(bucket);
      bucket.pendingConflict = null;
      this.rebuildProject(bucket);
      this.emitChange();
      return { ok: true as const, activeScenes: bucket.def.activeScenes };
    });
  }

  async deactivate(pid: string, sceneId: string) {
    return this.enqueue(async () => {
      const bucket = this.requireReadyBucket(pid);
      this.requireScene(bucket, sceneId);
      bucket.def.activeScenes = bucket.def.activeScenes.filter((id) => id !== sceneId);
      await this.writeProjectFile(bucket);
      bucket.pendingConflict = detectActiveSetConflicts(
        pid,
        bucket.def.activeScenes,
        bucket.scenes,
        this.getApiMap(pid),
        bucket.dataIndex,
      );
      this.rebuildProject(bucket);
      this.emitChange();
      return { ok: true as const, activeScenes: bucket.def.activeScenes };
    });
  }

  pendingConflictOf(pid: string): PendingConflict {
    return this.projects.get(pid)?.pendingConflict || null;
  }

  // ── 全局配置 ──────────────────────────────────────────

  async updateConfig(patch: Partial<GlobalConfig>) {
    return this.enqueue(async () => {
      this.ensureReady();
      if (patch.matchPatterns !== undefined) {
        if (!Array.isArray(patch.matchPatterns)) {
          throw new HttpError(400, 'invalid', 'matchPatterns 须为字符串数组');
        }
        this.config.matchPatterns = patch.matchPatterns.map(String);
      }
      if (patch.unmatched !== undefined) {
        if (patch.unmatched !== 'passthrough' && patch.unmatched !== '404') {
          throw new HttpError(400, 'invalid', 'unmatched 只能是 passthrough 或 404');
        }
        this.config.unmatched = patch.unmatched;
      }
      await this.writeJson(this.configFile(), this.config);
      this.emitChange();
      return this.getConfig();
    });
  }

  // ── 规则文本 ──────────────────────────────────────────

  private projectHosts(): string[] {
    const hosts: string[] = [];
    for (const bucket of this.projects.values()) {
      if (!bucket.loaded) {
        continue;
      }
      for (const proxy of proxyListOf(bucket.def)) {
        if (proxy.host) {
          hosts.push(proxy.host);
        }
      }
    }
    return hosts;
  }

  whistleRulesText(): string {
    const patterns = rulePatterns(this.config.matchPatterns, this.projectHosts());
    const lines = [
      '# scene-mock · 短协议才会进插件 server',
      '# 插件禁用后这些规则失效',
    ];
    if (!patterns.length) {
      lines.push('# （当前 matchPatterns 与项目 host 都为空，不会自动劫持请求）');
    }
    for (const pattern of patterns) {
      lines.push(`${pattern} scene-mock://`);
    }
    return `${lines.join('\n')}\n`;
  }

  // ── 骨架与加载 ────────────────────────────────────────

  async initSkeleton(): Promise<void> {
    this.ensureBound();
    await fs.promises.mkdir(this.mocksRoot, { recursive: true });
    await fs.promises.mkdir(this.projectsDir(), { recursive: true });
    if (!exists(this.configFile())) {
      await this.writeJson(this.configFile(), DEFAULT_CONFIG);
    }
    await this.reloadAll();
    this.watch();
  }

  async reloadAll() {
    if (!this.mocksRoot) {
      return;
    }
    this.errors = [];
    await this.loadConfig();
    await this.loadProjects();
    this.rebuildHostIndex();
    for (const bucket of this.projects.values()) {
      this.rebuildProject(bucket);
    }
    this.emitChange();
  }

  private async loadConfig() {
    const file = this.configFile();
    if (!exists(file)) {
      this.pushError('config.json', '文件不存在');
      return;
    }
    try {
      const raw = await readText(file);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config.json 须为对象');
      }
      this.config = {
        matchPatterns: Array.isArray(parsed.matchPatterns)
          ? parsed.matchPatterns.map(String)
          : DEFAULT_CONFIG.matchPatterns.slice(),
        unmatched: parsed.unmatched === '404' ? '404' : 'passthrough',
      };
      this.configLoaded = true;
    } catch (err) {
      this.pushError('config.json', (err as Error).message);
    }
  }

  private async loadProjects() {
    const dir = this.projectsDir();
    if (!exists(dir)) {
      await fs.promises.mkdir(dir, { recursive: true }).catch(() => { /* ignore */ });
      this.projects = new Map();
      return;
    }
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const keep = new Set<string>();
    for (const ent of entries) {
      if (!ent.isDirectory()) {
        continue;
      }
      const pid = ent.name;
      try {
        assertSafeId(pid, '项目 id');
      } catch {
        this.pushError(`projects/${pid}`, '目录名不是合法项目 id');
        continue;
      }
      const prev = this.projects.get(pid);
      const bucket = emptyBucket(pid);
      await this.loadProjectFile(bucket, prev);
      if (bucket.loaded) {
        // 预置上一份内存快照：单个文件损坏时保留旧数据继续服务
        if (prev?.loaded) {
          bucket.apis = prev.apis;
          bucket.apisLoaded = prev.apisLoaded;
          bucket.scenes = prev.scenes;
        }
        await this.loadApis(bucket);
        await this.loadScenes(bucket);
        await this.loadData(bucket, prev);
      }
      this.projects.set(pid, bucket);
      keep.add(pid);
    }
    for (const pid of [...this.projects.keys()]) {
      if (!keep.has(pid)) {
        this.projects.delete(pid);
      }
    }
  }

  private async loadProjectFile(bucket: Bucket, prev?: Bucket) {
    const pid = bucket.id;
    const rel = `projects/${pid}/project.json`;
    const file = path.join(this.projectDir(pid), 'project.json');
    if (!exists(file)) {
      bucket.errors.push({ relativePath: rel, reason: '文件不存在' });
      return;
    }
    try {
      const raw = await readText(file);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('project.json 须为对象');
      }
      const proxies = readProxies(parsed);
      bucket.def = {
        id: pid,
        name: String(parsed.name || pid),
        host: proxies[0]?.host || '',
        target: proxies[0]?.target || '',
        proxies,
        activeScenes: Array.isArray(parsed.activeScenes)
          ? parsed.activeScenes.map(String)
          : [],
      };
      bucket.loaded = true;
    } catch (err) {
      bucket.errors.push({ relativePath: rel, reason: (err as Error).message });
      if (prev?.loaded) {
        bucket.def = prev.def;
        bucket.loaded = true;
        bucket.apis = prev.apis;
        bucket.apisLoaded = prev.apisLoaded;
        bucket.scenes = prev.scenes;
        bucket.dataIndex = prev.dataIndex;
      }
    }
  }

  private async loadApis(bucket: Bucket) {
    const pid = bucket.id;
    const rel = `projects/${pid}/apis.json`;
    const file = this.apisFile(pid);
    if (!exists(file)) {
      bucket.errors.push({ relativePath: rel, reason: '文件不存在' });
      return;
    }
    try {
      const raw = await readText(file);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('apis.json 须为数组');
      }
      const apis: ApiDef[] = [];
      const seen = new Set<string>();
      for (const item of parsed) {
        const api = normalizeApi(item);
        if (seen.has(api.id)) {
          throw new Error(`重复的接口 id：${api.id}`);
        }
        seen.add(api.id);
        apis.push(api);
      }
      bucket.apis = apis;
      bucket.apisLoaded = true;
    } catch (err) {
      bucket.errors.push({ relativePath: rel, reason: (err as Error).message });
    }
  }

  private async loadScenes(bucket: Bucket) {
    const pid = bucket.id;
    const dir = this.scenesDir(pid);
    if (!exists(dir)) {
      await fs.promises.mkdir(dir, { recursive: true }).catch(() => { /* ignore */ });
      return;
    }
    const names = await fs.promises.readdir(dir);
    const keep = new Set<string>();
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const id = name.slice(0, -5);
      const rel = `projects/${pid}/scenes/${name}`;
      try {
        assertSafeId(id, 'Scene id');
        const file = path.join(dir, name);
        const raw = await readText(file);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Scene 文件须为对象');
        }
        if (parsed.extends) {
          bucket.errors.push({ relativePath: rel, reason: '一期忽略 extends 字段' });
        }
        if (!parsed.name || typeof parsed.name !== 'string') {
          throw new Error('缺少 name');
        }
        const apis: Record<string, SceneApiEntry> = {};
        const src = parsed.apis && typeof parsed.apis === 'object' ? parsed.apis : {};
        for (const [apiId, entry] of Object.entries(src)) {
          apis[apiId] = sanitizeEntry(entry as SceneApiEntry);
        }
        const stat = await fs.promises.stat(file);
        bucket.scenes.set(id, {
          id,
          name: parsed.name,
          desc: typeof parsed.desc === 'string' ? parsed.desc : undefined,
          apis,
          mtimeMs: stat.mtimeMs,
        });
        keep.add(id);
      } catch (err) {
        bucket.errors.push({ relativePath: rel, reason: (err as Error).message });
      }
    }
    for (const id of [...bucket.scenes.keys()]) {
      if (!keep.has(id) && names.includes(`${id}.json`) === false) {
        bucket.scenes.delete(id);
      }
    }
  }

  private async loadData(bucket: Bucket, prev?: Bucket) {
    const pid = bucket.id;
    const dir = this.dataDir(pid);
    if (!exists(dir)) {
      await fs.promises.mkdir(dir, { recursive: true }).catch(() => { /* ignore */ });
      return;
    }
    const next: DataIndex = new Map();
    const apiDirs = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const ent of apiDirs) {
      if (!ent.isDirectory()) {
        continue;
      }
      const apiId = ent.name;
      const files = await fs.promises.readdir(path.join(dir, apiId));
      const map = new Map<string, unknown>();
      for (const name of files) {
        if (!name.endsWith('.json')) {
          continue;
        }
        const variant = name.slice(0, -5);
        const rel = `projects/${pid}/data/${apiId}/${name}`;
        try {
          assertSafeId(variant, 'variant');
          const raw = await readText(path.join(dir, apiId, name));
          if (!raw.trim()) {
            throw new Error('空文件');
          }
          map.set(variant, JSON.parse(raw));
        } catch (err) {
          bucket.errors.push({ relativePath: rel, reason: (err as Error).message });
          const prevData = prev?.dataIndex.get(apiId);
          if (prevData?.has(variant)) {
            map.set(variant, prevData.get(variant));
          }
        }
      }
      next.set(apiId, map);
    }
    bucket.dataIndex = next;
  }

  // ── 重建 ─────────────────────────────────────────────

  private rebuildHostIndex() {
    const next = new Map<string, string>();
    for (const bucket of this.projects.values()) {
      if (!bucket.loaded) {
        continue;
      }
      let blocked = false;
      for (const proxy of proxyListOf(bucket.def)) {
        if (!proxy.host) {
          continue;
        }
        const existed = next.get(proxy.host);
        if (existed && existed !== bucket.id) {
          bucket.errors.push({
            relativePath: `projects/${bucket.id}/project.json`,
            reason: `host ${proxy.host} 与项目 ${existed} 重复，该项目已停用`,
          });
          blocked = true;
          break;
        }
      }
      if (blocked) {
        bucket.loaded = false;
        bucket.routes.clear();
        continue;
      }
      for (const proxy of proxyListOf(bucket.def)) {
        if (proxy.host) {
          next.set(proxy.host, bucket.id);
        }
      }
    }
    this.hostIndex = next;
  }

  private rebuildProject(bucket: Bucket) {
    bucket.routes.clear();
    bucket.pendingConflict = null;
    if (!this.ready || !bucket.loaded) {
      return;
    }
    bucket.pendingConflict = detectActiveSetConflicts(
      bucket.id,
      bucket.def.activeScenes,
      bucket.scenes,
      this.getApiMap(bucket.id),
      bucket.dataIndex,
    );
    if (bucket.pendingConflict) {
      this.emit('conflict', bucket.pendingConflict);
      return;
    }
    bucket.routes.compile({
      projectId: bucket.id,
      apis: bucket.apis,
      scenes: bucket.scenes,
      activeScenes: bucket.def.activeScenes,
      dataIndex: bucket.dataIndex,
    });
  }

  private emitChange() {
    this.emit('change');
  }

  // ── watch ────────────────────────────────────────────

  private watch() {
    this.closeWatch();
    if (!this.mocksRoot) {
      return;
    }
    const onFs = (event: string, filename: string | Buffer | null) => {
      if (this.closed) {
        return;
      }
      const name = filename ? String(filename) : '';
      if (name.endsWith('.tmp') || name.endsWith('.DS_Store')) {
        return;
      }
      if (this.writing > 0) {
        return;
      }
      if (this.debounce) {
        clearTimeout(this.debounce);
      }
      this.debounce = setTimeout(() => {
        this.reloadAll().catch((err) => {
          this.pushError('.', (err as Error).message);
        });
      }, 150);
    };
    try {
      this.watcher = fs.watch(this.mocksRoot, { recursive: true }, onFs);
    } catch {
      this.watcher = fs.watch(this.mocksRoot, onFs);
      try {
        this.extraWatchers.push(fs.watch(this.projectsDir(), { recursive: true }, onFs));
      } catch {
        if (exists(this.projectsDir())) {
          this.extraWatchers.push(fs.watch(this.projectsDir(), onFs));
        }
      }
    }
  }

  private closeWatch() {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    this.watcher?.close();
    this.watcher = null;
    for (const w of this.extraWatchers) {
      w.close();
    }
    this.extraWatchers = [];
  }

  // ── 内部工具 ──────────────────────────────────────────

  private projectSummary(bucket: Bucket): ProjectSummary {
    return {
      id: bucket.id,
      name: bucket.def.name,
      host: bucket.def.host,
      target: bucket.def.target,
      proxies: proxyListOf(bucket.def).map((item) => ({ ...item })),
      sceneCount: bucket.scenes.size,
      activeSceneCount: bucket.def.activeScenes.length,
      routeCount: bucket.routes.size,
      hasError: bucket.errors.length > 0 || !bucket.loaded,
    };
  }

  private normalizeProjectHost(input: string): string {
    const host = normalizeHost(String(input || ''));
    if (!host) {
      throw new HttpError(400, 'invalid', '被代理的域名不能为空');
    }
    return host;
  }

  private assertHostUnique(host: string, excludePid?: string, index = 0) {
    for (const bucket of this.projects.values()) {
      if (bucket.id === excludePid) {
        continue;
      }
      const used = proxyListOf(bucket.def).some((item) => item.host === host);
      if (bucket.loaded && used) {
        throw new HttpError(
          409,
          'duplicate_host',
          `host 已被项目 ${bucket.id} 使用`,
          { projectId: bucket.id, index, host },
        );
      }
    }
  }

  private normalizeProxyList(
    input: { host?: string; target?: string }[],
    excludePid?: string,
  ): ProjectProxy[] {
    if (!input.length) {
      throw new HttpError(400, 'invalid', '至少填写一组被代理的域名');
    }
    const seen = new Set<string>();
    return input.map((item, index) => {
      const host = this.normalizeProjectHost(String(item?.host || ''));
      if (seen.has(host)) {
        throw new HttpError(400, 'duplicate_host', `域名重复：${host}`, { index, host });
      }
      seen.add(host);
      this.assertHostUnique(host, excludePid, index);
      return {
        host,
        target: normalizeTarget(String(item?.target || '')),
      };
    });
  }

  private assignProxies(def: ProjectDef, proxies: ProjectProxy[]) {
    def.proxies = proxies;
    def.host = proxies[0]?.host || '';
    def.target = proxies[0]?.target || '';
  }

  private listOrphans(pid?: string): OrphanItem[] {
    const out: OrphanItem[] = [];
    const buckets = pid
      ? [this.requireBucket(pid)]
      : [...this.projects.values()];
    for (const bucket of buckets) {
      for (const [apiId, variants] of bucket.dataIndex) {
        for (const variant of variants.keys()) {
          if (this.refCount(bucket.id, apiId, variant).length === 0) {
            out.push({
              projectId: bucket.id,
              apiId,
              variant,
              dataPath: this.relDataPath(bucket.id, apiId, variant),
            });
          }
        }
      }
    }
    return out;
  }

  private assertConflictFree(bucket: Bucket, activeScenes: string[]) {
    const conflict = detectActiveSetConflicts(
      bucket.id,
      activeScenes,
      bucket.scenes,
      this.getApiMap(bucket.id),
      bucket.dataIndex,
    );
    if (conflict) {
      throw new HttpError(409, 'scene_conflict', '激活集合仍有接口重合', conflict);
    }
  }

  private async renameApi(bucket: Bucket, oldId: string, newId: string) {
    if (bucket.apis.some((api) => api.id === newId)) {
      throw new HttpError(409, 'duplicate_id', `接口 id 已存在：${newId}`);
    }
    const oldDir = path.join(this.dataDir(bucket.id), oldId);
    const newDir = path.join(this.dataDir(bucket.id), newId);
    try {
      if (exists(oldDir)) {
        if (exists(newDir)) {
          throw new HttpError(409, 'duplicate_id', `data/${newId}/ 已存在`);
        }
        await fs.promises.rename(oldDir, newDir);
      }
      for (const scene of bucket.scenes.values()) {
        let changed = false;
        const nextApis: Record<string, SceneApiEntry> = {};
        for (const [entryId, entry] of Object.entries(scene.apis || {})) {
          if (entryId === oldId && !entry.apiId) {
            nextApis[newId] = entry;
            changed = true;
            continue;
          }
          if (entry.apiId === oldId) {
            nextApis[entryId] = { ...entry, apiId: newId };
            changed = true;
            continue;
          }
          nextApis[entryId] = entry;
        }
        if (changed) {
          scene.apis = nextApis;
          await this.writeSceneFile(bucket, scene);
        }
      }
      bucket.apis = bucket.apis.map((api) => (
        api.id === oldId ? { ...api, id: newId } : api
      ));
      const data = bucket.dataIndex.get(oldId);
      if (data) {
        bucket.dataIndex.set(newId, data);
        bucket.dataIndex.delete(oldId);
      }
      await this.writeJson(this.apisFile(bucket.id), bucket.apis);
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      throw new HttpError(
        500,
        'rename_incomplete',
        `重命名未完成：${(err as Error).message}`,
      );
    }
  }

  private async copyEntryToScene(
    bucket: Bucket,
    sceneId: string,
    apiId: string,
    entry: SceneApiEntry,
  ): Promise<SceneApiEntry> {
    const variant = nextVariantName(this.variantNames(bucket, apiId), sceneId);
    let body: unknown = {};
    if (entry.data && bucket.dataIndex.get(apiId)?.has(entry.data)) {
      body = bucket.dataIndex.get(apiId)!.get(entry.data);
    }
    await this.writeDataFile(bucket, apiId, variant, body);
    return sanitizeEntry({ ...entry, data: variant });
  }

  private variantNames(bucket: Bucket, apiId: string): Set<string> {
    return new Set(bucket.dataIndex.get(apiId)?.keys() || []);
  }

  private async writeDataFile(bucket: Bucket, apiId: string, variant: string, body: unknown) {
    const dir = path.join(this.dataDir(bucket.id), apiId);
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${variant}.json`);
    await this.writeJson(file, body);
    if (!bucket.dataIndex.has(apiId)) {
      bucket.dataIndex.set(apiId, new Map());
    }
    bucket.dataIndex.get(apiId)!.set(variant, body);
  }

  private async writeSceneFile(bucket: Bucket, scene: SceneDef) {
    const doc = {
      name: scene.name,
      desc: scene.desc,
      apis: scene.apis,
    };
    await this.writeJson(path.join(this.scenesDir(bucket.id), `${scene.id}.json`), doc);
    scene.mtimeMs = Date.now();
    bucket.scenes.set(scene.id, scene);
  }

  private async writeProjectFile(bucket: Bucket) {
    const doc = {
      name: bucket.def.name,
      host: bucket.def.host,
      target: bucket.def.target,
      proxies: bucket.def.proxies,
      activeScenes: bucket.def.activeScenes,
    };
    await this.writeJson(
      path.join(this.projectDir(bucket.id), 'project.json'),
      doc,
    );
  }

  private async writeJson(file: string, value: unknown) {
    this.writing += 1;
    try {
      await atomicWrite(file, toPrettyJson(value));
    } finally {
      this.writing -= 1;
    }
  }

  private pushError(relativePath: string, reason: string) {
    this.errors.push({ relativePath, reason });
    this.emit('file-error', { relativePath, reason });
  }

  private requireBucket(pid: string): Bucket {
    const bucket = this.projects.get(pid);
    if (!bucket) {
      throw new HttpError(404, 'not_found', `项目不存在：${pid}`);
    }
    return bucket;
  }

  private requireReadyBucket(pid: string): Bucket {
    this.ensureReady();
    const bucket = this.requireBucket(pid);
    if (!bucket.loaded) {
      throw new HttpError(
        412,
        'project_disabled',
        `项目 ${pid} 的 project.json 未成功加载，请先修复文件`,
        { errors: bucket.errors },
      );
    }
    return bucket;
  }

  private requireScene(bucket: Bucket, id: string): SceneDef {
    const scene = bucket.scenes.get(id);
    if (!scene) {
      throw new HttpError(404, 'not_found', `Scene 不存在：${id}`);
    }
    return scene;
  }

  private requireApi(bucket: Bucket, id: string): ApiDef {
    const api = bucket.apis.find((item) => item.id === id);
    if (!api) {
      throw new HttpError(404, 'not_found', `接口不存在：${id}`);
    }
    return api;
  }

  private ensureBound() {
    if (!this.mocksRoot) {
      throw new HttpError(412, 'unbound', '尚未绑定工作区');
    }
  }

  private ensureReady() {
    this.ensureBound();
    if (!this.ready) {
      throw new HttpError(
        412,
        'not_ready',
        'config.json 尚未成功加载，请先初始化 mocks 骨架或修复文件',
        { errors: this.errors },
      );
    }
  }

  private relDataPath(pid: string, apiId: string, variant: string) {
    return `projects/${pid}/data/${apiId}/${variant}.json`;
  }

  private configFile() {
    return path.join(this.mocksRoot, 'config.json');
  }

  private projectsDir() {
    return path.join(this.mocksRoot, 'projects');
  }

  private projectDir(pid: string) {
    return path.join(this.projectsDir(), pid);
  }

  private apisFile(pid: string) {
    return path.join(this.projectDir(pid), 'apis.json');
  }

  private scenesDir(pid: string) {
    return path.join(this.projectDir(pid), 'scenes');
  }

  private dataDir(pid: string) {
    return path.join(this.projectDir(pid), 'data');
  }
}

function normalizeApi(input: Partial<ApiDef> & { id?: string }): ApiDef {
  if (!input.id) {
    throw new Error('缺少 id');
  }
  assertSafeId(input.id, '接口 id');
  const method = String(input.method || 'GET').toUpperCase();
  const url = String(input.url || '');
  if (!url.startsWith('/')) {
    throw new HttpError(400, 'invalid', 'url 须以 / 开头');
  }
  if (url === '/__admin' || url.startsWith('/__admin/')) {
    throw new HttpError(400, 'invalid', '禁止注册 /__admin 前缀');
  }
  return {
    id: input.id,
    method,
    url,
    desc: input.desc ? String(input.desc) : undefined,
  };
}

function sanitizeEntry(entry: SceneApiEntry): SceneApiEntry {
  const out: SceneApiEntry = {
    data: String(entry?.data || ''),
    enabled: entry?.enabled !== false,
  };
  if (entry?.status !== undefined) {
    out.status = normalizeStatus(entry.status);
  }
  if (entry?.delay !== undefined) {
    out.delay = normalizeDelay(entry.delay);
  }
  if (entry?.headers) {
    out.headers = normalizeHeaders(entry.headers);
  }
  const keyword = String(entry?.keyword || '').trim();
  if (keyword) {
    out.keyword = keyword;
  }
  const describe = String(entry?.describe || '').trim();
  if (describe) {
    out.describe = describe;
  }
  const apiId = String(entry?.apiId || '').trim();
  if (apiId) {
    out.apiId = apiId;
  }
  return out;
}
