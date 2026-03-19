import { describe, it, expect, vi, beforeEach } from 'vitest';
import SystemCollector from '../src/lib/collectors/system-collector';

// Mock db module
const mockDb = {
  getAllowlist: vi.fn(() => [
    { id: 1, type: 'process_name', value: 'node', enabled: 1 },
    { id: 2, type: 'process_name', value: 'python', enabled: 1 },
    { id: 3, type: 'port_range', value: '3000-9999', enabled: 1 },
    { id: 4, type: 'process_name', value: 'disabled_proc', enabled: 0 },
  ]),
};

describe('SystemCollector', () => {
  let collector;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = new SystemCollector(mockDb);
  });

  it('has correct name and interval', () => {
    expect(collector.name).toBe('system');
    expect(collector.interval).toBe(30000);
  });

  describe('connect / disconnect', () => {
    it('connect is a no-op', async () => {
      await expect(collector.connect()).resolves.toBeUndefined();
    });

    it('disconnect is a no-op', async () => {
      await expect(collector.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('_parseWindowsNetstat', () => {
    it('parses LISTENING entries from netstat -ano output', () => {
      const output = [
        '',
        'Active Connections',
        '',
        '  Proto  Local Address          Foreign Address        State           PID',
        '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345',
        '  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       4',
        '  TCP    [::1]:3000             [::]:0                 LISTENING       12345',
        '  TCP    0.0.0.0:5000           0.0.0.0:0              ESTABLISHED     9999',
        '',
      ].join('\n');

      const result = collector._parseWindowsNetstat(output);
      // Should have entries for port 3000 (pid 12345) and port 80 (pid 4)
      expect(result.has(12345)).toBe(true);
      expect(result.get(12345)).toContain(3000);
      expect(result.has(4)).toBe(true);
      expect(result.get(4)).toContain(80);
      // ESTABLISHED should not be included
      expect(result.has(9999)).toBe(false);
    });

    it('handles IPv6 addresses', () => {
      const output = '  TCP    [::]:5173              [::]:0                 LISTENING       7777\n';
      const result = collector._parseWindowsNetstat(output);
      expect(result.get(7777)).toContain(5173);
    });
  });

  describe('_parseWindowsTasklist', () => {
    it('parses tasklist CSV output to pid->name map', () => {
      const output = [
        '"Image Name","PID","Session Name","Session#","Mem Usage"',
        '"node.exe","12345","Console","1","45,678 K"',
        '"python.exe","7777","Console","1","22,100 K"',
      ].join('\n');

      const result = collector._parseWindowsTasklist(output);
      expect(result.get(12345)).toBe('node.exe');
      expect(result.get(7777)).toBe('python.exe');
    });
  });

  describe('_parseLsof', () => {
    it('parses lsof output', () => {
      const output = [
        'COMMAND     PID   USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME',
        'node      12345  sakib   23u  IPv4   0x7f            0t0  TCP *:3000 (LISTEN)',
        'node      12345  sakib   24u  IPv6   0x7f            0t0  TCP *:3000 (LISTEN)',
        'python3    7777  sakib    4u  IPv4   0x7f            0t0  TCP 127.0.0.1:8080 (LISTEN)',
      ].join('\n');

      const result = collector._parseLsof(output);
      // Deduplicates IPv4/IPv6 for same pid:port
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ pid: 12345, name: 'node', port: 3000 });
      expect(result[1]).toEqual({ pid: 7777, name: 'python3', port: 8080 });
    });
  });

  describe('_matchesAllowlist', () => {
    it('matches by process name', () => {
      expect(collector._matchesAllowlist('node.exe', 5000)).toBe(true);
      expect(collector._matchesAllowlist('node', 5000)).toBe(true);
      expect(collector._matchesAllowlist('python', 5000)).toBe(true);
    });

    it('matches by port range', () => {
      expect(collector._matchesAllowlist('unknown.exe', 3000)).toBe(true);
      expect(collector._matchesAllowlist('unknown.exe', 9999)).toBe(true);
    });

    it('rejects non-matching entries', () => {
      expect(collector._matchesAllowlist('chrome.exe', 443)).toBe(false);
    });

    it('ignores disabled allowlist entries', () => {
      expect(collector._matchesAllowlist('disabled_proc', 443)).toBe(false);
    });

    it('strips .exe suffix for name matching', () => {
      expect(collector._matchesAllowlist('node.exe', 1)).toBe(true);
    });
  });

  describe('scan', () => {
    it('returns normalized process objects (mocked commands)', async () => {
      // Mock execSync to return known data
      collector._deps.execSync = vi.fn((cmd) => {
        if (cmd.includes('netstat')) {
          return '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345\n';
        }
        if (cmd.includes('tasklist')) {
          return '"node.exe","12345","Console","1","45,678 K"\n';
        }
        return '';
      });
      collector._deps.platform = 'win32';

      const result = await collector.scan();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source: 'system',
        id: 'sys:3000:node',
        name: 'node',
        groupId: null,
        status: 'online',
        pid: 12345,
        ports: [3000],
        actions: ['kill'],
        hasLogs: false,
      });
    });

    it('filters out non-allowlisted processes', async () => {
      collector._deps.execSync = vi.fn((cmd) => {
        if (cmd.includes('netstat')) {
          return [
            '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345',
            '  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       4',
          ].join('\n');
        }
        if (cmd.includes('tasklist')) {
          return [
            '"node.exe","12345","Console","1","45,678 K"',
            '"System","4","Services","0","148 K"',
          ].join('\n');
        }
        return '';
      });
      collector._deps.platform = 'win32';

      const result = await collector.scan();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('node');
    });

    it('aggregates multiple ports per PID', async () => {
      collector._deps.execSync = vi.fn((cmd) => {
        if (cmd.includes('netstat')) {
          return [
            '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345',
            '  TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING       12345',
          ].join('\n');
        }
        if (cmd.includes('tasklist')) {
          return '"node.exe","12345","Console","1","45,678 K"\n';
        }
        return '';
      });
      collector._deps.platform = 'win32';

      const result = await collector.scan();
      expect(result).toHaveLength(1);
      expect(result[0].ports).toEqual([3000, 3001]);
    });

    it('returns empty array on command failure', async () => {
      collector._deps.execSync = vi.fn(() => { throw new Error('command failed'); });
      collector._deps.platform = 'win32';

      const result = await collector.scan();
      expect(result).toEqual([]);
    });
  });

  describe('executeAction', () => {
    it('kills a process using cached PID from scan', async () => {
      // scan() must run first to populate the PID cache
      collector._deps.execSync = vi.fn((cmd) => {
        if (cmd.includes('netstat')) {
          return '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345\n';
        }
        if (cmd.includes('tasklist')) {
          return '"node.exe","12345","Console","1","45,678 K"\n';
        }
        return '';
      });
      collector._deps.platform = 'win32';

      await collector.scan(); // populate pid cache
      collector._deps.execSync = vi.fn(); // reset for kill

      const result = await collector.executeAction('sys:3000:node', 'kill');
      expect(collector._deps.execSync).toHaveBeenCalledWith(
        'taskkill /PID 12345 /T /F',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it('returns error for unsupported action', async () => {
      const result = await collector.executeAction('sys:3000:node', 'restart');
      expect(result.success).toBe(false);
    });
  });

  describe('getLogs / tailLogs / stopTailing', () => {
    it('getLogs is not supported', async () => {
      await expect(collector.getLogs('sys:3000:node', 100)).rejects.toThrow('not supported');
    });

    it('tailLogs is not supported', async () => {
      await expect(collector.tailLogs('sys:3000:node', vi.fn())).rejects.toThrow('not supported');
    });

    it('stopTailing is a no-op', () => {
      expect(() => collector.stopTailing('sys:3000:node')).not.toThrow();
    });
  });
});
