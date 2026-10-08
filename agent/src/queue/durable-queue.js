import { appendFile, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class DurableQueue {
  /**
   * @param {string} queueRoot base queue directory (…/queue)
   * @param {string} name
   * @param {object} [opts]
   */
  constructor(queueRoot, name, opts = {}) {
    this.dir = join(queueRoot, name);
    this.spoolPath = join(this.dir, 'spool.jsonl');
    this.pendingPath = join(this.dir, 'pending.json');
    this.diskLimitMb = opts.diskLimitMb || 256;
    this.memoryLimit = opts.memoryLimit || 10000;
    this.maxRetries = opts.maxRetries || 10;
    this.pending = [];
    this.memory = [];
    this.inFlight = null;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.pendingPath, 'utf8');
      this.pending = JSON.parse(raw);
    } catch {
      this.pending = [];
    }
    await this.reloadSpool();
    await this.compactPending();
  }

  /** Drop pending IDs with no in-memory/spool payload (e.g. after agent restart). */
  async compactPending() {
    const live = new Set(this.memory.map((i) => i.id));
    if (this.inFlight) live.add(this.inFlight.id);
    try {
      const raw = await readFile(this.spoolPath, 'utf8');
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        try {
          live.add(JSON.parse(line).id);
        } catch {
          // skip bad line
        }
      }
    } catch {
      // no spool
    }
    const before = this.pending.length;
    this.pending = this.pending.filter((id) => live.has(id));
    if (this.pending.length !== before) await this.persistPending();
  }

  async reloadSpool() {
    try {
      const raw = await readFile(this.spoolPath, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        this.memory.push(JSON.parse(line));
      }
      if (lines.length) await writeFile(this.spoolPath, '');
    } catch {
      // no spool yet
    }
  }

  async spoolSizeMb() {
    try {
      const st = await stat(this.spoolPath);
      return st.size / (1024 * 1024);
    } catch {
      return 0;
    }
  }

  /** @param {string} type @param {object} payload */
  async enqueue(type, payload) {
    const item = { id: randomUUID(), type, payload, attempts: 0, createdAt: Date.now() };
    this.memory.push(item);
    if (this.memory.length > this.memoryLimit) {
      const overflow = this.memory.splice(0, this.memory.length - this.memoryLimit);
      if (await this.spoolSizeMb() < this.diskLimitMb) {
        await appendFile(this.spoolPath, overflow.map((o) => JSON.stringify(o)).join('\n') + '\n');
      }
    }
    this.pending.push(item.id);
    await this.persistPending();
    return item.id;
  }

  async persistPending() {
    await writeFile(this.pendingPath, JSON.stringify(this.pending));
  }

  /** @returns {object|null} */
  peek() {
    if (this.inFlight) return this.inFlight;
    if (this.memory.length) return this.memory[0];
    return null;
  }

  /** @returns {Promise<object|null>} */
  async dequeue() {
    if (this.inFlight) return this.inFlight;
    let item = null;
    if (this.memory.length) {
      item = this.memory.shift();
    } else {
      try {
        const raw = await readFile(this.spoolPath, 'utf8');
        const lines = raw.trim().split('\n').filter(Boolean);
        if (!lines.length) return null;
        item = JSON.parse(lines[0]);
        await writeFile(this.spoolPath, lines.slice(1).join('\n') + (lines.length > 1 ? '\n' : ''));
      } catch {
        return null;
      }
    }
    if (item) this.inFlight = item;
    return item;
  }

  /** @param {string} id */
  async ack(id) {
    this.pending = this.pending.filter((p) => p !== id);
    if (this.inFlight?.id === id) this.inFlight = null;
    await this.persistPending();
  }

  /** @param {string} id */
  async requeue(id) {
    if (!this.inFlight || this.inFlight.id !== id) return;
    const item = this.inFlight;
    item.attempts += 1;
    this.inFlight = null;
    if (item.attempts >= this.maxRetries) return;
    this.memory.unshift(item);
    this.pending.push(item.id);
    await this.persistPending();
  }

  depth() {
    return this.pending.length;
  }

  async clear() {
    this.memory = [];
    this.pending = [];
    this.inFlight = null;
    await writeFile(this.pendingPath, '[]');
    try {
      await writeFile(this.spoolPath, '');
    } catch {
      // no spool yet
    }
  }
}
