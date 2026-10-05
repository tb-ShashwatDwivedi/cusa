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

Requires [Rust](https://rustup.rs/) and Tauri CLI:

```bash
cargo install tauri-cli
cd gui && npm install && npm run build
cd ../src-tauri && cargo tauri dev
```

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

## Documentation

- **[Complete User Guide](docs/user-guide.md)** — start here: setup, every agent module, GUI pages, API reference, troubleshooting
- [Architecture](docs/architecture.md)
- [Wazuh Compatibility](docs/wazuh-compatibility.md)
- [Event Schema](docs/event-schema.md)
- [Security Model](docs/security-model.md)

## License

Proprietary — CyberSIO
