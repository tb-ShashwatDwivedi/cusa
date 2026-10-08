import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { istDateString } from './ist.js';

let stream = null;
let currentDay = '';
let disabled = false;
let warned = false;

function attachErrorHandler(ws) {
  ws.on('error', (err) => {
    if (!warned) {
      warned = true;
      console.warn(`[cusa] file logging disabled: ${err.message}`);
    }
    disabled = true;
    stream = null;
    currentDay = '';
  });
}

/**
 * Append-only JSONL agent log under dataDir/logs/agent.
 * ponytail: daily file rotation by IST date suffix; no size-based rotation yet.
 *
 * @param {string} logsDir e.g. C:\ProgramData\CUSA\logs\agent
 * @returns {import('node:stream').Writable | null}
 */
export async function createFileLogStream(logsDir) {
  if (!logsDir) return null;
  try {
    await mkdir(logsDir, { recursive: true });
  } catch (err) {
    console.warn(`[cusa] file logging disabled: ${err.message}`);
    disabled = true;
    return null;
  }
  return {
    write(chunk) {
      if (disabled) return;
      const day = istDateString();
      if (day !== currentDay || !stream) {
        stream?.end();
        currentDay = day;
        try {
          stream = createWriteStream(join(logsDir, `cusa-${day}.log`), { flags: 'a' });
          attachErrorHandler(stream);
        } catch (err) {
          if (!warned) {
            warned = true;
            console.warn(`[cusa] file logging disabled: ${err.message}`);
          }
          disabled = true;
          stream = null;
          return;
        }
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
  disabled = false;
  warned = false;
}
