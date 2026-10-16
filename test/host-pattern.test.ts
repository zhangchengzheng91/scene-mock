import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostToPattern, rulePatterns } from '../src/core/host-pattern';

describe('host pattern', () => {
  it('keeps whistle patterns that are not URLs', () => {
    assert.equal(hostToPattern('/api/'), '/api/');
    assert.equal(hostToPattern('example.com/api/'), 'example.com/api/');
  });

  it('drops the scheme and default port', () => {
    assert.equal(hostToPattern('http://localhost:8889'), 'localhost:8889');
    assert.equal(
      hostToPattern('http://www.example2.com'),
      'www.example2.com',
    );
    assert.equal(hostToPattern('https://api.example.com/api/'), 'api.example.com/api/');
    assert.equal(hostToPattern('https://api.example.com:8443'), 'api.example.com:8443');
  });

  it('lists path patterns before hosts and drops duplicates', () => {
    assert.deepEqual(
      rulePatterns(
        ['/api/', 'http://localhost:8889'],
        ['http://localhost:8889', 'http://www.example2.com'],
      ),
      [
        '/api/',
        'localhost:8889',
        'www.example2.com',
      ],
    );
  });
});