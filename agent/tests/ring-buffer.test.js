import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from '../src/logging/ring-buffer.js';

describe('ring buffer bytes', () => {
  it('drops oldest data when byte budget exceeded', () => {
    const buf = new RingBuffer(100, 500);
    for (let i = 0; i < 20; i++) {
      buf.push({ category: 'agent', level: 'info', message: 'x'.repeat(80) });
    }
    assert.ok(buf.items.length < 20);
  });
});
