import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Collector } from '../interfaces/collector.js';
import { buildWinevtPayload } from './winevt-format.js';
import { buildPollCommand } from './winevt-poll.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CHANNELS = ['Security', 'System', 'Application'];

export class WindowsEventChannelCollector extends Collector {
  constructor(config, state) {
    super('event-channel', config);
    this.state = state;
    this.channels = config.channels || DEFAULT_CHANNELS;
    this.timer = null;
    this.lastError = null;
  }

  async start() {
    await super.start();
    this.poll();
  }

  async poll() {
    if (!this.running) return;
    for (const channel of this.channels) {
      try {
        const bookmark = this.state.getBookmark('event-channel', channel);
        const script = buildPollCommand(channel, bookmark);
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 45000, maxBuffer: 16 * 1024 * 1024 },
        );
        if (!stdout.trim()) continue;

        let maxId = bookmark || 0;
        for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
          let row;
          try {
            row = JSON.parse(line);
          } catch {
            continue;
          }
          const id = row.RecordId || row.Id;
          if (bookmark && id <= bookmark) continue;
          if (!row.Event) continue;

          const raw = buildWinevtPayload({ Message: row.Message, Event: row.Event });
          this.emit({
            source: { platform: 'windows', collector: 'event-channel', channel: 'EventChannel' },
            event: { category: 'windows', type: 'event', action: String(row.Id || '') },
            raw,
          });
          if (id && id > maxId) maxId = id;
        }
        if (maxId && maxId !== bookmark) this.state.setBookmark('event-channel', channel, maxId);
        this.lastError = null;
      } catch (err) {
        this.lastError = err.message;
      }
    }
    await this.state.save();
    this.timer = setTimeout(() => this.poll(), this.config.intervalMs || 5000);
  }

  async health() {
    const base = await super.health();
    return { ...base, lastError: this.lastError || null };
  }

  async stop() {
    await super.stop();
    if (this.timer) clearTimeout(this.timer);
  }
}
