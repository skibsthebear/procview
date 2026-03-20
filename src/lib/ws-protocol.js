const MessageType = {
  // Server -> Client
  PROCESS_LIST: 'PROCESS_LIST',
  ACTION_RESULT: 'ACTION_RESULT',
  LOG_LINES: 'LOG_LINES',
  COLLECTOR_STATUS: 'COLLECTOR_STATUS',
  SETTINGS_RESULT: 'SETTINGS_RESULT',
  // Client -> Server
  ACTION: 'ACTION',
  SUBSCRIBE_LOGS: 'SUBSCRIBE_LOGS',
  UNSUBSCRIBE_LOGS: 'UNSUBSCRIBE_LOGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
};

// Backwards-compatible: existing PM2-only action list
const VALID_ACTIONS = ['restart', 'stop', 'reload', 'start', 'delete'];

const VALID_ACTIONS_BY_SOURCE = {
  pm2: ['restart', 'stop', 'reload', 'start', 'delete'],
  docker: ['start', 'stop', 'restart'],
  system: ['kill'],
  tailscale: ['remove', 'upgrade', 'downgrade', 'login', 'add-serve', 'add-funnel'],
};

function createMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { MessageType, VALID_ACTIONS, VALID_ACTIONS_BY_SOURCE, createMessage, parseMessage };
