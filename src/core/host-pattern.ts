/** Turn a config entry into one Whistle pattern. Full URLs drop the scheme. */
export function hostToPattern(input: string): string {
  const value = input.trim();
  if (!value || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  }
  const rawHost = url.hostname;
  const host = rawHost.includes(':') ? `[${rawHost}]` : rawHost;
  const defaultPort = url.protocol === 'https:' || url.protocol === 'wss:'
    ? '443'
    : (url.protocol === 'http:' || url.protocol === 'ws:' ? '80' : '');
  const withPort = url.port && url.port !== defaultPort ? `${host}:${url.port}` : host;
  const pathname = url.pathname && url.pathname !== '/' ? url.pathname : '';
  return `${withPort}${pathname}`;
}

/** matchPatterns first, then hosts. Duplicate patterns collapse. */
export function rulePatterns(matchPatterns: string[], hosts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...matchPatterns, ...hosts]) {
    const pattern = hostToPattern(String(raw || ''));
    if (!pattern || seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    out.push(pattern);
  }
  return out;
}
