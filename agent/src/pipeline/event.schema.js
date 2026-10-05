/**
 * CUSA canonical event JSON Schema.
 * @see docs/event-schema.md
 */

export const eventSchema = {
  type: 'object',
  required: ['eventId', 'timestamp', 'collectedAt', 'source', 'event', 'raw'],
  properties: {
    eventId: { type: 'string' },
    agentId: { type: 'string' },
    timestamp: { type: 'string' },
    collectedAt: { type: 'string' },
    source: {
      type: 'object',
      required: ['platform', 'collector'],
      properties: {
        platform: { type: 'string' },
        collector: { type: 'string' },
        channel: { type: 'string' },
        path: { type: 'string' },
      },
    },
    host: { type: 'object' },
    event: {
      type: 'object',
      required: ['category'],
      properties: {
        category: { type: 'string' },
        type: { type: 'string' },
        action: { type: 'string' },
        severity: { type: ['integer', 'string'] },
      },
    },
    user: { type: 'object' },
    process: { type: 'object' },
    network: { type: 'object' },
    file: { type: 'object' },
    raw: { type: ['string', 'object'] },
    metadata: { type: 'object' },
  },
};
