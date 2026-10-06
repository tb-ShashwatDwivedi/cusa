import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logging/logger.js';
import { createApiServer } from '../src/api/server.js';

describe('api config patch', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  const dataDir = process.env.TEMP || '/tmp';

  before(async () => {
    const agent = {
      config: { locked: ['collectors.sysmon'], agent: { dataDir }, api: { host: '127.0.0.1', port: 0 } },
      logger: createLogger({ level: 'silent' }),
      getStatus: () => ({}),
      health: { check: async () => ({}) },
      metrics: { snapshot: () => ({}) },
      collectors: [],
      queue: {
        totalDepth: () => 0,
        events: { depth: () => 0 },
        state: { depth: () => 0 },
        commands: { depth: () => 0 },
      },
      state: { data: { fimBaseline: {} } },
      lastComplianceResults: [],
      patchConfig: async (patch) => {
        if (patch.collectors?.sysmon) throw new Error('Setting is locked: collectors.sysmon.enabled');
        return { effective: { queue: { memoryLimit: patch.queue?.memoryLimit || 10000 } }, locked: ['collectors.sysmon'] };
      },
    };
    app = await createApiServer(agent);
  });

  after(async () => {
    await app.close();
  });

  it('applies patch', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { patch: { queue: { memoryLimit: 8000 } } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().effective.queue.memoryLimit, 8000);
  });

  it('returns 403 for locked settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { patch: { collectors: { sysmon: { enabled: true } } } },
    });
    assert.equal(res.statusCode, 403);
  });

  it('returns 400 for invalid body', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/config', payload: {} });
    assert.equal(res.statusCode, 400);
  });
});
