import { createReadStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Read the first line of a text file without loading the whole file. */
export async function readFirstLine(path) {
  const handle = await open(path, 'r');
  try {
    let buf = '';
    const stream = handle.createReadStream({ encoding: 'utf8', highWaterMark: 64 * 1024 });
    for await (const chunk of stream) {
      buf += chunk;
      const idx = buf.indexOf('\n');
      if (idx !== -1) return buf.slice(0, idx);
    }
    return buf.trim() || null;
  } finally {
    await handle.close();
  }
}

/** Remove the first line from a JSONL spool (stream copy; does not load entire file into a string). */
export async function shiftFirstLine(path) {
  const first = await readFirstLine(path);
  if (!first) {
    try {
      await unlink(path);
    } catch {
      // absent
    }
    return null;
  }
  const dir = join(path, '..');
  const tmp = join(dir, `.spool-shift-${randomUUID()}`);
  const inHandle = await open(path, 'r');
  const outHandle = await open(tmp, 'w');
  try {
    let skipped = false;
    let carry = '';
    const stream = inHandle.createReadStream({ encoding: 'utf8', highWaterMark: 64 * 1024 });
    for await (const chunk of stream) {
      let data = carry + chunk;
      carry = '';
      if (!skipped) {
        const idx = data.indexOf('\n');
        if (idx === -1) {
          carry = data;
          continue;
        }
        data = data.slice(idx + 1);
        skipped = true;
      }
      if (data) await outHandle.write(data);
    }
    if (carry && skipped) await outHandle.write(carry);
  } finally {
    await inHandle.close();
    await outHandle.close();
  }
  await rename(tmp, path);
  return first;
}

/** @param {string} path @param {(line: string) => void | Promise<void>} fn */
export async function forEachLine(path, fn) {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) await fn(line);
    }
  }
  if (buf.trim()) await fn(buf);
}
