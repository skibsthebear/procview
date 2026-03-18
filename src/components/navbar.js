'use client';

import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeartPulse } from '@fortawesome/free-solid-svg-icons';

export default function Navbar({ connected }) {
  return (
    <nav className="px-4 w-full z-50 fixed top-0 bg-black/70 backdrop-blur-md h-14 flex items-center justify-between select-none border-b border-white/5">
      <Link href="/" className="flex items-center gap-2">
        <FontAwesomeIcon icon={faHeartPulse} className="text-emerald-400 hidden sm:inline-block" />
        <span className="font-bold text-lg text-zinc-100 tracking-tight">PM2</span>
      </Link>
      <div className="flex items-center gap-3">
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
