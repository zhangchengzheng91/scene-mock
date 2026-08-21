export function normalizeStatus(status: unknown): number {
  if (typeof status !== 'number' || !Number.isFinite(status)) {
    return 200;
  }
  const n = Math.round(status);
  if (n < 100 || n > 599) {
    return 200;
  }
  return n;
}

export function normalizeDelay(delay: unknown): number {
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0) {
    return 0;
  }
  return Math.round(delay);
}

export function normalizeHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

export function headerOf(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}
