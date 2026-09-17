import { compilePattern, methodsEqual } from './matcher';
import { normalizeDelay, normalizeHeaders, normalizeStatus } from './normalize';
import {
  AmbiguousRoute,
  ApiDef,
  CompiledRoute,
  entryApiId,
  isEntryEnabled,
  SceneDef,
} from './types';
import { DataIndex } from './conflict';

export interface CompileInput {
  apis: ApiDef[];
  scenes: Map<string, SceneDef>;
  activeScenes: string[];
  dataIndex: DataIndex;
}

export class RouteTable {
  private routes: CompiledRoute[] = [];
  ambiguous: AmbiguousRoute[] = [];

  get size(): number {
    return this.routes.length;
  }

  getRoutes(): CompiledRoute[] {
    return this.routes.slice();
  }

  compile(input: CompileInput): void {
    const apiIndex = new Map(input.apis.map((api, i) => [api.id, i]));
    const apiMap = new Map(input.apis.map((api) => [api.id, api]));
    const routes: CompiledRoute[] = [];

    for (const sceneId of input.activeScenes) {
      const scene = input.scenes.get(sceneId);
      if (!scene) {
        continue;
      }
      for (const [entryId, entry] of Object.entries(scene.apis || {})) {
        if (!entry || !entry.data || !isEntryEnabled(entry)) {
          continue;
        }
        const apiId = entryApiId(entryId, entry);
        const variants = input.dataIndex.get(apiId);
        if (!variants || !variants.has(entry.data)) {
          continue;
        }
        const api = apiMap.get(apiId);
        if (!api) {
          continue;
        }
        const compiled = compilePattern(api.url);
        routes.push({
          apiId,
          sceneId,
          variant: entry.data,
          method: api.method.toUpperCase(),
          pattern: compiled.pattern,
          regex: compiled.regex,
          staticScore: compiled.staticScore,
          apiIndex: apiIndex.has(apiId) ? apiIndex.get(apiId)! : 9999,
          response: {
            status: normalizeStatus(entry.status),
            delay: normalizeDelay(entry.delay),
            headers: normalizeHeaders(entry.headers),
            variant: entry.data,
            body: variants.get(entry.data),
          },
        });
      }
    }

    this.routes = routes;
    this.ambiguous = findAmbiguous(routes);
  }

  clear(): void {
    this.routes = [];
    this.ambiguous = [];
  }

  match(method: string, pathname: string): CompiledRoute | null {
    let best: CompiledRoute | null = null;
    for (const route of this.routes) {
      if (!methodsEqual(route.method, method)) {
        continue;
      }
      if (!route.regex.test(pathname)) {
        continue;
      }
      if (
        !best
        || route.staticScore > best.staticScore
        || (
          route.staticScore === best.staticScore
          && route.apiIndex < best.apiIndex
        )
      ) {
        best = route;
      }
    }
    return best;
  }
}

function findAmbiguous(routes: CompiledRoute[]): AmbiguousRoute[] {
  const groups = new Map<string, CompiledRoute[]>();
  for (const route of routes) {
    const key = `${route.method} ${route.regex.source}`;
    const list = groups.get(key) || [];
    list.push(route);
    groups.set(key, list);
  }
  const out: AmbiguousRoute[] = [];
  for (const list of groups.values()) {
    const apiIds = [...new Set(list.map((r) => r.apiId))];
    if (apiIds.length > 1) {
      out.push({
        method: list[0].method,
        pattern: list[0].pattern,
        apiIds,
      });
    }
  }
  return out;
}
