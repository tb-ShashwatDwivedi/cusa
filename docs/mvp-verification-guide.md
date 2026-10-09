# CUSA MVP — 40-point verification guide

How to verify each MVP feature through the **GUI**, the **local agent API**, **on-disk state**, and (where required) **Wazuh Manager 4.11.2**.

**Target manager:** Wazuh **4.11.2** (v4 TCP on **1514**, enrollment **1515**, optional API **55000**).

**Matrix reference:** [architecture.md — MVP feature matrix](architecture.md#mvp-feature-matrix-40-point-checklist).

---

## Before you start

### Run the stack (development)

| Step | Command | Notes |
|------|---------|--------|
| Agent | `npm run agent` (repo root) or `cd agent && npm start` | Binds API on `127.0.0.1:8710` by default |
| GUI | `npm run gui:dev` or `npm run tauri:dev` | Talks to `http://127.0.0.1:8710` |
| Tests | `npm test` | Automated regression (not a substitute for E2E with a real manager) |

### Run the stack (production)

| Step | Reference |
|------|-----------|
| MSI install + `CUSAAgent` service | [BUILD.md](BUILD.md) |
| Data root | `C:\ProgramData\CUSA` (MSI) or `%USERPROFILE%\.cusa` (dev `npm start`) |

### Local API

- **Base URL:** `http://127.0.0.1:8710` (loopback only).
- **Read endpoints:** no token required from localhost.
- **Mutations** (`PATCH /api/config`, `POST /api/service/*`, `POST /api/queue/clear`, `POST /api/decommission/purge`): use `Authorization: Bearer <token>` from `GET /api/status` → `localApiToken`.

Example (PowerShell):

```powershell
$base = 'http://127.0.0.1:8710'
$status = Invoke-RestMethod "$base/api/status"
$token = $status.localApiToken
Invoke-RestMethod "$base/api/health"
```

### GUI map

| GUI page | Route | Primary APIs |
|----------|-------|----------------|
| Dashboard | `/` | `/api/status`, `/api/health`, `/api/queue`, `/api/service` |
| Collectors | `/collectors` | `/api/collectors` |
| Configuration | `/configuration` | `/api/config`, `PATCH /api/config` |
| FIM | `/fim` | `/api/fim` |
| Compliance | `/compliance` | `/api/compliance` |
| Logs | `/logs` | `/api/logs` |
| Diagnostics | `/diagnostics` | `/api/diagnostics` |
| Decommission | `/decommission` | `POST /api/decommission/purge` |

Top bar (all pages): enrollment pill, **Manager connected / disconnected**, service running.

### Wazuh Manager checks

Use your manager UI or API to confirm events, syscollector state, and agent list. Agent ID and connectivity should match **Dashboard** enrollment block.

---

## Verification checklist (40 features)

For each item: **GUI** = what to look at in the desktop/web UI; **API / agent** = local verification; **Manager / OS** = external proof.

---

### 1. Agent installation & service

| Where | What to verify |
|-------|----------------|
| **GUI** | Dashboard → service controls (Start / Stop / Restart); top bar **Service running**. |
| **API** | `GET /api/service` → `state`, `processRunning`. |
| **OS** | `Get-Service CUSAAgent` (MSI); service supervises `cusa-agent.exe` under Program Files. |
| **Agent** | Second `npm start` should exit: duplicate instance lock (`agent.pid` under data root). |
| **Linux** | Unit file: `installer/linux/cusa-agent.service` (manual install). |

**Pass criteria:** Service starts without interactive login; agent API responds; only one agent process per data dir.

---

### 2. Agent enrollment

| Where | What to verify |
|-------|----------------|
| **GUI** | Top bar enrollment pill → **enrolled**; agent ID shown. Configuration → manager address/port. |
| **API** | `GET /api/status` → `enrollment`, `agentId`, `manager`. |
| **Logs** | Logs page → filter **agent** → messages like “Enrolled via authd” or “Enrolled via Wazuh API”. |
| **Disk** | `{dataDir}/secrets/secrets.enc` (encrypted identity). |
| **Manager** | Agent appears in Wazuh agents list; key from port **1515** or API enrollment. |

**Pass criteria:** Restart agent → same agent ID (no unnecessary re-enroll).

---

### 3. Endpoint identification

| Where | What to verify |
|-------|----------------|
| **API** | `GET /api/diagnostics` or collect an event → `host.ip`, `host.mac`, `hostname`, `machine_id` on enriched events. |
| **Logs** | Logs → **collected** → preview/metadata after ingestion. |
| **Code path** | `identity/endpoint-identity.js` + `pipeline/enrich.js`. |

**Pass criteria:** IPs/MACs stable across events without per-event network scans (cached ~5 min).

---

### 4. Agent heartbeat

| Where | What to verify |
|-------|----------------|
| **GUI** | Dashboard → **Manager connected** when TCP up. |
| **API** | `GET /api/status` → `transportConnected`, `lastSync`, `configVersion`. |
| **Manager** | Agent stays **Active**; keepalive on 1514 (Wazuh remoted). |

**Pass criteria:** Heartbeat failures do not crash the agent (disconnect manager → agent stays up, queue grows).

---

### 5. Secure communication

| Where | What to verify |
|-------|----------------|
| **API** | `GET /api/health` → transport connected only after enrollment. |
| **Manager** | Encrypted payloads on 1514 (not plaintext events). |
| **Config** | `wazuh.enrollment` — API TLS `insecure` only for lab; production should use proper CA where configured. |

**Pass criteria:** No events sent without enrollment key; secrets not in `/api/config` (redacted enrollment).

---

### 6. Central configuration (Wazuh `agent.conf`)

| Where | What to verify |
|-------|----------------|
| **Setup** | Place Wazuh-style XML at `{dataDir}/manager/agent.conf` (see [central-config test](../agent/tests/central-config.test.js)). |
| **GUI** | Logs → **agent** → “Configuration reloaded” after change; Collectors/FIM/Compliance reflect new settings. |
| **API** | `GET /api/health` → `components.configuration` → `HEALTHY` or `DEGRADED`. |
| **Timing** | Sync on start + every **5 minutes**, or restart agent after file drop. |

**Pass criteria:** Invalid `agent.conf` rejected; last known good config retained (`configuration` **DEGRADED** in diagnostics).

**Note:** Live push from manager over 1514 (full Wazuh shared config) is not the same as file drop — see [architecture.md](architecture.md).

---

### 7. Windows event log collection

| Where | What to verify |
|-------|----------------|
| **GUI** | Configuration → enable **Windows event channel**; Collectors → `event-channel` running. |
| **API** | `GET /api/collectors` → event-channel `status`. |
| **Logs** | **collected** entries with `event-channel` / Security, System, Application. |
| **Manager** | `eventchannel` / Windows events visible for the agent. |

**Pass criteria:** Bookmarks advance (no full-channel replay); restart agent → resume from bookmark (`state.json` → `bookmarks`).

---

### 8. Linux log collection

| Where | What to verify |
|-------|----------------|
| **GUI** | Configuration → journald, syslog, auditd toggles; Collectors page statuses. |
| **API** | `GET /api/collectors` on Linux host. |
| **Logs** | Collected events from `journald`, `syslog`, or `auditd`. |

**Pass criteria:** Cursor/offset persisted in `state.json` after restart.

---

### 9. Custom log file monitoring

| Where | What to verify |
|-------|----------------|
| **GUI** | Configuration → extend config via patch for `collectors.fileTail` (paths + enabled) if not in form — use API patch or `config.local.json`. |
| **API** | `PATCH /api/config` with `collectors.fileTail.enabled` and `paths`. |
| **Test** | Append a line to monitored file → **collected** in Logs. |

**Pass criteria:** Tail uses read stream (no full-file load); rotation handled via inode/position in state.

---

### 10. Log filtering

| Where | What to verify |
|-------|----------------|
| **API** | `PATCH /api/config` → `filters.filters` array (include/exclude by source, eventIds, etc.). |
| **Logs** | Events matching exclude rules absent from **collected**; bookmarks still advance for filtered channel. |
| **Tests** | `agent/tests/filter.test.js`. |

Example patch:

```json
{
  "patch": {
    "filters": {
      "defaultAction": "include",
      "filters": [
        { "action": "exclude", "source": "event-channel", "eventIds": [7036] }
      ]
    }
  }
}
```

---

### 11. Security event collection

| Where | What to verify |
|-------|----------------|
| **GUI** | Event channel enabled; on Linux auditd enabled. |
| **Logs** | Security-relevant **collected** events (Windows Security channel, Linux auditd). |
| **Manager** | Auth / security events indexed for agent. |

---

### 12. File integrity monitoring (FIM)

| Where | What to verify |
|-------|----------------|
| **GUI** | Configuration → **FIM paths**; FIM page → path count / baseline sample. |
| **API** | `GET /api/fim` → `paths`, `count`, `baseline` (paginated). |
| **Test** | Modify file under watched path → state/event queued. |

**Pass criteria:** Only configured paths monitored (not whole disk).

---

### 13. FIM baseline

| Where | What to verify |
|-------|----------------|
| **GUI** | FIM page → baseline entries with hashes. |
| **Disk** | `{dataDir}/state/state.json` → `fimBaseline`. |
| **Manager** | FIM state sync via Wazuh state protocol. |

---

### 14. Registry monitoring (Windows)

| Where | What to verify |
|-------|----------------|
| **API** | `PATCH /api/config` → `registry.keys` array (HKLM/HKCU paths). |
| **GUI** | Collectors / logs after reload — registry watcher active. |
| **Disk** | `state.json` → `registryBaseline`. |

---

### 15. Rootkit / suspicious system check

| Where | What to verify |
|-------|----------------|
| **API** | `GET /api/diagnostics` → inspect `status` payload if exposed via state; or read `state.json` → `lastRootkitScan`. |
| **Logs** | **agent** / **collected** if scan returns WARN/FAIL. |
| **Schedule** | Daily job in agent (`rootkit-scan` scheduler). |

---

### 16. Security configuration assessment (SCA)

| Where | What to verify |
|-------|----------------|
| **GUI** | Configuration → **Compliance policy path**; Compliance page → last run / results. |
| **API** | `GET /api/compliance`. |
| **Disk** | Policy JSON file readable by agent; `state.json` → `lastCompliance`. |

---

### 17. System inventory

| Where | What to verify |
|-------|----------------|
| **GUI** | Dashboard → **last sync** updates after inventory interval. |
| **API** | `GET /api/status` → `lastSync`. |
| **Manager** | Syscollector system inventory for agent. |

---

### 18. Software inventory

| Where | What to verify |
|-------|----------------|
| **Manager** | Package inventory (Windows uninstall registry / dpkg or rpm). |
| **Agent** | Inventory scan on schedule (`inventory` interval in config). |

Verify after `lastSync` on manager syscollector packages.

---

### 19. Network inventory

| Where | What to verify |
|-------|----------------|
| **Manager** | Interfaces, routes, DNS-related state items. |
| **Agent** | `inventory/scanner.js` — routes/DNS on Windows; `ip route` on Linux. |

---

### 20. Process inventory

| Where | What to verify |
|-------|----------------|
| **Manager** | Process state snapshots / deltas. |
| **GUI** | Indirect: last sync time; Diagnostics for queue flush activity. |

---

### 21. Service inventory

| Where | What to verify |
|-------|----------------|
| **Manager** | Service inventory entries (Win32_Service / systemd). |
| **Windows** | PowerShell inventory during scheduled scan. |
| **Linux** | `systemctl list-units` during scan. |

---

### 22. User / group inventory

| Where | What to verify |
|-------|----------------|
| **Manager** | User/group state items. |
| **Agent** | No passwords in logs or state (grep logs for hash fields — should not appear). |

---

### 23. Listening port inventory

| Where | What to verify |
|-------|----------------|
| **Manager** | Port inventory on agent. |
| **Windows** | TCP connections inventory. |
| **Linux** | `ss -tunlp` parsing. |

---

### 24. Vulnerability detection input

| Where | What to verify |
|-------|----------------|
| **Manager** | Vulnerability module uses syscollector packages + **hotfixes** (Windows). |
| **Agent** | Hotfixes via `Win32_QuickFixEngineering` in inventory scan. |

CVE correlation stays on manager — agent only supplies inventory.

---

### 25. Compliance data to manager

| Where | What to verify |
|-------|----------------|
| **GUI** | Compliance page results. |
| **Manager** | SCA state with `policy_hash`, check results. |
| **API** | `GET /api/compliance` → `results` with policy metadata. |

---

### 26. Local event buffering

| Where | What to verify |
|-------|----------------|
| **GUI** | Dashboard → queue depth. |
| **API** | `GET /api/queue`; disconnect manager → depth increases; reconnect → drains. |
| **Disk** | `{dataDir}/queue/events/` → `spool.jsonl`, `pending.json`. |

**Pass criteria:** Survive agent restart with pending items still present.

---

### 27. Automatic reconnection

| Where | What to verify |
|-------|----------------|
| **GUI** | Disconnect manager → **Manager disconnected**; restore → **connected** without manual restart. |
| **API** | `transportConnected` flips; metrics stable. |
| **Logs** | Transport disconnect/connect messages. |

---

### 28. Event queue management

| Where | What to verify |
|-------|----------------|
| **GUI** | Configuration → queue memory/disk limits; Dashboard queue metrics. |
| **API** | `GET /api/diagnostics` → `queue` stats (`memoryItems`, `spoolBytes`, `dropped`, `oldestEventAt`). |
| **API** | `GET /api/metrics` → `queueDepth`, `queueDropped`, `memory`. |

---

### 29. Event metadata enrichment

| Where | What to verify |
|-------|----------------|
| **Logs** | Open a **collected** entry → metadata includes agent version, host IPs/MACs. |
| **Manager** | Events show agent name, IP fields as serialized by v4 adapter. |

---

### 30. Agent operational logs

| Where | What to verify |
|-------|----------------|
| **GUI** | Logs → categories **agent**, **system**, **collected**. |
| **Disk** | `{dataDir}/logs/agent/` (Pino file logs when configured). |
| **API** | `GET /api/logs?limit=100&category=agent`. |

**Pass criteria:** No client keys/passwords in log lines.

---

### 31. Agent health monitoring

| Where | What to verify |
|-------|----------------|
| **GUI** | Dashboard health summary; Diagnostics full payload. |
| **API** | `GET /api/health` → collectors, transport, queue, `components`. |
| **API** | `GET /api/metrics` → memory, handles, event loop. |

---

### 32. Remote restart / reload

| Where | What to verify |
|-------|----------------|
| **GUI** | Dashboard → **Restart** service button. |
| **API** | `POST /api/service/restart` (with token). |
| **Manager** | Send reload/restart via Wazuh command channel → Logs show command handling. |

Supported actions include `reload_config`, `restart_agent`, `restart_collectors` (allowlist).

---

### 33. CUSA agent upgrade

| Where | What to verify |
|-------|----------------|
| **Agent** | Manager `upgrade_agent` command with manifest → stages under `{dataDir}/updates/`. |
| **Config** | `updater.publicKeyPem` for signed manifests. |
| **Enterprise** | MSI upgrade path per [BUILD.md](BUILD.md). |

**Pass criteria:** Downgrade rejected; SHA-256 mismatch rejected; optional signature enforced when key configured.

---

### 34. Agent uninstall / decommission

| Where | What to verify |
|-------|----------------|
| **GUI** | Decommission → confirm `DECOMMISSION` → purge. |
| **API** | `POST /api/decommission/purge` with body `{ "confirm": "DECOMMISSION" }`. |
| **MSI** | Uninstall + optional `PURGE_DATA`. |

---

### 35. Active response framework

| Where | What to verify |
|-------|----------------|
| **Manager** | Only allowlisted actions executed. |
| **Logs** | Command received / executed / failed. |
| **Code** | `active-response/allowlist.js`, `executor.js`. |

Unknown actions return failure without shell execution.

---

### 36. Process termination

| Where | What to verify |
|-------|----------------|
| **Manager** | Command with `terminate_process` + valid PID. |
| **Safety** | Protected PIDs (agent PID, 0, 4) rejected. |

---

### 37. IP blocking

| Where | What to verify |
|-------|----------------|
| **Manager** | `block_ip` with valid IP/CIDR. |
| **OS** | Windows: `netsh` rule `CUSA-Block-*`; Linux: iptables rule. |

---

### 38. Custom response script

| Where | What to verify |
|-------|----------------|
| **Config** | `activeResponse.scripts` in effective config (via patch). |
| **Manager** | `approved_script` with registered `scriptId` and matching SHA-256. |

Hash mismatch must fail without execution.

---

### 39. Response audit logging

| Where | What to verify |
|-------|----------------|
| **Disk** | `{dataDir}/cache/audit/active-response.jsonl` — one JSON line per command. |
| **Fields** | `task_id`, `action`, timestamps, `status`, sanitized parameters. |

Not exposed in GUI today — verify on disk or add API later.

---

### 40. Tamper detection

| Where | What to verify |
|-------|----------------|
| **Logs** | **agent** → “Tamper detection” after binary/secrets change. |
| **Disk** | `{dataDir}/cache/tamper-trust.json` baseline. |
| **Test** | Touch watched path (lab copy of binary) → tamper event ingested. |

Agent must not exit on tamper alone.

---

## Automated tests (quick matrix)

| Area | Test files (agent) |
|------|---------------------|
| Config / patch | `tests/config-patch.test.js`, `tests/api-config-patch.test.js` |
| Enrollment | `tests/wazuh-enrollment-resilience.test.js`, `tests/enrollment-credentials.test.js` |
| Wazuh v4 wire | `tests/crypto.test.js`, `tests/sync-protocol.test.js`, `tests/winevt-format.test.js` |
| Queue / memory | `tests/queue-compact.test.js`, `tests/durable-queue-spool.test.js`, `tests/memory.test.js` |
| Filters / identity | `tests/filter.test.js`, `tests/identity.test.js` |
| Central config | `tests/central-config.test.js` |
| Inventory delta | `tests/inventory-delta.test.js` |

Run: `npm test` from repo root.

---

## End-to-end sign-off (Wazuh 4.11.2)

Recommended order for production acceptance:

1. Install MSI → service **Running** (feature **#1**).
2. Configure manager → enroll (**#2**, **#5**).
3. Confirm events and syscollector on manager (**#7–#8**, **#17–#25**).
4. Stop manager 10+ minutes → queue depth rises (**#26**); restore → drain (**#27**).
5. Drop `manager/agent.conf` → collector reload (**#6**).
6. Enable FIM/registry paths → verify GUI + manager (**#12–#14**).
7. Run `npm test` + document manager screenshots for audit.

---

## Related documentation

- [architecture.md](architecture.md) — MVP status and design
- [user-guide.md](user-guide.md) — GUI and API reference
- [BUILD.md](BUILD.md) — MSI and release validation
- [wazuh-compatibility.md](wazuh-compatibility.md) — Protocol notes for 4.x
