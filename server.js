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
