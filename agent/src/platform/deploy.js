import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Centralized deployment overlay (MSI / GPO / SCCM push).
 * Written by installer to config/deploy.json or via environment at service start.
 *
 * @param {string} deployPath
 * @returns {Promise<object>}
 */
export async function loadDeployOverlay(deployPath) {
  const fromFile = await readDeployFile(deployPath);
  const fromEnv = deployFromEnv();
  if (!fromFile && !fromEnv) return {};
  return deepMerge(fromFile || {}, fromEnv || {});
}

/** @param {string} deployPath */
async function readDeployFile(deployPath) {
  try {
    const raw = await readFile(deployPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.wazuh || parsed.collectors || parsed.logging ? parsed : { wazuh: parsed };
  } catch {
    return null;
  }
}

function deployFromEnv() {
  const address = process.env.CUSA_MANAGER_ADDRESS || process.env.MANAGER_ADDRESS;
  if (!address) return null;
  const overlay = {
    source: 'environment',
    wazuh: {
      manager: {
        address,
        port: numEnv('CUSA_MANAGER_PORT', 'MANAGER_PORT', 1514),
        enrollmentPort: numEnv('CUSA_ENROLLMENT_PORT', 'ENROLLMENT_PORT', 1515),
      },
    },
  };
  const version = process.env.CUSA_WAZUH_VERSION;
  if (version) overlay.wazuh.version = version;
  return overlay;
}

function numEnv(primary, fallback, defaultVal) {
  const raw = process.env[primary] || process.env[fallback];
  if (raw === undefined || raw === '') return defaultVal;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultVal;
}

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

/**
 * Write deploy overlay (used by installer custom action / staging scripts).
 * @param {string} deployPath
 * @param {object} overlay
 */
export async function writeDeployOverlay(deployPath, overlay) {
  await mkdir(dirname(deployPath), { recursive: true });
  const payload = {
    schemaVersion: 1,
    source: overlay.source || 'msi',
    deployedAt: new Date().toISOString(),
    ...overlay,
  };
  await writeFile(deployPath, JSON.stringify(payload, null, 2));
}
