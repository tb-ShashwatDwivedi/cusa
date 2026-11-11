# Dev progress (agent notes)

## 2026-03-28 — `.gitignore` aligned with CUSA layout

- Expanded root `.gitignore`: Node deps, local config/secrets, `build/` + `dist/`, WiX artifacts, all three Rust `target/` trees (`src-tauri`, `service-host`, `updater-stub`), Vite/eslint caches, coverage, OS/IDE junk.
- Dev/runtime: `**/.cusa/`, `agent.pid`, `memory-benchmark.jsonl`.
- **Note:** `service-host/target/` (and similar) already tracked in git stay tracked until removed with `git rm -r --cached service-host/target` (optional cleanup).
