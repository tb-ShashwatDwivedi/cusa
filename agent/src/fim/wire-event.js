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

/**
 * Native Wazuh syscheck FIM event routed on queue 8 (location "syscheck"), so
 * stock FIM rules/dashboards in tbSIEM light up instead of treating FIM as custom
 * ingest. Enabled with `fim.native: true`. CYB-5996.
 * @param {object} item
 */
export function fimItemToSyscheckEvent(item) {
  const path = item.data?.path || '';
  const changeType =
    item.operation === 'delete' ? 'deleted'
      : item.operation === 'create' ? 'added'
        : 'modified';
  const attributes = {
    type: item.data?.mode === 'directory' ? 'registry_key' : 'file',
    size: item.data?.size,
    mtime: item.data?.mtime ? Math.floor(item.data.mtime / 1000) : undefined,
    hash_sha256: item.data?.sha256,
    checksum: item.data?.sha256,
  };
  return {
    source: {
      platform: process.platform === 'win32' ? 'windows' : 'linux',
      collector: 'fim',
      channel: 'syscheck',
    },
    event: { category: 'file', type: 'change', action: item.operation },
    raw: JSON.stringify({
      type: 'event',
      data: {
        path,
        mode: 'scheduled',
        type: changeType,
        timestamp: Math.floor(Date.now() / 1000),
        attributes,
      },
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
