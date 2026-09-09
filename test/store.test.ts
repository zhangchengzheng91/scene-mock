import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store';
import { HttpError } from '../src/core/http-error';

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
    assert.ok(store.routes.match('GET', '/api/orders'));
    assert.ok(store.routes.match('POST', '/api/orders'));
    assert.equal(store.routes.match('GET', '/api/users/1'), null);
  });

  it('keeps previous apis.json when the file is broken', async () => {
    const store = await loaded();
    const file = path.join(store.mocksRoot, 'apis.json');
    await fs.promises.writeFile(file, '{not json', 'utf8');
    await store.reloadAll();
    assert.equal(store.getApis().some((api) => api.id === 'get-orders'), true);
    assert.equal(store.getErrors().some((e) => e.relativePath === 'apis.json'), true);
  });

  it('copies another scene into a new variant file', async () => {
    const store = await loaded();
    await store.createScene({ id: 'copy-test', name: '复制测试' });
    await store.copySceneApi('copy-test', 'get-orders', 'normal-order');
    const detail = store.getSceneDetail('copy-test');
    const entry = detail.entries.find((e) => e.apiId === 'get-orders');
    assert.ok(entry);
    assert.notEqual(entry!.variant, 'list');
    const src = path.join(store.mocksRoot, 'data/get-orders/list.json');
    const dest = path.join(store.mocksRoot, `data/get-orders/${entry!.variant}.json`);
    assert.notEqual(src, dest);
    assert.equal(fs.existsSync(dest), true);
  });

  it('forks shared variant when writing body', async () => {
    const store = await loaded();
    const before = store.refCount('get-orders', 'list');
    assert.ok(before.length >= 2);
    const result = await store.upsertSceneApi('order-error', 'get-orders', {
      body: { forked: true },
    });
    assert.equal(result.forked, true);
    assert.notEqual(result.variant, 'list');
    const still = store.getVariantBody('get-orders', 'list') as { code?: number };
    assert.equal(still.code, 0);
  });

  it('returns 409 when activating overlapping scenes', async () => {
    const store = await loaded();
    await assert.rejects(
      () => store.activate('empty-data'),
      (err: unknown) => err instanceof HttpError && err.status === 409,
    );
    assert.deepEqual(store.getConfig().activeScenes, ['normal-order']);
    await store.resolveActivate({ sceneId: 'empty-data', action: 'keep-new' });
    assert.deepEqual(store.getConfig().activeScenes, ['empty-data']);
    assert.ok(store.routes.match('GET', '/api/orders'));
    assert.equal(store.routes.match('POST', '/api/orders'), null);
  });

  it('stores keyword without affecting routes', async () => {
    const store = await loaded();
    await store.upsertSceneApi('normal-order', 'get-orders', { keyword: 'PASS-A' });
    const entry = store.getSceneDetail('normal-order').entries.find((e) => e.apiId === 'get-orders');
    assert.equal(entry?.keyword, 'PASS-A');
    assert.ok(store.routes.match('GET', '/api/orders'));
  });

  it('stores describe without affecting routes', async () => {
    const store = await loaded();
    await store.upsertSceneApi('normal-order', 'get-orders', { describe: '订单列表' });
    const entry = store.getSceneDetail('normal-order').entries.find((e) => e.apiId === 'get-orders');
    assert.equal(entry?.describe, '订单列表');
    assert.ok(store.routes.match('GET', '/api/orders'));
  });

  it('disables a proxy without removing the scene', async () => {
    const store = await loaded();
    await store.upsertSceneApi('normal-order', 'get-orders', { enabled: false });
    assert.equal(store.routes.match('GET', '/api/orders'), null);
    assert.ok(store.routes.match('POST', '/api/orders'));
    const listed = store.listScenes().find((s) => s.id === 'normal-order');
    assert.equal(listed?.enabledCount, 1);
    assert.equal(listed?.apiCount, 2);
  });

  it('toggles all proxies for a scene', async () => {
    const store = await loaded();
    await store.setSceneApisEnabled('normal-order', false);
    assert.equal(store.routes.match('GET', '/api/orders'), null);
    assert.equal(store.routes.match('POST', '/api/orders'), null);
    assert.equal(store.getConfig().activeScenes.includes('normal-order'), false);
    await store.setSceneApisEnabled('normal-order', true);
    assert.ok(store.routes.match('GET', '/api/orders'));
    assert.ok(store.routes.match('POST', '/api/orders'));
    const listed = store.listScenes().find((s) => s.id === 'normal-order');
    assert.equal(listed?.enabledCount, 2);
    assert.equal(listed?.active, true);
  });

  it('enabling one proxy on an inactive scene isolates the others', async () => {
    const store = await loaded();
    await store.setSceneApisEnabled('normal-order', false);
    await store.upsertSceneApi('normal-order', 'get-orders', { enabled: true });
    assert.ok(store.routes.match('GET', '/api/orders'));
    assert.equal(store.routes.match('POST', '/api/orders'), null);
    const listed = store.listScenes().find((s) => s.id === 'normal-order');
    assert.equal(listed?.enabledCount, 1);
  });
});
