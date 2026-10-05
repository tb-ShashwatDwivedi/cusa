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
        const filter = bookmark
          ? `Get-WinEvent -LogName '${channel}' -FilterXPath '*[System[(EventRecordID > ${bookmark})]]' -MaxEvents 50`
          : `Get-WinEvent -LogName '${channel}' -MaxEvents 50`;
        const args = ['-NoProfile', '-Command', `${filter} | ConvertTo-Json -Compress`];
        const { stdout } = await execFileAsync('powershell.exe', args, { timeout: 30000 });
        if (!stdout.trim()) continue;
        const events = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
        let maxId = bookmark || 0;
        for (const ev of events) {
          const id = ev.RecordId || ev.Id;
          if (bookmark && id <= bookmark) continue;
          this.emit({
            source: { platform: 'windows', collector: 'event-channel', channel },
            event: { category: 'windows', type: 'event', action: String(ev.Id) },
            raw: JSON.stringify(ev),
          });
          if (id && id > maxId) maxId = id;
        }
        if (maxId && maxId !== bookmark) this.state.setBookmark('event-channel', channel, maxId);
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
