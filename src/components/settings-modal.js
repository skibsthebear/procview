'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faPlus, faTrash, faToggleOn, faToggleOff } from '@fortawesome/free-solid-svg-icons';

export default function SettingsModal({ settings, onUpdateAllowlist, onUnhide, onClose }) {
  const [allowlist, setAllowlist] = useState(settings.allowlist || []);
  const [newEntry, setNewEntry] = useState({ type: 'process_name', value: '' });

  function handleAddEntry() {
    if (!newEntry.value.trim()) return;
    const updated = [...allowlist, { type: newEntry.type, value: newEntry.value.trim(), enabled: 1 }];
    setAllowlist(updated);
    setNewEntry({ type: 'process_name', value: '' });
  }

  function handleRemoveEntry(index) {
    const updated = allowlist.filter((_, i) => i !== index);
    setAllowlist(updated);
  }

  function handleSave() {
    onUpdateAllowlist(allowlist);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold text-zinc-100">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Allowlist */}
          <div>
            <h3 className="text-sm font-medium text-zinc-300 mb-3">System Process Allowlist</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Only system processes matching these names or port ranges will appear on the dashboard.
            </p>
            <div className="space-y-2">
              {allowlist.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/5">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 w-20">
                    {entry.type === 'process_name' ? 'Name' : 'Port Range'}
                  </span>
                  <span className="flex-1 text-sm text-zinc-200 font-mono">{entry.value}</span>
                  <button onClick={() => handleRemoveEntry(i)} className="p-1 text-zinc-500 hover:text-red-400 transition-colors">
                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                  </button>
                </div>
              ))}
            </div>
            {/* Add new */}
            <div className="flex items-center gap-2 mt-3">
              <select
                value={newEntry.type}
                onChange={(e) => setNewEntry({ ...newEntry, type: e.target.value })}
                className="px-2 py-1.5 bg-white/5 border border-white/10 rounded-md text-xs text-zinc-200"
              >
                <option value="process_name">Name</option>
                <option value="port_range">Port Range</option>
              </select>
              <input
                type="text"
                value={newEntry.value}
                onChange={(e) => setNewEntry({ ...newEntry, value: e.target.value })}
                placeholder={newEntry.type === 'process_name' ? 'e.g. node' : 'e.g. 3000-9999'}
                className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-md text-sm text-zinc-200 placeholder-zinc-500"
                onKeyDown={(e) => e.key === 'Enter' && handleAddEntry()}
              />
              <button onClick={handleAddEntry} className="p-1.5 rounded-md text-zinc-400 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors">
                <FontAwesomeIcon icon={faPlus} className="text-sm" />
              </button>
            </div>
          </div>

          {/* Hidden processes */}
          {settings.hidden.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Hidden Processes</h3>
              <div className="space-y-2">
                {settings.hidden.map((id) => (
                  <div key={id} className="flex items-center justify-between px-3 py-2 rounded-md bg-white/[0.03] border border-white/5">
                    <span className="text-sm text-zinc-400 font-mono">{id}</span>
                    <button
                      onClick={() => onUnhide(id)}
                      className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/10 rounded transition-colors"
                    >
                      Show
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-500/20 text-blue-400 text-sm rounded-lg hover:bg-blue-500/30 transition-colors">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
