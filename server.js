const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const pm2Manager = require('./src/lib/pm2-manager');
const db = require('./src/lib/db');
const CollectorRegistry = require('./src/lib/collector-registry');
const Pm2Collector = require('./src/lib/collectors/pm2-collector');
const DockerCollector = require('./src/lib/collectors/docker-collector');
const SystemCollector = require('./src/lib/collectors/system-collector');
const TailscaleCollector = require('./src/lib/collectors/tailscale-collector');
const { MessageType, createMessage, parseMessage, VALID_ACTIONS_BY_SOURCE } = require('./src/lib/ws-protocol');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT, 10) || 7829;
const logLines = parseInt(process.env.LOG_LINES, 10) || 200;

const app = next({ dev });
app.setupWebSocketHandler = () => {};
const handle = app.getRequestHandler();

let cachedProcessList = null;
const registry = new CollectorRegistry();

// Track log subscriptions: Map<ws, Set<"source:processId">>
const logSubscriptions = new Map();

function broadcastProcessList(wss) {
  const list = registry.getAll();
  const listJson = JSON.stringify(list);
  const cachedJson = JSON.stringify(cachedProcessList);

  if (listJson !== cachedJson) {
    cachedProcessList = list;
    const msg = createMessage(MessageType.PROCESS_LIST, { data: list });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }
}

function broadcastCollectorStatus(wss) {
  const status = registry.getCollectorStatus();
  const msg = createMessage(MessageType.COLLECTOR_STATUS, { collectors: status });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function handleClientMessage(ws, raw, wss) {
  const msg = parseMessage(raw);
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case MessageType.ACTION:
      handleAction(ws, msg, wss);
      break;
    case MessageType.SUBSCRIBE_LOGS:
      handleSubscribeLogs(ws, msg);
      break;
    case MessageType.UNSUBSCRIBE_LOGS:
      handleUnsubscribeLogs(ws, msg);
      break;
    case MessageType.UPDATE_SETTINGS:
      handleUpdateSettings(ws, msg, wss);
      break;
  }
}

async function handleAction(ws, msg, wss) {
  const { id, source, processId, action, params } = msg;

  // Validate action against source
  const validActions = VALID_ACTIONS_BY_SOURCE[source];
  if (!validActions || !validActions.includes(action)) {
    ws.send(createMessage(MessageType.ACTION_RESULT, { id, success: false, error: `Invalid action '${action}' for source '${source}'` }));
    return;
  }

  try {
    const result = await registry.routeAction(source, processId, action, params);
    ws.send(createMessage(MessageType.ACTION_RESULT, { id, ...result }));
    // Trigger immediate poll to reflect state change
    setTimeout(() => broadcastProcessList(wss), 500);
  } catch (err) {
    ws.send(createMessage(MessageType.ACTION_RESULT, { id, success: false, error: err.message }));
  }
}

async function handleSubscribeLogs(ws, msg) {
  const { source, processId } = msg;
  // Legacy support: if no source/processId, fall back to appName (PM2 only)
  const effectiveSource = source || 'pm2';
  const effectiveId = processId || (msg.appName ? `pm2:${msg.appName}` : null);
  if (!effectiveId) return;

  const subKey = `${effectiveSource}:${effectiveId}`;

  if (!logSubscriptions.has(ws)) logSubscriptions.set(ws, new Set());
  logSubscriptions.get(ws).add(subKey);

  // Send initial log content
  try {
    const logs = await registry.routeGetLogs(effectiveSource, effectiveId, logLines);
    if (logs.out.length > 0) {
      ws.send(createMessage(MessageType.LOG_LINES, { source: effectiveSource, processId: effectiveId, stream: 'out', lines: logs.out }));
    }
    if (logs.err.length > 0) {
      ws.send(createMessage(MessageType.LOG_LINES, { source: effectiveSource, processId: effectiveId, stream: 'err', lines: logs.err }));
    }
  } catch (err) {
    console.error(`Failed to read initial logs for ${effectiveId}:`, err.message);
  }

  // Start tailing
  try {
    await registry.routeTailLogs(effectiveSource, effectiveId, ({ stream, lines }) => {
      for (const [client, subs] of logSubscriptions) {
        if (client.readyState === 1 && subs.has(subKey)) {
          client.send(createMessage(MessageType.LOG_LINES, { source: effectiveSource, processId: effectiveId, stream, lines }));
        }
      }
    });
  } catch (err) {
    console.error(`Failed to tail logs for ${effectiveId}:`, err.message);
  }
}

function handleUnsubscribeLogs(ws, msg) {
  const { source, processId } = msg;
  const effectiveSource = source || 'pm2';
  const effectiveId = processId || (msg.appName ? `pm2:${msg.appName}` : null);
  if (!effectiveId) return;

  const subKey = `${effectiveSource}:${effectiveId}`;
  const subs = logSubscriptions.get(ws);
  if (subs) {
    subs.delete(subKey);
    let anySubscribed = false;
    for (const [, s] of logSubscriptions) {
      if (s.has(subKey)) { anySubscribed = true; break; }
    }
    if (!anySubscribed) registry.routeStopTailing(effectiveSource, effectiveId);
  }
}

async function handleUpdateSettings(ws, msg, wss) {
  const { id } = msg;
  try {
    if (msg.allowlist) {
      // Spec shape: { processNames: [...], portRanges: [...] }
      const entries = [];
      if (msg.allowlist.processNames) {
        for (const name of msg.allowlist.processNames) {
          entries.push({ type: 'process_name', value: name });
        }
      }
      if (msg.allowlist.portRanges) {
        for (const range of msg.allowlist.portRanges) {
          entries.push({ type: 'port_range', value: range });
        }
      }
      db.replaceAllowlist(entries);
    }
    if (msg.hide) db.hideProcess(msg.hide);
    if (msg.unhide) db.unhideProcess(msg.unhide);
    if (msg.setCustomName) db.setCustomName(msg.setCustomName.processId, msg.setCustomName.name);
    if (msg.removeCustomName) db.removeCustomName(msg.removeCustomName);
    if (msg.setNote) db.setNote(msg.setNote.processId, msg.setNote.note);
    if (msg.removeNote) db.removeNote(msg.removeNote);

    ws.send(createMessage(MessageType.SETTINGS_RESULT, { id, success: true }));
  } catch (err) {
    ws.send(createMessage(MessageType.SETTINGS_RESULT, { id, success: false, error: err.message }));
  }
}

function cleanupClient(ws) {
  const subs = logSubscriptions.get(ws);
  if (subs) {
    for (const subKey of subs) {
      let anyOther = false;
      for (const [client, s] of logSubscriptions) {
        if (client !== ws && s.has(subKey)) { anyOther = true; break; }
      }
      if (!anyOther) {
        const [source, ...rest] = subKey.split(':');
        const processId = rest.join(':');
        registry.routeStopTailing(source, processId);
      }
    }
    logSubscriptions.delete(ws);
  }
}

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    // REST endpoint: GET /api/settings
    if (req.method === 'GET' && parsedUrl.pathname === '/api/settings') {
      const snapshot = db.getSettingsSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url, true);
    if (dev && pathname === '/_next/webpack-hmr') {
      app.upgradeHandler(request, socket, head);
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Initialize database
  db._init();

  // Register collectors
  registry.register(new Pm2Collector(pm2Manager));
  registry.register(new DockerCollector());
  registry.register(new SystemCollector(db));
  registry.register(new TailscaleCollector());

  // Connect all collectors (graceful — failed ones marked unavailable)
  await registry.connectAll();

  // Start polling — on each update, broadcast to clients
  registry.startPolling(() => {
    broadcastProcessList(wss);
    broadcastCollectorStatus(wss);
  });

  wss.on('connection', (ws) => {
    // Send cached process list immediately
    if (cachedProcessList) {
      ws.send(createMessage(MessageType.PROCESS_LIST, { data: cachedProcessList }));
    }
    // Send collector status
    const status = registry.getCollectorStatus();
    ws.send(createMessage(MessageType.COLLECTOR_STATUS, { collectors: status }));

    ws.on('message', (raw) => handleClientMessage(ws, raw.toString(), wss));
    ws.on('close', () => cleanupClient(ws));
    ws.on('error', () => cleanupClient(ws));
  });

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down...');
    registry.disconnectAll();
    db._close();
    // Force-close all WebSocket connections so server.close() doesn't hang
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    server.close(() => process.exit(0));
    // Force exit if close hangs for more than 3 seconds
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, () => {
    console.log(`> Procview running on http://localhost:${port}`);
  });
});
