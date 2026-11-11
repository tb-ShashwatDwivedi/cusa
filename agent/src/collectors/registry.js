import { FileTailCollector } from './common/file-tail.js';
import { WindowsEventChannelCollector } from './windows/event-channel.js';
import { SysmonCollector } from './windows/sysmon.js';
import { DefenderCollector } from './windows/defender.js';
import { PowerShellCollector } from './windows/powershell.js';
import { JournaldCollector } from './linux/journald.js';
import { SyslogCollector } from './linux/syslog.js';
import { AuditdCollector } from './linux/auditd.js';

/** @param {object} config @param {import('../state/store.js').StateStore} state */
export function createCollectors(config, state) {
  const collectors = [];
  const platform = process.platform === 'win32' ? 'windows' : 'linux';
  const cfg = config.collectors || {};

  if (platform === 'windows') {
    if (cfg.eventChannel?.enabled !== false) {
      collectors.push(new WindowsEventChannelCollector(cfg.eventChannel || {}, state));
    }
    if (cfg.sysmon?.enabled !== false) collectors.push(new SysmonCollector(cfg.sysmon || {}, state));
    if (cfg.defender?.enabled !== false) collectors.push(new DefenderCollector(cfg.defender || {}, state));
    if (cfg.powershell?.enabled !== false) collectors.push(new PowerShellCollector(cfg.powershell || {}, state));
  } else {
    if (cfg.journald?.enabled !== false) collectors.push(new JournaldCollector(cfg.journald || {}, state));
    if (cfg.syslog?.enabled !== false) collectors.push(new SyslogCollector(cfg.syslog || {}));
    if (cfg.auditd?.enabled !== false) collectors.push(new AuditdCollector(cfg.auditd || {}));
  }

  if (cfg.fileTail?.enabled && cfg.fileTail.paths?.length) {
    collectors.push(new FileTailCollector(cfg.fileTail));
  }

  return collectors;
}
