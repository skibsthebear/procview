'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDocker } from '@fortawesome/free-brands-svg-icons';
import { faCubes, faServer, faNetworkWired, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import ProcessCard from './process-card';

function getCpuColor(pct) {
  if (pct < 30) return 'text-emerald-400';
  if (pct < 60) return 'text-yellow-400';
  if (pct < 85) return 'text-orange-400';
  return 'text-red-400';
}

function getMemoryColor(mb) {
  if (mb < 50) return 'text-emerald-400';
  if (mb < 100) return 'text-yellow-400';
  if (mb < 250) return 'text-orange-400';
  return 'text-red-400';
}

const SOURCE_CONFIG = {
  pm2:       { icon: faCubes,        label: 'PM2',       accent: 'purple' },
  docker:    { icon: faDocker,       label: 'Docker',    accent: 'blue' },
  system:    { icon: faServer,       label: 'System',    accent: 'zinc' },
  tailscale: { icon: faNetworkWired, label: 'Tailscale', accent: 'teal' },
};

const ACCENT_CLASSES = {
  purple: { border: 'border-purple-500/30', headerBg: 'bg-purple-500/5', iconText: 'text-purple-400', labelText: 'text-purple-300', countBadge: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  blue:   { border: 'border-blue-500/30',   headerBg: 'bg-blue-500/5',   iconText: 'text-blue-400',   labelText: 'text-blue-300',   countBadge: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  zinc:   { border: 'border-zinc-500/30',   headerBg: 'bg-zinc-500/5',   iconText: 'text-zinc-400',   labelText: 'text-zinc-300',   countBadge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
  teal:   { border: 'border-teal-500/30',   headerBg: 'bg-teal-500/5',   iconText: 'text-teal-400',   labelText: 'text-teal-300',   countBadge: 'bg-teal-500/10 text-teal-400 border-teal-500/20' },
};

export default function SourceSection({ source, groups, collapsed, onToggle, onAction, onHide, onRename, onNote }) {
  const config = SOURCE_CONFIG[source] || SOURCE_CONFIG.system;
  const accent = ACCENT_CLASSES[config.accent];

  const allProcesses = groups.flatMap(g => g.processes);
  const totalCount = allProcesses.length;
  const totalCpu = allProcesses.reduce((sum, p) => sum + (p.cpu || 0), 0);
  const totalMem = allProcesses.reduce((sum, p) => sum + (p.memory || 0), 0);
  const hasCpu = allProcesses.some(p => p.cpu != null);
  const hasMem = allProcesses.some(p => p.memory != null);

  return (
    <section className={`source-section border ${accent.border}`}>
      <div
        onClick={onToggle}
        className={`flex items-center justify-between px-4 py-3 cursor-pointer select-none rounded-xl ${accent.headerBg}`}
      >
        <div className="flex items-center gap-2.5">
          <FontAwesomeIcon icon={config.icon} className={`text-sm ${accent.iconText}`} />
          <span className={`font-semibold text-sm ${accent.labelText}`}>{config.label}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${accent.countBadge}`}>
            {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {hasCpu && (
            <span className={`text-xs tabular-nums ${getCpuColor(totalCpu / totalCount)}`}>
              {Math.round(totalCpu)}% <span className="text-zinc-500">CPU</span>
            </span>
          )}
          {hasMem && (
            <span className={`text-xs tabular-nums ${getMemoryColor(totalMem / totalCount)}`}>
              {Math.round(totalMem)} MB <span className="text-zinc-500">MEM</span>
            </span>
          )}
          <FontAwesomeIcon
            icon={collapsed ? faChevronDown : faChevronUp}
            className="text-xs text-zinc-500 transition-transform duration-200"
          />
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 pt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map(group => (
            <ProcessCard
              key={group.key}
              displayName={group.displayName}
              processes={group.processes}
              onAction={onAction}
              onHide={(processId) => onHide(processId)}
              onRename={(processId, name) => onRename(processId, name)}
              onNote={(processId, note) => onNote(processId, note)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
