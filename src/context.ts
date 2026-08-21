import path from 'path';
import { HttpError } from './core/http-error';
import { Store } from './core/store';
import { writePluginRules } from './rules';
import { SseHub } from './uiServer/sse';

const STORAGE_KEY = 'mocksRoot';
const RECENT_KEY = 'recentMocksRoots';

export function resolveMocksRoot(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new HttpError(400, 'invalid', '路径不能为空');
  }
  const resolved = path.resolve(trimmed);
  if (path.basename(resolved) === 'mocks') {
    return resolved;
  }
  return path.join(resolved, 'mocks');
}

export class AppContext {
  readonly store = new Store();
  readonly sse = new SseHub();
  private lastPatterns = '';

  constructor(public options: Whistle.PluginOptions) {
    this.store.on('change', () => {
      this.syncRules();
      this.sse.send('reload', {
        ready: this.store.ready,
        errors: this.store.getErrors(),
      });
    });
    this.store.on('file-error', (payload) => {
      this.sse.send('error', payload);
    });
    this.store.on('conflict', (payload) => {
      this.sse.send('conflict', payload);
    });
    const saved = this.options.localStorage.getProperty(STORAGE_KEY);
    if (saved) {
      this.store.bind(saved).catch((err) => {
        console.error('[scene-mock] bind saved workspace failed:', err);
      });
    } else {
      this.syncRules();
    }
  }

  async bindWorkspace(input: string) {
    const mocksRoot = resolveMocksRoot(input);
    await this.store.bind(mocksRoot);
    this.options.localStorage.setProperty(STORAGE_KEY, mocksRoot);
    this.pushRecent(mocksRoot);
    this.syncRules();
    return this.workspaceView();
  }

  workspaceView() {
    return {
      mocksRoot: this.store.mocksRoot,
      bound: Boolean(this.store.mocksRoot),
      ready: this.store.ready,
      errors: this.store.getErrors(),
      recent: this.recent(),
    };
  }

  syncRules() {
    const text = this.store.pluginRulesText();
    if (text === this.lastPatterns) {
      return;
    }
    this.lastPatterns = text;
    try {
      // Skip identical content so lack watch does not restart the plugin in a loop.
      if (writePluginRules(text)) {
        this.options.updateRules();
      }
    } catch (err) {
      console.error('[scene-mock] update rules.txt failed:', err);
      this.sse.send('error', {
        relativePath: 'rules.txt',
        reason: `写入插件规则失败：${(err as Error).message}。请改用「复制 whistle 规则」。`,
      });
    }
  }

  private recent(): string[] {
    try {
      const raw = this.options.localStorage.getProperty(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private pushRecent(mocksRoot: string) {
    const next = [mocksRoot, ...this.recent().filter((p) => p !== mocksRoot)].slice(0, 8);
    this.options.localStorage.setProperty(RECENT_KEY, JSON.stringify(next));
  }
}

let instance: AppContext | null = null;

export function initContext(options: Whistle.PluginOptions): AppContext {
  if (!instance) {
    instance = new AppContext(options);
  } else {
    instance.options = options;
  }
  return instance;
}

export function getContext(): AppContext {
  if (!instance) {
    throw new Error('AppContext 尚未初始化');
  }
  return instance;
}
