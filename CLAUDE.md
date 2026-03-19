# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PM2 UI is a local-only web dashboard for managing PM2 processes. It runs as a monolithic Next.js app with a custom server that must be deployed on the same machine as the PM2 daemon. No authentication — designed for personal/small team use on trusted networks.

## Commands

```bash
yarn dev          # Dev server with file watching (node --watch server.js)
yarn build        # Production build (next build)
yarn start        # Production server (uses cross-env for Windows compat)
yarn lint         # ESLint (next/core-web-vitals)
yarn test         # Run tests (vitest run)
yarn test:watch   # Watch mode tests (vitest)
```

Package manager: **yarn** (yarn.lock present).

## Architecture

**Next.js 14 with App Router** + custom server (`server.js`). Path alias: `@/*` -> `./src/*`.

### Custom Server (`server.js`)
Single HTTP server running Next.js and WebSocket (`ws`) on the same port. Maintains a persistent PM2 connection, polls every ~8s (7829ms default), and broadcasts process list diffs to connected clients.

### Server Libraries (`src/lib/`)
- `pm2-manager.js` — PM2 abstraction: connect/disconnect, process listing, action execution, log reading, file tailing via `fs.watch`. Uses `_deps` pattern for testability.
- `ws-protocol.js` — Shared message type constants and JSON serialization helpers.

### Process Object Shape
Each process in the `PROCESS_LIST` WebSocket message has: `name`, `status`, `cpu`, `memory` (MB), `uptime` (formatted string), `pid`, `instanceId`, `port` (number from `PORT` env var, or null). To add new fields, extract from `proc.pm2_env` in `getProcessList()` — no protocol changes needed.

### WebSocket Protocol
Server→Client: `PROCESS_LIST`, `ACTION_RESULT`, `LOG_LINES`
Client→Server: `ACTION`, `SUBSCRIBE_LOGS`, `UNSUBSCRIBE_LOGS`

### Pages (`src/app/`)
- `/` — Dashboard (delegates to `components/dashboard.js`)
- `/logs/[appName]` — Log viewer (delegates to `components/log-viewer.js`)

### Components (`src/components/`)
All client components (`'use client'`). Dashboard consumes `usePM2` hook, log viewer consumes `useLogs` hook. Both hooks manage their own WebSocket connections with exponential backoff reconnection. Process cards are clickable when a `PORT` env var is set — interactive children (ProcessActions, log Link, chevron) use `e.stopPropagation()` to prevent triggering card-level navigation.

### Hooks (`src/hooks/`)
- `use-pm2.js` — WebSocket connection, process list state, action execution (promise-based with 10s timeout). Uses `wsRef.current !== ws` staleness guard for React Strict Mode safety.
- `use-logs.js` — Log stream subscription, stdout/stderr buffers (2000 line cap). Same staleness guard pattern.

## Environment

Configure via `.env.local` (not committed) or environment variables:
- `PORT` — Server port (default: 7829)
- `PM2_POLL_INTERVAL` — PM2 poll interval in ms (default: 7829)
- `LOG_LINES` — Initial log lines to load (default: 200)

## Docker

```bash
docker build -t pm2-ui .
docker run -v /root/.pm2:/root/.pm2 -p 7829:7829 pm2-ui
```

Must mount host PM2 socket directory for the app to communicate with the PM2 daemon.

## Testing

Uses Vitest. Tests in `__tests__/`:
- `ws-protocol.test.js` — Protocol constants and helpers
- `pm2-manager.test.js` — PM2 manager with mocked dependencies (`_deps` injection)

Run: `yarn test`

## Gotchas

- **CJS module format** — Server-side files (`server.js`, `src/lib/`) use CommonJS (`require`/`module.exports`). No `"type": "module"` in package.json. Vitest handles CJS interop automatically for test files using ESM imports.
- **Testing CJS with Vitest** — `vi.mock()` cannot intercept `require()` calls. Server modules use `_deps` injection pattern instead: `pm2Manager._deps.pm2 = mockPm2` in tests.
- **Client components in layout** — `src/app/layout.js` is a server component. Any client-side library (e.g., react-toastify) must be wrapped in a `'use client'` component (see `toast-provider.js`).
- **HeadlessUI v1** — `@headlessui/react ^1.7.17` uses `Popover.Button`/`Popover.Panel` API. Do not upgrade to v2 without migrating the API.
- **Not serverless-compatible** — Requires direct access to PM2 daemon socket. Must run as a persistent Node.js process on the PM2 host machine.
- **Dev script must use `--watch-path`** — `node --watch server.js` causes restart loops because Next.js writes to `.next/` during compilation, re-triggering the watcher. Always use `--watch-path=./server.js --watch-path=./src/lib` to scope it.
- **WSS must use `noServer: true`** — `WebSocketServer({ server })` intercepts ALL upgrade requests, stealing Next.js HMR. Must also no-op `app.setupWebSocketHandler` to prevent Next.js from registering a competing upgrade handler that kills WS connections matching page routes (`socket.end()`). HMR upgrades are delegated to `app.upgradeHandler`. Uses Next.js internals (`setupWebSocketHandler`, `upgradeHandler`) — re-verify on Next.js upgrades.
