import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isPackagedAgent } from './paths.js';

const execFileAsync = promisify(execFile);
const SERVICE_NAME = 'CUSAAgent';

/** @returns {Promise<{ installed: boolean, state: string }>} */
export async function queryServiceState() {
  if (process.platform !== 'win32') {
    return { installed: false, state: 'unsupported' };
  }
  try {
    const { stdout } = await execFileAsync('sc.exe', ['query', SERVICE_NAME]);
    const match = stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
    return { installed: true, state: (match?.[1] || 'unknown').toLowerCase() };
  } catch {
    return { installed: false, state: 'not_installed' };
  }
}

/** @param {'start'|'stop'} action */
async function scControl(action) {
  await execFileAsync('sc.exe', [action, SERVICE_NAME]);
  return queryServiceState();
}

/** Restart via detached shell — agent process may exit before this returns. */
export async function restartWindowsService() {
  if (process.platform !== 'win32') throw new Error('Windows service control is only available on Windows');
  const script = `sc stop ${SERVICE_NAME} & ping -n 3 127.0.0.1 >nul & sc start ${SERVICE_NAME}`;
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return { ok: true, action: 'restart', mode: 'service' };
}

/**
 * @param {'start'|'stop'|'restart'} action
 * @param {{ onDevStop?: () => Promise<void> }} [opts]
 */
export async function controlService(action, opts = {}) {
  const svc = await queryServiceState();

  if (action === 'restart') {
    if (svc.installed && svc.state === 'running' && isPackagedAgent()) {
      return restartWindowsService();
    }
    if (opts.onDevStop) {
      await opts.onDevStop();
      return { ok: true, action: 'restart', mode: 'dev', message: 'Agent stopped; restart manually with npm start' };
    }
    if (svc.installed) {
      if (svc.state === 'running') return restartWindowsService();
      return { ok: true, ...(await scControl('start')), action: 'start', mode: 'service' };
    }
    throw new Error('CUSAAgent Windows service is not installed');
  }

  if (action === 'stop') {
    if (svc.installed && (svc.state === 'running' || svc.state === 'start_pending')) {
      return { ok: true, ...(await scControl('stop')), action: 'stop', mode: 'service' };
    }
    if (opts.onDevStop) {
      await opts.onDevStop();
      return { ok: true, action: 'stop', mode: 'dev' };
    }
    if (!svc.installed) throw new Error('CUSAAgent Windows service is not installed');
    return { ok: true, ...svc, action: 'stop', mode: 'service', message: 'Service already stopped' };
  }

  if (action === 'start') {
    if (!svc.installed) throw new Error('CUSAAgent Windows service is not installed');
    if (svc.state === 'running') {
      return { ok: true, ...svc, action: 'start', mode: 'service', message: 'Service already running' };
    }
    return { ok: true, ...(await scControl('start')), action: 'start', mode: 'service' };
  }

  throw new Error(`Unknown service action: ${action}`);
}
