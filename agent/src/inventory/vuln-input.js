import { readFile } from 'node:fs/promises';

/**
 * Optional agent-side CVE correlation (#24).
 *
 * Wazuh performs authoritative CVE correlation on the manager (vulnerability-detector),
 * so the agent's primary job is to supply complete package + hotfix inventory. This module
 * adds an OPTIONAL local correlation pass when the operator points `vulnerability.feedPath`
 * at a JSON CVE feed, giving on-box vulnerability findings without waiting on the manager.
 *
 * Feed format (array):
 *   [{ "cve": "CVE-2024-1234", "product": "openssl", "versionLt": "3.0.14",
 *      "versionGte": "3.0.0", "severity": "high" }, ...]
 * Matching is case-insensitive on product name; version bounds are optional.
 */

/** Numeric-aware version comparison (returns -1 / 0 / 1). */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/);
  const pb = String(b).split(/[.\-+]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = String(pa[i] ?? '').localeCompare(String(pb[i] ?? ''));
      if (cmp !== 0) return cmp < 0 ? -1 : 1;
      continue;
    }
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** @param {object} entry feed entry @param {string} version installed version */
function versionAffected(entry, version) {
  if (!version) return !entry.versionLt && !entry.versionGte;
  if (entry.versionGte && compareVersions(version, entry.versionGte) < 0) return false;
  if (entry.versionLt && compareVersions(version, entry.versionLt) >= 0) return false;
  if (entry.versionLte && compareVersions(version, entry.versionLte) > 0) return false;
  return true;
}

/**
 * Correlate installed packages against a CVE feed.
 * @param {Array<{name?:string,version?:string}>} packages
 * @param {Array<object>} feed
 * @returns {Array<object>} findings
 */
export function correlateVulnerabilities(packages, feed) {
  if (!Array.isArray(packages) || !Array.isArray(feed)) return [];
  const byProduct = new Map();
  for (const e of feed) {
    const key = String(e.product || '').toLowerCase();
    if (!key) continue;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(e);
  }
  const findings = [];
  for (const pkg of packages) {
    const name = String(pkg.name || pkg.data?.name || '').toLowerCase();
    const version = pkg.version || pkg.data?.version;
    if (!name) continue;
    for (const entry of byProduct.get(name) || []) {
      if (versionAffected(entry, version)) {
        findings.push({
          cve: entry.cve,
          product: pkg.name || pkg.data?.name,
          installed_version: version,
          severity: entry.severity || 'unknown',
          condition: { versionGte: entry.versionGte, versionLt: entry.versionLt, versionLte: entry.versionLte },
        });
      }
    }
  }
  return findings;
}

/** @param {string} feedPath */
export async function loadCveFeed(feedPath) {
  const raw = await readFile(feedPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.vulnerabilities || [];
}
