import { describe, it, expect } from 'vitest';
import { MessageType, VALID_ACTIONS, VALID_ACTIONS_BY_SOURCE, createMessage, parseMessage } from '../src/lib/ws-protocol';

describe('ws-protocol', () => {
  describe('MessageType', () => {
    it('has all server-to-client message types', () => {
      expect(MessageType.PROCESS_LIST).toBe('PROCESS_LIST');
      expect(MessageType.ACTION_RESULT).toBe('ACTION_RESULT');
      expect(MessageType.LOG_LINES).toBe('LOG_LINES');
    });

    it('has all client-to-server message types', () => {
      expect(MessageType.ACTION).toBe('ACTION');
      expect(MessageType.SUBSCRIBE_LOGS).toBe('SUBSCRIBE_LOGS');
      expect(MessageType.UNSUBSCRIBE_LOGS).toBe('UNSUBSCRIBE_LOGS');
    });
  });

  describe('VALID_ACTIONS', () => {
    it('contains exactly the allowed PM2 actions', () => {
      expect(VALID_ACTIONS).toEqual(['restart', 'stop', 'reload', 'start', 'delete']);
    });
  });

  describe('createMessage', () => {
    it('serializes a message to JSON string', () => {
      const msg = createMessage(MessageType.PROCESS_LIST, { data: [] });
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe('PROCESS_LIST');
      expect(parsed.data).toEqual([]);
    });
  });

  describe('parseMessage', () => {
    it('deserializes a valid JSON string', () => {
      const raw = JSON.stringify({ type: 'ACTION', id: '123', appName: 'web', action: 'restart' });
      const msg = parseMessage(raw);
      expect(msg.type).toBe('ACTION');
      expect(msg.id).toBe('123');
    });

    it('returns null for invalid JSON', () => {
      expect(parseMessage('not json')).toBeNull();
    });
  });

  describe('new message types', () => {
    it('has COLLECTOR_STATUS server-to-client type', () => {
      expect(MessageType.COLLECTOR_STATUS).toBe('COLLECTOR_STATUS');
    });

    it('has SETTINGS_RESULT server-to-client type', () => {
      expect(MessageType.SETTINGS_RESULT).toBe('SETTINGS_RESULT');
    });

    it('has UPDATE_SETTINGS client-to-server type', () => {
      expect(MessageType.UPDATE_SETTINGS).toBe('UPDATE_SETTINGS');
    });
  });

  describe('VALID_ACTIONS_BY_SOURCE', () => {
    it('has PM2 actions', () => {
      expect(VALID_ACTIONS_BY_SOURCE.pm2).toEqual(['restart', 'stop', 'reload', 'start', 'delete']);
    });

    it('has Docker actions', () => {
      expect(VALID_ACTIONS_BY_SOURCE.docker).toEqual(['start', 'stop', 'restart']);
    });

    it('has System actions', () => {
      expect(VALID_ACTIONS_BY_SOURCE.system).toEqual(['kill']);
    });

    it('has Tailscale actions', () => {
      expect(VALID_ACTIONS_BY_SOURCE.tailscale).toEqual([
        'remove', 'upgrade', 'downgrade', 'login', 'add-serve', 'add-funnel',
      ]);
    });
  });
});
