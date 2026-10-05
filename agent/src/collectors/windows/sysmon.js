import { WindowsEventChannelCollector } from './event-channel.js';

export class SysmonCollector extends WindowsEventChannelCollector {
  constructor(config, state) {
    super({ ...config, channels: ['Microsoft-Windows-Sysmon/Operational'] }, state);
    this.name = 'sysmon';
  }
}
