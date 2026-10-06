import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAdapter,
  isLegacyProtocol,
  isHttpsProtocol,
  normalizeVersion,
  getProtocolProfile,
} from '../src/wazuh/version.js';

describe('wazuh version resolution', () => {
  it('maps 4.x and 4.11 to v4 adapter', () => {
    assert.equal(resolveAdapter('4.x'), 'v4');
    assert.equal(resolveAdapter('4.11'), 'v4');
    assert.equal(normalizeVersion('4.11'), '4.x');
    assert.ok(isLegacyProtocol('4.11'));
    assert.ok(!isHttpsProtocol('4.11'));
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

  it('selects legacy sync for Wazuh 4.11 manager', () => {
    const profile = getProtocolProfile('4.11');
    assert.equal(profile.syncMode, 'legacy');
    assert.equal(profile.enrollVersion, 'Wazuh v4.11.2');
    assert.equal(profile.managerTarget, '4.11');
  });

  it('allows explicit enrollment agentVersion override', () => {
    const profile = getProtocolProfile('4.11', { agentVersion: 'Wazuh v4.11.5' });
    assert.equal(profile.enrollVersion, 'Wazuh v4.11.5');
  });
});
