import { deriveEncryptionKey, encryptMessage, decryptMessage } from './crypto.js';
import { enroll, loadIdentity, persistIdentity } from './enrollment.js';
import { enrollViaApi } from './api-enrollment.js';
import { TcpTransport } from './transport.js';
import { serializeEvent } from './event-serializer.js';
import { runSync } from './sync-protocol.js';
import { getProtocolProfile } from '../version.js';
import { parseManagerCommand, formatCommandAck, isInboundManagerControl } from './commands.js';
import { padAgentId } from './crypto.js';
import { FIXED_ENROLLMENT } from '../enrollment-defaults.js';
import { eventLog } from '../../logging/event-log.js';
import { formatKeepalive, getWindowsOsLabel, md5Hex } from './keepalive.js';
import { extractMergedFile } from './central-config.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { truncatePlaintext } from './message-limit.js';

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
    this.keepaliveTimer = null;
    this.osLabel = null;
    this.mergedMd5 = null;
    // Unified manager shared-config location (root/manager). CYB-6085.
    this.managerDir = options.managerDir || null;
    // Remoted shared-file push accumulator (#!-up file ... #!-close file).
    this.sharedFile = { active: false, name: null, md5: null, chunks: [] };
    this.managerFileHandlers = [];
    this.profile = getProtocolProfile(
      options.version || '4.x',
      options.enrollment,
    );
  }

  sendPlaintext(plaintext) {
    return this._sendPlaintext(plaintext, { countAsState: true });
  }

  /** Control plane (#!- startup / keepalive) — same crypto, not inventory/state metrics. */
  sendControl(plaintext) {
    return this._sendPlaintext(plaintext, { countAsState: false, control: true });
  }

  /** @param {string} plaintext @param {{ countAsState?: boolean, control?: boolean }} opts */
  _sendPlaintext(plaintext, opts = {}) {
    if (!this.encKey) throw new Error('Not enrolled');
    const counters = this.state.nextCounters();
    const body = opts.control ? plaintext : truncatePlaintext(plaintext);
    const payload = encryptMessage(
      body,
      counters,
      this.encKey,
      this.identity?.id,
    );
    const sent = this.transport?.send(payload);
    if (sent) {
      if (opts.countAsState) this.metrics?.inc('stateSent');
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
      this.identity.id = padAgentId(this.identity.id);
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
      this.sendHandshake().catch((err) => this.logger?.warn({ err }, 'Handshake failed'));
    });
    this.transport.on('disconnect', () => {
      this.stopKeepalive();
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

  async sendHandshake() {
    if (!this.encKey || !this.identity) return;
    try {
      this.sendControl('#!-agent startup {"version":"v4.11.2"}\n');
    } catch (err) {
      this.logger?.warn({ err }, 'Failed to send agent startup');
      return;
    }
    if (!this.osLabel) {
      try {
        this.osLabel = await getWindowsOsLabel();
      } catch {
        this.osLabel = 'Microsoft Windows [Ver: 10.0.0.0]';
      }
    }
    await this.sendKeepaliveNow();
    this.startKeepalive();
  }

  async resolveKeepaliveHashes() {
    const managerDir = this.managerDir;
    if (!managerDir) return { configMd5: undefined, mergedMd5: undefined };
    let configMd5;
    try {
      const agentConf = await readFile(join(managerDir, 'agent.conf'), 'utf8');
      configMd5 = md5Hex(agentConf);
    } catch {
      configMd5 = undefined;
    }
    // Advertise the real merged.mg hash so remoted knows whether to push shared config.
    // When absent, formatKeepalive() emits the stock "x merged.mg" line. CYB-6085.
    try {
      const merged = await readFile(join(managerDir, 'merged.mg'), 'utf8');
      this.mergedMd5 = md5Hex(merged);
    } catch {
      this.mergedMd5 = undefined;
    }
    return { configMd5, mergedMd5: this.mergedMd5 };
  }

  async sendKeepaliveNow() {
    if (!this.encKey || !this.identity) return;
    const version = (this.profile.enrollVersion || 'Wazuh v4.11.2').replace(/^Wazuh\s+/i, '');
    const agentVersion = version.startsWith('v') ? version : `v${version}`;
    let hashes = { configMd5: undefined, mergedMd5: this.mergedMd5 };
    try {
      hashes = await this.resolveKeepaliveHashes();
    } catch {
      // use cached merged md5 only
    }
    const text = formatKeepalive({
      osLabel: this.osLabel || 'Microsoft Windows [Ver: 10.0.0.0]',
      agentVersion,
      configMd5: hashes.configMd5,
      mergedMd5: hashes.mergedMd5,
    });
    if (!text.includes('\n')) {
      this.logger?.warn('Keepalive missing newline; skipping send');
      return;
    }
    try {
      this.sendControl(text);
    } catch (err) {
      this.logger?.warn({ err }, 'Failed to send keepalive');
    }
  }

  startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      void this.sendKeepaliveNow();
    }, 10000);
    this.keepaliveTimer.unref?.();
  }

  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  async enroll() {
    const { manager } = this.options;
    const enrollment = { ...FIXED_ENROLLMENT, ...this.options.enrollment, ...FIXED_ENROLLMENT };
    const groups = (enrollment.groups || ['default']).join(',');

    if (enrollment.apiUser && enrollment.apiPassword) {
      try {
        this.identity = await enrollViaApi({
          host: manager.address,
          apiPort: enrollment.apiPort || 55000,
          agentName: this.options.agentName,
          user: enrollment.apiUser,
          password: enrollment.apiPassword,
          insecure: enrollment.insecure === true,
          ca: enrollment.caCert || undefined,
          groups: (enrollment.groups || ['default']).join(','),
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
          ca: enrollment?.caCert || undefined,
          insecure: enrollment?.insecure === true,
          agentVersion: this.profile.enrollVersion,
        });
        eventLog.agent('Enrolled via authd (port 1515)', { agentId: this.identity.id, name: this.identity.name });
        this.logger?.info('Enrolled via authd (port 1515)');
      } catch (err) {
        this.logger?.warn({ err }, 'All enrollment methods failed');
        return null;
      }
    }
    this.identity.id = padAgentId(this.identity.id);
    await persistIdentity(this.options.dataDir, this.identity);
    this.encKey = deriveEncryptionKey(this.identity.key, this.identity.name, this.identity.id);
    this.state.data.enrollment = { status: 'enrolled', agentId: this.identity.id, name: this.identity.name };
    await this.state.save();
    return this.identity;
  }

  /** @param {object[]} events */
  async sendEvents(events) {
    if (!this.encKey) throw new Error('Not enrolled');
    let sentAny = false;
    for (const event of events) {
      const plaintext = truncatePlaintext(serializeEvent(event));
      const counters = this.state.nextCounters();
      const payload = encryptMessage(plaintext, counters, this.encKey, this.identity?.id);
      const sent = this.transport?.send(payload);
      if (sent) {
        this.metrics?.inc('eventsSent');
        sentAny = true;
      } else {
        this.metrics?.inc('eventsFailed');
        throw new Error('Transport not connected');
      }
    }
    if (sentAny) await this.state.save();
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
      // Remoted shared-file push (merged.mg / agent.conf). Consume the whole
      // #!-up file ... #!-close file sequence before command parsing. CYB-6085.
      if (this.sharedFile.active || /^#!-up file\b/.test(text.trim())) {
        if (this.handleSharedFilePush(text) === 'consumed') return;
      }
      if (isInboundManagerControl(text)) return;
      if (text.includes('#!-')) {
        const parsed = parseManagerCommand(text);
        for (const handler of this.commandHandlers) handler(parsed);
      }
    } catch (err) {
      this.logger?.warn({ err }, 'Failed to decrypt manager message');
    }
  }

  /**
   * Accumulate a remoted shared-file push. Returns 'consumed' when the message
   * belongs to an in-flight transfer, 'passthrough' otherwise.
   * @param {string} text
   */
  handleSharedFilePush(text) {
    const t = text.trim();
    const up = t.match(/^#!-up file\s+'?([^'\s]+)'?\s+(\S+)([\s\S]*)$/);
    if (up) {
      const initial = up[3]?.replace(/^\r?\n/, '') ?? '';
      this.sharedFile = {
        active: true,
        name: basename(up[1]),
        md5: up[2],
        chunks: initial ? [initial] : [],
      };
      return 'consumed';
    }
    if (/^#!-close file\b/.test(t)) {
      void this.finalizeSharedFile();
      return 'consumed';
    }
    if (this.sharedFile.active) {
      this.sharedFile.chunks.push(text);
      return 'consumed';
    }
    return 'passthrough';
  }

  async finalizeSharedFile() {
    const sf = this.sharedFile;
    this.sharedFile = { active: false, name: null, md5: null, chunks: [] };
    if (!sf.name || !this.managerDir) return;
    const content = sf.chunks.join('');
    try {
      await mkdir(this.managerDir, { recursive: true });
      await writeFile(join(this.managerDir, sf.name), content, 'utf8');
      if (sf.name === 'merged.mg') {
        this.mergedMd5 = md5Hex(content);
        const agentConf = extractMergedFile(content, 'agent.conf');
        if (agentConf != null) {
          await writeFile(join(this.managerDir, 'agent.conf'), agentConf, 'utf8');
        }
      }
      eventLog.agent('Received manager shared config', { file: sf.name, bytes: content.length });
      for (const h of this.managerFileHandlers) {
        try { await h(sf.name); } catch { /* handler errors isolated */ }
      }
    } catch (err) {
      this.logger?.warn({ err }, 'Failed to persist manager shared file');
    }
  }

  /** @param {(name: string) => void} handler fired after a shared file is written to disk */
  onManagerFile(handler) {
    this.managerFileHandlers.push(handler);
  }

  onCommand(handler) {
    this.commandHandlers = [handler];
  }

  async pollCommands() {
    return [];
  }

  async sendCommandResult(result) {
    const ack = formatCommandAck(result);
    this.sendControl(ack);
  }

  async fetchConfiguration() {
    const { loadManagerAgentConf } = await import('./central-config.js');
    // Use the same unified manager dir that syncManagerConfig() and keepalive hashing use.
    const loaded = this.managerDir ? await loadManagerAgentConf(this.managerDir) : null;
    return loaded?.patch || null;
  }

  async sendHealth() {
    return { status: this.transport?.connected ? 'ok' : 'disconnected' };
  }

  async close() {
    this.enrollShouldRun = false;
    this.stopKeepalive();
    this.transport?.stop();
    this.transport = null;
    this.commandHandlers = [];
    this.syncAckHandlers = [];
  }
}
