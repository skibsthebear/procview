# Port Display & Click-to-Open Design

## Summary

Add port visibility and click-to-open functionality to PM2 UI process cards. Processes that define a `PORT` environment variable in their PM2 ecosystem config will display the port as a badge and allow clicking the card to open `http://localhost:{PORT}` in a new browser tab.

## Requirements

- Extract `PORT` env var from PM2 process data and surface it in the UI
- Display port as a clickable badge on each process card header
- Make the entire card clickable to open the service in a new tab
- Processes without a `PORT` env var show a muted "No port" indicator and are not clickable
- Always use `http://localhost:{PORT}` — no HTTPS, no custom hostnames

## Design

### 1. Data Pipeline

**File:** `src/lib/pm2-manager.js`

In `getProcessList()`, extract `PORT` from the raw PM2 process object and add it to the mapped output:

```js
const p = Number(proc.pm2_env?.PORT);
port: Number.isFinite(p) && p > 0 ? p : null
```

Uses optional chaining on `pm2_env` to match the existing defensive pattern (see `instanceId` extraction). Handles missing `PORT`, non-numeric values (NaN), zero, and negative numbers — all resolve to `null`.

No WebSocket protocol changes needed — the `PROCESS_LIST` message carries arbitrary JSON, so the new field flows through automatically.

**Process object shape after change:**
```js
{
  name: string,
  status: string,
  cpu: number,
  memory: number,       // MB
  uptime: string,
  pid: number | null,
  instanceId: number | null,
  port: number | null,  // NEW
}
```

### 2. Process Card UI

**File:** `src/components/process-card.js`

#### Port Badge

In the card header row, next to the process name, render a port indicator:

- **Port exists:** A small clickable chip (e.g. `:3000`) with subtle background and monospace font. Clicking the badge opens `http://localhost:{PORT}` in a new tab via `window.open()`. The click handler calls `e.stopPropagation()` to prevent triggering card-level navigation.
- **No port:** A muted "No port" text (low opacity, gray, small font). Not clickable.

#### Card-Level Click

The card cannot be wrapped in an `<a>` tag because it contains interactive children (`<button>`, `<Link>` which renders as `<a>`) — nesting anchors/buttons inside an anchor is invalid HTML and causes unpredictable DOM restructuring.

Instead, use an `onClick` handler on the card's outer `<div>`:

- **Port exists:** Add `onClick={() => window.open('http://localhost:{PORT}', '_blank', 'noopener,noreferrer')}` to the card `<div>`. Add `role="link"`, `tabIndex={0}`, and `onKeyDown` handler (Enter key triggers `window.open`) for keyboard accessibility.
- **No port:** No `onClick` handler (current behavior).

#### Event Bubbling Prevention

Add `e.stopPropagation()` on interactive elements inside the card so they don't trigger card-level `onClick`:

- ProcessActions — add `e.stopPropagation()` on the component's wrapping `<div>` to cover all child buttons (action buttons, delete popover) in one place
- Log icon `<Link>` — wrap in an `onClick` handler that stops propagation
- Cluster expand/collapse chevron button

#### Cluster Processes

For grouped instances (same name, multiple `instanceId` values), use the port from the first instance. All instances share the same `PORT` env var since they originate from the same ecosystem config entry.

### 3. Visual Feedback

#### Hover State

When port exists, the card gets a subtle hover effect — slight border color brightening or background brightness shift — to indicate clickability. The existing `glass-card` styling is preserved and enhanced, not replaced.

#### Cursor

- `cursor-pointer` when port exists
- Default cursor when no port

#### "No port" State

The "No port" text is small, muted (lower opacity or gray), and informational only. It does not draw attention or suggest an action.

### 4. Test Updates

**File:** `__tests__/pm2-manager.test.js`

Add a new `describe('port extraction')` block with its own `list` mock overrides (avoids touching the shared fixture). Test cases:
- Process with `PORT: '3000'` env var returns `port: 3000`
- Process without `PORT` env var returns `port: null`
- Process with non-numeric `PORT: 'abc'` returns `port: null` (NaN guard)
- Process with `PORT: '0'` returns `port: null` (zero is not a valid port)
- Process with `PORT: '-1'` returns `port: null` (negative is not a valid port)

## Files Changed

| File | Change |
|------|--------|
| `src/lib/pm2-manager.js` | Extract `port` from `proc.pm2_env.PORT` in `getProcessList()` |
| `src/components/process-card.js` | Port badge, card-level `onClick` handler, event bubbling, hover styles |
| `__tests__/pm2-manager.test.js` | Tests for port extraction |

## Out of Scope

- HTTPS support
- Custom hostnames / base URLs per process
- Manual port annotation for processes without `PORT` env var
- Any new env var conventions beyond `PORT`
