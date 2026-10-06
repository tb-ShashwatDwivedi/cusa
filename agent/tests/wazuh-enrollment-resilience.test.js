import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WazuhAdapter } from '../src/wazuh/v4/client.js';

describe('Wazuh enrollment resilience', () => {
  it('init continues when enrollment fails (manager down)', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cusa-enroll-'));
    try {
      const adapter = new WazuhAdapter({
        manager: { address: '10.0.0.1', port: 1514, enrollmentPort: 1515 },
        enrollment: { password: 'test' },
        dataDir,
        agentName: 'test-host',
        state: { data: {}, save: async () => {} },
        metrics: { transportConnected: false, inc() {}, set() {} },
        health: { setTransport() {} },
        logger: { warn() {}, info() {} },
      });
      adapter.enroll = async () => null;

      await assert.doesNotReject(() => adapter.init());
      assert.equal(adapter.identity, null);
      assert.equal(adapter.transport, null);
      await adapter.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
