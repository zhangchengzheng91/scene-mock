import { HttpError } from './http-error';
import { ID_PATTERN } from './types';

/**
 * 规范化项目 host：去协议、小写、去端口。
 * 根路径 `/` 丢掉；其余路径原样保留，如 `host/dd`、`host/abc`。
 * 空输入返回 ''。项目 host 一律以该形式存储与比较。
 */
export function normalizeHost(input: string): string {
  let value = String(input || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  value = value.split('?')[0].split('#')[0].trim();
  if (!value) {
    return '';
  }

  let hostPart = '';
  let pathPart = '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) {
      return '';
    }
    hostPart = value.slice(1, end);
    const rest = value.slice(end + 1);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      pathPart = rest.slice(slash);
    }
  } else {
    const slash = value.indexOf('/');
    hostPart = slash >= 0 ? value.slice(0, slash) : value;
    pathPart = slash >= 0 ? value.slice(slash) : '';
    const colon = hostPart.lastIndexOf(':');
    if (colon > 0 && hostPart.indexOf(':') === colon) {
      hostPart = hostPart.slice(0, colon);
    }
  }
  hostPart = hostPart.trim();
  pathPart = pathPart.replace(/\/+$/, '');
  if (!hostPart) {
    return '';
  }
  return pathPart ? `${hostPart}${pathPart}` : hostPart;
}

/**
 * 场景未命中时，接口回原始地址，页面和静态资源进本机 target。
 * 前缀来自当前命中的 host：`域名/cc` 的接口是 `/cc/api`，只有域名时是 `/api`。
 */
export function isUpstreamApi(pathname: string, projectHost: string): boolean {
  const path = pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  const apiRoot = `${hostPathPrefix(projectHost)}/api`;
  return path === apiRoot || path.startsWith(`${apiRoot}/`);
}

/** 项目 host 上的路径前缀，如 `域名/cc` → `/cc`；没有路径时返回 ''。 */
export function hostPathPrefix(projectHost: string): string {
  const slash = String(projectHost || '').indexOf('/');
  if (slash < 0) {
    return '';
  }
  const prefix = projectHost.slice(slash).replace(/\/+$/, '');
  return prefix && prefix !== '/' ? prefix : '';
}

/**
 * 规范化项目 target：保留协议、host、端口和非根路径。
 * 根路径 `/` 丢掉；空输入返回 ''。允许不写协议（默认补 http://）。
 */
export function normalizeTarget(input: string): string {
  const value = String(input || '').trim();
  if (!value) {
    return '';
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, 'invalid', `代理到的域名不是合法地址：${input}`);
  }
  if (!url.hostname) {
    throw new HttpError(400, 'invalid', `代理到的域名不是合法地址：${input}`);
  }
  const path = url.pathname.replace(/\/+$/, '');
  return path ? `${url.origin}${path}` : url.origin;
}

/**
 * 请求 host（可能带端口 / 协议）→ hostIndex 查询候选键。
 * 先整值（小写、去协议与路径，保留端口）查，再去端口查。
 */
export function hostLookupKeys(host: string): string[] {
  const keys: string[] = [];
  let raw = String(host || '').trim().toLowerCase();
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  raw = raw.split('/')[0].split('?')[0].split('#')[0].trim();
  if (raw) {
    keys.push(raw);
  }
  const normalized = normalizeHost(raw);
  if (normalized && !keys.includes(normalized)) {
    keys.push(normalized);
  }
  return keys;
}

/** 从项目名生成合法 id；冲突时追加 -2、-3… */
export function projectIdFromName(name: string, taken: Set<string>): string {
  let base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base || !ID_PATTERN.test(base)) {
    base = 'project';
  }
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}
