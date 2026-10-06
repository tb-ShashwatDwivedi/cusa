import { rm, access } from 'node:fs/promises';
import { join } from 'node:path';

const PURGE_TARGETS = ['config', 'state', 'secrets', 'queue', 'cache', 'updates'];

/**
 * Remove agent identity, queues, and configuration from ProgramData.
 * Preserves logs/ by default so uninstall forensics remain available.
 *
 * @param {ReturnType<import('./paths.js').resolvePaths>} paths
 * @param {{ includeLogs?: boolean }} opts
 */
export async function purgeAgentData(paths, opts = {}) {
  const removed = [];
  for (const name of PURGE_TARGETS) {
    const target = join(paths.root, name);
    try {
      await access(target);
      await rm(target, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // absent
    }
  }
  if (opts.includeLogs) {
    try {
      await rm(join(paths.root, 'logs'), { recursive: true, force: true });
      removed.push('logs');
    } catch {
      // absent
    }
  }
  try {
    await rm(paths.installMarker, { force: true });
    removed.push('.install-marker');
  } catch {
    // absent
  }
  return { purged: true, removed };
}
