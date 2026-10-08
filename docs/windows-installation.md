# Windows Installation

Install CUSA via MSI on Windows 10/11 or Server 2019+.

## Requirements

- Administrator privileges for install
- Outbound TCP to Wazuh Manager (1514/1515)
- ~200 MB disk (Program Files + ProgramData)

## MSI flavors

| MSI type | How it is built | What you get |
|----------|-----------------|--------------|
| **Full** (default) | `npm run build:release` with GUI staged | Service + `CUSA.exe` + Start Menu + Desktop shortcuts |
| **Agent-only** | `$env:SKIP_GUI = "1"; npm run build:release` (or `AGENT_ONLY=1` at MSI build) | Service only — **no GUI, no shortcuts** |

If you install an agent-only MSI, there is no **CUSA Agent** shortcut and no `C:\Program Files\CUSA\gui\CUSA.exe`. Rebuild a full MSI or use the web GUI in dev mode against the running service.

See [BUILD.md](BUILD.md) for the release pipeline.

## Interactive install (full MSI)

1. Run `CUSA-x64-1.0.0.msi` (from `dist/` after `npm run build:release`)
2. Service `CUSAAgent` starts automatically
3. **CUSA Agent** opens when install finishes (default `LAUNCH_GUI=1`)
4. Shortcuts:
   - Start Menu: **CUSA → CUSA Agent**
   - Desktop: **CUSA Agent**
5. Open **Configuration** and set enrollment password / API credentials if not using manager auto-enrollment

Verify:

```powershell
sc query CUSAAgent
Test-Path "C:\Program Files\CUSA\gui\CUSA.exe"
curl http://127.0.0.1:8710/api/status
```

## Silent install

See [enterprise-deployment.md](enterprise-deployment.md). For headless endpoints, use `LAUNCH_GUI=0` on the `msiexec` command line.

## What the installer does

1. Copies binaries to `C:\Program Files\CUSA\`
2. Creates `C:\ProgramData\CUSA\` with ACLs
3. Writes `config/deploy.json` when `MANAGER_ADDRESS` is set on the command line
4. Registers and starts `CUSAAgent` Windows service
5. When the MSI includes GUI (`IncludeGui=1`): installs `gui\CUSA.exe`, Start Menu shortcut, Desktop shortcut, optional launch on finish

Data in ProgramData survives upgrades and normal uninstall.

## After install — paths

```text
C:\Program Files\CUSA\
  agent\cusa-agent.exe
  gui\CUSA.exe              ← full MSI only
  ...

C:\ProgramData\CUSA\
  config\deploy.json        ← from MANAGER_ADDRESS at install
  config\config.local.json  ← GUI / API edits
  logs\agent\
  queue\  state\  secrets\
```

**Manager address:** If the MSI was built with a seeded deploy config or you passed `MANAGER_ADDRESS`, check `C:\ProgramData\CUSA\config\deploy.json`. It overrides repo dev config. Change manager settings in the GUI **Configuration** page or edit `config.local.json`.

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| No GUI shortcut after install | Agent-only MSI | Reinstall from a full MSI; see [BUILD.md](BUILD.md) |
| GUI opens but agent offline | Service not running | `sc query CUSAAgent`; check `C:\ProgramData\CUSA\logs\agent\` |
| Wrong manager IP | Stale `deploy.json` | Edit in GUI or update `config.local.json` |
| Enrollment pending forever | Manager unreachable or bad password | Fix network; set enrollment in **Configuration** |

## Uninstall

Normal uninstall preserves ProgramData (identity, queues). Use `PURGE_DATA=1` for full wipe — see [enterprise-deployment.md](enterprise-deployment.md) and [msi-uninstall.md](msi-uninstall.md).
