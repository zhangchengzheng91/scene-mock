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

export function pathnameOf(fullUrl: string): string {
  try {
    return new URL(fullUrl).pathname || '/';
  } catch {
    const noHash = fullUrl.split('#')[0];
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
