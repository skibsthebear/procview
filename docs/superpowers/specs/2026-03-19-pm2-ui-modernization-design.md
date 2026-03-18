# PM2 UI Modernization — Design Spec

## Overview

Clean rewrite of PM2 UI: a local-only dashboard for managing PM2 processes. Migrate from Pages Router to App Router, replace polling with WebSocket push, drop authentication entirely, redesign the UI, and clean up all dead code and unused dependencies.

**Target:** Personal/small team tool running on the same server as the PM2 daemon. Latest Node.js.

## Architecture

### Custom Server (`server.js`)

A single Node.js process runs both Next.js and a WebSocket server on the **same HTTP server and port** (3000):

- Creates an `http.Server`, passes it to both `next()` request handler and `new WebSocketServer({ server })` — single port, no second listener
- Maintains one persistent PM2 connection (no connect/disconnect per request)
- Polls PM2 every 2-3 seconds, caches the process list, broadcasts to WebSocket clients only when the list has changed
- On new WebSocket connection: immediately sends the cached `PROCESS_LIST` (no waiting for next poll cycle)
- Handles PM2 actions (restart/stop/start/reload/delete) via bidirectional WebSocket messages
- Graceful shutdown: disconnects PM2, closes WebSocket connections

### Data Flow

```
PM2 Daemon <---> server.js (persistent connection, polls every 2-3s)
                    |
                 WebSocket (ws library)
                    |
              Browser clients (real-time process list + log streams)
```

WebSocket chosen over SSE because we need bidirectional communication — client sends actions, server pushes updates.

## Project Structure

```
pm2-ui/
├── server.js                  # Custom server: Next.js + WebSocket + PM2 connection
├── next.config.js
├── tailwind.config.js
├── package.json
├── Dockerfile
├── .env.example
├── src/
│   ├── app/
│   │   ├── layout.js          # Root layout
│   │   ├── page.js            # Dashboard page (server component shell)
│   │   ├── logs/
│   │   │   └── [appName]/
│   │   │       └── page.js    # Log viewer page
│   │   └── globals.css
│   ├── components/
│   │   ├── dashboard.js       # Main dashboard (client component, WebSocket consumer)
│   │   ├── process-card.js    # Process/group card
│   │   ├── process-actions.js # Action buttons
│   │   ├── status-badge.js    # Status indicator with animation
│   │   ├── log-viewer.js      # Streaming log display
│   │   ├── filter-bar.js      # Name search + status toggles
│   │   └── navbar.js
│   ├── hooks/
│   │   ├── use-pm2.js         # WebSocket connection + process state
│   │   └── use-logs.js        # WebSocket log streaming
│   └── lib/
│       ├── pm2-manager.js     # PM2 connection, polling, actions (server-side)
│       └── ws-protocol.js     # Shared message type constants
├── __tests__/
│   ├── pm2-manager.test.js
│   └── ws-protocol.test.js
└── vitest.config.js
```

## WebSocket Protocol

### Server to Client

```json
{ "type": "PROCESS_LIST", "data": [...] }
{ "type": "ACTION_RESULT", "id": "...", "success": true/false, "error": "..." }
{ "type": "LOG_LINES", "appName": "...", "stream": "out|err", "lines": [...] }
```

### Client to Server

```json
{ "type": "ACTION", "id": "...", "appName": "...", "action": "restart|stop|start|reload|delete" }
{ "type": "SUBSCRIBE_LOGS", "appName": "..." }
{ "type": "UNSUBSCRIBE_LOGS", "appName": "..." }
```

- `id` on actions enables request-response matching
- Log subscription model: subscribe on entering log page, unsubscribe on leave
- Server only sends full process list when something has changed

## PM2 Manager (`pm2-manager.js`)

Server-side module encapsulating all PM2 interaction:

- `connect()` / `disconnect()` — lifecycle management
- `getProcessList()` — calls `pm2.list()`, maps to clean process objects containing: `name`, `status`, `cpu`, `memory`, `uptime`, `pid`, `instanceId` (from `pm2_env.NODE_APP_INSTANCE`). Cluster grouping is driven by `name` — all instances sharing the same `name` belong to one group. Actions on a group target the `name` string (PM2 natively applies to all instances of that name).
- `executeAction(appName, action)` — validates action against allowlist, executes
- `describeProcess(appName)` — for log file path discovery
- `readLogs(appName, lines)` — reads last N lines from stdout/stderr via `read-last-lines`
- `tailLogs(appName, callback)` / `stopTailing(appName)` — uses `fs.watch` on the log files to detect appends, reads new lines, and invokes callback with `{ stream: "out"|"err", lines: [...] }`. Called by `server.js` when a client sends `SUBSCRIBE_LOGS`; stopped on `UNSUBSCRIBE_LOGS`. Initial subscription sends last N lines via `readLogs`, then switches to tailing.

## Custom Hooks

- `usePM2()` — connects WebSocket, maintains process list state, exposes `executeAction(appName, action)` returning a promise resolved on `ACTION_RESULT`. Promises have a 10-second timeout to avoid hanging on server restarts. Includes automatic reconnection with exponential backoff (1s, 2s, 4s, capped at 30s). Exposes a `connected` boolean for the UI status indicator.
- `useLogs(appName)` — subscribes to log stream on mount, unsubscribes on unmount, maintains stdout/stderr line buffers. Resubscribes automatically on WebSocket reconnection.

## UI Design

### Overall Aesthetic

Dark theme, clean monospace data display, subtle glassmorphism cards, smooth transitions for status changes.

### Dashboard (`/`)

- **Navbar:** App title "PM2" left, WebSocket connection status indicator (green dot) right
- **Filter bar:** Search input + status toggle pills with counts — `Online (4)  Stopped (2)  Errored (1)`
- **Process grid:** Responsive CSS grid. Cluster instances grouped under expandable cards with instance count badge
- **Process card:**
  - Header: name + animated status badge (pulse for online, static red for errored)
  - Metrics: CPU %, Memory (correct color thresholds), Uptime, PID — values animate/tween on change
  - Actions: icon buttons for start/stop/restart/reload, delete behind confirm popover
  - "Logs" link
- **Empty state:** Helpful message with `pm2 start` example when no processes running

### Log Viewer (`/logs/[appName]`)

- Back link to dashboard
- Stdout and stderr in split or tabbed view
- Auto-scroll with "pin to bottom" toggle
- Monospace font, ANSI color rendering via `ansi-to-html`
- Real-time streaming via WebSocket

### Responsive

Cards: 3-col grid on desktop, single column on mobile. Log viewer stacks panels vertically on narrow screens.

### Transitions

Status changes animate the badge and metric values rather than snapping.

## Dependencies

### Keep
**Runtime (`dependencies`):**
- `next`, `react`, `react-dom` — Core framework
- `pm2` — PM2 API
- `ws` — WebSocket server (new)
- `@fortawesome/react-fontawesome` + icon packages — Icons
- `@headlessui/react` — Popover, Switch (focus trapping, outside-click)
- `read-last-lines` — Log file reading
- `ansi-to-html` — Log ANSI color rendering
- `react-toastify` — Toast notifications

**Build/dev (`devDependencies`):**
- `tailwindcss`, `postcss`, `autoprefixer` — Styling (build-time only)
- `vitest` — Test runner (new)
- `eslint`, `eslint-config-next` — Linting

### Remove
- `next-auth` — No auth needed
- `argon2`, `bcryptjs`, `jsonwebtoken`, `cookie` — Auth-related
- `react-router-dom` — Unused (Next.js routing)
- `event-stream`, `prompts`, `dotenv`, `envfile` — Unused
- `nodemon` — Unnecessary; use `node --watch server.js` for dev (native in Node 22+)

## Testing

Lean test suite appropriate for a personal tool:

- `pm2-manager.test.js` — Unit test PM2 abstraction with mocked `pm2` module
- `ws-protocol.test.js` — Validate message types and serialization helpers
- No E2E or component tests

## Docker

Multi-stage build to keep the final image lean:

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install
COPY . .
RUN yarn build

# Production stage
FROM node:22-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/next.config.js ./next.config.js
EXPOSE 3000
CMD ["node", "server.js"]
```

Must mount host PM2 socket: `-v /root/.pm2:/root/.pm2`

`yarn install` (without `--production`) in the build stage because `next build` requires dev dependencies (`tailwindcss`, `postcss`, `eslint-config-next`). The production stage only installs runtime deps.

## Environment

- `.env.example` committed with documented vars: `PORT=3000`, `PM2_POLL_INTERVAL=3000`, `LOG_LINES=200`
- `.env.local` removed from version control via `git rm --cached .env.local`, then added to `.gitignore`

## Scripts

```json
{
  "dev": "node --watch server.js",
  "build": "next build",
  "start": "NODE_ENV=production node server.js",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```
