import Router from '@koa/router';
import { HttpError } from '../core/http-error';
import { getContext } from '../context';

export default function setupRouter(router: Router) {
  router.get('/cgi-bin/events', (ctx) => {
    const app = getContext();
    ctx.req.socket.setTimeout(0);
    ctx.respond = false;
    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    ctx.res.write(': ok\n\n');
    app.sse.add(ctx.res);
  });

  wrap(router, 'get', '/cgi-bin/workspace', async (ctx) => {
    ctx.body = getContext().workspaceView();
  });

  wrap(router, 'put', '/cgi-bin/workspace', async (ctx) => {
    const body = bodyOf(ctx);
    ctx.body = await getContext().bindWorkspace(String(body.mocksRoot || ''));
  });

  wrap(router, 'post', '/cgi-bin/workspace/init', async (ctx) => {
    const app = getContext();
    if (!app.store.mocksRoot) {
      throw new HttpError(412, 'unbound', '尚未绑定工作区');
    }
    await app.store.initSkeleton();
    app.syncRules();
    ctx.body = app.workspaceView();
  });

  wrap(router, 'get', '/cgi-bin/status', async (ctx) => {
    const app = getContext();
    const store = app.store;
    const snap = store.snapshot();
    const httpsCapture = await getHttpsStatus(app.options);
    ctx.body = {
      bound: snap.bound,
      ready: snap.ready,
      mocksRoot: snap.mocksRoot,
      activeScenes: snap.config.activeScenes,
      routeCount: store.routes.size,
      sceneCount: snap.scenes.length,
      apiCount: snap.apis.length,
      activeCount: snap.config.activeScenes.length,
      errors: snap.errors,
      ambiguousRoutes: store.routes.ambiguous,
      pendingConflict: snap.pendingConflict,
      orphans: snap.orphans,
      httpsCapture,
    };
  });

  wrap(router, 'get', '/cgi-bin/apis', async (ctx) => {
    const store = getContext().store;
    ctx.body = store.getApis().map((api) => ({
      ...api,
      usedBy: store.usedByApi(api.id),
    }));
  });

  wrap(router, 'post', '/cgi-bin/apis', async (ctx) => {
    ctx.body = await getContext().store.createApi(bodyOf(ctx));
  });

  wrap(router, 'put', '/cgi-bin/apis/:id', async (ctx) => {
    ctx.body = await getContext().store.updateApi(ctx.params.id, bodyOf(ctx));
  });

  wrap(router, 'delete', '/cgi-bin/apis/:id', async (ctx) => {
    const force = String(ctx.query.force || '') === '1';
    await getContext().store.deleteApi(ctx.params.id, force);
    ctx.body = { ok: true };
  });

  wrap(router, 'get', '/cgi-bin/scenes', async (ctx) => {
    ctx.body = getContext().store.listScenes();
  });

  wrap(router, 'post', '/cgi-bin/scenes', async (ctx) => {
    ctx.body = await getContext().store.createScene(bodyOf(ctx));
  });

  wrap(router, 'get', '/cgi-bin/scenes/:id', async (ctx) => {
    ctx.body = getContext().store.getSceneDetail(ctx.params.id);
  });

  wrap(router, 'put', '/cgi-bin/scenes/:id', async (ctx) => {
    ctx.body = await getContext().store.updateScene(ctx.params.id, bodyOf(ctx));
  });

  wrap(router, 'put', '/cgi-bin/scenes/:id/proxies', async (ctx) => {
    ctx.body = await getContext().store.setSceneApisEnabled(
      ctx.params.id,
      Boolean(bodyOf(ctx).enabled),
    );
  });

  wrap(router, 'delete', '/cgi-bin/scenes/:id', async (ctx) => {
    ctx.body = await getContext().store.deleteScene(ctx.params.id);
  });

  wrap(router, 'put', '/cgi-bin/scenes/:id/apis/:apiId', async (ctx) => {
    ctx.body = await getContext().store.upsertSceneApi(
      ctx.params.id,
      ctx.params.apiId,
      bodyOf(ctx),
    );
  });

    wrap(router, 'delete', '/cgi-bin/scenes/:id/apis/:apiId', async (ctx) => {
    const store = getContext().store;
    const scene = store.getScenes().get(ctx.params.id);
    if (!scene) {
      throw new HttpError(404, 'not_found', `Scene 不存在：${ctx.params.id}`);
    }
    const apis = { ...scene.apis };
    delete apis[ctx.params.apiId];
    ctx.body = await store.updateScene(ctx.params.id, { apis });
  });

  wrap(router, 'post', '/cgi-bin/scenes/:id/apis/:apiId/copy', async (ctx) => {
    const { fromSceneId } = bodyOf(ctx);
    ctx.body = await getContext().store.copySceneApi(
      ctx.params.id,
      ctx.params.apiId,
      String(fromSceneId || ''),
    );
  });

  wrap(router, 'put', '/cgi-bin/scenes/:id/apis/:apiId/share', async (ctx) => {
    ctx.body = await getContext().store.shareSceneApi(
      ctx.params.id,
      ctx.params.apiId,
      String(bodyOf(ctx).variant || ''),
    );
  });

  wrap(router, 'get', '/cgi-bin/data/:apiId', async (ctx) => {
    const store = getContext().store;
    ctx.body = store.listVariants(ctx.params.apiId).map((item) => ({
      ...item,
      body: (() => {
        try {
          return store.getVariantBody(ctx.params.apiId, item.variant);
        } catch {
          return undefined;
        }
      })(),
    }));
  });

  wrap(router, 'put', '/cgi-bin/data/:apiId/:variant', async (ctx) => {
    const fork = String(ctx.query.fork || '') === '1';
    const sceneId = String(ctx.query.sceneId || bodyOf(ctx).sceneId || '');
    ctx.body = await getContext().store.writeVariant(
      ctx.params.apiId,
      ctx.params.variant,
      bodyOf(ctx).body,
      { fork, sceneId: sceneId || undefined },
    );
  });

  wrap(router, 'delete', '/cgi-bin/data/:apiId/:variant', async (ctx) => {
    await getContext().store.deleteVariant(ctx.params.apiId, ctx.params.variant);
    ctx.body = { ok: true };
  });

  wrap(router, 'post', '/cgi-bin/activate', async (ctx) => {
    ctx.body = await getContext().store.activate(String(bodyOf(ctx).sceneId || ''));
  });

  wrap(router, 'post', '/cgi-bin/activate/resolve', async (ctx) => {
    ctx.body = await getContext().store.resolveActivate(bodyOf(ctx));
  });

  wrap(router, 'post', '/cgi-bin/deactivate', async (ctx) => {
    ctx.body = await getContext().store.deactivate(String(bodyOf(ctx).sceneId || ''));
  });

  wrap(router, 'get', '/cgi-bin/config', async (ctx) => {
    ctx.body = getContext().store.getConfig();
  });

  wrap(router, 'put', '/cgi-bin/config', async (ctx) => {
    const app = getContext();
    ctx.body = await app.store.updateConfig(bodyOf(ctx));
    app.syncRules();
  });

  wrap(router, 'get', '/cgi-bin/whistle-rules', async (ctx) => {
    ctx.body = { text: getContext().store.whistleRulesText() };
  });
}

type Method = 'get' | 'put' | 'post' | 'delete';

function wrap(
  router: Router,
  method: Method,
  pathName: string,
  handler: (ctx: Router.RouterContext) => Promise<void>,
) {
  router[method](pathName, async (ctx) => {
    try {
      await handler(ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        ctx.status = err.status;
        ctx.body = {
          error: err.code,
          message: err.message,
          details: err.details,
        };
        return;
      }
      console.error('[scene-mock]', err);
      ctx.status = 500;
      ctx.body = {
        error: 'internal',
        message: (err as Error).message,
      };
    }
  });
}

function bodyOf(ctx: Router.RouterContext): any {
  return (ctx.request as any).body || {};
}

function getHttpsStatus(options: Whistle.PluginOptions): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 400);
    try {
      options.getHttpsStatus((status) => {
        clearTimeout(timer);
        resolve(status || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
