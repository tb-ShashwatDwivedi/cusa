# CUSA Windows Service

| Property | Value |
|----------|-------|
| Service name | `CUSAAgent` |
| Display name | CUSA Unified Security Agent |
| Binary | `C:\Program Files\CUSA\agent\cusa-service-host.exe` |
| Account | LocalSystem |
| Start | Automatic |

The service host spawns `cusa-agent.exe` with:

- `CUSA_DATA_DIR=C:\ProgramData\CUSA`
- `CUSA_CONFIG=C:\Program Files\CUSA\agent\config\default.json`

## Commands

```powershell
sc query CUSAAgent
sc stop CUSAAgent
sc start CUSAAgent
```

## Recovery

On failure: restart after 5s / 10s / 30s (configured in MSI).

## GUI vs service

Closing the GUI does **not** stop the service. The agent runs independently.
