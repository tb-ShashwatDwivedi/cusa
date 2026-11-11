# CUSA Agent — Implementation Progress (Cons & Missing-Feature Remediation)

**Date:** 2026-11-11
**Scope:** Close the gaps identified in the 40-point QA matrix and the architectural
"cons" review. Code changes only — **nothing in this pass was executed against a live
Wazuh manager or a real MSI/deb/rpm install.** Each JS file edited was validated with
`node --check` (parser-only) and `config/default.json` was validated with `JSON.parse`.

Legend: ✅ done & self-contained · †code-complete, needs live-manager / on-host E2E.

---

## 0. Cross-cutting fixes (the "cons")

| Con (from review) | Fix | Files |
|---|---|---|
| 3 different "manager config" roots (secrets-relative vs dataDir-relative vs `dirname(dataDir)`) | Single canonical `manager/` dir plumbed everywhere | `platform/paths.js`, `wazuh/client.js`, `wazuh/v4/client.js`, `core/agent.js`, `wazuh/v4/central-config.js` |
| Security posture opt-in (`insecure:true`, TLS verify off) | Secure-by-default (`insecure:false`), TLS verification + CA on authd & API | `config/default.json`, `wazuh/v4/enrollment.js`, `wazuh/v4/api-enrollment.js`, `wazuh/v4/client.js` |
| Config-as-product (features inert by default) | New config blocks + GUI fields + baseline persistence so features actually run once configured | `config/default.json`, `gui/.../Configuration.jsx`, `fim/watcher.js` |
| Wazuh-parity bolted on (FIM custom queue 1) | Added native syscheck (queue 8) option + stock AR wire parsing | `fim/wire-event.js`, `wazuh/v4/commands.js` |
| Docs overstate reality (35/40 "Full", 0 None) | Rewrote `architecture.md` matrix with honest `Full†` caveat + this doc | `docs/architecture.md`, `docs/security-model.md` |

---

## 1. Secure agent communication — #5 / CYB-5300 ✅†

- `config/default.json`: `wazuh.enrollment.insecure` → **`false`**.
- `wazuh/v4/enrollment.js` (authd/1515): `rejectUnauthorized` now derives from `insecure`
  (fail-closed) and still accepts `ca`.
- `wazuh/v4/api-enrollment.js` (API/55000): all requests pass `ca` and keep
  `rejectUnauthorized: insecure !== true`.
- `wazuh/v4/client.js`: `enroll()` passes `insecure`/`caCert` into both paths.
- GUI: "Allow insecure TLS (lab only)" toggle.
- Doc: `security-model.md` TLS-defaults section.

**Caveat:** against a stock self-signed manager the operator must now supply `caCert`
or explicitly set `insecure:true`. That is the intended fail-closed behavior.

## 2. Central configuration / manager control plane — #6, #16, #25 / CYB-6085 ✅†

The single biggest root cause. Implemented the remoted **shared-file push** so the manager
can actually deliver `agent.conf` / `merged.mg` over the wire instead of requiring a manual
drop on disk.

- `platform/paths.js`: added `managerDir`, `managerAgentConf`, `managerMergedMg` (one root).
- `wazuh/v4/client.js`:
  - `handleSharedFilePush()` accumulates `#!-up file <name> <md5>` … `#!-close file`,
    writes to `manager/<name>`, unwraps `agent.conf` from `merged.mg`, fires `onManagerFile`.
  - `resolveKeepaliveHashes()` now advertises the **real** `merged.mg` md5 (was always "absent").
  - `fetchConfiguration()` uses the unified `managerDir` (removed the `dirname(dataDir)` bug).
- `wazuh/v4/central-config.js`:
  - `loadManagerAgentConf(managerDir)` takes the manager dir directly; unwraps merged.mg.
  - `extractMergedFile()` parses the `!<len> <name>` merged bundle format.
  - `parseWazuhAgentConf()` now also reads `<windows_registry>` (→ registry.keys) and
    **prunes empty sections** so a sparse agent.conf can't wipe local config.
  - `mergeManagerPatch()` merges `registry.keys`.
- `core/agent.js`: `syncManagerConfig()` reads the unified dir; `registerWazuhHandlers()`
  subscribes to `onManagerFile` → immediate re-sync.
- `wazuh/client.js`: facade passes `managerDir` and exposes `onManagerFile`.

**Caveat:** the exact remoted framing/chunking varies by manager build; the accumulator is
best-effort and needs validation against the live 4.11.2 manager.

## 3. FIM — #12, #13 / CYB-5996, CYB-6031 ✅†

- `fim/watcher.js`: `start()` now calls `state.save()` after the initial baseline walk
  (baseline was previously memory-only until the first change → GUI/API showed empty).
- `fim/wire-event.js`: added `fimItemToSyscheckEvent()` — native Wazuh syscheck JSON on
  **queue 8** (location `syscheck`) so stock FIM rules/dashboards light up.
- `core/agent.js`: picks `fimItemToSyscheckEvent` when `fim.native:true`, else the existing
  custom queue-1 event. Applied in both `start()` and `reloadConfig()`.
- `config/default.json`: `fim` block gains `native`, `maxBaselineFiles`, `maxDepth`, `excludePaths`.

## 4. Registry monitoring — #14 ✅†

- `config/default.json`: added a `registry` block (`keys:[]`, `intervalMs`).
- Keys now come from config, the GUI (comma-separated field), or manager-pushed
  `<windows_registry>` entries in agent.conf (see §2).

## 5. Custom log file monitoring — #9 / CYB-6110 ✅

- `collectors.fileTail` is configurable and now exposed in the GUI (enable + paths).
  The collector itself already tailed correctly; the gap was config/UI surface.

## 6. Log filtering UI — #10 ✅

- `gui/.../Configuration.jsx`: new "Log filtering" section with `filters.defaultAction`
  (select) and a `filters.filters` JSON-array editor (new `json` field type → textarea,
  parsed on save, invalid JSON surfaced as a save error). The `pipeline/filter.js` engine
  was already complete.

## 7. Active Response (framework + actions) — #35–38 / CYB-6106 ✅†

- `wazuh/v4/commands.js`: `parseManagerCommand()` now detects the **stock Wazuh AR JSON**
  (`{version, origin, command, parameters}`) via `parseActiveResponse()`:
  - `firewall-drop`/`host-deny`/`win_firewall` → `block_ip` (+ add/delete from trailing 0/1)
  - `kill-process`/`pid` → `terminate_process`
  - `restart-wazuh`/`restart` → `restart_agent`
  - unknown command name → `approved_script` (operator registers it under that name)
  - extracts `srcip`/`pid` from `parameters.alert.data`.
- `active-response/executor.js`: gated response actions behind `activeResponse.enabled`;
  `block_ip` now supports **delete** (AR `...1`) for `netsh`/`iptables`.
- `core/agent.js`: passes `enabled` to the executor.
- The executor + allowlist + durable audit log (#39) were already working locally — this
  wires the **manager → agent** trigger path that was missing.

## 8. Remote restart — #32 ✅

- Already reachable via `/api/service/restart` and the `restart_agent` executor action;
  now also via stock AR `restart`/`restart-wazuh` (see §7). No matrix regression.

## 9. Agent upgrade — #33 ✅†

- `updater/updater.js`: `requireSignature` (default **true**) — unsigned manifests and
  missing public keys are now rejected (was: unsigned allowed when no key configured).
- `config/default.json`: `updater.requireSignature:true`, `publicKeyPem:null` placeholder.
- `core/agent.js`: passes `requireSignature`; after an authorized update calls
  `tamper.trust()` to re-arm the broadened tamper baseline.
- **Caveat:** MSI/service upgrade orchestration + rollback remain out of scope here.

## 10. Tamper detection — #40 / CYB-6107 ✅

- `security/tamper.js`: `check()` now **alerts once** per changed path and **holds
  last-known-good** (baseline not mutated on change); re-arms when a path reverts.
  Added `trust()` for explicit re-trust and an `enabled` gate.
- `core/agent.js`: broadened watched paths to the install dir, config dir, deploy manifest,
  install marker, plus operator `tamper.paths`; passes `enabled`/`alertOnce`.
- `config/default.json`: `tamper` block.

## 11. Rootkit / suspicious system check — #15 / CYB-6108 ✅

- Was already implemented + scheduled (matrix "Not Supported" was inaccurate). Now
  config-gated via `rootkit.enabled`/`rootkit.intervalMs`.

## 12. Vulnerability detection input — #24 ✅†

- `inventory/vuln-input.js` (new): optional on-box CVE correlation — `compareVersions`,
  `versionAffected`, `correlateVulnerabilities(packages, feed)`, `loadCveFeed()`.
- `core/agent.js`: `runVulnerabilityScan()` scheduled when `vulnerability.enabled` +
  `feedPath` set; emits `vulnerability` events. Authoritative CVE correlation remains
  manager-side (Wazuh vuln-detector); this is a complementary on-box path.
- `config/default.json`: `vulnerability` block (disabled by default).

## 13. Linux log collection / packaging — #8 / CYB-6109 ✅†

- Collectors (`journald`/`syslog`/`auditd`) already existed; the gap was no install path.
- Added `installer/linux/build-deb.sh` and `build-rpm.sh` (service user, enable/start,
  config seed, unit install).
- Hardened `installer/linux/cusa-agent.service` (`CUSA_DATA_DIR=/var/lib/cusa`,
  `NoNewPrivileges`, `ProtectSystem=full`, `ReadWritePaths`).

## 14. Decommission / uninstall — #34 / CYB-6092 ✅†

- `wazuh/v4/api-enrollment.js`: `deregisterAgent()` (DELETE `/agents`) so the identity is
  removed from the manager key store, not just wiped locally.
- `core/agent.js`: `decommission()` best-effort deregisters before local purge.
- `platform/decommission.js`: purge now also removes the `manager/` dir.

---

## Files changed

**Agent (code):** `config/default.json`, `src/platform/paths.js`,
`src/platform/decommission.js`, `src/wazuh/client.js`, `src/wazuh/v4/client.js`,
`src/wazuh/v4/central-config.js`, `src/wazuh/v4/commands.js`, `src/wazuh/v4/enrollment.js`,
`src/wazuh/v4/api-enrollment.js`, `src/core/agent.js`, `src/fim/watcher.js`,
`src/fim/wire-event.js`, `src/security/tamper.js`, `src/active-response/executor.js`,
`src/updater/updater.js`, `src/inventory/vuln-input.js` (new).

**GUI:** `gui/src/pages/Configuration.jsx`.

**Installer:** `installer/linux/build-deb.sh` (new), `installer/linux/build-rpm.sh` (new),
`installer/linux/cusa-agent.service`.

**Docs:** `docs/architecture.md`, `docs/security-model.md`, `docs/IMPLEMENTATION-PROGRESS.md` (this file).

---

## Verification status & remaining work

- ✅ `node --check` passes on every edited `.js`; `default.json` parses.
- ⬜ **Not run:** the agent, unit tests (`node --test`), GUI build, or any live-manager E2E.
- ⬜ Validate remoted shared-file framing (#6) and stock AR JSON (#35–38) against the real
  Wazuh 4.11.2 manager build; confirm advertised `merged.mg` md5 matches the manager's.
- ⬜ Validate deb/rpm on target distros and MSI upgrade/rollback (#1, #33).
- ⬜ Add unit tests for `extractMergedFile`, `parseActiveResponse`, `correlateVulnerabilities`,
  and the tamper alert-once logic.
