import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { eventSchema } from './event.schema.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(eventSchema);

/** @param {object} event */
export function validateEvent(event) {
  const ok = validate(event);
  if (!ok) {
    const msg = validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ');
    throw new Error(`Invalid event: ${msg}`);
  }
  return event;
}
