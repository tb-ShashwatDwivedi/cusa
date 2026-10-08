#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDir, distDir, root, version } from './lib/paths.js';

const wixDir = join(root, 'installer', 'wix');
const msiName = `CUSA-x64-${version}.msi`;
const msiPath = join(distDir, msiName);

function hasWix() {
  try {
    execSync('wix --version', { stdio: 'pipe', shell: true });
    return true;
  } catch {
    return false;
  }
}

if (!hasWix()) {
  console.error('WiX Toolset 4 not found. Install: https://wixtoolset.org/docs/intro/');
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });

const includeGuiFlag = join(buildDir, 'include-gui.txt');
const includeGui = existsSync(includeGuiFlag)
  ? readFileSync(includeGuiFlag, 'utf8').trim() === '1'
  : existsSync(join(buildDir, 'gui', 'CUSA.exe'));

const agentOnly = process.env.AGENT_ONLY === '1';
if (!includeGui && !agentOnly) {
  console.error('MSI would be agent-only (no GUI). build/gui/CUSA.exe is missing.');
  console.error('Build the GUI first:  npm run build:gui');
  console.error('Then stage and build:  node scripts/stage-release.js && npm run build:msi');
  console.error('Or full release:       npm run build:release');
  console.error('Agent-only MSI:        set AGENT_ONLY=1 && npm run build:msi');
  process.exit(1);
}

if (!includeGui) {
  console.warn('AGENT_ONLY=1 — MSI will not include CUSA.exe or GUI shortcuts.');
} else {
  console.log('Including GUI: build/gui/CUSA.exe');
}

const sources = [
  'Package.wxs',
  'Directories.wxs',
  'Files.wxs',
  'Service.wxs',
  'Shortcuts.wxs',
  'CustomActions.wxs',
].map((f) => join(wixDir, f));

const cmd = [
  'wix build',
  '-arch x64',
  `-d BuildRoot=${buildDir}`,
  `-d IncludeGui=${includeGui ? 1 : 0}`,
  `-o "${msiPath}"`,
  ...sources.map((s) => `"${s}"`),
].join(' ');

console.log('Building MSI...\n', cmd, '\n');
execSync(cmd, { stdio: 'inherit', shell: true, cwd: wixDir });

const mb = (statSync(msiPath).size / (1024 * 1024)).toFixed(1);
console.log(`\nMSI: ${msiPath} (${mb} MB)`);
