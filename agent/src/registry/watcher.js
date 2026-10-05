import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Windows registry key monitor (polling). ponytail: PowerShell query, not native RegNotify. */
export class RegistryWatcher {
  /** @param {object} config @param {import('../state/store.js').StateStore} state */
  constructor(config, state) {
    this.keys = config.keys || [];
    this.state = state;
    this.onChange = null;
    this.timer = null;
    this.running = false;
  }

  /** @param {(item: object) => void} fn */
  setHandler(fn) {
    this.onChange = fn;
  }

  async start() {
    if (process.platform !== 'win32') return;
    this.running = true;
    this.poll();
  }

  async poll() {
    if (!this.running) return;
    for (const key of this.keys) {
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-ItemProperty -Path 'Registry::${key}' -ErrorAction Stop | ConvertTo-Json -Compress)`,
        ], { timeout: 15000 });
        const hash = stdout.trim();
        const prev = this.state.data.registryBaseline?.[key];
        if (prev && prev !== hash) {
          this.onChange?.({
            id: `reg-${key}`,
            index: 'wazuh-states-registry',
            operation: 'update',
            timestamp: new Date().toISOString(),
            data: { key, snapshot: hash },
          });
        }
        if (!this.state.data.registryBaseline) this.state.data.registryBaseline = {};
        this.state.data.registryBaseline[key] = hash;
      } catch {
        // key inaccessible
      }
    }
    await this.state.save();
    this.timer = setTimeout(() => this.poll(), 60000);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
