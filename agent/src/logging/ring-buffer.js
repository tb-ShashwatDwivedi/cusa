import { randomUUID } from 'node:crypto';

/** @typedef {{ id: string, ts: string, category: string, level: string, message: string, source?: string, channel?: string, preview?: string, raw?: unknown, meta?: object }} LogEntry */

export class RingBuffer {
  /** @param {number} capacity */
  constructor(capacity = 5000) {
    this.capacity = capacity;
    /** @type {LogEntry[]} */
    this.items = [];
    this.seq = 0;
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
      raw: entry.raw,
      meta: entry.meta,
    };
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
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
    const limit = opts.limit || 200;
    return list.slice(-limit).reverse();
  }

  /** @param {string} id */
  get(id) {
    return this.items.find((i) => i.id === id) || null;
  }
}
