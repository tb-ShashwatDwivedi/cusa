export const ALLOWED_ACTIONS = new Set([
  'terminate_process',
  'block_ip',
  'approved_script',
  'restart_agent',
  'reload_config',
]);

/** @param {string} action */
export function isAllowed(action) {
  return ALLOWED_ACTIONS.has(action);
}
