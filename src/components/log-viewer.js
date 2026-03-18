'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import Convert from 'ansi-to-html';
import { useLogs } from '@/hooks/use-logs';
import Navbar from './navbar';

const convert = new Convert({ fg: '#d4d4d8', bg: 'transparent' });

function LogPanel({ title, lines, pinned, onTogglePin }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (pinned && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, pinned]);

  return (
    <div className="flex-1 flex flex-col min-h-0 glass-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</span>
        <button
          onClick={onTogglePin}
          className={`p-1 rounded text-xs transition-colors ${
            pinned ? 'text-blue-400 bg-blue-400/10' : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={pinned ? 'Unpin from bottom' : 'Pin to bottom'}
        >
          <FontAwesomeIcon icon={faThumbtack} />
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed log-scroll"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-600 italic">No log output yet</p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className="hover:bg-white/[0.02] px-1 -mx-1 rounded"
              dangerouslySetInnerHTML={{ __html: convert.toHtml(line) }}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function LogViewer({ appName }) {
  const { outLines, errLines, connected } = useLogs(appName);
  const [pinnedOut, setPinnedOut] = useState(true);
  const [pinnedErr, setPinnedErr] = useState(true);
  const [view, setView] = useState('split');

  const decodedName = decodeURIComponent(appName);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar connected={connected} />
      <main className="flex-1 flex flex-col pt-16 pb-4 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
              <FontAwesomeIcon icon={faArrowLeft} />
            </Link>
            <h1 className="text-lg font-semibold text-zinc-100">{decodedName}</h1>
          </div>
          <div className="flex gap-1">
            {['split', 'stdout', 'stderr'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  view === v
                    ? 'bg-white/10 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
              >
                {v === 'split' ? 'Split' : v === 'stdout' ? 'Stdout' : 'Stderr'}
              </button>
            ))}
          </div>
        </div>

        <div className={`flex-1 flex gap-4 min-h-0 ${
          view === 'split' ? 'flex-col lg:flex-row' : ''
        }`} style={{ height: 'calc(100vh - 10rem)' }}>
          {(view === 'split' || view === 'stdout') && (
            <LogPanel
              title="stdout"
              lines={outLines}
              pinned={pinnedOut}
              onTogglePin={() => setPinnedOut(!pinnedOut)}
            />
          )}
          {(view === 'split' || view === 'stderr') && (
            <LogPanel
              title="stderr"
              lines={errLines}
              pinned={pinnedErr}
              onTogglePin={() => setPinnedErr(!pinnedErr)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
