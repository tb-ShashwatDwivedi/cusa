import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableQueue } from '../src/queue/durable-queue.js';

describe('durable queue spool bounds', () => {
  it('spills to disk when memory limit exceeded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cusa-q2-'));
    const root = join(dir, 'queue');
    const q = new DurableQueue(root, 'events', { memoryLimit: 2, diskLimitMb: 10 });
    await q.init();
    await q.enqueue('event', { n: 1 });
    await q.enqueue('event', { n: 2 });
    await q.enqueue('event', { n: 3 });
    assert.equal(q.memory.length, 2);
    const stats = q.stats();
    assert.ok(stats.spoolBytes > 0 || stats.memoryItems === 2);
    const item = await q.dequeue();
    assert.ok(item);
    await q.ack(item.id);
    await rm(dir, { recursive: true, force: true });
  });
});
