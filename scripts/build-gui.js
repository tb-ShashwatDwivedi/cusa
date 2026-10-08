#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { root, paths } from './lib/paths.js';

const tauriDir = join(root, 'src-tauri');
const guiDir = join(root, 'gui');

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function findExe(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findExe(p);
      if (found) return found;
    } else if (name.endsWith('.exe') && !name.includes('uninstall')) {
      return p;
    }
  }
  return null;
}

console.log('Building GUI...');
try {
  run('npm ci', guiDir);
} catch {
  run('npm install', guiDir);
}
run('cargo tauri build', tauriDir);

const releaseExe = join(tauriDir, 'target', 'release', 'cusa-gui.exe');
const bundleRoot = join(tauriDir, 'target', 'release', 'bundle');
const srcExe =
  (existsSync(releaseExe) && releaseExe) ||
  (existsSync(bundleRoot) && findExe(bundleRoot)) ||
  null;
if (!srcExe) {
  throw new Error(`Tauri exe not found (checked ${releaseExe} and ${bundleRoot})`);
}

mkdirSync(paths.gui, { recursive: true });
const dest = join(paths.gui, 'CUSA.exe');
copyFileSync(srcExe, dest);
console.log(`GUI: ${dest} (${Math.round(statSync(dest).size / 1024)} KB)`);
