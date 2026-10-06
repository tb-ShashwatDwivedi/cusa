import { WazuhClient } from '../wazuh/client.js';
import { StateStore } from '../state/store.js';
import { QueueManager } from '../queue/queue-manager.js';
import { Metrics } from './metrics.js';
import { HealthMonitor } from './health.js';
import { Scheduler } from './scheduler.js';
import { createCollectors } from '../collectors/registry.js';
import { normalizeEvent } from '../pipeline/normalize.js';
import { validateEvent } from '../pipeline/validator.js';
import { InventoryScanner } from '../inventory/scanner.js';
import { computeDelta } from '../inventory/delta.js';
import { FimWatcher } from '../fim/watcher.js';
import { RegistryWatcher } from '../registry/watcher.js';
import { ComplianceEngine } from '../compliance/engine.js';
import { ActiveResponseExecutor } from '../active-response/executor.js';
import { TamperDetector } from '../security/tamper.js';
import { Updater } from '../updater/updater.js';
import { createApiServer } from '../api/server.js';
import { eventLog } from '../logging/event-log.js';
import {
  loadConfig,
  loadLocalOverlay,
  saveLocalConfig,
  applyPatch,
  flattenPatch,
  getPaths,
} from '../config/loader.js';
import { purgeAgentData } from '../platform/decommission.js';

export const AGENT_VERSION = '1.0.0';

export class Agent {
  /** @param {object} config @param {import('pino').Logger} logger */
  constructor(config, logger) {
    this.config = config;
    this.paths = config._paths || getPaths(config.agent.dataDir);
    this.logger = logger;
    this.metrics = new Metrics();
    this.health = new HealthMonitor(this.metrics);
    this.state = new StateStore(this.paths.state);
    this.queue = new QueueManager(this.paths.queue, config.queue);
    this.wazuh = new WazuhClient({
      version: config.wazuh.version,
      manager: config.wazuh.manager,
      enrollment: config.wazuh.enrollment,
      dataDir: this.paths.secrets,
      agentName: config.agent.name,
      state: this.state,
      metrics: this.metrics,
      health: this.health,
      logger,
    });
    this.collectors = [];
    this.scheduler = new Scheduler();
    this.fim = null;
    this.registry = null;
    this.compliance = new ComplianceEngine(config.compliance || {});
    this.executor = new ActiveResponseExecutor({
      onRestart: () => process.exit(0),
      onReload: async () => this.reloadConfig(),
    });
    const tamperPaths = [process.execPath, this.paths.state, this.paths.secrets];
    this.tamper = new TamperDetector({
      paths: tamperPaths,
      onTamper: (a) => this.handleTamper(a),
    });
    this.updater = new Updater({
      dataDir: this.paths.updates,
      currentVersion: AGENT_VERSION,
      onApply: async () => {
        this.tamper.setUpdateInProgress(false);
        eventLog.agent('Update staged; restart required to apply', {}, 'warn');
      },
    });
    this.api = null;
    this.running = false;
    this.lastComplianceResults = [];
  }

  async start() {
    await this.state.load();
    await this.queue.init();
    await this.wazuh.init();
    this.registerWazuhHandlers();

    this.collectors = createCollectors(this.config, this.state);
    for (const c of this.collectors) {
      c.setEventHandler((partial) => this.ingestEvent(partial));
      this.health.registerCollector(c.name, () => c.health());
      if (this.config.collectors?.[c.name]?.enabled !== false) await c.start();
    }

    if (this.config.fim?.paths?.length) {
      this.fim = new FimWatcher(this.config.fim, this.state);
      this.fim.setHandler((item) => this.queue.enqueueState(item));
      await this.fim.start();
    }

    if (this.config.registry?.keys?.length && process.platform === 'win32') {
      this.registry = new RegistryWatcher(this.config.registry, this.state);
      this.registry.setHandler((item) => this.queue.enqueueState(item));
      await this.registry.start();
    }

    await this.compliance.load();
    this.queue.startFlusher(this.wazuh, this.metrics);
    this.health.setQueue('ok', this.queue.totalDepth());
    await this.tamper.init();

    this.scheduler.schedule('inventory', this.config.inventory?.intervalMs || 3600000, () => this.syncInventory());
    this.scheduler.schedule('compliance', this.config.compliance?.intervalMs || 86400000, () => this.runCompliance());
    this.scheduler.schedule('tamper', 60000, () => this.tamper.check());

    this.api = await createApiServer(this);
    this.running = true;
    const mgr = this.config.wazuh.manager?.address;
    eventLog.agent('Agent running', {
      manager: mgr,
      port: this.config.wazuh.manager?.port,
      api: `http://${this.config.api?.host || '127.0.0.1'}:${this.config.api?.port || 8710}`,
    });
    this.logger.info('CUSA agent running');
  }

  registerWazuhHandlers() {
    this.wazuh.onCommand?.(async (parsed) => {
      if (parsed.taskId && this.state.hasTaskId(parsed.taskId)) return;
      await this.queue.enqueueCommand({ parsed, receivedAt: Date.now() });
      this.metrics.inc('commandsReceived');
      await this.processCommands();
    });
  }

  async ingestEvent(partial) {
    try {
      const event = validateEvent(
        normalizeEvent(partial, {
          agentId: this.state.data.enrollment?.agentId || this.wazuh.adapter?.identity?.id,
        }),
      );
      this.metrics.inc('eventsCollected');
      this.metrics.lastEventAt = new Date().toISOString();
      eventLog.collected(event);
      await this.queue.enqueueEvent(event);
    } catch (err) {
      this.logger.warn({ err }, 'Event ingestion failed');
    }
  }

  async syncInventory() {
    const scanner = new InventoryScanner();
    const items = await scanner.scanSystem();
    const delta = computeDelta(this.state.data.lastInventory || [], items);
    this.state.data.lastInventory = items;
    for (const item of delta) {
      await this.queue.enqueueState(item);
    }
    this.state.data.lastSync = new Date().toISOString();
    await this.state.save();
  }

  async runCompliance() {
    const results = await this.compliance.runChecks();
    this.lastComplianceResults = results;
    this.state.data.lastCompliance = { at: new Date().toISOString(), results };
    await this.state.save();
    for (const r of results) {
      await this.queue.enqueueState({
        id: `sca-${r.checkId}`,
        index: 'wazuh-states-sca',
        operation: 'update',
        timestamp: r.timestamp,
        data: r,
      });
      await this.ingestEvent({
        source: { platform: process.platform === 'win32' ? 'windows' : 'linux', collector: 'compliance' },
        event: { category: 'configuration', type: 'check', action: r.status, severity: r.severity },
        raw: JSON.stringify(r),
      });
    }
  }

  async processCommands() {
    const item = await this.queue.commands.dequeue();
    if (!item) return;
    try {
      const parsed = item.payload.parsed || this.parseCommand(item.payload.raw);
      if (parsed.taskId) this.state.rememberTaskId(parsed.taskId);
      if (parsed.action === 'upgrade_agent' && parsed.manifest) {
        this.tamper.setUpdateInProgress(true);
        await this.updater.applyUpdate(parsed.manifest);
      }
      const result = await this.executor.execute(parsed);
      await this.queue.enqueueCommandResult({ ...result, counter: parsed.counter, taskId: parsed.taskId });
      await this.queue.commands.ack(item.id);
      this.metrics.inc('commandsExecuted');
    } catch (err) {
      this.logger.warn({ err }, 'Command execution failed');
      await this.queue.commands.requeue(item.id);
    }
  }

  parseCommand(raw) {
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      if (raw.includes('restart')) return { action: 'restart_agent' };
      if (raw.includes('reload')) return { action: 'reload_config' };
      return { action: 'unknown', raw };
    }
  }

  async handleTamper(alert) {
    await this.ingestEvent({
      source: { platform: process.platform === 'win32' ? 'windows' : 'linux', collector: 'agent' },
      event: { category: 'intrusion_detection', type: 'tamper', severity: 'critical' },
      raw: JSON.stringify(alert),
    });
  }

  /** @param {object} patch nested partial config update */
  async patchConfig(patch) {
    const overlay = await loadLocalOverlay(this.paths.configLocal);
    const merged = applyPatch(overlay, patch, this.config.locked || []);
    await saveLocalConfig(merged, this.config.agent.dataDir);
    await this.reloadConfig();
    eventLog.agent('Configuration updated via GUI', { keys: Object.keys(flattenPatch(patch)) });
    return { effective: this.config, locked: this.config.locked || [] };
  }

  async reloadConfig() {
    const config = await loadConfig(process.env.CUSA_CONFIG || undefined);
    this.config = config;
    for (const c of this.collectors) await c.stop();
    this.collectors = createCollectors(this.config, this.state);
    for (const c of this.collectors) {
      c.setEventHandler((partial) => this.ingestEvent(partial));
      this.health.registerCollector(c.name, () => c.health());
      if (this.config.collectors?.[c.name]?.enabled !== false) await c.start();
    }
    await this.compliance.load();
    this.wazuh.options.manager = this.config.wazuh.manager;
    this.wazuh.options.enrollment = this.config.wazuh.enrollment;
    await this.wazuh.close();
    await this.wazuh.init();
    this.registerWazuhHandlers();
    eventLog.agent('Configuration reloaded');
    this.logger.info('Config reload complete');
  }

  getStatus() {
    const identity = this.wazuh.adapter?.identity;
    return {
      agentId: identity?.id || this.state.data.enrollment?.agentId,
      hostname: this.config.agent.name,
      version: AGENT_VERSION,
      enrollment: identity
        ? 'enrolled'
        : this.state.data.enrollment?.status === 'pending'
          ? 'pending'
          : this.state.data.enrollment?.status || 'pending',
      manager: this.config.wazuh.manager?.address,
      deploy: this.config.deploy,
      dataDir: this.config.agent.dataDir,
      logDir: this.paths.logs,
      transportConnected: this.metrics.transportConnected,
      configVersion: this.state.data.configVersion,
      lastSync: this.state.data.lastSync,
      metrics: this.metrics.snapshot(),
      queue: { depth: this.queue.totalDepth() },
    };
  }

  /** @param {{ includeLogs?: boolean }} [opts] */
  async decommission(opts = {}) {
    eventLog.agent('Decommission purge started', {}, 'warn');
    await this.stop();
    const result = await purgeAgentData(this.paths, opts);
    eventLog.agent('Decommission purge complete', result, 'warn');
    return result;
  }

  async stop() {
    this.running = false;
    this.scheduler.stopAll();
    this.queue.stop();
    for (const c of this.collectors) await c.stop();
    this.fim?.stop();
    this.registry?.stop();
    await this.wazuh.close();
    await this.api?.close();
    await this.state.save();
    eventLog.agent('Agent stopped gracefully');
    this.logger.info('CUSA agent stopped');
  }
}
