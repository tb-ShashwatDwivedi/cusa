# CUSA Windows Installer Architecture

**Status:** Design (Phase 10)  
**Version:** 1.0  
**Date:** 2026-10-06  
**Audience:** Release engineering, endpoint security, Windows platform

This document is the installation architecture source of truth for CUSA (CyberSIO Unified Security Agent) on Windows. It is derived from repository inspection, `docs/user-guide.md`, and production deployment requirements. Implementation follows this spec incrementally.

---

## 1. Executive summary

CUSA today is a **developer-run Node.js agent** with a **Tauri-wrapped React GUI**. There is **no Windows service, no packaged executable, and no MSI**. Runtime data defaults to `~/.cusa` under the interactive user profile. Phase 10 delivers:

1. Machine-wide install under `C:\Program Files\CUSA\`
2. Machine-wide runtime data under `C:\ProgramData\CUSA\`
3. Windows service `CUSAAgent` supervising `cusa-agent.exe`
4. WiX Toolset 4 MSI with upgrade, repair, rollback, and uninstall policies
5. Reproducible `npm run build:release` pipeline producing signed-ready artifacts

The GUI remains a **standard-user** control plane talking to `127.0.0.1:8710` only. The service owns collection, queues, secrets, and Wazuh transport.

---

## 2. Current state assessment

### 2.1 Repository layout (relevant paths)

| Path | Role |
|------|------|
| `agent/` | Node.js ESM agent (collectors, queue, FIM, Wazuh, API) |
| `gui/` | React + Vite dashboard |
| `src-tauri/` | Tauri 2 desktop shell (minimal Rust — no tray, no agent spawn) |
| `scripts/build-agent.js` | Runs `npm install` + `npm test` only — **no executable packaging** |
| `installer/wix/` | **Does not exist** (placeholder in `docs/architecture.md`) |
| `agent/src/platform/` | **Does not exist** (planned in architecture doc) |

### 2.2 Build processes today

| Component | Command | Output |
|-----------|---------|--------|
| Agent (dev) | `npm start` in `agent/` | `node src/bootstrap/main.js` |
| Agent (CI) | `node scripts/build-agent.js` | Test pass only |
| GUI (dev) | `npm run dev` in `gui/` | Vite on `:1420` |
| GUI (prod) | `npm run build` + `cargo tauri build` | NSIS/MSI via Tauri bundle (not CUSA MSI) |
| Root | `npm run build` | Delegates to `build-agent.js` |

**Gaps:** No `pkg`/SEA config, no staging directory, no WiX project, no `build:release` script.

### 2.3 Versioning

All packages report **`0.1.0`** (`package.json`, `src-tauri/tauri.conf.json`, hardcoded in `agent.js` `getStatus()` and `Updater`).

MSI will use **semantic product version** `1.0.0` at first production release (decouple from dev `0.1.0` when tagging release).

### 2.4 Runtime path assumptions (`~/.cusa`)

| Location | Code reference | Current path |
|----------|----------------|--------------|
| Data directory default | `agent/src/config/loader.js` → `getDataDir()` | `join(os.homedir(), '.cusa')` |
| Config overlay | `saveLocalConfig()` | `{dataDir}/config.local.json` |
| State | `agent/src/state/store.js` | `{dataDir}/state.json` |
| Secrets | `agent/src/security/secrets.js` | `{dataDir}/secrets.enc` |
| Queues | `agent/src/queue/durable-queue.js` | `{dataDir}/queue/{name}/` |
| Update staging | `agent/src/updater/updater.js` | `{dataDir}/update-staging.bin` |
| Tamper baseline | `agent/src/core/agent.js` | `process.execPath`, `state.json`, `secrets.enc` |

**Production target** uses subdirectories under `C:\ProgramData\CUSA\` (see §4). Agent code must be updated to resolve canonical paths; `agent.dataDir` remains the root with normalized subpaths.

### 2.5 Manual start assumptions

| Assumption | Where |
|------------|-------|
| Operator runs `npm start` or `node agent/...` | `README.md`, `docs/user-guide.md` §Quick reference |
| GUI expects agent already listening | `gui/src/pages/Dashboard.jsx` — "Start the agent service before opening the console" |
| Tauri does not start agent | `docs/user-guide.md` §9.9 |
| Shutdown via SIGINT/SIGTERM | `agent/src/bootstrap/main.js` — no Windows service control handler |
| `agent.stop()` exists but queue has no drain-on-stop | `queue-manager.js` `stop()` sets `running = false` only |

### 2.6 Local API

| Property | Value |
|----------|-------|
| Bind | `127.0.0.1:8710` (`agent/config/default.json`) |
| Framework | Fastify (`agent/src/api/server.js`) |
| CORS | Localhost + `tauri://localhost` origins |
| Auth | **None implemented** (security-model.md mentions optional token — not built) |
| Write endpoints | `PATCH /api/config` — no caller authentication |

**Gap:** Localhost-only is enforced by bind address, not request source validation. Production should add loopback peer check + local auth token for mutating endpoints.

### 2.7 Logging

- Pino → stdout + in-memory ring buffer (`event-log.js`)
- **No file logs** under dataDir today
- Production requires `C:\ProgramData\CUSA\logs\agent\` — add rotating file transport in agent

### 2.8 Tauri GUI

- Product name: `CUSA Agent` (`tauri.conf.json`)
- Output binary name: typically `CUSA Agent.exe` (spaces) — **rename to `CUSA.exe`** for enterprise paths
- CSP allows `http://127.0.0.1:8710`
- No system tray, no service status beyond API poll
- `tauri-plugin-shell` only — no service control APIs

### 2.9 Updater

- In-agent `Updater` class downloads manifest, verifies SHA-256, stages to `update-staging.bin`
- **No separate `cusa-updater.exe`** exists
- WPK signature verification not implemented
- MSI upgrade is the primary enterprise update path for v1

### 2.10 Toolchain on build host (observed)

| Tool | Status |
|------|--------|
| Node.js | v24.14.0 |
| Rust/cargo | 1.99.0 |
| WiX 4 | **Not installed** |
| .NET SDK | **Not installed** (needed for WiX SDK-style builds unless using standalone `wix` CLI) |

---

## 3. Production executables

### 3.1 Required MSI payload

| Artifact | Install path | Purpose |
|----------|--------------|---------|
| `cusa-agent.exe` | `C:\Program Files\CUSA\agent\` | Node.js agent (SEA or pkg bundle) |
| `cusa-service-host.exe` | `C:\Program Files\CUSA\agent\` | Windows SCM adapter; spawns/supervises agent |
| `CUSA.exe` | `C:\Program Files\CUSA\gui\` | Tauri GUI |
| `cusa-updater.exe` | `C:\Program Files\CUSA\updater\` | Future signed update helper (v1: stub or thin wrapper) |
| `version.json` | `C:\Program Files\CUSA\` | Installed version metadata for agent/updater/tamper |
| `default.json` | Embedded or `agent\config\` | Built-in defaults (read-only) |

**Not in MSI:** npm, Node.js runtime (embedded in agent exe), source maps, tests, dev dependencies, Rust toolchain, Vite dev server.

### 3.2 Agent packaging approach

**Recommendation: Node.js Single Executable Application (SEA)** on Node 20+ (current engine `>=20`).

| Option | Pros | Cons |
|--------|------|------|
| **SEA (recommended)** | Official Node 20+ path, no extra maintainer | Larger binary (~50–70 MB) |
| `@yao-pkg/pkg` | Mature, one-file | Third-party; config maintenance |
| Ship `node.exe` + JS | Smaller delta | Exposes JS tampering surface; not enterprise-grade |

Build steps (high level):

1. Bundle agent ESM graph (esbuild or `node --experimental-sea-config`)
2. Embed blob into `node.exe` copy → `cusa-agent.exe`
3. Sign `cusa-agent.exe` in release pipeline

`scripts/build-agent.js` will be extended to produce `build/agent/cusa-agent.exe`.

### 3.3 Service host

Node.js cannot register as a native Windows service without a wrapper. **Recommended: minimal Rust service host** (`service-host/` crate).

```
Windows SCM
     │
     ▼
cusa-service-host.exe   ← SERVICE_WIN32_OWN_PROCESS
     │
     ├── Registers for SERVICE_CONTROL_STOP / SHUTDOWN
     ├── Sets recovery via registry (or WiX ServiceConfig)
     ├── Spawns: cusa-agent.exe with env:
     │     CUSA_DATA_DIR=C:\ProgramData\CUSA
     │     CUSA_CONFIG=C:\Program Files\CUSA\agent\config\default.json
     │     CUSA_SECRET=<machine-bound key from DPAPI>
     └── Forwards stop → SIGTERM to child, waits with timeout
```

WiX `ServiceInstall` / `ServiceControl` target **`cusa-service-host.exe`**, not the Node binary directly. This isolates SCM lifecycle from Node signal handling quirks.

**Alternative (not recommended for MVP):** WinSW or NSSM — adds external dependency and weaker enterprise story.

### 3.4 GUI build

1. `npm ci --prefix gui && npm run build --prefix gui`
2. `cargo tauri build --ci` with `productName` / bundle identifier set for `CUSA.exe`
3. Copy from `src-tauri/target/release/bundle/` to `build/gui/CUSA.exe`

Disable Tauri-generated NSIS/MSI (`bundle.targets: ["nsis"]` → `[]` or `none`) — **CUSA MSI is the only installer**.

### 3.5 Estimated artifact sizes (pre-build)

No production binaries exist in repo yet. Planning estimates:

| Artifact | Uncompressed (est.) |
|----------|----------------------|
| `cusa-agent.exe` (SEA) | 55–75 MB |
| `cusa-service-host.exe` | 1–3 MB |
| `CUSA.exe` (Tauri) | 8–15 MB |
| `cusa-updater.exe` (stub) | < 1 MB |
| **MSI (LZMA)** | 25–45 MB realistic |

**Target MSI &lt; 15 MB** is unlikely with embedded Node without external runtime dependency. Track size; prioritize security over arbitrary cap. Document actuals after first `build:release`.

---

## 4. Installation layout

### 4.1 Program Files (immutable)

```
C:\Program Files\CUSA\
├── agent\
│   ├── cusa-agent.exe
│   ├── cusa-service-host.exe
│   └── config\
│       └── default.json          # read-only shipped defaults
├── gui\
│   └── CUSA.exe
├── updater\
│   └── cusa-updater.exe
└── version.json
```

`version.json` example:

```json
{
  "product": "CUSA",
  "version": "1.0.0",
  "channel": "stable",
  "components": {
    "agent": "1.0.0",
    "gui": "1.0.0",
    "updater": "1.0.0"
  },
  "upgradeCode": "<stable-guid>",
  "installedAt": "2026-10-06T00:00:00Z"
}
```

### 4.2 ProgramData (mutable runtime)

```
C:\ProgramData\CUSA\
├── config\
│   ├── config.local.json         # GUI/API overlay
│   └── effective-config.json     # optional debug snapshot
├── state\
│   └── state.json
├── secrets\
│   └── secrets.enc
├── queue\
│   ├── events\
│   ├── state\
│   ├── commands\
│   └── command-results\
├── logs\
│   ├── agent\
│   ├── installer\                # optional CA logs (no secrets)
│   └── updater\
├── cache\
└── updates\
```

### 4.3 Agent path resolution (code changes)

Introduce `agent/src/platform/paths.js`:

```js
// Windows production
const PROGRAM_DATA = process.env.CUSA_DATA_DIR
  || (process.platform === 'win32' ? 'C:\\ProgramData\\CUSA' : join(homedir(), '.cusa'));

export function resolvePaths(root = PROGRAM_DATA) {
  return {
    root,
    config: join(root, 'config', 'config.local.json'),
    state: join(root, 'state', 'state.json'),
    secrets: join(root, 'secrets', 'secrets.enc'),
    queue: join(root, 'queue'),
    logs: join(root, 'logs', 'agent'),
    updates: join(root, 'updates'),
    cache: join(root, 'cache'),
  };
}
```

`getDataDir()` returns `root`; submodules use `paths.*` instead of flat `join(dataDir, 'state.json')`.

**Environment variables (service host sets):**

| Variable | Purpose |
|----------|---------|
| `CUSA_DATA_DIR` | `C:\ProgramData\CUSA` |
| `CUSA_CONFIG` | Path to shipped `default.json` |
| `CUSA_SECRET` | DPAPI-derived key material for `secrets.enc` (preferred over default scrypt salt) |
| `CUSA_INSTALL_DIR` | `C:\Program Files\CUSA` |

### 4.4 Dev vs production

| Mode | Data dir |
|------|----------|
| Development | `~/.cusa` (unchanged) |
| Windows service / MSI | `C:\ProgramData\CUSA` |

Detection: `CUSA_DATA_DIR` set, or `ProgramData\CUSA\.install-marker` created by MSI.

---

## 5. Windows service

### 5.1 Service registration

| Property | Value |
|----------|-------|
| Service name | `CUSAAgent` |
| Display name | `CUSA Unified Security Agent` |
| Description | CyberSIO Unified Security Agent endpoint security and telemetry service. |
| Binary | `"C:\Program Files\CUSA\agent\cusa-service-host.exe"` |
| Start type | Automatic (delayed start optional after boot perf tuning) |
| Dependencies | None (no Tcpip/Wmi grouping unless measured need) |
| Interactive | No |

### 5.2 Service account decision

| Feature | LocalService | NetworkService | LocalSystem |
|---------|--------------|----------------|-------------|
| Security Event Log (Security channel) | **No** | **No** | **Yes** |
| System/Application event logs | Partial | Partial | Yes |
| FIM on arbitrary paths | Limited | Limited | Broad |
| Registry monitoring (HKLM) | Limited | Limited | Yes |
| Process/service inventory | Partial | Partial | Yes |
| `netsh advfirewall` (block_ip) | **No** | **No** | **Yes** |
| `taskkill` / terminate | Limited | Limited | Yes |
| Software inventory (WMI) | Partial | Partial | Yes |

**MVP recommendation: `LocalSystem`**

Rationale: Windows Security event channel collection (core MVP collector), firewall active response, and unrestricted FIM on system paths require administrative capability. `LocalService` cannot read Security.evtx via `Get-WinEvent` without complex custom SDDL grants.

**Mitigations while on LocalSystem:**

- Program Files: read/execute for Users; no write
- ProgramData: restrict write to SYSTEM + Administrators; GUI writes config via authenticated local API only
- No inbound firewall rule for 8710
- Secrets encrypted + DPAPI machine scope
- Document path to dedicated service account + GPO grants as Phase 10.1 hardening

### 5.3 Service recovery (WiX `ServiceConfig`)

| Failure | Action | Delay |
|---------|--------|-------|
| First | Restart service | 5000 ms |
| Second | Restart service | 10000 ms |
| Subsequent | Restart service | 30000 ms |
| Reset fail count after | 86400 seconds (24 h) | |

### 5.4 Graceful shutdown sequence

On `SERVICE_CONTROL_STOP`, shutdown, or MSI upgrade stop:

1. Service host signals child (`SIGTERM` or named pipe `shutdown`)
2. Agent `stop()` (enhanced):
   - Stop collectors, FIM, registry, scheduler
   - Stop command processing
   - **Drain queues** — attempt flush to Wazuh with timeout (e.g. 30s)
   - Persist state + spool files
   - Close Wazuh transport
   - Close local API
3. Service host waits up to **60s**, then terminates child if needed
4. MSI proceeds with file replacement

**Code gap:** `QueueManager.stop()` must coordinate flush; `agent.stop()` should `await queue.drain(timeout)`.

### 5.5 Service status reporting

Service host reports `SERVICE_RUNNING` only after:

- Child process alive
- `GET http://127.0.0.1:8710/api/health` returns 200 (optional health gate, timeout 120s on install)

---

## 6. MSI architecture (WiX 4)

### 6.1 Project structure

```
installer/
└── wix/
    ├── CUSA.wixproj
    ├── Package.wxs           # Product, Upgrade, MajorUpgrade
    ├── Files.wxs             # Component groups, heat-generated fragments
    ├── Service.wxs           # ServiceInstall, ServiceControl, ServiceConfig
    ├── Shortcuts.wxs         # Start Menu, optional Desktop
    ├── Permissions.wxs       # util:Permission on directories
    ├── Features.wxs
    ├── UI.wxs                # WixUI_FeatureTree or custom dialog set
    ├── CustomActions.wxs     # Minimal — health check, migration, launch GUI
    └── Fragments/
        ├── Directories.wxs
        ├── Registry.wxs      # Install state, upgrade markers (no secrets)
        └── Environment.wxs
```

### 6.2 WiX identifiers (generate once, commit)

| Identifier | Policy |
|------------|--------|
| `UpgradeCode` | **Fixed forever** — `PUT-GUID-HERE` replaced at implementation with `uuidgen` |
| `ProductCode` | New GUID per **major** upgrade; same for patches/minor per MSI rules |
| `PackageCode` | New every build |
| `ProductVersion` | `1.0.0` (3-field MSI version; 4th field in file version) |

### 6.3 Features

| Feature | Contents |
|---------|----------|
| `Complete` | Agent + service + GUI + updater + shortcuts (default) |
| `AgentOnly` | Headless enterprise (no GUI shortcuts) — optional |

### 6.4 Install sequence

```
InstallInitialize
  → StopServices (CUSAAgent)
  → InstallFiles (Program Files)
  → CreateFolders (ProgramData tree)
  → SetPermissions (ACLs)
  → InstallServices
  → ConfigureServiceRecovery
  → StartServices
  → CustomAction: HealthCheck (127.0.0.1:8710/api/health)
  → CustomAction: LaunchGUI (interactive only, if LAUNCH_GUI=1)
InstallFinalize
```

**Rollback:** Windows Installer transactional rollback + `ServiceControl` `RemoveOn uninstall` ordering. Binary backup for failed upgrade optional via `CustomAction` staging to `ProgramData\CUSA\updates\rollback\`.

### 6.5 Upgrade behavior

`MajorUpgrade` element:

- Detect installed product via `UpgradeCode`
- Schedule `RemoveExistingProducts` after `InstallInitialize` (stop service first via ordering)
- **Never** remove ProgramData components — no components under ProgramData in MSI (created via `CreateFolder` custom action or WiX directories with permanent="yes" and no uninstall)

Preserve on upgrade:

- `config.local.json`, `secrets.enc`, `state.json`, `queue/**`, FIM baseline in state

Run **config migration** custom action after files installed, before service start (see §8).

### 6.6 Repair

Repair (`msiexec /f`) reinstalls:

- Missing binaries under Program Files
- Service registration + recovery
- Shortcuts + ACLs

Repair **must not**:

- Delete or regenerate `secrets.enc`
- Reset `state.json` or queues
- Change agent Wazuh identity

### 6.7 Uninstall vs decommission

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Normal uninstall** | `msiexec /x` or Add/Remove Programs | Stop service, remove Program Files, remove service, remove shortcuts; **preserve** `C:\ProgramData\CUSA` |
| **Decommission + purge** | GUI confirmed action or `msiexec /x PURGE_DATA=1` | Above + delete ProgramData + manager disenrollment API call if configured |

Registry flag `HKLM\Software\CyberSIO\CUSA\PurgeOnUninstall` — optional enterprise policy.

### 6.8 MSI public properties

| Property | Default | Description |
|----------|---------|-------------|
| `INSTALLDIR` | `C:\Program Files\CUSA` | Install root |
| `MANAGER_ADDRESS` | empty | Pre-seed manager host (no secrets) |
| `MANAGER_PORT` | `1514` | Event port |
| `ENROLLMENT_PORT` | `1515` | Enrollment port |
| `START_SERVICE` | `1` | Start service after install |
| `LAUNCH_GUI` | `1` (UI), `0` (/qn) | Launch `CUSA.exe` on success |
| `DESKTOP_SHORTCUT` | `0` | Create desktop shortcut |
| `PURGE_DATA` | `0` | Decommission purge on uninstall |
| `AGENT_ONLY` | `0` | Omit GUI feature |

**Never** document `ENROLLMENT_PASSWORD` in command-line examples. Unattended enrollment uses GUI post-install or GPO-deployed config file in ProgramData (deployed separately).

### 6.9 UI flow (interactive)

```
Welcome → License → Install Directory
  → Optional: Manager host/ports (no password)
  → Install progress → Service startup wait
  → Finish [Launch CUSA]
```

Sensitive enrollment stays in GUI after install.

### 6.10 Custom actions (minimal)

| CA | Type | When | Purpose |
|----|------|------|---------|
| `CA_CreateProgramData` | deferred | install | Create folder tree + ACLs |
| `CA_MigrateConfig` | deferred | upgrade | schema migration + backup |
| `CA_MigrateFromProfile` | deferred | first install | Move `~/.cusa` → ProgramData if exists |
| `CA_HealthCheck` | deferred | after start | Poll `/api/health` |
| `CA_LaunchGUI` | immediate | finish | `WixShellExec` to CUSA.exe |

All deferred CAs: **no secrets in logs**, exit codes for rollback, idempotent.

Prefer WiX native `ServiceInstall`, `PermissionEx`, `MajorUpgrade` over scripts.

---

## 7. Security

### 7.1 NTFS permissions

**`C:\Program Files\CUSA\`**

| Principal | Access |
|-----------|--------|
| Administrators | Full Control |
| SYSTEM | Full Control |
| Users | Read & Execute, List |

**`C:\ProgramData\CUSA\`**

| Subtree | SYSTEM | Administrators | Users |
|---------|--------|----------------|-------|
| `config\` | Full | Full | Read (optional) |
| `secrets\` | Full | Full | **No access** |
| `state\`, `queue\` | Full | Full | **No access** |
| `logs\agent\` | Full | Full | Read (optional) |
| `updates\`, `cache\` | Full | Full | **No access** |

GUI config changes go through local API (service applies writes as SYSTEM).

### 7.2 Local API authorization (new)

Tiered access:

| Tier | Endpoints | Auth |
|------|-----------|------|
| Read | `GET /api/status`, `/health`, `/metrics`, `/collectors`, `/queue`, `/logs` | Loopback only |
| Config | `PATCH /api/config` | Loopback + **session token** or named-pipe handshake |
| Privileged | Active response, restart | **Not exposed on local API** — manager commands only |

Implementation plan:

1. Bind `127.0.0.1` only (existing)
2. Reject requests where `remoteAddress` not in `127.0.0.0/8` / `::1`
3. On service start, write one-time token to `C:\ProgramData\CUSA\cache\api.token` with ACL (Administrators + interactive user session — or use SSPI)
4. Tauri reads token via restricted file read on startup, sends `Authorization: Bearer <token>`

### 7.3 Secrets

- Move to `secrets\secrets.enc`
- Encrypt with AES-256-GCM (existing)
- Key derivation: **DPAPI `Protect`/`Unprotect`** machine scope for production; fallback `CUSA_SECRET` env for dev
- Installer never writes enrollment password to MSI log

### 7.4 Firewall

- **No** inbound rule for TCP 8710
- Outbound 1514/1515/55000 to manager — document; do not create broad outbound allow rules in MSI

### 7.5 Tamper protection coexistence

During MSI upgrade:

1. Service sets `tamper.setUpdateInProgress(true)` before stop (via upgrade CA or env `CUSA_UPDATE_IN_PROGRESS=1`)
2. Binary replace
3. Tamper baseline refresh on service start
4. Emit `configuration` event noting authorized update

---

## 8. Configuration migration

### 8.1 Schema versioning

Add to `config.local.json`:

```json
{
  "schemaVersion": 3,
  "wazuh": { ... }
}
```

### 8.2 Migration pipeline (on upgrade / first prod start)

```
load config.local.json
  → if missing schemaVersion: infer v1 (legacy flat ~/.cusa layout)
  → backup to config\config.local.json.bak-<timestamp>
  → run migration chain v1→v2→v3
  → validate against JSON schema
  → atomic write
  → never delete unknown keys (preserve in `_migratedUnknown`)
```

### 8.3 Layout migration v1 → v3

| v1 (dev) | v3 (prod) |
|----------|-----------|
| `{dataDir}/config.local.json` | `config/config.local.json` |
| `{dataDir}/secrets.enc` | `secrets/secrets.enc` |
| `{dataDir}/state.json` | `state/state.json` |
| `{dataDir}/queue/` | `queue/` (unchanged relative) |

`CA_MigrateFromProfile` or agent first-run detects `%USERPROFILE%\.cusa` when ProgramData empty.

### 8.4 Agent identity preservation

Identity lives in `secrets.enc` (Wazuh agent key, certs). Rules:

- Upgrade/repair: **never** delete or regenerate `secrets.enc`
- Uninstall (normal): preserve
- Decommission: explicit purge only
- MSI `Repair` must not touch ProgramData

---

## 9. GUI / service relationship

```
Windows SCM → CUSAAgent service → cusa-agent.exe :8710
                                        ▲
                                        │ HTTP localhost
                                   CUSA.exe (user session)
```

| Scenario | Agent | GUI |
|----------|-------|-----|
| GUI closed | Running | — |
| GUI crash | Running | — |
| GUI never opened | Running | — |
| Service stopped | Stopped | "Agent offline" |
| User logout | Running | — |

First-run GUI (post-MSI):

- Agent Status: **Service Running** (poll `/api/status`)
- Manager: Not configured
- Enrollment: Not enrolled
- CTA: Configure Manager

Enhance Dashboard to distinguish **service offline** vs **manager disconnected**.

---

## 10. Build pipeline

### 10.1 Scripts (`scripts/`)

| Script | Responsibility |
|--------|----------------|
| `build-agent.js` | `npm ci`, test, SEA/package → `build/agent/cusa-agent.exe` |
| `build-gui.js` | `npm ci`, vite build, `cargo tauri build` → `build/gui/CUSA.exe` |
| `build-service-host.js` | `cargo build --release` → `build/agent/cusa-service-host.exe` |
| `stage-release.js` | Assemble `build/` tree + `version.json` |
| `build-msi.js` | `wix build` / `dotnet build` on `installer/wix/CUSA.wixproj` |
| `validate-msi.js` | Post-install checks (see §11) |
| `release.js` | Orchestrate all, SHA-256, `release-manifest.json` |

### 10.2 Root `package.json` scripts

```json
{
  "build:release": "node scripts/release.js",
  "build:msi": "node scripts/build-msi.js",
  "validate:msi": "node scripts/validate-msi.js"
}
```

### 10.3 CI / release flow

```
npm ci
→ npm test (agent)
→ build-agent.js
→ build-service-host.js
→ build-gui.js
→ stage-release.js
→ build-msi.js
→ validate-msi.js (on test VM or smoke)
→ sign (signtool, env: SIGN_CERT, SIGN_PASSWORD)
→ checksums + release-manifest.json
```

### 10.4 Code signing hooks

Environment variables (no keys in repo):

- `CUSA_SIGN_CERT` — PFX path or store thumbprint
- `CUSA_SIGN_PASSWORD`
- `CUSA_SIGN_TIMESTAMP_URL`

Sign order: agent exe → service host → GUI → updater → MSI

### 10.5 Output layout

```
dist/
├── CUSA-x64-1.0.0.msi
├── CUSA-x64-1.0.0.msi.sha256
└── release-manifest.json
```

---

## 11. Validation

### 11.1 `validate-msi.js` checks

Automated where possible on install VM:

1. MSI exit code 0
2. Service `CUSAAgent` exists, StartType Automatic, Running
3. Recovery actions configured (query `sc qfailure CUSAAgent`)
4. Process `cusa-agent.exe` present
5. `CUSA.exe` exists
6. Start Menu shortcut exists
7. `C:\ProgramData\CUSA\{config,state,secrets,queue,logs}` exist
8. `icacls` on `secrets` — no Users write
9. `netstat` — `127.0.0.1:8710` LISTENING only
10. `/api/health` 200
11. Upgrade preserves mock identity file
12. Uninstall removes binaries, preserves ProgramData (default)
13. Repair restores deleted `cusa-agent.exe`

### 11.2 Manual VM lifecycle test (release gate)

```
Clean VM
→ install MSI
→ configure manager via GUI
→ enroll
→ verify collection
→ service restart
→ upgrade 1.0.0 → 1.0.1
→ repair
→ uninstall (data preserved)
→ decommission purge (optional second VM)
```

---

## 12. Implementation phases

### Phase 10a — Foundation (this sprint)

- [ ] `docs/windows-installer-architecture.md` (this document)
- [ ] `agent/src/platform/paths.js` + Windows data dir
- [ ] Secrets path `secrets/secrets.enc` + DPAPI key
- [ ] Graceful queue drain on shutdown
- [ ] File logging to `logs/agent/`
- [ ] Loopback + API token auth
- [ ] `service-host/` Rust crate
- [ ] SEA build in `build-agent.js`
- [ ] `build/gui` + rename `CUSA.exe`

### Phase 10b — MSI core

- [ ] WiX 4 project skeleton
- [ ] Service install + recovery + permissions
- [ ] ProgramData folder CA
- [ ] Shortcuts + UI
- [ ] MajorUpgrade + preserve ProgramData
- [ ] Silent install properties

### Phase 10c — Migration + polish

- [ ] Config `schemaVersion` migrations
- [ ] `~/.cusa` → ProgramData migration
- [ ] GUI first-run / service status UX
- [ ] `validate-msi.js`
- [ ] Documentation set (`windows-installation.md`, etc.)
- [ ] VM lifecycle test

### Phase 10d — Enterprise hardening (follow-on)

- [ ] Dedicated service account + SDDL for Security log
- [ ] Full `cusa-updater.exe` with signature verification
- [ ] AGENT_ONLY MSI feature
- [ ] System tray (Exit GUI does not stop service)

---

## 13. Risks and decisions

| Risk | Mitigation |
|------|------------|
| LocalSystem attack surface | Strict ProgramData ACLs, localhost API auth, no arbitrary AR from GUI |
| Large MSI from embedded Node | Accept size; document; evaluate shared runtime only if enterprise demands |
| WiX/dotnet not on dev machines | Document install of WiX 4 CLI + add CI job |
| Queue loss on upgrade | ProgramData not in MSI components; transactional backup before migration |
| Tauri bundle name with spaces | Set `productName` and rename in staging script |
| Node SEA + native modules | Agent uses child_process, fs — verify SEA compatibility early |

---

## 14. Product decisions (signed off)

| Decision | Resolution |
|----------|------------|
| **Product version** | **1.0.0** across agent, GUI, Tauri, and MSI |
| **Centralized push** | MSI writes `config/deploy.json` from `MANAGER_ADDRESS` / port properties; env fallback via `CUSA_MANAGER_*`; see `docs/enterprise-deployment.md` |
| **Decommission** | **Both:** `msiexec /x … PURGE_DATA=1` **and** GUI wizard (`POST /api/decommission/purge`) |
| **Manager pre-config** | Required for enterprise silent installs via `MANAGER_ADDRESS`; enrollment credentials never in MSI properties |
| **File logging** | Daily JSONL under `C:\ProgramData\CUSA\logs\agent\cusa-YYYY-MM-DD.log` |

---

## 15. References

- `docs/user-guide.md` — functional baseline
- `docs/architecture.md` — module boundaries, Phase 10 placeholder
- `docs/security-model.md` — privilege model, API security intent
- [WiX Toolset 4 documentation](https://wixtoolset.org/docs/intro/)
- Node.js [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)

---

## Appendix A — `~/.cusa` dependency inventory

| File | Dependency |
|------|------------|
| `agent/src/config/loader.js` | `getDataDir()`, overlay path |
| `agent/src/state/store.js` | `state.json` location |
| `agent/src/security/secrets.js` | `secrets.enc` location |
| `agent/src/queue/durable-queue.js` | queue subdirs |
| `agent/src/core/agent.js` | tamper paths, updater staging |
| `agent/src/wazuh/v4/enrollment.js` | identity via secrets |
| `docs/user-guide.md` | documentation |
| `.gitignore` | `**/.cusa/` |

## Appendix B — Manual start dependency inventory

| File | Behavior |
|------|----------|
| `agent/src/bootstrap/main.js` | CLI entry, SIGINT/SIGTERM |
| `README.md` | `npm start` instructions |
| `gui/src/pages/Dashboard.jsx` | Error message assumes manual start |
| `docs/user-guide.md` | Quick reference card |
| `package.json` | `"agent": "node agent/src/bootstrap/main.js"` |

## Appendix C — Minimum MSI file list (staging)

```
build/
├── agent/
│   ├── cusa-agent.exe
│   ├── cusa-service-host.exe
│   └── config/
│       └── default.json
├── gui/
│   └── CUSA.exe
├── updater/
│   └── cusa-updater.exe
└── metadata/
    └── version.json
```
