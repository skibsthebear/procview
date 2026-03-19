# Tailscale Serve & Funnel Integration — Design Spec

## Overview

Add Tailscale as a 4th process source in Procview, alongside PM2, Docker, and System. The Tailscale collector surfaces all active Tailscale Serve (tailnet-private) and Funnel (public internet) rules as process cards in the dashboard. Users can also add new serve/funnel rules and manage existing ones directly from the UI.

## Goals

- Surface all active Tailscale Serve and Funnel rules in the dashboard
- Allow users to add new serve and funnel rules from the UI
- Provide clear, informative UI so users always understand what each rule does and its visibility scope (private tailnet vs public internet)
- Support actions: remove, upgrade (serve→funnel), downgrade (funnel→serve), login (re-auth)
- Gracefully degrade when Tailscale is not installed or not authenticated

## Non-Goals

- No Tailscale ACL management
- No node-level status summary card (auth issues surface on individual cards)
- No log streaming (Tailscale rules don't produce per-rule logs)
- No local API socket integration (CLI-only approach)

---

## 1. Tailscale Collector

**File**: `src/lib/collectors/tailscale-collector.js`

### Interface

Implements the standard collector interface: `name`, `interval`, `connect()`, `disconnect()`, `scan()`, `executeAction()`, `getLogs()`, `tailLogs()`, `stopTailing()`.

- `name`: `'tailscale'`
- `interval`: Controlled by `TAILSCALE_POLL_INTERVAL` env var, default `15000` (15 seconds). Tailscale config changes infrequently, so a relaxed interval is appropriate.

### Data Gathering

Two CLI calls per poll cycle, both using `child_process.execFile` with `windowsHide: true` to prevent console window flashing on Windows:

1. `tailscale serve status --json` — Returns `ServeConfig` JSON with all serve/funnel rules
2. `tailscale status --json` — Returns node status (hostname, tailnet name, connection state, backend state)

### `connect()`

- Runs `tailscale version` to verify the CLI is available. Throws if not found → collector marked degraded.
- Runs `tailscale status --json` to cache node hostname and tailnet domain name, needed to construct tailnet/public URLs for cards.

### `disconnect()`

No-op. No persistent connections to clean up.

### `scan()`

Parses the `ServeConfig` JSON. For each entry in the `Web` handlers map, emits a process object:

```js
{
  source: 'tailscale',
  id: 'ts:https:443:/',              // format: ts:<protocol>:<externalPort>:<path>
  name: 'Port 3000 → :443',          // default display name, overridable via settings
  status: 'online',                   // or 'auth-needed', 'offline', 'stopped'
  cpu: null,
  memory: null,
  uptime: null,
  pid: null,
  ports: [3000],                      // the local target port
  instanceId: null,
  containerId: null,
  image: null,
  composeProject: null,
  composeService: null,
  groupId: null,
  actions: ['remove'],                // + 'upgrade' for serves, + 'downgrade' for funnels
  hasLogs: false,

  // Tailscale-specific fields
  tsType: 'serve' | 'funnel',
  tsProtocol: 'https' | 'tcp',
  tsExternalPort: 443,
  tsPath: '/',
  tsLocalTarget: 'http://127.0.0.1:3000',
  tsTailnetUrl: 'https://hostname.tailnet.ts.net:443/',
  tsPublicUrl: 'https://hostname.tailnet.ts.net:443/',  // only for funnels, null for serves
  tsNodeStatus: 'connected' | 'needs-login' | 'stopped',
}
```

**ID format**: `ts:<protocol>:<externalPort>:<path>` — e.g., `ts:https:443:/`, `ts:https:8443:/api`, `ts:tcp:5432:/`. This is stable because a rule is uniquely identified by its protocol, external port, and path. The local target port can change without affecting the ID.

**Status derivation**:
- Tailscale connected + rule exists → `online`
- Tailscale backend state indicates login needed → `auth-needed` (adds `login` to actions)
- Tailscale daemon not running → `stopped`

**Serve vs Funnel detection**: A rule is a funnel if `AllowFunnel[hostname:port]` is `true` in the `ServeConfig`. Otherwise it's a serve.

**Action list per rule**:
- HTTPS serves: `['remove', 'upgrade']`
- TCP serves: `['remove']` only — `upgrade` is omitted because Tailscale Funnel does not support TCP
- Funnels: `['remove', 'downgrade']`
- When `auth-needed`: `['login', 'remove']`

### `executeAction(processId, action, params)`

| Action | CLI Command | Notes |
|--------|-------------|-------|
| `remove` | HTTPS: `tailscale serve <externalPort> off`; TCP: `tailscale serve --tcp=<externalPort> off` | Removes the entire serve config for that port (which also implicitly removes any funnel on it). Branch on `tsProtocol` from the process object (derivable from the processId prefix `ts:<protocol>:...`). |
| `upgrade` | `tailscale funnel --bg --https=<externalPort> --set-path=<path> <localPort>` | Promotes serve to funnel. Tailscale's `funnel` command builds on the existing serve config. |
| `downgrade` | `tailscale funnel <externalPort> off` then verify serve remains | `tailscale funnel <port> off` removes only the public funnel layer, leaving the underlying serve intact. No need to re-add the serve — it was never removed. |
| `login` | `tailscale up` | Triggers re-authentication |
| `add-serve` | `tailscale serve --bg <localPort>` | Creation action, uses `params.localPort` |
| `add-funnel` | `tailscale funnel --bg --https=<funnelPort> --set-path=<path> <localPort>` | Creation action, uses `params.localPort`, `params.funnelPort`, `params.path` |

**Creation actions (`add-serve`, `add-funnel`)**: These use a synthetic `processId` of `"__new__"`. The collector's `executeAction` method checks for creation actions first and routes them to params-based handling, bypassing any process-ID parsing logic. The `"__new__"` value is never parsed as a real process identifier.

All CLI calls use `windowsHide: true`.

Returns `{ success: boolean, error?: string }`.

### `getLogs()` / `tailLogs()` / `stopTailing()`

All throw `Error('Tailscale rules do not produce logs')`.

### `_deps` Pattern

```js
this._deps = { exec: child_process.execFile };
```

Tests inject a mock `exec` function to control CLI output.

---

## 2. Add Tailscale Rule Modal

**File**: `src/components/tailscale-modal.js`

A modal dialog triggered by a `[+ TS]` button in the filter bar. Only rendered when the Tailscale collector is active (not in error state).

### Layout

```
┌───────────────── Add Tailscale Rule ─────────────────────┐
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ i  Tailscale Serve exposes a local port to devices  │ │
│  │    on your tailnet (private). Funnel makes it       │ │
│  │    publicly accessible from the internet.           │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Type:    (*) Serve    ( ) Funnel                        │
│                                                          │
│  Local port:  [ 3000        ]                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │ The port of the service running on this machine.  │    │
│  │ e.g. a Next.js app on port 3000                   │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  -- When Serve is selected: --                           │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Your service will be available at:                │    │
│  │ https://sakib-pc.mynet.ts.net/                    │    │
│  │ Only devices on your tailnet can access it.       │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  -- When Funnel is selected: --                          │
│                                                          │
│  Funnel port: [ 443 v ]  (443 / 8443 / 10000)           │
│  ┌──────────────────────────────────────────────────┐    │
│  │ !  Funnel is limited to ports 443, 8443, or       │    │
│  │    10000. Only 3 funnels max per machine.          │    │
│  │    Slots used: 1/3                                 │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Path prefix: [ /          ]  (optional)                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Use path prefixes to share a funnel port across   │    │
│  │ multiple services. e.g. /api, /dashboard          │    │
│  │ Rule ID: ts:https:443:/                           │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Your service will be publicly accessible at:      │    │
│  │ https://sakib-pc.mynet.ts.net:443/                │    │
│  │ !  Anyone on the internet can reach this URL.     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│             [ Cancel ]  [ Add Rule ]                     │
└──────────────────────────────────────────────────────────┘
```

### Behavior

- **Live URL preview**: Updates in real-time as the user types port/path, using the cached hostname from the collector (passed as a prop).
- **Funnel slot counter**: Shows `X/3 used`. Disables "Add Rule" if all 3 funnel ports are taken. Grays out already-used funnel ports in the dropdown.
- **Rule ID preview**: Shows the `ts:<protocol>:<port>:<path>` identifier so users understand how rules are keyed.
- **Contextual tips**: Swap between serve/funnel explanations as the radio selection changes.
- **Validation**: Local port must be a number 1-65535. Path must start with `/`. Cannot add a rule for an existing ID.

### Data Flow

The modal needs two pieces of data passed as props:
1. **`tsHostname`** — The node's full `hostname.tailnet.ts.net` string (for URL previews)
2. **`tsProcesses`** — Current Tailscale process list (to calculate funnel slot usage and validate against duplicates)

**How `tsHostname` reaches the client**: Extend the `COLLECTOR_STATUS` message to include an optional `metadata` field per collector. The collector registry's `getCollectorStatus()` method will call an optional `getMetadata()` method on each collector (returns `{}` by default). The Tailscale collector implements `getMetadata()` returning `{ hostname: 'sakib-pc.mynet.ts.net' }`. The dashboard receives this via the existing `COLLECTOR_STATUS` broadcast and passes it to the modal. This avoids polluting the process objects and works even when there are zero Tailscale rules (empty state — the user still needs the hostname for the URL preview in the "Add" modal).

**Client-side wiring for `onAdd`**: Dashboard defines a `handleAddTailscaleRule(type, params)` function that sends the `ACTION` message directly via the shared WebSocket ref from `useProcesses` (bypassing `executeAction`, which doesn't support `params`). Dashboard passes this handler as `onAddTailscaleRule` prop to `FilterBar`, which forwards it to `TailscaleModal`. This is the same prop-threading pattern used for `onSelectOnly`/`onSelectAll`.

On submit, the modal calls `onAddTailscaleRule(type, params)` which sends an `ACTION` WebSocket message:

```json
{
  "type": "ACTION",
  "id": "uuid",
  "source": "tailscale",
  "processId": "__new__",
  "action": "add-serve",
  "params": { "localPort": 3000 }
}
```

or for funnel:

```json
{
  "type": "ACTION",
  "id": "uuid",
  "source": "tailscale",
  "processId": "__new__",
  "action": "add-funnel",
  "params": { "localPort": 8080, "funnelPort": 443, "path": "/api" }
}
```

---

## 3. UI Integration

### Process Card (`process-card.js`)

**New source badge**: Teal/cyan color for Tailscale branding.
```
tailscale: { icon: faNetworkWired, text: 'text-teal-400', bg: 'bg-teal-500/10' }
```

**Tailscale-specific card rendering**: When `source === 'tailscale'`, the card displays additional rows:

- **Type label**: `(serve)` or `(funnel)` next to the process name
- **Local target**: `localhost:<port>`
- **Tailnet URL**: Full `https://hostname.tailnet.ts.net:<port><path>` — clickable to open in new tab
- **Public URL** (funnel only): Same URL with a warning label — clickable to open in new tab
- **Funnel warning banner**: `"Publicly accessible from the internet"` — always visible on funnel cards, not dismissible
- **Auth warning**: When status is `auth-needed`, shows a prominent warning with instructions: `"Tailscale needs re-authentication. Run 'tailscale up' or click Login below."`

### Filter Bar (`filter-bar.js`)

Add to `SOURCE_FILTERS`:
```js
{ key: 'tailscale', label: 'Tailscale', activeClass: 'bg-teal-500/20 text-teal-400 border-teal-500/30' }
```

Add a `[+ TS]` button after the filter buttons:
- Only renders when the Tailscale collector is registered and not in error state
- Dashboard must pass `collectorStatus` (or a derived `tailscaleAvailable` boolean) to `FilterBar` as a new prop for this visibility check
- Opens the Add Tailscale Rule modal on click
- Styled as a small action button, not a filter toggle

### Dashboard (`dashboard.js`)

- Add `'tailscale'` to `SOURCE_ORDER` array (after `'system'`)
- Add `'tailscale'` to `SOURCE_FILTERS` constant
- Add `tailscale: 0` to initial `sourceCounts` object
- Pass Tailscale-specific props to the modal: `tsHostname` and Tailscale processes for slot counting

### Navbar (`navbar.js`)

- Add `tailscale: 'Tailscale'` to `SOURCE_LABELS` for the collector health dot display

### Process Actions (`process-actions.js`)

Tailscale actions do not use the `showWhen` gate (which maps to `online`/`offline` status). Instead, they follow the `delete` pattern: they render unconditionally when present in the process's `actions` array, bypassing `ACTION_CONFIG` entirely. Each Tailscale action is handled in its own dedicated JSX block in `ProcessActions`, gated only by `actions.includes('actionName')`.

| Action | Label | Icon | Color | Confirm |
|--------|-------|------|-------|---------|
| `remove` | Remove | faTrash | red | yes |
| `upgrade` | Upgrade to Funnel | faArrowUp | teal | yes ("This will make the service publicly accessible") |
| `downgrade` | Downgrade to Serve | faArrowDown | yellow | yes ("This will remove public access") |
| `login` | Login | faSignIn | blue | no |

### WS Protocol (`ws-protocol.js`)

Add to `VALID_ACTIONS_BY_SOURCE`:
```js
tailscale: ['remove', 'upgrade', 'downgrade', 'login', 'add-serve', 'add-funnel']
```

---

## 4. Server Integration

### Registration (`server.js`)

```js
const TailscaleCollector = require('./src/lib/collectors/tailscale-collector');
const tsCollector = new TailscaleCollector();
registry.register(tsCollector);
```

### Action Routing Extension

The `handleAction` function needs a minor extension to pass `msg.params` through to `registry.routeAction` as a 4th argument:

```js
// Before
registry.routeAction(msg.source, msg.processId, msg.action)

// After
registry.routeAction(msg.source, msg.processId, msg.action, msg.params)
```

`collector-registry.js` `routeAction` forwards `params` to `collector.executeAction(processId, action, params)`. Existing collectors ignore the extra argument.

### Environment Variable

`TAILSCALE_POLL_INTERVAL` — Poll interval in ms (default: `15000`).

### Deduplication & `getAll()` Source Bucketing

Tailscale rules are routing config, not processes — they don't overlap with system/PM2/Docker processes by PID. However, `collector-registry.js` `getAll()` hard-codes source bucketing for only `pm2`, `docker`, and `system`. Processes with any other `source` value are silently dropped. This must be fixed:

Refactor `getAll()` to pass through any source that doesn't participate in PID deduplication. The PID dedup logic (which filters out system processes whose PIDs are claimed by PM2/Docker) only involves those three sources. Tailscale processes (which have `pid: null`) should be appended directly to the merged list without going through the dedup pipeline. The simplest fix is to add an `else` clause that pushes unrecognized sources straight to `merged`.

---

## 5. Testing

**File**: `__tests__/tailscale-collector.test.js`

Uses the `_deps` pattern (same as docker-collector and system-collector tests).

### Test Cases

| Test | What it verifies |
|------|-----------------|
| `connect()` success | Caches hostname/tailnet from `tailscale status --json` |
| `connect()` CLI not found | Throws error → collector marked degraded |
| `scan()` with serves | Correct process objects with `tsType: 'serve'`, correct URLs, `actions: ['remove', 'upgrade']` |
| `scan()` with funnels | Correct process objects with `tsType: 'funnel'`, public URL set, `actions: ['remove', 'downgrade']` |
| `scan()` mixed config | Both serves and funnels parsed correctly from one `ServeConfig` |
| `scan()` empty config | Returns `[]` |
| `scan()` auth-needed | Status set to `auth-needed`, `login` added to actions |
| `scan()` daemon stopped | Status set to `stopped` |
| `executeAction` remove | Calls `tailscale serve <port> off` |
| `executeAction` upgrade | Calls `tailscale funnel --bg --https=<port> ...` |
| `executeAction` downgrade | Calls `tailscale funnel <port> off` only; verifies serve remains intact (no re-add needed) |
| `executeAction` login | Calls `tailscale up` |
| `executeAction` add-serve | Calls `tailscale serve --bg <localPort>` with params |
| `executeAction` add-funnel | Calls `tailscale funnel --bg --https=<port> --set-path=<path> <localPort>` with params |
| `getLogs` / `tailLogs` | Throws "not supported" |
| Error handling | Graceful degradation on CLI errors |

---

## 6. File Change Summary

| File | Change |
|------|--------|
| `src/lib/collectors/tailscale-collector.js` | **New** — Full collector implementation |
| `src/components/tailscale-modal.js` | **New** — Add Tailscale Rule modal |
| `__tests__/tailscale-collector.test.js` | **New** — Collector tests |
| `src/lib/ws-protocol.js` | Add `tailscale` to `VALID_ACTIONS_BY_SOURCE` |
| `src/lib/collector-registry.js` | Pass `params` through `routeAction`; fix `getAll()` to pass through non-dedup sources; add optional `getMetadata()` call to `getCollectorStatus()` |
| `server.js` | Register collector, pass `msg.params` in `handleAction` |
| `src/components/process-card.js` | Add teal badge, Tailscale-specific card rows |
| `src/components/filter-bar.js` | Add Tailscale filter + `[+ TS]` button |
| `src/components/dashboard.js` | Add `'tailscale'` to source arrays, pass modal props |
| `src/components/process-actions.js` | Add dedicated JSX blocks for `remove`, `upgrade`, `downgrade`, `login` (bypasses `ACTION_CONFIG`, follows `delete` pattern) |
| `src/components/navbar.js` | Add `tailscale` to `SOURCE_LABELS` |
| `CLAUDE.md` | Document new collector, env var, and Tailscale-specific fields |
