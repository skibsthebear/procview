# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PM2 UI is a local-only web dashboard for managing PM2 processes. It runs as a monolithic Next.js app with a custom server that must be deployed on the same machine as the PM2 daemon. No authentication — designed for personal/small team use on trusted networks.

## Commands

```bash
yarn dev          # Dev server with file watching (node --watch server.js)
yarn build        # Production build (next build)
yarn start        # Production server (NODE_ENV=production node server.js)
yarn lint         # ESLint (next/core-web-vitals)
yarn test         # Run tests (vitest run)
yarn test:watch   # Watch mode tests (vitest)
```

Package manager: **yarn** (yarn.lock present).

## Architecture

**Next.js 14 with App Router** + custom server (`server.js`). Path alias: `@/*` -> `./src/*`.

### Custom Server (`server.js`)
Single HTTP server running Next.js and WebSocket (`ws`) on the same port. Maintains a persistent PM2 connection, polls every 3s, and broadcasts process list diffs to connected clients.

### Server Libraries (`src/lib/`)
- `pm2-manager.js` — PM2 abstraction: connect/disconnect, process listing, action execution, log reading, file tailing via `fs.watch`. Uses `_deps` pattern for testability.
- `ws-protocol.js` — Shared message type constants and JSON serialization helpers.

### WebSocket Protocol
Server→Client: `PROCESS_LIST`, `ACTION_RESULT`, `LOG_LINES`
Client→Server: `ACTION`, `SUBSCRIBE_LOGS`, `UNSUBSCRIBE_LOGS`

### Pages (`src/app/`)
- `/` — Dashboard (delegates to `components/dashboard.js`)
- `/logs/[appName]` — Log viewer (delegates to `components/log-viewer.js`)

### Components (`src/components/`)
All client components (`'use client'`). Dashboard consumes `usePM2` hook, log viewer consumes `useLogs` hook. Both hooks manage their own WebSocket connections with exponential backoff reconnection.

### Hooks (`src/hooks/`)
- `use-pm2.js` — WebSocket connection, process list state, action execution (promise-based with 10s timeout)
- `use-logs.js` — Log stream subscription, stdout/stderr buffers (2000 line cap)

## Environment

Configure via `.env.local` (not committed) or environment variables:
- `PORT` — Server port (default: 3000)
- `PM2_POLL_INTERVAL` — PM2 poll interval in ms (default: 3000)
- `LOG_LINES` — Initial log lines to load (default: 200)

## Docker

```bash
docker build -t pm2-ui .
docker run -v /root/.pm2:/root/.pm2 -p 3000:3000 pm2-ui
```

Must mount host PM2 socket directory for the app to communicate with the PM2 daemon.

## Testing

Uses Vitest. Tests in `__tests__/`:
- `ws-protocol.test.js` — Protocol constants and helpers
- `pm2-manager.test.js` — PM2 manager with mocked dependencies (`_deps` injection)

Run: `yarn test`
