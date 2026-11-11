import { appendFile, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { forEachLine, readFirstLine, shiftFirstLine } from './spool-io.js';

const DEFAULT_MEMORY_LIMIT = 500;

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
    this.memoryLimit = opts.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    this.maxRetries = opts.maxRetries || 10;
    this.pending = [];
    this.memory = [];
    this.inFlight = null;
    this.dropped = 0;
    this.spoolBytes = 0;
    this.oldestCreatedAt = null;
    this._pendingDirty = false;
    this._pendingFlushTimer = null;
    this.pendingFlushMs = opts.pendingFlushMs ?? 300;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.pendingPath, 'utf8');
      this.pending = JSON.parse(raw);
    } catch {
      this.pending = [];
    }
    this.spoolBytes = await this.spoolSizeBytes();
    const hugeSpoolBytes = 16 * 1024 * 1024;
    if (this.spoolBytes > hugeSpoolBytes) {
      // ponytail: shiftFirstLine is O(file) per item — truncate stuck spool instead of hanging startup
      await writeFile(this.spoolPath, '');
      this.spoolBytes = 0;
      const live = new Set(this.memory.map((i) => i.id));
      this.pending = this.pending.filter((id) => live.has(id));
      await this.persistPending();
    } else {
      await this.reloadSpool();
      await this.compactPending();
      this.spoolBytes = await this.spoolSizeBytes();
    }
  }

  /** Drop pending IDs with no in-memory/spool payload (e.g. after agent restart). */
  async compactPending() {
    const live = new Set(this.memory.map((i) => i.id));
    if (this.inFlight) live.add(this.inFlight.id);
    const spoolBytes = await this.spoolSizeBytes();
    const scanCap = 8 * 1024 * 1024;
    if (spoolBytes <= scanCap) {
      try {
        await forEachLine(this.spoolPath, (line) => {
          try {
            live.add(JSON.parse(line).id);
          } catch {
            // skip bad line
          }
        });
      } catch {
        // no spool
      }
    }
    const before = this.pending.length;
    this.pending = this.pending.filter((id) => live.has(id));
    if (this.pending.length !== before) await this.persistPending();
  }

  async reloadSpool() {
    while (this.memory.length < this.memoryLimit) {
      let line;
      try {
        line = await readFirstLine(this.spoolPath);
      } catch {
        break;
      }
      if (!line) break;
      try {
        this.memory.push(JSON.parse(line));
        await shiftFirstLine(this.spoolPath);
      } catch {
        break;
      }
    }
    this.spoolBytes = await this.spoolSizeBytes();
  }

  async spoolSizeBytes() {
    try {
      const st = await stat(this.spoolPath);
      return st.size;
    } catch {
      return 0;
    }
  }

  async spoolSizeMb() {
    return (await this.spoolSizeBytes()) / (1024 * 1024);
  }

  /** @param {string} type @param {object} payload */
  async enqueue(type, payload) {
    const item = { id: randomUUID(), type, payload, attempts: 0, createdAt: Date.now() };
    this.memory.push(item);
    if (this.memory.length > this.memoryLimit) {
      const overflow = this.memory.splice(0, this.memory.length - this.memoryLimit);
      const spoolMb = await this.spoolSizeMb();
      if (spoolMb < this.diskLimitMb) {
        const chunk = overflow.map((o) => JSON.stringify(o)).join('\n') + '\n';
        await appendFile(this.spoolPath, chunk);
        this.spoolBytes += Buffer.byteLength(chunk);
      } else {
        this.dropped += overflow.length;
      }
    }
    this.pending.push(item.id);
    if (!this.oldestCreatedAt) this.oldestCreatedAt = item.createdAt;
    this.schedulePersistPending();
    return item.id;
  }

  schedulePersistPending() {
    this._pendingDirty = true;
    if (this._pendingFlushTimer) return;
    this._pendingFlushTimer = setTimeout(() => {
      this._pendingFlushTimer = null;
      void this.flushPending();
    }, this.pendingFlushMs);
    this._pendingFlushTimer.unref?.();
  }

  async flushPending() {
    if (!this._pendingDirty) return;
    this._pendingDirty = false;
    await writeFile(this.pendingPath, JSON.stringify(this.pending));
  }

  async persistPending() {
    this._pendingDirty = true;
    await this.flushPending();
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
        const line = await shiftFirstLine(this.spoolPath);
        if (!line) return null;
        item = JSON.parse(line);
        this.spoolBytes = await this.spoolSizeBytes();
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
    if (this.memory.length < this.memoryLimit) await this.reloadSpool();
  }

  /** @param {string} id */
  async requeue(id) {
    if (!this.inFlight || this.inFlight.id !== id) return;
    const item = this.inFlight;
    item.attempts += 1;
    this.inFlight = null;
    if (item.attempts >= this.maxRetries) {
      this.dropped += 1;
      this.pending = this.pending.filter((p) => p !== id);
      await this.persistPending();
      return;
    }
    this.memory.unshift(item);
    this.pending.push(item.id);
    await this.persistPending();
  }

  depth() {
    return this.pending.length;
  }

  stats() {
    return {
      depth: this.depth(),
      memoryItems: this.memory.length,
      spoolBytes: this.spoolBytes,
      dropped: this.dropped,
      overflowCount: this.dropped,
      inFlight: this.inFlight ? 1 : 0,
      oldestEventAt: this.oldestCreatedAt,
    };
  }

  async clear() {
    this.memory = [];
    this.pending = [];
    this.inFlight = null;
    this.dropped = 0;
    this.spoolBytes = 0;
    await writeFile(this.pendingPath, '[]');
    try {
      await writeFile(this.spoolPath, '');
    } catch {
      // no spool yet
    }
  }
}
