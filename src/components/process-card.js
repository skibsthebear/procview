'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Popover } from '@headlessui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDocker } from '@fortawesome/free-brands-svg-icons';
import { faTerminal, faChevronDown, faChevronUp, faServer, faCubes, faEllipsisVertical, faNetworkWired } from '@fortawesome/free-solid-svg-icons';
import StatusBadge from './status-badge';
import ProcessActions from './process-actions';

function getMemoryColor(mb) {
  if (mb < 50) return 'text-emerald-400';
  if (mb < 100) return 'text-yellow-400';
  if (mb < 250) return 'text-orange-400';
  return 'text-red-400';
}

function getCpuColor(pct) {
  if (pct < 30) return 'text-emerald-400';
  if (pct < 60) return 'text-yellow-400';
  if (pct < 85) return 'text-orange-400';
  return 'text-red-400';
}

function Metric({ label, value, unit, colorClass }) {
  if (value == null) return null;
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums transition-colors duration-500 ${colorClass || 'text-zinc-200'}`}>
        {value}
        {unit && <span className="text-[10px] text-zinc-500 ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

const SOURCE_ICON = {
  pm2: faCubes,
  docker: faDocker,
  system: faServer,
  tailscale: faNetworkWired,
};

function SourceBadge({ source }) {
  const icon = SOURCE_ICON[source];
  const colors = {
    pm2: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    docker: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    system: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    tailscale: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[source] || colors.system}`}>
      {icon && <FontAwesomeIcon icon={icon} className="text-[8px]" />}
      {source}
    </span>
  );
}

function InstanceRow({ proc, onAction }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md bg-white/[0.02] border border-white/[0.03]">
      <div className="flex items-center gap-3">
        <StatusBadge status={proc.status} />
        <div className="flex gap-4">
          <Metric label="CPU" value={proc.cpu} unit="%" colorClass={getCpuColor(proc.cpu)} />
          <Metric label="MEM" value={proc.memory} unit="MB" colorClass={getMemoryColor(proc.memory)} />
          <Metric label="Uptime" value={proc.uptime} />
          <Metric label="PID" value={proc.pid || '—'} />
        </div>
      </div>
      <ProcessActions
        source={proc.source}
        processId={proc.id}
        name={proc.name}
        status={proc.status}
        actions={proc.actions}
        onAction={onAction}
      />
    </div>
  );
}

export default function ProcessCard({ displayName, processes, onAction, onHide, onRename, onNote }) {
  const [expanded, setExpanded] = useState(processes.length <= 1);
  const [menuOpen, setMenuOpen] = useState(false);
  const isCluster = processes.length > 1;
  const primary = processes[0];
  const source = primary.source;

  const hasOnline = processes.some((p) => p.status === 'online');
  const hasErrored = processes.some((p) => p.status === 'errored');
  const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';

  const totalCpu = processes.reduce((sum, p) => sum + (p.cpu || 0), 0);
  const totalMemory = processes.reduce((sum, p) => sum + (p.memory || 0), 0);
  const hasCpu = processes.some((p) => p.cpu != null);
  const hasMemory = processes.some((p) => p.memory != null);

  // Collect all unique ports across instances
  const allPorts = [...new Set(processes.flatMap((p) => p.ports || []))];
  const serviceUrl = allPorts.length > 0 ? `http://localhost:${allPorts[0]}` : null;

  function handleCardClick() {
    if (serviceUrl) window.open(serviceUrl, '_blank', 'noopener,noreferrer');
  }

  function handleCardKeyDown(e) {
    if (e.key === 'Enter' && serviceUrl) window.open(serviceUrl, '_blank', 'noopener,noreferrer');
  }

  // Log link — only for sources with logs
  const logSource = primary.source;
  const logId = primary.id;
  const logsAvailable = primary.hasLogs;

  return (
    <div
      className={`glass-card p-4 flex flex-col gap-3 transition-all duration-200 ${menuOpen ? 'z-20 relative' : ''} ${serviceUrl ? 'cursor-pointer hover:border-white/20 hover:bg-white/[0.04]' : ''}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={serviceUrl ? 'link' : undefined}
      tabIndex={serviceUrl ? 0 : undefined}
      aria-label={serviceUrl ? `Open ${displayName} at ${serviceUrl}` : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap overflow-hidden">
          <StatusBadge status={groupStatus} />
          <h3 className="font-semibold text-zinc-100 text-sm truncate min-w-0 max-w-[40%]">{displayName}</h3>
          <SourceBadge source={source} />
          {allPorts.map((p) => (
            <button
              key={p}
              onClick={(e) => { e.stopPropagation(); window.open(`http://localhost:${p}`, '_blank', 'noopener,noreferrer'); }}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
              title={`Open http://localhost:${p}`}
            >
              :{p}
            </button>
          ))}
          {allPorts.length === 0 && (
            <span className="text-[10px] text-zinc-600">No port</span>
          )}
          {isCluster && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              x{processes.length}
            </span>
          )}
          {/* Docker image name */}
          {primary.image && (
            <span className="text-[10px] text-zinc-500 truncate min-w-0" title={primary.image}>
              {primary.image}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Context menu */}
          <Popover className="relative">
            {({ open }) => {
              if (open !== menuOpen) setTimeout(() => setMenuOpen(open), 0);
              return (<>
            <Popover.Button
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} className="text-xs" />
            </Popover.Button>
            <Popover.Panel className="absolute right-0 z-10 mt-1 glass-card p-2 w-40">
              {({ close }) => (
                <div className="space-y-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const name = prompt('Rename to:', displayName);
                      if (name) onRename(primary.id, name);
                      close();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 rounded transition-colors"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const note = prompt('Add note:', '');
                      if (note != null) onNote(primary.id, note);
                      close();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 rounded transition-colors"
                  >
                    Add Note
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onHide(primary.id);
                      close();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:text-red-400 hover:bg-red-400/5 rounded transition-colors"
                  >
                    Hide
                  </button>
                </div>
              )}
            </Popover.Panel>
              </>);
            }}
          </Popover>
          {logsAvailable && (
            <Link
              href={`/logs/${encodeURIComponent(logSource)}/${encodeURIComponent(logId)}`}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
              title="View Logs"
              onClick={(e) => e.stopPropagation()}
            >
              <FontAwesomeIcon icon={faTerminal} className="text-xs" />
            </Link>
          )}
          {!isCluster && (
            <ProcessActions
              source={source}
              processId={primary.id}
              name={displayName}
              status={primary.status}
              actions={primary.actions}
              onAction={onAction}
            />
          )}
          {isCluster && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
              <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} className="text-xs" />
            </button>
          )}
        </div>
      </div>

      {!isCluster && (
        <div className="flex gap-4 px-1">
          <Metric label="CPU" value={primary.cpu} unit="%" colorClass={getCpuColor(primary.cpu)} />
          <Metric label="MEM" value={primary.memory} unit="MB" colorClass={getMemoryColor(primary.memory)} />
          <Metric label="Uptime" value={primary.uptime} />
          <Metric label="PID" value={primary.pid || '—'} />
        </div>
      )}

      {isCluster && !expanded && (
        <div className="flex gap-4 px-1">
          {hasCpu && <Metric label="Total CPU" value={Math.round(totalCpu)} unit="%" colorClass={getCpuColor(totalCpu / processes.length)} />}
          {hasMemory && <Metric label="Total MEM" value={Math.round(totalMemory * 100) / 100} unit="MB" colorClass={getMemoryColor(totalMemory / processes.length)} />}
        </div>
      )}

      {isCluster && expanded && (
        <div className="flex flex-col gap-1.5">
          {processes.map((proc, i) => (
            <InstanceRow key={proc.id || i} proc={proc} onAction={onAction} />
          ))}
          <div className="pt-1">
            <ProcessActions
              source={source}
              processId={primary.id}
              name={displayName}
              status={groupStatus}
              actions={primary.actions}
              onAction={onAction}
            />
          </div>
        </div>
      )}
    </div>
  );
}
