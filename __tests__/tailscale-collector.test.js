import { describe, it, expect, vi, beforeEach } from 'vitest';
import TailscaleCollector from '../src/lib/collectors/tailscale-collector';

// Mock exec helper: resolves with { stdout, stderr }
function mockExec(responses = {}) {
  return vi.fn(async (cmd, args) => {
    const key = args.join(' ');
    if (key.includes('version')) {
      return { stdout: responses.version || '1.80.3\n', stderr: '' };
    }
    if (key.includes('serve') && key.includes('status')) {
      return { stdout: JSON.stringify(responses.serveConfig || {}), stderr: '' };
    }
    if (key.includes('status')) {
      return { stdout: JSON.stringify(responses.nodeStatus || {
        BackendState: 'Running',
        Self: { DNSName: 'sakib-pc.mynet.ts.net.', HostName: 'sakib-pc' },
        CurrentTailnet: { MagicDNSSuffix: 'mynet.ts.net' },
      }), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
}

// Realistic ServeConfig fixtures
const SERVE_CONFIG_SINGLE = {
  TCP: { '443': { HTTPS: true } },
  Web: {
    'sakib-pc.mynet.ts.net:443': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
    },
  },
};

const FUNNEL_CONFIG = {
  TCP: { '443': { HTTPS: true } },
  Web: {
    'sakib-pc.mynet.ts.net:443': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
    },
  },
  AllowFunnel: { 'sakib-pc.mynet.ts.net:443': true },
};

const MIXED_CONFIG = {
  TCP: { '443': { HTTPS: true }, '8443': { HTTPS: true } },
  Web: {
    'sakib-pc.mynet.ts.net:443': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
    },
    'sakib-pc.mynet.ts.net:8443': {
      Handlers: { '/api': { Proxy: 'http://127.0.0.1:8080' } },
    },
  },
  AllowFunnel: { 'sakib-pc.mynet.ts.net:443': true },
};

const TCP_CONFIG = {
  TCP: { '5432': { TCPForward: 'localhost:5432' } },
};

const MULTI_PATH_CONFIG = {
  TCP: { '443': { HTTPS: true } },
  Web: {
    'sakib-pc.mynet.ts.net:443': {
      Handlers: {
        '/': { Proxy: 'http://127.0.0.1:3000' },
        '/api': { Proxy: 'http://127.0.0.1:9090' },
      },
    },
  },
};

const NODE_STATUS_RUNNING = {
  BackendState: 'Running',
  Self: { DNSName: 'sakib-pc.mynet.ts.net.', HostName: 'sakib-pc' },
  CurrentTailnet: { MagicDNSSuffix: 'mynet.ts.net' },
};

const NODE_STATUS_NEEDS_LOGIN = {
  BackendState: 'NeedsLogin',
  Self: null,
  CurrentTailnet: null,
};

const NODE_STATUS_STOPPED = {
  BackendState: 'Stopped',
  Self: null,
  CurrentTailnet: null,
};

describe('TailscaleCollector', () => {
  let collector;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = new TailscaleCollector();
  });

  it('has correct name and default interval', () => {
    expect(collector.name).toBe('tailscale');
    expect(collector.interval).toBe(15000);
  });

  describe('connect', () => {
    it('caches hostname from tailscale status on success', async () => {
      collector._deps.exec = mockExec();
      await collector.connect();
      expect(collector._hostname).toBe('sakib-pc.mynet.ts.net');
    });

    it('throws when CLI is not found', async () => {
      collector._deps.exec = vi.fn(async () => { throw new Error('ENOENT'); });
      await expect(collector.connect()).rejects.toThrow('ENOENT');
    });

    it('calls tailscale version first, then tailscale status --json', async () => {
      const exec = mockExec();
      collector._deps.exec = exec;
      await collector.connect();
      expect(exec).toHaveBeenCalledWith('tailscale', ['version'], expect.any(Object));
      expect(exec).toHaveBeenCalledWith('tailscale', ['status', '--json'], expect.any(Object));
    });
  });

  describe('disconnect', () => {
    it('is a no-op', async () => {
      await expect(collector.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('scan', () => {
    it('returns serve processes with correct shape', async () => {
      collector._deps.exec = mockExec({
        serveConfig: SERVE_CONFIG_SINGLE,
        nodeStatus: NODE_STATUS_RUNNING,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source: 'tailscale',
        id: 'ts:https:443:/',
        name: 'Port 3000 → :443',
        status: 'online',
        cpu: null,
        memory: null,
        uptime: null,
        pid: null,
        ports: [3000],
        instanceId: null,
        containerId: null,
        image: null,
        composeProject: null,
        composeService: null,
        groupId: null,
        actions: ['remove', 'upgrade'],
        hasLogs: false,
        tsType: 'serve',
        tsProtocol: 'https',
        tsExternalPort: 443,
        tsPath: '/',
        tsLocalTarget: 'http://127.0.0.1:3000',
        tsTailnetUrl: 'https://sakib-pc.mynet.ts.net:443/',
        tsPublicUrl: null,
        tsNodeStatus: 'connected',
      });
    });

    it('returns funnel processes with public URL and downgrade action', async () => {
      collector._deps.exec = mockExec({
        serveConfig: FUNNEL_CONFIG,
        nodeStatus: NODE_STATUS_RUNNING,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        tsType: 'funnel',
        actions: ['remove', 'downgrade'],
        tsPublicUrl: 'https://sakib-pc.mynet.ts.net:443/',
        tsTailnetUrl: 'https://sakib-pc.mynet.ts.net:443/',
      });
    });

    it('handles mixed serve + funnel config', async () => {
      collector._deps.exec = mockExec({
        serveConfig: MIXED_CONFIG,
        nodeStatus: NODE_STATUS_RUNNING,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result).toHaveLength(2);
      const funnel = result.find(p => p.id === 'ts:https:443:/');
      const serve = result.find(p => p.id === 'ts:https:8443:/api');
      expect(funnel.tsType).toBe('funnel');
      expect(funnel.actions).toEqual(['remove', 'downgrade']);
      expect(serve.tsType).toBe('serve');
      expect(serve.actions).toEqual(['remove', 'upgrade']);
    });

    it('returns TCP serve processes', async () => {
      collector._deps.exec = mockExec({
        serveConfig: TCP_CONFIG,
        nodeStatus: NODE_STATUS_RUNNING,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'ts:tcp:5432:/',
        tsProtocol: 'tcp',
        tsType: 'serve',
        actions: ['remove'],
        ports: [5432],
        tsLocalTarget: 'localhost:5432',
        tsTailnetUrl: null,
        tsPublicUrl: null,
      });
    });

    it('returns multiple processes for multi-path config', async () => {
      collector._deps.exec = mockExec({
        serveConfig: MULTI_PATH_CONFIG,
        nodeStatus: NODE_STATUS_RUNNING,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result).toHaveLength(2);
      expect(result.map(p => p.id).sort()).toEqual(['ts:https:443:/', 'ts:https:443:/api']);
    });

    it('returns empty array for empty config', async () => {
      collector._deps.exec = mockExec({ serveConfig: {}, nodeStatus: NODE_STATUS_RUNNING });
      await collector.connect();
      const result = await collector.scan();
      expect(result).toEqual([]);
    });

    it('sets auth-needed status and login action when NeedsLogin', async () => {
      collector._deps.exec = mockExec({
        serveConfig: SERVE_CONFIG_SINGLE,
        nodeStatus: NODE_STATUS_NEEDS_LOGIN,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result[0].status).toBe('auth-needed');
      expect(result[0].actions).toEqual(['login', 'remove']);
      expect(result[0].tsNodeStatus).toBe('needs-login');
    });

    it('sets stopped status when daemon is stopped', async () => {
      collector._deps.exec = mockExec({
        serveConfig: SERVE_CONFIG_SINGLE,
        nodeStatus: NODE_STATUS_STOPPED,
      });
      await collector.connect();
      const result = await collector.scan();

      expect(result[0].status).toBe('stopped');
      expect(result[0].tsNodeStatus).toBe('stopped');
    });

    it('skips TCP entries with HTTPS flag (handled via Web map)', async () => {
      const config = {
        TCP: { '443': { HTTPS: true }, '5432': { TCPForward: 'localhost:5432' } },
        Web: {
          'sakib-pc.mynet.ts.net:443': {
            Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
          },
        },
      };
      collector._deps.exec = mockExec({ serveConfig: config, nodeStatus: NODE_STATUS_RUNNING });
      await collector.connect();
      const result = await collector.scan();

      expect(result).toHaveLength(2);
      expect(result.find(p => p.tsProtocol === 'https')).toBeDefined();
      expect(result.find(p => p.tsProtocol === 'tcp')).toBeDefined();
    });
  });

  describe('executeAction', () => {
    beforeEach(async () => {
      collector._deps.exec = mockExec({
        serveConfig: MIXED_CONFIG,
        nodeStatus: NODE_STATUS_RUNNING,
      });
      await collector.connect();
      await collector.scan();
    });

    it('remove HTTPS calls tailscale serve <port> off', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('ts:https:443:/', 'remove');
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('tailscale', ['serve', '443', 'off'], expect.any(Object));
    });

    it('remove TCP calls tailscale serve --tcp=<port> off', async () => {
      collector._deps.exec = mockExec({ serveConfig: TCP_CONFIG, nodeStatus: NODE_STATUS_RUNNING });
      await collector.scan();

      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('ts:tcp:5432:/', 'remove');
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('tailscale', ['serve', '--tcp=5432', 'off'], expect.any(Object));
    });

    it('upgrade calls tailscale funnel --bg with correct args', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('ts:https:8443:/api', 'upgrade');
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        'tailscale',
        ['funnel', '--bg', '--https=8443', '--set-path=/api', '8080'],
        expect.any(Object)
      );
    });

    it('downgrade calls tailscale funnel <port> off', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('ts:https:443:/', 'downgrade');
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('tailscale', ['funnel', '443', 'off'], expect.any(Object));
    });

    it('login calls tailscale up', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('ts:https:443:/', 'login');
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('tailscale', ['up'], expect.any(Object));
    });

    it('add-serve calls tailscale serve --bg <localPort>', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('__new__', 'add-serve', { localPort: 4000 });
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('tailscale', ['serve', '--bg', '4000'], expect.any(Object));
    });

    it('add-funnel calls tailscale funnel --bg with port, path, and localPort', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      collector._deps.exec = exec;
      const result = await collector.executeAction('__new__', 'add-funnel', {
        localPort: 8080,
        funnelPort: 8443,
        path: '/api',
      });
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        'tailscale',
        ['funnel', '--bg', '--https=8443', '--set-path=/api', '8080'],
        expect.any(Object)
      );
    });

    it('returns error for unsupported action', async () => {
      const result = await collector.executeAction('ts:https:443:/', 'delete');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unsupported/i);
    });

    it('returns error on CLI failure', async () => {
      collector._deps.exec = vi.fn(async () => { throw new Error('command failed'); });
      const result = await collector.executeAction('ts:https:443:/', 'remove');
      expect(result.success).toBe(false);
      expect(result.error).toBe('command failed');
    });
  });

  describe('getLogs / tailLogs / stopTailing', () => {
    it('getLogs throws not supported', async () => {
      await expect(collector.getLogs('ts:https:443:/', 100)).rejects.toThrow('do not produce logs');
    });

    it('tailLogs throws not supported', async () => {
      await expect(collector.tailLogs('ts:https:443:/', vi.fn())).rejects.toThrow('do not produce logs');
    });

    it('stopTailing is a no-op', () => {
      expect(() => collector.stopTailing('ts:https:443:/')).not.toThrow();
    });
  });

  describe('getMetadata', () => {
    it('returns hostname after connect', async () => {
      collector._deps.exec = mockExec();
      await collector.connect();
      expect(collector.getMetadata()).toEqual({ hostname: 'sakib-pc.mynet.ts.net' });
    });

    it('returns null hostname before connect', () => {
      expect(collector.getMetadata()).toEqual({ hostname: null });
    });
  });
});
