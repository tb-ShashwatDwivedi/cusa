import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { istTimestamp, istDateString } from '../src/logging/ist.js';

describe('IST log formatting', () => {
  it('formats timestamp with IST suffix', () => {
    const ts = istTimestamp(new Date('2026-10-07T05:05:12.000Z'));
    assert.match(ts, /IST$/);
    assert.match(ts, /2026-10-07/);
  });

  it('formats date in Asia/Kolkata', () => {
    const day = istDateString(new Date('2026-10-07T20:30:00.000Z'));
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  });
});
