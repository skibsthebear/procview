# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Procview is a local-only web dashboard for managing all your running processes — PM2 apps, Docker containers, and standalone system processes — in one place. It runs as a monolithic Next.js app with a custom server that must be deployed on the same machine as the monitored processes. Uses SQLite for settings persistence. No authentication — designed for personal/small team use on trusted networks.

## Commands

```bash
yarn dev          # Dev server with file watching (node --watch server.js)
yarn build        # Production build (next build)
yarn start        # Production server (uses cross-env for Windows compat)
yarn lint         # ESLint (next/core-web-vitals)
yarn test         # Run tests (vitest run)
yarn test:watch   # Watch mode tests (vitest)
```

```bash
pm2 start ecosystem.config.js   # Start with PM2 (fork mode, default port 7829)
pm2 stop procview               # Stop
pm2 delete procview             # Stop and remove from PM2 list
```

```powershell
.\start.ps1                  # Production mode with rebuild (default)
.\start.ps1 -Mode dev        # Dev mode with hot-reload
.\start.ps1 -Dev             # Dev mode shorthand
.\start.ps1 -Build:$false    # Production without rebuilding
.\start.ps1 -Port 3000       # Custom port
.\restart.ps1                # Rebuild and restart PM2 process
.\restart.ps1 -SkipBuild     # Restart PM2 without rebuilding (server-side only changes)
```

Package manager: **yarn** (yarn.lock present).

## Architecture

**Next.js 14 with App Router** + custom server (`server.js`). Path alias: `@/*` -> `./src/*`.

### Custom Server (`server.js`)
Single HTTP server running Next.js and WebSocket (`ws`) on the same port. Initialises the collector registry on startup, which polls four independent sources (PM2, Docker, System, Tailscale) and broadcasts process list diffs to connected clients. Also serves `GET /api/settings` for initial settings load.

### Server Libraries (`src/lib/`)
- `pm2-manager.js` — PM2 abstraction: connect/disconnect, process listing, action execution, log reading, file tailing via `fs.watch`. Uses `_deps` pattern for testability.
- `ws-protocol.js` — Shared message type constants and JSON serialization helpers.
- `db.js` — SQLite layer (via `better-sqlite3`). Persists per-process settings (display name, notes, hidden flag). Auto-creates the `data/` directory and database file on first run. Uses `_deps` pattern for testability.
- `collector-registry.js` — Orchestrates all collectors. Each collector polls independently on its own interval. The registry merges results into a unified process list, applies settings overrides from `db.js`, and broadcasts diffs via WebSocket. Collectors that fail repeatedly are marked with `status: 'error'` in `COLLECTOR_STATUS` messages without affecting other sources.
- `src/lib/collectors/pm2-collector.js` — Collects PM2 processes. Emits processes with `source: 'pm2'`. Supports start/stop/restart/reload/delete actions and log streaming.
- `src/lib/collectors/docker-collector.js` — Collects Docker containers via `dockerode`. Auto-detects Docker socket (`/var/run/docker.sock` on Linux/macOS, named pipe on Windows). Emits processes with `source: 'docker'`. Supports start/stop/restart actions and log streaming.
- `src/lib/collectors/system-collector.js` — Collects system processes listening on ports via `ss`/`netstat`. Emits processes with `source: 'sys'`. Supports kill action. No log streaming (`hasLogs: false`).
- `src/lib/collectors/tailscale-collector.js` — Collects Tailscale Serve/Funnel rules via `tailscale serve status --json` and `tailscale status --json` CLI calls. Emits processes with `source: 'tailscale'`. Supports remove/upgrade/downgrade/login/add-serve/add-funnel actions. No log streaming (`hasLogs: false`). `_deps` pattern with `{ exec }` for testability. Implements `getMetadata()` returning `{ hostname }` for COLLECTOR_STATUS metadata.

### Process Object Shape
Each process in the `PROCESS_LIST` WebSocket message has:
- `id` — Unique stable identifier. Format: `pm2:<name>` / `docker:<shortContainerId>` / `sys:<port>:<name>` / `ts:<protocol>:<port>:<path>`
- `source` — `'pm2'` | `'docker'` | `'sys'` | `'tailscale'`
- `name` — Display name (may be overridden by user settings)
- `status` — Normalised status string (`'online'`, `'stopped'`, `'errored'`, etc.)
- `cpu` — CPU usage percentage
- `memory` — Memory usage in MB
- `uptime` — Formatted uptime string
- `pid` — Process ID (number or null)
- `instanceId` — PM2 cluster instance index (PM2 only, or null)
- `ports` — Array of port numbers the process listens on (empty array if none)
- `groupId` — Groups cluster instances or compose services (e.g. PM2 app name, compose project)
- `containerId` — Full Docker container ID (Docker only, or null)
- `image` — Docker image name (Docker only, or null)
- `composeProject` — Docker Compose project name (Docker only, or null)
- `composeService` — Docker Compose service name (Docker only, or null)
- `actions` — Array of action strings available for this process (e.g. `['start','stop','restart','reload','delete']`)
- `hasLogs` — Boolean; whether live log streaming is supported for this process
- `tsType` — `'serve'` | `'funnel'` (Tailscale only, or undefined)
- `tsProtocol` — `'https'` | `'tcp'` (Tailscale only, or undefined)
- `tsExternalPort` — External port number (Tailscale only, or undefined)
- `tsPath` — Path prefix, e.g. `'/'` or `'/api'` (Tailscale only, or undefined)
- `tsLocalTarget` — Local target string, e.g. `'http://127.0.0.1:3000'` (Tailscale only, or undefined)
- `tsTailnetUrl` — Full tailnet URL (Tailscale HTTPS only, or null)
- `tsPublicUrl` — Public URL (Tailscale funnels only, or null)
- `tsNodeStatus` — `'connected'` | `'needs-login'` | `'stopped'` (Tailscale only, or undefined)

To add new fields for a source, extract the value in the relevant collector's collection method — no protocol changes needed.

### WebSocket Protocol
Server→Client: `PROCESS_LIST`, `ACTION_RESULT`, `LOG_LINES`, `COLLECTOR_STATUS`, `SETTINGS_RESULT`
Client→Server: `ACTION`, `SUBSCRIBE_LOGS`, `UNSUBSCRIBE_LOGS`, `UPDATE_SETTINGS`

- `COLLECTOR_STATUS` — Broadcasts the health of each collector (`pm2`, `docker`, `sys`, `tailscale`) with a status of `'ok'` or `'error'` and an optional error message.
- `SETTINGS_RESULT` — Response to `UPDATE_SETTINGS`; contains the saved settings object and a success/error flag.
- `ACTION` — Client sends to execute a process action. Payload: `{ id, source, processId, action, params? }`. The optional `params` object is used by Tailscale `add-serve`/`add-funnel` actions.
- `UPDATE_SETTINGS` — Client sends to persist per-process settings (display name, notes, hidden). Payload: `{ processId, settings }`.

### REST Endpoints
- `GET /api/settings` — Returns all persisted process settings from the SQLite database. Used on initial page load before the WebSocket is established.

### Pages (`src/app/`)
- `/` — Dashboard (delegates to `components/dashboard.js`)
- `/logs/[source]/[processId]` — Log viewer (delegates to `components/log-viewer.js`). The `source` segment is `pm2`, `docker`, or `sys`. The `processId` segment is URL-encoded.

### Components (`src/components/`)
All client components (`'use client'`). Key components:
- `dashboard.js` — Consumes `useProcesses` and `useSettings` hooks. Renders the process list with filtering and grouping.
- `process-card.js` — Renders a single process. Displays a source badge (`PM2`, `Docker`, `SYS`) alongside the process name and status. Clickable to open the first available port in a browser tab when `ports` is non-empty — interactive children (ProcessActions, log Link, chevron) use `e.stopPropagation()`.
- `process-actions.js` — Renders action buttons driven by the `actions` array on each process object. Only renders buttons for actions present in the array.
- `settings-modal.js` — Modal for editing per-process settings (display name, notes, hidden). Sends `UPDATE_SETTINGS` via WebSocket and awaits `SETTINGS_RESULT`.
- `filter-bar.js` — Search/filter input with right-click context menu on filter buttons ("Select only" / "Select all"). Filters by name, status, or source. Dashboard passes `onSelectOnly`/`onSelectAll` handlers as props.
- `log-viewer.js` — Consumes `useLogs` hook. Displays live stdout/stderr streams for PM2 and Docker processes.
- `navbar.js` — Top navigation bar.
- `status-badge.js` — Reusable status indicator pill.
- `toast-provider.js` — Wraps `react-toastify` in a `'use client'` boundary (required because `src/app/layout.js` is a server component).
- `tailscale-modal.js` — Modal for creating new Tailscale Serve/Funnel rules. Accepts `tsHostname`, `tsProcesses`, `onAdd`, `onClose` props. Validates port/path, shows URL preview, tracks funnel slot usage (3 max).

### Hooks (`src/hooks/`)
- `use-processes.js` — WebSocket connection, unified process list state, action execution (promise-based with 10s timeout). Replaces the old `use-pm2.js`. Uses `wsRef.current !== ws` staleness guard for React Strict Mode safety.
- `use-settings.js` — Fetches initial settings via `GET /api/settings`, then listens for `SETTINGS_RESULT` messages to keep local state in sync. Exposes `updateSettings(processId, settings)` which sends `UPDATE_SETTINGS` over the shared WebSocket.
- `use-logs.js` — Log stream subscription, stdout/stderr buffers (2000 line cap). Same staleness guard pattern as `use-processes.js`.

## Environment

Configure via `.env.local` (not committed) or environment variables:
- `PORT` — Server port (default: 7829)
- `PM2_POLL_INTERVAL` — PM2 poll interval in ms (default: 7829)
- `DOCKER_POLL_INTERVAL` — Docker poll interval in ms (default: 10000)
- `SYSTEM_POLL_INTERVAL` — System process poll interval in ms (default: 30000)
- `COLLECTOR_RETRY_INTERVAL` — Interval in ms before retrying a failed collector (default: 30000)
- `COLLECTOR_MAX_FAILURES` — Number of consecutive failures before a collector is marked degraded (default: 3)
- `LOG_LINES` — Initial log lines to load (default: 200)
- `DATABASE_PATH` — Path to the SQLite database file (default: `./data/procview.db`)
- `TAILSCALE_POLL_INTERVAL` — Tailscale poll interval in ms (default: 15000)

## Testing

Uses Vitest. Tests in `__tests__/`:
- `ws-protocol.test.js` — Protocol constants and helpers
- `pm2-manager.test.js` — PM2 manager with mocked dependencies (`_deps` injection)
- `db.test.js` — SQLite settings layer with mocked `better-sqlite3` via `_deps` injection
- `collector-registry.test.js` — Collector orchestration, merging, and diff broadcasting
- `pm2-collector.test.js` — PM2 collector with mocked PM2 dependency
- `docker-collector.test.js` — Docker collector with mocked `dockerode` dependency
- `system-collector.test.js` — System collector with mocked `child_process` dependency
- `tailscale-collector.test.js` — Tailscale collector with mocked `_deps.exec` (`child_process.execFile`)

Run: `yarn test`

## Gotchas

- **PM2 fork mode only** — `ecosystem.config.js` uses fork mode. The custom server holds WebSocket state in-process (`logSubscriptions`, `cachedProcessList`) and maintains a PM2 daemon connection, so cluster mode is not viable.
- **Windows PM2 persistence** — `pm2 startup` does not work on Windows. Use `pm2-windows-startup` (`npm i -g pm2-windows-startup && pm2-startup install && pm2 save`).
- **CJS module format** — Server-side files (`server.js`, `src/lib/`) use CommonJS (`require`/`module.exports`). No `"type": "module"` in package.json. Vitest handles CJS interop automatically for test files using ESM imports.
- **Testing CJS with Vitest** — `vi.mock()` cannot intercept `require()` calls. Server modules use `_deps` injection pattern instead: `pm2Manager._deps.pm2 = mockPm2` in tests.
- **Client components in layout** — `src/app/layout.js` is a server component. Any client-side library (e.g., react-toastify) must be wrapped in a `'use client'` component (see `toast-provider.js`).
- **HeadlessUI v1** — `@headlessui/react ^1.7.17` uses `Popover.Button`/`Popover.Panel` API. Do not upgrade to v2 without migrating the API.
- **`glass-card` stacking context** — `backdrop-filter` on `.glass-card` creates a CSS stacking context. Dropdowns/popovers inside cards need the parent card elevated with `z-20 relative` when open, otherwise sibling cards will overlap them. Do not use `overflow-hidden` on the card itself — scope overflow containment to inner content divs only, or popover panels will be clipped.
- **Not serverless-compatible** — Requires direct access to PM2 daemon socket and the host filesystem. Must run as a persistent Node.js process on the host machine.
- **Dev script must use `--watch-path`** — `node --watch server.js` causes restart loops because Next.js writes to `.next/` during compilation, re-triggering the watcher. Always use `--watch-path=./server.js --watch-path=./src/lib` to scope it.
- **WSS must use `noServer: true`** — `WebSocketServer({ server })` intercepts ALL upgrade requests, stealing Next.js HMR. Must also no-op `app.setupWebSocketHandler` to prevent Next.js from registering a competing upgrade handler that kills WS connections matching page routes (`socket.end()`). HMR upgrades are delegated to `app.upgradeHandler`. Uses Next.js internals (`setupWebSocketHandler`, `upgradeHandler`) — re-verify on Next.js upgrades.
- **`better-sqlite3` native build** — `better-sqlite3` is a native Node.js addon and must be compiled for the current platform. Run `yarn install` after cloning on a new machine. If you see `MODULE_NOT_FOUND` for a `.node` file, run `npm rebuild better-sqlite3` or `yarn add better-sqlite3 --force`.
- **Docker socket auto-detection** — `docker-collector.js` auto-detects the Docker socket path: `/var/run/docker.sock` on Linux/macOS, `//./pipe/docker_engine` on Windows. If Docker Desktop is not running, the collector will fail gracefully and be marked as degraded — other collectors continue unaffected.
- **`dockerode` `_deps` pattern** — `docker-collector.js` uses `_deps.Docker` as a factory function (not a constructor). Call it as `this._deps.Docker()`, not `new this._deps.Docker()`, so test mocks using arrow functions work correctly.
- **`data/` directory auto-creation** — `db.js` creates the `data/` directory and SQLite database file automatically on first run. The `data/` directory is gitignored. Do not commit `data/procview.db`.
- **Server shutdown** — `server.js` shutdown handler uses a `shuttingDown` guard to prevent duplicate SIGINT/SIGTERM firings. Must `terminate()` all WebSocket clients before `server.close()`, otherwise the callback hangs waiting for open connections to drain. Has a 3-second `setTimeout(...).unref()` fallback.
- **Tailscale CLI dependency** — `tailscale-collector.js` shells out to the `tailscale` CLI binary. The CLI must be installed and on PATH. If Tailscale is not installed, the collector fails gracefully on connect and is marked degraded — other collectors continue unaffected.
- **Funnel port limit** — Tailscale Funnel is limited to 3 ports per node (443, 8443, 10000). TCP serves cannot be upgraded to funnels. The modal enforces both constraints.
- **`COLLECTOR_STATUS` metadata** — `getCollectorStatus()` now includes an optional `metadata` field per collector. The Tailscale collector uses this to pass its hostname to the client for URL previews. Other collectors return `{}`.
