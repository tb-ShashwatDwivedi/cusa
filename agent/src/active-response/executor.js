import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAllowed } from './allowlist.js';

const execFileAsync = promisify(execFile);

export class ActiveResponseExecutor {
  /** @param {object} opts */
  constructor(opts) {
    this.scripts = opts.scripts || {};
    this.onRestart = opts.onRestart;
    this.onReload = opts.onReload;
  }

  /** @param {object} command */
  async execute(command) {
    const action = command.action || command.type;
    if (!isAllowed(action)) {
      return { success: false, error: `Action not allowed: ${action}` };
    }

    switch (action) {
      case 'terminate_process':
        return this.terminateProcess(command.pid);
      case 'block_ip':
        return this.blockIp(command.ip);
      case 'approved_script':
        return this.runScript(command.scriptId);
      case 'restart_agent':
        this.onRestart?.();
        return { success: true, message: 'Restart scheduled' };
      case 'reload_config':
        await this.onReload?.();
        return { success: true, message: 'Config reloaded' };
      default:
        return { success: false, error: 'Unknown action' };
    }
  }

  async terminateProcess(pid) {
    if (!pid || pid < 1) return { success: false, error: 'Invalid PID' };
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return { success: true, pid };
  }

  async blockIp(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { success: false, error: 'Invalid IP' };
    if (process.platform === 'win32') {
      await execFileAsync('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=CUSA-Block-${ip}`, 'dir=in', 'action=block', `remoteip=${ip}`]);
    } else {
      await execFileAsync('iptables', ['-A', 'INPUT', '-s', ip, '-j', 'DROP']);
    }
    return { success: true, ip };
  }

  async runScript(scriptId) {
    const meta = this.scripts[scriptId];
    if (!meta?.path) return { success: false, error: 'Script not registered' };
    const content = await readFile(meta.path);
    const hash = createHash('sha256').update(content).digest('hex');
    if (meta.sha256 && meta.sha256 !== hash) return { success: false, error: 'Script hash mismatch' };
    await execFileAsync(meta.path, meta.args || [], { timeout: 30000 });
    return { success: true, scriptId };
  }
}
