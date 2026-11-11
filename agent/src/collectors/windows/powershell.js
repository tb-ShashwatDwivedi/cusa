import { WindowsEventChannelCollector } from './event-channel.js';

export class PowerShellCollector extends WindowsEventChannelCollector {
  constructor(config, state) {
    super(
      {
        ...config,
        // Classic "Windows PowerShell" logs the collector's own Get-WinEvent script (archive bloat).
        channels: ['Microsoft-Windows-PowerShell/Operational'],
      },
      state,
    );
    this.name = 'powershell';
  }
}
