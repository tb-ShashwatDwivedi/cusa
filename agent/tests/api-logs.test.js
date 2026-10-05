import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eventLog } from '../src/logging/event-log.js';
import { Agent } from '../src/core/agent.js';
import { createLogger } from '../src/logging/logger.js';
import { createApiServer } from '../src/api/server.js';

describe('api logs', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  /** @type {Agent} */
  let agent;

  before(async () => {
    eventLog.agent('test agent log');
    eventLog.collected({
      eventId: 't1',
      source: { collector: 'test', channel: 'ch1' },
      event: { category: 'test' },
      raw: { hello: 'world' },
    });
    agent = {
      config: { api: { host: '127.0.0.1', port: 0 } },
      logger: createLogger({ level: 'silent' }),
      getStatus: () => ({}),
      health: { check: async () => ({}) },
      metrics: { snapshot: () => ({}) },
      collectors: [],
      queue: { totalDepth: () => 0, events: { depth: () => 0 }, state: { depth: () => 0 }, commands: { depth: () => 0 } },
    };
    app = await createApiServer(agent);
  });

  after(async () => {
    await app.close();
  });

  it('returns categorized logs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logs?category=agent' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.logs.some((l) => l.category === 'agent'));
  });

  it('returns single log by id', async () => {
    const list = eventLog.query({ category: 'collected', limit: 1 });
    const id = list[0].id;
    const res = await app.inject({ method: 'GET', url: `/api/logs/${id}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().id, id);
  });
});
