'use client';

import { useEffect, useState } from 'react';
import { StageProgress, BdProduct, SubTask, StageStatus } from '@/lib/types';

const PRODUCT_COLORS: Record<BdProduct, { running: string; complete: string; failed: string }> = {
  SERP: {
    running: 'bg-cyan-500/30 border-cyan-400 text-cyan-200',
    complete: 'bg-cyan-500/15 border-cyan-500/60 text-cyan-300',
    failed: 'bg-red-500/15 border-red-500/60 text-red-300',
  },
  UNLOCKER: {
    running: 'bg-orange-500/30 border-orange-400 text-orange-200',
    complete: 'bg-orange-500/15 border-orange-500/60 text-orange-300',
    failed: 'bg-red-500/15 border-red-500/60 text-red-300',
  },
  SCRAPER: {
    running: 'bg-purple-500/30 border-purple-400 text-purple-200',
    complete: 'bg-purple-500/15 border-purple-500/60 text-purple-300',
    failed: 'bg-red-500/15 border-red-500/60 text-red-300',
  },
  CLAUDE: {
    running: 'bg-emerald-500/30 border-emerald-400 text-emerald-200',
    complete: 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300',
    failed: 'bg-red-500/15 border-red-500/60 text-red-300',
  },
};

const STAGE_DOT: Record<StageStatus, string> = {
  pending: 'bg-zinc-700',
  running: 'bg-yellow-400 animate-pulse',
  complete: 'bg-emerald-500',
  partial: 'bg-orange-500',
  failed: 'bg-red-500',
};

interface Props {
  stages: StageProgress[];
}

export default function AuditTimeline({ stages }: Props) {
  return (
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2 bg-zinc-900/40">
        <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Pipeline</span>
      </div>
      <div className="divide-y divide-zinc-900">
        {stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: StageProgress }) {
  const elapsed = useElapsed(stage);
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${STAGE_DOT[stage.status]}`} />
          <span className="text-zinc-500 font-mono text-xs">Stage {stage.id}</span>
          <span className="text-zinc-100 font-medium text-sm">{stage.name}</span>
          {stage.status === 'partial' && (
            <span className="text-[10px] uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">partial</span>
          )}
          {stage.status === 'failed' && (
            <span className="text-[10px] uppercase tracking-wider text-red-400 bg-red-500/10 border border-red-500/30 rounded px-1.5 py-0.5">failed</span>
          )}
        </div>
        {elapsed !== null && (
          <span className="text-xs font-mono text-zinc-500">{elapsed}</span>
        )}
      </div>
      {stage.subTasks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-5">
          {stage.subTasks.map((sub) => (
            <SubTaskPill key={sub.id} sub={sub} />
          ))}
        </div>
      )}
      {stage.error && (
        <div className="ml-5 mt-2 text-xs text-red-400 font-mono">{stage.error}</div>
      )}
    </div>
  );
}

function SubTaskPill({ sub }: { sub: SubTask }) {
  const palette = sub.bdProduct ? PRODUCT_COLORS[sub.bdProduct] : null;
  let cls = 'bg-zinc-800/50 border-zinc-700 text-zinc-400';
  if (palette) {
    if (sub.status === 'running') cls = palette.running;
    else if (sub.status === 'complete') cls = palette.complete;
    else if (sub.status === 'failed') cls = palette.failed;
  } else if (sub.status === 'running') cls = 'bg-yellow-400/15 border-yellow-400 text-yellow-200';
  else if (sub.status === 'complete') cls = 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300';
  else if (sub.status === 'failed') cls = 'bg-red-500/15 border-red-500/60 text-red-300';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-mono ${cls} ${sub.status === 'running' ? 'animate-pulse' : ''}`}>
      {sub.bdProduct && (
        <span className="font-semibold tracking-wider">{sub.bdProduct}</span>
      )}
      <span className="opacity-90">{sub.label}</span>
    </span>
  );
}

function useElapsed(stage: StageProgress): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (stage.status !== 'running') return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [stage.status]);
  if (stage.status === 'pending') return null;
  if (!stage.startedAt) return null;
  const end = stage.endedAt || Date.now();
  const ms = end - stage.startedAt;
  return formatDuration(ms);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}
