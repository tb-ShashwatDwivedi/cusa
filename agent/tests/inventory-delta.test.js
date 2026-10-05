import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta } from '../src/inventory/delta.js';

describe('inventory delta', () => {
  it('detects create, update, delete', () => {
    const prev = [
      { id: 'a', data: { x: 1 } },
      { id: 'b', data: { y: 2 } },
    ];
    const curr = [
      { id: 'a', data: { x: 2 } },
      { id: 'c', data: { z: 3 } },
    ];
    const delta = computeDelta(prev, curr);
    assert.ok(delta.find((d) => d.id === 'a' && d.operation === 'update'));
    assert.ok(delta.find((d) => d.id === 'b' && d.operation === 'delete'));
    assert.ok(delta.find((d) => d.id === 'c' && d.operation === 'create'));
  });
});
