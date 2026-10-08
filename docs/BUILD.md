# CUSA Windows Build Guide

Quick reference for building CUSA **1.0.0** on your own machine.

## Phases (what was built)

| Phase | Scope | Key outputs |
|-------|--------|-------------|
| **10a** | Agent packaging, ProgramData layout, secrets, logging, API token | `cusa-agent.exe`, `service-host/`, `agent/src/platform/*` |
| **10b** | WiX MSI, Windows service, custom actions | `installer/wix/*`, `CUSAAgent` service |
| **10c** | Migrations, GUI status UX, validation, docs | `validate-msi.js`, `docs/*.md` |
| **10d** | Future: service account, signed updater, tray | `updater-stub/` placeholder only |

**Your starting point:** clone repo → install prerequisites below → `npm run build:release`.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20 | Agent + scripts |
| Rust + cargo | latest stable | Service host, updater, Tauri GUI |
| Visual Studio Build Tools | C++ workload | Rust/Tauri on Windows |
| WiX Toolset 4 | `wix` on PATH | MSI — **no extra extensions required** |

> **Note:** Older docs mentioned `wix extension add WixToolset.Util.wixext`. The current MSI no longer needs it.

## MSI variants

| Build | How | Installed result |
|-------|-----|------------------|
| **Full** (default) | `build/gui/CUSA.exe` present when running `build:msi` | Agent service + `CUSA.exe` + Start Menu + Desktop shortcuts |
| **Agent-only** | `$env:AGENT_ONLY = "1"; npm run build:msi` | Service only — **no GUI, no shortcuts** |

`npm run build:msi` **fails by default** if `build/gui/CUSA.exe` is missing, to avoid silent agent-only installs.

## One-command release

```powershell
cd C:\path\to\cusa
npm ci
npm run build:release
```

**Output:**

```text
dist/
├── CUSA-x64-1.0.0.msi
├── CUSA-x64-1.0.0.msi.sha256
└── release-manifest.json

build/                  # staged artifacts
├── agent/
│   ├── cusa-agent.exe
│   ├── cusa-service-host.exe
│   └── config/default.json
├── gui/CUSA.exe
├── updater/cusa-updater.exe
├── installer/scripts/
└── version.json
```

Skip GUI (faster, agent-only release):

```powershell
$env:SKIP_GUI = "1"
npm run build:release
```

The staged MSI will also be agent-only. Set `$env:AGENT_ONLY = "1"` if you run `build:msi` manually after staging without `CUSA.exe`.

## GUI build (`npm run build:gui`)

Builds the Tauri desktop app and copies it to `build/gui/CUSA.exe` for MSI packaging.

```powershell
npm run build:gui
```

**Paths (repo layout):**

| Setting | Value | Notes |
|---------|-------|-------|
| `src-tauri/tauri.conf.json` → `frontendDist` | `../gui/dist` | Relative to `src-tauri/` |
| `beforeBuildCommand` | `npm run build --prefix gui` | Runs from repo root |
| Output exe | `src-tauri/target/release/cusa-gui.exe` | Copied to `build/gui/CUSA.exe` |

**First Tauri build:** ~10 minutes (Rust compile). Later builds are much faster.

**Dev desktop app** (no MSI):

```powershell
npm run tauri:dev    # from repo root
```

## Step-by-step (manual)

```powershell
npm run build:agent      # test + bundle + cusa-agent.exe
npm run build:service    # cusa-service-host.exe
node scripts/build-updater.js
npm run build:gui        # CUSA.exe (Tauri)
node scripts/stage-release.js
npm run build:msi        # requires WiX
npm run verify:release
```

## Install MSI

**Important:** If you ran `npm run build:msi` without `build/gui/CUSA.exe`, either the build failed (new default) or you set `AGENT_ONLY=1`. An agent-only MSI installs the **service only** — no `CUSA.exe`, no GUI shortcuts.

**Interactive (full MSI):**

```powershell
msiexec /i dist\CUSA-x64-1.0.0.msi
```

On success you get:

| Item | Location |
|------|----------|
| Agent service | `CUSAAgent` (Windows Service) |
| GUI app | `C:\Program Files\CUSA\gui\CUSA.exe` |
| Start Menu | **CUSA → CUSA Agent** |
| Desktop | **CUSA Agent** shortcut |
| Auto-launch | GUI opens when install finishes (`LAUNCH_GUI=1`, default) |

**Enterprise silent push:**

```powershell
msiexec /i dist\CUSA-x64-1.0.0.msi /qn /norestart `
  MANAGER_ADDRESS=siem.example.com `
  MANAGER_PORT=1514 `
  ENROLLMENT_PORT=1515 `
  LAUNCH_GUI=0
```

**Uninstall (keep data):**

```powershell
msiexec /x dist\CUSA-x64-1.0.0.msi /qn
```

**Decommission + purge:**

```powershell
msiexec /x dist\CUSA-x64-1.0.0.msi /qn PURGE_DATA=1
```

Or use GUI → **Decommission** (types `DECOMMISSION`).

## Verify after install

```powershell
sc query CUSAAgent
curl http://127.0.0.1:8710/api/status
Get-Content "C:\ProgramData\CUSA\logs\agent\cusa-*.log" -Tail 20

# Full MSI only — confirm GUI was installed
Test-Path "C:\Program Files\CUSA\gui\CUSA.exe"
```

## Layout after install

```text
C:\Program Files\CUSA\
  agent\cusa-agent.exe
  agent\cusa-service-host.exe   ← Windows service binary
  agent\config\default.json
  gui\CUSA.exe
  updater\cusa-updater.exe
  installer\scripts\

C:\ProgramData\CUSA\
  config\deploy.json          ← MSI may pre-seed manager address here
  config\config.local.json  ← GUI edits land here
  state\  secrets\  queue\  logs\  cache\  updates\
```

**Config priority on MSI installs:** `deploy.json` (from `MANAGER_ADDRESS`) overrides repo/dev config. Use GUI **Configuration** or edit `config.local.json` to override deploy values.

## Dev (no MSI)

```powershell
# Terminal 1 — agent source
cd agent && npm start

# Terminal 2 — GUI
npm run gui:dev
# or
npm run tauri:dev
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `wix not found` | Install [WiX Toolset 4](https://wixtoolset.org/docs/intro/), add to PATH |
| MSI has no GUI after install | Rebuild with `npm run build:gui` → `stage-release.js` → `build:msi` (do not set `AGENT_ONLY=1`) |
| `MSI would be agent-only` | Run `npm run build:gui` first, or set `$env:AGENT_ONLY = "1"` if you want agent-only |
| Tauri: `Unable to find web assets` | Ensure `src-tauri/tauri.conf.json` has `frontendDist: "../gui/dist"` |
| Tauri: `bundle` folder missing | Expected — exe is at `src-tauri/target/release/cusa-gui.exe` |
| Port 8710 in use | Stop other agent: `Get-Process cusa-agent*` |
| GUI build slow (first time) | Normal — Rust compile ~10 min; use `SKIP_GUI=1` for agent-only |
| Service won't start | Check `C:\ProgramData\CUSA\logs\agent\` |
| Wrong manager IP after MSI | Check `C:\ProgramData\CUSA\config\deploy.json`; override in GUI or `config.local.json` |
| GUI: "Failed to fetch" but service running | Fixed in agent CORS for `http://tauri.localhost` — rebuild agent + reinstall MSI |
| Verify agent API | `curl http://127.0.0.1:8710/api/status` (works even when GUI CORS fails) |

## Code signing (production)

Set env vars before release (hooks TBD in CI):

```text
CUSA_SIGN_CERT=<pfx path or thumbprint>
CUSA_SIGN_PASSWORD=<pfx password>
```

Sign order: agent exe → service host → GUI → updater → MSI.

## More docs

- [enterprise-deployment.md](enterprise-deployment.md) — MSI properties, SCCM
- [windows-installer-architecture.md](windows-installer-architecture.md) — full design
