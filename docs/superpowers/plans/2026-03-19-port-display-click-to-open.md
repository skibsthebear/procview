# Port Display & Click-to-Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the port a PM2 process is running on and make process cards clickable to open the service in a new tab.

**Architecture:** Extract `PORT` env var from PM2 process data in the server-side manager, flow it through the existing WebSocket pipeline unchanged, and render it as an interactive badge on the client-side process card with full-card click-to-open behavior.

**Tech Stack:** Node.js (CJS), Next.js 14 App Router, React, Tailwind CSS, HeadlessUI v1, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-port-display-click-to-open-design.md`

---

### Task 1: Port Extraction Tests

**Files:**
- Modify: `__tests__/pm2-manager.test.js:82` (insert new `describe` block after existing `getProcessList` tests)

- [ ] **Step 1: Write failing tests for port extraction**

Add a new `describe('port extraction')` block **inside** the outer `describe('pm2-manager', ...)` block, between the closing `});` of `getProcessList` (line 83) and the opening of `executeAction` (line 85). Each test overrides `mockPm2.list` with its own fixture:

```js
describe('port extraction', () => {
  function mockProcessWithPort(portValue) {
    return {
      name: 'api',
      pm2_env: {
        status: 'online',
        pm_uptime: Date.now() - 60000,
        NODE_APP_INSTANCE: 0,
        ...(portValue !== undefined ? { PORT: portValue } : {}),
      },
      monit: { cpu: 5, memory: 52428800 },
      pid: 9999,
    };
  }

  it('extracts numeric PORT as a number', async () => {
    mockPm2.list = vi.fn((cb) => cb(null, [mockProcessWithPort('3000')]));
    const list = await pm2Manager.getProcessList();
    expect(list[0].port).toBe(3000);
  });

  it('returns null when PORT is absent', async () => {
    mockPm2.list = vi.fn((cb) => cb(null, [mockProcessWithPort(undefined)]));
    const list = await pm2Manager.getProcessList();
    expect(list[0].port).toBeNull();
  });

  it('returns null when PORT is non-numeric', async () => {
    mockPm2.list = vi.fn((cb) => cb(null, [mockProcessWithPort('abc')]));
    const list = await pm2Manager.getProcessList();
    expect(list[0].port).toBeNull();
  });

  it('returns null when PORT is zero', async () => {
    mockPm2.list = vi.fn((cb) => cb(null, [mockProcessWithPort('0')]));
    const list = await pm2Manager.getProcessList();
    expect(list[0].port).toBeNull();
  });

  it('returns null when PORT is negative', async () => {
    mockPm2.list = vi.fn((cb) => cb(null, [mockProcessWithPort('-1')]));
    const list = await pm2Manager.getProcessList();
    expect(list[0].port).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test`
Expected: 5 new tests FAIL — `list[0].port` is `undefined` because `getProcessList()` doesn't map `port` yet.

---

### Task 2: Port Extraction Implementation

**Files:**
- Modify: `src/lib/pm2-manager.js:31-39` (add `port` field to the mapped object in `getProcessList()`)

- [ ] **Step 1: Add port extraction to getProcessList**

In `src/lib/pm2-manager.js`, modify the `list.map` callback inside `getProcessList()` (lines 31-39). Add the `port` field after `instanceId`:

Replace the existing map callback (note: file uses 8-space indent for `list.map`):
```js
      list.map((proc) => ({
        name: proc.name,
        status: proc.pm2_env?.status || 'unknown',
        cpu: proc.monit?.cpu || 0,
        memory: Math.round((proc.monit?.memory || 0) / (1024 * 1024) * 100) / 100,
        uptime: formatUptime(proc.pm2_env?.pm_uptime),
        pid: proc.pid,
        instanceId: proc.pm2_env?.NODE_APP_INSTANCE ?? null,
      }))
```

With:
```js
      list.map((proc) => {
        const p = Number(proc.pm2_env?.PORT);
        return {
          name: proc.name,
          status: proc.pm2_env?.status || 'unknown',
          cpu: proc.monit?.cpu || 0,
          memory: Math.round((proc.monit?.memory || 0) / (1024 * 1024) * 100) / 100,
          uptime: formatUptime(proc.pm2_env?.pm_uptime),
          pid: proc.pid,
          instanceId: proc.pm2_env?.NODE_APP_INSTANCE ?? null,
          port: Number.isFinite(p) && p > 0 ? p : null,
        };
      })
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `yarn test`
Expected: All tests PASS, including the 5 new port extraction tests.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pm2-manager.js __tests__/pm2-manager.test.js
git commit -m "feat: extract PORT env var from PM2 process data"
```

---

### Task 3: Event Bubbling Prevention

**Files:**
- Modify: `src/components/process-actions.js:44` (add `onClick` stop propagation to wrapping div)
- Modify: `src/components/process-card.js:77-93` (add stop propagation to log Link and chevron button)

- [ ] **Step 1: Add stopPropagation to ProcessActions wrapping div**

In `src/components/process-actions.js`, line 44, change:
```jsx
    <div className="flex items-center gap-1">
```
To:
```jsx
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
```

This covers all action buttons and the delete popover in one handler.

- [ ] **Step 2: Add stopPropagation to log Link in ProcessCard**

In `src/components/process-card.js`, line 77-83, change:
```jsx
          <Link
            href={`/logs/${encodeURIComponent(name)}`}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            title="View Logs"
          >
```
To:
```jsx
          <Link
            href={`/logs/${encodeURIComponent(name)}`}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            title="View Logs"
            onClick={(e) => e.stopPropagation()}
          >
```

- [ ] **Step 3: Add stopPropagation to cluster chevron button**

In `src/components/process-card.js`, lines 88-93, change:
```jsx
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
```
To:
```jsx
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
```

- [ ] **Step 4: Commit**

```bash
git add src/components/process-actions.js src/components/process-card.js
git commit -m "fix: prevent event bubbling on card interactive elements"
```

---

### Task 4: Port Badge and Card-Level Click

**Files:**
- Modify: `src/components/process-card.js:53-125` (add port badge, card click handler, keyboard accessibility)

- [ ] **Step 1: Derive the group port from instances**

In `src/components/process-card.js`, inside the `ProcessCard` component, after line 62 (`const totalMemory = ...`), add:

```js
  const port = instances[0]?.port ?? null;
  const serviceUrl = port ? `http://localhost:${port}` : null;

  function handleCardClick() {
    if (serviceUrl) window.open(serviceUrl, '_blank', 'noopener,noreferrer');
  }

  function handleCardKeyDown(e) {
    if (e.key === 'Enter' && serviceUrl) window.open(serviceUrl, '_blank', 'noopener,noreferrer');
  }
```

- [ ] **Step 2: Add card-level click and accessibility props to outer div**

Replace the outer `<div>` on line 65:
```jsx
    <div className="glass-card p-4 flex flex-col gap-3 transition-all duration-200">
```
With:
```jsx
    <div
      className={`glass-card p-4 flex flex-col gap-3 transition-all duration-200 ${serviceUrl ? 'cursor-pointer hover:border-white/20 hover:bg-white/[0.04]' : ''}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={serviceUrl ? 'link' : undefined}
      tabIndex={serviceUrl ? 0 : undefined}
    >
```

- [ ] **Step 3: Add port badge in the header row**

In `src/components/process-card.js`, after the process name `<h3>` (line 69) and before the cluster badge (line 70), add the port badge:

After:
```jsx
          <h3 className="font-semibold text-zinc-100 text-sm">{name}</h3>
```
Add:
```jsx
          {port ? (
            <button
              onClick={(e) => { e.stopPropagation(); window.open(serviceUrl, '_blank', 'noopener,noreferrer'); }}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
              title={`Open ${serviceUrl}`}
            >
              :{port}
            </button>
          ) : (
            <span className="text-[10px] text-zinc-600">No port</span>
          )}
```

- [ ] **Step 4: Verify the build compiles**

Run: `yarn build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/process-card.js
git commit -m "feat: add port badge and click-to-open on process cards"
```

---

### Task 5: Manual Smoke Test

- [ ] **Step 1: Set up a test process with PORT env var**

Create or modify an ecosystem config to include a `PORT` env var:
```js
// ecosystem.config.js (example, do not commit)
module.exports = {
  apps: [{
    name: 'test-app',
    script: 'server.js',
    env: { PORT: 3000 }
  }]
};
```

- [ ] **Step 2: Start dev server and verify**

Run: `yarn dev`

Verify:
1. Process card for `test-app` shows `:3000` badge in cyan next to the name
2. Hovering the card shows pointer cursor and subtle highlight
3. Clicking the card opens `http://localhost:3000` in a new tab
4. Clicking the `:3000` badge also opens `http://localhost:3000` in a new tab
5. Clicking action buttons (restart, stop, etc.) does NOT open a new tab
6. Clicking the log icon navigates to `/logs/test-app` without opening a new tab
7. A process without `PORT` shows muted "No port" text and is not clickable

- [ ] **Step 3: Run full test suite**

Run: `yarn test`
Expected: All tests PASS.

- [ ] **Step 4: Run lint**

Run: `yarn lint`
Expected: No lint errors.
