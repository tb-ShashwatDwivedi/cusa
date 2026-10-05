import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class Updater {
  /** @param {object} opts */
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.currentVersion = opts.currentVersion;
    this.onApply = opts.onApply;
  }

  /** @param {object} manifest */
  async applyUpdate(manifest) {
    if (!manifest.version || !manifest.url || !manifest.sha256) {
      throw new Error('Invalid manifest');
    }
    if (manifest.version <= this.currentVersion) {
      throw new Error('Downgrade not allowed');
    }
    const res = await fetch(manifest.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash !== manifest.sha256) throw new Error('Checksum mismatch');
    const stagePath = join(this.dataDir, 'update-staging.bin');
    await writeFile(stagePath, buf);
    await this.onApply?.(stagePath, manifest);
    return { success: true, version: manifest.version };
  }
}
