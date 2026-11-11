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
import { UNSUPPORTED_WIRE_CATEGORIES } from '../inventory/wazuh-collectors.js';
import { FimWatcher } from '../fim/watcher.js';
import { fimItemToIngestEvent, registryItemToIngestEvent } from '../fim/wire-event.js';
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
import { isCollectorEnabled } from '../collectors/config-key.js';
import { controlService, queryServiceState } from '../platform/service-control.js';
import { initSecretsEncryption } from '../security/secrets.js';
import { ensureApiToken } from '../security/api-token.js';
import { clearIdentity } from '../wazuh/v4/enrollment.js';
import { shutdownFileLogging } from '../logging/logger.js';
import { startMemorySampler, memorySnapshot } from './memory.js';
import { JobGate } from './job-gate.js';
import { join } from 'node:path';

import { AGENT_VERSION } from './version.js';
import { enrichEvent } from '../pipeline/enrich.js';
import { applyEventFilters } from '../pipeline/filter.js';
import { endpointIdentity } from '../identity/endpoint-identity.js';
import { ResponseAuditLog } from '../active-response/audit-log.js';
import { runRootkitScan } from '../security/rootkit-scan.js';
import {
  loadManagerAgentConf,
  mergeManagerPatch,
  hashConfig,
  assertConfigValid,
} from '../wazuh/v4/central-config.js';
import { validateAgentConfig } from '../config/validate-config.js';
import { SourceReplayGuard } from '../pipeline/source-replay-guard.js';
import { sourceEventIdentity } from '../pipeline/source-identity.js';
import { mergeInventoryOnFailure, groupInventoryByCategory } from '../inventory/merge.js';
import { sortInventoryForWire } from '../inventory/wire-order.js';

export { AGENT_VERSION };

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
      scripts: config.activeResponse?.scripts || {},
      protectedPids: config.activeResponse?.protectedPids || [],
      onRestart: () => process.exit(0),
      onReload: async () => this.reloadConfig(),
      onRestartCollectors: async () => this.restartCollectors(),
    });
    this.responseAudit = new ResponseAuditLog(this.paths.cache);
    // ponytail: state.json mutates every poll/sync — watching it floods Wazuh with 1:agent: noise.
    const tamperPaths = [process.execPath, this.paths.secrets, this.paths.configLocal];
    this.tamper = new TamperDetector({
      paths: tamperPaths,
      trustFile: join(this.paths.cache, 'tamper-trust.json'),
      onTamper: (a) => this.handleTamper(a),
    });
    this.updater = new Updater({
      dataDir: this.paths.updates,
      currentVersion: AGENT_VERSION,
      publicKeyPem: config.updater?.publicKeyPem,
      product: config.updater?.product,
      onApply: async () => {
        this.tamper.setUpdateInProgress(false);
        eventLog.agent('Update staged; restart required to apply', {}, 'warn');
      },
    });
    this.api = null;
    this.apiToken = null;
    this.running = false;
    this.lastComplianceResults = [];
    this.heavyJobs = new JobGate();
    this.memorySampler = null;
    this.wazuhCommandHandler = null;
    this.replayGuard = new SourceReplayGuard(this.paths.cache);
    this.inventoryStatus = {};
  }

  async start() {
    const cfgCheck = validateAgentConfig(this.config);
    if (!cfgCheck.valid) {
      this.logger.warn({ errors: cfgCheck.errors }, 'Config validation warnings');
    }
    await initSecretsEncryption(this.paths.cache);
    await this.responseAudit.init();
    this.apiToken = await ensureApiToken(this.paths.cache);
    await this.state.load();
    await this.replayGuard.init();
    await this.queue.init();
    await this.wazuh.init();
    this.registerWazuhHandlers();

    this.collectors = createCollectors(this.config, this.state);
    for (const c of this.collectors) {
      c.setEventHandler((partial) => this.ingestEvent(partial));
      this.health.registerCollector(c.name, () => c.health());
    }

    // if (this.config.fim?.paths?.length) {
    //   this.fim = new FimWatcher(this.config.fim, this.state);
    //   this.fim.setHandler((item) => this.queue.enqueueState(item));
    //   await this.fim.start();
    // }

    if (this.config.fim?.paths?.length) {
      this.fim = new FimWatcher(
        { ...this.config.fim, agentDataDir: this.config.agent?.dataDir || this.paths?.data },
        this.state,
        this.logger,
      );
      this.fim.setHandler((item) => { void this.ingestEvent(fimItemToIngestEvent(item)); });
    }

    if (this.config.registry?.keys?.length && process.platform === 'win32') {
      this.registry = new RegistryWatcher(this.config.registry, this.state);
      this.registry.setHandler((item) => { void this.ingestEvent(registryItemToIngestEvent(item)); });
    }

    await this.compliance.load();
    this.queue.startFlusher(this.wazuh, this.metrics);
    this.health.setQueue('ok', this.queue.totalDepth());
    await this.tamper.init();

    this.api = await createApiServer(this);
    this.running = true;

    void this.startCollectorsStaggered();
    void this.startDeferredWatchers();

    this.scheduler.schedule('inventory', this.config.inventory?.intervalMs || 3600000, () =>
      this.heavyJobs.run(() => this.syncInventory()),
    );
    this.scheduler.schedule('compliance', this.config.compliance?.intervalMs || 86400000, () =>
      this.heavyJobs.run(() => this.runCompliance()),
    );
    this.scheduler.schedule('tamper', 60000, () => this.tamper.check());
    this.scheduler.schedule('manager-config', 300000, () => this.syncManagerConfig());
    this.scheduler.schedule('rootkit-scan', 86400000, () =>
      this.heavyJobs.run(() => this.runRootkitScan()),
    );
    void this.syncManagerConfig();
    void this.heavyJobs.run(() => this.syncInventory());

    this.memorySampler = startMemorySampler(this.logger, {
      warnRssMb: this.config.diagnostics?.memoryWarnRssMb ?? 200,
    });
    const mgr = this.config.wazuh.manager?.address;
    eventLog.agent('Agent running', {
      manager: mgr,
      port: this.config.wazuh.manager?.port,
      api: `http://${this.config.api?.host || '127.0.0.1'}:${this.config.api?.port || 8710}`,
    });
    this.logger.info('CUSA agent running');
  }

  registerWazuhHandlers() {
    this.wazuhCommandHandler = async (parsed) => {
      if (parsed.taskId && this.state.hasTaskId(parsed.taskId)) return;
      await this.queue.enqueueCommand({ parsed, receivedAt: Date.now() });
      this.metrics.inc('commandsReceived');
      await this.processCommands();
    };
    this.wazuh.onCommand?.(this.wazuhCommandHandler);
  }

  async startCollectorsStaggered() {
    const staggerMs = this.config.collectors?.staggerMs ?? 3000;
    for (const c of this.collectors) {
      if (!isCollectorEnabled(this.config.collectors, c.name)) continue;
      await c.start();
      if (staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs));
    }
  }

  async startDeferredWatchers() {
    try {
      if (this.fim) await this.fim.start();
      if (this.registry) await this.registry.start();
    } catch (err) {
      this.logger.warn({ err }, 'Deferred watcher start failed');
    }
  }

  async ingestEvent(partial) {
    try {
      const backpressureDepth = this.config.queue?.backpressureDepth ?? 350;
      const maxEventDepth = this.config.queue?.maxEventDepth ?? 2500;
      const eventDepth = this.queue.events.depth();
      if (
        (!this.metrics.transportConnected && eventDepth >= backpressureDepth)
        || (this.metrics.transportConnected && eventDepth >= maxEventDepth)
      ) {
        this.metrics.inc('eventsDroppedBackpressure');
        return;
      }
      const agentId = this.state.data.enrollment?.agentId || this.wazuh.adapter?.identity?.id;
      let event = normalizeEvent(partial, { agentId });
      event = enrichEvent(event, agentId);
      const { allow } = applyEventFilters(event, this.config.filters || {});
      if (!allow) {
        this.metrics.inc('eventsFiltered');
        return;
      }
      event = validateEvent(event);
      const identity = sourceEventIdentity(event);
      if (identity && this.replayGuard.isReplay(identity)) {
        this.metrics.inc('eventsSourceReplaySuppressed');
        return;
      }
      this.metrics.inc('eventsCollected');
      this.metrics.inc('eventsAccepted');
      this.metrics.lastEventAt = new Date().toISOString();
      eventLog.collected(event);
      await this.queue.enqueueEvent(event);
      if (identity) await this.replayGuard.markSeen(identity);
    } catch (err) {
      this.metrics.inc('eventsInvalid');
      this.logger.warn({ err }, 'Event ingestion failed');
    }
  }

  async resetInventorySync() {
    await this.queue.state.clear();
    this.state.data.lastInventory = [];
    this.state.data.lastInventoryByCategory = {};
    this.state.data.inventoryInitialSyncDone = false;
    await this.state.save();
    await this.syncInventory();
  }

  async syncInventory() {
    const scanner = new InventoryScanner({
      maxItemsPerCategory: this.config.inventory?.maxItemsPerCategory,
    });
    const scanned = await scanner.scanSystem();
    this.inventoryStatus = scanner.lastCategoryStatus || {};
    const previous = this.state.data.lastInventory || [];
    const merged = mergeInventoryOnFailure(scanned, previous, this.inventoryStatus);
    let delta = computeDelta(previous, merged);
    const forceInitial = !this.state.data.inventoryInitialSyncDone;
    if (forceInitial && !delta.length && merged.length) {
      delta = merged.map((i) => ({ ...i, operation: 'create' }));
    }
    delta = sortInventoryForWire(
      delta.filter((i) => !UNSUPPORTED_WIRE_CATEGORIES.has(i.category)),
    );
    for (const item of delta) {
      await this.queue.enqueueState(item);
      this.metrics.inc('inventoryItemsEnqueued');
    }
    if (delta.length || forceInitial) {
      this.state.data.lastInventory = merged;
      this.state.data.lastInventoryByCategory = groupInventoryByCategory(merged);
      if (forceInitial) this.state.data.inventoryInitialSyncDone = true;
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
        data: {
          ...r,
          agent_id: this.wazuh.adapter?.identity?.id || this.state.data.enrollment?.agentId,
        },
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
    const started = Date.now();
    try {
      const parsed = item.payload.parsed || this.parseCommand(item.payload.raw);
      if (parsed.taskId) this.state.rememberTaskId(parsed.taskId);
      if (parsed.action === 'upgrade_agent' && parsed.manifest) {
        this.tamper.setUpdateInProgress(true);
        await this.updater.applyUpdate(parsed.manifest);
      }
      const result = await this.executor.execute(parsed);
      const agentId = this.wazuh.adapter?.identity?.id || this.state.data.enrollment?.agentId;
      await this.responseAudit.write({
        task_id: parsed.taskId,
        agent_id: agentId,
        action: parsed.action,
        request_timestamp: item.payload.receivedAt,
        execution_start: new Date(started).toISOString(),
        execution_end: new Date().toISOString(),
        status: result.status || (result.success ? 'completed' : 'failed'),
        sanitized_parameters: { pid: parsed.pid, ip: parsed.ip, scriptId: parsed.scriptId },
        result,
      });
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
    eventLog.agent('Tamper detection', alert, 'warn');
    this.logger.warn({ alert }, 'Tamper detection');
    await this.ingestEvent({
      source: { platform: process.platform === 'win32' ? 'windows' : 'linux', collector: 'tamper' },
      event: { category: 'threat', type: 'tamper', action: alert.type, severity: 'high' },
      raw: JSON.stringify(alert),
    });
  }

  async restartCollectors() {
    for (const c of this.collectors) await c.stop();
    for (const c of this.collectors) {
      if (isCollectorEnabled(this.config.collectors, c.name)) await c.start();
    }
    eventLog.agent('Collectors restarted');
  }

  async syncManagerConfig() {
    const loaded = await loadManagerAgentConf(this.config.agent.dataDir);
    if (!loaded?.patch) {
      this.health.setComponent?.('configuration', 'NOT_CONFIGURED');
      return;
    }
    const nextHash = hashConfig(loaded.patch);
    if (this.state.data.managerConfigHash === nextHash) return;
    try {
      const merged = mergeManagerPatch(this.config, loaded.patch, this.config.locked || []);
      assertConfigValid(merged);
      this.state.data.lastKnownGoodConfig = this.config;
      this.state.data.managerConfigHash = nextHash;
      this.state.data.configVersion = (this.state.data.configVersion || 0) + 1;
      await saveLocalConfig(
        applyPatch(await loadLocalOverlay(this.paths.configLocal), loaded.patch, this.config.locked || []),
        this.config.agent.dataDir,
      );
      await this.reloadConfig();
      this.health.setComponent?.('configuration', 'HEALTHY');
    } catch (err) {
      this.logger.warn({ err }, 'Manager config rejected');
      this.health.setComponent?.('configuration', 'DEGRADED');
      eventLog.agent('Manager configuration rejected', { error: err.message }, 'warn');
    }
  }

  async runRootkitScan() {
    const scan = await runRootkitScan();
    this.state.data.lastRootkitScan = { at: new Date().toISOString(), ...scan };
    await this.state.save();
    if (scan.status === 'FAIL' || scan.status === 'WARN') {
      await this.ingestEvent({
        source: { platform: process.platform === 'win32' ? 'windows' : 'linux', collector: 'rootkit-scan' },
        event: { category: 'threat', type: 'anomaly', action: scan.status, severity: scan.status === 'FAIL' ? 'high' : 'medium' },
        raw: JSON.stringify(scan.findings.slice(0, 20)),
      });
    }
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
    const prevManager = this.config.wazuh?.manager;
    const config = await loadConfig(process.env.CUSA_CONFIG || undefined);
    const nextManager = config.wazuh?.manager;
    const managerChanged =
      prevManager?.address !== nextManager?.address
      || prevManager?.port !== nextManager?.port
      || prevManager?.enrollmentPort !== nextManager?.enrollmentPort;
    if (managerChanged) {
      await clearIdentity(this.paths.secrets);
      if (this.wazuh.adapter) this.wazuh.adapter.identity = null;
      this.state.data.enrollment = { status: 'pending', agentId: null, name: null };
      await this.state.save();
      eventLog.agent('Manager changed; clearing enrollment for re-enroll', {
        from: prevManager?.address,
        to: nextManager?.address,
      }, 'warn');
    }
    this.config = config;
    for (const c of this.collectors) await c.stop();
    this.fim?.stop();
    this.fim = null;
    this.registry?.stop();
    this.registry = null;
    this.health.clearCollectors();
    this.collectors = createCollectors(this.config, this.state);
    for (const c of this.collectors) {
      c.setEventHandler((partial) => this.ingestEvent(partial));
      this.health.registerCollector(c.name, () => c.health());
      if (isCollectorEnabled(this.config.collectors, c.name)) await c.start();
    }
    if (this.config.fim?.paths?.length) {
      this.fim = new FimWatcher(
        { ...this.config.fim, agentDataDir: this.config.agent?.dataDir || this.paths?.data },
        this.state,
      );
      this.fim.setHandler((item) => { void this.ingestEvent(fimItemToIngestEvent(item)); });
      await this.fim.start();
    }
    if (this.config.registry?.keys?.length && process.platform === 'win32') {
      this.registry = new RegistryWatcher(this.config.registry, this.state);
      this.registry.setHandler((item) => { void this.ingestEvent(registryItemToIngestEvent(item)); });
      await this.registry.start();
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

  /** @param {'start'|'stop'|'restart'} action */
  async controlService(action) {
    eventLog.agent(`Service control requested: ${action}`, {}, 'warn');
    const result = await controlService(action, {
      onDevStop: async () => {
        await this.stop();
        shutdownFileLogging();
        setTimeout(() => process.exit(0), 250);
      },
    });
    return result;
  }

  async getServiceState() {
    return queryServiceState();
  }

  getStatus() {
    const identity = this.wazuh.adapter?.identity;
    const enrollmentCredentials = {
      authd: true,
      api: true,
    };
    return {
      agentId: identity?.id || this.state.data.enrollment?.agentId,
      hostname: this.config.agent.name,
      version: AGENT_VERSION,
      enrollmentCredentials,
      enrollmentConfigured: enrollmentCredentials.authd || enrollmentCredentials.api,
      enrollment: identity
        ? 'enrolled'
        : this.state.data.enrollment?.status === 'pending'
          ? 'pending'
          : this.state.data.enrollment?.status || 'pending',
      serviceRunning: this.running,
      manager: this.config.wazuh.manager?.address,
      deploy: this.config.deploy,
      localApiToken: this.apiToken,
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
    this.memorySampler?.stop();
    this.memorySampler = null;
    this.scheduler.stopAll();
    for (const c of this.collectors) await c.stop();
    this.fim?.stop();
    this.registry?.stop();
    await this.queue.drain(this.wazuh, 15000);
    await this.queue.stop();
    await this.wazuh.close();
    await this.api?.close();
    await this.state.save();
    eventLog.agent('Agent stopped gracefully');
    this.logger.info('CUSA agent stopped');
  }
}
