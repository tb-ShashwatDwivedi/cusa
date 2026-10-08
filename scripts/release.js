#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync, accessSync } from 'node:fs';
import { join } from 'node:path';
import { root, distDir, version } from './lib/paths.js';

function run(script) {
  execSync(`node "${join(root, 'scripts', script)}"`, { stdio: 'inherit', cwd: root, shell: true });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

console.log('=== CUSA release build ===\n');

run('build-agent.js');
run('build-service-host.js');
run('build-updater.js');

const skipGui = process.env.SKIP_GUI === '1';
if (!skipGui) {
  try {
    run('build-gui.js');
  } catch (err) {
    console.warn('GUI build failed — set SKIP_GUI=1 to skip. Continuing without GUI.');
  }
} else {
  console.log('SKIP_GUI=1 — skipping Tauri GUI build');
}

run('stage-release.js');

let msiBuilt = false;
try {
  run('build-msi.js');
  msiBuilt = true;
} catch {
  console.warn('MSI build skipped (WiX not installed or build failed)');
}

run('validate-msi.js');

mkdirSync(distDir, { recursive: true });
const manifest = {
  version,
  channel: 'stable',
  builtAt: new Date().toISOString(),
  artifacts: {},
};

if (msiBuilt) {
  const msi = join(distDir, `CUSA-x64-${version}.msi`);
  const hash = sha256(msi);
  writeFileSync(`${msi}.sha256`, `${hash}  ${msi.split(/[/\\]/).pop()}\n`);
  manifest.artifacts.msi = { file: `CUSA-x64-${version}.msi`, sha256: hash, bytes: statSync(msi).size };
  console.log(`\nSHA-256: ${hash}`);
}

writeFileSync(join(distDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nRelease manifest: ${join(distDir, 'release-manifest.json')}`);
console.log('\n=== Release complete ===');
