import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

let stream = null;
let currentDay = '';

/**
 * Append-only JSONL agent log under ProgramData/logs/agent.
 * ponytail: daily file rotation by date suffix; no size-based rotation yet.
 *
 * @param {string} logsDir e.g. C:\ProgramData\CUSA\logs\agent
 * @returns {import('node:stream').Writable | null}
 */
export async function createFileLogStream(logsDir) {
  if (!logsDir) return null;
  await mkdir(logsDir, { recursive: true });
  return {
    write(chunk) {
      const day = new Date().toISOString().slice(0, 10);
      if (day !== currentDay || !stream) {
        stream?.end();
        currentDay = day;
        stream = createWriteStream(join(logsDir, `cusa-${day}.log`), { flags: 'a' });
      }
      stream.write(chunk);
    },
  };
}

/** Close open log stream (shutdown). */
export function closeFileLogStream() {
  stream?.end();
  stream = null;
  currentDay = '';
}
