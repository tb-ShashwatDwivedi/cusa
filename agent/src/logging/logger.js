import pino from 'pino';

/** @param {object} [opts] */
export function createLogger(opts = {}) {
  return pino({
    name: 'cusa',
    level: opts.level || 'info',
    redact: ['*.password', '*.key', '*.token', '*.secret', 'authorization'],
  });
}
