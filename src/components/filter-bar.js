'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

const STATUS_FILTERS = [
  { key: 'online', label: 'Online', activeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { key: 'stopped', label: 'Stopped', activeClass: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
  { key: 'errored', label: 'Errored', activeClass: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

export default function FilterBar({ search, onSearchChange, statusFilters, onStatusToggle, counts }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <FontAwesomeIcon
          icon={faMagnifyingGlass}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm"
        />
        <input
          type="text"
          placeholder="Filter processes..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-colors"
        />
      </div>

      {/* Status toggles */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map(({ key, label, activeClass }) => {
          const active = statusFilters.includes(key);
          const count = counts[key] || 0;
          return (
            <button
              key={key}
              onClick={() => onStatusToggle(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                active
                  ? activeClass
                  : 'bg-white/5 text-zinc-500 border-white/5 hover:bg-white/10'
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>
    </div>
  );
}
