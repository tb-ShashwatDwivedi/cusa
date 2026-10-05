import { RingBuffer } from './ring-buffer.js';

const buffer = new RingBuffer(5000);

const PINO_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function previewRaw(raw, max = 200) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export const eventLog = {
  /** @param {string} message @param {object} [meta] @param {string} [level] */
  agent(message, meta = {}, level = 'info') {
    return buffer.push({ category: 'agent', level, message, meta });
  },

  /** @param {object} event */
  collected(event) {
    const source = event.source?.collector || 'unknown';
    const channel = event.source?.channel || event.source?.path || '';
    return buffer.push({
      category: 'collected',
      level: 'info',
      message: `${source}${channel ? `:${channel}` : ''}`,
      source,
      channel: channel || undefined,
      preview: previewRaw(event.raw),
      raw: event.raw,
      meta: {
        eventId: event.eventId,
        category: event.event?.category,
        action: event.event?.action,
      },
    });
  },

  /** @param {number} pinoLevel @param {string} message @param {object} [meta] */
  system(pinoLevel, message, meta = {}) {
    const level = PINO_LEVELS[pinoLevel] || 'info';
    return buffer.push({ category: 'system', level, message, meta });
  },

  /** @param {string} line */
  fromPinoLine(line) {
    try {
      const obj = JSON.parse(line);
      const msg = obj.msg || obj.message || '';
      if (!msg) return null;
      return this.system(obj.level ?? 30, msg, {
        ...obj,
        msg: undefined,
        message: undefined,
        time: obj.time,
      });
    } catch {
      return null;
    }
  },

  /** @param {{ category?: string, limit?: number, since?: string, search?: string }} opts */
  query(opts) {
    return buffer.query(opts);
  },

  /** @param {string} id */
  get(id) {
    return buffer.get(id);
  },
};
