/** Wazuh-safe FIM events (queue 1). Native syscheck queue 8 needs stock JSON + location syscheck. @see docs/rules_decoder.md §7 */

/** @param {object} item */
export function fimItemToIngestEvent(item) {
  const path = item.data?.path || '';
  const type =
    item.operation === 'delete' ? 'deletion'
      : item.operation === 'create' ? 'addition'
        : 'modification';
  return {
    source: {
      platform: process.platform === 'win32' ? 'windows' : 'linux',
      collector: 'agent',
      channel: 'cusa-fim',
    },
    event: { category: 'file', type: 'change', action: item.operation },
    raw: JSON.stringify({
      source: 'cusa_fim',
      path,
      type,
      size: item.data?.size,
      sha256: item.data?.sha256,
      mode: item.data?.mode,
    }),
  };
}

/** @param {object} item */
export function registryItemToIngestEvent(item) {
  const key = item.data?.key || '';
  return {
    source: {
      platform: 'windows',
      collector: 'agent',
      channel: 'cusa-registry',
    },
    event: { category: 'configuration', type: 'change', action: item.operation },
    raw: JSON.stringify({ source: 'cusa_registry', key, type: 'modification' }),
  };
}

/** @param {object} payload state-queue item */
export function isLegacySyscheckState(payload) {
  const index = payload?.index || '';
  return index.includes('fim') || index.includes('registry');
}
