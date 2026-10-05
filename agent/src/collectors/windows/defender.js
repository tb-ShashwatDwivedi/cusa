import { WindowsEventChannelCollector } from './event-channel.js';

export class DefenderCollector extends WindowsEventChannelCollector {
  constructor(config, state) {
    super(
      { ...config, channels: ['Microsoft-Windows-Windows Defender/Operational'] },
      state,
    );
    this.name = 'defender';
  }
}
