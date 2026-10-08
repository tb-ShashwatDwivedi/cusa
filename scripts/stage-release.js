#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, paths, version, buildDir } from './lib/paths.js';

function requireFile(path, label) {
  try {
    statSync(path);
    console.log(`  OK ${label}`);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

console.log('=== Stage release ===\n');

requireFile(join(paths.agent, 'cusa-agent.exe'), 'cusa-agent.exe');
requireFile(join(paths.agent, 'cusa-service-host.exe'), 'cusa-service-host.exe');
requireFile(join(paths.agent, 'config', 'default.json'), 'agent config');
const guiExe = join(paths.gui, 'CUSA.exe');
const includeGui = existsSync(guiExe);
if (includeGui) {
  requireFile(guiExe, 'CUSA.exe');
} else {
  console.log('  SKIP CUSA.exe (run build:gui or omit SKIP_GUI)');
}
requireFile(join(paths.updater, 'cusa-updater.exe'), 'cusa-updater.exe');

const installerScripts = join(root, 'installer', 'scripts');
copyDir(installerScripts, join(paths.installer, 'scripts'));
console.log('  OK installer scripts');

mkdirSync(paths.metadata, { recursive: true });
const manifest = {
  product: 'CUSA',
  version,
  channel: 'stable',
  builtAt: new Date().toISOString(),
  components: { agent: version, gui: includeGui ? version : null, updater: version },
};
writeFileSync(join(paths.metadata, 'version.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(buildDir, 'include-gui.txt'), includeGui ? '1' : '0');
copyFileSync(join(paths.metadata, 'version.json'), join(buildDir, 'version.json'));
console.log(`  OK version.json (${version})`);
console.log('\nStage complete:', buildDir);
