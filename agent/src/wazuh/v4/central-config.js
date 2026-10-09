import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateAgentConfig } from '../../config/validate-config.js';

/**
 * Parse minimal Wazuh 4.x agent.conf XML into a CUSA config patch.
 * Supports <localfile>, <wodle name="syscheck">, <sca> blocks.
 */
export function parseWazuhAgentConf(xml) {
  const patch = { collectors: {}, fim: { paths: [] }, compliance: {}, fileTail: { paths: [] } };
  const localFiles = xml.match(/<localfile>[\s\S]*?<\/localfile>/gi) || [];
  for (const block of localFiles) {
    const loc = block.match(/<location>([^<]+)<\/location>/i)?.[1]?.trim();
    const logFormat = block.match(/<log_format>([^<]+)<\/log_format>/i)?.[1]?.trim();
    if (!loc) continue;
    if (logFormat === 'eventchannel' || loc.includes('Event')) {
      const channel = loc.replace(/^eventchannel:/i, '').trim();
      patch.collectors.eventChannel = patch.collectors.eventChannel || { enabled: true, channels: [] };
      patch.collectors.eventChannel.channels = [...(patch.collectors.eventChannel.channels || []), channel];
    } else {
      patch.collectors.fileTail = patch.collectors.fileTail || { enabled: true, paths: [] };
      patch.collectors.fileTail.paths.push(loc);
    }
  }
  const dirs = xml.match(/<directories[^>]*>([^<]+)<\/directories>/gi) || [];
  for (const d of dirs) {
    const path = d.match(/<directories[^>]*>([^<]+)<\/directories>/i)?.[1]?.trim();
    if (path) patch.fim.paths.push(path);
  }
  const sca = xml.match(/<sca>[\s\S]*?<\/sca>/i)?.[0];
  if (sca) {
    const policy = sca.match(/<policy>([^<]+)<\/policy>/i)?.[1]?.trim();
    if (policy) patch.compliance.policyPath = policy;
  }
  return patch;
}

export function hashConfig(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

/**
 * @param {string} dataDir
 * @param {object} currentEffective
 */
export async function loadManagerAgentConf(dataDir) {
  const candidates = [
    join(dataDir, 'manager', 'agent.conf'),
    join(dataDir, 'manager', 'merged.mg'),
  ];
  for (const p of candidates) {
    try {
      const text = await readFile(p, 'utf8');
      return { path: p, text, patch: parseWazuhAgentConf(text) };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * @param {object} patch @param {object} current @param {string[]} locked
 */
export function mergeManagerPatch(current, patch, locked = []) {
  const next = structuredClone(current);
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'collectors' && v && typeof v === 'object') {
      next.collectors = { ...next.collectors, ...v };
    } else if (k === 'fim' && v?.paths?.length) {
      next.fim = { ...next.fim, paths: [...new Set([...(next.fim?.paths || []), ...v.paths])] };
    } else if (k === 'compliance' && v?.policyPath) {
      next.compliance = { ...next.compliance, policyPath: v.policyPath };
    }
  }
  return next;
}

/** @param {object} effective */
export function assertConfigValid(effective) {
  const v = validateAgentConfig(effective);
  if (!v.valid) throw new Error(`Invalid manager config: ${v.errors?.join('; ')}`);
}
