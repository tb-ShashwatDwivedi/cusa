import { WindowsEventChannelCollector } from './event-channel.js';

export class PowerShellCollector extends WindowsEventChannelCollector {
  constructor(config, state) {
    super(
      {
        ...config,
        channels: [
          'Microsoft-Windows-PowerShell/Operational',
          'Windows PowerShell',
        ],
      },
      state,
    );
    this.name = 'powershell';
  }
}
