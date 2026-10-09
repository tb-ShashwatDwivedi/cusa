import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

const configSchema = {
  type: 'object',
  properties: {
    queue: {
      type: 'object',
      properties: {
        memoryLimit: { type: 'integer', minimum: 10, maximum: 50000 },
        diskLimitMb: { type: 'integer', minimum: 1, maximum: 4096 },
        flushIntervalMs: { type: 'integer', minimum: 100 },
        maxRetries: { type: 'integer', minimum: 0, maximum: 100 },
        batchSize: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
    filters: {
      type: 'object',
      properties: {
        defaultAction: { enum: ['include', 'exclude'] },
        filters: { type: 'array', maxItems: 500 },
      },
    },
    inventory: {
      type: 'object',
      properties: {
        intervalMs: { type: 'integer', minimum: 60000 },
      },
    },
  },
};

const validate = ajv.compile(configSchema);

/** @param {object} config @returns {{ valid: boolean, errors?: string[] }} */
export function validateAgentConfig(config) {
  const ok = validate(config);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors || []).map((e) => `${e.instancePath} ${e.message}`),
  };
}
