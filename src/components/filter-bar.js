'use client';

import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

const STATUS_FILTERS = [
  { key: 'online', label: 'Online', activeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { key: 'stopped', label: 'Stopped', activeClass: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
  { key: 'errored', label: 'Errored', activeClass: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

const SOURCE_FILTERS = [
  { key: 'pm2', label: 'PM2', activeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { key: 'docker', label: 'Docker', activeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { key: 'system', label: 'System', activeClass: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
  { key: 'tailscale', label: 'Tailscale', activeClass: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
];

export default function FilterBar({
  search, onSearchChange,
  statusFilters, onStatusToggle, onStatusSelectOnly, onStatusSelectAll, counts,
  sourceFilters, onSourceToggle, onSourceSelectOnly, onSourceSelectAll, sourceCounts,
  tailscaleAvailable, onAddTailscaleRule,
}) {
  // Context menu state: { key, type: 'status'|'source', x, y } or null
  const [ctxMenu, setCtxMenu] = useState(null);

  const closeMenu = useCallback(() => setCtxMenu(null), []);

  // Close on Escape key
  useEffect(() => {
    if (!ctxMenu) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeMenu();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ctxMenu, closeMenu]);

  function handleContextMenu(e, key, type) {
    e.preventDefault();
    setCtxMenu({ key, type, x: e.clientX, y: e.clientY });
  }

  function handleSelectOnly() {
    if (!ctxMenu) return;
    if (ctxMenu.type === 'status') onStatusSelectOnly(ctxMenu.key);
    else onSourceSelectOnly(ctxMenu.key);
    closeMenu();
  }

  function handleSelectAll() {
    if (!ctxMenu) return;
    if (ctxMenu.type === 'status') onStatusSelectAll();
    else onSourceSelectAll();
    closeMenu();
  }

  return (
    <div className="flex flex-col gap-3">
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
                onContextMenu={(e) => handleContextMenu(e, key, 'status')}
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

        {/* Source toggles */}
        <div className="flex gap-2">
          {SOURCE_FILTERS.map(({ key, label, activeClass }) => {
            const active = sourceFilters.includes(key);
            const count = sourceCounts?.[key] || 0;
            if (count === 0 && !active) return null; // hide empty sources
            return (
              <button
                key={key}
                onClick={() => onSourceToggle(key)}
                onContextMenu={(e) => handleContextMenu(e, key, 'source')}
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
          {tailscaleAvailable && onAddTailscaleRule && (
            <button
              onClick={onAddTailscaleRule}
              className="px-2 py-1.5 rounded-lg text-[10px] font-medium border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors"
              title="Add Tailscale Serve/Funnel rule"
            >
              + TS
            </button>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <>
          {/* Backdrop to catch outside clicks */}
          <div className="fixed inset-0 z-50" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div
            className="fixed z-50 glass-card py-1 min-w-[120px] shadow-xl"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              onClick={handleSelectOnly}
              className="w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10 transition-colors"
            >
              Select only
            </button>
            <button
              onClick={handleSelectAll}
              className="w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10 transition-colors"
            >
              Select all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
