/**
 * PowerShell poll script for Windows Event Log → Wazuh winevtchannel JSON.
 * Uses FormatDescription() (EvtFormatMessage equivalent); .Message is often empty in -NonInteractive.
 */

/** @param {string} channel @param {number | undefined} bookmark */
export function buildPollCommand(channel, bookmark) {
  const filter = bookmark
    ? `Get-WinEvent -LogName '${channel}' -FilterXPath '*[System[(EventRecordID > ${bookmark})]]' -MaxEvents 50 -ErrorAction SilentlyContinue`
    : `Get-WinEvent -LogName '${channel}' -MaxEvents 50 -ErrorAction SilentlyContinue`;
  return `
$ErrorActionPreference = 'SilentlyContinue'
$events = @(${filter} | Sort-Object RecordId)
foreach ($ev in $events) {
  $msg = ''
  try { $msg = [string]$ev.FormatDescription() } catch {}
  if (-not $msg) { $msg = [string]$ev.Message }
  $obj = [ordered]@{
    RecordId = $ev.RecordId
    Id = $ev.Id
    Message = $msg
    Event = $ev.ToXml()
  }
  ($obj | ConvertTo-Json -Compress -Depth 4)
}
`.trim();
}
