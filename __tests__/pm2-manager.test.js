import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the module under test — CJS interop wraps module.exports as default
import pm2Manager from '../src/lib/pm2-manager';

// Build mock pm2 with vi.fn stubs
const mockPm2 = {
  connect: vi.fn((cb) => cb(null)),
  disconnect: vi.fn(),
  list: vi.fn((cb) => cb(null, [
    {
      name: 'web',
      pm2_env: {
        status: 'online',
        pm_uptime: Date.now() - 60000,
        NODE_APP_INSTANCE: 0,
      },
      monit: { cpu: 12, memory: 52428800 }, // 50MB
      pid: 1234,
    },
    {
      name: 'web',
      pm2_env: {
        status: 'online',
        pm_uptime: Date.now() - 60000,
        NODE_APP_INSTANCE: 1,
      },
      monit: { cpu: 8, memory: 41943040 }, // 40MB
      pid: 1235,
    },
  ])),
  restart: vi.fn((name, cb) => cb(null)),
  stop: vi.fn((name, cb) => cb(null)),
  reload: vi.fn((name, cb) => cb(null)),
  start: vi.fn((name, cb) => cb(null)),
  delete: vi.fn((name, cb) => cb(null)),
  describe: vi.fn((name, cb) => cb(null, [{
    pm2_env: {
      pm_out_log_path: '/tmp/web-out.log',
      pm_err_log_path: '/tmp/web-err.log',
    },
  }])),
};

const mockReadLastLines = {
  read: vi.fn(() => Promise.resolve('line1\nline2\nline3')),
};

describe('pm2-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Inject mock dependencies via the _deps seam
    pm2Manager._deps.pm2 = mockPm2;
    pm2Manager._deps.readLastLines = mockReadLastLines;
  });

  describe('connect / disconnect', () => {
    it('connects to PM2 daemon', async () => {
      await pm2Manager.connect();
      expect(mockPm2.connect).toHaveBeenCalledOnce();
    });

    it('disconnects from PM2 daemon', () => {
      pm2Manager.disconnect();
      expect(mockPm2.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('getProcessList', () => {
    it('returns mapped process objects', async () => {
      const list = await pm2Manager.getProcessList();
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        name: 'web',
        status: 'online',
        cpu: 12,
        pid: 1234,
        instanceId: 0,
      });
      expect(list[0].memory).toBeCloseTo(50, 0);
      expect(list[0]).toHaveProperty('uptime');
    });
  });

  describe('executeAction', () => {
    it('executes a valid action', async () => {
      await pm2Manager.executeAction('web', 'restart');
      expect(mockPm2.restart).toHaveBeenCalledWith('web', expect.any(Function));
    });

    it('rejects invalid actions', async () => {
      await expect(pm2Manager.executeAction('web', 'hack')).rejects.toThrow('Invalid action');
    });
  });

  describe('readLogs', () => {
    it('returns stdout and stderr lines', async () => {
      const logs = await pm2Manager.readLogs('web', 200);
      expect(logs.out).toEqual(['line1', 'line2', 'line3']);
      expect(logs.err).toEqual(['line1', 'line2', 'line3']);
    });
  });
});
