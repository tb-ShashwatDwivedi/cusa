/** Drop events caused by CUSA's own Get-WinEvent poll scripts (feedback loop). */
export function isSelfCollectorWinevt(row) {
  const blob = `${row?.Message ?? ''}\n${row?.Event ?? ''}`;
  if (/Get-WinEvent\s+-LogName/i.test(blob)) return true;
  if (/HostApplication=.*Get-WinEvent/i.test(blob)) return true;
  return false;
}
