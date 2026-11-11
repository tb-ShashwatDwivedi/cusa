/**
 * Parse inbound Wazuh manager control messages.
 * @see docs/wazuh-compatibility.md §10
 */

/** Manager → agent control that must not be executed or echoed back. */
export function isInboundManagerControl(text) {
  const t = String(text).trim();
  if (/^#!-agent ack\b/.test(t)) return true;
  if (/^#!-up file\b/.test(t)) return true;
  if (/^#!-close file\b/.test(t)) return true;
  if (/^#!-agent error\b/.test(t)) return true;
  return false;
}

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
    // Stock Wazuh active-response wire format (4.2+): { version, origin, command, parameters }.
    // Previously these fell through to substring heuristics and became `unknown`. CYB-6106.
    if (json.command && json.parameters) {
      return { ...parseActiveResponse(json), raw: trimmed };
    }
    const action = json.action || json.type || mapWazuhCommand(trimmed);
    return { type: 'json', action, taskId: json.taskId || json.task_id, ...json, raw: trimmed };
  } catch {
    return { type: 'raw', action: mapWazuhCommand(trimmed), raw: trimmed };
  }
}

/**
 * Map a stock Wazuh AR JSON command to a CUSA executor action.
 * The command name carries a trailing 0 (add) / 1 (delete); alert data holds the target.
 * @param {object} json
 */
export function parseActiveResponse(json) {
  const rawName = String(json.command || '');
  const add = !rawName.endsWith('1');
  const name = rawName.replace(/[01]$/, '');
  const params = json.parameters || {};
  const alertData = params.alert?.data || {};
  const ip = alertData.srcip || alertData.src_ip || alertData.dstip || params.srcip;
  const pid = alertData.pid || alertData.process_id || params.pid;
  const taskId = json.taskId || json.task_id || params.task_id;

  const base = { type: 'ar', command: name, add, taskId, parameters: params };

  switch (name) {
    case 'firewall-drop':
    case 'host-deny':
    case 'npm-block':
    case 'win_firewall':
      return { ...base, action: 'block_ip', ip, remove: !add };
    case 'kill-process':
    case 'pid':
      return { ...base, action: 'terminate_process', pid: Number(pid) };
    case 'restart-wazuh':
    case 'restart':
      return { ...base, action: 'restart_agent' };
    default:
      // Operators register custom AR scripts under the command name (activeResponse.scripts).
      return { ...base, action: 'approved_script', scriptId: name };
  }
}

/** @param {string} body */
function mapWazuhCommand(body) {
  const lower = body.toLowerCase();
  if (lower.includes('restart') && lower.includes('collector')) return 'restart_collectors';
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
  // remoted save_controlmsg() requires a newline for non-startup control bodies.
  return `#!-agent ack ${counter} ${payload}\n`;
}
