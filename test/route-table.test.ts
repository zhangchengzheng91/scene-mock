import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RouteTable } from '../src/core/route-table';
import { ApiDef, SceneDef } from '../src/core/types';

const apis: ApiDef[] = [
  { id: 'get-user', method: 'GET', url: '/api/users/:id' },
  { id: 'get-user-alias', method: 'GET', url: '/api/users/:userId' },
  { id: 'get-orders', method: 'GET', url: '/api/orders' },
  { id: 'create-order', method: 'POST', url: '/api/orders' },
];

describe('route-table', () => {
  it('skips entries whose data file is missing', () => {
    const scenes = new Map<string, SceneDef>([
      ['a', {
        id: 'a',
        name: 'A',
        apis: {
          'get-orders': { data: 'list' },
          'create-order': { data: 'missing' },
        },
      }],
    ]);
    const dataIndex = new Map([
      ['get-orders', new Map<string, unknown>([['list', { ok: true }]])],
    ]);
    const table = new RouteTable();
    table.compile({
      apis,
      scenes,
      activeScenes: ['a'],
      dataIndex,
    });
    assert.equal(table.size, 1);
    assert.ok(table.match('GET', '/api/orders'));
    assert.equal(table.match('POST', '/api/orders'), null);
  });

  it('includes JSON null body', () => {
    const scenes = new Map<string, SceneDef>([
      ['a', {
        id: 'a',
        name: 'A',
        apis: { 'get-orders': { data: 'nil' } },
      }],
    ]);
    const dataIndex = new Map([
      ['get-orders', new Map<string, unknown>([['nil', null]])],
    ]);
    const table = new RouteTable();
    table.compile({ apis, scenes, activeScenes: ['a'], dataIndex });
    const hit = table.match('GET', '/api/orders');
    assert.ok(hit);
    assert.equal(hit!.response.body, null);
  });

  it('ignores query and method mismatch', () => {
    const scenes = new Map<string, SceneDef>([
      ['a', {
        id: 'a',
        name: 'A',
        apis: { 'get-orders': { data: 'list' } },
      }],
    ]);
    const dataIndex = new Map([
      ['get-orders', new Map<string, unknown>([['list', {}]])],
    ]);
    const table = new RouteTable();
    table.compile({ apis, scenes, activeScenes: ['a'], dataIndex });
    assert.ok(table.match('GET', '/api/orders'));
    assert.equal(table.match('POST', '/api/orders'), null);
  });

  it('prefers first-registered api when patterns are equivalent', () => {
    const scenes = new Map<string, SceneDef>([
      ['a', {
        id: 'a',
        name: 'A',
        apis: {
          'get-user': { data: 'v1' },
          'get-user-alias': { data: 'v2' },
        },
      }],
    ]);
    const dataIndex = new Map([
      ['get-user', new Map<string, unknown>([['v1', { a: 1 }]])],
      ['get-user-alias', new Map<string, unknown>([['v2', { a: 2 }]])],
    ]);
    const table = new RouteTable();
    table.compile({ apis, scenes, activeScenes: ['a'], dataIndex });
    const hit = table.match('GET', '/api/users/1');
    assert.equal(hit?.apiId, 'get-user');
    assert.equal(table.ambiguous.length, 1);
    assert.deepEqual(table.ambiguous[0].apiIds.sort(), ['get-user', 'get-user-alias']);
  });

  it('skips disabled entries', () => {
    const scenes = new Map<string, SceneDef>([
      ['a', {
        id: 'a',
        name: 'A',
        apis: {
          'get-orders': { data: 'list', enabled: false },
          'create-order': { data: 'ok' },
        },
      }],
    ]);
    const dataIndex = new Map([
      ['get-orders', new Map<string, unknown>([['list', {}]])],
      ['create-order', new Map<string, unknown>([['ok', {}]])],
    ]);
    const table = new RouteTable();
    table.compile({ apis, scenes, activeScenes: ['a'], dataIndex });
    assert.equal(table.match('GET', '/api/orders'), null);
    assert.ok(table.match('POST', '/api/orders'));
  });
});
