import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAllowed, PROTECTED_PIDS } from './allowlist.js';

const execFileAsync = promisify(execFile);

export class ActiveResponseExecutor {
  /** @param {object} opts */
  constructor(opts) {
    this.scripts = opts.scripts || {};
    this.onRestart = opts.onRestart;
    this.onReload = opts.onReload;
    this.onRestartCollectors = opts.onRestartCollectors;
    this.protectedPids = new Set([...PROTECTED_PIDS, process.pid, ...(opts.protectedPids || [])]);
  }

  /** @param {object} command */
  async execute(command) {
    const action = command.action || command.type;
    const normalized = action === 'reload_configuration' ? 'reload_config' : action;
    if (!isAllowed(action)) {
      return { success: false, status: 'failed', error: `Action not allowed: ${action}` };
    }

    switch (normalized) {
      case 'terminate_process':
        return this.terminateProcess(command);
      case 'block_ip':
        return this.blockIp(command);
      case 'approved_script':
        return this.runScript(command);
      case 'restart_agent':
        this.onRestart?.();
        return { success: true, status: 'completed', message: 'Restart scheduled' };
      case 'reload_config':
        await this.onReload?.();
        return { success: true, status: 'completed', message: 'Config reloaded' };
      case 'restart_collectors':
        await this.onRestartCollectors?.();
        return { success: true, status: 'completed', message: 'Collectors restarted' };
      default:
        return { success: false, status: 'failed', error: 'Unknown action' };
    }
  }

  async terminateProcess(command) {
    const pid = Number(command.pid);
    if (!pid || pid < 1) return { success: false, status: 'failed', error: 'Invalid PID' };
    if (this.protectedPids.has(pid)) {
      return { success: false, status: 'failed', error: 'Protected PID' };
    }
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return { success: true, status: 'completed', pid, target: { pid } };
  }

  async blockIp(command) {
    const ip = command.ip;
    if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(ip)) {
      return { success: false, status: 'failed', error: 'Invalid IP or CIDR' };
    }
    if (process.platform === 'win32') {
      await execFileAsync('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        `name=CUSA-Block-${ip.replace('/', '-')}`,
        'dir=in', 'action=block', `remoteip=${ip}`,
      ]);
    } else {
      await execFileAsync('iptables', ['-A', 'INPUT', '-s', ip, '-j', 'DROP']);
    }
    return { success: true, status: 'completed', ip, target: { ip } };
  }

  async runScript(command) {
    const scriptId = command.scriptId;
    const meta = this.scripts[scriptId];
    if (!meta?.path) return { success: false, status: 'failed', error: 'Script not registered' };
    const content = await readFile(meta.path);
    const hash = createHash('sha256').update(content).digest('hex');
    if (meta.sha256 && meta.sha256 !== hash) {
      return { success: false, status: 'failed', error: 'Script hash mismatch', script_hash: hash };
    }
    const maxOut = meta.maxOutputBytes || 8192;
    const { stdout, stderr } = await execFileAsync(meta.path, meta.args || [], {
      timeout: meta.timeoutMs || 30000,
      maxBuffer: maxOut,
    });
    return {
      success: true,
      status: 'completed',
      scriptId,
      script_hash: hash,
      stdout: stdout?.slice(0, maxOut),
      stderr: stderr?.slice(0, maxOut),
    };
  }
}
