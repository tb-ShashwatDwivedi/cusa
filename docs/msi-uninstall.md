# MSI Uninstall

## Normal uninstall (preserve data)

```powershell
msiexec /x CUSA-x64-1.0.0.msi /qn
```

Removes Program Files and service. Keeps `C:\ProgramData\CUSA\` for reinstall or forensics.

## Decommission + purge

```powershell
msiexec /x CUSA-x64-1.0.0.msi /qn PURGE_DATA=1
```

Removes identity, secrets, queues, and config from ProgramData.

## GUI decommission

Use **Decommission** in the console (does not uninstall MSI — only purges endpoint data).
