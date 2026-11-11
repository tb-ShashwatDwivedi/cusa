/** Parse PowerShell ConvertTo-Json output (array, single object, or empty). */
export function parsePsJson(stdout) {
  const t = (stdout || '').trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t.startsWith('[') ? t : `[${t}]`);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}
