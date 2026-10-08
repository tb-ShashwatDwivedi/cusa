#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { root, paths } from './lib/paths.js';

const crateDir = join(root, 'updater-stub');
const outExe = join(paths.updater, 'cusa-updater.exe');

mkdirSync(paths.updater, { recursive: true });
execSync('cargo build --release', { cwd: crateDir, stdio: 'inherit' });

const built = join(crateDir, 'target', 'release', 'cusa-updater.exe');
copyFileSync(built, outExe);
console.log(`Updater stub: ${outExe} (${Math.round(statSync(outExe).size / 1024)} KB)`);
