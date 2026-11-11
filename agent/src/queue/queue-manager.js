import { DurableQueue } from './durable-queue.js';
import { DeliveryLedger } from './delivery-ledger.js';
import { isLegacySyscheckState } from '../fim/wire-event.js';

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
    this.disconnectedFlushIntervalMs = config.disconnectedFlushIntervalMs || 20000;
    this.batchSize = config.batchSize || 50;
    this.backlogFlushIntervalMs = config.backlogFlushIntervalMs || this.flushIntervalMs;
    this.stateBatchSize = config.stateBatchSize || 100;
    this.maxEventBatchSize = config.maxEventBatchSize || 100;
    this.maxRetries = config.maxRetries || 10;
    this.running = false;
    this.flushTimers = [];
    this.deliveryLedger = new DeliveryLedger();
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
      if (!metrics.transportConnected) {
        schedule(flushEvents, this.disconnectedFlushIntervalMs);
        return;
      }
      const eventDepth = this.events.depth();
      const backlog = eventDepth > 150;
      const batchLimit = backlog
        ? Math.min(this.maxEventBatchSize, this.batchSize * 2)
        : this.batchSize;
      const nextDelay = backlog
        ? Math.max(150, Math.floor(this.flushIntervalMs / 2))
        : this.flushIntervalMs;
      const batch = [];
      for (let i = 0; i < batchLimit; i++) {
        const item = await this.events.dequeue();
        if (!item) break;
        batch.push(item);
      }
      if (batch.length) {
        try {
          const toSend = [];
          for (const item of batch) {
            if (this.deliveryLedger.wasSent(item.id)) {
              metrics.inc('eventsDeliveryDuplicateSuppressed');
              await this.events.ack(item.id);
              continue;
            }
            toSend.push(item);
          }
          if (toSend.length) {
            await wazuh.sendEvents(toSend.map((b) => b.payload));
            for (const item of toSend) {
              this.deliveryLedger.markSent(item.id);
              await this.events.ack(item.id);
            }
          }
        } catch {
          for (const item of batch) {
            if (!this.deliveryLedger.wasSent(item.id)) await this.events.requeue(item.id);
          }
          metrics.inc('eventsFailed');
        }
      }
      batch.length = 0;
      metrics.set('queueDepth', this.totalDepth());
      metrics.set('queueDropped', this.totalDropped());
      schedule(flushEvents, nextDelay);
    };

    const flushState = async () => {
      if (!this.running) return;
      if (!metrics.transportConnected) {
        schedule(flushState, this.disconnectedFlushIntervalMs);
        return;
      }
      const stateDepth = this.state.depth();
      const stateLimit = stateDepth > 200
        ? this.stateBatchSize * 4
        : stateDepth > 50
          ? this.stateBatchSize * 2
          : this.stateBatchSize;
      const stateDelay = stateDepth > 0
        ? Math.min(400, Math.max(150, this.flushIntervalMs / 2))
        : this.flushIntervalMs * 2;
      const items = [];
      for (let i = 0; i < stateLimit; i++) {
        const item = await this.state.dequeue();
        if (!item) break;
        if (isLegacySyscheckState(item.payload)) {
          await this.state.ack(item.id);
          metrics.inc('stateLegacySyscheckDropped');
          continue;
        }
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
      schedule(flushState, stateDelay);
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
    return Promise.all([
      this.events.flushPending(),
      this.state.flushPending(),
      this.commands.flushPending(),
      this.results.flushPending(),
    ]);
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
