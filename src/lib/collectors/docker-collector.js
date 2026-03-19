'use strict';

const Docker = require('dockerode');
const stream = require('stream');
const { VALID_ACTIONS_BY_SOURCE } = require('../ws-protocol');

const DOCKER_POLL_INTERVAL = parseInt(process.env.DOCKER_POLL_INTERVAL, 10) || 10000;

const DOCKER_STATUS_MAP = {
  running: 'online',
  exited: 'stopped',
  paused: 'paused',
  created: 'stopped',
  restarting: 'launching',
  removing: 'stopping',
  dead: 'errored',
};

class DockerCollector {
  constructor() {
    this.name = 'docker';
    this.interval = DOCKER_POLL_INTERVAL;
    this._docker = null;
    this._tailStreams = new Map(); // processId -> { logStream, stdout, stderr }

    // Dependency injection seam for testing
    // _deps.Docker is a factory function: () => dockerInstance
    this._deps = { Docker: () => new Docker() };
  }

  async connect() {
    this._docker = this._deps.Docker();
    await this._docker.ping();
  }

  async disconnect() {
    // Stop all active log tails
    for (const [id] of this._tailStreams) {
      this.stopTailing(id);
    }
    this._docker = null;
  }

  async scan() {
    const containers = await this._docker.listContainers({ all: true });
    const results = [];

    for (const summary of containers) {
      const container = this._docker.getContainer(summary.Id);
      try {
        const info = await container.inspect();
        const shortId = summary.Id.substring(0, 12);
        const name = (info.Name || summary.Names[0] || '').replace(/^\//, '');
        const labels = info.Config?.Labels || {};
        const composeProject = labels['com.docker.compose.project'] || null;
        const composeService = labels['com.docker.compose.service'] || null;
        const stateStatus = info.State?.Status || summary.State;

        // Extract host ports
        const ports = this._extractHostPorts(info.NetworkSettings?.Ports);

        // Uptime from StartedAt
        const uptime = stateStatus === 'running' ? this._formatUptime(info.State.StartedAt) : null;

        // Get child PIDs for dedup (only running containers)
        let childPids = [];
        if (stateStatus === 'running') {
          try {
            const topData = await container.top();
            const pidIndex = topData.Titles.indexOf('PID');
            if (pidIndex >= 0) {
              childPids = topData.Processes.map((p) => parseInt(p[pidIndex], 10)).filter((p) => !isNaN(p));
            }
          } catch {
            // top() fails on non-running containers — expected
          }
        }

        results.push({
          source: 'docker',
          id: `docker:${shortId}`,
          name,
          groupId: composeProject || shortId,
          status: DOCKER_STATUS_MAP[stateStatus] || 'stopped',
          pid: info.State?.Pid || null,
          cpu: null,   // CPU/memory out of scope for v1
          memory: null,
          uptime,
          ports,
          instanceId: null,
          containerId: shortId,
          image: info.Config?.Image || summary.Image,
          composeProject,
          composeService,
          actions: VALID_ACTIONS_BY_SOURCE.docker,
          hasLogs: true,
          _childPids: childPids, // internal — used by registry for dedup
        });
      } catch (err) {
        console.error(`[docker] inspect failed for ${summary.Id}:`, err.message);
      }
    }

    return results;
  }

  _extractHostPorts(portsObj) {
    if (!portsObj) return [];
    const ports = [];
    for (const [, bindings] of Object.entries(portsObj)) {
      if (!bindings) continue;
      for (const binding of bindings) {
        const p = parseInt(binding.HostPort, 10);
        if (p > 0) ports.push(p);
      }
    }
    return [...new Set(ports)];
  }

  _formatUptime(startedAt) {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    if (isNaN(start)) return null;
    const ms = Date.now() - start;
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

  _extractContainerId(processId) {
    // "docker:abc123" -> "abc123"
    return processId.split(':')[1];
  }

  async executeAction(processId, action) {
    const containerId = this._extractContainerId(processId);
    const container = this._docker.getContainer(containerId);
    try {
      switch (action) {
        case 'start':
          await container.start();
          break;
        case 'stop':
          await container.stop({ t: 10 });
          break;
        case 'restart':
          await container.restart({ t: 5 });
          break;
        default:
          return { success: false, error: `Unsupported action: ${action}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getLogs(processId, lines) {
    const containerId = this._extractContainerId(processId);
    const container = this._docker.getContainer(containerId);

    return new Promise((resolve, reject) => {
      container.logs(
        { follow: false, stdout: true, stderr: true, tail: lines },
        (err, logStream) => {
          if (err) return reject(err);

          const stdoutBuf = new stream.PassThrough();
          const stderrBuf = new stream.PassThrough();
          const outChunks = [];
          const errChunks = [];

          stdoutBuf.on('data', (chunk) => outChunks.push(chunk.toString('utf8')));
          stderrBuf.on('data', (chunk) => errChunks.push(chunk.toString('utf8')));

          container.modem.demuxStream(logStream, stdoutBuf, stderrBuf);

          logStream.on('end', () => {
            stdoutBuf.end();
            stderrBuf.end();
            const out = outChunks.join('').split('\n').filter(Boolean);
            const err = errChunks.join('').split('\n').filter(Boolean);
            resolve({ out, err });
          });
          // Note: non-follow mode still returns a multiplexed stream (not Buffer)
          // so demuxStream works for both follow and non-follow modes
        }
      );
    });
  }

  async tailLogs(processId, callback) {
    if (this._tailStreams.has(processId)) return;

    const containerId = this._extractContainerId(processId);
    const container = this._docker.getContainer(containerId);

    return new Promise((resolve, reject) => {
      container.logs(
        { follow: true, stdout: true, stderr: true, tail: 0 },
        (err, logStream) => {
          if (err) return reject(err);

          const stdoutStream = new stream.PassThrough();
          const stderrStream = new stream.PassThrough();

          container.modem.demuxStream(logStream, stdoutStream, stderrStream);

          stdoutStream.on('data', (chunk) => {
            const lines = chunk.toString('utf8').split('\n').filter(Boolean);
            if (lines.length > 0) callback({ stream: 'out', lines });
          });

          stderrStream.on('data', (chunk) => {
            const lines = chunk.toString('utf8').split('\n').filter(Boolean);
            if (lines.length > 0) callback({ stream: 'err', lines });
          });

          this._tailStreams.set(processId, { logStream, stdout: stdoutStream, stderr: stderrStream });
          resolve();
        }
      );
    });
  }

  stopTailing(processId) {
    const entry = this._tailStreams.get(processId);
    if (entry) {
      try { entry.logStream.destroy(); } catch {}
      try { entry.stdout.end(); } catch {}
      try { entry.stderr.end(); } catch {}
      this._tailStreams.delete(processId);
    }
  }
}

module.exports = DockerCollector;
