import { createHash, createVerify } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';

export class Updater {
  /** @param {object} opts */
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.currentVersion = opts.currentVersion;
    this.onApply = opts.onApply;
    this.publicKeyPem = opts.publicKeyPem || null;
    this.product = opts.product || 'cusa-agent';
    this.architecture = opts.architecture || process.arch;
  }

  verifyManifest(manifest) {
    if (manifest.product && manifest.product !== this.product) {
      throw new Error('Wrong product');
    }
    if (manifest.architecture && manifest.architecture !== this.architecture) {
      throw new Error('Wrong architecture');
    }
    if (manifest.signature && this.publicKeyPem) {
      const verify = createVerify('SHA256');
      const payload = `${manifest.version}|${manifest.sha256}|${manifest.url}`;
      verify.update(payload);
      verify.end();
      const ok = verify.verify(this.publicKeyPem, manifest.signature, 'base64');
      if (!ok) throw new Error('Invalid manifest signature');
    } else if (manifest.signature && !this.publicKeyPem) {
      throw new Error('Manifest signed but no public key configured');
    }
  }

  /** @param {object} manifest */
  async applyUpdate(manifest) {
    if (!manifest.version || !manifest.url || !manifest.sha256) {
      throw new Error('Invalid manifest');
    }
    if (manifest.version <= this.currentVersion) {
      throw new Error('Downgrade not allowed');
    }
    this.verifyManifest(manifest);
    const res = await fetch(manifest.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const stagePath = join(this.dataDir, 'update-staging.bin');
    const hash = createHash('sha256');
    const body = res.body;
    if (!body) throw new Error('Empty download body');
    const src = Readable.fromWeb(body);
    src.on('data', (chunk) => hash.update(chunk));
    const dest = createWriteStream(stagePath);
    await pipeline(src, dest);
    const digest = hash.digest('hex');
    if (digest !== manifest.sha256) throw new Error('Checksum mismatch');
    await this.onApply?.(stagePath, manifest);
    return { success: true, version: manifest.version };
  }
}
