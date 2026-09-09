import { IncomingMessage } from 'http';
import { headerOf, normalizeHeaders } from './core/normalize';
import { candidatePathnames, inferHttpMethod, pathnameOf, searchOf } from './core/matcher';
import { initContext } from './context';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'host',
]);

const PROXY_TIMEOUT_MS = 30_000;

export default (server: Whistle.PluginServer, options: Whistle.PluginOptions) => {
  const ctx = initContext(options);

  server.on('request', (
    req: Whistle.PluginServerRequest,
    res: Whistle.PluginServerResponse,
  ) => {
    handleHttp(req, res, ctx).catch((err) => {
      console.error('[scene-mock] request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: 'internal',
          message: (err as Error).message,
        }));
      }
    });
  });

  server.on('upgrade', (req: Whistle.PluginServerRequest) => {
    req.passThrough();
  });

  server.on('connect', (req: Whistle.PluginServerRequest) => {
    req.passThrough();
  });
};

async function handleHttp(
  req: Whistle.PluginServerRequest,
  res: Whistle.PluginServerResponse,
  ctx: ReturnType<typeof initContext>,
) {
  await ctx.ensureBound();
  const { store } = ctx;
  if (!store.ready || store.pendingConflict) {
    req.passThrough();
    return;
  }

  const mergedHeaders = {
    ...req.originalReq.headers,
    ...req.headers,
  };
  const method = inferHttpMethod({
    method: req.method,
    originalMethod: req.originalReq.method,
    headers: mergedHeaders,
  });
  const pathnames = candidatePathnames({
    fullUrl: req.fullUrl,
    originalFullUrl: req.originalReq.fullUrl,
    url: req.url,
    originalUrl: req.originalReq.url,
    relativeUrl: req.originalReq.relativeUrl,
    realUrl: req.originalReq.realUrl,
    extraUrl: req.originalReq.extraUrl,
    headers: mergedHeaders,
  });
  let hit = null;
  for (const pathname of pathnames) {
    hit = store.routes.match(method, pathname);
    if (hit) {
      break;
    }
  }

  if (hit) {
    await drain(req);
    const delay = hit.response.delay || 0;
    if (delay > 0) {
      await sleep(delay);
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...normalizeHeaders(hit.response.headers),
    };
    headers['x-scene-mock'] = `${hit.sceneId}/${hit.apiId}/${hit.variant}`;
    const contentType = headerOf(headers, 'content-type') || 'application/json';
    const body = serialize(hit.response.body, contentType);
    res.writeHead(hit.response.status || 200, headers);
    res.end(body);
    return;
  }

  const config = store.getConfig();
  if (config.unmatched === '404' && !config.proxyTarget) {
    await drain(req);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: 'not_mocked',
      message: '未 mock 且未配置透传',
    }));
    return;
  }

  if (config.proxyTarget) {
    await proxyTo(req, res, config.proxyTarget);
    return;
  }

  req.passThrough();
}

function serialize(body: unknown, contentType: string): string | Buffer {
  const type = contentType.toLowerCase();
  if (type.startsWith('text/')) {
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (typeof body === 'string' && !type.includes('json')) {
    return body;
  }
  return JSON.stringify(body);
}

function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    if (req.readableEnded || (req as IncomingMessage & { complete?: boolean }).complete) {
      resolve();
      return;
    }
    req.on('end', () => resolve());
    req.on('error', () => resolve());
    req.resume();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function proxyTo(
  req: Whistle.PluginServerRequest,
  res: Whistle.PluginServerResponse,
  proxyTarget: string,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      const target = new URL(proxyTarget);
      const originalUrl = req.originalReq.fullUrl || req.fullUrl;
      const pathname = pathnameOf(originalUrl);
      const search = searchOf(originalUrl);
      const url = `${target.origin}${pathname}${search}`;
      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
      };
      for (const key of Object.keys(headers)) {
        if (HOP_BY_HOP.has(key.toLowerCase())) {
          delete headers[key];
        }
      }
      headers.host = target.host;

      const timer = setTimeout(() => {
        fail(res, 'proxy timeout (30s)');
        done();
      }, PROXY_TIMEOUT_MS);

      const svrReq = req.request(url, (svrRes: IncomingMessage) => {
        clearTimeout(timer);
        const outHeaders = { ...svrRes.headers };
        for (const key of Object.keys(outHeaders)) {
          if (HOP_BY_HOP.has(key.toLowerCase())) {
            delete outHeaders[key];
          }
        }
        res.writeHead(svrRes.statusCode || 502, outHeaders);
        svrRes.pipe(res);
        svrRes.on('end', done);
        svrRes.on('error', () => {
          done();
        });
      });
      svrReq.on('error', (err: Error) => {
        clearTimeout(timer);
        fail(res, err.message);
        done();
      });
    } catch (err) {
      fail(res, (err as Error).message);
      done();
    }
  });
}

function fail(res: Whistle.PluginServerResponse, message: string) {
  if (res.headersSent) {
    return;
  }
  res.writeHead(502, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    error: 'proxy_failed',
    message,
  }));
}
