import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compilePattern, pathnameOf } from '../src/core/matcher';

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
});
