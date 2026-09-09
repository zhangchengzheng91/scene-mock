import fs from 'fs';
import os from 'os';
import path from 'path';

export const STORAGE_KEY = 'mocksRoot';

function stateFiles(options: Whistle.PluginOptions): string[] {
  const files = [path.join(os.homedir(), '.whistle-scene-mock', 'mocksRoot')];
  const baseDir = options.config?.baseDir;
  if (baseDir) {
    files.unshift(path.join(baseDir, 'whistle.scene-mock', 'mocksRoot'));
  }
  return files;
}

export function readSavedMocksRoot(options: Whistle.PluginOptions): string {
  const fromLs = String(options.localStorage?.getProperty(STORAGE_KEY) || '').trim();
  if (fromLs) {
    return fromLs;
  }
  try {
    const shared = options.sharedStorage?.getItem?.(STORAGE_KEY);
    if (shared) {
      return String(shared).trim();
    }
  } catch {
    /* ignore */
  }
  for (const file of stateFiles(options)) {
    try {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (text) {
        return text;
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function persistMocksRoot(options: Whistle.PluginOptions, mocksRoot: string): void {
  try {
    options.localStorage?.setProperty(STORAGE_KEY, mocksRoot);
  } catch {
    /* ignore */
  }
  try {
    options.sharedStorage?.setItem?.(STORAGE_KEY, mocksRoot);
  } catch {
    /* ignore */
  }
  for (const file of stateFiles(options)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${mocksRoot}\n`, 'utf8');
    } catch (err) {
      console.error('[scene-mock] persist mocksRoot failed:', file, err);
    }
  }
}
