import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eventLog } from '../src/logging/event-log.js';

describe('event log', () => {
  it('stores agent and collected entries', () => {
    eventLog.agent('Agent started', { manager: '192.168.0.185' });
    eventLog.collected({
      eventId: 'e1',
      source: { platform: 'windows', collector: 'event-channel', channel: 'Security' },
      event: { category: 'windows' },
      raw: 'x'.repeat(300),
    });
    const agent = eventLog.query({ category: 'agent', limit: 10 });
    const collected = eventLog.query({ category: 'collected', limit: 10 });
    assert.ok(agent.some((e) => e.message === 'Agent started'));
    const row = collected.find((e) => e.source === 'event-channel');
    assert.ok(row);
    assert.equal(row.preview?.endsWith('…'), true);
    assert.equal(row.raw, undefined);
  });

  it('retrieves full entry by id', () => {
    const entry = eventLog.agent('test lookup');
    const found = eventLog.get(entry.id);
    assert.equal(found?.message, 'test lookup');
  });
});
