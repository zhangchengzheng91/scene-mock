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
      normalizeHost('HTTP://Microcredit-ms-test-c.jhjj.paas.test/'),
      'microcredit-ms-test-c.jhjj.paas.test',
    );
    assert.equal(normalizeHost('http://yxhms.paas.corp/'), 'yxhms.paas.corp');
    assert.equal(
      normalizeHost('http://yrxd.test.creditease.cn/cc'),
      'yrxd.test.creditease.cn/cc',
    );
    assert.equal(normalizeHost('http://yxhms.paas.corp/dd'), 'yxhms.paas.corp/dd');
    assert.equal(normalizeHost('http://yxhms.paas.corp/abc/'), 'yxhms.paas.corp/abc');
    assert.equal(normalizeHost('https://example.com:8443/api/'), 'example.com/api');
    assert.equal(normalizeHost('localhost:8889'), 'localhost');
    assert.equal(normalizeHost(''), '');
    assert.equal(normalizeHost('  '), '');
  });

  it('treats /api under the current host prefix as upstream, and pages as local', () => {
    assert.equal(isUpstreamApi('/cc/api', 'yrxd.test.creditease.cn/cc'), true);
    assert.equal(isUpstreamApi('/cc/api/v1/user/smsCode/request', 'yrxd.test.creditease.cn/cc'), true);
    assert.equal(isUpstreamApi('/cc/login', 'yrxd.test.creditease.cn/cc'), false);
    assert.equal(isUpstreamApi('/cc/static/js/lodash.js', 'yrxd.test.creditease.cn/cc'), false);
    assert.equal(isUpstreamApi('/cc/apis', 'yrxd.test.creditease.cn/cc'), false);
    assert.equal(isUpstreamApi('/api', 'yrxd.test.creditease.cn'), true);
    assert.equal(isUpstreamApi('/api/v1/user/smsCode/request', 'yrxd.test.creditease.cn'), true);
    assert.equal(isUpstreamApi('/login', 'yrxd.test.creditease.cn'), false);
    assert.equal(isUpstreamApi('/static/js/lodash.js', 'yrxd.test.creditease.cn'), false);
    assert.equal(isUpstreamApi('/cc/api/v1/user', 'yrxd.test.creditease.cn'), false);
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
    assert.equal(projectIdFromName('microcredit', new Set()), 'microcredit');
    assert.equal(projectIdFromName('microcredit', new Set(['microcredit'])), 'microcredit-2');
    assert.equal(projectIdFromName('微贷后端', new Set()), 'project');
    assert.equal(projectIdFromName('微贷后端', new Set(['project'])), 'project-2');
    assert.equal(projectIdFromName('My Service!', new Set()), 'my-service');
  });
});
