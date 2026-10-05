/**
 * Wazuh HTTPS adapter (5.x-https development protocol).
 * NOT compatible with released Wazuh Manager.
 * @see docs/wazuh-compatibility.md § HTTPS protocol
 */

export class WazuhAdapter {
  /** @param {object} options */
  constructor(options) {
    this.options = options;
  }

  async init() {
    throw new Error(
      'Wazuh v5 HTTPS adapter not yet implemented — target Manager must run 5.0.0-https branch',
    );
  }

  async enroll() {
    throw new Error('Not implemented');
  }

  async sendEvents(_events) {
    throw new Error('Not implemented');
  }

  async syncState(_state) {
    throw new Error('Not implemented');
  }

  async pollCommands() {
    throw new Error('Not implemented');
  }

  async sendCommandResult(_result) {
    throw new Error('Not implemented');
  }

  async fetchConfiguration() {
    throw new Error('Not implemented');
  }

  async sendHealth() {
    throw new Error('Not implemented');
  }

  async close() {
    // no-op
  }
}
