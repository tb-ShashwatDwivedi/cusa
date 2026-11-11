import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSync } from '../src/wazuh/v4/sync-protocol.js';

describe('sync protocol', () => {
  it('legacy mode sends d: items without session markers', async () => {
    const sent = [];
    const adapter = {
      sendPlaintext: async (text) => { sent.push(text); },
    };
    const result = await runSync(adapter, {
      syncMode: 'legacy',
      items: [{
        index: 'wazuh-states-inventory-system',
        category: 'system',
        id: 'system-1',
        operation: 'update',
        data: { hostname: 'h1' },
      }],
    });
    assert.equal(result.mode, 'legacy');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].startsWith('d:syscollector:'));
    const body = JSON.parse(sent[0].slice('d:syscollector:'.length));
    assert.equal(body.type, 'dbsync_osinfo');
    assert.equal(body.operation, 'MODIFIED');
    assert.equal(body.data.hostname, 'h1');
    assert.ok(!sent[0].includes('#SYNC'));
  });
});
