import { FileTailCollector } from '../common/file-tail.js';

const LINUX_LOGS = ['/var/log/syslog', '/var/log/messages', '/var/log/auth.log', '/var/log/secure'];

export class SyslogCollector extends FileTailCollector {
  constructor(config) {
    super({ ...config, paths: config.paths || LINUX_LOGS });
    this.name = 'syslog';
  }
}
