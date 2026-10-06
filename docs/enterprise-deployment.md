# CUSA Enterprise Deployment

Centralized push deployment for CUSA **1.0.0** via MSI (SCCM, Intune, GPO, or `msiexec`).

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

### MSI public properties

| Property | Default | Description |
|----------|---------|-------------|
| `MANAGER_ADDRESS` | *(empty)* | Wazuh Manager hostname or IP |
| `MANAGER_PORT` | `1514` | Event/data port |
| `ENROLLMENT_PORT` | `1515` | Enrollment port |
| `START_SERVICE` | `1` | Start `CUSAAgent` service after install |
| `LAUNCH_GUI` | `0` in `/qn` | Launch `CUSA.exe` when install completes |
| `DESKTOP_SHORTCUT` | `0` | Create desktop shortcut |
| `PURGE_DATA` | `0` | On **uninstall**, purge ProgramData identity and queues |
| `AGENT_ONLY` | `0` | Omit GUI shortcuts (headless) |

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

## SCCM / Intune notes

- Install context: **System**
- Detection: Windows Installer product code or file `C:\Program Files\CUSA\version.json` version ≥ 1.0.0
- Restart: generally not required (`/norestart`)
- Dependencies: none (Node embedded in agent executable when packaged)
