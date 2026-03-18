'use client';

import { useState, useMemo } from 'react';
import Navbar from './navbar';
import FilterBar from './filter-bar';
import ProcessCard from './process-card';
import { usePM2 } from '@/hooks/use-pm2';

export default function Dashboard() {
  const { processes, connected, executeAction } = usePM2();
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState(['online', 'stopped', 'errored']);

  const groups = useMemo(() => {
    const map = new Map();
    for (const proc of processes) {
      if (!map.has(proc.name)) map.set(proc.name, []);
      map.get(proc.name).push(proc);
    }
    return map;
  }, [processes]);

  const counts = useMemo(() => {
    const c = { online: 0, stopped: 0, errored: 0 };
    for (const [, instances] of groups) {
      const hasOnline = instances.some((p) => p.status === 'online');
      const hasErrored = instances.some((p) => p.status === 'errored');
      const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';
      c[groupStatus] = (c[groupStatus] || 0) + 1;
    }
    return c;
  }, [groups]);

  const filtered = useMemo(() => {
    const entries = [];
    for (const [name, instances] of groups) {
      if (search && !name.toLowerCase().includes(search.toLowerCase())) continue;
      const hasOnline = instances.some((p) => p.status === 'online');
      const hasErrored = instances.some((p) => p.status === 'errored');
      const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';
      if (!statusFilters.includes(groupStatus)) continue;
      entries.push({ name, instances });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, search, statusFilters]);

  function handleStatusToggle(key) {
    setStatusFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar connected={connected} />
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilters={statusFilters}
          onStatusToggle={handleStatusToggle}
          counts={counts}
        />

        {processes.length === 0 && connected ? (
          <div className="mt-16 text-center">
            <p className="text-zinc-500 text-lg mb-2">No PM2 processes running</p>
            <p className="text-zinc-600 text-sm">
              Start a process with: <code className="px-2 py-1 bg-white/5 rounded text-zinc-400">pm2 start app.js --name my-app</code>
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(({ name, instances }) => (
              <ProcessCard
                key={name}
                name={name}
                instances={instances}
                onAction={executeAction}
              />
            ))}
          </div>
        )}

        {!connected && (
          <div className="mt-16 text-center">
            <p className="text-zinc-500 text-lg">Connecting to server...</p>
          </div>
        )}
      </main>
    </div>
  );
}
