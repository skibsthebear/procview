'use client';

import { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

const FUNNEL_PORTS = [443, 8443, 10000];

export default function TailscaleModal({ tsHostname, tsProcesses, onAdd, onClose }) {
  const [type, setType] = useState('serve');
  const [localPort, setLocalPort] = useState('');
  const [funnelPort, setFunnelPort] = useState(443);
  const [path, setPath] = useState('/');
  const [loading, setLoading] = useState(false);

  // Calculate used funnel ports
  const usedFunnelPorts = useMemo(() => {
    const used = new Set();
    for (const proc of tsProcesses) {
      if (proc.tsType === 'funnel') {
        used.add(proc.tsExternalPort);
      }
    }
    return used;
  }, [tsProcesses]);

  const availableFunnelPorts = FUNNEL_PORTS.filter(p => !usedFunnelPorts.has(p));
  const funnelSlotsUsed = usedFunnelPorts.size;

  // Auto-select first available funnel port
  const effectiveFunnelPort = availableFunnelPorts.includes(funnelPort)
    ? funnelPort
    : availableFunnelPorts[0] || 443;

  // Validation
  const portNum = parseInt(localPort, 10);
  const validPort = !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
  const validPath = path.startsWith('/');

  // Check for duplicate rule ID
  const ruleId = type === 'serve'
    ? `ts:https:443:${path}`
    : `ts:https:${effectiveFunnelPort}:${path}`;
  const isDuplicate = tsProcesses.some(p => p.id === ruleId);

  const canSubmit = validPort && validPath && !isDuplicate && !loading
    && (type === 'serve' || availableFunnelPorts.length > 0);

  // URL preview
  const previewUrl = type === 'serve'
    ? `https://${tsHostname || '<hostname>'}${path}`
    : `https://${tsHostname || '<hostname>'}:${effectiveFunnelPort}${path}`;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      if (type === 'serve') {
        await onAdd('serve', { localPort: portNum });
      } else {
        await onAdd('funnel', {
          localPort: portNum,
          funnelPort: effectiveFunnelPort,
          path: path || '/',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold text-zinc-100">Add Tailscale Rule</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Info box */}
          <div className="px-3 py-2 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
            Tailscale Serve exposes a local port to devices on your tailnet (private). Funnel makes it publicly accessible from the internet.
          </div>

          {/* Type radio */}
          <div>
            <label className="text-xs text-zinc-400 block mb-2">Type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ts-type"
                  checked={type === 'serve'}
                  onChange={() => setType('serve')}
                  className="accent-teal-400"
                />
                <span className="text-sm text-zinc-200">Serve</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ts-type"
                  checked={type === 'funnel'}
                  onChange={() => setType('funnel')}
                  className="accent-teal-400"
                />
                <span className="text-sm text-zinc-200">Funnel</span>
              </label>
            </div>
          </div>

          {/* Local port */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Local port</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder="3000"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-colors"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              The port of the service running on this machine. e.g. a Next.js app on port 3000
            </p>
            {localPort && !validPort && (
              <p className="text-[10px] text-red-400 mt-1">Port must be between 1 and 65535</p>
            )}
          </div>

          {/* Funnel-specific options */}
          {type === 'funnel' && (
            <>
              {/* Funnel port */}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Funnel port</label>
                <select
                  value={effectiveFunnelPort}
                  onChange={(e) => setFunnelPort(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-teal-500/50 transition-colors"
                >
                  {FUNNEL_PORTS.map(p => (
                    <option key={p} value={p} disabled={usedFunnelPorts.has(p)}>
                      {p}{usedFunnelPorts.has(p) ? ' (in use)' : ''}
                    </option>
                  ))}
                </select>
                <div className="px-3 py-2 mt-2 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[11px]">
                  Funnel is limited to ports 443, 8443, or 10000. Only 3 funnels max per machine.
                  Slots used: {funnelSlotsUsed}/3
                </div>
              </div>

              {/* Path prefix */}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Path prefix <span className="text-zinc-600">(optional)</span></label>
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value || '/')}
                  placeholder="/"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 font-mono focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-colors"
                />
                <p className="text-[10px] text-zinc-500 mt-1">
                  Use path prefixes to share a funnel port across multiple services. e.g. /api, /dashboard
                </p>
                {!validPath && (
                  <p className="text-[10px] text-red-400 mt-1">Path must start with /</p>
                )}
              </div>
            </>
          )}

          {/* Rule ID preview */}
          {validPort && (
            <div className="text-[10px] text-zinc-500">
              Rule ID: <span className="font-mono text-zinc-400">{ruleId}</span>
              {isDuplicate && (
                <span className="text-red-400 ml-2">— already exists</span>
              )}
            </div>
          )}

          {/* URL preview */}
          {validPort && tsHostname && (
            <div className={`px-3 py-2 rounded border text-xs ${
              type === 'funnel'
                ? 'bg-orange-500/10 border-orange-500/20'
                : 'bg-teal-500/10 border-teal-500/20'
            }`}>
              <p className="text-zinc-400 mb-1">
                Your service will be {type === 'funnel' ? 'publicly' : ''} accessible at:
              </p>
              <p className={`font-mono font-medium ${type === 'funnel' ? 'text-orange-400' : 'text-teal-400'}`}>
                {previewUrl}
              </p>
              {type === 'serve' && (
                <p className="text-zinc-500 mt-1">Only devices on your tailnet can access it.</p>
              )}
              {type === 'funnel' && (
                <p className="text-orange-400/70 mt-1">Anyone on the internet can reach this URL.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 bg-teal-500/20 text-teal-400 text-sm rounded-lg hover:bg-teal-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Adding...' : 'Add Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}
