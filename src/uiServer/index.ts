import fs from 'fs';
import path from 'path';
import Router from '@koa/router';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import onerror from 'koa-onerror';
import serve from 'koa-static';
import { initContext } from '../context';
import setupRouter from './router';

const staticDir = path.join(__dirname, '../../web/dist');
const indexFile = path.join(staticDir, 'index.html');

export default (server: Whistle.PluginServer, options: Whistle.PluginOptions) => {
  initContext(options);
  const app = new Koa();
  app.proxy = true;
  app.silent = true;
  onerror(app);
  const router = new Router();
  setupRouter(router);
  app.use(async (ctx, next) => {
    ctx.set('Cache-Control', 'no-store');
    await next();
  });
  app.use(bodyParser({ jsonLimit: '10mb' }));
  app.use(router.routes());
  app.use(router.allowedMethods());
  app.use(serve(staticDir, { maxage: 0, index: false }));
  app.use(async (ctx, next) => {
    if (ctx.method !== 'GET' || ctx.path.startsWith('/cgi-bin')) {
      await next();
      return;
    }
    if (!fs.existsSync(indexFile)) {
      ctx.status = 503;
      ctx.body = 'web/dist not found. Run npm run build.';
      return;
    }
    ctx.type = 'html';
    ctx.body = fs.createReadStream(indexFile);
  });
  server.on('request', app.callback());
};
