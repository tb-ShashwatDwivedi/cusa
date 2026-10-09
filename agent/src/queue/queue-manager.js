import { DurableQueue } from './durable-queue.js';

export class QueueManager {
  /** @param {string} queueRoot @param {object} config */
  constructor(queueRoot, config) {
    const qOpts = {
      diskLimitMb: config.diskLimitMb,
      memoryLimit: config.memoryLimit,
      maxRetries: config.maxRetries,
    };
    this.events = new DurableQueue(queueRoot, 'events', qOpts);
    this.state = new DurableQueue(queueRoot, 'state', qOpts);
    this.commands = new DurableQueue(queueRoot, 'commands', qOpts);
    this.results = new DurableQueue(queueRoot, 'command-results', qOpts);
    this.flushIntervalMs = config.flushIntervalMs || 1000;
    this.batchSize = config.batchSize || 50;
    this.backlogFlushIntervalMs = config.backlogFlushIntervalMs || this.flushIntervalMs;
    this.maxRetries = config.maxRetries || 10;
    this.running = false;
    this.flushTimers = [];
  }

  async init() {
    await Promise.all([
      this.events.init(),
      this.state.init(),
      this.commands.init(),
      this.results.init(),
    ]);
  }

  async enqueueEvent(payload) {
    return this.events.enqueue('event', payload);
  }

  async enqueueState(payload) {
    return this.state.enqueue('state', payload);
  }

  async enqueueCommand(payload) {
    return this.commands.enqueue('command', payload);
  }

  async enqueueCommandResult(payload) {
    return this.results.enqueue('result', payload);
  }

  totalDepth() {
    return this.events.depth() + this.state.depth() + this.commands.depth();
  }

  queueStats() {
    return {
      events: this.events.stats(),
      state: this.state.stats(),
      commands: this.commands.stats(),
      results: this.results.stats(),
      totalDepth: this.totalDepth(),
    };
  }

  /** @param {import('../wazuh/client.js').WazuhClient} wazuh @param {import('../core/metrics.js').Metrics} metrics */
  startFlusher(wazuh, metrics) {
    this.running = true;
    const schedule = (fn, delay) => {
      const t = setTimeout(fn, delay);
      t.unref?.();
      this.flushTimers.push(t);
      return t;
    };

    const flushEvents = async () => {
      if (!this.running) return;
      const batch = [];
      for (let i = 0; i < this.batchSize; i++) {
        const item = await this.events.dequeue();
        if (!item) break;
        batch.push(item);
      }
      if (batch.length) {
        try {
          await wazuh.sendEvents(batch.map((b) => b.payload));
          for (const item of batch) await this.events.ack(item.id);
        } catch {
          for (const item of batch) await this.events.requeue(item.id);
        }
      }
      batch.length = 0;
      metrics.set('queueDepth', this.totalDepth());
      metrics.set('queueDropped', this.totalDropped());
      schedule(flushEvents, this.flushIntervalMs);
    };

    const flushState = async () => {
      if (!this.running) return;
      const items = [];
      for (let i = 0; i < 100; i++) {
        const item = await this.state.dequeue();
        if (!item) break;
        items.push(item);
      }
      if (items.length) {
        try {
          await wazuh.syncState(items.map((i) => i.payload));
          for (const item of items) await this.state.ack(item.id);
        } catch {
          for (const item of items) await this.state.requeue(item.id);
        }
      }
      items.length = 0;
      schedule(flushState, this.flushIntervalMs * 2);
    };

    const flushResults = async () => {
      if (!this.running) return;
      const item = await this.results.dequeue();
      if (item) {
        try {
          await wazuh.sendCommandResult(item.payload);
          await this.results.ack(item.id);
        } catch {
          await this.results.requeue(item.id);
        }
      }
      schedule(flushResults, this.flushIntervalMs);
    };

    flushEvents();
    flushState();
    flushResults();
  }

  totalDropped() {
    return (
      this.events.dropped
      + this.state.dropped
      + this.commands.dropped
      + this.results.dropped
    );
  }

  stop() {
    this.running = false;
    for (const t of this.flushTimers) clearTimeout(t);
    this.flushTimers = [];
  }

  /** Wipe all queued items (does not affect Wazuh counters on manager). */
  async clearAll() {
    await Promise.all([
      this.events.clear(),
      this.state.clear(),
      this.commands.clear(),
      this.results.clear(),
    ]);
  }

  /** Best-effort flush before shutdown. @param {import('../wazuh/client.js').WazuhClient} wazuh @param {number} [timeoutMs] */
  async drain(wazuh, timeoutMs = 15000) {
    this.running = false;
    for (const t of this.flushTimers) clearTimeout(t);
    this.flushTimers = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.totalDepth() > 0) {
      const batch = [];
      for (let i = 0; i < this.batchSize; i++) {
        const item = await this.events.dequeue();
        if (!item) break;
        batch.push(item);
      }
      if (batch.length) {
        try {
          await wazuh.sendEvents(batch.map((b) => b.payload));
          for (const item of batch) await this.events.ack(item.id);
        } catch {
          for (const item of batch) await this.events.requeue(item.id);
          break;
        }
      }
      batch.length = 0;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
