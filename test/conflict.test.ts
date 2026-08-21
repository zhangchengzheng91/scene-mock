import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyKeepNew,
  detectActivateConflict,
  detectActiveSetConflicts,
} from '../src/core/conflict';
import { ApiDef, SceneDef } from '../src/core/types';

const apis = new Map<string, ApiDef>([
  ['get-orders', { id: 'get-orders', method: 'GET', url: '/api/orders' }],
  ['login', { id: 'login', method: 'POST', url: '/api/login' }],
]);

const dataIndex = new Map([
  ['get-orders', new Map<string, unknown>([
    ['list', { data: [1] }],
    ['empty', { data: [] }],
  ])],
  ['login', new Map<string, unknown>([['ok', { token: 't' }]])],
]);

describe('conflict', () => {
  it('allows activating a scene with no overlapping apis', () => {
    const scenes = new Map<string, SceneDef>([
      ['orders', {
        id: 'orders',
        name: '订单',
        apis: { 'get-orders': { data: 'list' } },
      }],
      ['auth', {
        id: 'auth',
        name: '登录',
        apis: { login: { data: 'ok' } },
      }],
    ]);
    const conflict = detectActivateConflict(
      scenes.get('auth')!,
      ['orders'],
      scenes,
      apis,
      dataIndex,
    );
    assert.equal(conflict, null);
  });

  it('detects overlap and lists scenes to close', () => {
    const scenes = new Map<string, SceneDef>([
      ['normal', {
        id: 'normal',
        name: '正常',
        apis: { 'get-orders': { status: 200, data: 'list' } },
      }],
      ['empty', {
        id: 'empty',
        name: '空',
        apis: { 'get-orders': { status: 200, data: 'empty' } },
      }],
      ['auth', {
        id: 'auth',
        name: '登录',
        apis: { login: { data: 'ok' } },
      }],
    ]);
    const conflict = detectActivateConflict(
      scenes.get('empty')!,
      ['normal', 'auth'],
      scenes,
      apis,
      dataIndex,
    );
    assert.ok(conflict);
    assert.deepEqual(conflict!.closeScenesIfKeepNew, ['normal']);
    assert.equal(conflict!.conflicts[0].apiId, 'get-orders');
    const next = applyKeepNew(['normal', 'auth'], 'empty', conflict!.closeScenesIfKeepNew);
    assert.deepEqual(next, ['auth', 'empty']);
  });

  it('detects a self-conflicting active set', () => {
    const scenes = new Map<string, SceneDef>([
      ['a', { id: 'a', name: 'A', apis: { 'get-orders': { data: 'list' } } }],
      ['b', { id: 'b', name: 'B', apis: { 'get-orders': { data: 'empty' } } }],
    ]);
    const payload = detectActiveSetConflicts(['a', 'b'], scenes, apis, dataIndex);
    assert.ok(payload);
    assert.equal(payload!.error, 'active_set_conflict');
  });
});
