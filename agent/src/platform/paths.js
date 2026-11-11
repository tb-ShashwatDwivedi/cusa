import { join } from 'node:path';
import os from 'node:os';
import { access } from 'node:fs/promises';

export const PROGRAM_DATA_WIN = 'C:\\ProgramData\\CUSA';
export const PROGRAM_FILES_WIN = 'C:\\Program Files\\CUSA';

/** Packaged agent exe (service or console), not `node` from npm start. */
export function isPackagedAgent() {
  const exe = process.execPath.toLowerCase();
  return exe.endsWith('cusa-agent.exe') || exe.endsWith('cusa-agent');
}

/** @returns {Promise<string>} */
export async function defaultDataRoot() {
  if (process.env.CUSA_DATA_DIR) return process.env.CUSA_DATA_DIR;
  // Dev (`npm start`) must not use ProgramData — MSI marker exists but user lacks write ACL.
  if (!isPackagedAgent()) return join(os.homedir(), '.cusa');
  if (process.platform === 'win32') {
    try {
      await access(join(PROGRAM_DATA_WIN, '.install-marker'));
      return PROGRAM_DATA_WIN;
    } catch {
      // not an MSI install — fall through to dev profile path
    }
  }
  return join(os.homedir(), '.cusa');
}

/** @param {string} root */
export function resolvePaths(root) {
  return {
    root,
    configDir: join(root, 'config'),
    configLocal: join(root, 'config', 'config.local.json'),
    deploy: join(root, 'config', 'deploy.json'),
    state: join(root, 'state', 'state.json'),
    secrets: join(root, 'secrets', 'secrets.enc'),
    // Single canonical location for manager-pushed shared config (agent.conf / merged.mg).
    // Previously three modules disagreed on this path (secrets-file-relative vs dataDir-relative),
    // so remoted pushes and keepalive hashes never lined up. CYB-6085.
    managerDir: join(root, 'manager'),
    managerAgentConf: join(root, 'manager', 'agent.conf'),
    managerMergedMg: join(root, 'manager', 'merged.mg'),
    queue: join(root, 'queue'),
    logs: join(root, 'logs', 'agent'),
    installerLogs: join(root, 'logs', 'installer'),
    updaterLogs: join(root, 'logs', 'updater'),
    updates: join(root, 'updates'),
    cache: join(root, 'cache'),
    installMarker: join(root, '.install-marker'),
  };
}
