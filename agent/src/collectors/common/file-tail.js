import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Collector } from '../interfaces/collector.js';

export class FileTailCollector extends Collector {
  constructor(config) {
    super('file-tail', config);
    this.positions = new Map();
    this.timers = [];
  }

  async start() {
    await super.start();
    for (const path of this.config.paths || []) {
      this.watchFile(path);
    }
  }

  watchFile(path) {
    const poll = async () => {
      if (!this.running) return;
      try {
        const st = await stat(path);
        const inode = `${st.ino}-${st.dev}`;
        let pos = this.positions.get(path)?.pos || 0;
        if (this.positions.get(path)?.inode && this.positions.get(path).inode !== inode) pos = 0;
        if (st.size < pos) pos = 0;
        if (st.size > pos) {
          const stream = createReadStream(path, { start: pos, end: st.size - 1 });
          let buf = '';
          for await (const chunk of stream) {
            buf += chunk.toString('utf8');
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              this.emit({
                source: { platform: process.platform === 'win32' ? 'windows' : 'linux', collector: 'file-tail', path },
                event: { category: 'log', type: 'info' },
                raw: line,
              });
            }
          }
          this.positions.set(path, { pos: st.size, inode });
        }
      } catch {
        // file may not exist yet
      }
      this.timers.push(setTimeout(poll, this.config.intervalMs || 2000));
    };
    poll();
  }

  async stop() {
    await super.stop();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
