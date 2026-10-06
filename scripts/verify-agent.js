#!/usr/bin/env node
/** Smoke-check Phase 1 build output under build/agent/ */
import { accessSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'build', 'agent');
const exe = join(outDir, 'cusa-agent.exe');
const bundle = join(outDir, 'bundle.cjs');
const config = join(outDir, 'config', 'default.json');

const errors = [];

function check(path, label, minBytes = 1) {
  try {
    accessSync(path);
    const size = statSync(path).size;
    if (size < minBytes) errors.push(`${label}: file too small (${size} bytes)`);
    else console.log(`OK  ${label} (${Math.round(size / 1024)} KB)`);
  } catch {
    errors.push(`${label}: missing — ${path}`);
  }
}

console.log('=== Verify agent build ===\n');
check(config, 'config/default.json', 100);
check(bundle, 'bundle.cjs', 50_000);

if (process.platform === 'win32') {
  check(exe, 'cusa-agent.exe', 5_000_000);
} else {
  console.log('SKIP cusa-agent.exe (Windows SEA only)');
}

if (errors.length) {
  console.error('\nVerification failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('\nVerification passed.');
