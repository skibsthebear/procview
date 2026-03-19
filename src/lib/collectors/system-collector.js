'use strict';

const { execSync } = require('child_process');
const { VALID_ACTIONS_BY_SOURCE } = require('../ws-protocol');

const SYSTEM_POLL_INTERVAL = parseInt(process.env.SYSTEM_POLL_INTERVAL, 10) || 30000;

const LISTEN_RE = /^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/;
const PORT_RE = /[:\]](\d+)$/;
const FIELD_RE = /"([^"]*)"/g;

class SystemCollector {
  constructor(db) {
    this._db = db;
    this.name = 'system';
    this.interval = SYSTEM_POLL_INTERVAL;
    this._pidCache = new Map(); // processId -> pid (populated on scan)

    // Dependency injection seam for testing
    this._deps = {
      execSync,
      platform: process.platform,
    };
  }

  async connect() {
    // No-op — system commands always available
  }

  async disconnect() {
    // No-op
  }

  async scan() {
    try {
      const allowlist = this._db.getAllowlist();
      let entries;

      if (this._deps.platform === 'win32') {
        entries = this._scanWindows();
      } else {
        entries = this._scanUnix();
      }

      // Filter through allowlist and build normalized results
      const results = [];
      const processedPids = new Map(); // pid -> result index (aggregate ports)

      for (const entry of entries) {
        if (!this._matchesAllowlist(entry.name, entry.port)) continue;

        if (processedPids.has(entry.pid)) {
          // Same PID, different port — add port to existing entry
          const idx = processedPids.get(entry.pid);
          if (!results[idx].ports.includes(entry.port)) {
            results[idx].ports.push(entry.port);
          }
          continue;
        }

        const cleanName = entry.name ? entry.name.replace(/\.exe$/i, '') : 'unknown';
        const primaryPort = entry.port;
        const processId = `sys:${primaryPort}:${cleanName}`;

        const proc = {
          source: 'system',
          id: processId,
          name: cleanName,
          groupId: null,
          status: 'online',
          pid: entry.pid,
          cpu: null,
          memory: null,
          uptime: null,
          ports: [primaryPort],
          instanceId: null,
          containerId: null,
          image: null,
          composeProject: null,
          composeService: null,
          actions: VALID_ACTIONS_BY_SOURCE.system,
          hasLogs: false,
        };

        processedPids.set(entry.pid, results.length);
        this._pidCache.set(processId, entry.pid);
        results.push(proc);
      }

      return results;
    } catch (err) {
      console.error('[system] scan failed:', err.message);
      return [];
    }
  }

  _scanWindows() {
    const netstatOut = this._runCommand('netstat -ano');
    const tasklistOut = this._runCommand('tasklist /FO CSV /NH');
    const pidToPort = this._parseWindowsNetstat(netstatOut);
    const pidToName = this._parseWindowsTasklist(tasklistOut);

    const entries = [];
    for (const [pid, ports] of pidToPort) {
      const name = pidToName.get(pid) || null;
      for (const port of ports) {
        entries.push({ pid, name, port });
      }
    }
    return entries;
  }

  _scanUnix() {
    const lsofOut = this._runCommand('lsof -iTCP -sTCP:LISTEN -nP');
    return this._parseLsof(lsofOut);
  }

  _runCommand(cmd) {
    try {
      return this._deps.execSync(cmd, {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
    } catch {
      return '';
    }
  }

  _parseWindowsNetstat(output) {
    const pidToPort = new Map();
    for (const line of output.split('\n')) {
      const m = line.match(LISTEN_RE);
      if (!m) continue;
      const portM = m[1].match(PORT_RE);
      if (!portM) continue;
      const pid = parseInt(m[2], 10);
      const port = parseInt(portM[1], 10);
      if (!pidToPort.has(pid)) pidToPort.set(pid, []);
      const ports = pidToPort.get(pid);
      if (!ports.includes(port)) ports.push(port);
    }
    return pidToPort;
  }

  _parseWindowsTasklist(output) {
    const pidToName = new Map();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fields = [];
      let m;
      FIELD_RE.lastIndex = 0;
      while ((m = FIELD_RE.exec(trimmed)) !== null) fields.push(m[1]);
      if (fields.length >= 2) {
        pidToName.set(parseInt(fields[1], 10), fields[0]);
      }
    }
    return pidToName;
  }

  _parseLsof(output) {
    const lines = output.split('\n');
    const seen = new Set();
    const results = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 10) continue;

      const name = parts[0];
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

      const nameField = parts[parts.length - 2];
      const portM = nameField.match(/:(\d+)$/);
      if (!portM) continue;
      const port = parseInt(portM[1], 10);

      const key = `${pid}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({ pid, name, port });
    }
    return results;
  }

  _matchesAllowlist(processName, port) {
    const allowlist = this._db.getAllowlist().filter((e) => e.enabled);
    const cleanName = (processName || '').replace(/\.exe$/i, '').toLowerCase();

    for (const entry of allowlist) {
      if (entry.type === 'process_name' && cleanName === entry.value.toLowerCase()) {
        return true;
      }
      if (entry.type === 'port_range') {
        const [minStr, maxStr] = entry.value.split('-');
        const min = parseInt(minStr, 10);
        const max = parseInt(maxStr, 10);
        if (port >= min && port <= max) return true;
      }
    }
    return false;
  }

  async executeAction(processId, action) {
    if (action !== 'kill') {
      return { success: false, error: `Unsupported action: ${action}` };
    }

    const pid = this._pidCache.get(processId);
    if (!pid) {
      return { success: false, error: `Unknown process: ${processId}` };
    }

    try {
      if (this._deps.platform === 'win32') {
        this._deps.execSync(`taskkill /PID ${pid} /T /F`, {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
        });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getLogs() {
    throw new Error('Logs not supported for system processes');
  }

  async tailLogs() {
    throw new Error('Logs not supported for system processes');
  }

  stopTailing() {
    // No-op
  }
}

module.exports = SystemCollector;
