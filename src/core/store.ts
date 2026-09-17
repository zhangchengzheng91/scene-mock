import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import {
  applyKeepNew,
  detectActivateConflict,
  detectActiveSetConflicts,
  DataIndex,
} from './conflict';
import { atomicWrite, exists, previewJson, readText, rmrf, toPrettyJson } from './fs-utils';
import { HttpError } from './http-error';
import { assertSafeId, nextVariantName } from './ids';
import { normalizeDelay, normalizeHeaders, normalizeStatus } from './normalize';
import { RouteTable } from './route-table';
import {
  ActiveSetConflictPayload,
  ApiDef,
  AppConfig,
  DEFAULT_CONFIG,
  FileError,
  isEntryEnabled,
  entryApiId,
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

export interface StoreSnapshot {
  bound: boolean;
  ready: boolean;
  mocksRoot: string;
  apis: ApiDef[];
  scenes: SceneDef[];
  config: AppConfig;
  errors: FileError[];
  pendingConflict: SceneConflictPayload | ActiveSetConflictPayload | null;
  orphans: { apiId: string; variant: string; dataPath: string }[];
}

type Watcher = fs.FSWatcher;

export class Store extends EventEmitter {
  mocksRoot = '';
  private apis: ApiDef[] = [];
  private scenes = new Map<string, SceneDef>();
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private dataIndex: DataIndex = new Map();
  private errors: FileError[] = [];
  private apisLoaded = false;
  private configLoaded = false;
  pendingConflict: SceneConflictPayload | ActiveSetConflictPayload | null = null;
  private pendingEnable: {
    sceneId: string;
    enableApiIds: string[];
    isolateOthers: boolean;
  } | null = null;
  readonly routes = new RouteTable();
  private watcher: Watcher | null = null;
  private extraWatchers: Watcher[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private writing = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  get ready(): boolean {
    return Boolean(this.mocksRoot) && this.apisLoaded && this.configLoaded;
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
    this.apis = [];
    this.scenes = new Map();
    this.config = { ...DEFAULT_CONFIG };
    this.dataIndex = new Map();
    this.errors = [];
    this.apisLoaded = false;
    this.configLoaded = false;
    this.pendingConflict = null;
    this.pendingEnable = null;
    this.routes.clear();
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
      apis: this.apis.slice(),
      scenes: [...this.scenes.values()].map((s) => ({ ...s })),
      config: { ...this.config, activeScenes: this.config.activeScenes.slice() },
      errors: this.errors.slice(),
      pendingConflict: this.pendingConflict,
      orphans: this.listOrphans(),
    };
  }

  getApis() {
    return this.apis.slice();
  }

  getApiMap() {
    return new Map(this.apis.map((api) => [api.id, api]));
  }

  getScenes() {
    return this.scenes;
  }

  getConfig() {
    return {
      ...this.config,
      activeScenes: this.config.activeScenes.slice(),
    };
  }

  getErrors() {
    return this.errors.slice();
  }

  listScenes(): SceneListItem[] {
    const active = new Set(this.config.activeScenes);
    return [...this.scenes.values()]
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

  usedByApi(apiId: string): string[] {
    const used: string[] = [];
    for (const scene of this.scenes.values()) {
      const hit = Object.entries(scene.apis || {}).some(
        ([entryId, entry]) => entryApiId(entryId, entry) === apiId,
      );
      if (hit) {
        used.push(scene.id);
      }
    }
    return used;
  }

  refCount(apiId: string, variant: string): string[] {
    const used: string[] = [];
    for (const scene of this.scenes.values()) {
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

  getSceneDetail(id: string) {
    const scene = this.requireScene(id);
    const apiMap = this.getApiMap();
    const entries: SceneEntryView[] = Object.keys(scene.apis || {}).map((entryId) => {
      const entry = scene.apis[entryId];
      const apiId = entryApiId(entryId, entry);
      const api = apiMap.get(apiId);
      const unset = !entry?.data;
      const missing = !unset && !this.dataIndex.get(apiId)?.has(entry.data);
      const usedBy = entry?.data ? this.refCount(apiId, entry.data) : [];
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
          ? this.rel(`data/${apiId}/${entry.data}.json`)
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
      filePath: this.rel(`scenes/${id}.json`),
      active: this.config.activeScenes.includes(id),
      entries,
    };
  }

  listVariants(apiId: string): VariantView[] {
    this.requireApi(apiId);
    const variants = this.dataIndex.get(apiId);
    const names = new Set<string>([...(variants?.keys() || [])]);
    for (const scene of this.scenes.values()) {
      for (const [entryId, entry] of Object.entries(scene.apis || {})) {
        if (entryApiId(entryId, entry) === apiId && entry?.data) {
          names.add(entry.data);
        }
      }
    }
    return [...names].sort().map((variant) => ({
      variant,
      usedBy: this.refCount(apiId, variant),
      dataPath: this.rel(`data/${apiId}/${variant}.json`),
    }));
  }

  getVariantBody(apiId: string, variant: string): unknown {
    const variants = this.dataIndex.get(apiId);
    if (!variants || !variants.has(variant)) {
      throw new HttpError(404, 'not_found', `variant 不存在：${apiId}/${variant}`);
    }
    return variants.get(variant);
  }

  async initSkeleton(): Promise<void> {
    this.ensureBound();
    await fs.promises.mkdir(this.mocksRoot, { recursive: true });
    await fs.promises.mkdir(this.scenesDir(), { recursive: true });
    await fs.promises.mkdir(this.dataDir(), { recursive: true });
    if (!exists(this.apisFile())) {
      await this.writeJson(this.apisFile(), []);
    }
    if (!exists(this.configFile())) {
      await this.writeJson(this.configFile(), DEFAULT_CONFIG);
    }
    await this.reloadAll();
    this.watch();
  }

  async createApi(input: { id: string; method: string; url: string; desc?: string }) {
    return this.enqueue(async () => {
      this.ensureReady();
      const id = assertSafeId(input.id, '接口 id');
      if (this.apis.some((api) => api.id === id)) {
        throw new HttpError(400, 'duplicate_id', `接口 id 已存在：${id}`);
      }
      const api = normalizeApi({ ...input, id });
      this.apis.push(api);
      await this.writeJson(this.apisFile(), this.apis);
      this.rebuild();
      this.emitChange();
      return api;
    });
  }

  async updateApi(id: string, patch: Partial<ApiDef>) {
    return this.enqueue(async () => {
      this.ensureReady();
      const index = this.apis.findIndex((api) => api.id === id);
      if (index < 0) {
        throw new HttpError(404, 'not_found', `接口不存在：${id}`);
      }
      const nextId = patch.id && patch.id !== id
        ? assertSafeId(patch.id, '接口 id')
        : id;
      if (nextId !== id) {
        await this.renameApi(id, nextId);
      }
      const current = this.apis.find((api) => api.id === nextId)!;
      const merged = normalizeApi({
        ...current,
        method: patch.method ?? current.method,
        url: patch.url ?? current.url,
        desc: patch.desc !== undefined ? patch.desc : current.desc,
      });
      this.apis = this.apis.map((api) => (api.id === nextId ? merged : api));
      await this.writeJson(this.apisFile(), this.apis);
      this.rebuild();
      this.emitChange();
      return merged;
    });
  }

  async deleteApi(id: string, force = false) {
    return this.enqueue(async () => {
      this.ensureReady();
      this.requireApi(id);
      const usedBy = this.usedByApi(id);
      if (usedBy.length && !force) {
        throw new HttpError(
          409,
          'api_in_use',
          `接口仍被 ${usedBy.length} 个 Scene 引用`,
          { usedBy },
        );
      }
      for (const scene of this.scenes.values()) {
        let changed = false;
        for (const [entryId, entry] of Object.entries(scene.apis || {})) {
          if (entryApiId(entryId, entry) === id) {
            delete scene.apis[entryId];
            changed = true;
          }
        }
        if (changed) {
          await this.writeSceneFile(scene);
        }
      }
      this.apis = this.apis.filter((api) => api.id !== id);
      await this.writeJson(this.apisFile(), this.apis);
      await rmrf(path.join(this.dataDir(), id));
      this.dataIndex.delete(id);
      this.rebuild();
      this.emitChange();
    });
  }

  async createScene(input: {
    id: string;
    name: string;
    desc?: string;
    copyFrom?: string;
  }) {
    return this.enqueue(async () => {
      this.ensureReady();
      const id = assertSafeId(input.id, 'Scene id');
      if (this.scenes.has(id)) {
        throw new HttpError(400, 'duplicate_id', `Scene 已存在：${id}`);
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
        const source = this.requireScene(input.copyFrom);
        for (const [apiId, entry] of Object.entries(source.apis || {})) {
          const copied = await this.copyEntryToScene(id, apiId, entry);
          scene.apis[apiId] = copied;
        }
      }
      await this.writeSceneFile(scene);
      this.scenes.set(id, scene);
      this.rebuild();
      this.emitChange();
      return this.getSceneDetail(id);
    });
  }

  async updateScene(
    id: string,
    patch: { name?: string; desc?: string; apis?: Record<string, SceneApiEntry> },
  ) {
    return this.enqueue(async () => {
      this.ensureReady();
      const scene = this.requireScene(id);
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
          this.requireApi(entryApiId(entryId, entry));
          next[entryId] = sanitizeEntry(entry);
        }
        scene.apis = next;
      }
      await this.writeSceneFile(scene);
      this.rebuild();
      this.emitChange();
      return this.getSceneDetail(id);
    });
  }

  async deleteScene(id: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      this.requireScene(id);
      const beforeOrphans = new Set(
        this.listOrphans().map((o) => `${o.apiId}/${o.variant}`),
      );
      this.scenes.delete(id);
      if (this.config.activeScenes.includes(id)) {
        this.config.activeScenes = this.config.activeScenes.filter((s) => s !== id);
        await this.writeJson(this.configFile(), this.config);
      }
      const file = path.join(this.scenesDir(), `${id}.json`);
      await fs.promises.unlink(file).catch(() => { /* ignore */ });
      this.rebuild();
      const orphans = this.listOrphans().filter(
        (o) => !beforeOrphans.has(`${o.apiId}/${o.variant}`),
      );
      this.emitChange();
      return { orphans };
    });
  }

  async upsertSceneApi(
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
      this.ensureReady();
      const scene = this.requireScene(sceneId);
      const existed = Boolean(scene.apis[entryId]);
      const current = scene.apis[entryId] || { data: '' };
      const apiId = entryApiId(entryId, current);
      this.requireApi(apiId);
      let variant = patch.data || current.data;
      let forked = false;
      if (variant) {
        assertSafeId(variant, 'variant');
      }
      if (patch.body !== undefined) {
        if (!variant) {
          variant = nextVariantName(this.variantNames(apiId), sceneId);
        } else {
          const usedBy = this.refCount(apiId, variant);
          const others = usedBy.filter((sid) => sid !== sceneId);
          if (others.length > 0) {
            variant = nextVariantName(this.variantNames(apiId), sceneId);
            forked = true;
          }
        }
        await this.writeDataFile(apiId, variant, patch.body);
      } else if (!variant) {
        variant = nextVariantName(this.variantNames(apiId), sceneId);
        await this.writeDataFile(apiId, variant, {});
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
        const isolate = !this.config.activeScenes.includes(sceneId);
        const previewApis: Record<string, SceneApiEntry> = {};
        for (const [id, entry] of Object.entries(scene.apis || {})) {
          previewApis[id] = isolate && id !== entryId
            ? sanitizeEntry({ ...entry, enabled: false })
            : (id === entryId ? next : entry);
        }
        previewApis[entryId] = next;
        const conflict = detectActivateConflict(
          { ...scene, apis: previewApis },
          this.config.activeScenes,
          this.scenes,
          this.getApiMap(),
          this.dataIndex,
        );
        if (conflict) {
          this.pendingEnable = {
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
        if (!this.config.activeScenes.includes(sceneId)) {
          this.config.activeScenes = [...this.config.activeScenes, sceneId];
          await this.writeJson(this.configFile(), this.config);
        }
      } else {
        scene.apis[entryId] = next;
        if (
          patch.enabled === false
          && !Object.values(scene.apis).some((entry) => isEntryEnabled(entry))
        ) {
          this.config.activeScenes = this.config.activeScenes.filter((id) => id !== sceneId);
          await this.writeJson(this.configFile(), this.config);
        }
      }
      await this.writeSceneFile(scene);
      this.rebuild();
      this.emitChange();
      return { forked, variant, entry: this.getSceneDetail(sceneId) };
    });
  }

  async setSceneApisEnabled(sceneId: string, enabled: boolean) {
    return this.enqueue(async () => {
      this.ensureReady();
      const scene = this.requireScene(sceneId);
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
          preview,
          this.config.activeScenes,
          this.scenes,
          this.getApiMap(),
          this.dataIndex,
        );
        if (conflict) {
          this.pendingEnable = {
            sceneId,
            enableApiIds: Object.keys(scene.apis || {}),
            isolateOthers: false,
          };
          throw new HttpError(409, 'scene_conflict', '与已激活 Scene 存在接口重合', conflict);
        }
        if (!this.config.activeScenes.includes(sceneId)) {
          this.config.activeScenes = [...this.config.activeScenes, sceneId];
          await this.writeJson(this.configFile(), this.config);
        }
      }
      for (const apiId of Object.keys(scene.apis || {})) {
        scene.apis[apiId] = sanitizeEntry({ ...scene.apis[apiId], enabled });
      }
      await this.writeSceneFile(scene);
      if (!enabled) {
        this.config.activeScenes = this.config.activeScenes.filter((id) => id !== sceneId);
        await this.writeJson(this.configFile(), this.config);
      }
      this.pendingConflict = null;
      this.rebuild();
      this.emitChange();
      return this.getSceneDetail(sceneId);
    });
  }

  async copySceneApi(sceneId: string, entryId: string, fromSceneId: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      const scene = this.requireScene(sceneId);
      const dest = scene.apis[entryId];
      const apiId = entryApiId(entryId, dest);
      this.requireApi(apiId);
      const source = this.requireScene(fromSceneId);
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
      scene.apis[entryId] = await this.copyEntryToScene(sceneId, apiId, {
        ...entry,
        apiId: dest?.apiId,
      });
      await this.writeSceneFile(scene);
      this.rebuild();
      this.emitChange();
      return this.getSceneDetail(sceneId);
    });
  }

  async duplicateSceneApi(sceneId: string, entryId: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      const scene = this.requireScene(sceneId);
      const source = scene.apis[entryId];
      if (!source) {
        throw new HttpError(404, 'not_found', `Scene 未包含该接口条目`);
      }
      const apiId = entryApiId(entryId, source);
      this.requireApi(apiId);
      const nextId = nextVariantName(new Set(Object.keys(scene.apis || {})), `${apiId}-copy`);
      const copied = await this.copyEntryToScene(sceneId, apiId, source);
      const describeBase = String(source.describe || '').trim() || apiId;
      scene.apis[nextId] = sanitizeEntry({
        ...copied,
        apiId,
        describe: `${describeBase}-复制`,
        enabled: false,
      });
      await this.writeSceneFile(scene);
      this.rebuild();
      this.emitChange();
      return this.getSceneDetail(sceneId);
    });
  }

  async shareSceneApi(sceneId: string, entryId: string, variant: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      const scene = this.requireScene(sceneId);
      const current = scene.apis[entryId] || { data: variant };
      const apiId = entryApiId(entryId, current);
      this.requireApi(apiId);
      assertSafeId(variant, 'variant');
      if (!this.dataIndex.get(apiId)?.has(variant)) {
        throw new HttpError(404, 'not_found', `variant 不存在：${variant}`);
      }
      scene.apis[entryId] = sanitizeEntry({ ...current, data: variant });
      await this.writeSceneFile(scene);
      this.rebuild();
      this.emitChange();
      return this.getSceneDetail(sceneId);
    });
  }

  async writeVariant(
    apiId: string,
    variant: string,
    body: unknown,
    opts: { fork?: boolean; sceneId?: string } = {},
  ) {
    return this.enqueue(async () => {
      this.ensureReady();
      this.requireApi(apiId);
      assertSafeId(variant, 'variant');
      const usedBy = this.refCount(apiId, variant);
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
        const scene = this.requireScene(opts.sceneId);
        const match = Object.entries(scene.apis || {}).find(
          ([id, entry]) => entryApiId(id, entry) === apiId && entry.data === variant,
        );
        if (!match) {
          throw new HttpError(400, 'invalid', '该 Scene 未引用此 variant');
        }
        target = nextVariantName(this.variantNames(apiId), opts.sceneId);
        scene.apis[match[0]] = { ...match[1], data: target };
        await this.writeSceneFile(scene);
        forked = true;
      }
      await this.writeDataFile(apiId, target, body);
      this.rebuild();
      this.emitChange();
      return { forked, variant: target };
    });
  }

  async deleteVariant(apiId: string, variant: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      this.requireApi(apiId);
      assertSafeId(variant, 'variant');
      const usedBy = this.refCount(apiId, variant);
      if (usedBy.length) {
        throw new HttpError(
          409,
          'variant_in_use',
          '仍被 Scene 引用，无法删除',
          { usedBy },
        );
      }
      const file = path.join(this.dataDir(), apiId, `${variant}.json`);
      await fs.promises.unlink(file).catch(() => { /* ignore */ });
      this.dataIndex.get(apiId)?.delete(variant);
      this.rebuild();
      this.emitChange();
    });
  }

  async activate(sceneId: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      const scene = this.requireScene(sceneId);
      if (this.config.activeScenes.includes(sceneId)) {
        return { ok: true as const, activeScenes: this.config.activeScenes };
      }
      const conflict = detectActivateConflict(
        scene,
        this.config.activeScenes,
        this.scenes,
        this.getApiMap(),
        this.dataIndex,
      );
      if (conflict) {
        throw new HttpError(409, 'scene_conflict', '与已激活 Scene 存在接口重合', conflict);
      }
      this.config.activeScenes = [...this.config.activeScenes, sceneId];
      await this.writeJson(this.configFile(), this.config);
      this.pendingConflict = null;
      this.rebuild();
      this.emitChange();
      return { ok: true as const, activeScenes: this.config.activeScenes };
    });
  }

  async resolveActivate(input: {
    sceneId?: string;
    action: 'keep-new' | 'keep-old' | 'replace';
    activeScenes?: string[];
  }) {
    return this.enqueue(async () => {
      this.ensureReady();
      if (input.action === 'keep-old') {
        this.pendingEnable = null;
        return { ok: true as const, activeScenes: this.config.activeScenes };
      }
      if (input.action === 'replace') {
        const list = input.activeScenes || [];
        this.assertConflictFree(list);
        this.config.activeScenes = list;
        await this.writeJson(this.configFile(), this.config);
        this.pendingConflict = null;
        this.pendingEnable = null;
        this.rebuild();
        this.emitChange();
        return { ok: true as const, activeScenes: this.config.activeScenes };
      }
      if (!input.sceneId) {
        throw new HttpError(400, 'invalid', 'keep-new 需要 sceneId');
      }
      const scene = this.requireScene(input.sceneId);
      const pending = this.pendingEnable;
      this.pendingEnable = null;
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
        await this.writeSceneFile(scene);
      }
      const conflict = detectActivateConflict(
        scene,
        this.config.activeScenes,
        this.scenes,
        this.getApiMap(),
        this.dataIndex,
      );
      const close = conflict?.closeScenesIfKeepNew || [];
      this.config.activeScenes = applyKeepNew(
        this.config.activeScenes,
        input.sceneId,
        close,
      );
      await this.writeJson(this.configFile(), this.config);
      this.pendingConflict = null;
      this.rebuild();
      this.emitChange();
      return { ok: true as const, activeScenes: this.config.activeScenes };
    });
  }

  async deactivate(sceneId: string) {
    return this.enqueue(async () => {
      this.ensureReady();
      this.requireScene(sceneId);
      this.config.activeScenes = this.config.activeScenes.filter((id) => id !== sceneId);
      await this.writeJson(this.configFile(), this.config);
      this.pendingConflict = detectActiveSetConflicts(
        this.config.activeScenes,
        this.scenes,
        this.getApiMap(),
        this.dataIndex,
      );
      this.rebuild();
      this.emitChange();
      return { ok: true as const, activeScenes: this.config.activeScenes };
    });
  }

  async updateConfig(patch: Partial<AppConfig>) {
    return this.enqueue(async () => {
      this.ensureReady();
      if (patch.proxyTarget !== undefined) {
        this.config.proxyTarget = String(patch.proxyTarget || '');
      }
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
      this.rebuild();
      this.emitChange();
      return this.getConfig();
    });
  }

  whistleRulesText(): string {
    const patterns = this.config.matchPatterns || [];
    const lines = [
      '# scene-mock · 短协议才会进插件 server',
      '# 插件禁用后这条（以及插件 rules.txt）都失效',
    ];
    if (!patterns.length) {
      lines.push('# （当前 matchPatterns 为空，不会自动劫持请求）');
    }
    for (const pattern of patterns) {
      lines.push(`${pattern} scene-mock://`);
    }
    return `${lines.join('\n')}\n`;
  }

  pluginRulesText(): string {
    const patterns = this.ready ? (this.config.matchPatterns || []) : [];
    const lines = ['# generated by whistle.scene-mock — do not edit'];
    for (const pattern of patterns) {
      if (pattern && pattern.trim()) {
        lines.push(`${pattern.trim()} scene-mock://`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private async renameApi(oldId: string, newId: string) {
    if (this.apis.some((api) => api.id === newId)) {
      throw new HttpError(400, 'duplicate_id', `接口 id 已存在：${newId}`);
    }
    const oldDir = path.join(this.dataDir(), oldId);
    const newDir = path.join(this.dataDir(), newId);
    try {
      if (exists(oldDir)) {
        if (exists(newDir)) {
          throw new HttpError(400, 'duplicate_id', `data/${newId}/ 已存在`);
        }
        await fs.promises.rename(oldDir, newDir);
      }
      for (const scene of this.scenes.values()) {
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
          await this.writeSceneFile(scene);
        }
      }
      this.apis = this.apis.map((api) => (
        api.id === oldId ? { ...api, id: newId } : api
      ));
      const data = this.dataIndex.get(oldId);
      if (data) {
        this.dataIndex.set(newId, data);
        this.dataIndex.delete(oldId);
      }
      await this.writeJson(this.apisFile(), this.apis);
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
    sceneId: string,
    apiId: string,
    entry: SceneApiEntry,
  ): Promise<SceneApiEntry> {
    const variant = nextVariantName(this.variantNames(apiId), sceneId);
    let body: unknown = {};
    if (entry.data && this.dataIndex.get(apiId)?.has(entry.data)) {
      body = this.dataIndex.get(apiId)!.get(entry.data);
    }
    await this.writeDataFile(apiId, variant, body);
    return sanitizeEntry({ ...entry, data: variant });
  }

  private variantNames(apiId: string): Set<string> {
    return new Set(this.dataIndex.get(apiId)?.keys() || []);
  }

  private async writeDataFile(apiId: string, variant: string, body: unknown) {
    const dir = path.join(this.dataDir(), apiId);
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${variant}.json`);
    await this.writeJson(file, body);
    if (!this.dataIndex.has(apiId)) {
      this.dataIndex.set(apiId, new Map());
    }
    this.dataIndex.get(apiId)!.set(variant, body);
  }

  private async writeSceneFile(scene: SceneDef) {
    const doc = {
      name: scene.name,
      desc: scene.desc,
      apis: scene.apis,
    };
    await this.writeJson(path.join(this.scenesDir(), `${scene.id}.json`), doc);
    scene.mtimeMs = Date.now();
    this.scenes.set(scene.id, scene);
  }

  private async writeJson(file: string, value: unknown) {
    this.writing += 1;
    try {
      await atomicWrite(file, toPrettyJson(value));
    } finally {
      this.writing -= 1;
    }
  }

  async reloadAll() {
    if (!this.mocksRoot) {
      return;
    }
    this.errors = [];
    await this.loadApis();
    await this.loadConfig();
    await this.loadScenes();
    await this.loadData();
    this.rebuild();
    this.emitChange();
  }

  private rebuild() {
    if (!this.ready) {
      this.routes.clear();
      this.pendingConflict = null;
      return;
    }
    this.pendingConflict = detectActiveSetConflicts(
      this.config.activeScenes,
      this.scenes,
      this.getApiMap(),
      this.dataIndex,
    );
    if (this.pendingConflict) {
      this.routes.clear();
      this.emit('conflict', this.pendingConflict);
      return;
    }
    this.routes.compile({
      apis: this.apis,
      scenes: this.scenes,
      activeScenes: this.config.activeScenes,
      dataIndex: this.dataIndex,
    });
  }

  private emitChange() {
    this.emit('change');
  }

  private async loadApis() {
    const file = this.apisFile();
    if (!exists(file)) {
      this.pushError('apis.json', '文件不存在');
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
      this.apis = apis;
      this.apisLoaded = true;
    } catch (err) {
      this.pushError('apis.json', (err as Error).message);
    }
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
        proxyTarget: String(parsed.proxyTarget || ''),
        activeScenes: Array.isArray(parsed.activeScenes)
          ? parsed.activeScenes.map(String)
          : [],
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

  private async loadScenes() {
    const dir = this.scenesDir();
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
      const rel = `scenes/${name}`;
      try {
        assertSafeId(id, 'Scene id');
        const file = path.join(dir, name);
        const raw = await readText(file);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Scene 文件须为对象');
        }
        if (parsed.extends) {
          this.pushError(rel, '一期忽略 extends 字段');
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
        this.scenes.set(id, {
          id,
          name: parsed.name,
          desc: typeof parsed.desc === 'string' ? parsed.desc : undefined,
          apis,
          mtimeMs: stat.mtimeMs,
        });
        keep.add(id);
      } catch (err) {
        this.pushError(rel, (err as Error).message);
        if (!this.scenes.has(id)) {
          // new bad file: do not add
        }
      }
    }
    for (const id of [...this.scenes.keys()]) {
      if (!keep.has(id) && names.includes(`${id}.json`) === false) {
        this.scenes.delete(id);
      }
    }
  }

  private async loadData() {
    const dir = this.dataDir();
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
        const rel = `data/${apiId}/${name}`;
        try {
          assertSafeId(variant, 'variant');
          const raw = await readText(path.join(dir, apiId, name));
          if (!raw.trim()) {
            throw new Error('空文件');
          }
          map.set(variant, JSON.parse(raw));
        } catch (err) {
          this.pushError(rel, (err as Error).message);
          const prev = this.dataIndex.get(apiId)?.get(variant);
          if (prev !== undefined || this.dataIndex.get(apiId)?.has(variant)) {
            map.set(variant, this.dataIndex.get(apiId)!.get(variant));
          }
        }
      }
      next.set(apiId, map);
    }
    this.dataIndex = next;
  }

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
          this.emit('file-error', { relativePath: '.', reason: (err as Error).message });
        });
      }, 150);
    };
    try {
      this.watcher = fs.watch(this.mocksRoot, { recursive: true }, onFs);
    } catch {
      this.watcher = fs.watch(this.mocksRoot, onFs);
      for (const sub of [this.scenesDir(), this.dataDir()]) {
        if (exists(sub)) {
          try {
            this.extraWatchers.push(fs.watch(sub, { recursive: true }, onFs));
          } catch {
            this.extraWatchers.push(fs.watch(sub, onFs));
          }
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

  private pushError(relativePath: string, reason: string) {
    this.errors.push({ relativePath, reason });
    this.emit('file-error', { relativePath, reason });
  }

  private listOrphans() {
    const out: { apiId: string; variant: string; dataPath: string }[] = [];
    for (const [apiId, variants] of this.dataIndex) {
      for (const variant of variants.keys()) {
        if (this.refCount(apiId, variant).length === 0) {
          out.push({
            apiId,
            variant,
            dataPath: this.rel(`data/${apiId}/${variant}.json`),
          });
        }
      }
    }
    return out;
  }

  private assertConflictFree(activeScenes: string[]) {
    const conflict = detectActiveSetConflicts(
      activeScenes,
      this.scenes,
      this.getApiMap(),
      this.dataIndex,
    );
    if (conflict) {
      throw new HttpError(409, 'scene_conflict', '激活集合仍有接口重合', conflict);
    }
  }

  private requireScene(id: string): SceneDef {
    const scene = this.scenes.get(id);
    if (!scene) {
      throw new HttpError(404, 'not_found', `Scene 不存在：${id}`);
    }
    return scene;
  }

  private requireApi(id: string): ApiDef {
    const api = this.apis.find((item) => item.id === id);
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
        'apis.json / config.json 尚未成功加载，请先初始化 mocks 骨架或修复文件',
        { errors: this.errors },
      );
    }
  }

  private apisFile() {
    return path.join(this.mocksRoot, 'apis.json');
  }

  private configFile() {
    return path.join(this.mocksRoot, 'config.json');
  }

  private scenesDir() {
    return path.join(this.mocksRoot, 'scenes');
  }

  private dataDir() {
    return path.join(this.mocksRoot, 'data');
  }

  private rel(p: string) {
    return path.join(this.mocksRoot, p);
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
