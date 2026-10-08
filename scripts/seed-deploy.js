#!/usr/bin/env node
/**
 * Seed config/deploy.json for centralized push testing or post-MSI simulation.
 *
 * Usage:
 *   node scripts/seed-deploy.js --address 192.168.0.185 --port 1514 --enrollment-port 1515
 *   node scripts/seed-deploy.js --data-dir C:\ProgramData\CUSA --address siem.example.com
 */
import { writeDeployOverlay } from '../agent/src/platform/deploy.js';
import { resolvePaths, PROGRAM_DATA_WIN } from '../agent/src/platform/paths.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const dataDir = arg('--data-dir', process.env.CUSA_DATA_DIR || PROGRAM_DATA_WIN);
const address = arg('--address', process.env.MANAGER_ADDRESS);
if (!address) {
  console.error('Required: --address <manager-host>');
  process.exit(1);
}

const paths = resolvePaths(dataDir);
await writeDeployOverlay(paths.deploy, {
  source: arg('--source', 'msi'),
  wazuh: {
    manager: {
      address,
      port: Number(arg('--port', '1514')),
      enrollmentPort: Number(arg('--enrollment-port', '1515')),
    },
    version: arg('--wazuh-version', '4.11'),
  },
});

console.log(`Deploy overlay written: ${paths.deploy}`);
