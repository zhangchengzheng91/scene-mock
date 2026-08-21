import { ID_PATTERN } from './types';
import { HttpError } from './http-error';

export function assertSafeId(id: string, label = 'id'): string {
  if (!id || !ID_PATTERN.test(id)) {
    throw new HttpError(
      400,
      'invalid_id',
      `${label} 须匹配 ${ID_PATTERN}，且不能包含路径字符`,
    );
  }
  return id;
}

export function nextVariantName(
  existing: Set<string>,
  preferred: string,
): string {
  const base = ID_PATTERN.test(preferred) ? preferred : 'variant';
  if (!existing.has(base)) {
    return base;
  }
  let n = 2;
  while (existing.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}
