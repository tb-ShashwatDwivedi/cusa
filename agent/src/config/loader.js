import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { defaultDataRoot, resolvePaths } from '../platform/paths.js';
import { loadDeployOverlay } from '../platform/deploy.js';
import { migrateDataLayout, migrateConfigSchema, saveConfigWithBackup } from './migrate.js';
import { applyFixedEnrollment } from '../wazuh/enrollment-defaults.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(__dirname, '../../config/default.json');
const LOCAL_CONFIG = join(__dirname, '../../config/config.local.json');

/** @param {object} [config] */
export async function getDataDir(config) {
  if (config?.agent?.dataDir) return config.agent.dataDir;
  return defaultDataRoot();
}

/** @param {string} dataDir */
export function getPaths(dataDir) {
  return resolvePaths(dataDir);
}

/** Deep-merge source into target */
function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** @param {string} configPath */
export async function loadLocalOverlay(configPath) {
  try {
    const raw = await readFile(configPath, 'utf8');
    return migrateConfigSchema(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** @param {string} path @param {Set<string>} locked */
export function isPathLocked(path, locked) {
  for (const key of locked) {
    if (path === key || path.startsWith(`${key}.`)) return true;
  }
  return false;
}

/** @param {object} obj @param {string} [prefix] */
export function flattenPatch(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenPatch(v, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

/** @param {object} obj @param {string} path */
export function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

/** @param {object} obj @param {string} path @param {unknown} value */
export function setByPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = cur[keys[i]] || {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * @param {object} overlay existing local overlay
 * @param {object} patch nested partial update
 * @param {string[]} [locked]
 */
export function applyPatch(overlay, patch, locked = []) {
  const lockedSet = new Set(locked);
  const flat = flattenPatch(patch);
  for (const path of Object.keys(flat)) {
    if (isPathLocked(path, lockedSet)) {
      throw new Error(`Setting is locked: ${path}`);
    }
  }
  return deepMerge(overlay, patch);
}

/** Packaged exe loads config from <exe-dir>/config/default.json */
async function resolveDefaultConfigPath() {
  if (process.env.CUSA_CONFIG) return process.env.CUSA_CONFIG;
  const besideExe = join(dirname(process.execPath), 'config', 'default.json');
  try {
    await access(besideExe);
    return besideExe;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** @param {string} [path] */
export async function loadConfig(path) {
  const configPath = path || await resolveDefaultConfigPath();
  const raw = await readFile(configPath, 'utf8');
  let config = JSON.parse(raw);
  try {
    await access(LOCAL_CONFIG);
    const local = JSON.parse(await readFile(LOCAL_CONFIG, 'utf8'));
    config = deepMerge(config, local);
  } catch {
    // no repo-local config
  }

  const dataDir = await getDataDir(config);
  const paths = getPaths(dataDir);
  await migrateDataLayout(paths);
  await mkdir(paths.configDir, { recursive: true });

  const deploy = await loadDeployOverlay(paths.deploy);
  const localOverlay = await loadLocalOverlay(paths.configLocal);
  const mergedLocal = migrateConfigSchema(deepMerge(deploy, localOverlay));

  config = deepMerge(config, mergedLocal);
  applyFixedEnrollment(config);
  config.agent = { ...config.agent, dataDir, name: config.agent?.name || os.hostname() };
  config._paths = paths;
  config.deploy = deploy.source ? { source: deploy.source, deployedAt: deploy.deployedAt } : null;
  return config;
}

/** @param {object} config @param {string} dataDir */
export async function saveLocalConfig(config, dataDir) {
  const paths = getPaths(dataDir);
  const toSave = migrateConfigSchema({ ...config, schemaVersion: 3 });
  delete toSave._paths;
  delete toSave.deploy;
  await saveConfigWithBackup(paths.configLocal, toSave);
  return paths.configLocal;
}

/** Merge manager config over local; locked keys win from manager. */
export function mergeConfig(local, manager = {}, locked = []) {
  const out = structuredClone(local);
  const lockedSet = new Set(locked);
  for (const [k, v] of Object.entries(manager)) {
    if (lockedSet.has(k) || typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = mergeConfig(out[k] || {}, v, locked);
    } else if (!lockedSet.has(k)) {
      out[k] = v;
    }
  }
  return out;
}
