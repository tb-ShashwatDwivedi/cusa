import Fastify from 'fastify';

// GUI dev (Vite/Tauri) runs on a different origin than the local API.
const LOCAL_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost)$/;

/** @param {import('fastify').FastifyInstance} app */
export function allowLocalCors(app) {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
  const port = agent.config.api?.port || 8710;

  app.get('/api/status', async () => agent.getStatus());
  app.get('/api/health', async () => agent.health.check());
  app.get('/api/metrics', async () => agent.metrics.snapshot());
  app.get('/api/collectors', async () => {
    const out = {};
    for (const c of agent.collectors) out[c.name] = await c.health();
    return out;
  });
  app.get('/api/config', async () => ({
    effective: agent.config,
    locked: agent.config.locked || [],
  }));
  app.get('/api/queue', async () => ({
    depth: agent.queue.totalDepth(),
    events: agent.queue.events.depth(),
    state: agent.queue.state.depth(),
    commands: agent.queue.commands.depth(),
  }));
  app.get('/api/diagnostics', async () => ({
    status: agent.getStatus(),
    health: await agent.health.check(),
    node: process.version,
    platform: process.platform,
    pid: process.pid,
  }));

  await app.listen({ host, port });
  agent.logger.info({ host, port }, 'Local API listening');
  return app;
}
