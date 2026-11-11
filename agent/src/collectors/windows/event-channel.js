import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Collector } from '../interfaces/collector.js';
import { buildWinevtPayload } from './winevt-format.js';
import { buildPollCommand, buildSeedBookmarkCommand } from './winevt-poll.js';
import { parseWinevtXml } from './winevt-meta.js';
import { isSelfCollectorWinevt } from './winevt-filter.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CHANNELS = ['Security', 'System', 'Application'];

export class WindowsEventChannelCollector extends Collector {
  constructor(config, state) {
    super('event-channel', config);
    this.state = state;
    this.channels = config.channels || DEFAULT_CHANNELS;
    this.timer = null;
    this.lastError = null;
    this.lastPollAt = null;
    this.lastSuccessAt = null;
    this.lastEmptyPollAt = null;
    this.eventsCollected = 0;
    this.pollsFailed = 0;
    this.pollsEmpty = 0;
  }

  async start() {
    await super.start();
    this.poll();
  }

  async poll() {
    if (!this.running) return;
    this.lastPollAt = new Date().toISOString();
    let bookmarksDirty = false;
    for (const channel of this.channels) {
      const collectorKey = this.name;
      try {
        let bookmark = this.state.getBookmark(collectorKey, channel);
        const tailFromNow = this.config.tailFromNow !== false;
        if (!bookmark && tailFromNow) {
          const seedScript = buildSeedBookmarkCommand(channel);
          try {
            const { stdout: seedOut } = await execFileAsync(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', seedScript],
              { timeout: 20000, maxBuffer: 4096 },
            );
            const seed = Number.parseInt(String(seedOut).trim(), 10);
            if (seed > 0) {
              this.state.setBookmark(collectorKey, channel, seed);
              bookmarksDirty = true;
              continue;
            }
          } catch {
            // fall through to capped historical poll
          }
        }
        const script = buildPollCommand(channel, bookmark, this.config);
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 45000, maxBuffer: 16 * 1024 * 1024 },
        );
        if (!stdout.trim()) {
          this.pollsEmpty += 1;
          this.lastEmptyPollAt = new Date().toISOString();
          continue;
        }

        let maxId = bookmark || 0;
        let channelOk = true;
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
          if (isSelfCollectorWinevt(row)) continue;

          const meta = parseWinevtXml(row.Event);
          const raw = buildWinevtPayload({ Message: row.Message, Event: row.Event });
          try {
            await this.emitAsync({
              source: {
                platform: 'windows',
                collector: collectorKey,
                channel: meta.channel || channel,
              },
              event: {
                category: 'windows',
                type: 'event',
                action: String(meta.eventId || row.Id || ''),
                eventId: meta.eventId,
                provider: meta.provider,
              },
              metadata: {
                windows: {
                  channel: meta.channel || channel,
                  recordId: meta.recordId ?? id,
                  provider: meta.provider,
                  eventId: meta.eventId,
                  computer: meta.computer,
                  timeCreated: meta.timeCreated,
                },
                sourceRecordId: meta.recordId ?? id,
              },
              raw,
            });
            this.eventsCollected += 1;
            if (id && id > maxId) maxId = id;
          } catch {
            channelOk = false;
            break;
          }
        }
        if (channelOk && maxId && maxId !== bookmark) {
          this.state.setBookmark(collectorKey, channel, maxId);
          bookmarksDirty = true;
        }
        if (channelOk) {
          this.lastSuccessAt = new Date().toISOString();
          this.lastError = null;
        }
      } catch (err) {
        this.lastError = err.message;
        this.pollsFailed += 1;
      }
    }
    if (bookmarksDirty) await this.state.save();
    this.timer = setTimeout(() => this.poll(), this.config.intervalMs || 15000);
  }

  async health() {
    const base = await super.health();
    return {
      ...base,
      enabled: true,
      available: process.platform === 'win32',
      accessible: this.lastError == null || this.lastSuccessAt != null,
      healthy: this.lastSuccessAt != null && !this.lastError,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastEmptyPollAt: this.lastEmptyPollAt,
      lastError: this.lastError || null,
      eventsCollected: this.eventsCollected,
      pollsFailed: this.pollsFailed,
      pollsEmpty: this.pollsEmpty,
    };
  }

  async stop() {
    await super.stop();
    if (this.timer) clearTimeout(this.timer);
  }
}
