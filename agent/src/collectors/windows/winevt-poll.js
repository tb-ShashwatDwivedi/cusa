/**
 * PowerShell poll script for Windows Event Log → Wazuh winevtchannel JSON.
 * Uses FormatDescription() (EvtFormatMessage equivalent); .Message is often empty in -NonInteractive.
 */

function escapeChannel(channel) {
  return String(channel).replace(/'/g, "''");
}

/** @param {string} channel */
export function buildSeedBookmarkCommand(channel) {
  const safe = escapeChannel(channel);
  return `
$ErrorActionPreference = 'SilentlyContinue'
$ev = Get-WinEvent -LogName '${safe}' -MaxEvents 1 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ev) { [int]$ev.RecordId }
`.trim();
}

/** @param {string} channel @param {number | undefined} bookmark @param {object} [config] */
export function buildPollCommand(channel, bookmark, config = {}) {
  const safe = escapeChannel(channel);
  const maxEvents = config.maxEventsPerPoll || 50;
  let filter;
  if (bookmark) {
    filter = `Get-WinEvent -LogName '${safe}' -FilterXPath '*[System[(EventRecordID > ${bookmark})]]' -MaxEvents ${maxEvents} -ErrorAction SilentlyContinue`;
  } else {
    filter = `Get-WinEvent -LogName '${safe}' -MaxEvents ${maxEvents} -ErrorAction SilentlyContinue`;
  }
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
