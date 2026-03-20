'use strict';

const COLLECTOR_MAX_FAILURES = parseInt(process.env.COLLECTOR_MAX_FAILURES, 10) || 3;
const COLLECTOR_RETRY_INTERVAL = parseInt(process.env.COLLECTOR_RETRY_INTERVAL, 10) || 60000;

class CollectorRegistry {
  constructor() {
    // Map<name, { collector, available, lastScan, failCount, lastData, timer }>
    this._collectors = new Map();
    this._retryTimer = null;
  }

  register(collector) {
    this._collectors.set(collector.name, {
      collector,
      available: false,
      lastScan: null,
      failCount: 0,
      lastData: [],
      timer: null,
    });
  }

  async connectAll() {
    const entries = [...this._collectors.values()];
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.collector.connect();
          entry.available = true;
        } catch (err) {
          console.error(`[${entry.collector.name}] connect failed:`, err.message);
          entry.available = false;
        }
      })
    );
  }

  async disconnectAll() {
    this.stopPolling();
    const entries = [...this._collectors.values()];
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.collector.disconnect();
        } catch (err) {
          console.error(`[${entry.collector.name}] disconnect failed:`, err.message);
        }
      })
    );
  }

  startPolling(onUpdate) {
    for (const [, entry] of this._collectors) {
      if (!entry.available) continue;
      const poll = async () => {
        await this._pollOne(entry);
        if (onUpdate) onUpdate();
      };
      // Initial poll
      poll();
      entry.timer = setInterval(poll, entry.collector.interval);
    }

    // Retry unavailable collectors periodically
    this._retryTimer = setInterval(async () => {
      for (const [, entry] of this._collectors) {
        if (entry.available) continue;
        try {
          await entry.collector.connect();
          entry.available = true;
          entry.failCount = 0;
          console.log(`[${entry.collector.name}] reconnected`);
          // Start polling this collector
          const poll = async () => {
            await this._pollOne(entry);
            if (onUpdate) onUpdate();
          };
          await poll();
          entry.timer = setInterval(poll, entry.collector.interval);
          if (onUpdate) onUpdate();
        } catch {
          // Still unavailable — will retry next interval
        }
      }
    }, COLLECTOR_RETRY_INTERVAL);
  }

  stopPolling() {
    for (const [, entry] of this._collectors) {
      if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
      }
    }
    if (this._retryTimer) {
      clearInterval(this._retryTimer);
      this._retryTimer = null;
    }
  }

  async pollAll() {
    const entries = [...this._collectors.values()].filter((e) => e.available);
    await Promise.all(entries.map((e) => this._pollOne(e)));
  }

  async _pollOne(entry) {
    try {
      const data = await entry.collector.scan();
      entry.lastData = data;
      entry.lastScan = Date.now();
      entry.failCount = 0;
    } catch (err) {
      entry.failCount++;
      console.error(
        `[${entry.collector.name}] scan failed (${entry.failCount}/${COLLECTOR_MAX_FAILURES}):`,
        err.message
      );
      if (entry.failCount >= COLLECTOR_MAX_FAILURES) {
        entry.available = false;
        console.error(`[${entry.collector.name}] marked unavailable after ${COLLECTOR_MAX_FAILURES} failures`);
      }
      // Keep lastData — use stale data
    }
  }

  getAll() {
    const allPm2 = [];
    const allDocker = [];
    const allSystem = [];
    const allOther = [];

    for (const [, entry] of this._collectors) {
      for (const proc of entry.lastData) {
        if (proc.source === 'pm2') allPm2.push(proc);
        else if (proc.source === 'docker') allDocker.push(proc);
        else if (proc.source === 'system') allSystem.push(proc);
        else allOther.push(proc);
      }
    }

    // Deduplication: Docker > PM2 > System (by PID)
    const dockerPids = new Set();
    for (const proc of allDocker) {
      if (proc.pid != null) dockerPids.add(proc.pid);
      if (proc._childPids) {
        for (const p of proc._childPids) dockerPids.add(p);
      }
    }

    const pm2Pids = new Set();
    for (const proc of allPm2) {
      if (proc.pid != null) pm2Pids.add(proc.pid);
    }

    const dedupedSystem = allSystem.filter((proc) => {
      if (proc.pid == null) return true;
      return !dockerPids.has(proc.pid) && !pm2Pids.has(proc.pid);
    });

    // Strip internal fields before returning
    const merged = [...allPm2, ...allDocker, ...dedupedSystem, ...allOther];
    return merged.map(({ _childPids, ...proc }) => proc);
  }

  async routeAction(source, processId, action) {
    const entry = this._collectors.get(source);
    if (!entry) throw new Error(`Unknown source: ${source}`);
    if (!entry.available) throw new Error(`Collector '${source}' is unavailable`);
    return entry.collector.executeAction(processId, action);
  }

  async routeGetLogs(source, processId, lines) {
    const entry = this._collectors.get(source);
    if (!entry) throw new Error(`Unknown source: ${source}`);
    if (!entry.available) throw new Error(`Collector '${source}' is unavailable`);
    return entry.collector.getLogs(processId, lines);
  }

  async routeTailLogs(source, processId, callback) {
    const entry = this._collectors.get(source);
    if (!entry) throw new Error(`Unknown source: ${source}`);
    if (!entry.available) throw new Error(`Collector '${source}' is unavailable`);
    return entry.collector.tailLogs(processId, callback);
  }

  routeStopTailing(source, processId) {
    const entry = this._collectors.get(source);
    if (!entry) return;
    entry.collector.stopTailing(processId);
  }

  getCollectorStatus() {
    const result = {};
    for (const [name, entry] of this._collectors) {
      result[name] = {
        available: entry.available,
        lastScan: entry.lastScan,
        metadata: typeof entry.collector.getMetadata === 'function'
          ? entry.collector.getMetadata()
          : {},
      };
    }
    return result;
  }
}

module.exports = CollectorRegistry;
