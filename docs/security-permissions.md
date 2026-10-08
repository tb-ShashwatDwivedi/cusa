# Security & Permissions

## Program Files (`C:\Program Files\CUSA\`)

- Administrators: Full Control
- SYSTEM: Full Control
- Users: Read & Execute

## ProgramData (`C:\ProgramData\CUSA\`)

| Path | Users |
|------|-------|
| `secrets\` | No access |
| `config\`, `queue\`, `state\` | No write |
| `logs\agent\` | Read optional |

## Local API

- Binds `127.0.0.1:8710` only
- Mutating endpoints require `Authorization: Bearer <token>` from `/api/status`
- No inbound firewall rule for 8710

## Secrets

- `secrets.enc` — AES-256-GCM
- Machine key via DPAPI on Windows (`cache/machine.key.dpapi`)
- Never logged or included in diagnostics
