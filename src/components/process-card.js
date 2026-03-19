'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTerminal, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
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
      <ProcessActions appName={proc.name} status={proc.status} onAction={onAction} />
    </div>
  );
}

export default function ProcessCard({ name, instances, onAction }) {
  const [expanded, setExpanded] = useState(instances.length <= 1);
  const isCluster = instances.length > 1;

  const hasOnline = instances.some((p) => p.status === 'online');
  const hasErrored = instances.some((p) => p.status === 'errored');
  const groupStatus = hasOnline ? 'online' : hasErrored ? 'errored' : 'stopped';

  const totalCpu = instances.reduce((sum, p) => sum + p.cpu, 0);
  const totalMemory = instances.reduce((sum, p) => sum + p.memory, 0);

  const port = instances[0]?.port ?? null;
  const serviceUrl = port ? `http://localhost:${port}` : null;

  function handleCardClick() {
    if (serviceUrl) window.open(serviceUrl, '_blank', 'noopener,noreferrer');
  }

  function handleCardKeyDown(e) {
    if (e.key === 'Enter' && serviceUrl) window.open(serviceUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className={`glass-card p-4 flex flex-col gap-3 transition-all duration-200 ${serviceUrl ? 'cursor-pointer hover:border-white/20 hover:bg-white/[0.04]' : ''}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={serviceUrl ? 'link' : undefined}
      tabIndex={serviceUrl ? 0 : undefined}
      aria-label={serviceUrl ? `Open ${name} at ${serviceUrl}` : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={groupStatus} />
          <h3 className="font-semibold text-zinc-100 text-sm">{name}</h3>
          {port ? (
            <button
              onClick={(e) => { e.stopPropagation(); window.open(serviceUrl, '_blank', 'noopener,noreferrer'); }}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
              title={`Open ${serviceUrl}`}
            >
              :{port}
            </button>
          ) : (
            <span className="text-[10px] text-zinc-600">No port</span>
          )}
          {isCluster && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              x{instances.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/logs/${encodeURIComponent(name)}`}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            title="View Logs"
            onClick={(e) => e.stopPropagation()}
          >
            <FontAwesomeIcon icon={faTerminal} className="text-xs" />
          </Link>
          {!isCluster && (
            <ProcessActions appName={name} status={instances[0].status} onAction={onAction} />
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
          <Metric label="CPU" value={instances[0].cpu} unit="%" colorClass={getCpuColor(instances[0].cpu)} />
          <Metric label="MEM" value={instances[0].memory} unit="MB" colorClass={getMemoryColor(instances[0].memory)} />
          <Metric label="Uptime" value={instances[0].uptime} />
          <Metric label="PID" value={instances[0].pid || '—'} />
        </div>
      )}

      {isCluster && !expanded && (
        <div className="flex gap-4 px-1">
          <Metric label="Total CPU" value={Math.round(totalCpu)} unit="%" colorClass={getCpuColor(totalCpu / instances.length)} />
          <Metric label="Total MEM" value={Math.round(totalMemory * 100) / 100} unit="MB" colorClass={getMemoryColor(totalMemory / instances.length)} />
        </div>
      )}

      {isCluster && expanded && (
        <div className="flex flex-col gap-1.5">
          {instances.map((proc, i) => (
            <InstanceRow key={proc.instanceId ?? i} proc={proc} onAction={onAction} />
          ))}
          <div className="pt-1">
            <ProcessActions appName={name} status={groupStatus} onAction={onAction} />
          </div>
        </div>
      )}
    </div>
  );
}
