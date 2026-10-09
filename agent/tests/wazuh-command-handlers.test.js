import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WazuhAdapter } from '../src/wazuh/v4/client.js';

describe('wazuh v4 command handlers', () => {
  it('replaces handler on reload instead of stacking', () => {
    const adapter = new WazuhAdapter({
      manager: {},
      state: { data: {}, save: async () => {} },
      dataDir: '/tmp',
    });
    let calls = 0;
    adapter.onCommand(() => {
      calls += 1;
    });
    adapter.onCommand(() => {
      calls += 10;
    });
    assert.equal(adapter.commandHandlers.length, 1);
    adapter.close();
    assert.equal(adapter.commandHandlers.length, 0);
  });
});
