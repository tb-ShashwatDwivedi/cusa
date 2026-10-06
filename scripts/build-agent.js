#!/usr/bin/env node
/**
 * Phase 1: package the Node agent as cusa-agent.exe + shipped config.
 *
 * Output:
 *   build/agent/cusa-agent.exe   (Windows SEA, Node 20 LTS base)
 *   build/agent/bundle.cjs       (intermediate + non-Windows fallback)
 *   build/agent/config/default.json
 */
import { execSync } from 'node:child_process';
import { mkdirSync, statSync, copyFileSync, writeFileSync, rmSync, accessSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentDir = join(root, 'agent');
const outDir = join(root, 'build', 'agent');
const cacheDir = join(root, 'build', 'cache');
const configOut = join(outDir, 'config');
const bundlePath = join(outDir, 'bundle.cjs');
const blobPath = join(outDir, 'sea-prep.blob');
const seaConfigPath = join(outDir, 'sea-config.json');
const exePath = join(outDir, 'cusa-agent.exe');

const NODE_VERSION = '20.18.1';
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd || root, shell: true, ...opts });
}

function installAgentDeps() {
  try {
    run('npm ci', { cwd: agentDir });
  } catch {
    console.warn('npm ci failed — falling back to npm install');
    run('npm install', { cwd: agentDir });
  }
}

async function bundleAgent() {
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [join(agentDir, 'src/bootstrap/main.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    target: 'node20',
    sourcemap: false,
    logLevel: 'info',
    banner: {
      js: "var import_meta_url=require('url').pathToFileURL(__filename).href;",
    },
    define: { 'import.meta.url': 'import_meta_url' },
  });
  const kb = Math.round(statSync(bundlePath).size / 1024);
  console.log(`Bundle: ${bundlePath} (${kb} KB)`);
}

function copyShippedConfig() {
  mkdirSync(configOut, { recursive: true });
  const src = join(agentDir, 'config', 'default.json');
  copyFileSync(src, join(configOut, 'default.json'));
  console.log(`Config: ${join(configOut, 'default.json')}`);
}

/** Download Node 20 win-x64 for SEA base (Node 24 host lacks SEA sentinel). */
function ensureNode20Base() {
  const nodeDir = join(cacheDir, `node-v${NODE_VERSION}-win-x64`);
  const nodeExe = join(nodeDir, 'node.exe');
  try {
    accessSync(nodeExe);
    return nodeExe;
  } catch {
    // download
  }

  mkdirSync(cacheDir, { recursive: true });
  const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
  const zipPath = join(cacheDir, zipName);
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
  console.log(`Downloading Node ${NODE_VERSION} base: ${url}`);
  run(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'"`);
  run(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${cacheDir}' -Force"`,
  );
  accessSync(nodeExe);
  return nodeExe;
}

function buildWindowsExecutable() {
  if (process.platform !== 'win32') {
    console.warn('cusa-agent.exe build is Windows-only; use: node build/agent/bundle.cjs');
    return;
  }

  const nodeBase = ensureNode20Base();

  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true,
      },
      null,
      2,
    ),
  );

  run(`"${nodeBase}" --experimental-sea-config "${seaConfigPath}"`);
  copyFileSync(nodeBase, exePath);

  const postjectBin = require.resolve('postject/dist/cli.js');
  run(
    `node "${postjectBin}" "${exePath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${SENTINEL}`,
  );

  const mb = (statSync(exePath).size / (1024 * 1024)).toFixed(1);
  console.log(`Executable: ${exePath} (${mb} MB)`);

  try {
    rmSync(blobPath, { force: true });
    rmSync(seaConfigPath, { force: true });
  } catch {
    // optional
  }
}

async function main() {
  console.log('=== CUSA agent build (Phase 1) ===\n');

  installAgentDeps();
  console.log('\nRunning agent tests...');
  run('npm test', { cwd: agentDir });

  console.log('\nBundling agent...');
  await bundleAgent();
  copyShippedConfig();

  console.log('\nBuilding Windows executable (SEA)...');
  buildWindowsExecutable();

  console.log('\nAgent build complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
