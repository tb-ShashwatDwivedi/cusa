import { loadConfig } from '../config/loader.js';
import { createLogger } from '../logging/logger.js';
import { Agent } from '../core/agent.js';

const logger = createLogger();

async function main() {
  const config = await loadConfig(process.env.CUSA_CONFIG || undefined);
  const log = createLogger({ level: config.logging?.level });
  const agent = new Agent(config, log);

  const shutdown = async (signal) => {
    log.info({ signal }, 'Shutdown signal received');
    await agent.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await agent.start();
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
