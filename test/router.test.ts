import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Router from '@koa/router';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import setupRouter from '../src/uiServer/router';
import { initContext } from '../src/context';

process.env.SCENE_MOCK_RULES_FILE = path.join(os.tmpdir(), `scene-mock-rules-${process.pid}.txt`);

function mockOptions(): Whistle.PluginOptions {
  const kv = new Map<string, string>();
  return {
    localStorage: {
      getProperty: (key: string) => kv.get(key) || '',
      setProperty: (key: string, value: string) => {
        kv.set(key, value);
      },
    },
    sharedStorage: undefined,
    config: {},
    updateRules: () => undefined,
    getHttpsStatus: (cb: (status: unknown) => void) => cb({ enable: true }),
  } as unknown as Whistle.PluginOptions;
}

describe('router (admin api)', () => {
  let base = '';
  let server: ReturnType<Koa['callback']> extends never ? never : import('http').Server;
  let mocksRoot = '';
  let appCtx: ReturnType<typeof initContext>;

  before(async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scene-mock-router-'));
    mocksRoot = path.join(dir, 'mocks');
    await fs.promises.cp(
      path.resolve(process.cwd(), 'fixtures/mocks'),
      mocksRoot,
      { recursive: true },
    );
    const ctx = initContext(mockOptions());
    appCtx = ctx;
    await ctx.bindWorkspace(mocksRoot);
    const app = new Koa();
    app.use(bodyParser());
    const router = new Router();
    setupRouter(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.on('listening', resolve));
    const { port } = server!.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/cgi-bin`;
  });

  after(async () => {
    server?.close();
    appCtx?.store.close();
  });

  async function call(method: string, pathName: string, body?: unknown) {
    const res = await fetch(`${base}${pathName}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  it('lists projects with summary fields', async () => {
    const { status, data } = await call('GET', '/projects');
    assert.equal(status, 200);
    assert.equal(data.length, 1);
    assert.equal(data[0].id, 'example');
    assert.equal(data[0].host, 'www.example1.com');
    assert.equal(data[0].target, 'http://localhost:8889');
    assert.equal(data[0].sceneCount, 3);
    assert.equal(data[0].routeCount, 2);
  });

  it('rejects duplicate host on create with 409 duplicate_host', async () => {
    const { status, data } = await call('POST', '/projects', {
      name: '重复',
      host: 'HTTP://www.example1.com/',
    });
    assert.equal(status, 409);
    assert.equal(data.error, 'duplicate_host');
    assert.equal(data.details.projectId, 'example');
  });

  it('creates a project skeleton and normalizes host/target', async () => {
    const { status, data } = await call('POST', '/projects', {
      id: 'local',
      name: '本地服务',
      host: 'http://LocalHost:8890/',
      target: 'localhost:9999',
    });
    assert.equal(status, 200);
    assert.equal(data.host, 'localhost');
    assert.equal(data.target, 'http://localhost:9999');
    assert.equal(data.activeScenes.length, 0);
    assert.ok(fs.existsSync(path.join(mocksRoot, 'projects/local/project.json')));
  });

  it('deletes a project only after confirm', async () => {
    const preview = await call('DELETE', '/projects/local');
    assert.equal(preview.status, 409);
    assert.equal(preview.data.error, 'confirm_required');
    const done = await call('DELETE', '/projects/local?confirm=1');
    assert.equal(done.status, 200);
    assert.equal(done.data.ok, true);
    assert.equal(fs.existsSync(path.join(mocksRoot, 'projects/local')), false);
  });

  it('scopes scenes and activation conflicts by project', async () => {
    const scenes = await call('GET', '/projects/example/scenes');
    assert.equal(scenes.status, 200);
    assert.equal(scenes.data.length, 3);

    const conflict = await call('POST', '/projects/example/activate', {
      sceneId: 'empty-data',
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.details.error, 'scene_conflict');
    assert.equal(conflict.data.details.projectId, 'example');
    assert.equal(conflict.data.details.incoming.id, 'empty-data');

    const resolved = await call('POST', '/projects/example/activate/resolve', {
      sceneId: 'empty-data',
      action: 'keep-new',
    });
    assert.equal(resolved.status, 200);
    assert.deepEqual(resolved.data.activeScenes, ['empty-data']);
    // 还原
    await call('POST', '/projects/example/activate/resolve', {
      sceneId: 'normal-order',
      action: 'keep-new',
    });
  });

  it('returns status with per-project runtime', async () => {
    const { status, data } = await call('GET', '/status');
    assert.equal(status, 200);
    assert.ok(data.projects.example);
    assert.ok(Array.isArray(data.unresolvedHosts));
    assert.ok(Array.isArray(data.orphans));
  });

  it('updates global config and whistle rules text', async () => {
    const put = await call('PUT', '/config', {
      matchPatterns: ['/api/', '/gateway/'],
      unmatched: '404',
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.data.matchPatterns, ['/api/', '/gateway/']);
    const rules = await call('GET', '/whistle-rules');
    assert.match(rules.data.text, /^\/gateway\/ scene-mock:\/\/$/m);
    assert.match(
      rules.data.text,
      /^www\.example1\.com scene-mock:\/\/$/m,
    );
  });
});
