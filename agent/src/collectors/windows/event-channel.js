import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Collector } from '../interfaces/collector.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CHANNELS = ['Security', 'System', 'Application'];

export class WindowsEventChannelCollector extends Collector {
  constructor(config, state) {
    super('event-channel', config);
    this.state = state;
    this.channels = config.channels || DEFAULT_CHANNELS;
    this.timer = null;
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
        const args = [
          '-NoProfile',
          '-Command',
          `Get-WinEvent -LogName '${channel}' -MaxEvents 20 | Select-Object -First 20 | ConvertTo-Json -Compress`,
        ];
        const { stdout } = await execFileAsync('powershell.exe', args, { timeout: 30000 });
        if (!stdout.trim()) continue;
        const events = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
        for (const ev of events) {
          const id = ev.RecordId || ev.Id;
          if (bookmark && id <= bookmark) continue;
          this.emit({
            source: { platform: 'windows', collector: 'event-channel', channel },
            event: { category: 'windows', type: 'event', action: String(ev.Id) },
            raw: JSON.stringify(ev),
          });
          if (id) this.state.setBookmark('event-channel', channel, id);
        }
      } catch {
        // channel unavailable or access denied
      }
    }
    await this.state.save();
    this.timer = setTimeout(() => this.poll(), this.config.intervalMs || 5000);
  }

  async stop() {
    await super.stop();
    if (this.timer) clearTimeout(this.timer);
  }
}
