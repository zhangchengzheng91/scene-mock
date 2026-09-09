import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatePathnames,
  compilePattern,
  inferHttpMethod,
  pathnameFromPluginProtocol,
  pathnameOf,
} from '../src/core/matcher';

describe('matcher', () => {
  it('matches /api/users/:id against /api/users/1', () => {
    const compiled = compilePattern('/api/users/:id');
    assert.equal(compiled.regex.test('/api/users/1'), true);
    assert.equal(compiled.staticScore, 2);
  });

  it('does not match /api/users against /api/users/:id', () => {
    const compiled = compilePattern('/api/users/:id');
    assert.equal(compiled.regex.test('/api/users'), false);
  });

  it('does not match extra segments', () => {
    const compiled = compilePattern('/api/users/:id');
    assert.equal(compiled.regex.test('/api/users/42/orders'), false);
  });

  it('strips query from fullUrl', () => {
    assert.equal(
      pathnameOf('https://api.example.com/api/orders?page=1'),
      '/api/orders',
    );
  });

  it('scores static segments higher than params', () => {
    const concrete = compilePattern('/api/users/me');
    const param = compilePattern('/api/users/:id');
    assert.equal(concrete.staticScore > param.staticScore, true);
  });

  it('does not treat plugin protocol first segment as host', () => {
    assert.equal(
      pathnameFromPluginProtocol('scene-mock://api/v1/couponPack/sale'),
      '/api/v1/couponPack/sale',
    );
    assert.equal(
      pathnameOf('scene-mock://api/v1/couponPack/sale'),
      '/api/v1/couponPack/sale',
    );
  });

  it('keeps host/path plugin URLs', () => {
    assert.equal(
      pathnameFromPluginProtocol(
        'scene-mock://microloan-microcredit-test-c.jhjj.spider.test/api/v1/couponPack/sale',
      ),
      '/api/v1/couponPack/sale',
    );
  });

  it('collects pathnames from whistle full-url header', () => {
    const paths = candidatePathnames({
      fullUrl: 'scene-mock://api/v1/couponPack/sale',
      headers: {
        'x-whistle-full-url':
          'http%3A%2F%2Fmicroloan-microcredit-test-c.jhjj.spider.test%2Fapi%2Fv1%2FcouponPack%2Fsale',
      },
    });
    assert.ok(paths.includes('/api/v1/couponPack/sale'));
  });

  it('rebuilds /api/ prefix from relativeUrl', () => {
    const paths = candidatePathnames({
      relativeUrl: 'v1/couponPack/sale',
    });
    assert.ok(paths.includes('/api/v1/couponPack/sale'));
  });

  it('infers POST when whistle reports GET but body is json', () => {
    assert.equal(
      inferHttpMethod({
        method: 'GET',
        originalMethod: 'GET',
        headers: { 'content-type': 'application/json', 'content-length': '20' },
      }),
      'POST',
    );
    assert.equal(
      inferHttpMethod({ method: 'POST', originalMethod: 'GET' }),
      'POST',
    );
  });
});
