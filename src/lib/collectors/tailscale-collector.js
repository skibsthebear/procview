'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const TAILSCALE_POLL_INTERVAL = parseInt(process.env.TAILSCALE_POLL_INTERVAL, 10) || 15000;

class TailscaleCollector {
  constructor() {
    this.name = 'tailscale';
    this.interval = TAILSCALE_POLL_INTERVAL;
    this._hostname = null;
    this._lastProcesses = new Map();

    this._deps = { exec: promisify(execFile) };
  }

  async connect() {
    await this._exec(['version']);
    const statusJson = await this._exec(['status', '--json']);
    const status = JSON.parse(statusJson);
    if (status.Self?.DNSName) {
      this._hostname = status.Self.DNSName.replace(/\.$/, '');
    }
  }

  async disconnect() {}

  async scan() {
    const statusJson = await this._exec(['status', '--json']);
    const nodeStatus = JSON.parse(statusJson);

    const backendState = nodeStatus.BackendState;
    let tsNodeStatus = 'connected';
    if (backendState === 'NeedsLogin') tsNodeStatus = 'needs-login';
    else if (backendState === 'Stopped') tsNodeStatus = 'stopped';

    if (nodeStatus.Self?.DNSName) {
      this._hostname = nodeStatus.Self.DNSName.replace(/\.$/, '');
    }

    const serveJson = await this._exec(['serve', 'status', '--json']);
    const serveConfig = JSON.parse(serveJson);

    const processes = [];

    if (serveConfig.Web) {
      for (const [hostPort, webConfig] of Object.entries(serveConfig.Web)) {
        const externalPort = parseInt(hostPort.split(':').pop(), 10);
        const isFunnel = serveConfig.AllowFunnel?.[hostPort] === true;

        for (const [path, handler] of Object.entries(webConfig.Handlers || {})) {
          const localTarget = handler.Proxy || handler.Path || '';
          const localPort = this._extractPort(localTarget);

          processes.push(this._buildProcess({
            protocol: 'https',
            externalPort,
            path,
            localTarget,
            localPort,
            isFunnel,
            tsNodeStatus,
          }));
        }
      }
    }

    if (serveConfig.TCP) {
      for (const [portStr, tcpHandler] of Object.entries(serveConfig.TCP)) {
        if (tcpHandler.HTTPS) continue;
        if (!tcpHandler.TCPForward) continue;

        const externalPort = parseInt(portStr, 10);
        const localPort = this._extractPort(tcpHandler.TCPForward);

        processes.push(this._buildProcess({
          protocol: 'tcp',
          externalPort,
          path: '/',
          localTarget: tcpHandler.TCPForward,
          localPort,
          isFunnel: false,
          tsNodeStatus,
        }));
      }
    }

    this._lastProcesses.clear();
    for (const proc of processes) {
      this._lastProcesses.set(proc.id, proc);
    }

    return processes;
  }

  _buildProcess({ protocol, externalPort, path, localTarget, localPort, isFunnel, tsNodeStatus }) {
    const id = `ts:${protocol}:${externalPort}:${path}`;

    let status = 'online';
    let actions;

    if (tsNodeStatus === 'needs-login') {
      status = 'auth-needed';
      actions = ['login', 'remove'];
    } else if (tsNodeStatus === 'stopped') {
      status = 'stopped';
      actions = ['remove'];
    } else if (isFunnel) {
      actions = ['remove', 'downgrade'];
    } else if (protocol === 'tcp') {
      actions = ['remove'];
    } else {
      actions = ['remove', 'upgrade'];
    }

    const nameSuffix = path !== '/' ? path : '';
    const name = protocol === 'tcp'
      ? `Port ${localPort || '?'} \u2192 :${externalPort} (TCP)`
      : `Port ${localPort || '?'} \u2192 :${externalPort}${nameSuffix}`;

    const tailnetUrl = protocol === 'tcp'
      ? null
      : `https://${this._hostname}:${externalPort}${path}`;

    return {
      source: 'tailscale',
      id,
      name,
      status,
      cpu: null,
      memory: null,
      uptime: null,
      pid: null,
      ports: localPort ? [localPort] : [],
      instanceId: null,
      containerId: null,
      image: null,
      composeProject: null,
      composeService: null,
      groupId: null,
      actions,
      hasLogs: false,
      tsType: isFunnel ? 'funnel' : 'serve',
      tsProtocol: protocol,
      tsExternalPort: externalPort,
      tsPath: path,
      tsLocalTarget: localTarget,
      tsTailnetUrl: tailnetUrl,
      tsPublicUrl: isFunnel ? tailnetUrl : null,
      tsNodeStatus,
    };
  }

  _extractPort(target) {
    if (!target) return null;
    const match = target.match(/:(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  _parseProcessId(processId) {
    const parts = processId.split(':');
    return {
      protocol: parts[1],
      externalPort: parseInt(parts[2], 10),
      path: parts.slice(3).join(':') || '/',
    };
  }

  async _exec(args) {
    const { stdout } = await this._deps.exec('tailscale', args, { windowsHide: true });
    return stdout;
  }

  getMetadata() {
    return { hostname: this._hostname || null };
  }

  async executeAction(processId, action, params) {
    try {
      switch (action) {
        case 'remove': {
          const { protocol, externalPort } = this._parseProcessId(processId);
          if (protocol === 'tcp') {
            await this._exec(['serve', `--tcp=${externalPort}`, 'off']);
          } else {
            await this._exec(['serve', String(externalPort), 'off']);
          }
          break;
        }
        case 'upgrade': {
          const proc = this._lastProcesses.get(processId);
          if (!proc) return { success: false, error: 'Process not found in last scan' };
          const localPort = proc.ports[0];
          await this._exec([
            'funnel', '--bg',
            `--https=${proc.tsExternalPort}`,
            `--set-path=${proc.tsPath}`,
            String(localPort),
          ]);
          break;
        }
        case 'downgrade': {
          const { externalPort } = this._parseProcessId(processId);
          await this._exec(['funnel', String(externalPort), 'off']);
          break;
        }
        case 'login':
          await this._exec(['up']);
          break;
        case 'add-serve':
          await this._exec(['serve', '--bg', String(params.localPort)]);
          break;
        case 'add-funnel': {
          const args = ['funnel', '--bg'];
          if (params.funnelPort) args.push(`--https=${params.funnelPort}`);
          if (params.path && params.path !== '/') args.push(`--set-path=${params.path}`);
          args.push(String(params.localPort));
          await this._exec(args);
          break;
        }
        default:
          return { success: false, error: `Unsupported action: ${action}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getLogs() {
    throw new Error('Tailscale rules do not produce logs');
  }

  async tailLogs() {
    throw new Error('Tailscale rules do not produce logs');
  }

  stopTailing() {}
}

module.exports = TailscaleCollector;
