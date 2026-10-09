/**
 * Long-run memory sampling harness (run manually):
 *   node scripts/cusa-memory-test.mjs
 * Records RSS at startup and every 5 minutes for 2 hours (configurable).
 */
import { memorySnapshot } from '../src/core/memory.js';
import { writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const durationMin = Number(process.env.CUSA_MEM_TEST_MIN || 120);
const intervalMs = Number(process.env.CUSA_MEM_TEST_INTERVAL_MS || 5 * 60 * 1000);
const out = process.env.CUSA_MEM_TEST_OUT || join(process.cwd(), 'memory-benchmark.jsonl');

const samples = [];
const record = (label) => {
  const row = { label, at: new Date().toISOString(), ...memorySnapshot() };
  samples.push(row);
  return appendFile(out, JSON.stringify(row) + '\n');
};

await writeFile(out, '');
await record('0_min');
const end = Date.now() + durationMin * 60 * 1000;
const timer = setInterval(() => record('periodic'), intervalMs);
timer.unref?.();

while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, intervalMs));
}
clearInterval(timer);
await record('end');
console.log(`Wrote ${samples.length + 2} samples to ${out}`);
