import { deriveEncryptionKey, encryptMessage, decryptMessage } from './crypto.js';
import { enroll, loadIdentity, persistIdentity } from './enrollment.js';
import { enrollViaApi } from './api-enrollment.js';
import { TcpTransport } from './transport.js';
import { serializeEvent } from './event-serializer.js';
import { runSync } from './sync-protocol.js';
import { getProtocolProfile } from '../version.js';
import { parseManagerCommand, formatCommandAck } from './commands.js';
import { eventLog } from '../../logging/event-log.js';

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
    this.syncAckHandlers = [];
    this.health = options.health;
    this.enrollShouldRun = false;
    this.enrollDelayMs = 5000;
    this.profile = getProtocolProfile(
      options.version || '4.x',
      options.enrollment,
    );
  }

  sendPlaintext(plaintext) {
    if (!this.encKey) throw new Error('Not enrolled');
    const counters = this.state.nextCounters();
    const payload = encryptMessage(plaintext, counters, this.encKey, this.identity?.id);
    const sent = this.transport?.send(payload);
    if (sent) {
      this.metrics?.inc('stateSent');
      return this.state.save();
    }
    throw new Error('Transport not connected');
  }

  onSyncAck(handler) {
    this.syncAckHandlers.push(handler);
  }

  offSyncAck(handler) {
    this.syncAckHandlers = this.syncAckHandlers.filter((h) => h !== handler);
  }

  async init() {
    const { manager } = this.options;
    this.identity = await loadIdentity(this.options.dataDir);
    if (!this.identity && manager.address) {
      this.identity = await this.enroll();
    }
    if (this.identity) {
      this.encKey = deriveEncryptionKey(this.identity.key, this.identity.name, this.identity.id);
      this.startTransport();
    } else if (manager.address) {
      this.markEnrollmentPending(manager);
      this.scheduleEnrollmentRetry();
    } else {
      this.health?.setTransport('disconnected');
    }
  }

  markEnrollmentPending(manager) {
    this.state.data.enrollment = { status: 'pending', agentId: null, name: null };
    this.state.save().catch(() => {});
    this.health?.setTransport('disconnected');
    eventLog.agent(
      `Manager unreachable; enrollment pending (${manager.address})`,
      { host: manager.address, port: manager.port },
      'warn',
    );
  }

  setupTransportHandlers() {
    const { manager } = this.options;
    this.transport.on('connect', () => {
      eventLog.agent(`Connected to manager ${manager.address}:${manager.port}`, {
        host: manager.address,
        port: manager.port,
      });
      this.logger?.info('Connected to Wazuh manager');
      this.metrics && (this.metrics.transportConnected = true);
      this.health?.setTransport('connected');
    });
    this.transport.on('disconnect', () => {
      eventLog.agent(`Disconnected from manager ${manager.address}:${manager.port}`, {
        host: manager.address,
        port: manager.port,
      }, 'warn');
      this.metrics && (this.metrics.transportConnected = false);
      this.health?.setTransport('disconnected');
    });
    this.transport.on('message', (payload) => this.onManagerMessage(payload));
    this.transport.on('error', (err) => {
      eventLog.agent(`Transport error: ${err.message}`, { err: String(err) }, 'error');
      this.logger?.warn({ err }, 'Transport error');
    });
  }

  startTransport() {
    const { manager } = this.options;
    if (!manager.address || this.transport) return;
    this.transport = new TcpTransport({ host: manager.address, port: manager.port });
    this.setupTransportHandlers();
    this.transport.start();
  }

  scheduleEnrollmentRetry() {
    if (this.enrollShouldRun) return;
    this.enrollShouldRun = true;
    this.enrollDelayMs = 5000;
    const tick = async () => {
      if (!this.enrollShouldRun || this.identity) return;
      const { manager } = this.options;
      if (!manager.address) return;
      this.identity = await this.enroll();
      if (this.identity) {
        this.encKey = deriveEncryptionKey(this.identity.key, this.identity.name, this.identity.id);
        this.startTransport();
        return;
      }
      setTimeout(tick, this.enrollDelayMs);
      this.enrollDelayMs = Math.min(this.enrollDelayMs * 2, 60000);
    };
    setTimeout(tick, this.enrollDelayMs);
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
        eventLog.agent('Enrolled via Wazuh API', { agentId: this.identity.id, name: this.identity.name });
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
          agentVersion: this.profile.enrollVersion,
        });
        eventLog.agent('Enrolled via authd (port 1515)', { agentId: this.identity.id, name: this.identity.name });
        this.logger?.info('Enrolled via authd (port 1515)');
      } catch (err) {
        this.logger?.warn({ err }, 'All enrollment methods failed');
        return null;
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
      const payload = encryptMessage(plaintext, counters, this.encKey, this.identity?.id);
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
    if (!this.encKey) throw new Error('Not enrolled');
    const result = await runSync(this, {
      module: 'syscollector',
      items,
      mode: 'delta',
      syncMode: this.profile.syncMode,
    });
    this.state.data.lastSync = new Date().toISOString();
    await this.state.save();
    return result;
  }

  onManagerMessage(payload) {
    if (!this.encKey) return;
    try {
      const text = decryptMessage(payload, this.encKey);
      for (const handler of this.syncAckHandlers) handler(text);
      if (text.includes('#!-')) {
        const parsed = parseManagerCommand(text);
        for (const handler of this.commandHandlers) handler(parsed);
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
    const ack = formatCommandAck(result);
    await this.sendPlaintext(ack);
  }

  async fetchConfiguration() {
    return null;
  }

  async sendHealth() {
    return { status: this.transport?.connected ? 'ok' : 'disconnected' };
  }

  async close() {
    this.enrollShouldRun = false;
    this.transport?.stop();
    this.transport = null;
  }
}
