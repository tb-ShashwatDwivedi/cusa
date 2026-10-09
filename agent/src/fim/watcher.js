import { watch } from 'node:fs';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';


export class FimWatcher {
  /** @param {object} config @param {import('../state/store.js').StateStore} state */
  constructor(config, state, logger) {
    this.config = config;
    this.paths = config.paths || [];
    this.state = state;
    this.logger = logger;
    this.watchers = [];
    this.onChange = null;
  }

  /** @param {(item: object) => void} fn */
  setHandler(fn) {
    this.onChange = fn;
  }

async start() {
  const paths = [...new Set(this.paths.map((p) => resolve(p)))];

  for (const path of paths) {
    let st;

    try {
      st = await stat(path);
    } catch (err) {
      this.logger?.error(
        { path, code: err.code, err },
        'FIM configured path is unavailable'
      );

      // Skip invalid paths without crashing the entire agent.
      continue;
    }

    if (!st.isFile() && !st.isDirectory()) {
      this.logger?.warn({ path }, 'FIM path is not a file or directory');
      continue;
    }

    try {
      await this.baseline(path);

      const watcher = watch(
        path,
        st.isDirectory() ? { recursive: true } : {},
        (eventType, filename) => {
          if (!filename) {
            this.logger?.warn(
              { path, eventType },
              'FIM event has no filename; reconciliation required'
            );
            return;
          }

          const changedPath = resolve(path, filename.toString());

          this.handleChange(changedPath).catch((err) => {
            this.logger?.error(
              { path: changedPath, err },
              'FIM change processing failed'
            );
          });
        }
      );

      watcher.on('error', (err) => {
        this.logger?.error({ path, err }, 'FIM watcher error');
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger?.error(
        { path, code: err.code, err },
        'Failed to initialize FIM watcher'
      );

      // Continue monitoring other configured paths.
    }
  }
}


  async baseline(path) {
    await this.walkBaseline(path, 0);
  }

  async walkBaseline(path, depth) {
    if (depth > (this.config.maxDepth ?? 3)) return;
    try {
      const st = await stat(path);
      if (st.isFile()) {
        const hash = await this.hashFile(path);
        this.state.data.fimBaseline[path] = { mtime: st.mtimeMs, size: st.size, hash };
        return;
      }
      if (st.isDirectory()) {
        this.state.data.fimBaseline[path] = { mtime: st.mtimeMs, size: st.size, hash: null };
        const entries = await readdir(path);
        for (const entry of entries) {
          await this.walkBaseline(join(path, entry), depth + 1);
        }
      }
    } catch {
      // path missing
    }
  }

  async hashFile(path) {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
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
