'use client';

import { useState } from 'react';
import { AuditReport, BrandProfile, CompetitorBrand, AiMention, SerpResultByKeyword, DeepPageInsight } from '@/lib/types';

type Tab = 'overview' | 'serp' | 'competitors' | 'ai' | 'recommendations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'serp', label: 'SERP' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'ai', label: 'AI Mentions' },
  { id: 'recommendations', label: 'Recommendations' },
];

interface Props {
  report: AuditReport;
  recipientEmail?: string;
  onSendEmail: (recipient: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function ReportPreview({ report, recipientEmail, onSendEmail }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [emailTo, setEmailTo] = useState(recipientEmail || '');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const handleSend = async () => {
    if (!emailTo.trim()) return;
    setSending(true);
    setSentMsg(null);
    setSendErr(null);
    const result = await onSendEmail(emailTo.trim());
    setSending(false);
    if (result.ok) setSentMsg(`Emailed to ${emailTo.trim()}`);
    else setSendErr(result.error || 'Failed to send');
  };

  return (
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header / actions */}
      <div className="px-6 py-5 border-b border-zinc-800 bg-gradient-to-r from-cyan-500/10 to-purple-500/10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-cyan-300 mb-1">Audit complete</div>
            <h2 className="text-xl font-semibold text-zinc-50">{report.brand.domain}</h2>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="recipient@example.com"
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm font-mono focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleSend}
              disabled={sending || !emailTo.trim()}
              className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-zinc-900 font-semibold rounded-lg text-sm transition-colors"
            >
              {sending ? 'Sending...' : 'Email report'}
            </button>
          </div>
        </div>
        {sentMsg && <div className="mt-2 text-sm text-emerald-300">{sentMsg}</div>}
        {sendErr && <div className="mt-2 text-sm text-red-400">{sendErr}</div>}
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-800 px-2 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'text-cyan-300 border-cyan-400'
                : 'text-zinc-400 border-transparent hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6">
        {tab === 'overview' && <OverviewTab report={report} />}
        {tab === 'serp' && <SerpTab serp={report.serp} keywords={report.keywords} />}
        {tab === 'competitors' && <CompetitorsTab competitors={report.competitors} profiles={report.brandProfiles} deep={report.deepInsights} />}
        {tab === 'ai' && <AiTab mentions={report.aiMentions} />}
        {tab === 'recommendations' && <RecsTab report={report} />}
      </div>
    </div>
  );
}

function OverviewTab({ report }: { report: AuditReport }) {
  const exec = report.executiveSummary;
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-cyan-500/8 to-purple-500/8 border border-zinc-800 rounded-lg p-5">
        <div className="text-xs uppercase tracking-wider text-cyan-300 mb-2">Headline</div>
        <div className="text-zinc-100 text-lg font-medium leading-snug">{exec.headline}</div>
      </div>

      <div>
        <h3 className="text-zinc-100 font-semibold mb-3">Key findings</h3>
        <ul className="space-y-2">
          {exec.keyFindings.map((f, i) => (
            <li key={i} className="flex gap-3 text-zinc-300 text-sm">
              <span className="text-cyan-400 mt-0.5">·</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-zinc-100 font-semibold mb-3">Competitive gaps</h3>
        <ul className="space-y-2">
          {exec.competitiveGaps.map((g, i) => (
            <li key={i} className="flex gap-3 text-zinc-300 text-sm">
              <span className="text-orange-400 mt-0.5">·</span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-zinc-900">
        <Stat label="Keywords audited" value={report.keywords.length} />
        <Stat label="Competitors found" value={report.competitors.length} />
        <Stat label="AI engines queried" value={report.aiMentions.length} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-3 text-center">
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}

function SerpTab({ serp, keywords }: { serp: SerpResultByKeyword[]; keywords: string[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-zinc-100 font-semibold mb-3">Keywords used</h3>
        <div className="flex flex-wrap gap-2">
          {keywords.map((k) => (
            <span key={k} className="text-xs bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1 text-zinc-300">{k}</span>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {serp.map((s) => (
          <div key={s.keyword} className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-zinc-200">"{s.keyword}"</div>
              <div className="text-xs text-zinc-500">{s.items.length} results</div>
            </div>
            <ol className="space-y-1 text-xs text-zinc-400 font-mono">
              {s.items.slice(0, 8).map((item) => (
                <li key={item.url} className="flex gap-2">
                  <span className="text-zinc-600 w-6 text-right shrink-0">#{item.rank}</span>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 truncate">{item.domain}</a>
                  <span className="text-zinc-500 truncate">{item.title}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorsTab({
  competitors,
  profiles,
  deep,
}: {
  competitors: CompetitorBrand[];
  profiles: BrandProfile[];
  deep: DeepPageInsight[];
}) {
  return (
    <div className="space-y-4">
      {competitors.map((c) => {
        const profile = profiles.find((p) => p.domain === c.domain);
        const deepForBrand = deep.filter((d) => d.domain === c.domain);
        return (
          <div key={c.domain} className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="text-base font-semibold text-zinc-100 hover:text-cyan-300">
                {c.domain}
              </a>
              <span className="text-xs text-zinc-500">
                {c.appearanceCount} keyword appearances - avg rank {avgRank(c)}
              </span>
            </div>
            {profile && (
              <div className="space-y-1.5 text-sm mb-3">
                <div><span className="text-zinc-500">Category:</span> <span className="text-zinc-300">{profile.category}</span></div>
                <div><span className="text-zinc-500">Value prop:</span> <span className="text-zinc-300">{profile.valueProp}</span></div>
                {profile.pricingModel && <div><span className="text-zinc-500">Pricing:</span> <span className="text-zinc-300">{profile.pricingModel}</span></div>}
                {profile.features.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Features:</span>
                    <div className="flex flex-wrap gap-1">
                      {profile.features.slice(0, 8).map((f, i) => (
                        <span key={i} className="text-[11px] bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-400">{f}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {deepForBrand.length > 0 && (
              <div className="border-t border-zinc-900 pt-3 space-y-2">
                {deepForBrand.map((d) => (
                  <div key={d.url} className="text-sm">
                    <div className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">{d.pageType}</div>
                    <div className="text-zinc-300">{d.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function avgRank(c: CompetitorBrand): string {
  if (!c.rankings.length) return '-';
  return (c.rankings.reduce((s, r) => s + r.rank, 0) / c.rankings.length).toFixed(1);
}

function AiTab({ mentions }: { mentions: AiMention[] }) {
  return (
    <div className="space-y-4">
      {mentions.map((m) => (
        <div key={m.engine} className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-zinc-100 capitalize">{m.engine}</span>
              <StatusBadge status={m.status} />
            </div>
            <div className="text-xs text-zinc-500">{m.brandsMentioned.length} brands surfaced</div>
          </div>
          <div className="text-xs text-zinc-500 italic mb-2">"{m.query}"</div>
          {m.brandsMentioned.length > 0 ? (
            <div className="space-y-1.5">
              {m.brandsMentioned.slice(0, 12).map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 ${
                    b.sentiment === 'positive' ? 'bg-emerald-500/15 text-emerald-300' :
                    b.sentiment === 'negative' ? 'bg-red-500/15 text-red-300' :
                    'bg-zinc-700/40 text-zinc-400'
                  }`}>
                    {b.sentiment}
                  </span>
                  <span className="text-zinc-200 font-medium">{b.brand}</span>
                  <span className="text-zinc-500 text-xs">- {b.context}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-zinc-600 italic text-sm">no brand mentions extracted from this engine's response</div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: 'success' | 'partial' | 'failed' }) {
  const cls =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : status === 'partial'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-red-500/15 text-red-300 border-red-500/30';
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function RecsTab({ report }: { report: AuditReport }) {
  const exec = report.executiveSummary;
  return (
    <div className="space-y-3">
      {exec.recommendations.map((r, i) => (
        <div key={i} className="flex gap-4 bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
          <span className="text-2xl font-bold text-cyan-400 shrink-0">{i + 1}</span>
          <p className="text-zinc-200 leading-relaxed pt-1">{r}</p>
        </div>
      ))}
    </div>
  );
}
