'use client';

import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeartPulse, faGear } from '@fortawesome/free-solid-svg-icons';

const SOURCE_LABELS = {
  pm2: 'PM2',
  docker: 'Docker',
  system: 'System',
};

export default function Navbar({ connected, collectorStatus, onSettingsClick }) {
  return (
    <nav className="px-4 w-full z-50 fixed top-0 bg-black/70 backdrop-blur-md h-14 flex items-center justify-between select-none border-b border-white/5">
      <Link href="/" className="flex items-center gap-2">
        <FontAwesomeIcon icon={faHeartPulse} className="text-emerald-400 hidden sm:inline-block" />
        <span className="font-bold text-lg text-zinc-100 tracking-tight">procview</span>
      </Link>
      <div className="flex items-center gap-4">
        {/* Collector status indicators */}
        <div className="hidden sm:flex items-center gap-3">
          {Object.entries(collectorStatus || {}).map(([name, status]) => (
            <div key={name} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  status.available ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
              />
              {SOURCE_LABELS[name] || name}
            </div>
          ))}
        </div>

        {/* Settings button */}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <FontAwesomeIcon icon={faGear} className="text-sm" />
          </button>
        )}

        {/* Connection indicator */}
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <div
            className={`w-2 h-2 rounded-full ${
              connected
                ? 'bg-emerald-400 animate-status-pulse'
                : 'bg-red-400'
            }`}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
    </nav>
  );
}
