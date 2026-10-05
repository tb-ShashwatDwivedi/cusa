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
import { FimWatcher } from '../fim/watcher.js';
import { ComplianceEngine } from '../compliance/engine.js';
import { ActiveResponseExecutor } from '../active-response/executor.js';
import { TamperDetector } from '../security/tamper.js';
import { createApiServer } from '../api/server.js';

export class Agent {
  /** @param {object} config @param {import('pino').Logger} logger */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.metrics = new Metrics();
    this.health = new HealthMonitor(this.metrics);
    this.state = new StateStore(config.agent.dataDir);
    this.queue = new QueueManager(config.agent.dataDir, config.queue);
    this.wazuh = new WazuhClient({
      version: config.wazuh.version,
      manager: config.wazuh.manager,
      enrollment: config.wazuh.enrollment,
      dataDir: config.agent.dataDir,
      agentName: config.agent.name,
      state: this.state,
      metrics: this.metrics,
      logger,
    });
    this.collectors = [];
    this.scheduler = new Scheduler();
    this.fim = null;
    this.compliance = new ComplianceEngine(config.compliance || {});
    this.executor = new ActiveResponseExecutor({
      onRestart: () => process.exit(0),
      onReload: async () => this.reloadConfig(),
    });
    this.tamper = new TamperDetector({
      paths: [process.execPath],
      onTamper: (a) => this.handleTamper(a),
    });
    this.api = null;
    this.running = false;
  }

  async start() {
    await this.state.load();
    await this.queue.init();
    await this.wazuh.init();

    this.wazuh.adapter?.onCommand?.(async (msg) => {
      await this.queue.enqueueCommand({ raw: msg, receivedAt: Date.now() });
      this.metrics.inc('commandsReceived');
      await this.processCommands();
    });

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

    await this.compliance.load();
    this.queue.startFlusher(this.wazuh, this.metrics);
    await this.tamper.init();

    this.scheduler.schedule('inventory', (this.config.inventory?.intervalMs || 3600000), () => this.syncInventory());
    this.scheduler.schedule('compliance', (this.config.compliance?.intervalMs || 86400000), () => this.runCompliance());
    this.scheduler.schedule('tamper', 60000, () => this.tamper.check());

    this.api = await createApiServer(this);
    this.running = true;
    this.logger.info('CUSA agent running');
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
      await this.queue.enqueueEvent(event);
    } catch (err) {
      this.logger.warn({ err }, 'Event ingestion failed');
    }
  }

  async syncInventory() {
    const scanner = new InventoryScanner();
    const items = await scanner.scanSystem();
    await this.wazuh.syncState(items);
    this.state.data.lastSync = new Date().toISOString();
    await this.state.save();
  }

  async runCompliance() {
    const results = await this.compliance.runChecks();
    for (const r of results) {
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
      const parsed = this.parseCommand(item.payload.raw);
      const result = await this.executor.execute(parsed);
      await this.wazuh.sendCommandResult({ ...result, taskId: parsed.taskId });
      await this.queue.commands.ack(item.id);
      this.metrics.inc('commandsExecuted');
    } catch (err) {
      this.logger.warn({ err }, 'Command execution failed');
    }
  }

  parseCommand(raw) {
    try {
      const json = JSON.parse(raw);
      return json;
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

  async reloadConfig() {
    this.logger.info('Config reload requested');
  }

  getStatus() {
    const identity = this.wazuh.adapter?.identity;
    return {
      agentId: identity?.id || this.state.data.enrollment?.agentId,
      hostname: this.config.agent.name,
      version: '0.1.0',
      enrollment: identity ? 'enrolled' : this.state.data.enrollment?.status || 'pending',
      manager: this.config.wazuh.manager?.address,
      transportConnected: this.metrics.transportConnected,
      configVersion: this.state.data.configVersion,
      metrics: this.metrics.snapshot(),
      queue: { depth: this.queue.totalDepth() },
    };
  }

  async stop() {
    this.running = false;
    this.scheduler.stopAll();
    this.queue.stop();
    for (const c of this.collectors) await c.stop();
    this.fim?.stop();
    await this.wazuh.close();
    await this.api?.close();
    await this.state.save();
    this.logger.info('CUSA agent stopped');
  }
}
