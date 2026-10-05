import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export class StateStore {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.path = join(dataDir, 'state.json');
    this.data = {
      globalCounter: 0,
      localCounter: 0,
      enrollment: { status: 'pending', agentId: null, name: null, ip: null, key: null },
      bookmarks: {},
      fimBaseline: {},
      taskIds: [],
      configVersion: 0,
      lastSync: null,
      lastCommand: null,
    };
  }

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      this.data = { ...this.data, ...JSON.parse(raw) };
    } catch {
      await mkdir(dirname(this.path), { recursive: true }).catch(() => {});
    }
    return this.data;
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true }).catch(() => {});
    await writeFile(this.path, JSON.stringify(this.data, null, 2));
  }

  nextCounters() {
    this.data.globalCounter += 1;
    this.data.localCounter = (this.data.localCounter + 1) % 10000;
    return { global: this.data.globalCounter, local: this.data.localCounter };
  }

  getBookmark(collector, channel) {
    return this.data.bookmarks[`${collector}:${channel}`] || null;
  }

  setBookmark(collector, channel, value) {
    this.data.bookmarks[`${collector}:${channel}`] = value;
  }
}
