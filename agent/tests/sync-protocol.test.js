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
      items: [{ index: 'wazuh-states-inventory-system', data: { os: 'win32' } }],
    });
    assert.equal(result.mode, 'legacy');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].startsWith('d:wazuh-states-inventory-system:'));
    assert.ok(!sent[0].includes('#SYNC'));
  });
});
