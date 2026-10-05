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

/** @param {string} [path] */
export async function loadConfig(path = DEFAULT_CONFIG) {
  const raw = await readFile(path, 'utf8');
  let config = JSON.parse(raw);
  try {
    await access(LOCAL_CONFIG);
    const local = JSON.parse(await readFile(LOCAL_CONFIG, 'utf8'));
    config = deepMerge(config, local);
  } catch {
    // no local config
  }
  const dataDir = getDataDir(config);
  await mkdir(dataDir, { recursive: true });
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
