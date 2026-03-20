import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CollectorRegistry from '../src/lib/collector-registry';

function makeCollector(name, opts = {}) {
  return {
    name,
    interval: opts.interval || 1000,
    connect: vi.fn(async () => {
      if (opts.connectError) throw opts.connectError;
    }),
    disconnect: vi.fn(async () => {}),
    scan: vi.fn(async () => opts.scanResult || []),
    executeAction: vi.fn(async () => opts.actionResult || { success: true }),
    getLogs: vi.fn(async () => opts.logsResult || { out: [], err: [] }),
    tailLogs: vi.fn(async () => {}),
    stopTailing: vi.fn(),
  };
}

describe('CollectorRegistry', () => {
  let registry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CollectorRegistry();
  });

  afterEach(() => {
    registry.stopPolling();
    vi.useRealTimers();
  });

  describe('register', () => {
    it('registers a collector', () => {
      const col = makeCollector('pm2');
      registry.register(col);
      expect(registry._collectors.has('pm2')).toBe(true);
    });
  });

  describe('connectAll', () => {
    it('connects all collectors', async () => {
      const pm2 = makeCollector('pm2');
      const docker = makeCollector('docker');
      registry.register(pm2);
      registry.register(docker);
      await registry.connectAll();
      expect(pm2.connect).toHaveBeenCalledOnce();
      expect(docker.connect).toHaveBeenCalledOnce();
    });

    it('marks collector as unavailable on connect failure', async () => {
      const col = makeCollector('docker', { connectError: new Error('no socket') });
      registry.register(col);
      await registry.connectAll();
      const status = registry.getCollectorStatus();
      expect(status.docker.available).toBe(false);
    });
  });

  describe('getAll (merge + deduplicate)', () => {
    it('merges results from multiple collectors', async () => {
      const pm2 = makeCollector('pm2', {
        scanResult: [{ source: 'pm2', id: 'pm2:web', name: 'web', pid: 100, ports: [3000] }],
      });
      const docker = makeCollector('docker', {
        scanResult: [{ source: 'docker', id: 'docker:abc', name: 'redis', pid: 200, ports: [6379] }],
      });
      registry.register(pm2);
      registry.register(docker);
      await registry.connectAll();
      await registry.pollAll();
      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });

    it('deduplicates system processes whose PID matches docker or pm2', async () => {
      const pm2 = makeCollector('pm2', {
        scanResult: [{ source: 'pm2', id: 'pm2:web', name: 'web', pid: 100, ports: [3000] }],
      });
      const system = makeCollector('system', {
        scanResult: [{ source: 'system', id: 'sys:3000:node', name: 'node', pid: 100, ports: [3000] }],
      });
      registry.register(pm2);
      registry.register(system);
      await registry.connectAll();
      await registry.pollAll();
      const all = registry.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].source).toBe('pm2');
    });

    it('passes through non-dedup sources (e.g. tailscale) without PID filtering', async () => {
      const pm2 = makeCollector('pm2', {
        scanResult: [{ source: 'pm2', id: 'pm2:web', name: 'web', pid: 100, ports: [3000] }],
      });
      const tailscale = makeCollector('tailscale', {
        scanResult: [{ source: 'tailscale', id: 'ts:https:443:/', name: 'Port 3000', pid: null, ports: [3000] }],
      });
      registry.register(pm2);
      registry.register(tailscale);
      await registry.connectAll();
      await registry.pollAll();
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.some(p => p.source === 'tailscale')).toBe(true);
      expect(all.some(p => p.source === 'pm2')).toBe(true);
    });
  });

  describe('routeAction', () => {
    it('routes action to correct collector', async () => {
      const pm2 = makeCollector('pm2', { actionResult: { success: true } });
      registry.register(pm2);
      await registry.connectAll();
      const result = await registry.routeAction('pm2', 'pm2:web', 'restart');
      expect(pm2.executeAction).toHaveBeenCalledWith('pm2:web', 'restart', undefined);
      expect(result.success).toBe(true);
    });

    it('throws for unknown source', async () => {
      await expect(registry.routeAction('unknown', 'x', 'stop')).rejects.toThrow('Unknown source');
    });

    it('throws for unavailable collector', async () => {
      const col = makeCollector('docker', { connectError: new Error('fail') });
      registry.register(col);
      await registry.connectAll();
      await expect(registry.routeAction('docker', 'x', 'stop')).rejects.toThrow('unavailable');
    });

    it('passes params to collector executeAction', async () => {
      const col = makeCollector('tailscale', { actionResult: { success: true } });
      registry.register(col);
      await registry.connectAll();
      const params = { localPort: 3000 };
      await registry.routeAction('tailscale', '__new__', 'add-serve', params);
      expect(col.executeAction).toHaveBeenCalledWith('__new__', 'add-serve', params);
    });
  });

  describe('routeLogs', () => {
    it('routes getLogs to correct collector', async () => {
      const pm2 = makeCollector('pm2', { logsResult: { out: ['line1'], err: [] } });
      registry.register(pm2);
      await registry.connectAll();
      const logs = await registry.routeGetLogs('pm2', 'pm2:web', 200);
      expect(pm2.getLogs).toHaveBeenCalledWith('pm2:web', 200);
      expect(logs.out).toEqual(['line1']);
    });

    it('routes tailLogs to correct collector', async () => {
      const pm2 = makeCollector('pm2');
      registry.register(pm2);
      await registry.connectAll();
      const cb = vi.fn();
      await registry.routeTailLogs('pm2', 'pm2:web', cb);
      expect(pm2.tailLogs).toHaveBeenCalledWith('pm2:web', cb);
    });

    it('routes stopTailing to correct collector', async () => {
      const pm2 = makeCollector('pm2');
      registry.register(pm2);
      await registry.connectAll();
      registry.routeStopTailing('pm2', 'pm2:web');
      expect(pm2.stopTailing).toHaveBeenCalledWith('pm2:web');
    });
  });

  describe('error resilience', () => {
    it('keeps last known data on scan failure', async () => {
      let callCount = 0;
      const col = makeCollector('pm2', {
        scanResult: [{ source: 'pm2', id: 'pm2:web', name: 'web', pid: 100, ports: [] }],
      });
      col.scan = vi.fn(async () => {
        callCount++;
        if (callCount > 1) throw new Error('scan failed');
        return [{ source: 'pm2', id: 'pm2:web', name: 'web', pid: 100, ports: [] }];
      });
      registry.register(col);
      await registry.connectAll();

      await registry.pollAll(); // success
      expect(registry.getAll()).toHaveLength(1);

      await registry.pollAll(); // failure — keeps last data
      expect(registry.getAll()).toHaveLength(1);
    });

    it('marks collector unavailable after max consecutive failures', async () => {
      const col = makeCollector('pm2');
      col.scan = vi.fn(async () => { throw new Error('fail'); });
      registry.register(col);
      await registry.connectAll();

      // Default max failures is 3
      for (let i = 0; i < 3; i++) {
        await registry.pollAll();
      }
      const status = registry.getCollectorStatus();
      expect(status.pm2.available).toBe(false);
    });

    it('resets failure count on successful scan', async () => {
      let callCount = 0;
      const col = makeCollector('pm2');
      col.scan = vi.fn(async () => {
        callCount++;
        if (callCount <= 2) throw new Error('fail');
        return [{ source: 'pm2', id: 'pm2:web', name: 'web', pid: 100, ports: [] }];
      });
      registry.register(col);
      await registry.connectAll();

      await registry.pollAll(); // fail 1
      await registry.pollAll(); // fail 2
      await registry.pollAll(); // success — resets count
      const status = registry.getCollectorStatus();
      expect(status.pm2.available).toBe(true);
    });
  });

  describe('getCollectorStatus', () => {
    it('returns status for all registered collectors', async () => {
      const pm2 = makeCollector('pm2');
      const docker = makeCollector('docker');
      registry.register(pm2);
      registry.register(docker);
      await registry.connectAll();
      const status = registry.getCollectorStatus();
      expect(status.pm2).toBeDefined();
      expect(status.pm2.available).toBe(true);
      expect(status.docker).toBeDefined();
    });

    it('includes metadata from collectors that implement getMetadata()', async () => {
      const col = makeCollector('tailscale');
      col.getMetadata = vi.fn(() => ({ hostname: 'sakib-pc.mynet.ts.net' }));
      registry.register(col);
      await registry.connectAll();
      const status = registry.getCollectorStatus();
      expect(status.tailscale.metadata).toEqual({ hostname: 'sakib-pc.mynet.ts.net' });
    });

    it('returns empty metadata for collectors without getMetadata()', async () => {
      const col = makeCollector('pm2');
      registry.register(col);
      await registry.connectAll();
      const status = registry.getCollectorStatus();
      expect(status.pm2.metadata).toEqual({});
    });
  });

  describe('disconnectAll', () => {
    it('disconnects all collectors', async () => {
      const pm2 = makeCollector('pm2');
      registry.register(pm2);
      await registry.connectAll();
      await registry.disconnectAll();
      expect(pm2.disconnect).toHaveBeenCalledOnce();
    });
  });
});
