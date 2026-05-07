'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Audit, LogEntry, StageProgress } from '@/lib/types';
import LogStream from '@/components/LogStream';
import AuditTimeline from '@/components/AuditTimeline';
import DiscoveryCard from '@/components/DiscoveryCard';
import ReportPreview from '@/components/ReportPreview';

// Re-typing the SSE payload (state.ts emits this shape)
type ServerEvent =
  | { kind: 'connected'; auditId: string }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'stage'; stage: StageProgress }
  | { kind: 'audit'; audit: Audit };

export default function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const seenLogIds = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    const connect = () => {
      es = new EventSource(`/api/audit/${id}/stream`);
      es.onmessage = (msg) => {
        if (cancelled) return;
        let data: ServerEvent;
        try {
          data = JSON.parse(msg.data) as ServerEvent;
        } catch {
          return;
        }
        if (data.kind === 'log') {
          const entry = data.entry;
          if (seenLogIds.current.has(entry.id)) return;
          seenLogIds.current.add(entry.id);
          setLogs((prev) => [...prev, entry]);
        } else if (data.kind === 'audit') {
          setAudit({ ...data.audit });
          // Close cleanly on terminal status so the connection doesn't linger.
          if (
            data.audit.status === 'complete' ||
            data.audit.status === 'failed' ||
            data.audit.status === 'partial'
          ) {
            if (es) {
              es.close();
              es = null;
            }
          }
        } else if (data.kind === 'stage') {
          setAudit((prev) => {
            if (!prev) return prev;
            const stages = prev.stages.map((s) => (s.id === data.stage.id ? data.stage : s));
            return { ...prev, stages };
          });
        }
      };
      // Booth WiFi is flaky. Let the browser auto-reconnect on transient errors.
      // Closing here would freeze the live activity stream silently.
      es.onerror = () => {};
    };

    connect();

    return () => {
      cancelled = true;
      if (es) es.close();
    };
  }, [id]);

  const handleConfirm = async (overrideUrl?: string) => {
    const res = await fetch(`/api/audit/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrideUrl ? { url: overrideUrl } : {}),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      throw new Error(e?.error || `Confirm failed (${res.status})`);
    }
  };

  const handleSendEmail = async (recipient: string) => {
    const res = await fetch(`/api/audit/${id}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientEmail: recipient }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      return { ok: false, error: e?.error || `Send failed (${res.status})` };
    }
    return { ok: true };
  };

  const showPipeline =
    audit?.status === 'running' ||
    audit?.status === 'partial' ||
    audit?.status === 'complete' ||
    (audit?.status === 'failed' && !!audit.brand);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-slate-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-purple-500/8 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <a href="/" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors">
            <span className="text-xs font-mono uppercase tracking-wider">← Competitive Visibility Audit</span>
          </a>
          {audit && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-zinc-500">Audit</span>
              <span className="text-zinc-300">{audit.input.brandName}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">{audit.input.location}</span>
              <span className="text-zinc-600">·</span>
              <StatusChip status={audit.status} />
            </div>
          )}
        </div>

        {!audit && !error && (
          <div className="text-zinc-500 text-sm">Loading audit...</div>
        )}
        {error && <div className="text-red-400">{error}</div>}

        {audit && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
            {/* Main column */}
            <div className="space-y-6">
              <DiscoveryCard audit={audit} onConfirm={handleConfirm} />
              {showPipeline && <AuditTimeline stages={audit.stages} />}
              {audit.report && (
                <ReportPreview
                  report={audit.report}
                  recipientEmail={audit.input.recipientEmail}
                  onSendEmail={handleSendEmail}
                />
              )}
            </div>

            {/* Side rail */}
            <div className="xl:sticky xl:top-8 xl:self-start">
              <LogStream logs={logs} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Audit['status'] }) {
  const map: Record<Audit['status'], { label: string; cls: string }> = {
    discovering: { label: 'discovering', cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
    awaiting_confirmation: { label: 'awaiting confirm', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
    running: { label: 'running', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
    partial: { label: 'partial', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    complete: { label: 'complete', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    failed: { label: 'failed', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  };
  const m = map[status];
  return <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${m.cls}`}>{m.label}</span>;
}
