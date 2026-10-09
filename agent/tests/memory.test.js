import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memorySnapshot, activeHandleEstimate } from '../src/core/memory.js';

describe('memory diagnostics', () => {
  it('exposes rss and heap fields in MB', () => {
    const snap = memorySnapshot();
    assert.ok(snap.memory.rss_mb > 0);
    assert.ok(snap.memory.heap_used_mb >= 0);
    assert.ok(snap.uptime_sec >= 0);
    const handles = activeHandleEstimate();
    assert.ok(typeof handles.activeHandles === 'number');
  });
});
