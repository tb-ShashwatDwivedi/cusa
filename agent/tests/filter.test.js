import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyEventFilters } from '../src/pipeline/filter.js';

describe('event filters', () => {
  it('excludes by event id', () => {
    const event = {
      source: { collector: 'event-channel', channel: 'Security' },
      event: { eventId: 7036 },
      raw: 'x',
    };
    const { allow } = applyEventFilters(event, {
      filters: [{ action: 'exclude', source: 'event-channel', eventIds: [7036] }],
    });
    assert.equal(allow, false);
  });

  it('includes only matching security events', () => {
    const event = {
      source: { collector: 'windows-security' },
      event: { eventId: 4624 },
      raw: 'login',
    };
    const { allow } = applyEventFilters(event, {
      defaultAction: 'exclude',
      filters: [{ action: 'include', source: 'windows-security', eventIds: [4624, 4625] }],
    });
    assert.equal(allow, true);
  });
});
