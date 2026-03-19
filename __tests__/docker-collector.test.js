import { describe, it, expect, vi, beforeEach } from 'vitest';
import DockerCollector from '../src/lib/collectors/docker-collector';

// Mock container objects
function mockContainer(overrides = {}) {
  return {
    inspect: vi.fn(async () => ({
      Id: overrides.Id || 'abc123def456',
      Name: overrides.Name || '/my-container',
      Config: {
        Image: overrides.image || 'nginx:latest',
        Labels: overrides.labels || {},
      },
      State: {
        Status: overrides.status || 'running',
        Pid: overrides.pid || 5000,
        StartedAt: overrides.startedAt || '2026-03-19T12:00:00.000Z',
      },
      NetworkSettings: {
        Ports: overrides.ports || {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
        },
      },
    })),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    logs: vi.fn((opts, cb) => {
      const stream = { on: vi.fn(), destroy: vi.fn() };
      cb(null, stream);
    }),
    top: vi.fn(async () => ({
      Titles: ['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD'],
      Processes: [
        ['root', String(overrides.pid || 5000), '1', '0', '12:00', '?', '00:00:00', 'nginx'],
        ['nginx', String((overrides.pid || 5000) + 1), String(overrides.pid || 5000), '0', '12:00', '?', '00:00:00', 'nginx: worker'],
      ],
    })),
    modem: { demuxStream: vi.fn() },
  };
}

function mockDockerode(containers = []) {
  const containerMap = new Map();
  const listResult = containers.map((c) => {
    const container = mockContainer(c);
    containerMap.set(c.Id || 'abc123def456', container);
    return {
      Id: c.Id || 'abc123def456',
      Names: [c.Name || '/my-container'],
      State: c.listState || 'running',
      Image: c.image || 'nginx:latest',
      Labels: c.labels || {},
    };
  });

  return {
    listContainers: vi.fn(async () => listResult),
    getContainer: vi.fn((id) => containerMap.get(id) || mockContainer()),
    ping: vi.fn(async () => 'OK'),
  };
}

describe('DockerCollector', () => {
  let collector;
  let docker;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('marks as connected on successful ping', async () => {
      docker = mockDockerode([]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();
      expect(docker.ping).toHaveBeenCalledOnce();
    });

    it('throws on ping failure (Docker not running)', async () => {
      docker = mockDockerode([]);
      docker.ping.mockRejectedValueOnce(new Error('ENOENT'));
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await expect(collector.connect()).rejects.toThrow('ENOENT');
    });
  });

  describe('scan', () => {
    it('returns normalized process objects', async () => {
      docker = mockDockerode([{
        Id: 'abc123',
        Name: '/redis-server',
        status: 'running',
        listState: 'running',
        pid: 5000,
        image: 'redis:7',
        labels: {},
        ports: { '6379/tcp': [{ HostIp: '0.0.0.0', HostPort: '6379' }] },
      }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source: 'docker',
        id: 'docker:abc123',
        name: 'redis-server',
        status: 'online',
        pid: 5000,
        cpu: null,
        memory: null,
        ports: [6379],
        image: 'redis:7',
        actions: ['start', 'stop', 'restart'],
        hasLogs: true,
      });
    });

    it('normalizes Docker statuses correctly', async () => {
      const statusTests = [
        { dockerStatus: 'running', expected: 'online' },
        { dockerStatus: 'exited', expected: 'stopped' },
        { dockerStatus: 'paused', expected: 'paused' },
        { dockerStatus: 'created', expected: 'stopped' },
        { dockerStatus: 'restarting', expected: 'launching' },
        { dockerStatus: 'removing', expected: 'stopping' },
        { dockerStatus: 'dead', expected: 'errored' },
      ];

      for (const { dockerStatus, expected } of statusTests) {
        docker = mockDockerode([{
          Id: `test-${dockerStatus}`,
          status: dockerStatus,
          listState: dockerStatus,
          pid: dockerStatus === 'running' ? 100 : 0,
        }]);
        collector = new DockerCollector();
        collector._deps.Docker = vi.fn(() => docker);
        await collector.connect();
        const result = await collector.scan();
        expect(result[0].status).toBe(expected);
      }
    });

    it('extracts Compose project and service from labels', async () => {
      docker = mockDockerode([{
        Id: 'compose1',
        Name: '/myproject-web-1',
        status: 'running',
        listState: 'running',
        pid: 6000,
        labels: {
          'com.docker.compose.project': 'myproject',
          'com.docker.compose.service': 'web',
        },
      }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result[0].composeProject).toBe('myproject');
      expect(result[0].composeService).toBe('web');
      expect(result[0].groupId).toBe('myproject');
    });

    it('uses containerId as groupId for standalone containers', async () => {
      docker = mockDockerode([{
        Id: 'standalone1',
        status: 'running',
        listState: 'running',
        pid: 7000,
        labels: {},
      }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result[0].groupId).toBe('standalone1');
    });

    it('extracts multiple host ports', async () => {
      docker = mockDockerode([{
        Id: 'multiport',
        status: 'running',
        listState: 'running',
        pid: 8000,
        ports: {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
          '443/tcp': [{ HostIp: '0.0.0.0', HostPort: '8443' }],
          '9000/tcp': null, // exposed but not published
        },
      }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result[0].ports).toEqual(expect.arrayContaining([8080, 8443]));
      expect(result[0].ports).toHaveLength(2);
    });

    it('includes child PIDs via _childPids for dedup', async () => {
      docker = mockDockerode([{
        Id: 'withchildren',
        status: 'running',
        listState: 'running',
        pid: 9000,
      }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result[0]._childPids).toBeDefined();
      expect(result[0]._childPids).toContain(9001); // worker from top()
    });

    it('gracefully handles top() failure (e.g. stopped container)', async () => {
      docker = mockDockerode([{
        Id: 'stopped1',
        status: 'exited',
        listState: 'exited',
        pid: 0,
      }]);
      // Override top to fail
      docker.getContainer = vi.fn(() => {
        const c = mockContainer({ Id: 'stopped1', status: 'exited', pid: 0 });
        c.top.mockRejectedValueOnce(new Error('not running'));
        return c;
      });
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result[0]._childPids).toEqual([]);
    });

    it('strips leading / from container name', async () => {
      docker = mockDockerode([{
        Id: 'slash1',
        Name: '/my-app',
        status: 'running',
        listState: 'running',
        pid: 100,
      }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();

      const result = await collector.scan();
      expect(result[0].name).toBe('my-app');
    });
  });

  describe('executeAction', () => {
    beforeEach(async () => {
      docker = mockDockerode([{ Id: 'abc123', status: 'running', listState: 'running', pid: 100 }]);
      collector = new DockerCollector();
      collector._deps.Docker = vi.fn(() => docker);
      await collector.connect();
    });

    it('starts a container', async () => {
      const result = await collector.executeAction('docker:abc123', 'start');
      const container = docker.getContainer('abc123');
      expect(container.start).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('stops a container', async () => {
      const result = await collector.executeAction('docker:abc123', 'stop');
      const container = docker.getContainer('abc123');
      expect(container.stop).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('restarts a container', async () => {
      const result = await collector.executeAction('docker:abc123', 'restart');
      const container = docker.getContainer('abc123');
      expect(container.restart).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('returns error for unsupported action', async () => {
      const result = await collector.executeAction('docker:abc123', 'delete');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unsupported/i);
    });
  });
});
