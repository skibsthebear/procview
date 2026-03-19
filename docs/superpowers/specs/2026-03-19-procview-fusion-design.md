# Procview — Unified Local Process Dashboard

**Date:** 2026-03-19
**Status:** Approved
**Repo:** pm2-ui → procview (rename as part of this work)

## Overview

Procview fuses pm2-ui (real-time PM2 process management) with portracker's process discovery approach (Docker containers, standalone dev servers) into a single local dashboard. The goal: at a glance, see everything you're hosting on your machine and manage it.

**Primary sources (always visible):**
- PM2 processes — full management: start, stop, restart, reload, delete, logs
- Docker containers — start, stop, restart, logs

**Secondary source (allowlist-gated):**
- Standalone system processes (Node.js, Python dev servers) — see them, visit them, kill them

No authentication. Designed for personal use on trusted networks. Targets Windows and macOS with Docker Desktop.

## Architecture

### Collector Registry Pattern

Each source is a collector with a shared interface. A `CollectorRegistry` in `server.js` manages polling cadences, merges results, and routes actions/logs to the correct collector. The existing `pm2-manager.js` is wrapped (not modified) by the PM2 collector.

```
┌──────────────────────────────────────────────┐
│               server.js                       │
│  ┌──────────────────────────────────┐         │
│  │       CollectorRegistry          │         │
│  │  register('pm2', pm2Collector)   │         │
│  │  register('docker', dockerCol)   │         │
│  │  register('system', systemCol)   │         │
│  │                                  │         │
│  │  pollAll() → merge → broadcast   │         │
│  │  routeAction(source, ...) → col  │         │
│  │  routeLogs(source, ...) → col    │         │
│  └──────────────────────────────────┘         │
│                                               │
│  pm2Collector wraps existing pm2-manager.js   │
│  dockerCollector = new (dockerode + scan)     │
│  systemCollector = new (netstat/lsof + scan)  │
│                                               │
│  SQLite: allowlist, notes, custom names       │
└──────────────────────────────────────────────┘
```

### File Structure

```
src/lib/
├── collector-registry.js    # Orchestrates all collectors
├── collectors/
│   ├── pm2-collector.js     # Wraps existing pm2-manager.js
│   ├── docker-collector.js  # dockerode integration
│   └── system-collector.js  # netstat/lsof port scanning
├── pm2-manager.js           # Unchanged — existing PM2 logic
├── ws-protocol.js           # Extended with new message types
└── db.js                    # SQLite via better-sqlite3
```

## Unified Process Data Model

Every source produces process objects normalized to this shared shape:

```js
{
  // Identity
  source:         'pm2' | 'docker' | 'system',
  id:             string,        // unique: "pm2:myapp", "docker:abc123", "sys:3829:node"
  name:           string,        // display name
  groupId:        string,        // for clustering: pm2 name, compose project, or null

  // Status
  status:         string,        // normalized: 'online'|'stopped'|'errored'|'paused'|'launching'
  pid:            number|null,

  // Metrics (nullable — not all sources provide all)
  cpu:            number|null,   // percentage
  memory:         number|null,   // MB
  uptime:         string|null,   // formatted string

  // Network
  ports:          number[],      // host ports this process is listening on

  // Source-specific (nullable)
  instanceId:     number|null,   // PM2 cluster instance
  containerId:    string|null,   // Docker short ID
  image:          string|null,   // Docker image name
  composeProject: string|null,   // Docker Compose project
  composeService: string|null,   // Docker Compose service

  // Capabilities
  actions:        string[],      // e.g. ['restart','stop','reload','start','delete'] for PM2
  hasLogs:        boolean,       // whether log streaming is available
}
```

**Key decisions:**
- `source` field drives all routing — actions, logs, filtering, display.
- `actions` array is per-process so the UI renders buttons from the array without knowing source-specific rules.
- `ports` is an array because Docker containers can expose multiple ports.
- Nullable fields mean the UI gracefully hides metrics that don't apply.

**`groupId` semantics:** Used for within-source grouping on the dashboard.
- PM2: `groupId` = process name. Multiple cluster instances with the same name collapse into one expandable card (existing behavior).
- Docker: `groupId` = `composeProject` if present, otherwise `containerId`. Compose services within the same project are grouped under a collapsible project header. Standalone containers are individual cards.
- System: `groupId` = null. Each system process is always an individual card (no grouping).

The dashboard groups by `(source, groupId)`. Within each source section, processes sharing a `groupId` are rendered as one collapsible group.

**Status normalization mapping:**

| Source | Raw Status | Normalized |
|---|---|---|
| PM2 | `online` | `online` |
| PM2 | `stopping` | `stopping` |
| PM2 | `stopped` | `stopped` |
| PM2 | `errored` | `errored` |
| PM2 | `launching` | `launching` |
| PM2 | `one-launch-status` | `launching` |
| Docker | `running` | `online` |
| Docker | `exited` | `stopped` |
| Docker | `paused` | `paused` |
| Docker | `created` | `stopped` |
| Docker | `restarting` | `launching` |
| Docker | `removing` | `stopping` |
| Docker | `dead` | `errored` |
| System | (always listening) | `online` |

**System process ID strategy:** System IDs (`sys:port:processName`) are considered semi-stable. The port+name combination is stable as long as the same process is running. Notes and custom names on system IDs are best-effort — they persist as long as the same process name binds the same port. If a different process takes the port, the old note becomes orphaned in SQLite (harmless). A future cleanup task can prune orphaned entries, but this is not required for v1.

## Collector Interface

Each collector implements:

```js
{
  name:        string,                // 'pm2', 'docker', 'system'
  interval:    number,                // poll interval in ms
  connect()    → Promise<void>,       // initialize
  disconnect() → Promise<void>,       // cleanup
  scan()       → Promise<Process[]>,  // return normalized process objects
  executeAction(processId, action) → Promise<{success, error?}>,  // note: source is NOT passed here — the registry routes by source before calling the collector
  getLogs(processId, lines)        → Promise<{out, err}>,
  tailLogs(processId, callback)    → Promise<void>,  // async — setup may hit daemon/API
  stopTailing(processId)           → void,
}
```

Not all collectors implement all methods. System collector has no `getLogs`/`tailLogs` and only supports `kill` as an action.

### PM2 Collector

Thin wrapper around existing `pm2-manager.js`. Calls `getProcessList()` and maps to normalized shape. Actions and logs delegate directly to pm2-manager. Zero changes to pm2-manager itself.

### Docker Collector

Uses `dockerode`. Auto-detects Docker socket on `connect()` (named pipe on Windows, Unix socket on macOS). `scan()` calls `docker.listContainers({all: true})` then `container.inspect()` for port mappings. Actions map to `container.start()`, `container.stop()`, `container.restart()`. Logs via `container.logs({follow: true, stdout: true, stderr: true})`.

**Docker CPU/memory is out of scope for v1.** The `cpu` and `memory` fields will be `null` for Docker processes. `container.stats({stream: false})` has a well-known latency problem — each call opens a stats stream, waits for two data points, then closes, taking ~1s per container. With N containers this serializes to N seconds, easily exceeding the poll interval. A future version can add metrics via a separate background stats stream or by using the Docker events API, but v1 ships without them.

### System Collector

On Windows: `netstat -ano` + `tasklist /FO CSV`. On macOS: `lsof -iTCP -sTCP:LISTEN -nP`. Filters results through the allowlist (process names + port ranges from SQLite). Only action: `kill` via `process.kill(pid)` / `taskkill /PID`.

### CollectorRegistry

```js
class CollectorRegistry {
  register(collector)                    // add a collector
  startPolling()                         // start each collector's poll loop
  stopPolling()                          // clear all intervals
  getAll()                               // merged, deduplicated process list
  routeAction(source, id, action)        // delegates to correct collector
  routeLogs(source, id, ...)             // delegates to correct collector
}
```

**Deduplication:** Docker > PM2 > System priority. Uses PID-based matching:
1. After all collectors scan, build a Set of all PIDs from Docker results (including all container PIDs from `container.top()`).
2. Build a Set of all PIDs from PM2 results (including all cluster instance PIDs).
3. For each system entry, if its PID is in the Docker or PM2 PID sets, drop it.
4. This is PID-based, not port-based — avoids false matches during process restarts where old and new processes briefly share the same port.

**Poll cadences:**
- PM2: ~8s (`PM2_POLL_INTERVAL`, default 7829)
- Docker: ~10s (`DOCKER_POLL_INTERVAL`, default 10000)
- System: ~30s (`SYSTEM_POLL_INTERVAL`, default 30000)

## WebSocket Protocol

Extends the existing protocol with a `source` field and new message types.

### Server → Client

```js
// Existing — now carries ALL sources merged
PROCESS_LIST: {
  type: 'PROCESS_LIST',
  data: [
    { source: 'pm2', id: 'pm2:myapp', name: 'myapp', ... },
    { source: 'docker', id: 'docker:abc123', name: 'redis', ... },
    { source: 'system', id: 'sys:5173:node', name: 'node', ... }
  ]
}

// Existing — unchanged
ACTION_RESULT: { type: 'ACTION_RESULT', id: '...', success: true }

// Existing — now includes source and processId
LOG_LINES: { type: 'LOG_LINES', source: 'pm2', processId: 'pm2:myapp', stream: 'out', lines: [...] }

// NEW — collector availability
COLLECTOR_STATUS: {
  type: 'COLLECTOR_STATUS',
  collectors: {
    pm2:    { available: true, lastScan: 1710843200000 },
    docker: { available: true, lastScan: 1710843198000 },
    system: { available: true, lastScan: 1710843180000 }
  }
}

// NEW — settings operation result (correlates with UPDATE_SETTINGS via id)
SETTINGS_RESULT: { type: 'SETTINGS_RESULT', id: '...', success: true, error?: string }
```

### Client → Server

```js
// Existing — now uses processId as canonical routing key
// processId is the unified ID (e.g. "pm2:myapp", "docker:abc123", "sys:5173:node")
// source is included explicitly for fast routing without parsing the ID
ACTION: { type: 'ACTION', id: '...', source: 'pm2', processId: 'pm2:myapp', action: 'restart' }

// Existing — now requires source + processId
SUBSCRIBE_LOGS: { type: 'SUBSCRIBE_LOGS', source: 'pm2', processId: 'pm2:myapp' }
UNSUBSCRIBE_LOGS: { type: 'UNSUBSCRIBE_LOGS', source: 'pm2', processId: 'pm2:myapp' }

// NEW — allowlist changes from UI
UPDATE_SETTINGS: { type: 'UPDATE_SETTINGS', id: '...', allowlist: { processNames: [...], portRanges: [...] } }
```

**Log subscription key:** The server-side `logSubscriptions` map uses composite keys: `Map<ws, Set<"source:processId">>`. This prevents collisions when the same name exists in multiple sources.

**`UPDATE_SETTINGS` acknowledgment:** Server responds with `SETTINGS_RESULT: { type: 'SETTINGS_RESULT', id: '...', success: true, error?: string }` following the same correlation ID pattern as `ACTION` / `ACTION_RESULT`.

### REST Endpoint for Settings

The WebSocket protocol handles real-time data and mutations. For the initial settings load on page mount, a REST GET endpoint is simpler and avoids request-response over WebSocket:

```
GET /api/settings → {
  allowlist: [{ id, type, value, enabled }],
  hidden: ["pm2:myapp", "docker:abc123"],
  customNames: { "pm2:myapp": "My App", "docker:abc123": "Redis Cache" }
}
```

This is served directly from `server.js` as a simple Express-style route handler on the existing HTTP server (the custom server already handles HTTP requests before passing to Next.js). `use-settings.js` calls `fetch('/api/settings')` on mount to hydrate the client-side state. Mutations go through `UPDATE_SETTINGS` over WebSocket for consistency with the rest of the protocol.

### Valid Actions Per Source

```
PM2:    ['restart', 'stop', 'reload', 'start', 'delete']
Docker: ['start', 'stop', 'restart']
System: ['kill']
```

## SQLite Database

Single file: `data/procview.db`

```sql
CREATE TABLE allowlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,          -- 'process_name' | 'port_range'
  value       TEXT NOT NULL,          -- 'node', 'python', '3000-9999'
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default seeds on first run:
-- ('process_name', 'node', 1)
-- ('process_name', 'python', 1)
-- ('process_name', 'python3', 1)
-- ('process_name', 'uvicorn', 1)
-- ('process_name', 'gunicorn', 1)
-- ('process_name', 'flask', 1)
-- ('process_name', 'vite', 1)
-- ('port_range', '3000-9999', 1)

CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id  TEXT NOT NULL UNIQUE,   -- "pm2:myapp", "docker:abc123"
  note        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE custom_names (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE hidden (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
```

`db.js` uses `better-sqlite3` (synchronous API). Exposes functions: `getAllowlist()`, `addAllowlistEntry()`, `toggleAllowlistEntry()`, `getNote()`, `setNote()`, `getCustomName()`, `setCustomName()`, `hideProcess()`, `unhideProcess()`, `getHidden()`, `getSetting()`, `setSetting()`. Auto-creates tables on first import.

## Frontend Architecture

### Component Tree

```
App (layout.js)
├── ToastProvider
├── Navbar
│   ├── "procview" brand
│   ├── Collector status indicators (pm2: ●  docker: ●  system: ●)
│   └── Settings gear icon → SettingsModal
│
└── Pages
    ├── / → Dashboard
    │   ├── FilterBar
    │   │   ├── Search input
    │   │   ├── Status toggles (Online, Stopped, Errored)
    │   │   └── Source toggles (PM2, Docker, System)
    │   │
    │   ├── ProcessGroup (one per source, collapsible)
    │   │   ├── Group header ("PM2 Processes (5)", "Docker Containers (3)")
    │   │   └── ProcessCard (one per process)
    │   │       ├── StatusBadge
    │   │       ├── Port badges (clickable → opens in browser)
    │   │       ├── Metrics (cpu/mem/uptime — shown if available)
    │   │       ├── Source-specific details
    │   │       │   ├── PM2: instance count, cluster badge
    │   │       │   ├── Docker: image name, compose project
    │   │       │   └── System: process name, PID
    │   │       ├── ProcessActions (driven by process.actions array)
    │   │       ├── Log link (if hasLogs)
    │   │       └── Context menu: rename, add note, hide
    │   │
    │   └── HiddenProcessesDrawer
    │
    ├── /logs/[source]/[appName] → LogViewer
    │
    └── Settings (modal or panel)
        ├── Allowlist editor (process names + port ranges)
        ├── Poll intervals
        └── Hidden processes management
```

### Hooks

```
src/hooks/
├── use-processes.js     # Renamed from use-pm2.js
│                        # Handles PROCESS_LIST, ACTION_RESULT, COLLECTOR_STATUS
│                        # Returns: { processes, collectorStatus, connected, executeAction }
├── use-logs.js          # Extended: sends source in SUBSCRIBE_LOGS
└── use-settings.js      # NEW: reads/writes allowlist, hidden, custom names
```

**`executeAction` signature change:** The current `executeAction(appName, action)` becomes `executeAction(source, processId, action)`. The hook includes `source` in the `ACTION` message. Process cards pass their `source` and `id` to the action handler.

**Hidden process filtering:** Client-side. The server always sends the full process list (including hidden processes). The `use-settings.js` hook fetches the hidden set from the server on mount. The dashboard filters them out locally. The `HiddenProcessesDrawer` toggles a flag to show/hide them. This keeps the server stateless with respect to per-client view preferences and avoids per-connection hidden-set tracking.

### Component Changes Summary

| Component | Status |
|---|---|
| `dashboard.js` | Refactored — source grouping, new filter dimension |
| `process-card.js` | Refactored — conditional metrics/actions based on source |
| `process-actions.js` | Simplified — renders from process.actions array |
| `filter-bar.js` | Extended — source toggle row |
| `status-badge.js` | Extended — Docker statuses (running, exited, paused, created) |
| `navbar.js` | Refactored — brand, collector status, settings link |
| `log-viewer.js` | Minor — route includes source |
| `toast-provider.js` | Unchanged |
| `use-pm2.js` | Renamed to `use-processes.js` |
| `use-logs.js` | Minor — source-aware subscription |
| `use-settings.js` | New |
| `settings-modal.js` | New |
| `hidden-drawer.js` | New |

## Error Handling & Graceful Degradation

Each collector is independent. One failing doesn't take down the others.

**Collector-level isolation:**
- On `connect()` failure: mark collector as unavailable, broadcast `COLLECTOR_STATUS`, continue to next.
- On `scan()` failure: log error, keep last known good data, increment error count. After `COLLECTOR_MAX_FAILURES` (default 3) consecutive failures, mark unavailable.
- Unavailable collectors retried every `COLLECTOR_RETRY_INTERVAL` (default 60s). Auto-recovers when the source comes back.

**Scenario table:**

| Scenario | Behavior |
|---|---|
| Docker Desktop not running | Docker unavailable. PM2 + System work. Navbar: docker ○ |
| PM2 daemon not running | PM2 unavailable. Docker + System work. |
| System scan fails | System unavailable. PM2 + Docker work. |
| Source starts mid-session | Registry retries, auto-recovers, broadcasts updated status. |
| Slow system scan | Runs on its own interval. Doesn't block other sources. |
| Action fails | ACTION_RESULT with error. Toast shown. No retry. |
| WebSocket disconnect | Exponential backoff reconnection. Server sends cached `PROCESS_LIST` and current `COLLECTOR_STATUS` on new connection. |
| SQLite corrupt | Falls back to in-memory defaults. Dashboard works, no persistence. |

## Testing

Same `_deps` injection pattern as existing pm2-manager tests.

```
__tests__/
├── ws-protocol.test.js          # Existing — extend with new types
├── pm2-manager.test.js          # Existing — unchanged
├── collector-registry.test.js   # Merge, dedup, routing, retry
├── pm2-collector.test.js        # Wrapper mapping verification
├── docker-collector.test.js     # Mock dockerode
├── system-collector.test.js     # Mock child_process, parse logic
└── db.test.js                   # CRUD for all tables
```

## Configuration

### Environment Variables

```bash
# Server
PORT=7829

# Poll Intervals (ms)
PM2_POLL_INTERVAL=7829
DOCKER_POLL_INTERVAL=10000
SYSTEM_POLL_INTERVAL=30000

# Collector Resilience
COLLECTOR_RETRY_INTERVAL=60000
COLLECTOR_MAX_FAILURES=3

# Logs
LOG_LINES=200

# Database
DATABASE_PATH=./data/procview.db

# Docker (auto-detected if empty)
# DOCKER_HOST=
```

### Runtime-Configurable (via Settings UI → SQLite)

- System process allowlist (names + port ranges)
- Hidden processes
- Custom display names
- Notes

### New Dependencies

```
better-sqlite3    # SQLite driver (synchronous, native addon)
dockerode          # Docker Engine API client
```

**Note on `better-sqlite3`:** This is a native Node.js addon compiled via `node-gyp`. On Windows, it requires Visual C++ Build Tools (typically installed with "Desktop development with C++" workload in Visual Studio). On macOS, it requires Xcode Command Line Tools. If native compilation is problematic, `sql.js` (pure JS SQLite via WASM) is a fallback option with slightly different API but no native build requirement.

## Migration

- `package.json` name: `pm2-ui` → `procview`
- Navbar brand: `PM2` → `procview`
- Page title: `PM2 Dashboard` → `Procview`
- README, CLAUDE.md, `.env.example` updated
- `data/` added to `.gitignore`
- Existing `pm2-manager.js` unchanged — wrapped by collector
- Existing `.env.local` files remain compatible (new vars have defaults)

## Implementation Phases

```
Phase 1: Foundation
  - src/lib/db.js
  - src/lib/collector-registry.js
  - src/lib/collectors/pm2-collector.js
  - Tests for all three

Phase 2: New Sources
  - src/lib/collectors/docker-collector.js
  - src/lib/collectors/system-collector.js
  - Tests for both

Phase 3: Server Integration
  - server.js refactor — swap direct pm2-manager calls for registry
  - WebSocket protocol extensions

Phase 4: Frontend
  - Rename use-pm2.js → use-processes.js
  - Refactor dashboard.js, process-card.js, filter-bar.js
  - New: settings modal, hidden drawer
  - Update navbar.js, status-badge.js, layout.js

Phase 5: Polish
  - Rename package, README, CLAUDE.md, .env.example
  - Full test suite passing
```

## Attribution

Originally forked from [thenickygee/pm2-ui](https://github.com/thenickygee/pm2-ui) by Nicholas Gmitter. Substantially rewritten by Sakib Rahman. Portracker ([portracker](F:\Tools\External\portracker)) architecture referenced for Docker and system process discovery patterns.
