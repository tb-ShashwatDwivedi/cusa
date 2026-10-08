import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableQueue } from '../src/queue/durable-queue.js';

describe('durable queue compact', () => {
  it('drops orphan pending ids on init', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cusa-q-'));
    const root = join(dir, 'queue');
    const q = new DurableQueue(root, 'events');
    await q.init();
    q.pending = ['orphan-1', 'orphan-2'];
    await q.persistPending();
    const q2 = new DurableQueue(root, 'events');
    await q2.init();
    assert.equal(q2.pending.length, 0);
    assert.equal(q2.depth(), 0);
    await rm(dir, { recursive: true, force: true });
  });
});
