# Wazuh Compatibility Specification for CUSA

**Status:** Phase 0 — verified against official documentation and Wazuh source (October 2025)  
**Last reviewed:** 2025-10-05

This document defines the externally observable behavior CUSA must reproduce to interoperate with a Wazuh Manager. Every protocol claim is tagged with its evidence source.

---

## Executive Summary

Wazuh currently has **two distinct agent-manager protocols**:

| Profile | Config value | Manager compatibility | Transport | Status |
|---------|--------------|----------------------|-----------|--------|
| **Legacy (released)** | `4.x` or `5.x-released` | Wazuh Manager 4.x and **released** 5.x | TCP 1514 (encrypted) + TLS 1515 (enrollment) | Production |
| **HTTPS (developing)** | `5.x-https` | `5.0.0-https` branch only | HTTPS REST (HTTP/1.1 or HTTP/2) | **Not compatible with released Manager** |

> **Critical finding:** The `wazuh/wazuh-agent` repository `main` branch explicitly states it is *not compatible with the official release version of the Wazuh manager* ([wazuh-agent README](https://github.com/wazuh/wazuh-agent)). The HTTPS protocol lives on the Wazuh `5.0.0-https` development branch ([#37831](https://github.com/wazuh/wazuh/pull/38012), [#37733](https://github.com/wazuh/wazuh/issues/37733)).

### CUSA MVP Target Recommendation

For **immediate interoperability with production Wazuh/tbSIEM deployments**, CUSA Phase 1 should target:

```json
{
  "wazuh": {
    "version": "5.x-released",
    "manager": {
      "address": "<manager-ip>",
      "port": 1514,
      "enrollmentPort": 1515,
      "protocol": "tcp"
    }
  }
}
```

The `5.x-https` adapter should be architected but implemented only when the target Manager runs the HTTPS remoted module.

---

## 1. Which Wazuh Manager Version Is Being Targeted?

### Released protocol (`5.x-released` / `4.x`)

- **Evidence:** [Wazuh architecture docs](https://documentation.wazuh.com/current/getting-started/architecture.html), [message format](https://documentation.wazuh.com/current/development/message-format.html), [5.x migration guide](https://github.com/wazuh/wazuh/blob/04b678cb/docs/guide/migration/remote-agent-upgrade.md)
- Wazuh 5.x **released** agents use **TCP-only** on port 1514 (UDP deprecated for 5.x agents).
- Wazuh 4.x supports TCP (default) and optional UDP on 1514.
- Protocol semantics are identical between 4.x and released 5.x for secure messages.

### Developing HTTPS protocol (`5.x-https`)

- **Evidence:** [wazuh PR #38012](https://github.com/wazuh/wazuh/pull/38012), [issue #37733](https://github.com/wazuh/wazuh/issues/37733), [wazuh-agent issue #256](https://github.com/wazuh/wazuh-agent/issues/256)
- Uses HTTPS endpoints: `/security/user/authenticate`, `/agents`, `/control`, `/api/v1/events/stateless`, `/api/v1/events/stateful`, `/download`
- AES-CMAC request signing ([#37732](https://github.com/wazuh/wazuh/issues/37732))
- Bearer JWT authentication
- **Not accepted by released Manager**

---

## 2. Enrollment

### 2.1 Released protocol — TLS on port 1515 (authd)

**Source:** Official documentation + `src/os_auth/src/auth.c`, `src/os_auth/src/main-server.c`

| Aspect | Behavior |
|--------|----------|
| Transport | TLS over TCP, default port **1515** |
| Service | `wazuh-authd` (remote enrollment) |
| Initiator | Agent connects outbound to Manager |
| Request format | Text protocol prefixed with `OSSEC` |

**Enrollment request (agent → manager):**

```
OSSEC PASS: <password> OSSEC A:'<agent_name>' V:'<version>' G:'<groups>' IP:'<ip>'
```

- `OSSEC PASS:` prefix required only when `use_password` is enabled on manager
- `V:` agent version — optional but recommended
- `G:` comma-separated groups — optional
- `IP:` agent IP or `src` to use connection source IP — optional
- `K:'<sha1_of_existing_key>'` — optional, for re-enrollment

**Success response (manager → agent):**

```
OSSEC K:'<agent_id> <agent_name> <ip> <key>'
```

Example: `OSSEC K:'003 myagent 10.0.0.5 2801fb64625a4ca5523395d8ab7370dbed275a227688542493c6577c3d9fdf2c'`

**Failure response:**

```
ERROR: <reason>. Unable to add agent
```

**Framing:** Messages are length-prefixed (4-byte unsigned little-endian size prefix) over the TLS socket.  
**Source:** `tests/integration/test_authd/test_authd_local.py` (wazuh-qa) — `send(message, size=True)`

**TLS verification:**
- Manager presents `sslmanager.cert`
- Agent may verify with CA via `ssl_agent_ca` / enrollment password options
- **Source:** [Enrollment requirements](https://documentation.wazuh.com/current/user-manual/agent/agent-enrollment/requirements.html)

### 2.2 Alternative — Wazuh Server API (port 55000)

**Source:** [Enrollment via Manager API](https://documentation.wazuh.com/current/user-manual/agent/agent-enrollment/enrollment-methods/via-manager-API/index.html)

Manual enrollment flow (not automatic agent-initiated):

1. `POST /security/user/authenticate` → JWT (Basic auth)
2. `POST /agents` with `{"name":"<agent-name>"}` → returns agent ID and key
3. User imports key to agent `client.keys` file
4. Agent restarts and connects on 1514

CUSA may support this as an **operator-assisted** enrollment path but Phase 1 targets automatic authd enrollment.

### 2.3 HTTPS protocol enrollment (`5.x-https`)

**Source:** [wazuh-agent issue #256](https://github.com/wazuh/wazuh-agent/issues/256)

1. `POST /security/user/authenticate` — Basic auth, returns Bearer JWT
2. `POST /agents` — Bearer token, body includes agent UUID, name, 32-char key, type, version, groups, host metadata
3. 401 on any subsequent request triggers automatic re-enrollment

**User-Agent header required:**

```
WazuhXDR/<version> (Endpoint; <arch>; <platform>)
```

---

## 3. Agent Identity Requirements

### Released protocol

**Source:** `client.keys` file format — official documentation + source

After enrollment, agent stores identity in `client.keys`:

```
<ID> <Name> <IP> <Key>
```

| Field | Description |
|-------|-------------|
| ID | 3-digit zero-padded agent ID (e.g., `003`) |
| Name | Agent name from enrollment |
| IP | Registered IP or `any` |
| Key | 64-char hex shared secret (256-bit) |

Encryption key derivation (from enrolled values):

```
Key = MD5(<Pass>) + MD5(MD5(<Name>) + MD5(<ID>))[0:15]
```

**Source:** [Message format — Encryption system](https://documentation.wazuh.com/current/development/message-format.html)

### HTTPS protocol

**Source:** wazuh-agent issue #256

- Agent ID: UUID v4
- Agent name: string
- 32-character alphanumeric enrollment key
- Type: `Endpoint`
- Version: agent version string
- Groups: array of strings
- Host metadata: hostname, architecture, IP(s), OS name/type/version

---

## 4. Authentication Mechanism

### Released protocol

| Layer | Mechanism |
|-------|-----------|
| Enrollment | TLS (server cert verification optional via CA) + optional password |
| Data channel | AES-128-CBC (default) or Blowfish, keyed from `client.keys` |
| Message integrity | MD5 hash of plaintext block embedded before compression |
| Replay protection | Global + local message counters in header |

**Source:** [Message format](https://documentation.wazuh.com/current/development/message-format.html), `src/os_crypto/shared/msgs.c`

### HTTPS protocol

| Layer | Mechanism |
|-------|-----------|
| Transport | TLS (fail-closed, CA bundle required) |
| Request auth | Bearer JWT (short-lived) |
| Request signing | AES-CMAC per #37732 |
| Re-auth | 401 → automatic re-enrollment |

**Source:** [PR #38012](https://github.com/wazuh/wazuh/pull/38012)

---

## 5. Event Transport

### Released protocol

| Aspect | Value |
|--------|-------|
| Protocol | TCP (mandatory for 5.x agents) |
| Port | 1514 (configurable) |
| Direction | Agent initiates persistent outbound connection |
| Framing | 4-byte unsigned LE size + encrypted payload |
| Encryption prefix | `#AES:` (default) or `:` (Blowfish) |
| Multi-host agents | `!<agent_id>!#AES:<encrypted>` prefix |

**Source:** [Message format — Network protocol](https://documentation.wazuh.com/current/development/message-format.html)

### HTTPS protocol

| Aspect | Value |
|--------|-------|
| Stateless events | `POST /api/v1/events/stateless` |
| Stateful events | `POST /api/v1/events/stateful` |
| Body format | NDJSON (newline-delimited JSON), chunked transfer |
| Compression | gzip where required (verify against target manager) |

**Source:** [wazuh-agent issue #585](https://github.com/wazuh/wazuh-agent/issues/585), [issue #28970](https://github.com/wazuh/wazuh/issues/28970)

---

## 6. Event Framing

### Released protocol — Secure message construction

**Source:** Official documentation + `src/os_crypto/shared/msgs.c`

```
Step 1: Block = <Random_5digits><Global_10digits>:<Local_4digits>:<Event>
Step 2: Hash   = MD5(Block)           // 32 hex chars
Step 3: CData  = zlib_compress(Hash + Block)
Step 4: Pad    = 1..8 '!' chars so len(Pad + CData) % 8 == 0
Step 5: Enc    = AES_CBC(Pad + CData) // IV: FE DC BA 09 87 65 43 21
Step 6: Payload = "#AES:" + Enc       // or "!" + ID + "!#AES:" + Enc
Step 7: Send   = uint32_le(len(Payload)) + Payload
```

**Event content (plaintext `<Event>`)** follows local queue format before encryption:

```
<Queue>:<Location>:<Message>
```

| Queue | Purpose |
|-------|---------|
| `1` | Local file log, command output, integrations |
| `f` | Windows Event Channel |
| `8` | Syscheck (FIM) |
| `9` | Rootcheck |
| `p` | SCA (legacy queue; newer versions use state sync) |
| `d` | Syscollector inventory (legacy; newer uses state sync) |
| `u` | Upgrade notification |

**Source:** [Message format — Standard Wazuh event](https://documentation.wazuh.com/current/development/message-format.html)

### HTTPS protocol — NDJSON envelope

**Source:** wazuh-agent issue #585, issue #28970

Each POST body contains **multiple JSON lines**:

```
Line 1: {"agent": { ... agent metadata ... }}
Line 2: {"module": "<module>", "collector": "<collector>"}   // stateless
        OR {"id": "...", "module": "...", "operation": "create|update|delete"}  // stateful header
Line 3+: {"event": { ... }} OR state payload
```

**Required agent metadata fields (verified from issue #256, #585):**

```json
{
  "agent": {
    "id": "<uuid>",
    "name": "<name>",
    "type": "Endpoint",
    "version": "<agent-version>",
    "groups": ["<group>"],
    "host": {
      "hostname": "<hostname>",
      "architecture": "<arch>",
      "ip": ["<ip>"],
      "os": {
        "name": "<os-name>",
        "type": "<Linux|Windows|...>",
        "version": "<version>"
      }
    }
  }
}
```

**Stateless sub-header requires both `module` and `collector`** (engine rejects missing collector).  
**Source:** [issue #28970](https://github.com/wazuh/wazuh/issues/28970) — test evidence

---

## 7. Required Headers (HTTPS protocol)

**Source:** wazuh-agent issue #256, issue #585

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <jwt>` |
| `Content-Type` | `application/json` |
| `User-Agent` | `WazuhXDR/<version> (Endpoint; <arch>; <platform>)` |
| `Transfer-Encoding` | `chunked` (observed in test traffic) |

Stateful sync may additionally require `X-Session-Id` and CMAC signature headers per #37732 (verify against target manager build).

---

## 8. Stateless Event Message Structure

### Released protocol

Plaintext event before encryption:

```
1:<location>:<log_message>
```

Windows Event Channel:

```
f:<channel_name>:<json_or_xml_event>
```

**Source:** Wazuh logcollector documentation + message format queue types

### HTTPS protocol

Three-line NDJSON minimum:

```json
{"agent":{...}}
{"module":"logcollector","collector":"windows-security"}
{"event":{"created":"2025-10-05T12:00:00.000Z","original":"<raw log>"}}
```

For SCA stateless events, module=`sca`, collector required.  
**Source:** [issue #28970](https://github.com/wazuh/wazuh/issues/28970)

---

## 9. Stateful / Inventory Synchronization

### Released protocol — Sync protocol over agent socket

**Source:** `src/shared_modules/sync_protocol/include/iagent_sync_protocol.hpp`, [PR #31232](https://github.com/wazuh/wazuh/pull/31232), `syscollector.h`

Inventory, FIM, and SCA state use a **session-oriented sync protocol**, NOT ordinary log events.

**Message flow:**

```
Start → StartAck → Data* → End → EndAck
```

With `ReqRet` for missing chunks and retries on Start/End.

**Sync modes:**
- `MODE_DELTA` — send persisted differences
- `MODE_FULL` — full synchronization
- Metadata modes: `MetadataDelta`, `MetadataCheck`, `GroupDelta`, `GroupCheck` (Start → StartAck → End → EndAck, no Data)

**Inventory indices (syscollector):**

| Index name |
|------------|
| `wazuh-states-inventory-system` |
| `wazuh-states-inventory-hardware` |
| `wazuh-states-inventory-hotfixes` |
| `wazuh-states-inventory-packages` |
| `wazuh-states-inventory-processes` |
| `wazuh-states-inventory-ports` |
| `wazuh-states-inventory-interfaces` |
| `wazuh-states-inventory-protocols` |
| `wazuh-states-inventory-networks` |
| `wazuh-states-inventory-users` |
| `wazuh-states-inventory-groups` |
| `wazuh-states-inventory-services` |

**Transport:** Binary messages over the agent's message queue / Active Response socket path, wrapped in secure messages for network transit.  
**Source:** [PR #31461](https://github.com/wazuh/wazuh/pull/31461) — InventorySync over AR socket, remoted forwarding

**Critical:** Differences are cleared only after successful `EndAck`. Retries apply until acknowledged.

### HTTPS protocol

**Source:** issue #28970, wazuh-agent issues

- `POST /api/v1/events/stateful` with NDJSON
- Stateful header: `{"id":"<hash>","module":"<module>","operation":"create|update|delete"}`
- Separate from stateless path
- Session-oriented state sync may use `POST /stateful` with `X-Session-Id` (verify on target build)

---

## 10. Command / Control Message Structure

### Released protocol

**Source:** Wazuh remoted secure message handling, `remoted_sim.py` (wazuh-qa)

Commands arrive as encrypted secure messages from manager to agent. Agent must:
1. Decrypt incoming message
2. Detect control markers (e.g., `#!-req <counter> <command>`)
3. Respond with encrypted acknowledgment

Active response commands are delivered to `execd` queue.  
Upgrade commands use multi-step WPK transfer protocol over the same channel.

### HTTPS protocol — `/control` endpoint

**Source:** [issue #38021](https://github.com/wazuh/wazuh/issues/38021), [PR #38060](https://github.com/wazuh/wazuh/pull/38060)

**Agent → Manager messages:**

| Type | Purpose |
|------|---------|
| `startup` | Register connection, receive config hashes and pending tasks |
| `notify` | Keepalive; `settings_hash` mismatch triggers config refresh |
| `shutdown` | Graceful disconnect notification |

**Manager → Agent (in notify/startup response):**

```json
{
  "tasks": [
    {
      "task_id": "<uuid>",
      "type": "active_response|agent_restart|agent_reload|remote_upgrade",
      "payload": { ... }
    }
  ]
}
```

**Task delivery:** At-least-once; agent must deduplicate by `task_id` (durable, survives restart).  
**Source:** PR #38060

**Active response payload:** Pre-wrapped AR document forwarded unchanged to executor.  
**Source:** PR #38060 comment referencing #37733

---

## 11. Configuration Synchronization

### Released protocol

- Agent reads local `ossec.conf` / `agent.conf`
- Manager pushes merged config via `agent.conf` in shared configuration
- Agent requests config with `getconfig` control message
- Config changes trigger agent restart/reload

**Source:** Wazuh agent configuration documentation (inferred from agent behavior; verify against target deployment)

### HTTPS protocol

- `/control` startup/notify returns `settings_hash` and `config_hash`
- Hash mismatch on notify triggers config fetch
- Dedicated `/config` endpoint (per #37733 — verify schema on target build)

---

## 12. Acknowledgements

### Released protocol

- Secure messages include global/local counters for ordering
- Manager may send `#!-` prefixed messages requiring agent response
- Sync protocol: explicit `StartAck`, `EndAck`, `ReqRet` messages
- **Source:** `remoted_sim.py`, sync protocol PR #31232

### HTTPS protocol

- HTTP response status codes (200 = accepted)
- Sync session acknowledgements via protocol-specific messages
- Task delivery marked on manager after agent receives (manager-side state)

---

## 13. Retry Behavior

### Released protocol

- Agent maintains persistent TCP connection; reconnects on disconnect
- Message counters resume from stored state
- Sync protocol: configurable retries and timeout for Start/End messages
- **Source:** `wm_syscollector.c` — `sync_response_timeout`, `SYS_SYNC_RETRIES`

### HTTPS protocol

- libcurl transport with full-jitter exponential backoff
- 401 → single automatic re-enrollment attempt, then re-register
- **Source:** PR #38012

---

## 14. Connection Semantics

### Released protocol

| State | Behavior |
|-------|----------|
| Connect | Agent initiates TCP to manager:1514 |
| Connected | Persistent bidirectional socket |
| Disconnect | Agent reconnects with exponential backoff |
| Manager down | Agent queues events locally, retries connection |
| Agent restart | Counters restored from local state; reconnect |

### HTTPS protocol

| State | Behavior |
|-------|----------|
| Startup | POST /control `startup` → registered |
| Running | Periodic POST /control `notify` |
| Shutdown | POST /control `shutdown` + stateless shutdown event |
| 401 | Re-enroll + re-register |
| Manager down | Queue locally, retry with backoff |

---

## 15. Error Responses

### Released protocol (enrollment)

```
ERROR: Invalid password
ERROR: Invalid request for new agent
ERROR: Invalid agent name: <name>
ERROR: <reason>. Unable to add agent
```

**Source:** `src/os_auth/src/auth.c`, `main-server.c`

### HTTPS protocol

- HTTP 400 — invalid message/payload
- HTTP 401 — authentication failure → re-enroll
- HTTP 403 — authorization failure
- Structured error JSON (verify schema on target build)

---

## 16. Protocol Version Behavior

| Feature | 4.x | 5.x released | 5.x-https (dev) |
|---------|-----|--------------|-----------------|
| Transport | TCP/UDP 1514 | TCP-only 1514 | HTTPS |
| Enrollment | TLS 1515 | TLS 1515 | POST /agents |
| Event format | Encrypted secure msg | Same | NDJSON REST |
| Inventory | Sync protocol + legacy queue `d` | Sync protocol | POST /stateful |
| Commands | Encrypted control msgs | Same | /control tasks |
| Agent ID | 3-digit numeric | Same | UUID |
| Auth | Shared key + AES | Same | JWT + CMAC |

CUSA maps these via `agent/src/wazuh/version.js`:

```js
// version.js selects adapter: v4 (legacy) or v5 (https-dev)
```

---

## 17. Manager Expectations

The Manager expects agents to:

1. **Enroll** and obtain a unique ID + key before sending data
2. **Maintain** a persistent connection (TCP) or control-plane heartbeat (HTTPS)
3. **Encrypt** all data messages with the derived key (legacy)
4. **Include** correct queue type and location in events (legacy)
5. **Synchronize** inventory/FIM/SCA state via sync protocol, not as plain logs
6. **Respond** to active response and control commands
7. **Report** agent version and platform during enrollment
8. **Use TCP** for all 5.x agent connections

**Source:** Official documentation, migration guide, architecture docs

---

## 18. Inventory / State Synchronization Requirements

CUSA must:

1. Collect inventory into internal models (see `docs/event-schema.md`)
2. Persist scan results and compute deltas
3. Use sync protocol (legacy) or stateful API (HTTPS) — **never** serialize full inventory as queue-type `1` log events
4. Wait for scan completion before first sync
5. Support delta and full sync modes
6. Handle `ReqRet` retransmission
7. Clear persisted differences only after `EndAck`

**Source:** `wm_syscollector.c`, sync protocol interface, PR #31232

---

## 19. Active Response / Control Expectations

### Released protocol

- Manager sends AR command via remoted
- Agent `execd` executes allowlisted scripts
- Command format: JSON active response document
- Never arbitrary shell execution

### HTTPS protocol

- Task type `active_response` with pre-wrapped payload
- Task types: `agent_restart`, `agent_reload`, `remote_upgrade`
- Durable task_id deduplication required

CUSA active response must use allowlisted actions only (see `docs/security-model.md`).

---

## 20. Update / Download Behavior

### Released protocol

- WPK file transfer over secure message channel
- Multi-step: lock → open → write → close → verify SHA1 → upgrade command
- Agent notifies via queue type `u`
- **Source:** Migration guide, `remoted_sim.py`

### HTTPS protocol

- `remote_upgrade` task via /control
- Download via `GET /download` with chunked transfer
- SHA1 verification before install
- Fire-and-forget (no multi-step ack protocol)
- **Source:** PR #38060, PR #38012

---

## Evidence Classification Summary

| Category | Count | Notes |
|----------|-------|-------|
| Official documentation | High confidence | Message format, enrollment requirements, architecture |
| Wazuh source code | High confidence | authd, msgs.c, sync protocol, syscollector |
| GitHub issues/PRs (HTTPS) | Medium confidence | Developing protocol; may change before release |
| Test cases (wazuh-qa) | High confidence | remoted_sim.py, authd integration tests |
| Inferred | Low — flagged below | Config push details, exact HTTPS header names beyond samples |

### Items requiring validation against target Manager

- [ ] Exact HTTPS CMAC header names and algorithm parameters
- [ ] `/config` endpoint request/response schema
- [ ] `/stateful` session sync wire format on HTTPS branch
- [ ] gzip requirement on HTTPS event POST
- [ ] Manager config push mechanism for legacy protocol in target deployment
- [ ] Exact FlatBuffers schema for sync protocol binary messages

---

## CUSA Implementation Mapping

```
agent/src/wazuh/
├── version.js          # Protocol selector
├── client.js           # WazuhClient facade
├── v4/                 # Released 4.x/5.x TCP protocol
│   ├── enrollment.js
│   ├── secure-message.js
│   ├── transport.js
│   ├── event-serializer.js
│   ├── sync-protocol.js
│   └── commands.js
└── v5/                 # Developing HTTPS protocol
    ├── enrollment.js
    ├── transport.js
    ├── event-serializer.js
    ├── control.js
    ├── state-sync.js
    └── commands.js
```

Phase 1 implements `v4/` (released protocol) for production interoperability.  
`v5/` stubs reference this document and track the HTTPS branch.
