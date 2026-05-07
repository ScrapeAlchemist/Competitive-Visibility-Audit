'use client';

import { useMemo, useState } from 'react';
import {
  AuditReport,
  BrandCitationProfile,
  BrandProfile,
  CitationSource,
  CitationSourceType,
  CompetitorBrand,
  DeepPageInsight,
  RecommendationItem,
} from '@/lib/types';
import { brandMatchesSelf, brandSlugFromDomain, computeVisibilityMetrics } from '@/lib/visibility';

// =====================================================
// SERP "amplification" annotation — for each keyword, find the audited
// brand mentioned at top-N inside a listicle/review/comparison/analyst
// page that itself ranks in SERP top 10. Used by the SERP table to show
// "you don't rank but you're cited inside the listicle that does rank";
// the visibility score itself comes from the synthesis LLM call, which
// already sees citation data, so this no longer feeds into scoring.
// =====================================================

interface AmplifiedHit {
  sourceDomain: string;
  sourceRank: number;
  brandPosition: number;
}

const AMPLIFICATION_TYPES: ReadonlySet<CitationSourceType> = new Set<CitationSourceType>([
  'listicle',
  'review',
  'comparison',
  'analyst',
]);
const MAX_LISTICLE_SERP_RANK = 10;
const MAX_BRAND_POSITION_IN_LISTICLE = 5;

function computeAmplification(report: AuditReport): Map<string, AmplifiedHit> {
  const out = new Map<string, AmplifiedHit>();
  const citations = report.citations;
  if (!citations) return out;

  const slug = brandSlugFromDomain(report.brand.domain);
  const selfProfile = citations.profiles.find(
    (p) => p.isSelf || brandMatchesSelf(p.brand, slug)
  );
  if (!selfProfile) return out;

  const sourceByUrl = new Map<string, CitationSource>();
  for (const s of citations.sources) sourceByUrl.set(s.url, s);

  const rankByKeywordUrl = new Map<string, Map<string, number>>();
  for (const sr of report.serp) {
    const m = new Map<string, number>();
    for (const it of sr.items) {
      if (typeof it.rank === 'number') m.set(it.url, it.rank);
    }
    rankByKeywordUrl.set(sr.keyword, m);
  }

  for (const cit of selfProfile.sources) {
    if (cit.position == null || cit.position > MAX_BRAND_POSITION_IN_LISTICLE) continue;
    const source = sourceByUrl.get(cit.url);
    if (!source) continue;
    if (!AMPLIFICATION_TYPES.has(source.type)) continue;

    for (const kw of source.fromKeywords) {
      const rank = rankByKeywordUrl.get(kw)?.get(cit.url);
      if (rank == null || rank > MAX_LISTICLE_SERP_RANK) continue;
      const existing = out.get(kw);
      const better =
        !existing ||
        cit.position < existing.brandPosition ||
        (cit.position === existing.brandPosition && rank < existing.sourceRank);
      if (better) {
        out.set(kw, {
          sourceDomain: source.domain,
          sourceRank: rank,
          brandPosition: cit.position,
        });
      }
    }
  }

  return out;
}

type Tab = 'overview' | 'serp' | 'competitors' | 'thirdparty' | 'ai' | 'recommendations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'serp', label: 'SERP' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'thirdparty', label: 'Third-party' },
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
        {tab === 'serp' && <SerpTab report={report} />}
        {tab === 'competitors' && (
          <CompetitorsTab
            competitors={report.competitors}
            profiles={report.brandProfiles}
            deep={report.deepInsights}
          />
        )}
        {tab === 'thirdparty' && <ThirdPartyTab report={report} />}
        {tab === 'ai' && <AiTab report={report} />}
        {tab === 'recommendations' && <RecsTab report={report} />}
      </div>
    </div>
  );
}

// =====================================================
// Visibility scorecard (Overview hero)
// Pillar counts (SERP / AI / citations) are deterministic; the composite
// 0-100 score and its rationale come from the synthesis LLM call.
// =====================================================

function VisibilityScorecard({ report }: { report: AuditReport }) {
  const v = useMemo(() => computeVisibilityMetrics(report), [report]);
  // Pre-LLM-scoring reports don't have visibilityScore — fall back to the
  // simple pillar mean so old audits still render without crashing.
  const llmScore = report.executiveSummary.visibilityScore;
  const score = llmScore?.value ?? fallbackScore(v);
  const scoreColor = score >= 60 ? 'text-emerald-300' : score >= 30 ? 'text-amber-300' : 'text-red-300';
  const scoreBg = score >= 60 ? 'from-emerald-500/15' : score >= 30 ? 'from-amber-500/15' : 'from-red-500/15';
  const serpPct = v.serpTotal > 0 ? Math.round((v.serpHits / v.serpTotal) * 100) : 0;
  const aiPct = v.aiQueried > 0 ? Math.round((v.aiHits / v.aiQueried) * 100) : 0;
  const citationPct = v.citationsAvailable
    ? Math.round((v.citationHits / v.citationTotal) * 100)
    : 0;

  return (
    <div className={`bg-gradient-to-br ${scoreBg} to-purple-500/8 border border-zinc-800 rounded-xl p-6`}>
      <div className="text-xs uppercase tracking-wider text-zinc-400 mb-4">Visibility scorecard</div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-6 items-center">
        {/* Organic SERP */}
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Organic SERP</div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-zinc-100">
              {v.serpHits}
              <span className="text-zinc-500 text-2xl">/{v.serpTotal}</span>
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">keywords ranking top 10</div>
          <ProgressBar pct={serpPct} />
        </div>

        {/* AI engines */}
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">AI engines</div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-zinc-100">
              {v.aiHits}
              <span className="text-zinc-500 text-2xl">/{v.aiQueried}</span>
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">engines mentioning the brand</div>
          <ProgressBar pct={aiPct} />
        </div>

        {/* Third-party citations */}
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Third-party</div>
          {v.citationsAvailable ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-zinc-100">
                  {v.citationHits}
                  <span className="text-zinc-500 text-2xl">/{v.citationTotal}</span>
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {v.citationTopPicks > 0
                  ? `sources cite the brand (${v.citationTopPicks} top-pick)`
                  : 'sources cite the brand'}
              </div>
              <ProgressBar pct={citationPct} />
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-zinc-500">—</div>
              <div className="text-xs text-zinc-500 mt-1">no third-party sources mined</div>
              <ProgressBar pct={0} />
            </>
          )}
        </div>

        {/* Composite score (LLM-generated) */}
        <div className="md:border-l md:border-zinc-800 md:pl-6 text-center md:text-left">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Visibility score</div>
          <div className={`text-6xl font-bold ${scoreColor}`}>{score}</div>
          <div className="text-xs text-zinc-500">out of 100 · LLM-weighted</div>
        </div>
      </div>
      {llmScore?.rationale && (
        <div className="mt-4 pt-4 border-t border-zinc-800/60 text-sm text-zinc-300 leading-relaxed">
          <span className="text-xs uppercase tracking-wider text-zinc-500 mr-2">Why this score</span>
          {llmScore.rationale}
        </div>
      )}
    </div>
  );
}

function fallbackScore(v: ReturnType<typeof computeVisibilityMetrics>): number {
  const serpRatio = v.serpTotal > 0 ? v.serpHits / v.serpTotal : 0;
  const aiRatio = v.aiQueried > 0 ? v.aiHits / v.aiQueried : 0;
  const citationRatio = v.citationsAvailable ? v.citationHits / v.citationTotal : 0;
  const ratios = v.citationsAvailable ? [serpRatio, aiRatio, citationRatio] : [serpRatio, aiRatio];
  return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 60 ? 'bg-emerald-400' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="w-full h-1.5 bg-zinc-900 rounded-full mt-3 overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// =====================================================
// Overview tab
// =====================================================

function OverviewTab({ report }: { report: AuditReport }) {
  const exec = report.executiveSummary;
  return (
    <div className="space-y-6">
      <VisibilityScorecard report={report} />

      <div className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-5">
        <div className="text-xs uppercase tracking-wider text-cyan-300 mb-2">The story</div>
        <div className="text-zinc-200 italic leading-relaxed">{exec.narrativeArc}</div>
      </div>

      <div className="bg-gradient-to-br from-cyan-500/8 to-purple-500/8 border border-zinc-800 rounded-lg p-5">
        <div className="text-xs uppercase tracking-wider text-cyan-300 mb-2">Headline</div>
        <div className="text-zinc-100 text-lg font-medium leading-snug">{exec.headline}</div>
      </div>

      <div>
        <h3 className="text-zinc-100 font-semibold mb-3">Key findings</h3>
        <ul className="space-y-2">
          {exec.keyFindings.map((f, i) => (
            <li key={i} className="flex gap-3 text-zinc-300 text-sm leading-relaxed">
              <span className="text-cyan-400 mt-0.5 shrink-0">{i + 1}.</span>
              <span>{f}</span>
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

// =====================================================
// SERP tab + heatmap
// =====================================================

interface SerpRow {
  domain: string;
  isSelf: boolean;
  ranks: (number | null)[];
  amplified: (AmplifiedHit | null)[]; // per-keyword amp (self row only)
  topTenAppearances: number;          // direct top-10 + (self only) amplified-only hits
}

function buildSerpMatrix(report: AuditReport): SerpRow[] {
  const selfDomain = report.brand.domain.toLowerCase();
  const competitorDomains = report.competitors.slice(0, 5).map((c) => c.domain);

  // Self always pinned at top, even if zero appearances
  const allDomains = [selfDomain, ...competitorDomains.filter((d) => d.toLowerCase() !== selfDomain)];
  const amp = computeAmplification(report);

  return allDomains.map((domain) => {
    const isSelf = domain.toLowerCase() === selfDomain;
    const ranks: (number | null)[] = report.keywords.map((kw) => {
      const sr = report.serp.find((s) => s.keyword === kw);
      if (!sr) return null;
      const item = sr.items.find((i) => i.domain?.toLowerCase() === domain.toLowerCase());
      return item ? item.rank : null;
    });
    const amplified: (AmplifiedHit | null)[] = report.keywords.map((kw) =>
      isSelf ? amp.get(kw) ?? null : null
    );
    const directTop10 = ranks.filter((r) => r !== null && r <= 10).length;
    const amplifiedOnly = isSelf
      ? report.keywords.filter((_, i) => {
          const r = ranks[i];
          const directHit = r !== null && r <= 10;
          return !directHit && amplified[i] != null;
        }).length
      : 0;
    return { domain, isSelf, ranks, amplified, topTenAppearances: directTop10 + amplifiedOnly };
  });
}

function rankCellClass(rank: number | null): string {
  if (rank === null) return 'bg-zinc-900/40 text-zinc-700';
  if (rank <= 3) return 'bg-emerald-500/25 text-emerald-200 font-semibold';
  if (rank <= 10) return 'bg-amber-500/20 text-amber-200';
  return 'bg-zinc-800/60 text-zinc-400';
}

function SerpHeatmap({ report }: { report: AuditReport }) {
  const matrix = useMemo(() => buildSerpMatrix(report), [report]);

  if (matrix.length === 0 || report.keywords.length === 0) {
    return <div className="text-zinc-500 text-sm">No SERP data available.</div>;
  }

  return (
    <div className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="text-zinc-100 font-semibold">SERP positioning matrix</h3>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-500">
          <Legend swatch="bg-emerald-500/40" label="rank 1-3" />
          <Legend swatch="bg-amber-500/30" label="rank 4-10" />
          <Legend swatch="bg-zinc-800" label="rank 11-20" />
          <Legend swatch="bg-cyan-500/20 border border-cyan-500/40 border-dashed" label="amplified" />
          <Legend swatch="bg-zinc-900/40 border border-zinc-800" label="not ranked" />
        </div>
      </div>
      <table className="w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col style={{ width: '160px' }} />
          {report.keywords.map((kw) => <col key={kw} />)}
          <col style={{ width: '60px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="text-left text-zinc-500 font-medium py-2 pr-3">
              Domain
            </th>
            {report.keywords.map((kw) => (
              <th
                key={kw}
                title={kw}
                className="text-zinc-500 font-medium py-2 px-1 text-center"
              >
                <div className="truncate">{truncate(kw, 14)}</div>
              </th>
            ))}
            <th className="text-zinc-500 font-medium py-2 px-2 text-center">Top 10</th>
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={row.domain} className={row.isSelf ? 'bg-cyan-500/5' : ''}>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  {row.isSelf && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                      You
                    </span>
                  )}
                  <a
                    href={`https://${row.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`hover:text-cyan-300 ${row.isSelf ? 'text-cyan-200 font-semibold' : 'text-zinc-200'}`}
                  >
                    {row.domain}
                  </a>
                </div>
              </td>
              {row.ranks.map((rank, i) => {
                const amp = row.amplified[i];
                if (rank === null && amp) {
                  return (
                    <td key={i} className="py-1 px-1">
                      <div
                        className="text-center rounded py-1 font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/40 border-dashed"
                        title={`Cited at #${amp.brandPosition} in ${amp.sourceDomain} (which ranks #${amp.sourceRank} for this keyword)`}
                      >
                        via #{amp.brandPosition}
                      </div>
                    </td>
                  );
                }
                return (
                  <td key={i} className="py-1 px-1">
                    <div
                      className={`text-center rounded py-1 font-mono ${rankCellClass(rank)}`}
                      title={rank ? `Rank #${rank}` : 'Not ranked'}
                    >
                      {rank !== null ? `#${rank}` : '—'}
                    </div>
                  </td>
                );
              })}
              <td className="py-2 px-2 text-center">
                <span className={row.isSelf ? 'text-cyan-200 font-semibold' : 'text-zinc-300'}>
                  {row.topTenAppearances}/{report.keywords.length}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block w-3 h-3 rounded ${swatch}`} />
      {label}
    </span>
  );
}

function SerpTab({ report }: { report: AuditReport }) {
  return (
    <div className="space-y-5">
      <SerpHeatmap report={report} />

      <div>
        <h3 className="text-zinc-100 font-semibold mb-3">Keyword breakdown</h3>
        <div className="space-y-3">
          {report.serp.map((s) => (
            <div key={s.keyword} className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-zinc-200">&ldquo;{s.keyword}&rdquo;</div>
                <div className="text-xs text-zinc-500">{s.items.length} results</div>
              </div>
              <ol className="space-y-1 text-xs text-zinc-400 font-mono">
                {s.items.slice(0, 8).map((item) => (
                  <li key={item.url} className="flex gap-2">
                    <span className="text-zinc-600 w-6 text-right shrink-0">#{item.rank}</span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`hover:text-cyan-300 truncate ${
                        item.domain?.toLowerCase() === report.brand.domain.toLowerCase()
                          ? 'text-cyan-300 font-semibold'
                          : 'text-cyan-400'
                      }`}
                    >
                      {item.domain}
                    </a>
                    <span className="text-zinc-500 truncate">{item.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Competitors tab (unchanged shape, slightly tighter)
// =====================================================

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
              <a
                href={`https://${c.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base font-semibold text-zinc-100 hover:text-cyan-300"
              >
                {c.domain}
              </a>
              <span className="text-xs text-zinc-500">
                {c.appearanceCount} keyword appearances - avg rank {avgRank(c)}
              </span>
            </div>
            {profile && (
              <div className="space-y-1.5 text-sm mb-3">
                <div>
                  <span className="text-zinc-500">Category:</span>{' '}
                  <span className="text-zinc-300">{profile.category}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Value prop:</span>{' '}
                  <span className="text-zinc-300">{profile.valueProp}</span>
                </div>
                {profile.pricingModel && (
                  <div>
                    <span className="text-zinc-500">Pricing:</span>{' '}
                    <span className="text-zinc-300">{profile.pricingModel}</span>
                  </div>
                )}
                {profile.features.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Features:</span>
                    <div className="flex flex-wrap gap-1">
                      {profile.features.slice(0, 8).map((f, i) => (
                        <span
                          key={i}
                          className="text-[11px] bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-400"
                        >
                          {f}
                        </span>
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

// =====================================================
// AI Mentions matrix + per-engine details
// =====================================================

interface AiBrandRow {
  key: string;
  displayName: string;
  perEngine: Record<string, { position: number; sentiment: 'positive' | 'neutral' | 'negative' } | null>;
  totalMentions: number;
  bestPosition: number;
  isSelf: boolean;
}

function brandKey(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function buildAiMatrix(report: AuditReport): { rows: AiBrandRow[]; engines: string[] } {
  const selfSlug = brandSlugFromDomain(report.brand.domain);
  const map = new Map<string, AiBrandRow>();
  const engines = report.aiMentions.map((m) => m.engine);

  for (const m of report.aiMentions) {
    if (m.status !== 'success') continue;
    m.brandsMentioned.forEach((b, idx) => {
      const key = brandKey(b.brand);
      if (!key) return;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          displayName: b.brand,
          perEngine: Object.fromEntries(engines.map((e) => [e, null])),
          totalMentions: 0,
          bestPosition: 99,
          isSelf: brandMatchesSelf(b.brand, selfSlug),
        };
        map.set(key, row);
      }
      // Take the earliest position if same brand appears in same engine list multiple times
      const existing = row.perEngine[m.engine];
      if (!existing || idx + 1 < existing.position) {
        row.perEngine[m.engine] = { position: idx + 1, sentiment: b.sentiment };
      }
      // count once per engine: track set
    });
  }

  // Now recount totalMentions per row from perEngine map
  for (const row of map.values()) {
    let count = 0;
    let best = 99;
    for (const cell of Object.values(row.perEngine)) {
      if (cell) {
        count++;
        if (cell.position < best) best = cell.position;
      }
    }
    row.totalMentions = count;
    row.bestPosition = best;
  }

  // Ensure self is always present even if not mentioned. Render the brand
  // name (capitalized slug) for parity with the other rows which all show
  // brand names from the AI parser - mixing "eu.eastpak.com" against
  // "Samsonite" / "Osprey" looks inconsistent.
  if (![...map.values()].some((r) => r.isSelf)) {
    const displayName = selfSlug ? selfSlug.charAt(0).toUpperCase() + selfSlug.slice(1) : report.brand.domain;
    map.set(`__self__${selfSlug}`, {
      key: `__self__${selfSlug}`,
      displayName,
      perEngine: Object.fromEntries(engines.map((e) => [e, null])),
      totalMentions: 0,
      bestPosition: 99,
      isSelf: true,
    });
  }

  const rows = Array.from(map.values()).sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1;
    if (!a.isSelf && b.isSelf) return 1;
    if (b.totalMentions !== a.totalMentions) return b.totalMentions - a.totalMentions;
    return a.bestPosition - b.bestPosition;
  });

  return { rows: rows.slice(0, 12), engines };
}

function aiCellClass(cell: { position: number; sentiment: string } | null): string {
  if (!cell) return 'bg-zinc-900/40 text-zinc-700';
  if (cell.sentiment === 'positive') return 'bg-emerald-500/20 text-emerald-200';
  if (cell.sentiment === 'negative') return 'bg-red-500/20 text-red-200';
  return 'bg-zinc-700/40 text-zinc-300';
}

function AiMatrix({ report }: { report: AuditReport }) {
  const { rows, engines } = useMemo(() => buildAiMatrix(report), [report]);
  if (rows.length === 0 || engines.length === 0) {
    return <div className="text-zinc-500 text-sm">No AI mention data available.</div>;
  }
  const totalMentionSlots = rows.length * engines.length;
  const filledSlots = rows.reduce((s, r) => s + r.totalMentions, 0);

  return (
    <div className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-zinc-100 font-semibold">AI engine presence matrix</h3>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-500">
          <Legend swatch="bg-emerald-500/40" label="positive" />
          <Legend swatch="bg-zinc-700/60" label="neutral" />
          <Legend swatch="bg-red-500/40" label="negative" />
          <Legend swatch="bg-zinc-900/40 border border-zinc-800" label="not mentioned" />
        </div>
      </div>
      <table className="w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col style={{ width: '180px' }} />
          {engines.map((e) => <col key={e} />)}
          <col style={{ width: '60px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="text-left text-zinc-500 font-medium py-2 pr-3">
              Brand
            </th>
            {engines.map((e) => (
              <th key={e} className="text-zinc-500 font-medium py-2 px-2 text-center capitalize">
                {e}
              </th>
            ))}
            <th className="text-zinc-500 font-medium py-2 px-2 text-center">SoV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sov = totalMentionSlots > 0 ? Math.round((row.totalMentions / engines.length) * 100) : 0;
            return (
              <tr key={row.key} className={row.isSelf ? 'bg-cyan-500/5' : ''}>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {row.isSelf && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                        You
                      </span>
                    )}
                    <span className={row.isSelf ? 'text-cyan-200 font-semibold' : 'text-zinc-200'}>
                      {row.displayName}
                    </span>
                  </div>
                </td>
                {engines.map((e) => {
                  const cell = row.perEngine[e];
                  return (
                    <td key={e} className="py-1 px-1">
                      <div
                        className={`text-center rounded py-1 font-mono ${aiCellClass(cell)}`}
                        title={cell ? `Position #${cell.position} (${cell.sentiment})` : 'Not mentioned'}
                      >
                        {cell ? `#${cell.position}` : '—'}
                      </div>
                    </td>
                  );
                })}
                <td className="py-2 px-2 text-center">
                  <span className={row.isSelf ? 'text-cyan-200 font-semibold' : 'text-zinc-300'}>
                    {sov}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 text-[11px] text-zinc-500">
        SoV = share of voice across engines. {filledSlots} mentions across {engines.length} engines and {rows.length} brands.
      </div>
    </div>
  );
}

function AiTab({ report }: { report: AuditReport }) {
  return (
    <div className="space-y-5">
      <AiMatrix report={report} />

      <div className="space-y-3">
        <h3 className="text-zinc-100 font-semibold">Per-engine breakdown</h3>
        {report.aiMentions.map((m) => (
          <div key={m.engine} className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-zinc-100 capitalize">{m.engine}</span>
                <StatusBadge status={m.status} />
              </div>
              <div className="text-xs text-zinc-500">{m.brandsMentioned.length} brands surfaced</div>
            </div>
            <div className="text-xs text-zinc-500 italic mb-2">&ldquo;{m.query}&rdquo;</div>
            {m.brandsMentioned.length > 0 ? (
              <div className="space-y-1.5">
                {m.brandsMentioned.slice(0, 12).map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 bg-zinc-800/60 text-zinc-400 font-mono">
                      #{i + 1}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 ${
                        b.sentiment === 'positive'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : b.sentiment === 'negative'
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-zinc-700/40 text-zinc-400'
                      }`}
                    >
                      {b.sentiment}
                    </span>
                    <span className="text-zinc-200 font-medium">{b.brand}</span>
                    <span className="text-zinc-500 text-xs">- {b.context}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-zinc-600 italic text-sm">no brand mentions extracted from this engine&rsquo;s response</div>
            )}
          </div>
        ))}
      </div>
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
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>{status}</span>
  );
}

// =====================================================
// Third-party visibility tab
// Brands ranked or recommended INSIDE listicles, Reddit threads, and
// review sites that surfaced for the keyword set. Often catches
// competitors who don't rank directly but get named everywhere.
// =====================================================

const SOURCE_TYPE_LABELS: Record<string, string> = {
  listicle: 'Listicle',
  review: 'Review',
  comparison: 'Comparison',
  forum: 'Forum',
  news: 'News',
  media: 'Media',
  analyst: 'Analyst',
  other: 'Other',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  listicle: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300',
  review: 'bg-purple-500/15 border-purple-500/40 text-purple-300',
  comparison: 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-300',
  forum: 'bg-orange-500/15 border-orange-500/40 text-orange-300',
  news: 'bg-blue-500/15 border-blue-500/40 text-blue-300',
  media: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300',
  analyst: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  other: 'bg-zinc-700/30 border-zinc-700 text-zinc-400',
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  'top pick': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  recommended: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  mentioned: 'bg-zinc-700/40 text-zinc-300 border-zinc-700',
  criticized: 'bg-red-500/15 text-red-300 border-red-500/30',
};

function ThirdPartyTab({ report }: { report: AuditReport }) {
  const citations = report.citations;
  if (!citations || citations.sources.length === 0) {
    return (
      <div className="text-zinc-500 text-sm">
        No third-party citations were mined for this audit. Stage 4 only runs when SERP results
        surface listicles, review sites, or forum discussions.
      </div>
    );
  }

  const successSources = citations.sources.filter((s) => s.status !== 'failed');
  const totalCitations = citations.sources.reduce((s, src) => s + src.citations.length, 0);
  const selfProfile = citations.profiles.find((p) => p.isSelf);

  return (
    <div className="space-y-6">
      {/* Headline metric block — your visibility in third-party articles */}
      <div className="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-zinc-800 rounded-xl p-6">
        <div className="text-xs uppercase tracking-wider text-cyan-300 mb-3">Your third-party visibility</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Cited in</div>
            <div className="text-3xl font-bold text-zinc-100">
              {selfProfile?.citationCount || 0}
              <span className="text-zinc-500 text-xl">/{successSources.length}</span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">third-party sources</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Top-pick mentions</div>
            <div className="text-3xl font-bold text-zinc-100">{selfProfile?.topPickCount || 0}</div>
            <div className="text-xs text-zinc-500 mt-1">
              articles where {report.brand.domain} is #1 / &ldquo;best&rdquo;
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Average position</div>
            <div className="text-3xl font-bold text-zinc-100">
              {selfProfile?.averagePosition !== null && selfProfile?.averagePosition !== undefined
                ? `#${selfProfile.averagePosition.toFixed(1)}`
                : '—'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">across articles ranking it</div>
          </div>
        </div>
      </div>

      {/* Brand leaderboard — citation count + best position across sources */}
      <BrandCitationLeaderboard profiles={citations.profiles} />

      {/* Source list — every listicle/forum/review we mined, with brands inside */}
      <CitationSourceList sources={citations.sources} />

      <div className="text-[11px] text-zinc-500">
        Mined {totalCitations} brand citations from {successSources.length} third-party sources via Bright Data Web Unlocker + Claude extraction.
      </div>
    </div>
  );
}

function BrandCitationLeaderboard({ profiles }: { profiles: BrandCitationProfile[] }) {
  // Don't show the leaderboard if it's effectively empty (just the
  // synthetic self-zero row). Real signal needs at least one mined brand.
  const realProfiles = profiles.filter((p) => p.citationCount > 0);
  if (realProfiles.length === 0) {
    return (
      <div className="text-zinc-500 text-sm bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
        Citation extraction returned no brand mentions across the mined sources.
      </div>
    );
  }

  return (
    <div className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
      <h3 className="text-zinc-100 font-semibold mb-3">Brand citation leaderboard</h3>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
            <th className="text-left py-2 pr-3">Brand</th>
            <th className="text-right py-2 px-2">Cited in</th>
            <th className="text-right py-2 px-2">Top pick</th>
            <th className="text-right py-2 px-2">Avg pos</th>
            <th className="text-right py-2 pl-2">Sentiment</th>
          </tr>
        </thead>
        <tbody>
          {profiles.slice(0, 15).map((p) => (
            <tr key={p.brand + (p.domain || '')} className={p.isSelf ? 'bg-cyan-500/5' : ''}>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  {p.isSelf && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                      You
                    </span>
                  )}
                  <span className={p.isSelf ? 'text-cyan-200 font-semibold' : 'text-zinc-200'}>
                    {p.brand}
                  </span>
                  {p.domain && (
                    <span className="text-zinc-600 text-xs font-mono">({p.domain})</span>
                  )}
                </div>
              </td>
              <td className="py-2 px-2 text-right text-zinc-300 font-mono">
                {p.citationCount}
              </td>
              <td className="py-2 px-2 text-right">
                {p.topPickCount > 0 ? (
                  <span className="text-emerald-300 font-mono font-semibold">
                    {p.topPickCount}
                  </span>
                ) : (
                  <span className="text-zinc-700 font-mono">—</span>
                )}
              </td>
              <td className="py-2 px-2 text-right font-mono">
                {p.averagePosition !== null ? (
                  <span className="text-zinc-300">#{p.averagePosition.toFixed(1)}</span>
                ) : (
                  <span className="text-zinc-700">—</span>
                )}
              </td>
              <td className="py-2 pl-2 text-right">
                <div className="inline-flex gap-1">
                  {p.recommendedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                      ↑{p.recommendedCount}
                    </span>
                  )}
                  {p.mentionedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-400 font-mono">
                      ·{p.mentionedCount}
                    </span>
                  )}
                  {p.criticizedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 font-mono">
                      ↓{p.criticizedCount}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CitationSourceList({ sources }: { sources: CitationSource[] }) {
  return (
    <div>
      <h3 className="text-zinc-100 font-semibold mb-3">Sources mined</h3>
      <div className="space-y-3">
        {sources.map((src) => {
          const typeColor =
            SOURCE_TYPE_COLORS[src.type] || SOURCE_TYPE_COLORS.other;
          return (
            <div
              key={src.url}
              className="bg-zinc-950/40 border border-zinc-800 rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${typeColor}`}
                    >
                      {SOURCE_TYPE_LABELS[src.type] || src.type}
                    </span>
                    <span className="text-zinc-500 text-xs font-mono">{src.domain}</span>
                  </div>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-100 font-medium text-sm hover:text-cyan-300 line-clamp-2"
                  >
                    {src.title}
                  </a>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    Surfaced from: {src.fromKeywords.slice(0, 3).map((k) => `"${k}"`).join(', ')}
                    {src.fromKeywords.length > 3 && ` +${src.fromKeywords.length - 3}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold text-zinc-100">
                    {src.citations.length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    brands
                  </div>
                </div>
              </div>
              {src.status === 'failed' ? (
                <div className="text-xs text-red-400 italic">
                  Failed to mine: {src.errorMessage || 'unknown error'}
                </div>
              ) : src.citations.length === 0 ? (
                <div className="text-xs text-zinc-500 italic">
                  No brand citations extracted from this source.
                </div>
              ) : (
                <div className="space-y-1.5 border-t border-zinc-900 pt-3">
                  {src.citations.slice(0, 12).map((c, i) => {
                    const recColor =
                      RECOMMENDATION_COLORS[c.recommendation] ||
                      RECOMMENDATION_COLORS.mentioned;
                    return (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="shrink-0 text-[10px] font-mono text-zinc-600 mt-1 w-6 text-right">
                          {c.position !== null ? `#${c.position}` : '·'}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border mt-0.5 ${recColor}`}
                        >
                          {c.recommendation}
                        </span>
                        <span className="text-zinc-200 font-medium shrink-0">{c.brand}</span>
                        {c.quote && (
                          <span className="text-zinc-500 text-xs italic truncate">
                            — {c.quote}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {src.citations.length > 12 && (
                    <div className="text-[11px] text-zinc-600 italic mt-1">
                      +{src.citations.length - 12} more citations
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================
// Recommendations tab (Quick Wins / Strategic Plays)
// =====================================================

function RecsTab({ report }: { report: AuditReport }) {
  const exec = report.executiveSummary;
  return (
    <div className="space-y-6">
      <RecGroup
        title="Quick wins"
        subtitle="Ship in under 30 days"
        accent="emerald"
        items={exec.quickWins}
      />
      <RecGroup
        title="Strategic plays"
        subtitle="1-3 quarter horizon"
        accent="indigo"
        items={exec.strategicPlays}
      />
    </div>
  );
}

function RecGroup({
  title,
  subtitle,
  accent,
  items,
}: {
  title: string;
  subtitle: string;
  accent: 'emerald' | 'indigo';
  items: RecommendationItem[];
}) {
  const accentMap = {
    emerald: {
      border: 'border-l-emerald-500',
      bg: 'bg-emerald-500/[0.04]',
      heading: 'text-emerald-300',
      number: 'text-emerald-400',
    },
    indigo: {
      border: 'border-l-indigo-500',
      bg: 'bg-indigo-500/[0.04]',
      heading: 'text-indigo-300',
      number: 'text-indigo-400',
    },
  } as const;
  const a = accentMap[accent];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className={`font-semibold ${a.heading}`}>{title}</h3>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{subtitle}</span>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="text-zinc-600 italic text-sm">No items.</div>
        ) : (
          items.map((rec, i) => (
            <div
              key={i}
              className={`flex gap-4 ${a.bg} border border-zinc-800 border-l-4 ${a.border} rounded-lg p-4`}
            >
              <span className={`text-2xl font-bold shrink-0 ${a.number}`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-zinc-100 font-semibold mb-1">{rec.action}</div>
                <div className="text-sm text-zinc-400 leading-relaxed">{rec.rationale}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// =====================================================
// Helpers
// =====================================================

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
