import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateAgentConfig } from '../../config/validate-config.js';

/**
 * Parse minimal Wazuh 4.x agent.conf XML into a CUSA config patch.
 * Supports <localfile>, <wodle name="syscheck">, <sca> blocks.
 */
export function parseWazuhAgentConf(xml) {
  const patch = { collectors: {}, fim: { paths: [] }, compliance: {}, fileTail: { paths: [] }, registry: { keys: [] } };
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
  // Windows registry monitoring from <syscheck><windows_registry>HKEY...</windows_registry>. CYB-6031/#14.
  const regEntries = xml.match(/<windows_registry[^>]*>([^<]+)<\/windows_registry>/gi) || [];
  for (const r of regEntries) {
    const key = r.match(/<windows_registry[^>]*>([^<]+)<\/windows_registry>/i)?.[1]?.trim();
    if (key) patch.registry.keys.push(key);
  }
  const sca = xml.match(/<sca>[\s\S]*?<\/sca>/i)?.[0];
  if (sca) {
    const policy = sca.match(/<policy>([^<]+)<\/policy>/i)?.[1]?.trim();
    if (policy) patch.compliance.policyPath = policy;
  }
  // Prune empty sections so a sparse agent.conf never overwrites existing local config
  // (e.g. a conf with no <directories> must not wipe locally-set fim.paths).
  if (!Object.keys(patch.collectors).length) delete patch.collectors;
  if (!patch.fim.paths.length) delete patch.fim;
  if (!patch.registry.keys.length) delete patch.registry;
  if (!patch.fileTail.paths.length) delete patch.fileTail;
  if (!Object.keys(patch.compliance).length) delete patch.compliance;
  return patch;
}

export function hashConfig(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

/**
 * Extract a single file's body from a Wazuh merged.mg bundle.
 * Format: optional "#merged ...\n" header, then repeated segments of
 * "!<byteLength> <filename>\n<content>". Returns the body or null if absent.
 * @param {string} merged @param {string} wanted
 */
export function extractMergedFile(merged, wanted) {
  if (!merged) return null;
  const lines = merged.split('\n');
  let i = 0;
  // Skip a leading "#merged ..." marker line if present.
  if (lines[0]?.startsWith('#')) i = 1;
  while (i < lines.length) {
    const header = lines[i];
    const m = header?.match(/^!(\d+)\s+(.+?)\s*$/);
    if (!m) {
      i += 1;
      continue;
    }
    const name = m[2].trim();
    // Content is the remaining lines until the next "!<len> <name>" header.
    const bodyLines = [];
    i += 1;
    while (i < lines.length && !/^!\d+\s+.+/.test(lines[i])) {
      bodyLines.push(lines[i]);
      i += 1;
    }
    if (name === wanted || name.endsWith(`/${wanted}`) || name.endsWith(`\\${wanted}`)) {
      return bodyLines.join('\n').replace(/\n$/, '');
    }
  }
  return null;
}

/**
 * @param {string} managerDir directory that holds agent.conf / merged.mg
 */
export async function loadManagerAgentConf(managerDir) {
  const candidates = [
    join(managerDir, 'agent.conf'),
    join(managerDir, 'merged.mg'),
  ];
  for (const p of candidates) {
    try {
      const text = await readFile(p, 'utf8');
      // When reading a merged.mg directly, unwrap the agent.conf segment first.
      const effective = p.endsWith('merged.mg')
        ? (extractMergedFile(text, 'agent.conf') ?? text)
        : text;
      return { path: p, text: effective, patch: parseWazuhAgentConf(effective) };
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
    } else if (k === 'registry' && v?.keys?.length) {
      next.registry = { ...next.registry, keys: [...new Set([...(next.registry?.keys || []), ...v.keys])] };
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
