import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBatch, buildAgentHeader } from '../src/wazuh/v4/batch-serializer.js';

describe('batch serializer', () => {
  it('includes wazuh.agent.id in header', () => {
    const h = buildAgentHeader({ agentId: '42', name: 'host' });
    assert.ok(h.startsWith('H '));
    const json = JSON.parse(h.slice(2));
    assert.equal(json.wazuh.agent.id, '042');
    assert.equal(json.wazuh.agent.name, 'host');
  });

  it('creates H and E lines', () => {
    const batch = createBatch({ agentId: '1' }, [{ log: 'test' }]);
    assert.match(batch, /^H /);
    assert.ok(batch.includes('\nE '));
  });
});
