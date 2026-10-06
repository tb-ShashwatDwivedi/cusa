import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const CURRENT_SCHEMA = 3;

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
