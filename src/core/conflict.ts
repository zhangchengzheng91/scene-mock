import { previewJson } from './fs-utils';
import {
  ActiveSetConflictPayload,
  ApiDef,
  ConflictItem,
  isEntryEnabled,
  SceneConflictPayload,
  SceneDef,
} from './types';

export type DataIndex = Map<string, Map<string, unknown>>;

export function effectiveApiIds(
  scene: SceneDef,
  dataIndex: DataIndex,
): Set<string> {
  const ids = new Set<string>();
  for (const [apiId, entry] of Object.entries(scene.apis || {})) {
    if (!entry || !entry.data || !isEntryEnabled(entry)) {
      continue;
    }
    const variants = dataIndex.get(apiId);
    if (!variants || !variants.has(entry.data)) {
      continue;
    }
    ids.add(apiId);
  }
  return ids;
}

function previewOf(
  dataIndex: DataIndex,
  apiId: string,
  variant?: string,
): string {
  if (!variant) {
    return '';
  }
  const variants = dataIndex.get(apiId);
  if (!variants || !variants.has(variant)) {
    return '(missing)';
  }
  return previewJson(variants.get(variant));
}

function makeItem(
  apiId: string,
  apis: Map<string, ApiDef>,
  existing: SceneDef,
  incoming: SceneDef,
  dataIndex: DataIndex,
): ConflictItem {
  const api = apis.get(apiId);
  const existingEntry = existing.apis[apiId];
  const incomingEntry = incoming.apis[apiId];
  return {
    apiId,
    method: api?.method || '',
    url: api?.url || '',
    existingScene: {
      id: existing.id,
      name: existing.name,
      status: existingEntry?.status ?? 200,
      preview: previewOf(dataIndex, apiId, existingEntry?.data),
    },
    incomingScene: {
      status: incomingEntry?.status ?? 200,
      preview: previewOf(dataIndex, apiId, incomingEntry?.data),
    },
  };
}

export function detectActivateConflict(
  incoming: SceneDef,
  activeScenes: string[],
  scenes: Map<string, SceneDef>,
  apis: Map<string, ApiDef>,
  dataIndex: DataIndex,
): SceneConflictPayload | null {
  const incomingIds = effectiveApiIds(incoming, dataIndex);
  const conflicts: ConflictItem[] = [];
  const close = new Set<string>();

  for (const sceneId of activeScenes) {
    if (sceneId === incoming.id) {
      continue;
    }
    const existing = scenes.get(sceneId);
    if (!existing) {
      continue;
    }
    const existingIds = effectiveApiIds(existing, dataIndex);
    for (const apiId of incomingIds) {
      if (!existingIds.has(apiId)) {
        continue;
      }
      close.add(sceneId);
      conflicts.push(
        makeItem(apiId, apis, existing, incoming, dataIndex),
      );
    }
  }

  if (conflicts.length === 0) {
    return null;
  }
  return {
    error: 'scene_conflict',
    incoming: { id: incoming.id, name: incoming.name },
    conflicts,
    closeScenesIfKeepNew: [...close],
  };
}

export function detectActiveSetConflicts(
  activeScenes: string[],
  scenes: Map<string, SceneDef>,
  apis: Map<string, ApiDef>,
  dataIndex: DataIndex,
): ActiveSetConflictPayload | null {
  const conflicts: ConflictItem[] = [];
  const involved = new Map<string, string>();

  for (let i = 0; i < activeScenes.length; i += 1) {
    const aId = activeScenes[i];
    const a = scenes.get(aId);
    if (!a) {
      continue;
    }
    const aIds = effectiveApiIds(a, dataIndex);
    for (let j = i + 1; j < activeScenes.length; j += 1) {
      const bId = activeScenes[j];
      const b = scenes.get(bId);
      if (!b) {
        continue;
      }
      const bIds = effectiveApiIds(b, dataIndex);
      for (const apiId of aIds) {
        if (!bIds.has(apiId)) {
          continue;
        }
        involved.set(a.id, a.name);
        involved.set(b.id, b.name);
        conflicts.push(makeItem(apiId, apis, a, b, dataIndex));
      }
    }
  }

  if (conflicts.length === 0) {
    return null;
  }
  return {
    error: 'active_set_conflict',
    involvedScenes: [...involved.entries()].map(([id, name]) => ({
      id,
      name,
    })),
    conflicts,
  };
}

export function applyKeepNew(
  activeScenes: string[],
  incomingId: string,
  closeIds: string[],
): string[] {
  const close = new Set(closeIds);
  const next = activeScenes.filter((id) => !close.has(id) && id !== incomingId);
  next.push(incomingId);
  return next;
}
