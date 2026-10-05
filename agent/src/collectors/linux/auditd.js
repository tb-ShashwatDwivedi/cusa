import { FileTailCollector } from '../common/file-tail.js';

/** Linux auditd log collector via file tail. */
export class AuditdCollector extends FileTailCollector {
  constructor(config = {}) {
    super({
      paths: config.paths || ['/var/log/audit/audit.log'],
      intervalMs: config.intervalMs,
      ...config,
    });
    this.name = 'auditd';
  }

  emit(partial) {
    if (partial?.source) partial.source.collector = 'auditd';
    super.emit(partial);
  }
}
