import { appendFile, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class DurableQueue {
  /**
   * @param {string} dataDir
   * @param {string} name
   * @param {number} [diskLimitMb]
   */
  constructor(dataDir, name, diskLimitMb = 256) {
    this.dir = join(dataDir, 'queue', name);
    this.spoolPath = join(this.dir, 'spool.jsonl');
    this.pendingPath = join(this.dir, 'pending.json');
    this.diskLimitMb = diskLimitMb;
    this.pending = [];
    this.memory = [];
    this.memoryLimit = 10000;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.pendingPath, 'utf8');
      this.pending = JSON.parse(raw);
    } catch {
      this.pending = [];
    }
  }

  /** @param {string} type @param {object} payload */
  async enqueue(type, payload) {
    const item = { id: randomUUID(), type, payload, attempts: 0, createdAt: Date.now() };
    this.memory.push(item);
    if (this.memory.length > this.memoryLimit) {
      const overflow = this.memory.splice(0, this.memory.length - this.memoryLimit);
      await appendFile(this.spoolPath, overflow.map((o) => JSON.stringify(o)).join('\n') + '\n');
    }
    this.pending.push(item.id);
    await this.persistPending();
    return item.id;
  }

  async persistPending() {
    await writeFile(this.pendingPath, JSON.stringify(this.pending));
  }

  /** @returns {Promise<object|null>} */
  async dequeue() {
    if (this.memory.length) return this.memory.shift();
    try {
      const raw = await readFile(this.spoolPath, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      if (!lines.length) return null;
      const item = JSON.parse(lines[0]);
      await writeFile(this.spoolPath, lines.slice(1).join('\n') + (lines.length > 1 ? '\n' : ''));
      return item;
    } catch {
      return null;
    }
  }

  /** @param {string} id */
  async ack(id) {
    this.pending = this.pending.filter((p) => p !== id);
    await this.persistPending();
  }

  depth() {
    return this.memory.length + this.pending.length;
  }
}
