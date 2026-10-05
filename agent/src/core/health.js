export class HealthMonitor {
  /** @param {import('./metrics.js').Metrics} metrics */
  constructor(metrics) {
    this.metrics = metrics;
    this.collectors = new Map();
    this.transport = { status: 'unknown', lastError: null };
    this.queue = { status: 'unknown', depth: 0 };
  }

  registerCollector(name, healthFn) {
    this.collectors.set(name, healthFn);
  }

  setTransport(status, error = null) {
    this.transport = { status, lastError: error };
    this.metrics.transportConnected = status === 'connected';
  }

  setQueue(status, depth) {
    this.queue = { status, depth };
    this.metrics.set('queueDepth', depth);
  }

  async check() {
    const collectorHealth = {};
    for (const [name, fn] of this.collectors) {
      try {
        collectorHealth[name] = await fn();
      } catch (err) {
        collectorHealth[name] = { status: 'error', error: err.message };
      }
    }
    const allOk =
      this.transport.status === 'connected' &&
      Object.values(collectorHealth).every((c) => c.status !== 'error');
    return {
      status: allOk ? 'healthy' : 'degraded',
      transport: this.transport,
      queue: this.queue,
      collectors: collectorHealth,
      metrics: this.metrics.snapshot(),
    };
  }
}
