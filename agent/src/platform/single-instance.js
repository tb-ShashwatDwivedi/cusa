import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** @param {string} dataDir @returns {Promise<boolean>} true if lock acquired */
export async function acquireSingleInstanceLock(dataDir) {
  const lockPath = join(dataDir, 'agent.pid');
  try {
    const existing = await readFile(lockPath, 'utf8');
    const pid = Number(existing.trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        // stale
      }
    }
  } catch {
    // no lock
  }
  await writeFile(lockPath, String(process.pid));
  return true;
}

/** @param {string} dataDir */
export async function releaseSingleInstanceLock(dataDir) {
  try {
    await unlink(join(dataDir, 'agent.pid'));
  } catch {
    // ignore
  }
}
