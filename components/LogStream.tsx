'use client';

import { LogEntry, BdProduct } from '@/lib/types';

const MAX_VISIBLE = 10;

const PRODUCT_COLORS: Record<BdProduct, string> = {
  SERP: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  UNLOCKER: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  SCRAPER: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  CLAUDE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const TYPE_TONES: Record<string, string> = {
  STAGE_START: 'text-zinc-200 font-medium',
  STAGE_DONE: 'text-emerald-300',
  STAGE_FAIL: 'text-red-400',
  BD_CALL: 'text-zinc-400',
  BD_DONE: 'text-zinc-300',
  BD_FAIL: 'text-red-400',
  CLAUDE_CALL: 'text-zinc-400',
  CLAUDE_DONE: 'text-zinc-300',
  CLAUDE_FAIL: 'text-red-400',
  WARN: 'text-amber-300',
  ERROR: 'text-red-400',
  INFO: 'text-zinc-300',
};

interface Props {
  logs: LogEntry[];
  className?: string;
}

export default function LogStream({ logs, className = '' }: Props) {
  const visible = logs.slice(-MAX_VISIBLE).reverse();

  return (
    <div className={`flex flex-col bg-zinc-950/60 border border-zinc-800 rounded-xl overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Live activity</span>
        </div>
        <span className="text-xs text-zinc-600">{logs.length} events</span>
      </div>
      <div className="p-3 font-mono text-xs leading-relaxed space-y-1.5">
        {visible.length === 0 && (
          <div className="text-zinc-600 italic px-2 py-1">Waiting for first event...</div>
        )}
        {visible.map((log) => (
          <div key={log.id} className="flex items-start gap-2 px-2 py-1 hover:bg-zinc-900/40 rounded">
            <span className="text-zinc-600 shrink-0">{formatTime(log.timestamp)}</span>
            {log.bdProduct && (
              <span
                className={`shrink-0 inline-flex items-center px-1.5 py-px rounded border text-[10px] font-semibold uppercase tracking-wider ${PRODUCT_COLORS[log.bdProduct]}`}
              >
                {log.bdProduct}
              </span>
            )}
            <span className={`flex-1 ${TYPE_TONES[log.type] || 'text-zinc-300'}`}>
              {log.message}
              {log.durationMs !== undefined && (
                <span className="text-zinc-600 ml-2">({log.durationMs}ms)</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
