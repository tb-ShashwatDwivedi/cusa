import pino from 'pino';
import { eventLog } from './event-log.js';
import { createFileLogStream, closeFileLogStream } from './file-log.js';
import { istTimestamp } from './ist.js';

let fileStream = null;

/** @param {object} [opts] */
export async function initFileLogging(logsDir) {
  fileStream = await createFileLogStream(logsDir);
  return fileStream;
}

export function shutdownFileLogging() {
  closeFileLogStream();
  fileStream = null;
}

/** @param {object} [opts] */
export function createLogger(opts = {}) {
  const logSink = {
    write(chunk) {
      eventLog.fromPinoLine(chunk.toString());
    },
  };

  const streams = [
    { stream: process.stdout },
    { stream: logSink, level: 'debug' },
  ];
  if (fileStream) {
    streams.push({ stream: fileStream, level: opts.fileLevel || 'info' });
  }

  return pino(
    {
      name: 'cusa',
      level: opts.level || 'info',
      timestamp: () => `,"time":"${istTimestamp()}"`,
      redact: ['*.password', '*.key', '*.token', '*.secret', 'authorization'],
    },
    pino.multistream(streams),
  );
}
