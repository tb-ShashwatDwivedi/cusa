import Fastify from 'fastify';
import { eventLog } from '../logging/event-log.js';
import { hasValidToken } from '../security/api-token.js';
import { redactEnrollment } from '../wazuh/enrollment-defaults.js';

// GUI dev (Vite/Tauri) runs on a different origin than the local API.
// Tauri 2 production uses http(s)://tauri.localhost (and *.localhost on Windows).
const LOCAL_ORIGIN =
  /^(https?:\/\/([\w-]+\.)*(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost)$/;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/** @param {import('fastify').FastifyRequest} req */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress;
  if (!addr) return true; // in-process (tests, IPC)
  return LOOPBACK.test(addr);
}

/** @param {import('fastify').FastifyInstance} app */
export function allowLocalCors(app) {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cusa-Token');
      reply.header('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });
}

/** @param {import('../core/agent.js').Agent} agent */
export async function createApiServer(agent) {
  const app = Fastify({ logger: false });
  allowLocalCors(app);
  const host = agent.config.api?.host || '127.0.0.1';
  const port = agent.config.api?.port ?? 8710;

  app.addHook('onRequest', async (req, reply) => {
    if (!isLoopback(req)) {
      return reply.code(403).send({ error: 'Local API is localhost-only' });
    }
  });

  app.get('/api/status', async () => agent.getStatus());
  app.get('/api/deploy', async () => ({
    deploy: agent.config.deploy,
    manager: agent.config.wazuh?.manager,
    paths: {
      dataDir: agent.config.agent?.dataDir,
      logs: agent.paths?.logs,
    },
  }));
  app.get('/api/health', async () => agent.health.check());
  app.get('/api/metrics', async () => agent.metrics.snapshot());
  app.get('/api/collectors', async () => {
    const out = {};
    for (const c of agent.collectors) out[c.name] = await c.health();
    return out;
  });
  app.get('/api/config', async () => ({
    effective: {
      ...agent.config,
      wazuh: {
        ...agent.config.wazuh,
        enrollment: redactEnrollment(agent.config.wazuh?.enrollment),
      },
    },
    locked: agent.config.locked || [],
  }));
  function requireToken(req, reply) {
    if (!agent.apiToken || hasValidToken(req, agent.apiToken)) return true;
    reply.code(401).send({ error: 'Invalid or missing API token' });
    return false;
  }

  app.patch('/api/config', async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const patch = req.body?.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return reply.code(400).send({ error: 'body.patch object required' });
    }
    try {
      return await agent.patchConfig(patch);
    } catch (err) {
      const locked = err.message?.startsWith('Setting is locked');
      return reply.code(locked ? 403 : 400).send({ error: err.message });
    }
  });
  app.get('/api/queue', async () => ({
    depth: agent.queue.totalDepth(),
    events: agent.queue.events.depth(),
    state: agent.queue.state.depth(),
    commands: agent.queue.commands.depth(),
  }));
  app.get('/api/logs', async (req) => {
    const { category, limit, since, search } = req.query;
    return {
      logs: eventLog.query({
        category: category || undefined,
        limit: limit ? Number(limit) : 200,
        since: since || undefined,
        search: search || undefined,
      }),
    };
  });
  app.get('/api/logs/:id', async (req, reply) => {
    const entry = eventLog.get(req.params.id);
    if (!entry) return reply.code(404).send({ error: 'not found' });
    return entry;
  });
  app.get('/api/fim', async () => ({
    paths: agent.config.fim?.paths || [],
    baseline: agent.state.data.fimBaseline || {},
    count: Object.keys(agent.state.data.fimBaseline || {}).length,
  }));
  app.get('/api/compliance', async () => ({
    policyPath: agent.config.compliance?.policyPath,
    lastRun: agent.state.data.lastCompliance || null,
    results: agent.lastComplianceResults || agent.state.data.lastCompliance?.results || [],
  }));
  app.get('/api/diagnostics', async () => ({
    status: agent.getStatus(),
    health: await agent.health.check(),
    node: process.version,
    platform: process.platform,
    pid: process.pid,
  }));

  app.get('/api/service', async () => ({
    ...(await agent.getServiceState()),
    processRunning: agent.running,
  }));

  app.post('/api/service/:action', async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const action = req.params.action;
    if (!['start', 'stop', 'restart'].includes(action)) {
      return reply.code(400).send({ error: 'action must be start, stop, or restart' });
    }
    try {
      return await agent.controlService(action);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/decommission/purge', async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const body = req.body || {};
    if (body.confirm !== 'DECOMMISSION') {
      return reply.code(400).send({
        error: 'Confirmation required: send { "confirm": "DECOMMISSION" }',
      });
    }
    try {
      const result = await agent.decommission({ includeLogs: body.includeLogs === true });
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  await app.listen({ host, port });
  agent.logger.info({ host, port }, 'Local API listening');
  return app;
}
