import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store';
import { HttpError } from '../src/core/http-error';

const PID = 'microcredit';

async function makeRoot() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scene-mock-'));
  const mocks = path.join(dir, 'mocks');
  await fs.promises.cp(
    path.resolve(process.cwd(), 'fixtures/mocks'),
    mocks,
    { recursive: true },
  );
  return mocks;
}

describe('store', () => {
  const stores: Store[] = [];
  afterEach(() => {
    for (const store of stores) {
      store.close();
    }
    stores.length = 0;
  });

  async function loaded() {
    const root = await makeRoot();
    const store = new Store();
    stores.push(store);
    await store.bind(root);
    return store;
  }

  it('compiles only active scenes with existing data files', async () => {
    const store = await loaded();
    assert.equal(store.ready, true);
    const routes = store.projectRoutes(PID);
    assert.ok(routes.match('GET', '/api/orders'));
    assert.ok(routes.match('POST', '/api/orders'));
    assert.equal(routes.match('GET', '/api/users/1'), null);
    const hit = routes.match('GET', '/api/orders');
    assert.equal(hit?.projectId, PID);
    assert.equal(hit?.sceneId, 'normal-order');
  });

  it('keeps previous apis.json when the file is broken', async () => {
    const store = await loaded();
    const file = path.join(store.mocksRoot, 'projects', PID, 'apis.json');
    await fs.promises.writeFile(file, '{not json', 'utf8');
    await store.reloadAll();
    assert.equal(store.getApis(PID).some((api) => api.id === 'get-orders'), true);
    assert.equal(
      store.getErrors().some((e) => e.relativePath === `projects/${PID}/apis.json`),
      true,
    );
  });

  it('copies another scene into a new variant file', async () => {
    const store = await loaded();
    await store.createScene(PID, { id: 'copy-test', name: '复制测试' });
    await store.copySceneApi(PID, 'copy-test', 'get-orders', 'normal-order');
    const detail = store.getSceneDetail(PID, 'copy-test');
    const entry = detail.entries.find((e) => e.apiId === 'get-orders');
    assert.ok(entry);
    assert.notEqual(entry!.variant, 'list');
    const dataDir = path.join(store.mocksRoot, 'projects', PID, 'data', 'get-orders');
    const dest = path.join(dataDir, `${entry!.variant}.json`);
    assert.equal(fs.existsSync(dest), true);
  });

  it('forks shared variant when writing body', async () => {
    const store = await loaded();
    const before = store.refCount(PID, 'get-orders', 'list');
    assert.ok(before.length >= 2);
    const result = await store.upsertSceneApi(PID, 'order-error', 'get-orders', {
      body: { forked: true },
    });
    assert.equal(result.forked, true);
    assert.notEqual(result.variant, 'list');
    const still = store.getVariantBody(PID, 'get-orders', 'list') as { code?: number };
    assert.equal(still.code, 0);
  });

  it('returns 409 when activating overlapping scenes', async () => {
    const store = await loaded();
    await assert.rejects(
      () => store.activate(PID, 'empty-data'),
      (err: unknown) => err instanceof HttpError && err.status === 409,
    );
    assert.deepEqual(store.getProject(PID).activeScenes, ['normal-order']);
    await store.resolveActivate(PID, { sceneId: 'empty-data', action: 'keep-new' });
    assert.deepEqual(store.getProject(PID).activeScenes, ['empty-data']);
    const routes = store.projectRoutes(PID);
    assert.ok(routes.match('GET', '/api/orders'));
    assert.equal(routes.match('POST', '/api/orders'), null);
  });

  it('stores keyword without affecting routes', async () => {
    const store = await loaded();
    await store.upsertSceneApi(PID, 'normal-order', 'get-orders', { keyword: 'PASS-A' });
    const entry = store.getSceneDetail(PID, 'normal-order').entries
      .find((e) => e.apiId === 'get-orders');
    assert.equal(entry?.keyword, 'PASS-A');
    assert.ok(store.projectRoutes(PID).match('GET', '/api/orders'));
  });

  it('stores describe without affecting routes', async () => {
    const store = await loaded();
    await store.upsertSceneApi(PID, 'normal-order', 'get-orders', { describe: '订单列表' });
    const entry = store.getSceneDetail(PID, 'normal-order').entries
      .find((e) => e.apiId === 'get-orders');
    assert.equal(entry?.describe, '订单列表');
    assert.ok(store.projectRoutes(PID).match('GET', '/api/orders'));
  });

  it('disables a proxy without removing the scene', async () => {
    const store = await loaded();
    await store.upsertSceneApi(PID, 'normal-order', 'get-orders', { enabled: false });
    const routes = store.projectRoutes(PID);
    assert.equal(routes.match('GET', '/api/orders'), null);
    assert.ok(routes.match('POST', '/api/orders'));
    const listed = store.listScenes(PID).find((s) => s.id === 'normal-order');
    assert.equal(listed?.enabledCount, 1);
    assert.equal(listed?.apiCount, 2);
  });

  it('toggles all proxies for a scene', async () => {
    const store = await loaded();
    await store.setSceneApisEnabled(PID, 'normal-order', false);
    const routes = store.projectRoutes(PID);
    assert.equal(routes.match('GET', '/api/orders'), null);
    assert.equal(routes.match('POST', '/api/orders'), null);
    assert.equal(store.getProject(PID).activeScenes.includes('normal-order'), false);
    await store.setSceneApisEnabled(PID, 'normal-order', true);
    assert.ok(routes.match('GET', '/api/orders'));
    assert.ok(routes.match('POST', '/api/orders'));
    const listed = store.listScenes(PID).find((s) => s.id === 'normal-order');
    assert.equal(listed?.enabledCount, 2);
    assert.equal(listed?.active, true);
  });

  it('enabling one proxy on an inactive scene isolates the others', async () => {
    const store = await loaded();
    await store.setSceneApisEnabled(PID, 'normal-order', false);
    await store.upsertSceneApi(PID, 'normal-order', 'get-orders', { enabled: true });
    const routes = store.projectRoutes(PID);
    assert.ok(routes.match('GET', '/api/orders'));
    assert.equal(routes.match('POST', '/api/orders'), null);
    const listed = store.listScenes(PID).find((s) => s.id === 'normal-order');
    assert.equal(listed?.enabledCount, 1);
  });

  it('duplicates a scene api with renamed describe and mock off', async () => {
    const store = await loaded();
    await store.upsertSceneApi(PID, 'normal-order', 'get-orders', { describe: '订单列表' });
    await store.duplicateSceneApi(PID, 'normal-order', 'get-orders');
    const detail = store.getSceneDetail(PID, 'normal-order');
    const original = detail.entries.find((e) => e.entryId === 'get-orders');
    const copied = detail.entries.find((e) => e.entryId === 'get-orders-copy');
    assert.equal(original?.describe, '订单列表');
    assert.equal(copied?.apiId, 'get-orders');
    assert.equal(copied?.describe, '订单列表-复制');
    assert.equal(copied?.enabled, false);
    assert.ok(store.projectRoutes(PID).match('GET', '/api/orders'));
    const listed = store.listScenes(PID).find((s) => s.id === 'normal-order');
    assert.equal(listed?.apiCount, 3);
    assert.equal(listed?.enabledCount, 2);
  });

  it('writes whistle rules from matchPatterns and project hosts', async () => {
    const store = await loaded();
    const text = store.pluginRulesText();
    assert.match(text, /^\/api\/ scene-mock:\/\/$/m);
    assert.match(text, /^microcredit-ms-test-c\.jhjj\.paas\.test scene-mock:\/\/$/m);
    // 新建项目后规则带上新 host（项目 host 一律去端口存储）
    await store.createProject({
      id: 'local',
      name: '本地服务',
      host: 'http://localhost:8890',
      target: '',
    });
    const next = store.pluginRulesText();
    assert.match(next, /^localhost scene-mock:\/\/$/m);
  });

  it('rejects invalid or duplicate project id', async () => {
    const store = await loaded();
    await assert.rejects(
      () => store.createProject({ id: '1bad id', name: '非法', host: 'bad.example.com' }),
      (err: unknown) => err instanceof HttpError && err.status === 400,
    );
    await assert.rejects(
      () => store.createProject({ id: PID, name: '重复', host: 'other.example.com' }),
      (err: unknown) => (
        err instanceof HttpError && err.status === 409 && err.code === 'duplicate_id'
      ),
    );
  });

  it('rejects duplicate project host with 409', async () => {
    const store = await loaded();
    await assert.rejects(
      () => store.createProject({
        name: '重复',
        host: 'HTTP://microcredit-ms-test-c.jhjj.paas.test/',
      }),
      (err: unknown) => (
        err instanceof HttpError && err.status === 409 && err.code === 'duplicate_host'
      ),
    );
  });

  it('keeps a path prefix on the proxied host and matches only that path', async () => {
    const store = await loaded();
    const created = await store.createProject({
      id: 'yrxd',
      name: '宜人',
      host: 'http://yrxd.test.creditease.cn/cc',
      target: 'http://yxhms.paas.corp/',
    });
    assert.equal(created.host, 'yrxd.test.creditease.cn/cc');
    assert.equal(created.target, 'http://yxhms.paas.corp');
    assert.match(store.pluginRulesText(), /^yrxd\.test\.creditease\.cn\/cc scene-mock:\/\/$/m);
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/cc')?.id, 'yrxd');
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/cc/api')?.id, 'yrxd');
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/dd'), null);
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/other'), null);
    const other = await store.createProject({
      id: 'yrxd-yy',
      name: '宜人-yy',
      host: 'http://yrxd.test.creditease.cn/yy',
      target: '',
    });
    assert.equal(other.host, 'yrxd.test.creditease.cn/yy');
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/yy/abc')?.id, 'yrxd-yy');
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/abc'), null);
    assert.equal(store.resolveProject('YRXD.test.creditease.cn:80', '/cc/x')?.id, 'yrxd');
  });

  it('matches the longer host path when one project has several proxy pairs', async () => {
    const store = await loaded();
    const paired = await store.createProject({
      id: 'mobile',
      name: 'mobile',
      proxies: [
        { host: 'http://yrxd.test.creditease.cn/cc', target: 'http://localhost:8080' },
        { host: 'http://yrxd.test.creditease.cn', target: 'http://localhost:9090' },
      ],
    });
    assert.equal(paired.host, 'yrxd.test.creditease.cn/cc');
    assert.equal(paired.target, 'http://localhost:8080');
    assert.equal(paired.proxies.length, 2);
    assert.equal(paired.proxies[1].target, 'http://localhost:9090');
    assert.match(store.pluginRulesText(), /^yrxd\.test\.creditease\.cn\/cc scene-mock:\/\/$/m);
    assert.match(store.pluginRulesText(), /^yrxd\.test\.creditease\.cn scene-mock:\/\/$/m);
    assert.equal(store.matchProxy('yrxd.test.creditease.cn', '/cc/login')?.proxy.host, 'yrxd.test.creditease.cn/cc');
    assert.equal(store.matchProxy('yrxd.test.creditease.cn', '/cc/login')?.proxy.target, 'http://localhost:8080');
    assert.equal(store.matchProxy('yrxd.test.creditease.cn', '/static/js/lodash.js')?.proxy.host, 'yrxd.test.creditease.cn');
    assert.equal(store.matchProxy('yrxd.test.creditease.cn', '/static/js/lodash.js')?.proxy.target, 'http://localhost:9090');
    assert.equal(store.resolveProject('yrxd.test.creditease.cn', '/static/js/lodash.js')?.id, 'mobile');
  });

  it('resolves project by host and passes through unknown hosts', async () => {
    const store = await loaded();
    const hit = store.resolveProject('microcredit-ms-test-c.jhjj.paas.test');
    assert.equal(hit?.id, PID);
    // 带端口也能命中
    const withPort = store.resolveProject('microcredit-ms-test-c.jhjj.paas.test:443');
    assert.equal(withPort?.id, PID);
    // 未知 host 不归属任何项目（透传），并记录 unresolvedHosts
    const fallback = store.resolveProject('unknown.example.com');
    assert.equal(fallback, null);
    assert.ok(store.getUnresolvedHosts().includes('unknown.example.com'));
  });

  it('requires confirm before deleting a project', async () => {
    const store = await loaded();
    await assert.rejects(
      () => store.deleteProject(PID),
      (err: unknown) => (
        err instanceof HttpError && err.status === 409 && err.code === 'confirm_required'
      ),
    );
    const result = await store.deleteProject(PID, true);
    assert.equal(result.ok, true);
    assert.equal(result.removed.scenes, 3);
    assert.equal(fs.existsSync(path.join(store.mocksRoot, 'projects', PID)), false);
  });

  it('renames project id', async () => {
    const store = await loaded();
    await store.updateProject(PID, { newId: 'microloan' });
    assert.equal(store.getProject('microloan').host, 'microcredit-ms-test-c.jhjj.paas.test');
    const hit = store.resolveProject('microcredit-ms-test-c.jhjj.paas.test');
    assert.equal(hit?.id, 'microloan');
  });
});
