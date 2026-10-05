# CUSA Architecture

**CyberSIO Unified Security Agent** — lightweight endpoint security agent for CyberSIO/tbSIEM with Wazuh Manager compatibility.

---

## Design Principle

Separate concerns. Collectors never know Wazuh wire format.

```
Collectors
    ↓
CUSA internal event/state models
    ↓
Wazuh compatibility serializer/adapter  (agent/src/wazuh/)
    ↓
Wazuh transport
    ↓
Wazuh Manager
```

---

## System Context

```
┌─────────────────────────────────────────────────────────────┐
│                        Endpoint Host                         │
│                                                              │
│  ┌──────────┐    ┌─────────────────────────────────────┐   │
│  │ Tauri GUI│───▶│  Agent Service (Node.js background)  │   │
│  │ (React)  │    │                                      │   │
│  └──────────┘    │  ┌─────────┐  ┌──────────────────┐  │   │
│       │          │  │ Local   │  │ Core Lifecycle   │  │   │
│       │          │  │ API     │  │ Scheduler Health │  │   │
│       ▼          │  │ :127.0.0.1│  └──────────────────┘  │   │
│  localhost only  │  └─────────┘                         │   │
│                  │                                      │   │
│                  │  Collectors → Pipeline → Queue       │   │
│                  │                    ↓                 │   │
│                  │              Wazuh Adapter             │   │
│                  └──────────────────┬───────────────────┘   │
│                                     │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │ TCP 1514 / HTTPS
                                      ▼
                            ┌─────────────────┐
                            │  Wazuh Manager  │
                            │  (tbSIEM)       │
                            └─────────────────┘
```

The GUI is a visibility/control layer only. The agent service runs independently as a Windows service / Linux daemon.

---

## Module Boundaries

### `agent/src/core/`

Agent lifecycle orchestration.

| Module | Responsibility |
|--------|---------------|
| `agent.js` | Top-level agent coordinator |
| `lifecycle.js` | Startup/shutdown state machine |
| `scheduler.js` | Periodic tasks (sync, health, collection) |
| `health.js` | Internal health aggregation |
| `metrics.js` | Counters, rates, resource usage |

**Lifecycle:**

```
startup
  → load configuration
  → load identity
  → load state
  → initialize storage
  → initialize transport (Wazuh)
  → initialize command channel
  → start collectors
  → start health monitoring
  → RUNNING

shutdown
  → stop collectors
  → flush queue
  → persist state
  → close network
  → close local API
  → exit
```

### `agent/src/wazuh/`

Wazuh compatibility layer. See `docs/wazuh-compatibility.md`.

| Module | Responsibility |
|--------|---------------|
| `version.js` | Protocol version selection |
| `client.js` | `WazuhClient` facade |
| `v4/` | Released TCP protocol (4.x / 5.x) |
| `v5/` | Developing HTTPS protocol |
| `enrollment/` | Shared enrollment state machine |
| `events/` | Event serialization |
| `state/` | Inventory/FIM/SCA sync |
| `commands/` | Command receive/dispatch |
| `config/` | Manager config sync |
| `control/` | Control plane (/control or legacy) |
| `downloads/` | WPK / update download |

### `agent/src/collectors/`

Platform-specific data collection. Common contract:

```js
{
  start(),
  stop(),
  health(),
  configure(config),
  // emits events via callback/emitter
}
```

```
collectors/
├── interfaces/     # Collector contract
├── windows/        # Event channels, Sysmon, Defender, PowerShell
├── linux/          # journald, syslog, auditd, file logs
└── common/         # Shared parsers, file tailer
```

### `agent/src/pipeline/`

Internal event normalization and validation.

- `event.schema.js` — JSON Schema (Ajv)
- Transformers map collector output → canonical CUSA event

### `agent/src/queue/`

Persistent outbound buffering.

```
collector → memory queue → durable queue (SQLite/spool) → transport client
```

Separate logical queues:

| Queue | Contents |
|-------|----------|
| `events` | Stateless log/security events |
| `state` | Inventory/FIM/SCA sync payloads |
| `commands` | Inbound manager commands (persisted before execution) |
| `command-results` | Outbound command responses |

Features: bounded memory, backpressure, ACK tracking, retry, crash recovery.

### `agent/src/transport/`

Transport abstraction below Wazuh adapter.

- TCP socket management (legacy)
- TLS connection pooling (enrollment, HTTPS)
- Reconnect with backoff

### `agent/src/inventory/`

System inventory collection and delta computation. Outputs to state sync, not event queue.

### `agent/src/fim/` and `agent/src/registry/`

File integrity monitoring. Registry monitoring isolated in `registry/` (Windows only).

### `agent/src/compliance/`

SCA rule-driven compliance: policy → checks → platform impl → result.

### `agent/src/active-response/`

Secure allowlisted action execution. See `docs/security-model.md`.

### `agent/src/updater/`

Signed update pipeline: manifest → verify → stage → replace → health check → rollback.

### `agent/src/security/`

Tamper detection, secret storage, certificate management.

### `agent/src/api/`

Localhost-only Fastify API.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/status` | Agent state summary |
| `GET /api/health` | Health checks |
| `GET /api/metrics` | Counters and rates |
| `GET /api/collectors` | Collector status |
| `GET /api/config` | Effective configuration |
| `GET /api/queue` | Queue depth and spool |
| `GET /api/diagnostics` | Debug information |

### `agent/src/state/`

Durable local state: counters, bookmarks, baselines, enrollment status, last-known-good config.

### `agent/src/logging/`

Pino structured logging with component tags.

### `agent/src/platform/`

OS-specific helpers (service install, paths, privileges).

---

## Data Flow: Events

```
Windows Event Log
    ↓
collectors/windows/event-channel.js
    ↓ (raw Windows event)
pipeline/normalize.js
    ↓ (CUSA canonical event)
queue/events.enqueue()
    ↓
wazuh/v4/event-serializer.js
    ↓ (queue:location:message plaintext)
wazuh/v4/secure-message.js
    ↓ (encrypted TCP frame)
transport/tcp.js → Manager:1514
```

## Data Flow: Inventory

```
inventory/scanner.js
    ↓ (internal inventory model)
inventory/delta.js
    ↓ (CREATE/MODIFY/DELETE ops)
queue/state.enqueue()
    ↓
wazuh/v4/sync-protocol.js
    ↓ (Start/Data/End session)
transport/tcp.js → Manager:1514
```

## Data Flow: Commands

```
Manager → transport → wazuh/commands/receiver.js
    ↓
queue/commands.enqueue()     # persist BEFORE execute
    ↓
commands/handler.js
    ↓
active-response/executor.js  # allowlist check
    ↓
queue/command-results.enqueue()
    ↓
transport → Manager
```

---

## Configuration Model

Three layers merged into effective config:

| Layer | Source | GUI editable |
|-------|--------|-------------|
| Manager | Central policy via Wazuh | Locked fields |
| Local | GUI / local config file | Yes |
| Defaults | Agent built-in | Read-only |

Flow: receive → authenticate → validate schema → compare version → stage → apply → health check → commit.

Last-known-good config preserved on failure.

```json
{
  "wazuh": {
    "version": "5.x-released",
    "manager": {
      "address": "10.0.0.1",
      "port": 1514,
      "enrollmentPort": 1515
    },
    "enrollment": {
      "password": null,
      "groups": ["default"]
    }
  },
  "queue": {
    "memoryLimit": 10000,
    "diskLimitMb": 256
  },
  "collectors": { ... },
  "fim": { ... },
  "compliance": { ... }
}
```

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Agent runtime | Node.js, ES Modules, JavaScript only |
| Validation | JSON Schema + Ajv |
| Logging | Pino |
| Local API | Fastify |
| Queue storage | SQLite (preferred) or segmented spool files |
| GUI | Tauri 2 + React + Vite |
| Packaging | pkg → agent.exe, WiX MSI |
| Testing | Node.js test runner |

No TypeScript. No Redis/Kafka/PostgreSQL on endpoint.

---

## Resource Constraints

Designed for thousands of endpoints:

- Bounded memory queue
- Bounded disk spool
- Async I/O throughout
- Event batching before send
- gzip compression where protocol requires
- Minimal subprocess execution
- Native OS APIs for collection (EventChannel, inotify, etc.)

---

## Implementation Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Research + docs + foundation | **Current** |
| 1 | Wazuh enrollment + event send | Next |
| 2 | Queue (memory + durable) | Planned |
| 3 | Windows collectors | Planned |
| 4 | Linux collectors | Planned |
| 5 | Inventory + state sync | Planned |
| 6 | FIM + Registry + Compliance | Planned |
| 7 | Commands + Active Response | Planned |
| 8 | Updater + Tamper detection | Planned |
| 9 | Tauri GUI | Planned |
| 10 | Service + MSI packaging | Planned |

---

## Directory Structure

```
cusa/
├── agent/
│   ├── src/
│   │   ├── bootstrap/
│   │   ├── core/
│   │   ├── config/
│   │   ├── collectors/{interfaces,windows,linux,common}/
│   │   ├── pipeline/
│   │   ├── queue/
│   │   ├── transport/
│   │   ├── wazuh/{v4,v5,enrollment,events,state,commands,config,control,downloads}/
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
│   │   └── platform/{windows,linux}/
│   ├── config/
│   └── tests/
├── gui/                    # Phase 9
├── src-tauri/              # Phase 9
├── installer/wix/            # Phase 10
├── docs/
└── scripts/
```
