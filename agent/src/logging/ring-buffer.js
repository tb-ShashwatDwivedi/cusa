import { randomUUID } from 'node:crypto';

/** @typedef {{ id: string, ts: string, category: string, level: string, message: string, source?: string, channel?: string, preview?: string, meta?: object }} LogEntry */

export class RingBuffer {
  /**
   * @param {number} capacity max entries
   * @param {number} [maxBytes] max retained payload bytes (approx)
   */
  constructor(capacity = 5000, maxBytes = 2 * 1024 * 1024) {
    this.capacity = capacity;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    /** @type {LogEntry[]} */
    this.items = [];
    this.seq = 0;
  }

  entryBytes(entry) {
    let n = (entry.message?.length || 0) + (entry.preview?.length || 0);
    if (entry.meta) n += JSON.stringify(entry.meta).length;
    return n + 200;
  }

  trimBytes() {
    while (this.items.length && this.bytes > this.maxBytes) {
      const removed = this.items.shift();
      if (removed) this.bytes -= this.entryBytes(removed);
    }
  }

  /** @param {Omit<LogEntry, 'id'|'ts'> & { ts?: string }} entry */
  push(entry) {
    const item = {
      id: randomUUID(),
      ts: entry.ts || new Date().toISOString(),
      category: entry.category,
      level: entry.level || 'info',
      message: entry.message,
      source: entry.source,
      channel: entry.channel,
      preview: entry.preview,
      meta: entry.meta,
    };
    this.items.push(item);
    this.bytes += this.entryBytes(item);
    if (this.items.length > this.capacity) {
      const removed = this.items.splice(0, this.items.length - this.capacity);
      for (const r of removed) this.bytes -= this.entryBytes(r);
    }
    this.trimBytes();
    this.seq += 1;
    return item;
  }

  /** @param {{ category?: string, limit?: number, since?: string, search?: string }} opts */
  query(opts = {}) {
    let list = this.items;
    if (opts.category) list = list.filter((i) => i.category === opts.category);
    if (opts.since) list = list.filter((i) => i.ts >= opts.since);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      list = list.filter(
        (i) =>
          i.message.toLowerCase().includes(q) ||
          i.preview?.toLowerCase().includes(q) ||
          i.source?.toLowerCase().includes(q),
      );
    }
    const limit = Math.min(opts.limit || 200, 500);
    return list.slice(-limit).reverse();
  }

  /** @param {string} id */
  get(id) {
    return this.items.find((i) => i.id === id) || null;
  }
}
