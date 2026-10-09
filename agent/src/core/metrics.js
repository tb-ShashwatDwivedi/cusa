import os from 'node:os';
import { memorySnapshot, eventLoopSnapshot } from './memory.js';

export class Metrics {
  constructor() {
    this.counters = {
      eventsCollected: 0,
      eventsSent: 0,
      eventsFailed: 0,
      queueDepth: 0,
      queueDropped: 0,
      commandsReceived: 0,
      commandsExecuted: 0,
    };
    this.startedAt = Date.now();
    this.lastEventAt = null;
    this.transportConnected = false;
  }

  inc(name, n = 1) {
    this.counters[name] = (this.counters[name] || 0) + n;
  }

  set(name, value) {
    this.counters[name] = value;
  }

  eventsPerSec() {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    return elapsed > 0 ? (this.counters.eventsSent / elapsed).toFixed(2) : '0.00';
  }

  snapshot() {
    const mem = memorySnapshot();
    const elu = eventLoopSnapshot();
    return {
      ...this.counters,
      eventsPerSec: this.eventsPerSec(),
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      processUptimeSec: mem.uptime_sec,
      transportConnected: this.transportConnected,
      memoryMb: mem.memory.rss_mb,
      memory: mem.memory,
      handles: mem.handles,
      eventLoop: elu,
      cpuCount: os.cpus().length,
      loadAvg: os.loadavg(),
      lastEventAt: this.lastEventAt,
    };
  }
}
