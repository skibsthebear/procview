import { describe, it, expect, vi, beforeEach } from 'vitest';
import Pm2Collector from '../src/lib/collectors/pm2-collector';

const mockPm2Manager = {
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(),
  getProcessList: vi.fn(async () => [
    {
      name: 'web',
      status: 'online',
      cpu: 12,
      memory: 50,
      uptime: '1m 30s',
      pid: 1234,
      instanceId: 0,
      port: 3000,
    },
    {
      name: 'web',
      status: 'online',
      cpu: 8,
      memory: 40,
      uptime: '1m 30s',
      pid: 1235,
      instanceId: 1,
      port: 3000,
    },
    {
      name: 'api',
      status: 'stopped',
      cpu: 0,
      memory: 0,
      uptime: '0s',
      pid: 0,
      instanceId: null,
      port: null,
    },
  ]),
  executeAction: vi.fn(async () => {}),
  readLogs: vi.fn(async () => ({ out: ['log1'], err: ['err1'] })),
  tailLogs: vi.fn(async () => {}),
  stopTailing: vi.fn(),
};

describe('Pm2Collector', () => {
  let collector;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = new Pm2Collector(mockPm2Manager);
  });

  it('has correct name and interval', () => {
    expect(collector.name).toBe('pm2');
    expect(collector.interval).toBe(7829);
  });

  describe('connect / disconnect', () => {
    it('delegates connect to pm2Manager', async () => {
      await collector.connect();
      expect(mockPm2Manager.connect).toHaveBeenCalledOnce();
    });

    it('delegates disconnect to pm2Manager', async () => {
      await collector.disconnect();
      expect(mockPm2Manager.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('scan', () => {
    it('returns normalized process objects', async () => {
      const result = await collector.scan();
      expect(result).toHaveLength(3);

      // Check first process (web, instance 0)
      expect(result[0]).toMatchObject({
        source: 'pm2',
        id: 'pm2:web:0',
        name: 'web',
        groupId: 'web',
        status: 'online',
        pid: 1234,
        cpu: 12,
        memory: 50,
        uptime: '1m 30s',
        ports: [3000],
        instanceId: 0,
        containerId: null,
        image: null,
        composeProject: null,
        composeService: null,
        actions: ['restart', 'stop', 'reload', 'start', 'delete'],
        hasLogs: true,
      });
    });

    it('uses pm2:name for non-cluster processes', async () => {
      const result = await collector.scan();
      const api = result.find((p) => p.name === 'api');
      expect(api.id).toBe('pm2:api');
      expect(api.instanceId).toBeNull();
    });

    it('uses pm2:name:instanceId for cluster processes', async () => {
      const result = await collector.scan();
      const web0 = result.find((p) => p.id === 'pm2:web:0');
      const web1 = result.find((p) => p.id === 'pm2:web:1');
      expect(web0).toBeDefined();
      expect(web1).toBeDefined();
    });

    it('sets empty ports array when port is null', async () => {
      const result = await collector.scan();
      const api = result.find((p) => p.name === 'api');
      expect(api.ports).toEqual([]);
    });

    it('normalizes stopped status', async () => {
      const result = await collector.scan();
      const api = result.find((p) => p.name === 'api');
      expect(api.status).toBe('stopped');
    });

    it('normalizes one-launch-status to launching', async () => {
      mockPm2Manager.getProcessList.mockResolvedValueOnce([
        { name: 'starting', status: 'one-launch-status', cpu: 0, memory: 0, uptime: '0s', pid: 0, instanceId: null, port: null },
      ]);
      const result = await collector.scan();
      expect(result[0].status).toBe('launching');
    });
  });

  describe('executeAction', () => {
    it('strips pm2: prefix and delegates to pm2Manager', async () => {
      await collector.executeAction('pm2:web', 'restart');
      expect(mockPm2Manager.executeAction).toHaveBeenCalledWith('web', 'restart');
    });

    it('strips pm2:name:instanceId prefix for cluster instances', async () => {
      await collector.executeAction('pm2:web:0', 'restart');
      // For cluster, action targets the app name (all instances)
      expect(mockPm2Manager.executeAction).toHaveBeenCalledWith('web', 'restart');
    });

    it('returns success result', async () => {
      const result = await collector.executeAction('pm2:web', 'restart');
      expect(result).toEqual({ success: true });
    });

    it('returns error result on failure', async () => {
      mockPm2Manager.executeAction.mockRejectedValueOnce(new Error('pm2 error'));
      const result = await collector.executeAction('pm2:web', 'restart');
      expect(result).toEqual({ success: false, error: 'pm2 error' });
    });
  });

  describe('getLogs', () => {
    it('strips prefix and delegates', async () => {
      const result = await collector.getLogs('pm2:web', 100);
      expect(mockPm2Manager.readLogs).toHaveBeenCalledWith('web', 100);
      expect(result).toEqual({ out: ['log1'], err: ['err1'] });
    });
  });

  describe('tailLogs / stopTailing', () => {
    it('delegates tailLogs', async () => {
      const cb = vi.fn();
      await collector.tailLogs('pm2:web', cb);
      expect(mockPm2Manager.tailLogs).toHaveBeenCalledWith('web', cb);
    });

    it('delegates stopTailing', () => {
      collector.stopTailing('pm2:web');
      expect(mockPm2Manager.stopTailing).toHaveBeenCalledWith('web');
    });
  });
});
