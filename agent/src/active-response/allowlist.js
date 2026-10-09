export const ALLOWED_ACTIONS = new Set([
  'terminate_process',
  'block_ip',
  'approved_script',
  'restart_agent',
  'reload_config',
  'reload_configuration',
  'restart_collectors',
]);

/** @param {string} action */
export function isAllowed(action) {
  if (action === 'reload_configuration') return true;
  return ALLOWED_ACTIONS.has(action);
}

export const PROTECTED_PIDS = new Set([0, 4]);
