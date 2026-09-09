export interface CompiledPattern {
  regex: RegExp;
  staticScore: number;
  pattern: string;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compilePattern(pattern: string): CompiledPattern {
  const normalized = pattern.startsWith('/') ? pattern : `/${pattern}`;
  const segments = normalized.split('/');
  let staticScore = 0;
  const parts = segments.map((seg, index) => {
    if (index === 0 && seg === '') {
      return '';
    }
    if (seg.startsWith(':') && seg.length > 1) {
      return '([^/]+)';
    }
    staticScore += 1;
    return escapeRegex(seg);
  });
  return {
    pattern: normalized,
    staticScore,
    regex: new RegExp(`^${parts.join('/')}$`),
  };
}

export function methodsEqual(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

export function decodeMaybe(value: string): string {
  if (!value.includes('%')) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function pathnameOf(fullUrl: string): string {
  const decoded = decodeMaybe(fullUrl).trim();
  if (!decoded) {
    return '/';
  }
  if (/^https?:\/\//i.test(decoded)) {
    try {
      return new URL(decoded).pathname || '/';
    } catch {
      /* fall through */
    }
  }
  const plugin = pathnameFromPluginProtocol(decoded);
  if (plugin !== '/') {
    return plugin;
  }
  try {
    return new URL(decoded).pathname || '/';
  } catch {
    const noHash = decoded.split('#')[0];
    const noQuery = noHash.split('?')[0];
    const proto = noQuery.indexOf('://');
    if (proto >= 0) {
      const rest = noQuery.slice(proto + 3);
      const slash = rest.indexOf('/');
      return slash >= 0 ? rest.slice(slash) || '/' : '/';
    }
    return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  }
}

/** Plugin short protocol (`scene-mock://...`) must not use WHATWG host parsing. */
export function pathnameFromPluginProtocol(value: string): string {
  const match = value.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.*)$/);
  if (!match) {
    return '/';
  }
  let rest = match[1];
  if (!rest) {
    return '/';
  }
  if (/^https?:\/\//i.test(rest)) {
    return pathnameOf(rest);
  }
  rest = rest.split('#')[0].split('?')[0];
  if (rest.startsWith('/')) {
    return rest || '/';
  }
  const slash = rest.indexOf('/');
  const host = slash >= 0 ? rest.slice(0, slash) : rest;
  if (host.includes('.') || host.includes(':') || host === 'localhost') {
    return slash >= 0 ? rest.slice(slash) || '/' : '/';
  }
  return `/${rest}`;
}

export interface RequestUrlBits {
  fullUrl?: string;
  originalFullUrl?: string;
  url?: string;
  originalUrl?: string;
  relativeUrl?: string;
  realUrl?: string;
  extraUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function headerValue(
  headers: RequestUrlBits['headers'],
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) {
      continue;
    }
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
  return undefined;
}

function addPath(out: Set<string>, value?: string) {
  if (!value) {
    return;
  }
  const decoded = decodeMaybe(String(value)).trim();
  if (!decoded) {
    return;
  }
  out.add(pathnameOf(decoded));
  const fromPlugin = pathnameFromPluginProtocol(decoded);
  if (fromPlugin !== '/') {
    out.add(fromPlugin);
  }
  const apiAt = decoded.search(/\/api\//i);
  if (apiAt >= 0) {
    out.add(decoded.slice(apiAt).split('#')[0].split('?')[0]);
  }
}

export function inferHttpMethod(bits: {
  method?: string;
  originalMethod?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const orig = String(bits.originalMethod || '').toUpperCase();
  const cur = String(bits.method || '').toUpperCase();
  if (orig && orig !== 'GET' && orig !== 'HEAD') {
    return orig;
  }
  if (cur && cur !== 'GET' && cur !== 'HEAD') {
    return cur;
  }
  const ct = String(headerValue(bits.headers, 'content-type') || '').toLowerCase();
  const len = Number(headerValue(bits.headers, 'content-length') || 0);
  const hasBody = len > 0
    || ct.includes('json')
    || ct.includes('form')
    || ct.includes('urlencoded');
  if (hasBody) {
    return 'POST';
  }
  return orig || cur || 'GET';
}

export function candidatePathnames(bits: RequestUrlBits): string[] {
  const out = new Set<string>();
  addPath(out, bits.originalFullUrl);
  addPath(out, bits.fullUrl);
  addPath(out, bits.realUrl);
  addPath(out, bits.extraUrl);
  addPath(out, bits.originalUrl);
  addPath(out, bits.url);
  addPath(out, headerValue(bits.headers, 'x-whistle-full-url'));
  const relative = bits.relativeUrl ? decodeMaybe(bits.relativeUrl).trim() : '';
  if (relative) {
    const asPath = relative.startsWith('/') ? relative : `/${relative}`;
    out.add(asPath.split('#')[0].split('?')[0]);
    if (!asPath.startsWith('/api/')) {
      out.add(`/api${asPath.startsWith('/') ? asPath : `/${asPath}`}`.split('#')[0].split('?')[0]);
    }
  }
  return [...out].filter((item) => item && item !== '/');
}

export function searchOf(fullUrl: string): string {
  try {
    return new URL(fullUrl).search || '';
  } catch {
    const q = fullUrl.indexOf('?');
    if (q < 0) {
      return '';
    }
    const hash = fullUrl.indexOf('#', q);
    return hash >= 0 ? fullUrl.slice(q, hash) : fullUrl.slice(q);
  }
}
