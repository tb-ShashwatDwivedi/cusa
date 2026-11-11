/**
 * Wazuh protocol version selection.
 * @see docs/wazuh-compatibility.md
 */

/** @typedef {'4.x' | '4.11' | '5.x-released' | '5.x-https' | string} WazuhVersion */

/** Protocols that share the legacy TCP secure-message adapter (Wazuh 4.x + released 5.x). */
const LEGACY_VERSIONS = new Set(['4.x', '4.11', '5.x-released']);

/**
 * Normalize configured version to a protocol family.
 * @param {string} [version]
 * @returns {'4.x' | '5.x-released' | '5.x-https'}
 */
export function normalizeVersion(version) {
  if (!version) return '4.x';
  if (version === '5.x-https') return '5.x-https';
  if (version === '5.x-released') return '5.x-released';
  if (version === '4.x' || version.startsWith('4.')) return '4.x';
  throw new Error(`Unsupported wazuh.version: ${version}`);
}

/**
 * Resolve the adapter module path for a configured Wazuh version.
 * @param {WazuhVersion} version
 * @returns {'v4' | 'v5'}
 */
export function resolveAdapter(version) {
  const family = normalizeVersion(version);
  if (family === '4.x' || family === '5.x-released') return 'v4';
  if (family === '5.x-https') return 'v5';
  throw new Error(`Unsupported wazuh.version: ${version}`);
}

/**
 * Runtime profile for manager-specific wire behavior.
 * Wazuh Manager 4.11 uses legacy TCP + per-item `d:` state messages (not text sync sessions).
 * @param {WazuhVersion} version
 * @param {object} [enrollment]
 */
export function getProtocolProfile(version, enrollment = {}) {
  const family = normalizeVersion(version);
  const explicit = enrollment?.agentVersion;
  if (family === '4.x') {
    const patch = version?.match(/^4\.(\d+)/);
    const enrollVersion = explicit || (patch ? `Wazuh v4.${patch[1]}.2` : 'Wazuh v4.11.2');
    return {
      family,
      adapter: 'v4',
      syncMode: 'legacy',
      batchJson: false,
      enrollVersion,
      managerTarget: version?.startsWith('4.') ? version : '4.11',
    };
  }
  if (family === '5.x-released') {
    return {
      family,
      adapter: 'v4',
      syncMode: 'session',
      enrollVersion: explicit || 'Wazuh v4.11.2',
      managerTarget: '5.x-released',
    };
  }
  return {
    family: '5.x-https',
    adapter: 'v5',
    syncMode: 'session',
    enrollVersion: explicit || 'Wazuh v5.0.0',
    managerTarget: '5.x-https',
  };
}

/**
 * @param {WazuhVersion} version
 * @returns {boolean}
 */
export function isLegacyProtocol(version) {
  return normalizeVersion(version) === '4.x' || version === '5.x-released';
}

/**
 * @param {WazuhVersion} version
 * @returns {boolean}
 */
export function isHttpsProtocol(version) {
  return normalizeVersion(version) === '5.x-https';
}

export const SUPPORTED_VERSIONS = ['4.x', '4.11', '5.x-released', '5.x-https'];
