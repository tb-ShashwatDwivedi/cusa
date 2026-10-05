import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export class FimWatcher {
  /** @param {object} config @param {import('../state/store.js').StateStore} state */
  constructor(config, state) {
    this.paths = config.paths || [];
    this.state = state;
    this.watchers = [];
    this.onChange = null;
  }

  /** @param {(item: object) => void} fn */
  setHandler(fn) {
    this.onChange = fn;
  }

  async start() {
    for (const path of this.paths) {
      await this.baseline(path);
      const w = watch(path, { recursive: true }, () => this.handleChange(path));
      this.watchers.push(w);
    }
  }

  async baseline(path) {
    try {
      const st = await stat(path);
      const hash = st.isFile() ? await this.hashFile(path) : null;
      this.state.data.fimBaseline[path] = { mtime: st.mtimeMs, size: st.size, hash };
    } catch {
      // path missing
    }
  }

  async hashFile(path) {
    const data = await readFile(path);
    return createHash('sha256').update(data).digest('hex');
  }

  async handleChange(path) {
    try {
      const st = await stat(path);
      const prev = this.state.data.fimBaseline[path];
      const hash = st.isFile() ? await this.hashFile(path) : null;
      const op = prev ? 'update' : 'create';
      this.onChange?.({
        id: `fim-${path}`,
        index: 'wazuh-states-fim',
        operation: op,
        timestamp: new Date().toISOString(),
        data: { path, mode: st.isDirectory() ? 'directory' : 'file', size: st.size, sha256: hash, mtime: st.mtimeMs },
      });
      this.state.data.fimBaseline[path] = { mtime: st.mtimeMs, size: st.size, hash };
      await this.state.save();
    } catch {
      if (this.state.data.fimBaseline[path]) {
        this.onChange?.({
          id: `fim-${path}`,
          index: 'wazuh-states-fim',
          operation: 'delete',
          timestamp: new Date().toISOString(),
          data: { path },
        });
        delete this.state.data.fimBaseline[path];
        await this.state.save();
      }
    }
  }

  stop() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
