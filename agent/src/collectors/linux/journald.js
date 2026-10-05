import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Collector } from '../interfaces/collector.js';

const execFileAsync = promisify(execFile);

export class JournaldCollector extends Collector {
  constructor(config, state) {
    super('journald', config);
    this.state = state;
    this.timer = null;
  }

  async start() {
    await super.start();
    this.poll();
  }

  async poll() {
    if (!this.running) return;
    try {
      const cursor = this.state.getBookmark('journald', 'main') || '';
      const args = cursor
        ? ['--cursor', cursor, '-n', '50', '-o', 'json']
        : ['-n', '50', '-o', 'json'];
      const { stdout } = await execFileAsync('journalctl', args, { timeout: 15000 });
      for (const line of stdout.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line);
        this.emit({
          source: { platform: 'linux', collector: 'journald', channel: entry.SYSLOG_IDENTIFIER || 'journal' },
          event: { category: 'log', type: entry.PRIORITY || 'info' },
          raw: line,
        });
        if (entry.__CURSOR) this.state.setBookmark('journald', 'main', entry.__CURSOR);
      }
      await this.state.save();
    } catch {
      // journalctl not available
    }
    this.timer = setTimeout(() => this.poll(), this.config.intervalMs || 5000);
  }

  async stop() {
    await super.stop();
    if (this.timer) clearTimeout(this.timer);
  }
}
