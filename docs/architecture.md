# CUSA Architecture

**CyberSIO Unified Security Agent** — lightweight endpoint security agent for CyberSIO/tbSIEM with Wazuh Manager compatibility.

**Product version:** 1.0.0 (agent `AGENT_VERSION`, root `package.json`, MSI).

---

## Design principle

Separate concerns. Collectors never know Wazuh wire format.

```
Collectors
    ↓
CUSA internal event/state models (pipeline + JSON Schema)
    ↓
Wazuh compatibility adapter (agent/src/wazuh/v4/)
    ↓
TCP :1514 (encrypted frames) + enrollment :1515 / API :55000
    ↓
Wazuh Manager (tbSIEM)
```

The **Tauri GUI** is a localhost control plane only. Collection, queues, secrets, and manager transport run in the **agent process**, supervised by a **Windows service** in production.

---

## Deployment modes

CUSA supports two primary runtimes on Windows. Linux agent code runs in **dev** (`npm start`); there is no Linux MSI or systemd package in this repo yet.

### Comparison

| Aspect | Development | Production (MSI) |
|--------|-------------|------------------|
| **Start agent** | `npm run agent` or `cd agent && npm start` | `CUSAAgent` Windows service |
| **Agent binary** | `node agent/src/bootstrap/main.js` | `cusa-agent.exe` (Node SEA bundle) |
| **Service wrapper** | None (foreground Node) | `cusa-service-host.exe` (Rust SCM) |
| **GUI** | `npm run gui:dev` / `npm run tauri:dev` | `CUSA.exe` under Program Files (full MSI) |
| **Data root** | `%USERPROFILE%\.cusa` | `C:\ProgramData\CUSA` (`.install-marker`) |
| **Config** | `agent/config/default.json` + `config.local.json` in repo + `~/.cusa/config/` | `deploy.json` (MSI) + `config.local.json` (GUI) |
| **Auto-start after reboot** | No | Yes (`CUSAAgent` service) |
| **Build** | None | `npm run build:release` → `dist/CUSA-x64-1.0.0.msi` |

Override data directory anytime: `CUSA_DATA_DIR`.

### Development flow

```
┌─────────────────────────────────────────────────────────────┐
│  Developer machine                                           │
│                                                              │
│  Terminal 1: npm run agent  →  node bootstrap/main.js      │
│  Terminal 2: npm run tauri:dev  →  Vite + Tauri shell        │
│                                                              │
│  Data: ~/.cusa/{config,state,secrets,queue,logs,...}         │
│  API:  http://127.0.0.1:8710  (loopback + optional token)    │
└─────────────────────────────────────────────────────────────┘
```

- Packaged path detection (`isPackagedAgent()`) is false, so **ProgramData is never used** even if an old MSI marker exists on the machine.
- Service control from the GUI/API uses **dev mode** for stop/restart (graceful `agent.stop()` + exit); `sc.exe` is used only when the service is installed and the agent runs as `cusa-agent.exe`.

### Production (MSI) flow

```
┌─────────────────────────────────────────────────────────────┐
│  Endpoint (Windows)                                          │
│                                                              │
│  ┌──────────────┐     spawns/supervises                      │
│  │ CUSAAgent    │────▶ cusa-agent.exe                       │
│  │ (SCM service)│     CUSA_DATA_DIR=C:\ProgramData\CUSA      │
│  └──────────────┘                                            │
│                                                              │
│  ┌──────────────┐     GET/PATCH http://127.0.0.1:8710         │
│  │ CUSA.exe     │──── (status, config, service, decommission)│
│  │ (optional)   │                                            │
│  └──────────────┘                                            │
│                                                              │
│  Program Files\CUSA\  agent\, gui\, updater\, installer\     │
│  ProgramData\CUSA\    config\, state\, secrets\, queue\, logs\│
└─────────────────────────────────────────────────────────────┘
                                      │ TCP 1514 (AES payloads)
                                      ▼
                            ┌─────────────────┐
                            │  Wazuh Manager  │
                            └─────────────────┘
```

**Install:** `msiexec /i dist\CUSA-x64-1.0.0.msi` with optional `MANAGER_ADDRESS`, `MANAGER_PORT`, `ENROLLMENT_PORT`, `LAUNCH_GUI`, `PURGE_DATA` (uninstall). See [BUILD.md](BUILD.md) and [enterprise-deployment.md](enterprise-deployment.md).

**Variants:** Full MSI (agent + GUI + shortcuts) vs agent-only (`SKIP_GUI=1` / `AGENT_ONLY=1` at build time).

**Release pipeline (root):**

```
npm run build:agent      → test + bundle cusa-agent.exe
npm run build:service    → cusa-service-host.exe
build-updater.js         → cusa-updater.exe (stub)
npm run build:gui        → CUSA.exe
stage-release.js         → build/
npm run build:msi        → dist/*.msi
npm run verify:release
```

---

## System context

```
┌─────────────────────────────────────────────────────────────┐
│                        Endpoint Host                         │
│                                                              │
│  ┌──────────┐    ┌─────────────────────────────────────┐   │
│  │ Tauri GUI│───▶│  Agent (Node / cusa-agent.exe)       │   │
│  │ (React)  │    │  bootstrap → core/agent.js             │   │
│  └──────────┘    │                                      │   │
│       │          │  Scheduler · Health · Metrics        │   │
│       ▼          │  Collectors → Pipeline → Queues      │   │
│  127.0.0.1:8710  │  FIM · Registry · Compliance         │   │
│                  │  Wazuh v4 adapter · Active response  │   │
│                  └──────────────────┬───────────────────┘   │
│                                     │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │ Manager TCP / enroll
                                      ▼
                            ┌─────────────────┐
                            │  Wazuh Manager  │
                            └─────────────────┘
```

---

## Configuration model

Layers merged into **effective config** (`agent/src/config/loader.js`):

| Layer | Source | Typical use |
|-------|--------|-------------|
| **Defaults** | `agent/config/default.json` | Built-in collector toggles, queue limits |
| **Deploy** | `config/deploy.json` (MSI seeds manager host/ports) | Enterprise push; locked manager fields |
| **Local** | `config/config.local.json` under data root | GUI **Configuration** page |
| **Fixed enrollment** | `wazuh/enrollment-defaults.js` | Normalized groups/credentials shape |

Flow for local/GUI changes: validate → respect `locked` keys → save overlay → `reloadConfig()` (restarts collectors, reconnects transport). Manager change clears enrollment identity for re-enroll.

**Not yet implemented:** full Wazuh **agent.conf / merged.mg** pull from manager (keepalive sends placeholder `mergedMd5`).

---

## Module boundaries

### `agent/src/bootstrap/`

Entry: `main.js` — load config, file logging, `Agent.start()`, SIGINT/SIGTERM shutdown.

### `agent/src/core/`

| Module | Responsibility |
|--------|----------------|
| `agent.js` | Coordinator: collectors, Wazuh, queues, FIM, registry, compliance, API, tamper, updater |
| `scheduler.js` | Inventory, compliance, tamper intervals |
| `health.js` | Transport, collectors, queue aggregation |
| `metrics.js` | Counters, transport connected flag |

**Lifecycle (in `agent.js`):**

```
startup → secrets/API token → state → queues → wazuh.init → collectors
       → FIM/registry (if configured) → compliance load → queue flusher
       → tamper → scheduled tasks → local API → RUNNING

shutdown → stop collectors/FIM/registry → queue drain → wazuh close → API close → state save
```

### `agent/src/wazuh/`

| Area | Responsibility |
|------|----------------|
| `client.js` | Facade; selects v4 vs v5 adapter from config |
| `v4/client.js` | Enrollment, TCP transport, keepalive, send events/state, commands |
| `v4/crypto.js` | AES payload encryption |
| `v4/enrollment.js`, `api-enrollment.js` | Authd + REST enrollment paths |
| `v4/keepalive.js` | Periodic manager heartbeat (version, OS label) |
| `v4/event-serializer.js` | Canonical event → Wazuh plaintext line |
| `v4/sync-protocol.js` | Inventory/FIM/SCA state sync sessions |
| `v4/commands.js` | Inbound command parse/ack |
| `v4/transport.js` | TCP connect, backoff reconnect |
| `v5/client.js` | HTTPS protocol (developing) |

### `agent/src/collectors/`

Platform collectors registered in `collectors/registry.js`:

| Platform | Collectors |
|----------|------------|
| **Windows** | Event channels (Security/System/Application, …), optional Sysmon, Defender, PowerShell operational |
| **Linux** | journald, syslog, auditd |
| **Both** | `file-tail` for configured log paths |

Contract: `collectors/interfaces/collector.js` — `start`, `stop`, `health`, bookmarks via `state/store.js`.

Windows events use PowerShell `Get-WinEvent` polling (`winevt-poll.js`, `winevt-format.js`) with per-channel bookmarks.

### `agent/src/pipeline/`

`normalize.js` + `validator.js` + `event.schema.js` (Ajv) → canonical events with host/agent metadata.

### `agent/src/queue/`

`queue-manager.js` + `durable-queue.js` (JSONL spool under data root):

| Queue | Contents |
|-------|----------|
| `events` | Log/security events |
| `state` | Inventory, FIM, registry, SCA payloads |
| `commands` | Inbound manager commands (persisted before execute) |
| `command-results` | Outbound command responses |

Bounded memory, disk limits, retry/requeue, drain on shutdown.

### `agent/src/inventory/`

`scanner.js` — system, packages, processes, interfaces, listening ports (Windows); `delta.js` — sync diffs to state queue.

### `agent/src/fim/` and `agent/src/registry/`

File integrity (`watcher.js` — baseline hashes in state) and Windows registry watches (`registry/watcher.js`).

### `agent/src/compliance/`

`engine.js` — policy-driven SCA checks; results to state queue and compliance events.

### `agent/src/active-response/`

`allowlist.js` + `executor.js` — terminate process, block IP, approved script hash, restart/reload agent.

### `agent/src/updater/`

`updater.js` — download manifest, SHA-256 verify, stage to `updates/` (apply via restart; MSI is primary upgrade path).

### `agent/src/security/`

DPAPI-backed secrets, API token for mutating local API, tamper hashes on agent binary + secrets store.

### `agent/src/platform/`

`paths.js` — dev vs ProgramData resolution; `deploy.js` — MSI deploy overlay; `service-control.js` — `sc.exe` + dev stop; `decommission.js` — purge ProgramData.

### `agent/src/api/`

Fastify on `127.0.0.1:8710` — loopback enforcement, CORS for Tauri/Vite, token on PATCH/POST mutations.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/status` | Agent summary, enrollment, metrics |
| `GET /api/health`, `/api/metrics`, `/api/collectors` | Operations |
| `GET /api/config`, `PATCH /api/config` | Effective config (token) |
| `GET /api/queue`, `POST /api/queue/clear` | Queue depth / clear (token) |
| `GET /api/logs`, `/api/logs/:id` | Ring-buffer operational log |
| `GET /api/fim`, `/api/compliance`, `/api/diagnostics` | Feature visibility |
| `GET /api/service`, `POST /api/service/:action` | Windows service state/control (token) |
| `POST /api/decommission/purge` | Controlled data purge (token + confirm) |

### `agent/src/state/` and `agent/src/logging/`

Durable `state.json` (bookmarks, enrollment, FIM baseline, task dedup). Pino + rotating file logs under `logs/agent/` when data paths are initialized; in-memory `event-log` for GUI.

### `service-host/` (Rust)

Windows Service Control Manager wrapper: registers `CUSAAgent`, spawns `cusa-agent.exe` with `CUSA_DATA_DIR=C:\ProgramData\CUSA`, supervises child process.

### `gui/` + `src-tauri/`

React dashboard: Dashboard, Collectors, Configuration, FIM, Compliance, Logs, Diagnostics, Decommission.

### `installer/wix/`

WiX 4 MSI — files, service install, custom actions (ProgramData init, deploy.json), shortcuts (full build).

---

## Data flows

### Events

```
Windows Event Log / journald / syslog / auditd / file tail
    ↓
collectors/*
    ↓
pipeline/normalize.js + validator
    ↓
queue/events
    ↓
wazuh/v4/event-serializer.js → encrypt → transport → Manager:1514
```

### Inventory / FIM / SCA state

```
inventory/scanner.js or fim/registry/compliance
    ↓
queue/state
    ↓
wazuh/v4/sync-protocol.js
    ↓
transport → Manager
```

### Commands

```
Manager → transport → v4/client onManagerMessage
    ↓
queue/commands (persist)
    ↓
active-response/executor.js
    ↓
queue/command-results → transport
```

---

## Technology stack

| Component | Technology |
|-----------|------------|
| Agent runtime | Node.js ≥ 20, ESM, JavaScript |
| Agent packaging | esbuild + postject → `cusa-agent.exe` |
| Service host | Rust (`windows-service`) |
| GUI | Tauri 2 + React + Vite |
| Validation | JSON Schema + Ajv |
| Logging | Pino + daily files under ProgramData |
| Local API | Fastify |
| Queue | JSONL durable spool (per-queue directories) |
| MSI | WiX Toolset 4 |
| Tests | Node.js built-in test runner |

`wazuh.version` default `4.11` in `default.json`. v5 HTTPS adapter exists but is not the default production path.

---

## Resource constraints

- Bounded memory and disk queue (`queue.memoryLimit`, `queue.diskLimitMb`)
- Event batching in flusher (50 events / 100 state items per tick)
- Async I/O; collection via PowerShell/OS APIs and file tail
- Wazuh message size cap (`message-limit.js`)

---

## Current product features (implemented in repo)

1. Wazuh 4.x TCP enrollment (authd + API fallback), encrypted event transport, keepalive.
2. Durable multi-queue buffering with reconnect and retry.
3. Windows Security/System/Application event channels (incremental bookmarks).
4. Optional Windows Sysmon, Defender, PowerShell collectors.
5. Linux journald, syslog, auditd collectors.
6. Optional custom log file tailing.
7. JSON-schema validated internal events with agent/host enrichment.
8. Scheduled system/package/process/interface/(Windows) port inventory with delta sync.
9. Configurable FIM with SHA-256 baseline in state.
10. Configurable Windows registry monitoring.
11. SCA compliance engine with policy file and scheduled runs.
12. Active response: kill process, firewall block, approved scripts, restart/reload.
13. Manager command channel with deduplicated task IDs and result queue.
14. In-agent update staging from signed manifest (SHA-256); MSI upgrade for deployments.
15. Tamper detection on agent binary and secrets path.
16. Localhost API + GUI: status, config patch, logs, diagnostics, service control, decommission.
17. MSI install: service, ProgramData layout, deploy.json, uninstall/repair, optional GUI.
18. Secrets encryption (DPAPI on Windows), local API token for writes.
19. Decommission purge (GUI or API) and `PURGE_DATA` on MSI uninstall.

---

## MVP feature matrix (40-point checklist)

Legend:

| Status | Meaning |
|--------|---------|
| **Full** | Implemented end-to-end for typical deployment |
| **Partial** | Core capability exists; needs config, platform scope, or follow-up hardening |
| **None** | Not implemented |

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 1 | Agent installation & service | Must | **Partial** | Windows MSI + `CUSAAgent` service; dev is manual `npm start`; no Linux daemon package |
| 2 | Agent enrollment | Must | **Full** | Authd + API enrollment, identity in secrets store |
| 3 | Endpoint identification | Must | **Partial** | Hostname/OS/arch in events; IP/MAC lists not fully populated in pipeline |
| 4 | Agent heartbeat | Must | **Full** | `keepalive.js` over manager connection |
| 5 | Secure agent communication | Must | **Full** | v4 AES encrypted TCP payloads |
| 6 | Central configuration | Must | **Partial** | `deploy.json` + GUI local overlay; no full manager agent.conf sync |
| 7 | Windows event log collection | Must | **Full** | Configurable channels, bookmarks |
| 8 | Linux log collection | Must | **Full** | journald, syslog, auditd |
| 9 | Custom log file monitoring | Must | **Partial** | `fileTail` when enabled with paths |
| 10 | Log filtering | Must | **Partial** | Incremental bookmark / record ID only; no rule engine for ID/severity |
| 11 | Security event collection | Must | **Full** | Security channel + auditd |
| 12 | File integrity monitoring | Must | **Partial** | Requires `fim.paths` configuration |
| 13 | FIM baseline | Must | **Full** | Hashes/metadata in `state.fimBaseline` |
| 14 | Registry monitoring (Windows) | Must | **Partial** | Requires `registry.keys` configuration |
| 15 | Rootkit / suspicious system check | Should | **None** | — |
| 16 | Security configuration assessment | Must | **Partial** | Engine present; requires `compliance.policyPath` |
| 17 | System inventory | Must | **Full** | CPU, memory, hostname, OS |
| 18 | Software inventory | Must | **Full** | Win32_Product / dpkg-query (platform limits) |
| 19 | Network inventory | Must | **Partial** | Interfaces; no route table collector |
| 20 | Process inventory | Must | **Full** | Scheduled scan |
| 21 | Service inventory | Must | **None** | — |
| 22 | User/group inventory | Should | **None** | — |
| 23 | Open port / listening inventory | Should | **Partial** | Windows `Get-NetTCPConnection` only |
| 24 | Vulnerability detection input | Must | **Partial** | Package inventory synced; CVE correlation is server-side |
| 25 | Policy/compliance data to tbSIEM | Must | **Partial** | Same as SCA when policy configured |
| 26 | Local event buffering | Must | **Full** | Durable queues |
| 27 | Automatic reconnection | Must | **Full** | TCP backoff in `transport.js` |
| 28 | Event queue management | Must | **Full** | Limits, retry, overflow via disk cap |
| 29 | Event metadata enrichment | Must | **Partial** | Agent ID, hostname, OS; weak IP/MAC enrichment |
| 30 | Agent logs | Must | **Full** | File logs + `/api/logs` + ring buffer |
| 31 | Agent health monitoring | Must | **Full** | Health monitor + API |
| 32 | Remote agent restart | Should | **Full** | Manager commands + `/api/service` + active response |
| 33 | Agent upgrade | Must | **Partial** | Manifest download/stage; MSI primary; no signed WPK auto-apply |
| 34 | Agent uninstall / decommission | Must | **Full** | MSI uninstall, purge, GUI decommission |
| 35 | Active response framework | Must | **Full** | Allowlisted executor |
| 36 | Process termination | Should | **Full** | `terminate_process` |
| 37 | IP blocking action | Should | **Full** | `netsh` / `iptables` |
| 38 | Custom response script | Should | **Full** | `approved_script` + SHA-256 |
| 39 | Response audit logging | Must | **Partial** | Results queued; limited requester/policy audit fields |
| 40 | Agent tamper detection | Should | **Partial** | Hash watch on binary + secrets |

### Coverage summary

| Metric | Count |
|--------|------:|
| **Full** | 20 / 40 |
| **Partial** | 17 / 40 |
| **None** | 3 / 40 |
| **At least Partial** (addressed in codebase) | **37 / 40** (92.5%) |

**Must-have rows only (32 items):** **16 Full**, **15 Partial**, **1 None** (service inventory #21) → **31 / 32** touched in code; **16 / 32** fully meet the MVP bar without gaps.

Gaps to close for a stricter MVP sign-off: manager-driven agent configuration (#6), rule-based log filtering (#10), service inventory (#21), complete endpoint network identity on every event (#3, #29), and production-grade in-place upgrade (#33).

---

## Implementation phases

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Research + docs + foundation | Complete |
| 1 | Wazuh enrollment + event send + sync | Complete |
| 2 | Durable queues | Complete |
| 3 | Windows collectors | Complete |
| 4 | Linux collectors | Complete |
| 5 | Inventory + delta | Complete |
| 6 | FIM + registry + compliance | Complete |
| 7 | Commands + active response | Complete |
| 8 | Updater + tamper | Complete (WPK/signature hardening TBD) |
| 9 | Tauri GUI + local API | Complete |
| 10 | Service host + WiX MSI + ProgramData | **Complete** (see [BUILD.md](BUILD.md)) |
| 10d | Signed updater, tray, dedicated service account | Planned / stub |

---

## Repository layout

```
cusa/
├── agent/
│   ├── config/                 # default.json, config.local.json (dev)
│   ├── src/
│   │   ├── bootstrap/
│   │   ├── core/
│   │   ├── config/
│   │   ├── collectors/{interfaces,windows,linux,common}/
│   │   ├── pipeline/
│   │   ├── queue/
│   │   ├── wazuh/{v4,v5,enrollment-defaults.js,client.js,version.js}
│   │   ├── inventory/
│   │   ├── fim/
│   │   ├── registry/
│   │   ├── compliance/
│   │   ├── active-response/
│   │   ├── updater/
│   │   ├── api/
│   │   ├── security/
│   │   ├── state/
│   │   ├── logging/
│   │   └── platform/
│   └── tests/
├── service-host/               # Rust Windows service
├── gui/
├── src-tauri/
├── installer/wix/              # MSI
├── installer/scripts/          # ProgramData init, purge
├── updater-stub/
├── scripts/                    # build-agent, release, stage, validate-msi
├── docs/
└── package.json                # build:release, build:msi, tauri:dev
```

---

## Related documentation

- [BUILD.md](BUILD.md) — build and install quick reference
- [enterprise-deployment.md](enterprise-deployment.md) — silent MSI / SCCM
- [windows-installer-architecture.md](windows-installer-architecture.md) — installer design detail
- [wazuh-compatibility.md](wazuh-compatibility.md) — protocol notes (if present)
