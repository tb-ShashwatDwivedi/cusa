import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const CURRENT_SCHEMA = 5;

/**
 * Migrate legacy flat ~/.cusa layout to structured ProgramData layout.
 * @param {import('../platform/paths.js').resolvePaths} paths factory result
 */
export async function migrateDataLayout(paths) {
  const legacy = [
    { from: join(paths.root, 'config.local.json'), to: paths.configLocal },
    { from: join(paths.root, 'secrets.enc'), to: paths.secrets },
    { from: join(paths.root, 'state.json'), to: paths.state },
  ];
  for (const { from, to } of legacy) {
    if (from === to) continue;
    try {
      await access(from);
      await access(to);
    } catch {
      try {
        await access(from);
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
      } catch {
        // nothing to migrate
      }
    }
  }
}

/**
 * @param {object} config
 * @returns {object}
 */
export function migrateConfigSchema(config) {
  let cur = { ...config };
  const version = cur.schemaVersion || 1;

  if (version < 2) {
    cur = { schemaVersion: 2, ...cur };
  }
  if (version < 3) {
    cur.schemaVersion = 3;
    if (!cur.agent?.dataDir && cur.dataDir) {
      cur.agent = { ...(cur.agent || {}), dataDir: cur.dataDir };
      delete cur.dataDir;
    }
  }
  if (version < 4) {
    cur.collectors = { ...(cur.collectors || {}) };
    for (const key of ['sysmon', 'defender', 'powershell']) {
      cur.collectors[key] = { ...(cur.collectors[key] || {}), enabled: true };
    }
    cur.schemaVersion = 4;
  }
  if (version < 5) {
    cur.collectors = { ...(cur.collectors || {}) };
    for (const key of ['sysmon', 'defender', 'powershell']) {
      cur.collectors[key] = { ...(cur.collectors[key] || {}), enabled: false };
    }
    const ec = cur.collectors.eventChannel || {};
    cur.collectors.eventChannel = {
      ...ec,
      intervalMs: ec.intervalMs && ec.intervalMs < 60000 ? 60000 : ec.intervalMs || 60000,
      maxEventsPerPoll: ec.maxEventsPerPoll && ec.maxEventsPerPoll > 10 ? 10 : ec.maxEventsPerPoll || 10,
    };
    cur.queue = {
      ...(cur.queue || {}),
      memoryLimit: Math.min(cur.queue?.memoryLimit ?? 120, 120),
      diskLimitMb: Math.min(cur.queue?.diskLimitMb ?? 64, 64),
      backpressureDepth: Math.min(cur.queue?.backpressureDepth ?? 150, 150),
      maxEventDepth: Math.min(cur.queue?.maxEventDepth ?? 800, 800),
      maxEventBatchSize: Math.min(cur.queue?.maxEventBatchSize ?? 40, 40),
      batchSize: Math.min(cur.queue?.batchSize ?? 40, 40),
    };
    cur.diagnostics = { memoryWarnRssMb: 384, ...(cur.diagnostics || {}) };
    cur.schemaVersion = 5;
  }
  cur.schemaVersion = CURRENT_SCHEMA;
  return cur;
}

/**
 * @param {string} configPath
 * @param {object} config
 */
export async function saveConfigWithBackup(configPath, config) {
  await mkdir(dirname(configPath), { recursive: true });
  try {
    await access(configPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(configPath, `${configPath}.bak-${stamp}`);
  } catch {
    // first write
  }
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

async function copyFile(src, dest) {
  const raw = await readFile(src, 'utf8');
  await writeFile(dest, raw);
}

export { CURRENT_SCHEMA };
