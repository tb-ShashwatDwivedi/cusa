#!/usr/bin/env node
/**
 * Validates build artifacts (pre-MSI). Post-install checks require elevated shell on a test VM.
 */
import { accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDir, distDir, paths, version } from './lib/paths.js';

const errors = [];

function check(path, label, min = 1) {
  try {
    accessSync(path);
    if (statSync(path).size < min) errors.push(`${label}: too small`);
    else console.log(`OK  ${label}`);
  } catch {
    errors.push(`${label}: missing (${path})`);
  }
}

console.log('=== Validate release artifacts ===\n');

check(join(paths.agent, 'cusa-agent.exe'), 'cusa-agent.exe', 5_000_000);
check(join(paths.agent, 'cusa-service-host.exe'), 'cusa-service-host.exe', 100_000);
check(join(paths.agent, 'config', 'default.json'), 'config/default.json', 100);
const includeGui = existsSync(join(buildDir, 'include-gui.txt'))
  ? readFileSync(join(buildDir, 'include-gui.txt'), 'utf8').trim() === '1'
  : existsSync(join(paths.gui, 'CUSA.exe'));
if (includeGui) {
  check(join(paths.gui, 'CUSA.exe'), 'CUSA.exe', 1_000_000);
} else {
  console.log('SKIP CUSA.exe (agent-only staging)');
}
check(join(paths.updater, 'cusa-updater.exe'), 'cusa-updater.exe', 10_000);
check(join(buildDir, 'version.json'), 'version.json', 10);
check(join(paths.installer, 'scripts', 'init-programdata.ps1'), 'installer scripts', 10);

const msi = join(distDir, `CUSA-x64-${version}.msi`);
try {
  accessSync(msi);
  console.log(`OK  MSI (${Math.round(statSync(msi).size / 1024 / 1024)} MB)`);
} catch {
  console.log('SKIP MSI (run build:msi after WiX install)');
}

if (errors.length) {
  console.error('\nFailed:');
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log('\nValidation passed.');
