import { deriveEncryptionKey, encryptMessage, decryptMessage } from './crypto.js';
import { enroll, loadIdentity, persistIdentity } from './enrollment.js';
import { enrollViaApi } from './api-enrollment.js';
import { TcpTransport } from './transport.js';
import { serializeEvent, serializeStateItem } from './event-serializer.js';

export class WazuhAdapter {
  /** @param {object} options */
  constructor(options) {
    this.options = options;
    this.logger = options.logger;
    this.state = options.state;
    this.metrics = options.metrics;
    this.identity = null;
    this.encKey = null;
    this.transport = null;
    this.commandHandlers = [];
  }

  async init() {
    const { manager, enrollment } = this.options;
    this.identity = await loadIdentity(this.options.dataDir);
    if (!this.identity && manager.address) {
      await this.enroll();
    }
    if (this.identity) {
      this.encKey = deriveEncryptionKey(this.identity.key, this.identity.name, this.identity.id);
    }
    this.transport = new TcpTransport({ host: manager.address, port: manager.port });
    this.transport.on('connect', () => {
      this.logger?.info('Connected to Wazuh manager');
      this.metrics && (this.metrics.transportConnected = true);
    });
    this.transport.on('disconnect', () => {
      this.metrics && (this.metrics.transportConnected = false);
    });
    this.transport.on('message', (payload) => this.onManagerMessage(payload));
    this.transport.on('error', (err) => this.logger?.warn({ err }, 'Transport error'));
    if (manager.address) this.transport.start();
  }

  async enroll() {
    const { manager, enrollment } = this.options;
    const groups = (enrollment?.groups || ['default']).join(',');

    if (enrollment?.apiUser && enrollment?.apiPassword) {
      try {
        this.identity = await enrollViaApi({
          host: manager.address,
          apiPort: enrollment.apiPort || 55000,
          agentName: this.options.agentName,
          user: enrollment.apiUser,
          password: enrollment.apiPassword,
          insecure: enrollment.insecure === true,
        });
        this.logger?.info('Enrolled via Wazuh API');
      } catch (err) {
        this.logger?.warn({ err }, 'API enrollment failed, trying authd');
      }
    }

    if (!this.identity) {
      try {
        this.identity = await enroll({
          host: manager.address,
          port: manager.enrollmentPort || 1515,
          agentName: this.options.agentName,
          password: enrollment?.password,
          groups,
          ca: enrollment?.caCert,
        });
        this.logger?.info('Enrolled via authd (port 1515)');
      } catch (err) {
        this.logger?.error({ err }, 'All enrollment methods failed');
        throw err;
      }
    }
    await persistIdentity(this.options.dataDir, this.identity);
    this.encKey = deriveEncryptionKey(this.identity.key, this.identity.name, this.identity.id);
    this.state.data.enrollment = { status: 'enrolled', agentId: this.identity.id, name: this.identity.name };
    await this.state.save();
    return this.identity;
  }

  /** @param {object[]} events */
  async sendEvents(events) {
    if (!this.encKey) throw new Error('Not enrolled');
    for (const event of events) {
      const plaintext = serializeEvent(event);
      const counters = this.state.nextCounters();
      const payload = encryptMessage(plaintext, counters, this.encKey);
      const sent = this.transport?.send(payload);
      if (sent) {
        this.metrics?.inc('eventsSent');
        await this.state.save();
      } else {
        this.metrics?.inc('eventsFailed');
        throw new Error('Transport not connected');
      }
    }
  }

  /** @param {object[]} items */
  async syncState(items) {
    for (const item of items) {
      const plaintext = serializeStateItem(item);
      const counters = this.state.nextCounters();
      const payload = encryptMessage(plaintext, counters, this.encKey);
      this.transport?.send(payload);
    }
    this.state.data.lastSync = new Date().toISOString();
    await this.state.save();
  }

  onManagerMessage(payload) {
    if (!this.encKey) return;
    try {
      const text = decryptMessage(payload, this.encKey);
      if (text.includes('#!-')) {
        for (const handler of this.commandHandlers) handler(text);
      }
    } catch (err) {
      this.logger?.warn({ err }, 'Failed to decrypt manager message');
    }
  }

  onCommand(handler) {
    this.commandHandlers.push(handler);
  }

  async pollCommands() {
    return [];
  }

  async sendCommandResult(result) {
    const counters = this.state.nextCounters();
    this.transport?.send(encryptMessage(`#cmd-result:${JSON.stringify(result)}`, counters, this.encKey));
  }

  async fetchConfiguration() {
    return null;
  }

  async sendHealth() {
    return { status: this.transport?.connected ? 'ok' : 'disconnected' };
  }

  async close() {
    this.transport?.stop();
  }
}
