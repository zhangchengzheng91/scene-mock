import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostLookupKeys,
  normalizeHost,
  normalizeTarget,
  projectIdFromName,
  isUpstreamApi,
} from '../src/core/project';

describe('project', () => {
  it('normalizes host: strip scheme/port, keep non-root path, lowercase', () => {
    assert.equal(
      normalizeHost('HTTP://Www.example1.com/'),
      'www.example1.com',
    );
    assert.equal(normalizeHost('http://www.example1.com/'), 'www.example1.com');
    assert.equal(
      normalizeHost('http://www.example2.com/cc'),
      'www.example2.com/cc',
    );
    assert.equal(normalizeHost('http://www.example1.com/dd'), 'www.example1.com/dd');
    assert.equal(normalizeHost('http://www.example1.com/abc/'), 'www.example1.com/abc');
    assert.equal(normalizeHost('https://example.com:8443/api/'), 'example.com/api');
    assert.equal(normalizeHost('localhost:8889'), 'localhost');
    assert.equal(normalizeHost(''), '');
    assert.equal(normalizeHost('  '), '');
  });

  it('treats /api under the current host prefix as upstream, and pages as local', () => {
    assert.equal(isUpstreamApi('/cc/api', 'www.example2.com/cc'), true);
    assert.equal(isUpstreamApi('/cc/api/v1/user/profile/request', 'www.example2.com/cc'), true);
    assert.equal(isUpstreamApi('/cc/login', 'www.example2.com/cc'), false);
    assert.equal(isUpstreamApi('/cc/static/js/lodash.js', 'www.example2.com/cc'), false);
    assert.equal(isUpstreamApi('/cc/apis', 'www.example2.com/cc'), false);
    assert.equal(isUpstreamApi('/api', 'www.example2.com'), true);
    assert.equal(isUpstreamApi('/api/v1/user/profile/request', 'www.example2.com'), true);
    assert.equal(isUpstreamApi('/login', 'www.example2.com'), false);
    assert.equal(isUpstreamApi('/static/js/lodash.js', 'www.example2.com'), false);
    assert.equal(isUpstreamApi('/cc/api/v1/user', 'www.example2.com'), false);
  });

  it('keeps a non-root path on target and accepts missing scheme', () => {
    assert.equal(normalizeTarget('http://localhost:8889/api'), 'http://localhost:8889/api');
    assert.equal(normalizeTarget('http://localhost:8080/app/'), 'http://localhost:8080/app');
    assert.equal(normalizeTarget('localhost:8889'), 'http://localhost:8889');
    assert.equal(normalizeTarget('https://example.com/'), 'https://example.com');
    assert.equal(normalizeTarget(''), '');
  });

  it('throws on invalid target', () => {
    assert.throws(() => normalizeTarget('http://'));
  });

  it('builds host lookup keys: raw first, then port-stripped', () => {
    assert.deepEqual(hostLookupKeys('example.com:8080'), ['example.com:8080', 'example.com']);
    assert.deepEqual(hostLookupKeys('example.com'), ['example.com']);
    assert.deepEqual(hostLookupKeys('HTTP://Example.com/api'), ['example.com']);
  });

  it('generates project id from name with dedupe', () => {
    assert.equal(projectIdFromName('example', new Set()), 'example');
    assert.equal(projectIdFromName('example', new Set(['example'])), 'example-2');
    assert.equal(projectIdFromName('例子', new Set()), 'project');
    assert.equal(projectIdFromName('例子', new Set(['project'])), 'project-2');
    assert.equal(projectIdFromName('My Service!', new Set()), 'my-service');
  });
});
