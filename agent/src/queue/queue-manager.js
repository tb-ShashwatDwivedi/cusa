import { DurableQueue } from './durable-queue.js';

export class QueueManager {
  /** @param {string} dataDir @param {object} config */
  constructor(dataDir, config) {
    this.events = new DurableQueue(dataDir, 'events', config.diskLimitMb);
    this.state = new DurableQueue(dataDir, 'state', config.diskLimitMb);
    this.commands = new DurableQueue(dataDir, 'commands', config.diskLimitMb);
    this.results = new DurableQueue(dataDir, 'command-results', config.diskLimitMb);
    this.flushIntervalMs = config.flushIntervalMs || 1000;
    this.maxRetries = config.maxRetries || 10;
    this.running = false;
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

  totalDepth() {
    return this.events.depth() + this.state.depth() + this.commands.depth();
  }

  /** @param {import('../wazuh/client.js').WazuhClient} wazuh @param {import('../core/metrics.js').Metrics} metrics */
  startFlusher(wazuh, metrics) {
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      const batch = [];
      for (let i = 0; i < 50; i++) {
        const item = await this.events.dequeue();
        if (!item) break;
        batch.push(item);
      }
      if (batch.length) {
        try {
          await wazuh.sendEvents(batch.map((b) => b.payload));
          for (const item of batch) await this.events.ack(item.id);
        } catch {
          for (const item of batch) this.events.memory.unshift(item);
        }
      }
      metrics.set('queueDepth', this.totalDepth());
      setTimeout(tick, this.flushIntervalMs);
    };
    tick();
  }

  stop() {
    this.running = false;
  }
}
