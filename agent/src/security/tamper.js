import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export class TamperDetector {
  /** @param {object} opts */
  constructor(opts) {
    this.paths = opts.paths || [];
    this.baseline = new Map();
    this.updateInProgress = false;
    this.onTamper = opts.onTamper;
  }

  setUpdateInProgress(v) {
    this.updateInProgress = v;
  }

  async init() {
    for (const p of this.paths) {
      await this.record(p);
    }
  }

  async record(path) {
    try {
      const st = await stat(path);
      const hash = st.isFile() ? createHash('sha256').update(await readFile(path)).digest('hex') : null;
      this.baseline.set(path, { mtime: st.mtimeMs, hash });
    } catch {
      // skip
    }
  }

  async check() {
    if (this.updateInProgress) return [];
    const alerts = [];
    for (const [path, prev] of this.baseline) {
      try {
        const st = await stat(path);
        const hash = st.isFile() ? createHash('sha256').update(await readFile(path)).digest('hex') : null;
        if (hash !== prev.hash || st.mtimeMs !== prev.mtime) {
          alerts.push({ path, type: 'modification' });
          this.onTamper?.({ path, type: 'modification' });
        }
      } catch {
        alerts.push({ path, type: 'missing' });
        this.onTamper?.({ path, type: 'missing' });
      }
    }
    return alerts;
  }
}
