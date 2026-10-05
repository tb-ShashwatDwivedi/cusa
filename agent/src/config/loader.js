import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(__dirname, '../../config/default.json');
const LOCAL_CONFIG = join(__dirname, '../../config/config.local.json');

/** @returns {string} */
export function getDataDir(config) {
  return config.agent?.dataDir || join(os.homedir(), '.cusa');
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

/** @param {string} dataDir */
export async function loadLocalOverlay(dataDir) {
  try {
    const raw = await readFile(join(dataDir, 'config.local.json'), 'utf8');
    return JSON.parse(raw);
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

/** @param {string} [path] */
export async function loadConfig(path = DEFAULT_CONFIG) {
  const raw = await readFile(path, 'utf8');
  let config = JSON.parse(raw);
  try {
    await access(LOCAL_CONFIG);
    const local = JSON.parse(await readFile(LOCAL_CONFIG, 'utf8'));
    config = deepMerge(config, local);
  } catch {
    // no repo-local config
  }
  const dataDir = getDataDir(config);
  await mkdir(dataDir, { recursive: true });
  config = deepMerge(config, await loadLocalOverlay(dataDir));
  config.agent = { ...config.agent, dataDir, name: config.agent?.name || os.hostname() };
  return config;
}

/** @param {object} config @param {string} dataDir */
export async function saveLocalConfig(config, dataDir) {
  const localPath = join(dataDir, 'config.local.json');
  await writeFile(localPath, JSON.stringify(config, null, 2));
  return localPath;
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
