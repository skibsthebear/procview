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
} from '@fortawesome/free-solid-svg-icons';
import { toast } from 'react-toastify';

const ACTION_BUTTONS = [
  { action: 'reload', icon: faArrowsRotate, label: 'Reload', showWhen: 'online' },
  { action: 'restart', icon: faPowerOff, label: 'Restart', showWhen: 'online' },
  { action: 'stop', icon: faStop, label: 'Stop', showWhen: 'online' },
  { action: 'start', icon: faPlay, label: 'Start', showWhen: 'offline' },
];

export default function ProcessActions({ appName, status, onAction }) {
  const [loading, setLoading] = useState(null);

  const isOnline = status === 'online';

  async function handleAction(action) {
    setLoading(action);
    try {
      await onAction(appName, action);
      toast.success(`${action} ${appName}`);
    } catch (err) {
      toast.error(`${action} ${appName}: ${err.message}`);
    } finally {
      setLoading(null);
    }
  }

  const visibleActions = ACTION_BUTTONS.filter((btn) =>
    btn.showWhen === 'online' ? isOnline : !isOnline
  );

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {visibleActions.map(({ action, icon, label }) => (
        <button
          key={action}
          onClick={() => handleAction(action)}
          disabled={loading !== null}
          title={label}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 disabled:opacity-30 transition-colors"
        >
          <FontAwesomeIcon
            icon={icon}
            className={`text-xs ${loading === action ? 'animate-spin' : ''}`}
          />
        </button>
      ))}

      {/* Delete with confirmation */}
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
                Delete <strong className="text-zinc-200">{appName}</strong>?
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
    </div>
  );
}
