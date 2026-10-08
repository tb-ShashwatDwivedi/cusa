# CUSA Enterprise Deployment

Centralized push deployment for CUSA **1.0.0** via MSI (SCCM, Intune, GPO, or `msiexec`).

## MSI build variants (release engineering)

GUI inclusion is decided **at MSI build time**, not at install time.

| Variant | Build command | Endpoints receive |
|---------|---------------|-------------------|
| Full MSI | `npm run build:release` (default) | Service + GUI + shortcuts |
| Agent-only | `$env:SKIP_GUI = "1"; npm run build:release` | Service only |

`AGENT_ONLY=1` is an environment variable for `npm run build:msi` when staging without `build/gui/CUSA.exe`. It is **not** an `msiexec` property.

## Silent install (centralized push)

```powershell
msiexec /i CUSA-x64-1.0.0.msi /qn /norestart `
  MANAGER_ADDRESS=siem.example.com `
  MANAGER_PORT=1514 `
  ENROLLMENT_PORT=1515 `
  START_SERVICE=1 `
  LAUNCH_GUI=0
```

The installer writes `C:\ProgramData\CUSA\config\deploy.json` with manager host and ports. **No enrollment password** is passed on the command line. Enrollment is completed via GUI or manager auto-enrollment policy after install.

Use a **full** MSI if users need the desktop app; use an **agent-only** MSI for headless servers (no `CUSA.exe` in the package).

### MSI public properties

| Property | Default | Description |
|----------|---------|-------------|
| `MANAGER_ADDRESS` | *(empty)* | Wazuh Manager hostname or IP → `deploy.json` |
| `MANAGER_PORT` | `1514` | Event/data port |
| `ENROLLMENT_PORT` | `1515` | Enrollment port |
| `START_SERVICE` | `1` | Start `CUSAAgent` service after install |
| `LAUNCH_GUI` | `1` | Launch `CUSA.exe` when install completes (only if GUI is in MSI) |
| `PURGE_DATA` | `0` | On **uninstall**, purge ProgramData identity and queues |

**Not install-time properties:** `DESKTOP_SHORTCUT`, `AGENT_ONLY` — desktop and Start Menu shortcuts are included automatically when the MSI was built with GUI (`IncludeGui=1`).

### Logging

```powershell
msiexec /i CUSA-x64-1.0.0.msi /L*v C:\Temp\cusa-install.log
```

Agent runtime logs (after service start):

```
C:\ProgramData\CUSA\logs\agent\cusa-YYYY-MM-DD.log
```

## Uninstall

**Normal** (preserve data for reinstall / forensics):

```powershell
msiexec /x CUSA-x64-1.0.0.msi /qn
```

**Decommission + purge** (remove identity, secrets, queues):

```powershell
msiexec /x CUSA-x64-1.0.0.msi /qn PURGE_DATA=1
```

## GUI decommission

Users with access to the CUSA console can purge endpoint data without uninstalling binaries:

1. Open **Decommission** in the sidebar
2. Confirm by typing `DECOMMISSION`
3. Optionally include log deletion

This calls `POST /api/decommission/purge` on the local agent API.

## Pre-staging deploy config (testing)

Without MSI:

```powershell
node scripts/seed-deploy.js --address 10.0.0.1 --data-dir C:\ProgramData\CUSA
```

Use a real manager address in production. Seeded `deploy.json` overrides repo `agent/config/config.local.json` when ProgramData is active.

## SCCM / Intune notes

- Install context: **System**
- Detection: Windows Installer product code or file `C:\Program Files\CUSA\version.json` version ≥ 1.0.0
- Restart: generally not required (`/norestart`)
- Dependencies: none (Node embedded in agent executable when packaged)
- **Full vs agent-only:** deploy the MSI variant that matches whether endpoints need the GUI
