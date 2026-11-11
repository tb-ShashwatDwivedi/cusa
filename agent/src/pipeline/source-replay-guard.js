import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashIdentity } from './source-identity.js';

const MAX_ENTRIES = 50000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SourceReplayGuard {
  /** @param {string} cacheDir */
  constructor(cacheDir) {
    this.path = join(cacheDir, 'replay-guard.json');
    this.entries = new Map();
  }

  async init() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [k, v] of Object.entries(data.entries || {})) {
        if (now - (v.at || 0) < TTL_MS) this.entries.set(k, v);
      }
    } catch {
      this.entries = new Map();
    }
  }

  /** @returns {boolean} true if duplicate replay */
  isReplay(identity) {
    if (!identity) return false;
    const key = hashIdentity(identity);
    return this.entries.has(key);
  }

  /** @param {string} identity */
  async markSeen(identity) {
    if (!identity) return;
    const key = hashIdentity(identity);
    this.entries.set(key, { at: Date.now() });
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i < oldest.length - MAX_ENTRIES; i++) {
        this.entries.delete(oldest[i][0]);
      }
    }
    await this.persist();
  }

  async persist() {
    await mkdir(join(this.path, '..'), { recursive: true }).catch(() => {});
    const obj = { entries: Object.fromEntries(this.entries) };
    await writeFile(this.path, JSON.stringify(obj));
  }
}
