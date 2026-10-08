# MSI Upgrade

Upgrading preserves ProgramData: config, secrets, queues, agent identity.

```powershell
msiexec /i CUSA-x64-1.0.1.msi /qn /norestart
```

The installer stops the service, replaces binaries, runs migrations, restarts the service.

**Never** deletes `secrets.enc` or `state.json` during upgrade.

If health check fails, roll back to the previous MSI build.
