/**
 * Endpoint log filter engine.
 * Precedence: explicit rules in order (first match wins for include/exclude),
 * then defaultAction (default: include).
 */

/** @param {object} event canonical event */
function ruleMatches(rule, event) {
  const src = event.source || {};
  const ev = event.event || {};
  const collector = src.collector || '';
  const channel = src.channel || '';
  const sourceKey = rule.source || rule.collector;
  if (sourceKey) {
    const want = String(sourceKey).toLowerCase();
    const hay = `${collector}:${channel}`.toLowerCase();
    if (!hay.includes(want) && collector.toLowerCase() !== want) return false;
  }
  if (rule.channel && channel !== rule.channel) return false;
  if (rule.provider && ev.provider !== rule.provider) return false;
  if (rule.eventIds?.length) {
    const id = ev.eventId ?? ev.event_id ?? ev.id;
    if (!rule.eventIds.includes(Number(id))) return false;
  }
  if (rule.severity != null && ev.severity !== rule.severity) return false;
  if (rule.messageContains) {
    const msg = String(ev.message || event.raw || '');
    if (!msg.toLowerCase().includes(String(rule.messageContains).toLowerCase())) return false;
  }
  if (rule.messageRegex) {
    try {
      if (!new RegExp(rule.messageRegex).test(String(ev.message || event.raw || ''))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} event
 * @param {{ filters?: object[], defaultAction?: 'include'|'exclude' }} config
 * @returns {{ allow: boolean, matchedRule?: object }}
 */
export function applyEventFilters(event, config = {}) {
  const rules = config.filters || [];
  const defaultAction = config.defaultAction || 'include';
  for (const rule of rules) {
    if (!ruleMatches(rule, event)) continue;
    const action = rule.action === 'exclude' ? 'exclude' : 'include';
    return { allow: action === 'include', matchedRule: rule };
  }
  return { allow: defaultAction === 'include' };
}
