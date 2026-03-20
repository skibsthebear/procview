'use client';

import { useState, useMemo } from 'react';
import Navbar from './navbar';
import FilterBar from './filter-bar';
import ProcessCard from './process-card';
import { useProcesses } from '@/hooks/use-processes';
import { useSettings } from '@/hooks/use-settings';
import SettingsModal from './settings-modal';
import TailscaleModal from './tailscale-modal';
import { toast } from 'react-toastify';

const SOURCE_ORDER = ['pm2', 'docker', 'system', 'tailscale'];
const STATUS_FILTERS = ['online', 'stopped', 'errored'];
const SOURCE_FILTERS = ['pm2', 'docker', 'system', 'tailscale'];

export default function Dashboard() {
  const { processes, collectorStatus, connected, connectionState, retryNow, executeAction, sendMessage, registerMessageHandler } = useProcesses();
  const {
    settings, isHidden, getDisplayName,
    hideProcess, unhideProcess, setCustomName, setNote, updateAllowlist,
  } = useSettings(sendMessage, registerMessageHandler);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState(['online', 'stopped', 'errored']);
  const [sourceFilters, setSourceFilters] = useState(['pm2', 'docker', 'system', 'tailscale']);
  const [showSettings, setShowSettings] = useState(false);
  const [showTailscaleModal, setShowTailscaleModal] = useState(false);

  const tailscaleAvailable = collectorStatus?.tailscale?.available === true;
  const tsHostname = collectorStatus?.tailscale?.metadata?.hostname || '';
  const tsProcesses = useMemo(
    () => processes.filter(p => p.source === 'tailscale'),
    [processes]
  );

  async function handleAddTailscaleRule(type, params) {
    const action = type === 'serve' ? 'add-serve' : 'add-funnel';
    try {
      await executeAction('tailscale', '__new__', action, params);
      toast.success(`Added Tailscale ${type} rule`);
      setShowTailscaleModal(false);
    } catch (err) {
      toast.error(`Failed to add ${type}: ${err.message}`);
    }
  }

  // Filter out hidden, then group by (source, groupId)
  const visibleProcesses = useMemo(() => {
    return processes.filter((p) => !isHidden(p.id));
  }, [processes, isHidden]);

  // Groups: Map<string, { key, source, groupId, displayName, processes[] }>
  const groups = useMemo(() => {
    const map = new Map();
    for (const proc of visibleProcesses) {
      const key = `${proc.source}:${proc.groupId || proc.id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          source: proc.source,
          groupId: proc.groupId,
          displayName: getDisplayName(proc),
          processes: [],
        });
      }
      map.get(key).processes.push(proc);
    }
    return map;
  }, [visibleProcesses, getDisplayName]);

  // Status counts (for filter bar)
  const counts = useMemo(() => {
    const c = { online: 0, stopped: 0, errored: 0 };
    for (const [, group] of groups) {
      const hasOnline = group.processes.some((p) => p.status === 'online');
      const hasErrored = group.processes.some((p) => p.status === 'errored');
      const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';
      c[groupStatus] = (c[groupStatus] || 0) + 1;
    }
    return c;
  }, [groups]);

  // Source counts (for filter bar)
  const sourceCounts = useMemo(() => {
    const c = { pm2: 0, docker: 0, system: 0, tailscale: 0 };
    for (const [, group] of groups) {
      c[group.source] = (c[group.source] || 0) + 1;
    }
    return c;
  }, [groups]);

  // Filter by search, status, source
  const filtered = useMemo(() => {
    const entries = [];
    for (const [, group] of groups) {
      if (!sourceFilters.includes(group.source)) continue;
      if (search && !group.displayName.toLowerCase().includes(search.toLowerCase())) continue;
      const hasOnline = group.processes.some((p) => p.status === 'online');
      const hasErrored = group.processes.some((p) => p.status === 'errored');
      const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';
      if (!statusFilters.includes(groupStatus)) continue;
      entries.push(group);
    }
    // Sort: by source order, then by name
    return entries.sort((a, b) => {
      const sa = SOURCE_ORDER.indexOf(a.source);
      const sb = SOURCE_ORDER.indexOf(b.source);
      if (sa !== sb) return sa - sb;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [groups, search, statusFilters, sourceFilters]);

  function handleStatusToggle(key) {
    setStatusFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleSourceToggle(key) {
    setSourceFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleStatusSelectOnly(key) {
    setStatusFilters([key]);
  }

  function handleSourceSelectOnly(key) {
    setSourceFilters([key]);
  }

  function handleStatusSelectAll() {
    setStatusFilters([...STATUS_FILTERS]);
  }

  function handleSourceSelectAll() {
    setSourceFilters([...SOURCE_FILTERS]);
  }

  return (
    <div className="min-h-screen">
      <Navbar
        connected={connected}
        collectorStatus={collectorStatus}
        onSettingsClick={() => setShowSettings(true)}
      />
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilters={statusFilters}
          onStatusToggle={handleStatusToggle}
          onStatusSelectOnly={handleStatusSelectOnly}
          onStatusSelectAll={handleStatusSelectAll}
          counts={counts}
          sourceFilters={sourceFilters}
          onSourceToggle={handleSourceToggle}
          onSourceSelectOnly={handleSourceSelectOnly}
          onSourceSelectAll={handleSourceSelectAll}
          sourceCounts={sourceCounts}
          tailscaleAvailable={tailscaleAvailable}
          onAddTailscaleRule={() => setShowTailscaleModal(true)}
        />

        {visibleProcesses.length === 0 && connected ? (
          <div className="mt-16 text-center">
            <p className="text-zinc-500 text-lg mb-2">No processes found</p>
            <p className="text-zinc-600 text-sm">
              Start a process with PM2, Docker, or run a dev server
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((group) => (
              <ProcessCard
                key={group.key}
                displayName={group.displayName}
                processes={group.processes}
                onAction={executeAction}
                onHide={(processId) => hideProcess(processId)}
                onRename={(processId, name) => setCustomName(processId, name)}
                onNote={(processId, note) => setNote(processId, note)}
              />
            ))}
          </div>
        )}

        {!connected && (
          <div className="mt-16 text-center">
            {connectionState === 'failed' ? (
              <>
                <p className="text-zinc-400 text-lg mb-2">Could not connect to server</p>
                <p className="text-zinc-600 text-sm mb-4">
                  Is the Procview server running on this machine?
                </p>
                <button
                  onClick={retryNow}
                  className="px-4 py-2 bg-white/5 text-zinc-300 text-sm rounded-lg hover:bg-white/10 transition-colors"
                >
                  Retry connection
                </button>
              </>
            ) : (
              <>
                <div className="inline-block w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin mb-3" />
                <p className="text-zinc-500 text-lg">
                  {connectionState === 'reconnecting'
                    ? 'Connection lost. Reconnecting...'
                    : 'Connecting to server...'}
                </p>
              </>
            )}
          </div>
        )}
        {showSettings && (
          <SettingsModal
            settings={settings}
            onUpdateAllowlist={updateAllowlist}
            onUnhide={unhideProcess}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showTailscaleModal && (
          <TailscaleModal
            tsHostname={tsHostname}
            tsProcesses={tsProcesses}
            onAdd={handleAddTailscaleRule}
            onClose={() => setShowTailscaleModal(false)}
          />
        )}
      </main>
    </div>
  );
}
