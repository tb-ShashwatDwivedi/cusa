# CUSA Agent & GUI — Complete User Guide

**CyberSIO Unified Security Agent (CUSA)** is a lightweight endpoint security agent that collects logs, inventory, file-integrity, and compliance data from Windows and Linux hosts, then forwards it to a **Wazuh Manager** (tbSIEM). A local **React GUI** provides visibility and configuration without exposing the agent to the network.

This guide covers every major section of the agent and GUI: what it does, how it fits together, and how to use it day to day.

---

## Table of contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Prerequisites](#2-prerequisites)
3. [Installation](#3-installation)
4. [Configuration](#4-configuration)
5. [Running the agent](#5-running-the-agent)
6. [Connecting to Wazuh Manager](#6-connecting-to-wazuh-manager)
7. [Agent modules reference](#7-agent-modules-reference)
8. [Local API reference](#8-local-api-reference)
9. [GUI guide](#9-gui-guide)
10. [Data & file locations](#10-data--file-locations)
11. [Testing](#11-testing)
12. [Troubleshooting](#12-troubleshooting)
13. [Known limitations](#13-known-limitations)
14. [Further reading](#14-further-reading)

---

## 1. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│                     Endpoint (your machine)                  │
│                                                              │
│  ┌──────────┐         ┌─────────────────────────────────┐ │
│  │ GUI      │  HTTP   │  Agent (Node.js)                 │ │
│  │ React /  │ ──────▶ │  :127.0.0.1:8710 (localhost only)│ │
│  │ Tauri    │         │                                  │ │
│  └──────────┘         │  Collectors → Pipeline → Queue   │ │
│                       │           ↓                      │ │
│                       │      Wazuh adapter (TCP/TLS)     │ │
│                       └──────────────┬───────────────────┘ │
└──────────────────────────────────────┼──────────────────────┘
                                       │ TCP 1514 (events)
                                       │ TLS 1515 (enrollment)
                                       ▼
                            ┌─────────────────┐
                            │  Wazuh Manager  │
                            └─────────────────┘
```

**Design principle:** collectors produce internal CUSA events. Only the Wazuh adapter knows the wire format. The GUI never talks to Wazuh directly — it only talks to the local agent API.

| Component | Path | Role |
|-----------|------|------|
| Agent service | `agent/` | Background Node.js process |
| GUI (web) | `gui/` | React dashboard (Vite dev server or static build) |
| Tauri shell | `src-tauri/` | Optional desktop wrapper around the GUI |
| Docs | `docs/` | Architecture, protocols, security |

---

## 2. Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| Node.js | **≥ 20** (agent runtime) |
| npm | Comes with Node |
| Wazuh Manager | **4.11** (default), or 4.x / 5.x-released (TCP 1514 + enrollment 1515) |
| Windows | PowerShell for event collectors (admin helps for Security log) |
| Linux | `journalctl`, read access to `/var/log/*` |
| Rust (optional) | Only for building the Tauri desktop app — **not** required to run the agent |

---

## 3. Installation

### 3.1 Agent

```bash
cd agent
npm install
npm test          # optional — runs unit tests
```

### 3.2 GUI (web development)

```bash
cd gui
npm install
```

### 3.3 GUI (Tauri desktop — optional)

Requires [Rust](https://rustup.rs/):

```bash
# From repo root (recommended)
npm run tauri:dev
```

Or manually:

```bash
cd gui && npm run build
cd ../src-tauri && cargo tauri dev
```

Tauri config: `frontendDist` is `../gui/dist`; release exe is `src-tauri/target/release/cusa-gui.exe`, copied to `build/gui/CUSA.exe` by `npm run build:gui`.

### 3.4 Windows MSI install (production)

Build the MSI on a release machine — see [BUILD.md](BUILD.md):

```powershell
npm ci
npm run build:release
msiexec /i dist\CUSA-x64-1.0.0.msi
```

After install:

- Service: `CUSAAgent` (auto-start)
- GUI: `C:\Program Files\CUSA\gui\CUSA.exe` (full MSI only)
- Data: `C:\ProgramData\CUSA\`
- Configure manager/enrollment in GUI **Configuration**

Agent-only MSI (no GUI): built with `SKIP_GUI=1` — see [windows-installation.md](windows-installation.md).

---

## 4. Configuration

Configuration is merged from several layers (lowest priority first):

| Layer | Source | Editable via GUI |
|-------|--------|------------------|
| Defaults | `agent/config/default.json` | No |
| Repo-local override | `agent/config/config.local.json` | No (dev/deploy file) |
| MSI deploy overlay | `C:\ProgramData\CUSA\config\deploy.json` | No (from `MANAGER_ADDRESS` at install) |
| Runtime overlay | `{dataDir}/config.local.json` | **Yes** — saved by GUI/API |
| Locked policy | `locked` array in config | Manager/CyberSIO only |

On MSI-installed endpoints, `dataDir` defaults to **`C:\ProgramData\CUSA`**. Dev runs use **`~/.cusa`** unless overridden.

### 4.1 First-time manager setup

Copy the example and fill in your manager details:

```bash
cp agent/config/config.local.example.json agent/config/config.local.json
```

Example (`agent/config/config.local.json`):

```json
{
  "wazuh": {
    "manager": {
      "address": "192.168.0.185",
      "port": 1514,
      "enrollmentPort": 1515
    },
    "enrollment": {
      "password": "your-enrollment-password",
      "apiUser": "wazuh-wui",
      "apiPassword": "your-api-password",
      "apiPort": 55000,
      "insecure": true,
      "groups": ["default"]
    }
  }
}
```

| Field | Purpose |
|-------|---------|
| `manager.address` | Wazuh Manager IP or hostname |
| `manager.port` | Event transport (default **1514**) |
| `manager.enrollmentPort` | TLS enrollment (default **1515**) |
| `enrollment.password` | authd enrollment password |
| `enrollment.apiUser` / `apiPassword` | Wazuh API enrollment (port 55000) — tried first |
| `enrollment.insecure` | `true` = accept self-signed manager TLS |
| `enrollment.groups` | Agent groups on enrollment |

### 4.2 Full default config reference

File: `agent/config/default.json`

#### `agent`

| Key | Default | Description |
|-----|---------|-------------|
| `name` | hostname | Agent display name sent to manager |
| `dataDir` | `~/.cusa` | State, queue spool, secrets, runtime config |

#### `wazuh`

| Key | Default | Description |
|-----|---------|-------------|
| `version` | `4.11` | Protocol profile (`4.11`, `4.x`, `5.x-released`, `5.x-https`) |
| `manager.address` | `null` | Must be set for connectivity |
| `manager.port` | `1514` | TCP event port |
| `manager.enrollmentPort` | `1515` | TLS enrollment port |

#### `queue`

| Key | Default | Description |
|-----|---------|-------------|
| `memoryLimit` | `500` | Max in-memory items per queue (overflow spills to JSONL spool) |
| `diskLimitMb` | `256` | Max JSONL spool size when memory overflows |
| `flushIntervalMs` | `1000` | How often events are sent to manager |
| `maxRetries` | `10` | Requeue attempts on send failure |

#### `api`

| Key | Default | Description |
|-----|---------|-------------|
| `host` | `127.0.0.1` | Local API bind address (**localhost only**) |
| `port` | `8710` | Local API port |

#### `logging`

| Key | Default | Description |
|-----|---------|-------------|
| `level` | `info` | Pino log level (`trace` … `error`) |

#### `collectors`

| Key | Platform | Default | Description |
|-----|----------|---------|-------------|
| `eventChannel` | Windows | enabled | Security / System / Application logs |
| `sysmon` | Windows | disabled | Sysmon operational channel |
| `defender` | Windows | disabled | Windows Defender events |
| `powershell` | Windows | disabled | PowerShell operational log |
| `journald` | Linux | enabled | systemd journal |
| `syslog` | Linux | enabled | `/var/log/syslog`, `auth.log`, etc. |
| `auditd` | Linux | enabled | `/var/log/audit/audit.log` |
| `fileTail` | Both | disabled | Custom file paths |

#### `fim`

| Key | Description |
|-----|-------------|
| `paths` | Array of files/directories to monitor (SHA-256 baseline) |

#### `compliance`

| Key | Default | Description |
|-----|---------|-------------|
| `policyPath` | `null` | Path to JSON compliance policy |
| `intervalMs` | `86400000` | Check interval (24 h) |

#### `inventory`

| Key | Default | Description |
|-----|---------|-------------|
| `intervalMs` | `3600000` | Full inventory scan interval (1 h) |

#### `locked`

Array of dot-path keys that cannot be changed via GUI/API. Example: `["collectors.sysmon"]` locks the entire Sysmon collector section.

### 4.3 Environment variables

| Variable | Purpose |
|----------|---------|
| `CUSA_CONFIG` | Path to alternate base config JSON (instead of `default.json`) |

Example (PowerShell):

```powershell
$env:CUSA_CONFIG = "C:\cusa\my-config.json"
cd agent
npm start
```

### 4.4 Compliance policy

Copy and customize:

```bash
cp agent/config/compliance-policy.example.json /path/to/my-policy.json
```

Point `compliance.policyPath` at that file. Policy format:

```json
{
  "id": "cusa-basic",
  "name": "CUSA Basic Compliance",
  "checks": [
    {
      "id": "check-001",
      "title": "Agent config exists",
      "type": "file_exists",
      "path": "config/default.json",
      "severity": "medium"
    },
    {
      "id": "check-002",
      "title": "SSH config present",
      "type": "command",
      "command": "grep",
      "args": ["PermitRootLogin", "/etc/ssh/sshd_config"],
      "expect": "no",
      "severity": "high"
    }
  ]
}
```

Check types: `file_exists`, `command` (with optional `expect` substring match).

### 4.5 Changing config via GUI

See [Configuration page](#95-configuration) — unlocked fields are saved to `dataDir/config.local.json` and applied immediately (collectors restart).

### 4.6 Changing config via API

```bash
curl -X PATCH http://127.0.0.1:8710/api/config \
  -H "Content-Type: application/json" \
  -d '{"patch":{"queue":{"memoryLimit":8000}}}'
```

Locked paths return **403**.

---

## 5. Running the agent

### 5.1 Start

```bash
cd agent
npm start
```

On success you should see log lines for enrollment, manager connection, and `Local API listening` on `127.0.0.1:8710`.

### 5.2 Verify

```bash
curl http://127.0.0.1:8710/api/status
```

Expected fields: `agentId`, `hostname`, `enrollment`, `manager`, `transportConnected`, `queue`, `metrics`.

### 5.3 Stop

Press **Ctrl+C** in the terminal. The agent shuts down collectors, flushes state, and closes the manager connection gracefully.

### 5.4 Lifecycle (what happens on start)

1. Load configuration (defaults → local files → runtime overlay)
2. Load encrypted secrets / enrollment identity
3. Initialize durable queues
4. Enroll with manager if no identity exists (API first, then authd 1515)
5. Open TCP connection to manager port 1514
6. Start enabled collectors
7. Start FIM watchers (if paths configured)
8. Start registry watcher (Windows, if keys configured)
9. Start queue flushers (events, state, command results)
10. Schedule inventory, compliance, tamper checks
11. Bind local API on `127.0.0.1:8710`

---

## 6. Connecting to Wazuh Manager

### 6.1 Enrollment flow

```
Agent (no key) ──▶ Wazuh API :55000  (if apiUser set)
       │ fail
       └──▶ authd TLS :1515  (password enrollment)
       │
       ▼
  Identity stored (agent ID + key) in secrets.enc
       │
       ▼
  TCP :1514  encrypted events
```

Identity is persisted under `dataDir` and reused on restart.

### 6.2 Protocol version

Set `wazuh.version` in config:

| Value | Adapter | Use when |
|-------|---------|----------|
| `4.11` | v4 (TCP) | **Default** — Wazuh Manager 4.11 (legacy `d:` state sync) |
| `4.x` | v4 (TCP) | Other Wazuh 4.x managers |
| `5.x-released` | v4 (TCP) | Released Wazuh 5.x managers |
| `5.x-https` | v5 (stub) | Developing HTTPS branch only |

For Manager **4.11**, enrollment reports `V:'Wazuh v4.11.2'` and inventory/FIM state uses per-item `d:index:json` messages (not session sync markers). Override with `wazuh.enrollment.agentVersion` if needed.

### 6.3 Verify on manager

In Wazuh Manager UI or API, confirm the agent appears as **Active** with the expected ID and hostname.

### 6.4 Common connectivity issues

| Symptom | Check |
|---------|-------|
| Enrollment fails | Password, API credentials, firewall 1515/55000 |
| Connected then disconnects | Firewall 1514, manager remoted running |
| TLS errors | Set `enrollment.insecure: true` for self-signed certs |
| No events in manager | Queue depth via `/api/queue`, collector health |

---

## 7. Agent modules reference

### 7.1 Core (`agent/src/core/`)

| Module | File | Responsibility |
|--------|------|----------------|
| Agent | `agent.js` | Top-level orchestrator — start/stop, ingest, sync |
| Health | `health.js` | Aggregates transport, queue, collector health |
| Metrics | `metrics.js` | Counters: events collected/sent/failed, commands, queue depth |
| Scheduler | `scheduler.js` | Periodic tasks (inventory, compliance, tamper) |

### 7.2 Collectors (`agent/src/collectors/`)

Collectors emit **raw events** through a shared callback. They do not know about Wazuh.

#### Windows (`collectors/windows/`)

| Collector | Name | Channels / source | Notes |
|-----------|------|-------------------|-------|
| Event channel | `event-channel` | Security, System, Application | Incremental `EventRecordID` bookmarks |
| Sysmon | `sysmon` | Microsoft-Windows-Sysmon/Operational | Enable in config |
| Defender | `defender` | Windows Defender logs | Enable in config |
| PowerShell | `powershell` | PowerShell operational | Enable in config |

#### Linux (`collectors/linux/`)

| Collector | Name | Source |
|-----------|------|--------|
| Journald | `journald` | `journalctl` with cursor bookmarks |
| Syslog | `syslog` | `/var/log/syslog`, `messages`, `auth.log`, `secure` |
| Auditd | `auditd` | `/var/log/audit/audit.log` |

#### Common (`collectors/common/`)

| Collector | Name | Source |
|-----------|------|--------|
| File tail | `file-tail` | Any configured file paths |

**Enable/disable** collectors in config or GUI Configuration page.

### 7.3 Pipeline (`agent/src/pipeline/`)

| File | Role |
|------|------|
| `normalize.js` | Maps collector output → canonical CUSA event |
| `event.schema.js` | JSON Schema validation (Ajv) |
| `validator.js` | Validates before queueing |

Canonical event shape is documented in [event-schema.md](event-schema.md).

### 7.4 Queue (`agent/src/queue/`)

```
Collector event
    → memory buffer
    → JSONL spool (if memory full)
    → flusher batch
    → Wazuh adapter sendEvents()
    → ACK / requeue on failure
```

Four logical queues:

| Queue | Contents |
|-------|----------|
| `events` | Log/security events |
| `state` | Inventory, FIM, compliance state |
| `commands` | Inbound manager commands |
| `command-results` | Outbound command ACKs |

State queue has its own flusher calling `syncState()` with session protocol.

### 7.5 Wazuh adapter (`agent/src/wazuh/`)

| Path | Role |
|------|------|
| `client.js` | Facade — picks v4 or v5 adapter |
| `v4/client.js` | Enrollment, send events, sync state, commands |
| `v4/transport.js` | TCP framing, reconnect with backoff |
| `v4/crypto.js` | AES-256-CBC secure messages |
| `v4/enrollment.js` | authd TLS enrollment |
| `v4/api-enrollment.js` | Wazuh REST API enrollment |
| `v4/event-serializer.js` | `queue:location:message` plaintext |
| `v4/sync-protocol.js` | Start → Data → End state sessions |
| `v4/commands.js` | Parse `#!-req`, format ACKs |

### 7.6 Inventory (`agent/src/inventory/`)

| File | Role |
|------|------|
| `scanner.js` | Hostname, OS, packages, interfaces, processes, ports |
| `delta.js` | CREATE/UPDATE/DELETE vs last scan |

Runs on schedule (`inventory.intervalMs`). Delta items go to **state queue**, not sent directly.

### 7.7 FIM (`agent/src/fim/`)

| File | Role |
|------|------|
| `watcher.js` | `fs.watch` + recursive SHA-256 baseline |

Configure paths in `fim.paths`. Changes enqueue state items for manager sync.

### 7.8 Registry (Windows) (`agent/src/registry/`)

| File | Role |
|------|------|
| `watcher.js` | Polls configured registry keys via PowerShell |

Configure with `registry.keys` array (add to local config):

```json
{
  "registry": {
    "keys": [
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"
    ]
  }
}
```

### 7.9 Compliance (`agent/src/compliance/`)

| File | Role |
|------|------|
| `engine.js` | Runs JSON policy checks on schedule |

Results are sent as both **state** (SCA index) and **log events**.

### 7.10 Active response (`agent/src/active-response/`)

| File | Role |
|------|------|
| `allowlist.js` | Allowed action names only |
| `executor.js` | Executes allowlisted commands from manager |

**Allowed actions:** `terminate_process`, `block_ip`, `approved_script`, `restart_agent`, `reload_config`.

Unknown or non-allowlisted actions are rejected.

### 7.11 Security (`agent/src/security/`)

| File | Role |
|------|------|
| `secrets.js` | AES-256-GCM encrypted `secrets.enc` (enrollment key) |
| `tamper.js` | Hash/mtime watch on agent binary, state, secrets |

Tamper alerts are ingested as critical events.

### 7.12 Updater (`agent/src/updater/`)

| File | Role |
|------|------|
| `updater.js` | Download manifest, SHA-256 verify, stage update |

Triggered by manager upgrade commands. Post-stage restart required.

### 7.13 Logging (`agent/src/logging/`)

| File | Role |
|------|------|
| `logger.js` | Pino structured logs to stdout |
| `event-log.js` | Ring buffer for GUI (agent / collected / system) |
| `ring-buffer.js` | Bounded in-memory store (~5000 entries) |

### 7.14 Local API (`agent/src/api/`)

Fastify server — **localhost only**. See [Section 8](#8-local-api-reference).

---

## 8. Local API reference

Base URL: `http://127.0.0.1:8710` (default)

CORS is enabled for `localhost`, `127.0.0.1`, and `tauri://localhost` origins only.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Agent ID, hostname, enrollment, manager, connection, metrics |
| GET | `/api/health` | Transport, queue, per-collector health |
| GET | `/api/metrics` | Counter snapshot |
| GET | `/api/collectors` | Per-collector runtime status |
| GET | `/api/config` | Effective config + `locked` array |
| PATCH | `/api/config` | Apply partial config update `{ "patch": { ... } }` |
| GET | `/api/queue` | Queue depths (events, state, commands) |
| GET | `/api/logs` | Query `?category=agent\|collected\|system&limit=200&since=&search=` |
| GET | `/api/logs/:id` | Full log entry by ID |
| GET | `/api/fim` | Monitored paths + SHA-256 baseline |
| GET | `/api/compliance` | Policy path + last check results |
| GET | `/api/diagnostics` | Combined status, health, Node version, PID |

### Example: query collected logs

```bash
curl "http://127.0.0.1:8710/api/logs?category=collected&limit=50"
```

### Example: patch config

```bash
curl -X PATCH http://127.0.0.1:8710/api/config \
  -H "Content-Type: application/json" \
  -d '{"patch":{"collectors":{"eventChannel":{"enabled":true}}}}'
```

### GUI API base override

Set in `gui/.env` or build time:

```
VITE_AGENT_API=http://127.0.0.1:8710
```

---

## 9. GUI guide

Start the GUI (agent must already be running):

```bash
cd gui
npm run dev
```

Open **http://localhost:1420** (Vite default port).

### 9.1 Layout

- **Sidebar** — navigation + connection status pill
- **Top bar** — page title + last inventory sync time + connection status
- All pages auto-refresh via polling (2–10 s depending on page)

### 9.2 Dashboard (`/`)

**Purpose:** Operations overview at a glance.

| Shows | Source |
|-------|--------|
| Hostname, agent ID, version | `/api/status` |
| Manager connection | `transportConnected` |
| Events collected / sent | `/api/metrics` |
| Queue depth | `/api/queue` |
| Health summary | `/api/health` |

**When to use:** First page to open after starting the agent. Confirms enrollment and manager connectivity.

### 9.3 Collectors (`/collectors`)

**Purpose:** Runtime status of each registered collector.

| Column | Meaning |
|--------|---------|
| Collector | Internal name (`event-channel`, `journald`, …) |
| Status | `running` or `stopped` |
| Source | Always `Local` |
| Locked | Policy lock indicator |

**When to use:** Verify collectors started after config change. If a collector shows `stopped`, check platform (Windows vs Linux) and enabled flags in Configuration.

### 9.4 Configuration (`/configuration`)

**Purpose:** View and edit local agent settings.

- **Editable** — unlocked fields (text, number, checkbox, select)
- **Locked** — greyed out with Locked badge (managed by CyberSIO policy)
- **Save changes** — sends `PATCH /api/config` with only modified keys

Editable settings include: manager address, protocol version, collector toggles, queue limits, log level, FIM paths, compliance policy path, API port.

**Note:** Some changes (e.g. API port) may require an agent restart to fully take effect.

### 9.5 FIM (`/fim`)

**Purpose:** File integrity monitoring status.

| Shows | Meaning |
|-------|---------|
| Monitored paths count | From config |
| Baseline entries | Files/dirs with stored SHA-256 |
| Table | Path, size, hash prefix |

**When to use:** Confirm FIM paths are configured and baselines are building. Changes sync to manager via state queue.

### 9.6 Compliance (`/compliance`)

**Purpose:** Security configuration assessment results.

| Shows | Meaning |
|-------|---------|
| Policy file path | `compliance.policyPath` |
| Last run time | Timestamp of last scheduled check |
| Passed / Failed counts | Aggregated from results table |
| Results table | Per-check status, severity, evidence |

**When to use:** Audit endpoint compliance posture. Configure policy path in Configuration first.

### 9.7 Logs (`/logs`)

**Purpose:** Live agent log viewer with three categories.

| Tab | Contents |
|-----|----------|
| **Agent** | Start, stop, enrollment, manager connect/disconnect, transport errors |
| **Collected** | Each ingested event — source, channel, preview |
| **System** | Internal Pino logs (queue, health, commands) |

**Interaction:** Click any row → **side panel** opens with full raw JSON / metadata.

Refreshes every **2 seconds**.

### 9.8 Diagnostics (`/diagnostics`)

**Purpose:** Raw JSON dump for support and debugging.

Shows combined `/api/diagnostics` payload: status, health, Node version, platform, PID.

**When to use:** Attach output to support tickets or compare against expected healthy state.

### 9.9 Tauri desktop app

The Tauri shell wraps the same GUI. CSP allows connections to `127.0.0.1:8710`.

| Mode | Agent | GUI |
|------|-------|-----|
| Dev (`npm run tauri:dev`) | Start separately (`npm start` in `agent/`) | Tauri window |
| MSI install | `CUSAAgent` Windows service | `CUSA.exe` shortcuts; service auto-starts |

The Tauri dev shell does not auto-start the agent process. MSI installs register the agent as a Windows service.

---

## 10. Data & file locations

Default data directory:

| Install type | `dataDir` |
|--------------|-----------|
| MSI / service | `C:\ProgramData\CUSA` |
| Dev (`npm start`) | `~/.cusa` (override with `agent.dataDir` in config) |

| Path | Contents |
|------|----------|
| `{dataDir}/state.json` | Counters, bookmarks, FIM baseline, inventory snapshot, task IDs |
| `{dataDir}/secrets.enc` | Encrypted enrollment identity |
| `{dataDir}/config/deploy.json` | MSI-seeded manager address (when present) |
| `{dataDir}/config.local.json` | GUI/API config overlay |
| `{dataDir}/queue/events/` | Event queue spool + pending |
| `{dataDir}/queue/state/` | State queue spool |
| `{dataDir}/queue/commands/` | Command queue |
| `{dataDir}/queue/command-results/` | Command result queue |
| `{dataDir}/logs/agent/` | Rotating agent logs (MSI install) |

Repo config (not overwritten by GUI):

| Path | Contents |
|------|----------|
| `agent/config/default.json` | Built-in defaults |
| `agent/config/config.local.json` | Deploy-time override (gitignored in production) |

Program Files (MSI):

| Path | Contents |
|------|----------|
| `C:\Program Files\CUSA\agent\` | `cusa-agent.exe`, service host |
| `C:\Program Files\CUSA\gui\CUSA.exe` | Desktop GUI (full MSI only) |

---

## 11. Testing

```bash
cd agent
npm test
```

Test files in `agent/tests/`:

| Test | Covers |
|------|--------|
| `crypto.test.js` | Wazuh message encryption |
| `wazuh-version.test.js` | Protocol version routing |
| `api-cors.test.js` | Localhost CORS policy |
| `api-logs.test.js` | Log API endpoints |
| `api-config-patch.test.js` | Config PATCH endpoint |
| `config-patch.test.js` | Patch merge + lock enforcement |
| `commands.test.js` | Manager command parsing |
| `event-log.test.js` | Ring buffer / categories |
| `inventory-delta.test.js` | Inventory delta logic |

---

## 12. Troubleshooting

### Agent won't start

| Check | Action |
|-------|--------|
| Node version | `node -v` must be ≥ 20 |
| Port in use | Another process on 8710 — stop it or change `api.port` |
| Config JSON | Validate `config.local.json` syntax |

### GUI shows "Agent unreachable" / Failed to fetch (MSI)

| Check | Action |
|-------|--------|
| Service running | `sc query CUSAAgent` — state should be RUNNING |
| API reachable | `curl http://127.0.0.1:8710/api/status` — if this works, issue is GUI ↔ API (CORS); rebuild MSI with latest agent |
| Service stopped | Check `C:\ProgramData\CUSA\logs\agent\service-host.log` and `cusa-*.log` |
| Agent-only dev workaround | `npm run gui:dev` at http://localhost:1420 while service runs |

The packaged Tauri app loads from `http://tauri.localhost`; the local API must allow that origin (fixed in current source).

### Config shows null manager address

Expected on fresh install — `default.json` ships with null manager/enrollment fields. Once the GUI connects, open **Configuration** and set manager address and enrollment password, then save.

### GUI shows "Agent offline" (web dev)

| Check | Action |
|-------|--------|
| Agent running | `npm start` in `agent/` |
| Correct API URL | `VITE_AGENT_API` or default `127.0.0.1:8710` |
| Firewall | Localhost should not be blocked |

### No events in Wazuh Manager

| Check | Action |
|-------|--------|
| `transportConnected` | `/api/status` — must be `true` |
| Queue backing up | `/api/queue` — high `events` depth means send failures |
| Collector health | `/api/collectors` — must be `running` |
| Windows Security log | May need admin rights |

### Enrollment fails

1. Verify manager IP and ports 1515 / 55000 reachable
2. Confirm enrollment password matches manager `authd` config
3. Try API enrollment (`apiUser` / `apiPassword`)
4. For self-signed certs: `"insecure": true`

### Config save returns 403

The field is in the `locked` array. Remove from `locked` in deploy config or change via manager policy.

### Transport disconnects / EPIPE

Agent auto-reconnects with exponential backoff. Check manager `remoted` logs and network stability on port 1514.

### No GUI after MSI install

| Check | Action |
|-------|--------|
| Agent-only MSI | Rebuild with `npm run build:release` (no `SKIP_GUI=1`) |
| Missing exe | `Test-Path "C:\Program Files\CUSA\gui\CUSA.exe"` |
| Service only needed | Use web GUI at `http://localhost:1420` in dev, or API on `:8710` |

### Wrong manager address (MSI)

Check `C:\ProgramData\CUSA\config\deploy.json` — it overrides repo `config.local.json`. Update via GUI **Configuration** or edit `config.local.json` under ProgramData.

### Enrollment pending (agent stays up)

Enrollment failure is non-fatal; the agent retries with backoff. Fix manager reachability, password, or API credentials in **Configuration**.

---

## 13. Known limitations

| Area | Limitation |
|------|------------|
| State sync | Text session markers; full Wazuh FlatBuffers binary protocol not yet implemented |
| Windows events | PowerShell polling — not native EventChannel subscription |
| WPK updates | SHA-256 only — signature verification not implemented |
| Tauri dev | Does not auto-start agent — start `npm start` in `agent/` separately |
| HTTPS Wazuh | `5.x-https` adapter is a stub |

---

## 14. Further reading

| Document | Topic |
|----------|-------|
| [BUILD.md](BUILD.md) | Windows MSI release build |
| [windows-installation.md](windows-installation.md) | MSI install steps |
| [enterprise-deployment.md](enterprise-deployment.md) | Silent push, SCCM |
| [architecture.md](architecture.md) | Module boundaries, data flows, tech stack |
| [mvp-verification-guide.md](mvp-verification-guide.md) | Verify all 40 MVP features (GUI, API, Wazuh 4.11.2) |
| [wazuh-compatibility.md](wazuh-compatibility.md) | Full Wazuh protocol specification |
| [wazuh-protocol-notes.md](wazuh-protocol-notes.md) | Research notes and source references |
| [event-schema.md](event-schema.md) | Canonical event JSON schema |
| [security-model.md](security-model.md) | Threat model, allowlist, secrets |

---

## Quick reference card

```bash
# Terminal 1 — Agent
cd agent && npm install && npm start

# Terminal 2 — GUI
cd gui && npm install && npm run dev
# → http://localhost:1420

# Health check
curl http://127.0.0.1:8710/api/status
curl http://127.0.0.1:8710/api/health
```

| GUI page | URL | Primary question it answers |
|----------|-----|----------------------------|
| Dashboard | `/` | Is the agent healthy and connected? |
| Collectors | `/collectors` | Are collectors running? |
| Configuration | `/configuration` | What is configured? Can I change it? |
| FIM | `/fim` | What files are baselined? |
| Compliance | `/compliance` | Did checks pass? |
| Logs | `/logs` | What is the agent doing right now? |
| Diagnostics | `/diagnostics` | Raw debug payload for support |
