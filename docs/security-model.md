# CUSA Security Model

---

## Threat Model

CUSA operates on endpoints that may be compromised. The agent must:

1. Protect its own integrity (tamper resistance)
2. Authenticate the Manager (no MITM)
3. Never execute arbitrary remote commands
4. Protect secrets at rest
5. Limit local API exposure
6. Prevent GUI users from escalating to system execution

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│ UNTRUSTED                                                │
│  - Endpoint users                                        │
│  - Potentially compromised processes on endpoint         │
│  - Network attackers                                     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ TRUST BOUNDARY: Localhost API (127.0.0.1 only)          │
│  - GUI reads status/config                               │
│  - No remote agent control                               │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ TRUSTED: CUSA Agent Service                              │
│  - Collectors, queue, executor, updater                  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ TRUST BOUNDARY: TLS + agent key / JWT + CMAC             │
│  - Wazuh Manager (tbSIEM)                                │
└─────────────────────────────────────────────────────────┘
```

---

## Authentication & Transport Security

### Wazuh Manager (released protocol)

| Control | Implementation |
|---------|---------------|
| Enrollment TLS | Verify manager certificate against configured CA |
| Data channel encryption | AES-128-CBC with key derived from enrollment secret |
| Manager identity | CA pin or certificate fingerprint in config |
| No TLS bypass | `rejectUnauthorized: true` always; no `NODE_TLS_REJECT_UNAUTHORIZED=0` |

### Wazuh Manager (HTTPS protocol — future)

| Control | Implementation |
|---------|---------------|
| TLS | Fail-closed; CA bundle required |
| JWT | Short-lived; refresh via re-enrollment on 401 |
| Request signing | AES-CMAC per Wazuh #37732 |
| No credential hardcoding | Secrets from secure storage only |

### Prohibited

- Disabling TLS verification
- Trusting arbitrary certificates
- Hard-coded secrets or API keys
- Silently changing manager identity

---

## Secret Storage

| Secret | Storage | Platform |
|--------|---------|----------|
| Agent enrollment key | Encrypted file or OS keychain | Windows DPAPI / Linux keyring |
| JWT tokens | Memory only (short-lived) | Runtime |
| Enrollment password | Encrypted config or env at install | DPAPI / keyring |
| CA certificates | Read-only config directory | File system |

Secrets never appear in:
- Logs (redacted by Pino serializers)
- Local API responses
- GUI display (masked if shown)
- Wazuh wire format `metadata` fields

---

## Active Response Security

### Allowlist Model

CUSA never exposes `POST /execute { command: "..." }`.

Supported actions (explicit allowlist):

| Action ID | Description | Privilege required |
|-----------|-------------|-------------------|
| `terminate_process` | Kill process by PID | Agent service account |
| `block_ip` | Add firewall rule | Agent service account |
| `approved_script` | Run signed script by ID | Agent service account |
| `restart_agent` | Restart CUSA service | Agent service account |
| `reload_config` | Reload configuration | Agent service account |

### Execution Flow

```
command received (from Manager)
  → transport authentication (encrypted channel / JWT)
  → signature verification (where required)
  → JSON Schema validation
  → allowlist validation (action ID must be in ALLOWED_ACTIONS)
  → authorization check (RBAC mapping if configured)
  → target validation (PID exists, IP format valid, script ID registered)
  → persist command to queue (before execution)
  → execute with timeout
  → capture result + audit log
  → send result to Manager
```

### Custom Scripts

- Only pre-registered script IDs may execute
- Scripts stored in read-only agent directory
- SHA-256 hash verified at registration and before each execution
- Optional GPG/code signature verification
- No dynamic script content from Manager

### Prohibited

- Arbitrary shell commands from Manager
- Script content in command payload
- Execution without allowlist match
- Direct execution from HTTP/API parser (must go through command queue)

---

## Update Security

```
manifest received
  → version validation (must be > current, < max_allowed)
  → publisher signature verification (GPG or code signing cert)
  → checksum validation (SHA-256)
  → download over TLS
  → stage to isolated directory
  → verify staged binary signature
  → replace service binary
  → restart
  → health check (30s timeout)
  → rollback on failure
```

| Control | Requirement |
|---------|-------------|
| Unsigned updates | **Rejected** |
| Downgrade | **Rejected** (unless explicit rollback to last-known-good) |
| Tamper during update | Update lock prevents false tamper alerts |

Authorized updates set an `updateInProgress` flag that disables tamper detection for the agent binary path.

---

## Tamper Detection

Monitored paths:

| Target | Detection |
|--------|-----------|
| Agent executable | Hash comparison on interval |
| Configuration files | Hash + permission check |
| State database | Integrity checksum |
| Certificates/keys | Hash + permission check |
| Active response scripts | Hash at load time |

On unexpected modification:
1. Log alert (high severity)
2. Queue tamper event to Manager
3. Do NOT auto-execute remediation (Manager decides)

Authorized updates and config reloads set temporary exemptions.

---

## Local API Security

| Control | Value |
|---------|-------|
| Bind address | `127.0.0.1` only |
| Port | Configurable, default `8710` |
| Authentication | Optional local token (Phase 9 GUI) |
| CORS | Disabled |
| Control endpoints | **None** — read-only diagnostics only |

The GUI communicates with the local API. It cannot:
- Execute active response
- Modify manager-locked config
- Bypass enrollment

---

## Configuration Security

### Manager-enforced settings

Fields marked `locked: true` in effective config:
- Cannot be changed via GUI
- Cannot be overridden by local config file
- Source displayed as "CyberSIO Policy" / "Central"

### Config apply flow

```
receive config
  → authenticate source (manager signature or hash match)
  → validate against JSON Schema
  → compare version number
  → stage to temp location
  → apply to runtime
  → health check collectors + transport
  → commit (or rollback to last-known-good)
```

### Config integrity

- Manager config hash tracked (matches Wazuh `config_hash` / `settings_hash` where available)
- Local modifications to locked fields are rejected at apply time

---

## Privilege Model

| Component | Windows | Linux |
|-----------|---------|-------|
| Agent service | Local System or dedicated service account | Dedicated `cusa` user with minimal capabilities |
| Collectors | Service account (elevated for Security log) | `cusa` + capabilities (audit, sys admin as needed) |
| Active response | Service account | `cusa` + `CAP_NET_ADMIN` for IP blocking |
| GUI | Standard user | Standard user |

GUI users cannot escalate to agent service privileges. IPC is read-only diagnostics.

---

## Logging Security

- Pino redaction paths: `*.password`, `*.key`, `*.token`, `*.secret`, `authorization`
- Audit log for: enrollment, config changes, active response execution, update attempts, tamper detection
- Audit events queued to Manager with `event.category: "configuration"` or `"intrusion_detection"`

---

## Network Security

| Connection | Direction | Port | Protocol |
|------------|-----------|------|----------|
| Manager data | Outbound | 1514 | TCP + AES |
| Manager enrollment | Outbound | 1515 | TLS |
| Manager API (optional) | Outbound | 55000 | HTTPS |
| Local API | Inbound localhost | 8710 | HTTP |
| GUI | Local IPC | — | Tauri |

No inbound connections required on the endpoint firewall (except localhost).

---

## Security Testing Requirements

| Area | Tests |
|------|-------|
| Certificate validation | Reject self-signed without CA, reject expired, accept valid |
| Config signatures | Reject tampered config, accept valid |
| Active response | Reject unknown action, reject arbitrary command, accept allowlisted |
| Update signatures | Reject unsigned, reject wrong checksum, accept valid |
| Tamper detection | Detect binary modification, ignore during authorized update |
| Secret handling | No secrets in logs, no secrets in API responses |
| Local API | Reject non-localhost connections |

---

## Incident Response

If agent integrity is compromised:

1. Tamper event sent to Manager
2. Agent continues operating in degraded mode (collect + queue, no execute)
3. Manager can issue `restart_agent` or push update
4. Operator can decommission via MSI uninstall

CUSA does not implement self-destruct or remote wipe capabilities.
