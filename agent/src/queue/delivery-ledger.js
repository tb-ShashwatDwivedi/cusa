const TTL_MS = 24 * 60 * 60 * 1000;

/** Suppress re-send of the same queue item after a successful transport write. */
export class DeliveryLedger {
  constructor() {
    this.sent = new Map();
  }

  /** @param {string} queueItemId */
  wasSent(queueItemId) {
    const row = this.sent.get(queueItemId);
    if (!row) return false;
    if (Date.now() - row.at > TTL_MS) {
      this.sent.delete(queueItemId);
      return false;
    }
    return true;
  }

  /** @param {string} queueItemId */
  markSent(queueItemId) {
    this.sent.set(queueItemId, { at: Date.now() });
    if (this.sent.size > 100000) {
      const keys = [...this.sent.keys()].slice(0, 50000);
      for (const k of keys) this.sent.delete(k);
    }
  }
}
