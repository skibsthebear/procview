'use client';

const statusConfig = {
  online: {
    label: 'Online',
    dotClass: 'bg-emerald-400 animate-status-pulse',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-400/10',
  },
  stopping: {
    label: 'Stopping',
    dotClass: 'bg-yellow-400',
    textClass: 'text-yellow-400',
    bgClass: 'bg-yellow-400/10',
  },
  stopped: {
    label: 'Stopped',
    dotClass: 'bg-zinc-500',
    textClass: 'text-zinc-400',
    bgClass: 'bg-zinc-400/10',
  },
  paused: {
    label: 'Paused',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-400/10',
  },
  errored: {
    label: 'Errored',
    dotClass: 'bg-red-400',
    textClass: 'text-red-400',
    bgClass: 'bg-red-400/10',
  },
  launching: {
    label: 'Launching',
    dotClass: 'bg-blue-400 animate-status-pulse',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-400/10',
  },
};

const defaultConfig = {
  label: 'Unknown',
  dotClass: 'bg-zinc-600',
  textClass: 'text-zinc-500',
  bgClass: 'bg-zinc-500/10',
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || defaultConfig;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.bgClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      <span className={config.textClass}>{config.label}</span>
    </span>
  );
}
