import pino from 'pino';
import { eventLog } from './event-log.js';

/** @param {object} [opts] */
export function createLogger(opts = {}) {
  const logSink = {
    write(chunk) {
      eventLog.fromPinoLine(chunk.toString());
    },
  };

  return pino(
    {
      name: 'cusa',
      level: opts.level || 'info',
      redact: ['*.password', '*.key', '*.token', '*.secret', 'authorization'],
    },
    pino.multistream([
      { stream: process.stdout },
      { stream: logSink, level: 'debug' },
    ]),
  );
}
