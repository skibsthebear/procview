'use client';

import { useState } from 'react';
import { Popover } from '@headlessui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlay,
  faStop,
  faArrowsRotate,
  faPowerOff,
  faTrash,
  faSkull,
} from '@fortawesome/free-solid-svg-icons';
import { toast } from 'react-toastify';

const ACTION_CONFIG = {
  reload:  { icon: faArrowsRotate, label: 'Reload',  showWhen: 'online' },
  restart: { icon: faPowerOff,     label: 'Restart', showWhen: 'online' },
  stop:    { icon: faStop,         label: 'Stop',    showWhen: 'online' },
  start:   { icon: faPlay,         label: 'Start',   showWhen: 'offline' },
  kill:    { icon: faSkull,        label: 'Kill',    showWhen: 'online', dangerous: true },
};

// Actions that need confirmation before executing
const CONFIRM_ACTIONS = new Set(['delete', 'kill']);

export default function ProcessActions({ source, processId, name, status, actions, onAction }) {
  const [loading, setLoading] = useState(null);

  const isOnline = status === 'online' || status === 'launching';

  async function handleAction(action) {
    setLoading(action);
    try {
      await onAction(source, processId, action);
      toast.success(`${action} ${name}`);
    } catch (err) {
      toast.error(`${action} ${name}: ${err.message}`);
    } finally {
      setLoading(null);
    }
  }

  // Filter actions to show based on status
  const visibleActions = (actions || [])
    .filter((action) => {
      if (action === 'delete') return true; // always show delete (PM2)
      const config = ACTION_CONFIG[action];
      if (!config) return false;
      return config.showWhen === 'online' ? isOnline : !isOnline;
    })
    .filter((action) => action !== 'delete'); // handled separately

  const hasDelete = (actions || []).includes('delete');

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {visibleActions.map((action) => {
        const config = ACTION_CONFIG[action];
        if (!config) return null;

        if (CONFIRM_ACTIONS.has(action)) {
          return (
            <Popover key={action} className="relative">
              <Popover.Button
                className={`p-1.5 rounded-md transition-colors ${
                  config.dangerous
                    ? 'text-zinc-500 hover:text-red-400 hover:bg-red-400/10'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                }`}
                title={config.label}
              >
                <FontAwesomeIcon icon={config.icon} className="text-xs" />
              </Popover.Button>
              <Popover.Panel className="absolute right-0 z-10 mt-1 glass-card p-3 w-48">
                {({ close }) => (
                  <div>
                    <p className="text-xs text-zinc-400 mb-2">
                      {config.label} <strong className="text-zinc-200">{name}</strong>?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { handleAction(action); close(); }}
                        className="flex-1 px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-md hover:bg-red-500/30 transition-colors"
                      >
                        {config.label}
                      </button>
                      <button
                        onClick={close}
                        className="flex-1 px-2 py-1 bg-white/5 text-zinc-400 text-xs rounded-md hover:bg-white/10 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Popover.Panel>
            </Popover>
          );
        }

        return (
          <button
            key={action}
            onClick={() => handleAction(action)}
            disabled={loading !== null}
            title={config.label}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <FontAwesomeIcon
              icon={config.icon}
              className={`text-xs ${loading === action ? 'animate-spin' : ''}`}
            />
          </button>
        );
      })}

      {/* Delete with confirmation (PM2 only) */}
      {hasDelete && (
        <Popover className="relative">
          <Popover.Button
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Delete"
          >
            <FontAwesomeIcon icon={faTrash} className="text-xs" />
          </Popover.Button>
          <Popover.Panel className="absolute right-0 z-10 mt-1 glass-card p-3 w-48">
            {({ close }) => (
              <div>
                <p className="text-xs text-zinc-400 mb-2">
                  Delete <strong className="text-zinc-200">{name}</strong>?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { handleAction('delete'); close(); }}
                    className="flex-1 px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-md hover:bg-red-500/30 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={close}
                    className="flex-1 px-2 py-1 bg-white/5 text-zinc-400 text-xs rounded-md hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Popover.Panel>
        </Popover>
      )}
    </div>
  );
}
