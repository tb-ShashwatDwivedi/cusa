import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateConfigSchema } from '../src/config/migrate.js';
import { createCollectors } from '../src/collectors/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, '../config/default.json');

describe('collector defaults', () => {
  it('default.json keeps optional Windows collectors off (memory-safe)', async () => {
    const cfg = JSON.parse(await readFile(defaultPath, 'utf8'));
    assert.equal(cfg.collectors.sysmon.enabled, false);
    assert.equal(cfg.collectors.defender.enabled, false);
    assert.equal(cfg.collectors.powershell.enabled, false);
    assert.equal(cfg.collectors.eventChannel.maxEventsPerPoll, 10);
    assert.deepEqual(cfg.locked, []);
  });

  it('schema v5 migration disables noisy optional collectors', () => {
    const next = migrateConfigSchema({
      schemaVersion: 4,
      collectors: { sysmon: { enabled: true }, eventChannel: { maxEventsPerPoll: 25, intervalMs: 15000 } },
    });
    assert.equal(next.schemaVersion, 5);
    assert.equal(next.collectors.sysmon.enabled, false);
    assert.equal(next.collectors.eventChannel.maxEventsPerPoll, 10);
  });

  it('registry includes sysmon on windows when not disabled', () => {
    const collectors = createCollectors(
      { collectors: { eventChannel: { enabled: true }, sysmon: {}, defender: {}, powershell: {} } },
      { getBookmark: () => null, setBookmark: () => {}, save: async () => {} },
    );
    const names = collectors.map((c) => c.name);
    if (process.platform === 'win32') {
      assert.ok(names.includes('sysmon'));
      assert.ok(names.includes('defender'));
      assert.ok(names.includes('powershell'));
    }
  });
});
