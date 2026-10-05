import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdapter, isLegacyProtocol, isHttpsProtocol } from '../src/wazuh/version.js';

describe('wazuh version resolution', () => {
  it('maps 4.x to v4 adapter', () => {
    assert.equal(resolveAdapter('4.x'), 'v4');
    assert.ok(isLegacyProtocol('4.x'));
    assert.ok(!isHttpsProtocol('4.x'));
  });

  it('maps 5.x-released to v4 adapter', () => {
    assert.equal(resolveAdapter('5.x-released'), 'v4');
    assert.ok(isLegacyProtocol('5.x-released'));
  });

  it('maps 5.x-https to v5 adapter', () => {
    assert.equal(resolveAdapter('5.x-https'), 'v5');
    assert.ok(isHttpsProtocol('5.x-https'));
    assert.ok(!isLegacyProtocol('5.x-https'));
  });

  it('rejects unknown versions', () => {
    assert.throws(() => resolveAdapter('3.x'), /Unsupported/);
  });
});
