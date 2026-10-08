# CUSA — CyberSIO Unified Security Agent

Lightweight endpoint security agent for CyberSIO/tbSIEM with Wazuh Manager compatibility.

## Components

| Component | Path | Description |
|-----------|------|-------------|
| Agent service | `agent/` | Node.js background service |
| GUI | `gui/` | React dashboard |
| Tauri shell | `src-tauri/` | Desktop app wrapper |
| Docs | `docs/` | Architecture and protocol specs |

## Quick Start

### 1. Agent service

```bash
cd agent
npm install
npm test
```

Configure manager address in `agent/config/default.json` or via environment:

```powershell
$env:CUSA_CONFIG = "C:\path\to\your-config.json"
npm start
```

Example config override:

```json
{
  "wazuh": {
    "manager": { "address": "10.0.0.1" },
    "enrollment": { "password": "your-enrollment-password" }
  }
}
```

Local API: `http://127.0.0.1:8710/api/status`

### 2. GUI (web dev mode)

```bash
cd gui
npm install
npm run dev
```

Open http://localhost:1420 — requires agent running on port 8710.

### 3. GUI (Tauri desktop)

Requires [Rust](https://rustup.rs/):

```bash
npm run tauri:dev    # from repo root
```

Release GUI for MSI: `npm run build:gui` → output at `build/gui/CUSA.exe`. See [BUILD.md](docs/BUILD.md).

### 4. Windows MSI install

```powershell
npm run build:release
msiexec /i dist\CUSA-x64-1.0.0.msi
```

Full MSI installs the `CUSAAgent` service, `CUSA.exe`, and shortcuts. Agent-only: `$env:SKIP_GUI = "1"; npm run build:release`.

See [windows-installation.md](docs/windows-installation.md) and [BUILD.md](docs/BUILD.md).

## Features

- Wazuh v4/v5-released protocol (TCP 1514 + TLS enrollment 1515)
- Windows collectors: Security/System/Application event logs, Sysmon, Defender, PowerShell
- Linux collectors: journald, syslog, file tail
- Inventory sync, FIM, SCA compliance
- Durable event queue with crash recovery
- Active response (allowlisted actions only)
- Tamper detection, secure updater
- Localhost-only diagnostics API
- Tauri GUI: Dashboard, Collectors, Config, FIM, Compliance, Diagnostics

## Windows release build

```powershell
npm ci
npm run build:release          # full MSI — agent + GUI + shortcuts (WiX 4 + Rust)
$env:SKIP_GUI = "1"            # agent-only MSI, faster (no CUSA.exe)
npm run build:release
```

Build GUI only: `npm run build:gui` (Tauri → `build/gui/CUSA.exe`).

See **[BUILD.md](docs/BUILD.md)** for prerequisites, step-by-step builds, and install commands.

## Documentation

- **[Complete User Guide](docs/user-guide.md)** — start here: setup, every agent module, GUI pages, API reference, troubleshooting
- **[Windows Build Guide](docs/BUILD.md)** — MSI release pipeline
- [Enterprise Deployment](docs/enterprise-deployment.md)
- [Windows Installation](docs/windows-installation.md)
- [Architecture](docs/architecture.md)
- [Wazuh Compatibility](docs/wazuh-compatibility.md)
- [Event Schema](docs/event-schema.md)
- [Security Model](docs/security-model.md)

## License

Proprietary — CyberSIO
