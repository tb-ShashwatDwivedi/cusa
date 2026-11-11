/** Base collector contract */
export class Collector {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.running = false;
    this.onEvent = null;
  }

  configure(config) {
    this.config = { ...this.config, ...config };
  }

  /** @param {(event: object) => void} fn */
  setEventHandler(fn) {
    this.onEvent = fn;
  }

  emit(partial) {
    this.onEvent?.(partial);
  }

  /** @param {object} partial @returns {Promise<void>} */
  async emitAsync(partial) {
    const fn = this.onEvent;
    if (!fn) return;
    await fn(partial);
  }

  async start() {
    this.running = true;
  }

  async stop() {
    this.running = false;
  }

  async health() {
    return { status: this.running ? 'running' : 'stopped', name: this.name };
  }
}
