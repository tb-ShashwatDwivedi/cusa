#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { root, paths } from './lib/paths.js';

const crateDir = join(root, 'service-host');
const outExe = join(paths.agent, 'cusa-service-host.exe');

mkdirSync(paths.agent, { recursive: true });
execSync('cargo build --release', { cwd: crateDir, stdio: 'inherit' });

const built = join(crateDir, 'target', 'release', 'cusa-service-host.exe');
copyFileSync(built, outExe);
const kb = Math.round(statSync(outExe).size / 1024);
console.log(`Service host: ${outExe} (${kb} KB)`);
