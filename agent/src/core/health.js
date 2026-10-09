export class HealthMonitor {
  /** @param {import('./metrics.js').Metrics} metrics */
  constructor(metrics) {
    this.metrics = metrics;
    this.collectors = new Map();
    this.components = {};
    this.transport = { status: 'unknown', lastError: null };
    this.queue = { status: 'unknown', depth: 0 };
  }

  registerCollector(name, healthFn) {
    this.collectors.set(name, healthFn);
  }

  clearCollectors() {
    this.collectors.clear();
  }

  setComponent(name, status, detail = null) {
    this.components[name] = { status, detail, at: new Date().toISOString() };
  }

  setTransport(status, error = null) {
    this.transport = { status, lastError: error };
    this.metrics.transportConnected = status === 'connected';
    this.setComponent('transport', status === 'connected' ? 'HEALTHY' : 'DEGRADED', error);
  }

  setQueue(status, depth) {
    this.queue = { status, depth };
    this.metrics.set('queueDepth', depth);
    this.setComponent('queue', status === 'ok' ? 'HEALTHY' : 'DEGRADED', { depth });
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
    const transportOk = this.transport.status === 'connected';
    const collectorsOk = Object.values(collectorHealth).every((c) => c.status !== 'error');
    const overall = transportOk && collectorsOk ? 'HEALTHY' : 'DEGRADED';
    return {
      status: overall === 'HEALTHY' ? 'healthy' : 'degraded',
      statusCode: overall,
      transport: this.transport,
      queue: this.queue,
      collectors: collectorHealth,
      components: this.components,
      metrics: this.metrics.snapshot(),
    };
  }
}
