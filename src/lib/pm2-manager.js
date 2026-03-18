const pm2 = require('pm2');
const readLastLines = require('read-last-lines');
const fs = require('fs');
const { VALID_ACTIONS } = require('./ws-protocol');

// Exposed for test-time replacement (CJS modules cannot be intercepted by vi.mock)
const _deps = { pm2, readLastLines };

// Active log tailers: Map<appName, { outWatcher, errWatcher }>
const tailers = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    _deps.pm2.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function disconnect() {
  stopAllTailing();
  _deps.pm2.disconnect();
}

function getProcessList() {
  return new Promise((resolve, reject) => {
    _deps.pm2.list((err, list) => {
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
    _deps.pm2[action](appName, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function describeProcess(appName) {
  return new Promise((resolve, reject) => {
    _deps.pm2.describe(appName, (err, desc) => {
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
    _deps.readLastLines.read(outLogPath, lines).catch(() => ''),
    _deps.readLastLines.read(errLogPath, lines).catch(() => ''),
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
  _deps,
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
