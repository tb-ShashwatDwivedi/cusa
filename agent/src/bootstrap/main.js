import { loadConfig } from '../config/loader.js';
import { createLogger, initFileLogging, shutdownFileLogging } from '../logging/logger.js';
import { eventLog } from '../logging/event-log.js';
import { Agent } from '../core/agent.js';

async function main() {
  const config = await loadConfig(process.env.CUSA_CONFIG || undefined);
  if (config._paths?.logs) {
    await initFileLogging(config._paths.logs);
  }
  const log = createLogger({ level: config.logging?.level });
  const agent = new Agent(config, log);

  const shutdown = async (signal) => {
    eventLog.agent(`Shutdown signal received (${signal})`, { signal }, 'warn');
    log.info({ signal }, 'Shutdown signal received');
    await agent.stop();
    shutdownFileLogging();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  eventLog.agent('Agent starting', {
    hostname: config.agent?.name,
    manager: config.wazuh?.manager?.address,
    dataDir: config.agent?.dataDir,
    deploySource: config.deploy?.source,
  });
  await agent.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
