/**
 * WazuhClient facade — protocol-agnostic interface.
 * Implementation delegated to v4/ or v5/ adapter based on config.
 * @see docs/wazuh-compatibility.md
 */

import { resolveAdapter } from './version.js';

/**
 * @typedef {object} WazuhClientOptions
 * @property {import('./version.js').WazuhVersion} version
 * @property {object} manager
 * @property {object} [enrollment]
 * @property {import('pino').Logger} [logger]
 */

export class WazuhClient {
  /** @param {WazuhClientOptions} options */
  constructor(options) {
    this.options = options;
    this.adapter = null;
  }

  /** @returns {Promise<void>} */
  async init() {
    const adapterName = resolveAdapter(this.options.version);
    const mod = await import(`./${adapterName}/client.js`);
    this.adapter = new mod.WazuhAdapter({
      ...this.options,
      manager: this.options.manager,
      enrollment: this.options.enrollment,
      dataDir: this.options.dataDir,
      agentName: this.options.agentName,
      state: this.options.state,
      metrics: this.options.metrics,
      logger: this.options.logger,
    });
    await this.adapter.init();
  }

  async enroll() {
    return this.adapter.enroll();
  }

  /** @param {object[]} events */
  async sendEvents(events) {
    return this.adapter.sendEvents(events);
  }

  /** @param {object} state */
  async syncState(state) {
    return this.adapter.syncState(state);
  }

  async pollCommands() {
    return this.adapter.pollCommands();
  }

  /** @param {object} result */
  async sendCommandResult(result) {
    return this.adapter.sendCommandResult(result);
  }

  async fetchConfiguration() {
    return this.adapter.fetchConfiguration();
  }

  async sendHealth() {
    return this.adapter.sendHealth();
  }

  async close() {
    if (this.adapter) await this.adapter.close();
  }
}
