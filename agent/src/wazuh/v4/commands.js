/**
 * Parse inbound Wazuh manager control messages.
 * @see docs/wazuh-compatibility.md §10
 */

/** @param {string} text */
export function parseManagerCommand(text) {
  const trimmed = text.trim();
  const req = trimmed.match(/#!-req\s+(\d+)\s+(.+)/s);
  if (req) {
    const body = req[2].trim();
    const action = mapWazuhCommand(body);
    return { type: 'req', counter: Number(req[1]), command: body, action, taskId: req[1], raw: trimmed };
  }
  try {
    const json = JSON.parse(trimmed);
    const action = json.action || json.type || mapWazuhCommand(trimmed);
    return { type: 'json', action, taskId: json.taskId || json.task_id, ...json, raw: trimmed };
  } catch {
    return { type: 'raw', action: mapWazuhCommand(trimmed), raw: trimmed };
  }
}

/** @param {string} body */
function mapWazuhCommand(body) {
  const lower = body.toLowerCase();
  if (lower.includes('restart') || lower.includes('agent restart')) return 'restart_agent';
  if (lower.includes('reload') || lower.includes('config reload')) return 'reload_config';
  if (lower.includes('upgrade') || lower.includes('wpk')) return 'upgrade_agent';
  if (lower.includes('terminate') || lower.includes('kill')) return 'terminate_process';
  if (lower.includes('block') && lower.includes('ip')) return 'block_ip';
  return 'unknown';
}

/** @param {object} result */
export function formatCommandAck(result) {
  const counter = result.counter ?? result.taskId ?? 0;
  const payload = JSON.stringify({ success: result.success !== false, ...result });
  return `#!-agent ack ${counter} ${payload}`;
}
