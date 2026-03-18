const MessageType = {
  // Server -> Client
  PROCESS_LIST: 'PROCESS_LIST',
  ACTION_RESULT: 'ACTION_RESULT',
  LOG_LINES: 'LOG_LINES',
  // Client -> Server
  ACTION: 'ACTION',
  SUBSCRIBE_LOGS: 'SUBSCRIBE_LOGS',
  UNSUBSCRIBE_LOGS: 'UNSUBSCRIBE_LOGS',
};

const VALID_ACTIONS = ['restart', 'stop', 'reload', 'start', 'delete'];

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

module.exports = { MessageType, VALID_ACTIONS, createMessage, parseMessage };
