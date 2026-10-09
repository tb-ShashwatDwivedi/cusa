import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFirstLine, shiftFirstLine, forEachLine } from '../src/queue/spool-io.js';

describe('spool-io', () => {
  it('reads and shifts first line without loading entire file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cusa-spool-'));
    const path = join(dir, 'spool.jsonl');
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ id: i }));
    await writeFile(path, lines.join('\n') + '\n');
    const first = await readFirstLine(path);
    assert.equal(JSON.parse(first).id, 0);
    const shifted = await shiftFirstLine(path);
    assert.equal(JSON.parse(shifted).id, 0);
    let count = 0;
    await forEachLine(path, () => {
      count += 1;
    });
    assert.equal(count, 49);
    await rm(dir, { recursive: true, force: true });
  });
});
