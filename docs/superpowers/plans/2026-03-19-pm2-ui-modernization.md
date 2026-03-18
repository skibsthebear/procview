# PM2 UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean rewrite of PM2 UI — migrate to App Router, real-time WebSocket updates, no auth, redesigned dashboard UI, Docker support.

**Architecture:** Custom Next.js server (`server.js`) running Next.js + WebSocket on a single port. Persistent PM2 connection with server-side polling, broadcasting diffs to clients. Client hooks encapsulate all WebSocket logic.

**Tech Stack:** Next.js 14 (App Router), React 18, ws, TailwindCSS 3, HeadlessUI, Font Awesome, Vitest, ansi-to-html, read-last-lines, pm2

**Spec:** `docs/superpowers/specs/2026-03-19-pm2-ui-modernization-design.md`

---

## File Map

### Create (new files)
- `server.js` — Custom server: HTTP + Next.js + WebSocket + PM2 polling
- `src/lib/ws-protocol.js` — Shared WebSocket message type constants
- `src/lib/pm2-manager.js` — PM2 connection, polling, actions, log tailing
- `src/app/layout.js` — Root layout (html, body, fonts, global styles)
- `src/app/page.js` — Dashboard page (server component shell)
- `src/app/globals.css` — Tailwind directives + custom dark theme styles
- `src/app/logs/[appName]/page.js` — Log viewer page
- `src/components/toast-provider.js` — Client-side ToastContainer wrapper (required for App Router)
- `src/components/navbar.js` — Top nav with connection status
- `src/components/status-badge.js` — Animated status indicator
- `src/components/filter-bar.js` — Name search + status toggle pills
- `src/components/process-actions.js` — Action buttons with confirm popover
- `src/components/process-card.js` — Process/group card with metrics
- `src/components/dashboard.js` — Main dashboard (client component, WebSocket consumer)
- `src/components/log-viewer.js` — Streaming log display with ANSI rendering
- `src/hooks/use-pm2.js` — WebSocket connection + process state hook
- `src/hooks/use-logs.js` — WebSocket log streaming hook
- `__tests__/ws-protocol.test.js` — Protocol constant tests
- `__tests__/pm2-manager.test.js` — PM2 manager unit tests
- `vitest.config.js` — Vitest configuration
- `Dockerfile` — Multi-stage production build
- `.env.example` — Documented environment variables

### Modify (existing files)
- `package.json` — Rewrite deps, scripts
- `next.config.js` — App Router config
- `tailwind.config.js` — Update content paths for new structure
- `.gitignore` — Add `.env.local`
- `jsconfig.json` — Keep as-is (path alias already correct)

### Delete (after new code is working)
- `src/pages/` — Entire directory (all old Pages Router code, components, API routes)
- `.env.local` — Remove from git tracking (keep file locally)
- `postcss.config.js` — Keep as-is (Next.js auto-detects it)

---

## Task 1: Dependency Cleanup & Project Config

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `tailwind.config.js`
- Modify: `next.config.js`
- Create: `.env.example`
- Create: `vitest.config.js`

- [ ] **Step 1: Remove unused dependencies**

```bash
yarn remove next-auth argon2 bcryptjs jsonwebtoken cookie react-router-dom event-stream prompts dotenv envfile nodemon
```

- [ ] **Step 2: Add new dependencies**

```bash
yarn add ws
yarn add -D vitest
```

- [ ] **Step 3: Move misplaced deps to devDependencies**

`autoprefixer` and `postcss` are in both `dependencies` and `devDependencies`. Remove from `dependencies`:

```bash
yarn remove autoprefixer postcss
yarn add -D autoprefixer postcss
```

- [ ] **Step 4: Update package.json scripts**

Replace the `scripts` section in `package.json`:

```json
{
  "scripts": {
    "dev": "node --watch server.js",
    "build": "next build",
    "start": "NODE_ENV=production node server.js",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Update .gitignore**

Add `.env.local` and `.env` to `.gitignore`:

```
# Environment
.env.local
.env
```

- [ ] **Step 6: Untrack .env.local from git**

```bash
git rm --cached .env.local
```

- [ ] **Step 7: Create .env.example**

Create `.env.example` with this content:

```
# PM2 UI Configuration
PORT=3000
PM2_POLL_INTERVAL=3000
LOG_LINES=200
```

- [ ] **Step 8: Update tailwind.config.js**

Update content paths to match new App Router structure:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 9: Update next.config.js**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
```

- [ ] **Step 10: Create vitest.config.js**

Note: Uses CJS format to match the project (no `"type": "module"` in package.json). Vitest handles CJS config files natively. Tests use explicit vitest imports for clarity.

```js
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {},
});
```

- [ ] **Step 11: Commit**

```bash
git add package.json yarn.lock .gitignore .env.example tailwind.config.js next.config.js vitest.config.js
git commit -m "chore: clean up dependencies and project config

Remove auth deps (next-auth, argon2, bcryptjs, jsonwebtoken, cookie),
unused deps (react-router-dom, event-stream, prompts, dotenv, envfile,
nodemon). Add ws and vitest. Fix dep placement. Update scripts, configs,
and gitignore for App Router rewrite."
```

---

## Task 2: WebSocket Protocol Constants + Tests

**Files:**
- Create: `src/lib/ws-protocol.js`
- Create: `__tests__/ws-protocol.test.js`

- [ ] **Step 1: Write the failing test**

Create `__tests__/ws-protocol.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { MessageType, VALID_ACTIONS, createMessage, parseMessage } from '../src/lib/ws-protocol';

describe('ws-protocol', () => {
  describe('MessageType', () => {
    it('has all server-to-client message types', () => {
      expect(MessageType.PROCESS_LIST).toBe('PROCESS_LIST');
      expect(MessageType.ACTION_RESULT).toBe('ACTION_RESULT');
      expect(MessageType.LOG_LINES).toBe('LOG_LINES');
    });

    it('has all client-to-server message types', () => {
      expect(MessageType.ACTION).toBe('ACTION');
      expect(MessageType.SUBSCRIBE_LOGS).toBe('SUBSCRIBE_LOGS');
      expect(MessageType.UNSUBSCRIBE_LOGS).toBe('UNSUBSCRIBE_LOGS');
    });
  });

  describe('VALID_ACTIONS', () => {
    it('contains exactly the allowed PM2 actions', () => {
      expect(VALID_ACTIONS).toEqual(['restart', 'stop', 'reload', 'start', 'delete']);
    });
  });

  describe('createMessage', () => {
    it('serializes a message to JSON string', () => {
      const msg = createMessage(MessageType.PROCESS_LIST, { data: [] });
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe('PROCESS_LIST');
      expect(parsed.data).toEqual([]);
    });
  });

  describe('parseMessage', () => {
    it('deserializes a valid JSON string', () => {
      const raw = JSON.stringify({ type: 'ACTION', id: '123', appName: 'web', action: 'restart' });
      const msg = parseMessage(raw);
      expect(msg.type).toBe('ACTION');
      expect(msg.id).toBe('123');
    });

    it('returns null for invalid JSON', () => {
      expect(parseMessage('not json')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ws-protocol.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/ws-protocol.js`:

```js
const MessageType = {
  // Server -> Client
  PROCESS_LIST: 'PROCESS_LIST',
  ACTION_RESULT: 'ACTION_RESULT',
  LOG_LINES: 'LOG_LINES',
  // Client -> Server
  ACTION: 'ACTION',
  SUBSCRIBE_LOGS: 'SUBSCRIBE_LOGS',
  UNSUBSCRIBE_LOGS: 'UNSUBSCRIBE_LOGS',
};

const VALID_ACTIONS = ['restart', 'stop', 'reload', 'start', 'delete'];

function createMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { MessageType, VALID_ACTIONS, createMessage, parseMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/ws-protocol.test.js`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/ws-protocol.js __tests__/ws-protocol.test.js
git commit -m "feat: add WebSocket protocol constants and helpers

Shared message types (PROCESS_LIST, ACTION_RESULT, LOG_LINES, ACTION,
SUBSCRIBE_LOGS, UNSUBSCRIBE_LOGS), valid PM2 actions allowlist, and
JSON serialization/deserialization helpers."
```

---

## Task 3: PM2 Manager Module + Tests

**Files:**
- Create: `src/lib/pm2-manager.js`
- Create: `__tests__/pm2-manager.test.js`

- [ ] **Step 1: Write the failing test**

Create `__tests__/pm2-manager.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pm2 module (CJS: return value is the module.exports object directly)
vi.mock('pm2', () => ({
  connect: vi.fn((cb) => cb(null)),
  disconnect: vi.fn(),
  list: vi.fn((cb) => cb(null, [
    {
      name: 'web',
      pm2_env: {
        status: 'online',
        pm_uptime: Date.now() - 60000,
        NODE_APP_INSTANCE: 0,
      },
      monit: { cpu: 12, memory: 52428800 }, // 50MB
      pid: 1234,
    },
    {
      name: 'web',
      pm2_env: {
        status: 'online',
        pm_uptime: Date.now() - 60000,
        NODE_APP_INSTANCE: 1,
      },
      monit: { cpu: 8, memory: 41943040 }, // 40MB
      pid: 1235,
    },
  ])),
  restart: vi.fn((name, cb) => cb(null)),
  stop: vi.fn((name, cb) => cb(null)),
  reload: vi.fn((name, cb) => cb(null)),
  start: vi.fn((name, cb) => cb(null)),
  delete: vi.fn((name, cb) => cb(null)),
  describe: vi.fn((name, cb) => cb(null, [{
    pm2_env: {
      pm_out_log_path: '/tmp/web-out.log',
      pm_err_log_path: '/tmp/web-err.log',
    },
  }])),
}));

// Mock read-last-lines (CJS: the module itself has a .read method)
vi.mock('read-last-lines', () => ({
  read: vi.fn(() => Promise.resolve('line1\nline2\nline3')),
}));

// Import as default — Vitest CJS interop wraps module.exports as the default
import pm2Manager from '../src/lib/pm2-manager';

describe('pm2-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connect / disconnect', () => {
    it('connects to PM2 daemon', async () => {
      const pm2 = await import('pm2');
      await pm2Manager.connect();
      expect(pm2.connect).toHaveBeenCalledOnce();
    });

    it('disconnects from PM2 daemon', async () => {
      const pm2 = await import('pm2');
      pm2Manager.disconnect();
      expect(pm2.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('getProcessList', () => {
    it('returns mapped process objects', async () => {
      const list = await pm2Manager.getProcessList();
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        name: 'web',
        status: 'online',
        cpu: 12,
        pid: 1234,
        instanceId: 0,
      });
      expect(list[0].memory).toBeCloseTo(50, 0);
      expect(list[0]).toHaveProperty('uptime');
    });
  });

  describe('executeAction', () => {
    it('executes a valid action', async () => {
      const pm2 = await import('pm2');
      await pm2Manager.executeAction('web', 'restart');
      expect(pm2.restart).toHaveBeenCalledWith('web', expect.any(Function));
    });

    it('rejects invalid actions', async () => {
      await expect(pm2Manager.executeAction('web', 'hack')).rejects.toThrow('Invalid action');
    });
  });

  describe('readLogs', () => {
    it('returns stdout and stderr lines', async () => {
      const logs = await pm2Manager.readLogs('web', 200);
      expect(logs.out).toEqual(['line1', 'line2', 'line3']);
      expect(logs.err).toEqual(['line1', 'line2', 'line3']);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/pm2-manager.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/pm2-manager.js`:

```js
const pm2 = require('pm2');
const readLastLines = require('read-last-lines');
const fs = require('fs');
const { VALID_ACTIONS } = require('./ws-protocol');

// Active log tailers: Map<appName, { outWatcher, errWatcher }>
const tailers = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function disconnect() {
  stopAllTailing();
  pm2.disconnect();
}

function getProcessList() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      resolve(
        list.map((proc) => ({
          name: proc.name,
          status: proc.pm2_env?.status || 'unknown',
          cpu: proc.monit?.cpu || 0,
          memory: Math.round((proc.monit?.memory || 0) / (1024 * 1024) * 100) / 100,
          uptime: formatUptime(proc.pm2_env?.pm_uptime),
          pid: proc.pid,
          instanceId: proc.pm2_env?.NODE_APP_INSTANCE ?? null,
        }))
      );
    });
  });
}

function formatUptime(pmUptime) {
  if (!pmUptime) return '0s';
  const ms = Date.now() - pmUptime;
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function executeAction(appName, action) {
  return new Promise((resolve, reject) => {
    if (!VALID_ACTIONS.includes(action)) {
      return reject(new Error(`Invalid action: ${action}`));
    }
    pm2[action](appName, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function describeProcess(appName) {
  return new Promise((resolve, reject) => {
    pm2.describe(appName, (err, desc) => {
      if (err) return reject(err);
      if (!desc || desc.length === 0) return reject(new Error(`Process ${appName} not found`));
      resolve({
        outLogPath: desc[0].pm2_env?.pm_out_log_path,
        errLogPath: desc[0].pm2_env?.pm_err_log_path,
      });
    });
  });
}

async function readLogs(appName, lines = 200) {
  const { outLogPath, errLogPath } = await describeProcess(appName);
  const [outRaw, errRaw] = await Promise.all([
    readLastLines.read(outLogPath, lines).catch(() => ''),
    readLastLines.read(errLogPath, lines).catch(() => ''),
  ]);
  return {
    out: outRaw ? outRaw.split('\n').filter(Boolean) : [],
    err: errRaw ? errRaw.split('\n').filter(Boolean) : [],
  };
}

async function tailLogs(appName, callback) {
  if (tailers.has(appName)) return; // Already tailing

  const { outLogPath, errLogPath } = await describeProcess(appName);

  let outSize = 0;
  let errSize = 0;

  try { outSize = fs.statSync(outLogPath).size; } catch {}
  try { errSize = fs.statSync(errLogPath).size; } catch {}

  function makeWatcher(filePath, stream, sizeRef) {
    try {
      return fs.watch(filePath, () => {
        try {
          const newSize = fs.statSync(filePath).size;
          if (newSize > sizeRef.value) {
            const readStream = fs.createReadStream(filePath, {
              start: sizeRef.value,
              end: newSize - 1,
              encoding: 'utf8',
            });
            let data = '';
            readStream.on('data', (chunk) => { data += chunk; });
            readStream.on('end', () => {
              const lines = data.split('\n').filter(Boolean);
              if (lines.length > 0) {
                callback({ stream, lines });
              }
            });
            sizeRef.value = newSize;
          }
        } catch {}
      });
    } catch {
      return null;
    }
  }

  const outSizeRef = { value: outSize };
  const errSizeRef = { value: errSize };

  const outWatcher = makeWatcher(outLogPath, 'out', outSizeRef);
  const errWatcher = makeWatcher(errLogPath, 'err', errSizeRef);

  tailers.set(appName, { outWatcher, errWatcher });
}

function stopTailing(appName) {
  const entry = tailers.get(appName);
  if (entry) {
    entry.outWatcher?.close();
    entry.errWatcher?.close();
    tailers.delete(appName);
  }
}

function stopAllTailing() {
  for (const appName of tailers.keys()) {
    stopTailing(appName);
  }
}

module.exports = {
  connect,
  disconnect,
  getProcessList,
  executeAction,
  describeProcess,
  readLogs,
  tailLogs,
  stopTailing,
  formatUptime,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/pm2-manager.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/pm2-manager.js __tests__/pm2-manager.test.js
git commit -m "feat: add PM2 manager module with tests

Encapsulates all PM2 interaction: connect/disconnect lifecycle, process
list mapping, action execution with allowlist validation, log reading,
and file tailing via fs.watch for real-time log streaming."
```

---

## Task 4: Custom Server (Next.js + WebSocket)

**Files:**
- Create: `server.js`

- [ ] **Step 1: Write server.js**

```js
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const pm2Manager = require('./src/lib/pm2-manager');
const { MessageType, createMessage, parseMessage } = require('./src/lib/ws-protocol');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT, 10) || 3000;
const pollInterval = parseInt(process.env.PM2_POLL_INTERVAL, 10) || 3000;
const logLines = parseInt(process.env.LOG_LINES, 10) || 200;

const app = next({ dev });
const handle = app.getRequestHandler();

let cachedProcessList = null;
let pollTimer = null;

// Track log subscriptions: Map<ws, Set<appName>>
const logSubscriptions = new Map();

async function startPolling(wss) {
  async function poll() {
    try {
      const list = await pm2Manager.getProcessList();
      const listJson = JSON.stringify(list);
      const cachedJson = JSON.stringify(cachedProcessList);

      if (listJson !== cachedJson) {
        cachedProcessList = list;
        const msg = createMessage(MessageType.PROCESS_LIST, { data: list });
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(msg);
        }
      }
    } catch (err) {
      console.error('PM2 poll error:', err.message);
    }
  }

  await poll(); // Initial poll
  pollTimer = setInterval(poll, pollInterval);
}

function handleClientMessage(ws, raw) {
  const msg = parseMessage(raw);
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case MessageType.ACTION:
      handleAction(ws, msg);
      break;
    case MessageType.SUBSCRIBE_LOGS:
      handleSubscribeLogs(ws, msg);
      break;
    case MessageType.UNSUBSCRIBE_LOGS:
      handleUnsubscribeLogs(ws, msg);
      break;
  }
}

async function handleAction(ws, msg) {
  const { id, appName, action } = msg;
  try {
    await pm2Manager.executeAction(appName, action);
    ws.send(createMessage(MessageType.ACTION_RESULT, { id, success: true }));
  } catch (err) {
    ws.send(createMessage(MessageType.ACTION_RESULT, { id, success: false, error: err.message }));
  }
}

async function handleSubscribeLogs(ws, msg) {
  const { appName } = msg;
  if (!appName) return;

  // Track subscription
  if (!logSubscriptions.has(ws)) logSubscriptions.set(ws, new Set());
  logSubscriptions.get(ws).add(appName);

  // Send initial log content
  try {
    const logs = await pm2Manager.readLogs(appName, logLines);
    if (logs.out.length > 0) {
      ws.send(createMessage(MessageType.LOG_LINES, { appName, stream: 'out', lines: logs.out }));
    }
    if (logs.err.length > 0) {
      ws.send(createMessage(MessageType.LOG_LINES, { appName, stream: 'err', lines: logs.err }));
    }
  } catch (err) {
    console.error(`Failed to read initial logs for ${appName}:`, err.message);
  }

  // Start tailing
  await pm2Manager.tailLogs(appName, ({ stream, lines }) => {
    // Send to all clients subscribed to this app
    for (const [client, subs] of logSubscriptions) {
      if (client.readyState === 1 && subs.has(appName)) {
        client.send(createMessage(MessageType.LOG_LINES, { appName, stream, lines }));
      }
    }
  });
}

function handleUnsubscribeLogs(ws, msg) {
  const { appName } = msg;
  const subs = logSubscriptions.get(ws);
  if (subs) {
    subs.delete(appName);
    // If no clients are subscribed to this app anymore, stop tailing
    let anySubscribed = false;
    for (const [, s] of logSubscriptions) {
      if (s.has(appName)) { anySubscribed = true; break; }
    }
    if (!anySubscribed) pm2Manager.stopTailing(appName);
  }
}

function cleanupClient(ws) {
  const subs = logSubscriptions.get(ws);
  if (subs) {
    for (const appName of subs) {
      let anyOther = false;
      for (const [client, s] of logSubscriptions) {
        if (client !== ws && s.has(appName)) { anyOther = true; break; }
      }
      if (!anyOther) pm2Manager.stopTailing(appName);
    }
    logSubscriptions.delete(ws);
  }
}

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server });

  // Connect to PM2 and start polling
  await pm2Manager.connect();
  await startPolling(wss);

  wss.on('connection', (ws) => {
    // Send cached process list immediately
    if (cachedProcessList) {
      ws.send(createMessage(MessageType.PROCESS_LIST, { data: cachedProcessList }));
    }

    ws.on('message', (raw) => handleClientMessage(ws, raw.toString()));
    ws.on('close', () => cleanupClient(ws));
    ws.on('error', () => cleanupClient(ws));
  });

  // Graceful shutdown
  function shutdown() {
    console.log('Shutting down...');
    clearInterval(pollTimer);
    pm2Manager.disconnect();
    wss.close();
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, () => {
    console.log(`> PM2 UI running on http://localhost:${port}`);
  });
});
```

- [ ] **Step 2: Verify server starts**

Run: `node server.js` (manually test it starts, connects to PM2, and serves Next.js). Kill with Ctrl+C after verifying startup message.

Note: The server won't serve meaningful pages yet (no App Router pages exist). This just validates the server boots and PM2 connects.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add custom server with WebSocket + PM2 integration

Single HTTP server running Next.js and WebSocket on the same port.
Persistent PM2 connection with configurable polling interval. Broadcasts
process list diffs, handles actions, and manages log subscriptions with
automatic tailing cleanup on client disconnect."
```

---

## Task 5: App Router Setup (Layout, Globals, Pages Shell)

**Files:**
- Create: `src/app/layout.js`
- Create: `src/app/globals.css`
- Create: `src/app/page.js`
- Create: `src/app/logs/[appName]/page.js`

- [ ] **Step 1: Create globals.css**

Create `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-primary: #0a0a0f;
  --bg-card: rgba(20, 20, 30, 0.8);
  --bg-card-hover: rgba(30, 30, 45, 0.9);
  --border-subtle: rgba(255, 255, 255, 0.06);
  --text-primary: #e4e4e7;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --accent-green: #22c55e;
  --accent-red: #ef4444;
  --accent-yellow: #eab308;
  --accent-blue: #3b82f6;
  --accent-orange: #f97316;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}

/* Glassmorphism card base */
.glass-card {
  background: var(--bg-card);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
}

.glass-card:hover {
  background: var(--bg-card-hover);
}

/* Status pulse animation */
@keyframes status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-status-pulse {
  animation: status-pulse 2s ease-in-out infinite;
}

/* Scrollbar styling for log viewer */
.log-scroll::-webkit-scrollbar {
  width: 6px;
}

.log-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.log-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.log-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
```

- [ ] **Step 2: Create toast provider (client component wrapper)**

`ToastContainer` is a client component and cannot be rendered directly in the server component layout. Create a `'use client'` wrapper.

Create `src/components/toast-provider.js`:

```js
'use client';

import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function ToastProvider() {
  return (
    <ToastContainer
      autoClose={2000}
      theme="dark"
      position="bottom-right"
    />
  );
}
```

- [ ] **Step 3: Create root layout**

Create `src/app/layout.js`:

```js
import './globals.css';
import ToastProvider from '@/components/toast-provider';

export const metadata = {
  title: 'PM2 UI',
  description: 'PM2 Process Management Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Create dashboard page shell**

Create `src/app/page.js`:

```js
import Dashboard from '@/components/dashboard';

export default function HomePage() {
  return <Dashboard />;
}
```

- [ ] **Step 5: Create log viewer page shell**

Create `src/app/logs/[appName]/page.js`:

```js
import LogViewer from '@/components/log-viewer';

export default function LogPage({ params }) {
  return <LogViewer appName={params.appName} />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/ src/components/toast-provider.js
git commit -m "feat: add App Router layout, globals, and page shells

Root layout with dark theme, ToastContainer, monospace font. Custom CSS
variables for glassmorphism cards and status animations. Dashboard and
log viewer page shells delegating to client components."
```

---

## Task 6: Client Hooks (usePM2, useLogs)

**Files:**
- Create: `src/hooks/use-pm2.js`
- Create: `src/hooks/use-logs.js`

- [ ] **Step 1: Create usePM2 hook**

Create `src/hooks/use-pm2.js`:

```js
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageType } from '@/lib/ws-protocol';

const ACTION_TIMEOUT = 10000;
const RECONNECT_BASE = 1000;
const RECONNECT_CAP = 30000;

export function usePM2() {
  const [processes, setProcesses] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pendingActions = useRef(new Map());
  const reconnectDelay = useRef(RECONNECT_BASE);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_BASE;
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case MessageType.PROCESS_LIST:
          setProcesses(msg.data);
          break;
        case MessageType.ACTION_RESULT: {
          const pending = pendingActions.current.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            if (msg.success) pending.resolve();
            else pending.reject(new Error(msg.error || 'Action failed'));
            pendingActions.current.delete(msg.id);
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reject all pending actions
      for (const [id, pending] of pendingActions.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket disconnected'));
      }
      pendingActions.current.clear();

      // Reconnect with exponential backoff
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_CAP);
          connectWs();
        }, reconnectDelay.current);
      }
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connectWs();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connectWs]);

  const executeAction = useCallback((appName, action) => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected'));
      }

      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingActions.current.delete(id);
        reject(new Error('Action timed out'));
      }, ACTION_TIMEOUT);

      pendingActions.current.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: MessageType.ACTION, id, appName, action }));
    });
  }, []);

  return { processes, connected, executeAction };
}
```

- [ ] **Step 2: Create useLogs hook**

Create `src/hooks/use-logs.js`:

```js
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageType } from '@/lib/ws-protocol';

const RECONNECT_BASE = 1000;
const RECONNECT_CAP = 30000;
const MAX_LINES = 2000;

export function useLogs(appName) {
  const [outLines, setOutLines] = useState([]);
  const [errLines, setErrLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectDelay = useRef(RECONNECT_BASE);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const appendLines = useCallback((setter, newLines) => {
    setter((prev) => {
      const combined = [...prev, ...newLines];
      return combined.length > MAX_LINES
        ? combined.slice(combined.length - MAX_LINES)
        : combined;
    });
  }, []);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_BASE;
      // Subscribe to logs
      ws.send(JSON.stringify({ type: MessageType.SUBSCRIBE_LOGS, appName }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === MessageType.LOG_LINES && msg.appName === appName) {
        if (msg.stream === 'out') appendLines(setOutLines, msg.lines);
        else if (msg.stream === 'err') appendLines(setErrLines, msg.lines);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_CAP);
          connectWs();
        }, reconnectDelay.current);
      }
    };

    ws.onerror = () => ws.close();
  }, [appName, appendLines]);

  useEffect(() => {
    mountedRef.current = true;
    setOutLines([]);
    setErrLines([]);
    connectWs();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MessageType.UNSUBSCRIBE_LOGS, appName }));
      }
      ws?.close();
    };
  }, [appName, connectWs]);

  return { outLines, errLines, connected };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/
git commit -m "feat: add usePM2 and useLogs WebSocket hooks

usePM2: manages WebSocket connection, process list state, and action
execution with promise-based request/response (10s timeout). Auto-
reconnects with exponential backoff (1s-30s cap).

useLogs: subscribes to log stream for a specific app, maintains
stdout/stderr line buffers (capped at 2000 lines), auto-resubscribes
on reconnection."
```

---

## Task 7: UI Components — Navbar, StatusBadge, FilterBar

**Files:**
- Create: `src/components/navbar.js`
- Create: `src/components/status-badge.js`
- Create: `src/components/filter-bar.js`

- [ ] **Step 1: Create navbar**

Create `src/components/navbar.js`:

```js
'use client';

import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeartPulse } from '@fortawesome/free-solid-svg-icons';

export default function Navbar({ connected }) {
  return (
    <nav className="px-4 w-full z-50 fixed top-0 bg-black/70 backdrop-blur-md h-14 flex items-center justify-between select-none border-b border-white/5">
      <Link href="/" className="flex items-center gap-2">
        <FontAwesomeIcon icon={faHeartPulse} className="text-emerald-400 hidden sm:inline-block" />
        <span className="font-bold text-lg text-zinc-100 tracking-tight">PM2</span>
      </Link>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <div
            className={`w-2 h-2 rounded-full ${
              connected
                ? 'bg-emerald-400 animate-status-pulse'
                : 'bg-red-400'
            }`}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Create status badge**

Create `src/components/status-badge.js`:

```js
'use client';

const statusConfig = {
  online: {
    label: 'Online',
    dotClass: 'bg-emerald-400 animate-status-pulse',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-400/10',
  },
  stopping: {
    label: 'Stopping',
    dotClass: 'bg-yellow-400',
    textClass: 'text-yellow-400',
    bgClass: 'bg-yellow-400/10',
  },
  stopped: {
    label: 'Stopped',
    dotClass: 'bg-zinc-500',
    textClass: 'text-zinc-400',
    bgClass: 'bg-zinc-400/10',
  },
  errored: {
    label: 'Errored',
    dotClass: 'bg-red-400',
    textClass: 'text-red-400',
    bgClass: 'bg-red-400/10',
  },
  launching: {
    label: 'Launching',
    dotClass: 'bg-blue-400 animate-status-pulse',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-400/10',
  },
};

const defaultConfig = {
  label: 'Unknown',
  dotClass: 'bg-zinc-600',
  textClass: 'text-zinc-500',
  bgClass: 'bg-zinc-500/10',
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || defaultConfig;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.bgClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      <span className={config.textClass}>{config.label}</span>
    </span>
  );
}
```

- [ ] **Step 3: Create filter bar**

Create `src/components/filter-bar.js`:

```js
'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

const STATUS_FILTERS = [
  { key: 'online', label: 'Online', activeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { key: 'stopped', label: 'Stopped', activeClass: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
  { key: 'errored', label: 'Errored', activeClass: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

export default function FilterBar({ search, onSearchChange, statusFilters, onStatusToggle, counts }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <FontAwesomeIcon
          icon={faMagnifyingGlass}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm"
        />
        <input
          type="text"
          placeholder="Filter processes..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-colors"
        />
      </div>

      {/* Status toggles */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map(({ key, label, activeClass }) => {
          const active = statusFilters.includes(key);
          const count = counts[key] || 0;
          return (
            <button
              key={key}
              onClick={() => onStatusToggle(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                active
                  ? activeClass
                  : 'bg-white/5 text-zinc-500 border-white/5 hover:bg-white/10'
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/navbar.js src/components/status-badge.js src/components/filter-bar.js
git commit -m "feat: add navbar, status badge, and filter bar components

Navbar with PM2 branding and WebSocket connection indicator. StatusBadge
with color-coded dot and pulse animation for online processes. FilterBar
with search input and status toggle pills showing counts."
```

---

## Task 8: UI Components — ProcessActions, ProcessCard, Dashboard

**Files:**
- Create: `src/components/process-actions.js`
- Create: `src/components/process-card.js`
- Create: `src/components/dashboard.js`

- [ ] **Step 1: Create process actions**

Create `src/components/process-actions.js`:

```js
'use client';

import { useState } from 'react';
import { Popover } from '@headlessui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlay,
  faStop,
  faArrowsRotate,
  faRotate,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { toast } from 'react-toastify';

const ACTION_BUTTONS = [
  { action: 'reload', icon: faRotate, label: 'Reload', showWhen: 'online' },
  { action: 'restart', icon: faArrowsRotate, label: 'Restart', showWhen: 'online' },
  { action: 'stop', icon: faStop, label: 'Stop', showWhen: 'online' },
  { action: 'start', icon: faPlay, label: 'Start', showWhen: 'offline' },
];

export default function ProcessActions({ appName, status, onAction }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(null);

  const isOnline = status === 'online';

  async function handleAction(action) {
    setLoading(action);
    try {
      await onAction(appName, action);
      toast.success(`${action} ${appName}`);
    } catch (err) {
      toast.error(`${action} ${appName}: ${err.message}`);
    } finally {
      setLoading(null);
    }
  }

  const visibleActions = ACTION_BUTTONS.filter((btn) =>
    btn.showWhen === 'online' ? isOnline : !isOnline
  );

  return (
    <div className="flex items-center gap-1">
      {visibleActions.map(({ action, icon, label }) => (
        <button
          key={action}
          onClick={() => handleAction(action)}
          disabled={loading !== null}
          title={label}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 disabled:opacity-30 transition-colors"
        >
          <FontAwesomeIcon
            icon={icon}
            className={`text-xs ${loading === action ? 'animate-spin' : ''}`}
          />
        </button>
      ))}

      {/* Delete with confirmation */}
      <Popover className="relative">
        <Popover.Button
          className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Delete"
        >
          <FontAwesomeIcon icon={faTrash} className="text-xs" />
        </Popover.Button>
        <Popover.Panel className="absolute right-0 z-10 mt-1 glass-card p-3 w-48">
          {({ close }) => (
            <div>
              <p className="text-xs text-zinc-400 mb-2">
                Delete <strong className="text-zinc-200">{appName}</strong>?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { handleAction('delete'); close(); }}
                  className="flex-1 px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-md hover:bg-red-500/30 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={close}
                  className="flex-1 px-2 py-1 bg-white/5 text-zinc-400 text-xs rounded-md hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Popover.Panel>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 2: Create process card**

Create `src/components/process-card.js`:

```js
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTerminal, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import StatusBadge from './status-badge';
import ProcessActions from './process-actions';

function getMemoryColor(mb) {
  if (mb < 50) return 'text-emerald-400';
  if (mb < 100) return 'text-yellow-400';
  if (mb < 250) return 'text-orange-400';
  return 'text-red-400';
}

function getCpuColor(pct) {
  if (pct < 30) return 'text-emerald-400';
  if (pct < 60) return 'text-yellow-400';
  if (pct < 85) return 'text-orange-400';
  return 'text-red-400';
}

function Metric({ label, value, unit, colorClass }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums transition-colors duration-500 ${colorClass || 'text-zinc-200'}`}>
        {value}
        {unit && <span className="text-[10px] text-zinc-500 ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function InstanceRow({ proc, onAction }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md bg-white/[0.02] border border-white/[0.03]">
      <div className="flex items-center gap-3">
        <StatusBadge status={proc.status} />
        <div className="flex gap-4">
          <Metric label="CPU" value={proc.cpu} unit="%" colorClass={getCpuColor(proc.cpu)} />
          <Metric label="MEM" value={proc.memory} unit="MB" colorClass={getMemoryColor(proc.memory)} />
          <Metric label="Uptime" value={proc.uptime} />
          <Metric label="PID" value={proc.pid || '—'} />
        </div>
      </div>
      <ProcessActions appName={proc.name} status={proc.status} onAction={onAction} />
    </div>
  );
}

export default function ProcessCard({ name, instances, onAction }) {
  const [expanded, setExpanded] = useState(instances.length <= 1);
  const isCluster = instances.length > 1;

  // Aggregate status: online if any online, errored if any errored, else stopped
  const hasOnline = instances.some((p) => p.status === 'online');
  const hasErrored = instances.some((p) => p.status === 'errored');
  const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';

  // Aggregate metrics for cluster header
  const totalCpu = instances.reduce((sum, p) => sum + p.cpu, 0);
  const totalMemory = instances.reduce((sum, p) => sum + p.memory, 0);

  return (
    <div className="glass-card p-4 flex flex-col gap-3 transition-all duration-200">
      {/* Card Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={groupStatus} />
          <h3 className="font-semibold text-zinc-100 text-sm">{name}</h3>
          {isCluster && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              x{instances.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/logs/${encodeURIComponent(name)}`}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            title="View Logs"
          >
            <FontAwesomeIcon icon={faTerminal} className="text-xs" />
          </Link>
          {!isCluster && (
            <ProcessActions appName={name} status={instances[0].status} onAction={onAction} />
          )}
          {isCluster && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
              <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} className="text-xs" />
            </button>
          )}
        </div>
      </div>

      {/* Single instance metrics (non-cluster) */}
      {!isCluster && (
        <div className="flex gap-4 px-1">
          <Metric label="CPU" value={instances[0].cpu} unit="%" colorClass={getCpuColor(instances[0].cpu)} />
          <Metric label="MEM" value={instances[0].memory} unit="MB" colorClass={getMemoryColor(instances[0].memory)} />
          <Metric label="Uptime" value={instances[0].uptime} />
          <Metric label="PID" value={instances[0].pid || '—'} />
        </div>
      )}

      {/* Cluster summary */}
      {isCluster && !expanded && (
        <div className="flex gap-4 px-1">
          <Metric label="Total CPU" value={Math.round(totalCpu)} unit="%" colorClass={getCpuColor(totalCpu / instances.length)} />
          <Metric label="Total MEM" value={Math.round(totalMemory * 100) / 100} unit="MB" colorClass={getMemoryColor(totalMemory / instances.length)} />
        </div>
      )}

      {/* Cluster expanded: per-instance rows */}
      {isCluster && expanded && (
        <div className="flex flex-col gap-1.5">
          {instances.map((proc, i) => (
            <InstanceRow key={proc.instanceId ?? i} proc={proc} onAction={onAction} />
          ))}
          <div className="pt-1">
            <ProcessActions appName={name} status={groupStatus} onAction={onAction} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create dashboard**

Create `src/components/dashboard.js`:

```js
'use client';

import { useState, useMemo } from 'react';
import Navbar from './navbar';
import FilterBar from './filter-bar';
import ProcessCard from './process-card';
import { usePM2 } from '@/hooks/use-pm2';

export default function Dashboard() {
  const { processes, connected, executeAction } = usePM2();
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState(['online', 'stopped', 'errored']);

  // Group processes by name
  const groups = useMemo(() => {
    const map = new Map();
    for (const proc of processes) {
      if (!map.has(proc.name)) map.set(proc.name, []);
      map.get(proc.name).push(proc);
    }
    return map;
  }, [processes]);

  // Status counts
  const counts = useMemo(() => {
    const c = { online: 0, stopped: 0, errored: 0 };
    for (const [, instances] of groups) {
      const hasOnline = instances.some((p) => p.status === 'online');
      const hasErrored = instances.some((p) => p.status === 'errored');
      const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';
      c[groupStatus] = (c[groupStatus] || 0) + 1;
    }
    return c;
  }, [groups]);

  // Filter groups
  const filtered = useMemo(() => {
    const entries = [];
    for (const [name, instances] of groups) {
      // Name filter
      if (search && !name.toLowerCase().includes(search.toLowerCase())) continue;
      // Status filter
      const hasOnline = instances.some((p) => p.status === 'online');
      const hasErrored = instances.some((p) => p.status === 'errored');
      const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';
      if (!statusFilters.includes(groupStatus)) continue;
      entries.push({ name, instances });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, search, statusFilters]);

  function handleStatusToggle(key) {
    setStatusFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar connected={connected} />
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilters={statusFilters}
          onStatusToggle={handleStatusToggle}
          counts={counts}
        />

        {processes.length === 0 && connected ? (
          <div className="mt-16 text-center">
            <p className="text-zinc-500 text-lg mb-2">No PM2 processes running</p>
            <p className="text-zinc-600 text-sm">
              Start a process with: <code className="px-2 py-1 bg-white/5 rounded text-zinc-400">pm2 start app.js --name my-app</code>
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(({ name, instances }) => (
              <ProcessCard
                key={name}
                name={name}
                instances={instances}
                onAction={executeAction}
              />
            ))}
          </div>
        )}

        {!connected && (
          <div className="mt-16 text-center">
            <p className="text-zinc-500 text-lg">Connecting to server...</p>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/process-actions.js src/components/process-card.js src/components/dashboard.js
git commit -m "feat: add process actions, process card, and dashboard components

ProcessActions: action buttons with loading states and delete confirmation
popover. ProcessCard: displays single or cluster processes with metrics,
color-coded thresholds, expandable instance rows, and logs link.
Dashboard: main client component wiring usePM2 hook to filter bar and
process card grid with empty state handling."
```

---

## Task 9: Log Viewer Component

**Files:**
- Create: `src/components/log-viewer.js`

- [ ] **Step 1: Create log viewer**

Create `src/components/log-viewer.js`:

```js
'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import Convert from 'ansi-to-html';
import { useLogs } from '@/hooks/use-logs';
import Navbar from './navbar';

const convert = new Convert({ fg: '#d4d4d8', bg: 'transparent' });

function LogPanel({ title, lines, pinned, onTogglePin }) {
  const containerRef = useRef(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (pinned && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, pinned]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    isAtBottomRef.current = atBottom;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 glass-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</span>
        <button
          onClick={onTogglePin}
          className={`p-1 rounded text-xs transition-colors ${
            pinned ? 'text-blue-400 bg-blue-400/10' : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={pinned ? 'Unpin from bottom' : 'Pin to bottom'}
        >
          <FontAwesomeIcon icon={faThumbtack} />
        </button>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed log-scroll"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-600 italic">No log output yet</p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className="hover:bg-white/[0.02] px-1 -mx-1 rounded"
              dangerouslySetInnerHTML={{ __html: convert.toHtml(line) }}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function LogViewer({ appName }) {
  const { outLines, errLines, connected } = useLogs(appName);
  const [pinnedOut, setPinnedOut] = useState(true);
  const [pinnedErr, setPinnedErr] = useState(true);
  const [view, setView] = useState('split'); // 'split' | 'stdout' | 'stderr'

  const decodedName = decodeURIComponent(appName);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar connected={connected} />
      <main className="flex-1 flex flex-col pt-16 pb-4 px-4 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
              <FontAwesomeIcon icon={faArrowLeft} />
            </Link>
            <h1 className="text-lg font-semibold text-zinc-100">{decodedName}</h1>
          </div>
          <div className="flex gap-1">
            {['split', 'stdout', 'stderr'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  view === v
                    ? 'bg-white/10 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
              >
                {v === 'split' ? 'Split' : v === 'stdout' ? 'Stdout' : 'Stderr'}
              </button>
            ))}
          </div>
        </div>

        {/* Log panels */}
        <div className={`flex-1 flex gap-4 min-h-0 ${
          view === 'split' ? 'flex-col lg:flex-row' : ''
        }`} style={{ height: 'calc(100vh - 10rem)' }}>
          {(view === 'split' || view === 'stdout') && (
            <LogPanel
              title="stdout"
              lines={outLines}
              pinned={pinnedOut}
              onTogglePin={() => setPinnedOut(!pinnedOut)}
            />
          )}
          {(view === 'split' || view === 'stderr') && (
            <LogPanel
              title="stderr"
              lines={errLines}
              pinned={pinnedErr}
              onTogglePin={() => setPinnedErr(!pinnedErr)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/log-viewer.js
git commit -m "feat: add real-time log viewer with ANSI color rendering

Split/tabbed view for stdout and stderr. Pin-to-bottom auto-scroll toggle.
ANSI color code rendering via ansi-to-html. Real-time streaming via useLogs
WebSocket hook. Responsive: stacks vertically on narrow screens."
```

---

## Task 10: Delete Old Pages Router Code

**Files:**
- Delete: `src/pages/` (entire directory)

- [ ] **Step 1: Verify new app works**

Start the server and verify the dashboard loads at `http://localhost:3000`:

```bash
node server.js
```

Open in browser, confirm:
- Dashboard renders with process cards (if PM2 processes are running)
- WebSocket connection indicator shows "Connected"
- Process actions work (restart, stop, start)
- Navigate to logs page and verify log streaming
- Kill with Ctrl+C

- [ ] **Step 2: Delete old Pages Router code**

```bash
rm -rf src/pages/
```

- [ ] **Step 3: Delete old public assets**

```bash
rm -f public/bg.jpg
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old Pages Router code and unused assets

Delete entire src/pages/ directory (old dashboard, login page, API routes,
auth system, legacy components). Remove bg.jpg (unused background image).
All functionality now served by App Router + WebSocket architecture."
```

---

## Task 11: Docker & Environment

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create Dockerfile**

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

- [ ] **Step 2: Add .dockerignore**

Create `.dockerignore`:

```
node_modules
.next
.git
__tests__
docs
*.md
.env.local
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add multi-stage Dockerfile

Build stage installs all deps for next build. Production stage copies
only runtime artifacts. Requires mounting host PM2 socket at runtime:
docker run -v /root/.pm2:/root/.pm2 -p 3000:3000 pm2-ui"
```

---

## Task 12: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite CLAUDE.md to reflect new architecture**

Update `CLAUDE.md` to document the new App Router + WebSocket architecture, updated commands, file structure, and remove all references to Pages Router, auth system, and old gotchas.

Key updates:
- Commands: `yarn dev` now runs `node --watch server.js`, `yarn test` runs vitest
- Architecture: App Router, custom server.js, WebSocket protocol, PM2 manager
- Components now in `src/components/`, hooks in `src/hooks/`, server libs in `src/lib/`
- No auth
- Docker usage instructions
- Remove old gotchas (auth-related, .env.local committed, Component.name fragility)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for modernized architecture"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run lint**

```bash
yarn lint
```

Expected: No errors. Fix any that appear.

- [ ] **Step 2: Run tests**

```bash
yarn test
```

Expected: All tests pass.

- [ ] **Step 3: Start dev server and smoke test**

```bash
yarn dev
```

Verify in browser:
- Dashboard loads, shows PM2 processes
- Connection indicator shows "Connected"
- Filter by name and status works
- Process actions (restart, stop, start, reload, delete) work
- Navigate to logs page, verify real-time log streaming
- ANSI colors render correctly in logs
- Pin-to-bottom toggle works
- Responsive layout works (resize browser)
- Disconnect server, verify reconnection behavior

- [ ] **Step 4: Production build test**

```bash
yarn build && yarn start
```

Verify production mode works identically to dev.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
