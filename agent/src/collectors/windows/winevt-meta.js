/** Extract RecordId, Provider, EventID from Windows Event XML. */
export function parseWinevtXml(xml) {
  if (!xml || typeof xml !== 'string') return {};
  const recordId = xml.match(/<EventRecordID>(\d+)<\/EventRecordID>/i)?.[1];
  const provider = xml.match(/<Provider[^>]*Name="([^"]+)"/i)?.[1];
  const eventId = xml.match(/<EventID[^>]*>(\d+)<\/EventID>/i)?.[1];
  const channel = xml.match(/<Channel>([^<]+)<\/Channel>/i)?.[1];
  const computer = xml.match(/<Computer>([^<]+)<\/Computer>/i)?.[1];
  const created = xml.match(/SystemTime="([^"]+)"/i)?.[1];
  return {
    recordId: recordId ? Number(recordId) : undefined,
    provider,
    eventId: eventId ? Number(eventId) : undefined,
    channel,
    computer,
    timeCreated: created,
  };
}
