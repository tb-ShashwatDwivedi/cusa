import https from 'node:https';

/**
 * Enroll via Wazuh Server API (port 55000).
 * @see https://documentation.wazuh.com/current/user-manual/agent/agent-enrollment/enrollment-methods/via-manager-API/
 */

/** @param {object} opts */
function apiRequest(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** @param {object} base @param {string} token @param {string} path */
async function apiGet(base, token, path) {
  return apiRequest({
    hostname: base.host,
    port: base.apiPort || 55000,
    path,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    rejectUnauthorized: base.insecure !== true,
  });
}

/** @param {object} item @param {string} agentName */
function parseIdentity(item, agentName) {
  if (!item?.id || !item?.key) return null;
  try {
    const decoded = Buffer.from(item.key, 'base64').toString('utf8').trim();
    const parts = decoded.split(/\s+/);
    if (parts.length >= 4) {
      return { id: parts[0], name: parts[1], ip: parts[2], key: parts[3] };
    }
  } catch {
    // not base64 — use raw key
  }
  return {
    id: String(item.id).padStart(3, '0'),
    name: item.name || agentName,
    ip: 'any',
    key: item.key,
  };
}

/** @param {object} base @param {string} token @param {string} agentId @param {string} group */
async function assignAgentGroup(base, token, agentId, group) {
  if (!group) return;
  const path = `/agents/${agentId}/group/${encodeURIComponent(group)}`;
  const res = await apiRequest({
    hostname: base.host,
    port: base.apiPort || 55000,
    path,
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    rejectUnauthorized: base.insecure !== true,
  });
  if (res.status !== 200) {
    throw new Error(`Assign group failed (${res.status}): ${res.body}`);
  }
}

/** @param {object} opts @param {string} token */
async function fetchExistingAgentKey(opts, token) {
  const search = await apiGet(opts, token, `/agents?search=${encodeURIComponent(opts.agentName)}`);
  if (search.status !== 200) return null;
  const searchJson = JSON.parse(search.body);
  const agent = searchJson.data?.affected_items?.find((a) => a.name === opts.agentName);
  if (!agent?.id) return null;

  const keyRes = await apiGet(opts, token, `/agents/${agent.id}/key`);
  if (keyRes.status !== 200) return null;
  const keyJson = JSON.parse(keyRes.body);
  const keyItem = keyJson.data?.affected_items?.[0];
  return parseIdentity({ id: agent.id, name: agent.name, key: keyItem?.key }, opts.agentName);
}

/** @param {object} opts */
export async function enrollViaApi(opts) {
  const auth = Buffer.from(`${opts.user}:${opts.password}`).toString('base64');
  const tls = { rejectUnauthorized: opts.insecure !== true };
  const base = { host: opts.host, apiPort: opts.apiPort, insecure: opts.insecure };

  const tokenRes = await apiRequest({
    hostname: opts.host,
    port: opts.apiPort || 55000,
    path: '/security/user/authenticate?raw=true',
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    ...tls,
  });
  if (tokenRes.status !== 200) {
    throw new Error(`API auth failed (${tokenRes.status}): ${tokenRes.body}`);
  }
  const token = tokenRes.body.trim();

  // Reuse existing agent if already registered
  const existing = await fetchExistingAgentKey({ ...base, agentName: opts.agentName }, token);
  if (existing) return existing;

  const agentBody = JSON.stringify({ name: opts.agentName });
  const agentRes = await apiRequest({
    hostname: opts.host,
    port: opts.apiPort || 55000,
    path: '/agents',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(agentBody),
    },
    body: agentBody,
    ...tls,
  });

  let agentJson;
  try {
    agentJson = JSON.parse(agentRes.body);
  } catch {
    throw new Error(`API enroll invalid JSON (${agentRes.status}): ${agentRes.body}`);
  }

  if (agentRes.status === 200) {
    const item = agentJson.data?.affected_items?.[0] || agentJson.data;
    const identity = parseIdentity(item, opts.agentName);
    if (identity) {
      const group = opts.groups?.split(',')[0]?.trim() || 'default';
      try {
        await assignAgentGroup(base, token, identity.id, group);
      } catch {
        // group may already be set; authd G:'default' is the fallback path
      }
      return identity;
    }
  }

  throw new Error(`API enroll failed (${agentRes.status}): ${agentRes.body}`);
}
