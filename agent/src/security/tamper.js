import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

export class TamperDetector {
  /** @param {object} opts */
  constructor(opts) {
    this.paths = opts.paths || [];
    this.trustFile = opts.trustFile;
    this.baseline = new Map();
    this.updateInProgress = false;
    this.onTamper = opts.onTamper;
    this.enabled = opts.enabled !== false;
    // Alert once per changed path and hold the last-known-good baseline, rather than
    // re-alerting every cycle or silently rewriting the baseline on change. CYB-6107.
    this.alertOnce = opts.alertOnce !== false;
    this.alerted = new Set();
  }

  setUpdateInProgress(v) {
    this.updateInProgress = v;
  }

  async hashFile(path) {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
      stream.on('data', (c) => hash.update(c));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async loadTrustStore() {
    if (!this.trustFile) return;
    try {
      const raw = await readFile(this.trustFile, 'utf8');
      const data = JSON.parse(raw);
      for (const [path, meta] of Object.entries(data)) {
        this.baseline.set(path, meta);
      }
    } catch {
      // initialize below
    }
  }

  async persistTrustStore() {
    if (!this.trustFile) return;
    await mkdir(dirname(this.trustFile), { recursive: true });
    const obj = {};
    for (const [path, meta] of this.baseline) obj[path] = meta;
    await writeFile(this.trustFile, JSON.stringify(obj, null, 2));
  }

  async init() {
    await this.loadTrustStore();
    for (const p of this.paths) {
      if (!this.baseline.has(p)) await this.record(p);
    }
    await this.persistTrustStore();
  }

  async record(path) {
    try {
      const st = await stat(path);
      const hash = st.isFile() ? await this.hashFile(path) : null;
      this.baseline.set(path, { mtime: st.mtimeMs, hash, mode: st.mode });
    } catch {
      // skip
    }
  }

  async check() {
    if (!this.enabled || this.updateInProgress) return [];
    const alerts = [];
    for (const [path, prev] of this.baseline) {
      try {
        const st = await stat(path);
        const hash = st.isFile() ? await this.hashFile(path) : null;
        const changed = hash !== prev.hash || st.mtimeMs !== prev.mtime;
        if (changed) {
          // Baseline is last-known-good and is NOT mutated here, so the alert reflects
          // the original trusted state until an operator re-trusts (trust()/init).
          if (!this.alertOnce || !this.alerted.has(path)) {
            const alert = { path, type: 'modification' };
            alerts.push(alert);
            this.alerted.add(path);
            this.onTamper?.(alert);
          }
        } else {
          // Reverted to known-good — re-arm so a future change alerts again.
          this.alerted.delete(path);
        }
      } catch {
        if (!this.alertOnce || !this.alerted.has(path)) {
          const alert = { path, type: 'missing' };
          alerts.push(alert);
          this.alerted.add(path);
          this.onTamper?.(alert);
        }
      }
    }
    return alerts;
  }

  /** Explicitly re-trust the current on-disk state (e.g. after an authorized update). */
  async trust() {
    this.baseline.clear();
    this.alerted.clear();
    for (const p of this.paths) await this.record(p);
    await this.persistTrustStore();
  }
}
