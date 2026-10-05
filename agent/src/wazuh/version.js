/**
 * Wazuh protocol version selection.
 * @see docs/wazuh-compatibility.md
 */

/** @typedef {'4.x' | '5.x-released' | '5.x-https'} WazuhVersion */

/** Protocols that share the legacy TCP secure-message adapter. */
const LEGACY_VERSIONS = new Set(['4.x', '5.x-released']);

/**
 * Resolve the adapter module path for a configured Wazuh version.
 * @param {WazuhVersion} version
 * @returns {'v4' | 'v5'}
 */
export function resolveAdapter(version) {
  if (LEGACY_VERSIONS.has(version)) return 'v4';
  if (version === '5.x-https') return 'v5';
  throw new Error(`Unsupported wazuh.version: ${version}`);
}

/**
 * @param {WazuhVersion} version
 * @returns {boolean}
 */
export function isLegacyProtocol(version) {
  return LEGACY_VERSIONS.has(version);
}

/**
 * @param {WazuhVersion} version
 * @returns {boolean}
 */
export function isHttpsProtocol(version) {
  return version === '5.x-https';
}

export const SUPPORTED_VERSIONS = ['4.x', '5.x-released', '5.x-https'];
