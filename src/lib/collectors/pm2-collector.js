'use strict';

const { VALID_ACTIONS_BY_SOURCE } = require('../ws-protocol');

const PM2_POLL_INTERVAL = parseInt(process.env.PM2_POLL_INTERVAL, 10) || 7829;

const PM2_STATUS_MAP = {
  online: 'online',
  stopping: 'stopping',
  stopped: 'stopped',
  errored: 'errored',
  launching: 'launching',
  'one-launch-status': 'launching',
};

class Pm2Collector {
  constructor(pm2Manager) {
    this._pm2 = pm2Manager;
    this.name = 'pm2';
    this.interval = PM2_POLL_INTERVAL;
  }

  async connect() {
    await this._pm2.connect();
  }

  async disconnect() {
    this._pm2.disconnect();
  }

  async scan() {
    const list = await this._pm2.getProcessList();
    return list.map((proc) => {
      const hasInstance = proc.instanceId != null;
      const id = hasInstance ? `pm2:${proc.name}:${proc.instanceId}` : `pm2:${proc.name}`;
      return {
        source: 'pm2',
        id,
        name: proc.name,
        groupId: proc.name,
        status: PM2_STATUS_MAP[proc.status] || proc.status,
        pid: proc.pid || null,
        cpu: proc.cpu ?? null,
        memory: proc.memory ?? null,
        uptime: proc.uptime ?? null,
        ports: proc.port ? [proc.port] : [],
        instanceId: proc.instanceId ?? null,
        containerId: null,
        image: null,
        composeProject: null,
        composeService: null,
        actions: VALID_ACTIONS_BY_SOURCE.pm2,
        hasLogs: true,
      };
    });
  }

  _extractAppName(processId) {
    // "pm2:web" -> "web", "pm2:web:0" -> "web"
    const parts = processId.split(':');
    return parts[1]; // always the app name
  }

  async executeAction(processId, action) {
    const appName = this._extractAppName(processId);
    try {
      await this._pm2.executeAction(appName, action);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getLogs(processId, lines) {
    const appName = this._extractAppName(processId);
    return this._pm2.readLogs(appName, lines);
  }

  async tailLogs(processId, callback) {
    const appName = this._extractAppName(processId);
    await this._pm2.tailLogs(appName, callback);
  }

  stopTailing(processId) {
    const appName = this._extractAppName(processId);
    this._pm2.stopTailing(appName);
  }
}

module.exports = Pm2Collector;
