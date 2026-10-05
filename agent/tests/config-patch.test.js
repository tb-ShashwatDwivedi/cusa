import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, flattenPatch, isPathLocked } from '../src/config/loader.js';

describe('config patch', () => {
  it('merges nested patch into overlay', () => {
    const out = applyPatch({}, { queue: { memoryLimit: 5000 } }, []);
    assert.equal(out.queue.memoryLimit, 5000);
  });

  it('rejects locked paths', () => {
    assert.throws(
      () => applyPatch({}, { collectors: { sysmon: { enabled: true } } }, ['collectors.sysmon']),
      /locked/i,
    );
  });

  it('flattens nested patch keys', () => {
    const flat = flattenPatch({ collectors: { eventChannel: { enabled: false } } });
    assert.equal(flat['collectors.eventChannel.enabled'], false);
  });

  it('matches child paths as locked', () => {
    assert.equal(isPathLocked('collectors.sysmon.enabled', new Set(['collectors.sysmon'])), true);
    assert.equal(isPathLocked('queue.memoryLimit', new Set(['collectors.sysmon'])), false);
  });
});
