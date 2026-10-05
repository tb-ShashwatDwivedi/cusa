# Wazuh Protocol Research Notes

**Purpose:** Raw research trail supporting `wazuh-compatibility.md`.  
**Date:** 2025-10-05

---

## Repositories Inspected

| Repository | Branch/Ref | Relevance | Compatibility Warning |
|------------|-----------|-----------|----------------------|
| [wazuh/wazuh](https://github.com/wazuh/wazuh) | `main`, `04b678cb`, `5.0.0-https` | Manager protocol, authd, remoted, sync | `5.0.0-https` is development only |
| [wazuh/wazuh-agent](https://github.com/wazuh/wazuh-agent) | `main` | New agent architecture reference | **Not compatible with released Manager** |
| [wazuh/wazuh-documentation](https://github.com/wazuh/wazuh-documentation) | current | Enrollment, architecture, message format | Production protocol |
| [wazuh/wazuh-qa](https://github.com/wazuh/wazuh-qa) | `9eba4fb7` | remoted_sim.py, authd tests | Test-verified behavior |

---

## Key Source Files (wazuh/wazuh)

### Enrollment (authd)

| File | What it defines |
|------|-----------------|
| `src/os_auth/src/auth.c` | `w_auth_parse_data()` — request parsing, password check |
| `src/os_auth/src/main-server.c` | Dispatcher, success `OSSEC K:` response |
| `src/os_auth/include/auth.h` | Port 1515, client struct, API signatures |

**Verified enrollment request grammar:**

```
[OSSEC PASS: <password> ]OSSEC A:'<name>'[ V:'<version>'][ G:'<groups>'][ IP:'<ip>'][ K:'<hash>']
```

**Verified success response:**

```
OSSEC K:'<id> <name> <ip> <64-char-hex-key>'
```

### Secure Messages (remoted)

| File | What it defines |
|------|-----------------|
| `src/os_crypto/shared/msgs.c` | `CreateSecMessage()` — encrypt, compress, counter management |
| `src/remoted/src/secure.c` | Receive side, router forwarding |

**Verified encryption pipeline:**

1. Block = `RRRRR GGGGGGGGGG:LLLL:Event` (5 + 10 + 4 digit counters)
2. MD5(block) prepended (32 hex chars)
3. zlib compress
4. Pad with `!` to multiple of 8
5. AES-CBC encrypt (IV: `FEDCBA0987654321`)
6. Prefix `#AES:` or `!ID!#AES:`
7. Prefix 4-byte LE length for TCP send

### State Sync

| File | What it defines |
|------|-----------------|
| `src/shared_modules/sync_protocol/include/iagent_sync_protocol.hpp` | Start/Data/End/ReqRet API |
| `src/wazuh_modules/syscollector/include/syscollector.h` | Inventory index names |
| `src/wazuh_modules/src/wm_syscollector.c` | Sync scheduling, scan-wait logic |

**Verified sync lifecycle:**

```
persistDifference() → synchronizeModule(MODE_DELTA)
  → Start → StartAck → Data* → End → EndAck
  → clear differences on EndAck OK
```

### Inventory Indices

From `syscollector.h`:

```
wazuh-states-inventory-system
wazuh-states-inventory-hardware
wazuh-states-inventory-hotfixes
wazuh-states-inventory-packages
wazuh-states-inventory-processes
wazuh-states-inventory-ports
wazuh-states-inventory-interfaces
wazuh-states-inventory-protocols
wazuh-states-inventory-networks
wazuh-states-inventory-users
wazuh-states-inventory-groups
wazuh-states-inventory-services
```

---

## HTTPS Protocol (5.0.0-https branch)

### Epic tracking

| Issue/PR | Topic |
|----------|-------|
| [#37733](https://github.com/wazuh/wazuh/issues/37733) | Protocol definition: /control, /config, /stats, /download |
| [#37732](https://github.com/wazuh/wazuh/issues/37732) | AES-CMAC transport auth |
| [#37831](https://github.com/wazuh/wazuh/pull/38012) | Agent HTTPS client foundation |
| [#37830](https://github.com/wazuh/wazuh/issues/37830) | Agent /control lifecycle |
| [#38021](https://github.com/wazuh/wazuh/issues/38021) | Manager /control endpoint |
| [#38060](https://github.com/wazuh/wazuh/pull/38060) | Task dispatch + remote upgrade |

### Endpoints (developing)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/security/user/authenticate` | POST | Obtain JWT |
| `/agents` | POST | Register agent |
| `/control` | POST | startup / notify / shutdown |
| `/api/v1/events/stateless` | POST | Stateless events (NDJSON) |
| `/api/v1/events/stateful` | POST | Stateful events (NDJSON) |
| `/download` | GET | WPK / file download |
| `/config` | GET | Configuration fetch (per #37733) |
| `/stats` | POST | Agent statistics (per #37733) |

### Stateless event example (from wazuh-agent #585)

```http
POST /api/v1/events/stateless HTTP/1.1
Host: localhost
User-Agent: WazuhXDR/5.0.0 (Endpoint; x86_64; Linux)
Accept: application/json
Authorization: Bearer <jwt>
Content-Type: application/json
Content-Length: 456

{"agent":{"groups":["validYaml"],"host":{"architecture":"x86_64","hostname":"dell","ip":["192.168.0.10"],"os":{"name":"Ubuntu","type":"Linux","version":"22.04.5 LTS"}},"id":"09f872dc-111b-4386-ac19-a5f8a76ef4d1","name":"dummy","type":"Endpoint","version":"5.0.0"}}
{"module":"agent","operation":"shutdown"}
{"event":{"created":"2025-02-19T20:25:46.807Z","original":"The agent is shutting down."}}
```

### Stateful SCA example (from wazuh #28970)

Header line:

```json
{"id":"6641e605a6c9c9484124496359fff9d14c0b68b7","module":"sca","operation":"create"}
```

Payload line:

```json
{"@timestamp":"2025-03-11T19:12:36.629Z","policy":{...},"check":{...}}
```

### Control startup response (from #38021)

```json
{
  "type": "startup",
  "settings_hash": "<sha256>",
  "config_hash": "<sha256>",
  "tasks": []
}
```

---

## wazuh-agent Architecture (reference only)

The new `wazuh-agent` repo describes these module boundaries:

| Module | Role |
|--------|------|
| Client | Manager communication |
| Queue | Persistent event buffering |
| Command Handler | Process manager commands |
| Collectors | Data collection (logcollector, syscollector, etc.) |
| Executors | Run active response actions |
| Configuration Parser | Parse and apply config |
| Task Manager | Schedule collection tasks |
| HTTP Client | HTTPS transport (new agent) |

CUSA mirrors these boundaries in JavaScript without porting C++ classes.

---

## Queue Type Reference (legacy local format)

From official message format documentation:

| Queue char | Module | CUSA collector mapping |
|------------|--------|----------------------|
| `1` | Logcollector | File logs, command output, integrations |
| `f` | Windows events | `collectors/windows/event-channel` |
| `8` | Syscheck/FIM | `fim/` |
| `9` | Rootcheck | (future) |
| `p` | SCA | `compliance/` (legacy path) |
| `d` | Syscollector | `inventory/` (legacy path) |
| `u` | Upgrade | `updater/` |

Modern Wazuh uses sync protocol for inventory, FIM, and SCA state instead of queue `d`, `8`, `p` for delta updates.

---

## Test References

### remoted_sim.py (wazuh-qa)

Confirms:
- `create_sec_message()` pipeline matches documentation
- Agent ID prefix parsing (`!003!`)
- `#AES` vs blowfish detection
- `#!-req` acknowledgment handling
- `upgrade_update_status` JSON parsing

### test_authd_local.py (wazuh-qa)

Confirms:
- Length-prefixed message framing on authd socket
- Expected response prefix matching

---

## Open Questions (validate before implementation)

1. **FlatBuffers schema** for sync protocol binary messages — need to extract from `sync_protocol` module
2. **Exact gzip** requirement on HTTPS event POST — observed in curl tests, not in formal spec
3. **CMAC header names** — referenced in #37732, exact header strings need extraction from source
4. **Config push** on legacy protocol — agent `getconfig` message format
5. **Keepalive interval** for HTTPS `/control` notify
6. **Maximum event size** before chunking on both protocols
7. **Whether released 5.x manager accepts queue `d` events** or requires sync protocol exclusively

---

## Version Decision Log

| Decision | Rationale |
|----------|-----------|
| Phase 1 targets `5.x-released` (legacy TCP) | Production Manager compatibility |
| `5.x-https` adapter stubbed, not implemented in Phase 1 | Not accepted by released Manager |
| `4.x` and `5.x-released` share same adapter (`v4/`) | Protocol identical for agent data plane |
| Config field `wazuh.version` is explicit | No silent version assumption |
