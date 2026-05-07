// =====================================================
// Stage 4: Third-party citations
// SERP results that aren't product competitors but DO mention products
// (listicles, "best X" round-ups, Reddit threads, G2 reviews) get
// scraped and mined for brand citations. Each citation = one source
// article naming a brand at a specific rank/position with a quote.
// Aggregated per-brand into a third-party visibility signal that often
// catches what Stage 2/3 misses (Asana, ClickUp, Wrike rarely rank
// directly for "best PM software" — they're inside the listicles).
// =====================================================

import { unlockUrl, htmlToCleanText } from '../../brightdata';
import { runClaudeJson, MODEL_HAIKU } from '../../claude';
import {
  BrandCitation,
  BrandCitationProfile,
  CitationCandidate,
  CitationSource,
  CitationSourceType,
  CitationStageOutput,
  CompetitorBrand,
  DiscoveredBrand,
} from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 4;

// Long enough to capture every ranked entry in a typical 10-item listicle.
// Listicles average 1.5-2.5k chars per entry; 12k catches 6-8 entries
// reliably without overloading Haiku — see CLAUDE_TIMEOUT_MS comment.
const CITATION_TEXT_CAP = 12_000;

// Cap on extracted citations per source to prevent prompt-output bloat.
// Numbered listicles top out at ~15 entries; 25 covers community threads
// where users name many tools without ranking them.
const MAX_CITATIONS_PER_SOURCE = 25;

// Per-source Claude call timeout. 90s covers the long tail — Haiku
// usually responds in 4-8s on a small prompt, but parallel fanout and
// API queuing can push it past 60s on 12k-char listicles.
const CLAUDE_TIMEOUT_MS = 90_000;

// Cap how many sources we mine concurrently. Spawning 20 `claude`
// subprocesses at once saturates local pipes + Anthropic API queues,
// which is exactly what was causing the 60s timeouts. 5 in flight is
// the sweet spot — total Stage 4 wall time is bounded by (sources/5)
// * per-source latency, not by 1 huge parallel burst.
const CITATION_CONCURRENCY = 5;

interface ListicleExtractionResponse {
  citations: {
    name: string;
    domain?: string | null;
    position?: number | null;
    recommendation?: BrandCitation['recommendation'] | string | null;
    quote?: string | null;
  }[];
}

interface ForumExtractionResponse {
  citations: {
    name: string;
    domain?: string | null;
    sentiment?: 'recommended' | 'criticized' | 'neutral mention' | string | null;
    quote?: string | null;
  }[];
}

export async function runCitationsStage(
  auditId: string,
  brand: DiscoveredBrand,
  competitors: CompetitorBrand[],
  candidates: CitationCandidate[]
): Promise<CitationStageOutput> {
  startStage(auditId, STAGE_ID);

  if (candidates.length === 0) {
    log(auditId, 'INFO', 'No citation candidates from SERP/homepage stages — skipping mining.', {
      stage: STAGE_ID,
    });
    completeStage(auditId, STAGE_ID);
    return { sources: [], profiles: [] };
  }

  log(
    auditId,
    'INFO',
    `Mining ${candidates.length} third-party sources (concurrency=${CITATION_CONCURRENCY}, ${describeMix(candidates)})`,
    { stage: STAGE_ID }
  );

  const knownDomains = new Set([brand.domain.toLowerCase(), ...competitors.map((c) => c.domain.toLowerCase())]);

  // Concurrency-limited parallel mining. Each worker pulls the next
  // candidate off a shared cursor until none remain. Caps simultaneous
  // Claude CLI subprocesses to CITATION_CONCURRENCY so we don't trip
  // local pipe / API queueing limits.
  const sources: CitationSource[] = new Array(candidates.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CITATION_CONCURRENCY, candidates.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= candidates.length) return;
      sources[idx] = await mineSource(auditId, candidates[idx], knownDomains);
    }
  });
  await Promise.all(workers);

  const successCount = sources.filter((s) => s.status === 'success').length;
  const totalCitations = sources.reduce((s, src) => s + src.citations.length, 0);

  const profiles = aggregateCitationProfiles(sources, brand, competitors);

  log(
    auditId,
    'INFO',
    `Mined ${totalCitations} brand citations across ${successCount}/${sources.length} sources → ${profiles.length} brands aggregated`,
    { stage: STAGE_ID }
  );

  // Partial = more than half of attempted sources failed entirely.
  // A single bad source is normal (some Reddit threads return JS-only
  // shells, some listicles are paywalled).
  const failedCount = sources.filter((s) => s.status === 'failed').length;
  const partial = sources.length > 0 && failedCount > sources.length / 2;
  completeStage(auditId, STAGE_ID, partial);

  return { sources, profiles };
}

async function mineSource(
  auditId: string,
  candidate: CitationCandidate,
  knownDomains: Set<string>
): Promise<CitationSource> {
  const baseSource: CitationSource = {
    url: candidate.url,
    domain: candidate.domain,
    title: candidate.title || candidate.domain,
    type: candidate.sourceType,
    fromKeywords: candidate.fromKeywords,
    citations: [],
    status: 'failed',
  };

  // Step 1: get article text. Reuse Stage 3's cached text when present
  // (avoids a redundant BD Unlocker call); otherwise fetch fresh.
  let text = candidate.cachedText || '';
  if (!text) {
    const fetchSub = addSubTask(auditId, STAGE_ID, `Fetch ${candidate.domain}`, 'UNLOCKER');
    try {
      const t0 = Date.now();
      log(auditId, 'BD_CALL', `Unlocker (citation): ${candidate.url}`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
      });
      const html = await unlockUrl(candidate.url);
      text = htmlToCleanText(html, CITATION_TEXT_CAP);
      log(auditId, 'BD_DONE', `Unlocker: ${candidate.domain} (${text.length} chars)`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
        durationMs: Date.now() - t0,
      });
      completeSubTask(auditId, STAGE_ID, fetchSub.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSubTask(auditId, STAGE_ID, fetchSub.id, msg);
      log(auditId, 'BD_FAIL', `Unlocker (citation) ${candidate.domain} failed: ${msg}`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
      });
      return { ...baseSource, errorMessage: msg };
    }
  } else {
    // Cached text from Stage 3 was capped at 8000 chars. That's enough
    // for the top of most listicles; not worth a re-fetch in v1.
    log(auditId, 'INFO', `Reusing Stage 3 cache for ${candidate.domain} (${text.length} chars)`, {
      stage: STAGE_ID,
    });
  }

  if (text.length < 400) {
    return { ...baseSource, errorMessage: `Article body too short (${text.length} chars)` };
  }

  // Step 2: Claude extracts brand citations from the article body.
  const extractSub = addSubTask(
    auditId,
    STAGE_ID,
    `Mine ${candidate.domain}`,
    'CLAUDE'
  );
  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', `Mining citations from ${candidate.domain} (${candidate.sourceType})`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    const citations = await extractCitations(candidate, text, knownDomains);
    log(auditId, 'CLAUDE_DONE', `${candidate.domain}: ${citations.length} brand citations`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, extractSub.id);

    return {
      ...baseSource,
      citations,
      status: citations.length > 0 ? 'success' : 'partial',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, extractSub.id, msg);
    log(auditId, 'CLAUDE_FAIL', `Citation mining ${candidate.domain} failed: ${msg}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    return { ...baseSource, errorMessage: msg };
  }
}

async function extractCitations(
  candidate: CitationCandidate,
  text: string,
  knownDomains: Set<string>
): Promise<BrandCitation[]> {
  const truncated = text.slice(0, CITATION_TEXT_CAP);
  const knownList = Array.from(knownDomains).slice(0, 12).join(', ');

  // Forum / Q&A → discussion shape (sentiment, mentions).
  // Everything else → ranked-list shape (position, recommendation).
  if (candidate.sourceType === 'forum') {
    const prompt = `This is a community discussion thread or Q&A. Extract every product, tool, or brand that users mention or discuss in the post + comments. Focus on real product names, not generic terms.

Source URL: ${candidate.url}
Title: ${candidate.title}

Brands likely relevant to this thread (mark these too if they appear, but include any other named products you spot): ${knownList}

Article text:
"""
${truncated}
"""

For each product/brand mentioned, return:
- name: the product/brand name as written
- domain: the vendor's domain if linked or mentioned, otherwise null
- sentiment: "recommended" | "criticized" | "neutral mention"
- quote: ONE short verbatim phrase showing how it's discussed (under 12 words, in quotation marks where the original used them, otherwise plain text)

Return ONLY a JSON object with this exact shape:
{
  "citations": [
    {"name": "...", "domain": "...", "sentiment": "...", "quote": "..."}
  ]
}

If no real product brands are mentioned, return {"citations": []}.`;
    const result = await runClaudeJson<ForumExtractionResponse>(prompt, {
      timeoutMs: CLAUDE_TIMEOUT_MS,
      model: MODEL_HAIKU,
    });
    return normalizeForumCitations(result);
  }

  // Listicle / review / comparison / news / media / analyst → ranked-list shape.
  const prompt = `This article is a ranking, recommendation list, or product writeup. Extract every product, tool, or brand it ranks, recommends, or features. Walk the article in reading order so you preserve any numbered ranking.

Source URL: ${candidate.url}
Title: ${candidate.title}
Source type: ${candidate.sourceType}

Brands likely relevant to this article (mark these too if they appear, but include any other named products you spot): ${knownList}

Article text:
"""
${truncated}
"""

For each product/brand, return:
- name: the product/brand name as written
- domain: the vendor's domain if linked or mentioned, otherwise null
- position: integer rank if the article numbers them (1, 2, 3...), otherwise null
- recommendation: one of "top pick" | "recommended" | "mentioned" | "criticized"
  - "top pick"     → the article calls this #1, "best overall", or strongly endorses it as the winner
  - "recommended"  → article speaks well of it but it isn't the top pick
  - "mentioned"    → named without strong stance (alternative, honorable mention, "also worth a look")
  - "criticized"   → article speaks negatively, lists drawbacks as primary frame
- quote: ONE short verbatim phrase the article uses about this brand (under 12 words, in quotation marks where the original used them, otherwise plain text)

Return ONLY a JSON object with this exact shape:
{
  "citations": [
    {"name": "...", "domain": "...", "position": 1, "recommendation": "top pick", "quote": "..."}
  ]
}

If no real product brands are featured, return {"citations": []}.`;

  const result = await runClaudeJson<ListicleExtractionResponse>(prompt, {
    timeoutMs: CLAUDE_TIMEOUT_MS,
    model: MODEL_HAIKU,
  });
  return normalizeListicleCitations(result);
}

function normalizeListicleCitations(result: ListicleExtractionResponse): BrandCitation[] {
  if (!result || !Array.isArray(result.citations)) return [];
  const out: BrandCitation[] = [];
  for (const c of result.citations.slice(0, MAX_CITATIONS_PER_SOURCE)) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) continue;
    const recommendation: BrandCitation['recommendation'] =
      c.recommendation === 'top pick' ||
      c.recommendation === 'recommended' ||
      c.recommendation === 'mentioned' ||
      c.recommendation === 'criticized'
        ? c.recommendation
        : 'mentioned';
    out.push({
      brand: c.name.trim(),
      domain: typeof c.domain === 'string' && c.domain.trim() ? c.domain.trim().toLowerCase() : undefined,
      position: typeof c.position === 'number' && Number.isFinite(c.position) ? c.position : null,
      recommendation,
      quote: clipQuote(c.quote),
    });
  }
  return out;
}

function normalizeForumCitations(result: ForumExtractionResponse): BrandCitation[] {
  if (!result || !Array.isArray(result.citations)) return [];
  const out: BrandCitation[] = [];
  for (const c of result.citations.slice(0, MAX_CITATIONS_PER_SOURCE)) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) continue;
    let recommendation: BrandCitation['recommendation'];
    if (c.sentiment === 'recommended') recommendation = 'recommended';
    else if (c.sentiment === 'criticized') recommendation = 'criticized';
    else recommendation = 'mentioned';
    out.push({
      brand: c.name.trim(),
      domain: typeof c.domain === 'string' && c.domain.trim() ? c.domain.trim().toLowerCase() : undefined,
      position: null,
      recommendation,
      quote: clipQuote(c.quote),
    });
  }
  return out;
}

function clipQuote(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Hard-cap at 14 words to stay safely inside the copyright guidance and keep UI tidy.
  const words = raw.trim().split(/\s+/);
  return words.slice(0, 14).join(' ');
}

/**
 * Roll up brand-level visibility across all mined sources.
 * Brand identity is keyed by a normalized name slug — same brand
 * spelled differently across articles ("Asana" vs "asana.com") merges.
 */
function aggregateCitationProfiles(
  sources: CitationSource[],
  brand: DiscoveredBrand,
  competitors: CompetitorBrand[]
): BrandCitationProfile[] {
  const selfSlug = nameSlug(brand.domain);
  const profiles = new Map<string, BrandCitationProfile>();

  for (const src of sources) {
    for (const cit of src.citations) {
      const slug = nameSlug(cit.brand) || nameSlug(cit.domain || '');
      if (!slug) continue;
      let p = profiles.get(slug);
      if (!p) {
        p = {
          brand: cit.brand,
          domain: cit.domain,
          citationCount: 0,
          topPickCount: 0,
          averagePosition: null,
          recommendedCount: 0,
          criticizedCount: 0,
          mentionedCount: 0,
          sources: [],
          isSelf: slug === selfSlug,
        };
        profiles.set(slug, p);
      }
      // Promote a real domain over an empty one if a later citation has it.
      if (!p.domain && cit.domain) p.domain = cit.domain;

      p.citationCount += 1;
      if (cit.recommendation === 'top pick') p.topPickCount += 1;
      if (cit.recommendation === 'recommended' || cit.recommendation === 'top pick') p.recommendedCount += 1;
      else if (cit.recommendation === 'criticized') p.criticizedCount += 1;
      else p.mentionedCount += 1;

      p.sources.push({
        url: src.url,
        sourceTitle: src.title,
        sourceDomain: src.domain,
        position: cit.position,
        quote: cit.quote,
        recommendation: cit.recommendation,
      });
    }
  }

  // Compute averagePosition from the rank-bearing sources only.
  for (const p of profiles.values()) {
    const ranked = p.sources.filter((s) => typeof s.position === 'number') as { position: number }[];
    if (ranked.length > 0) {
      p.averagePosition = ranked.reduce((s, r) => s + r.position, 0) / ranked.length;
    }
  }

  // If self has zero citations, surface it anyway so the report always
  // shows the audited brand's third-party row (even at 0). Pulls the
  // brand name from the discovered profile category as a label.
  if (![...profiles.values()].some((p) => p.isSelf)) {
    profiles.set(`__self__${selfSlug}`, {
      brand: brand.domain,
      domain: brand.domain,
      citationCount: 0,
      topPickCount: 0,
      averagePosition: null,
      recommendedCount: 0,
      criticizedCount: 0,
      mentionedCount: 0,
      sources: [],
      isSelf: true,
    });
  }

  // Try to align competitor domains to citation profiles where the
  // brand name slug matches the competitor domain slug. This means
  // "Asana" cited in a listicle aligns with asana.com (a competitor)
  // even when the listicle didn't link to the domain.
  for (const c of competitors) {
    const domainSlug = nameSlug(c.domain);
    for (const p of profiles.values()) {
      if (!p.domain && nameSlug(p.brand) === domainSlug) p.domain = c.domain;
    }
  }

  return Array.from(profiles.values()).sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1;
    if (!a.isSelf && b.isSelf) return 1;
    if (b.citationCount !== a.citationCount) return b.citationCount - a.citationCount;
    if (b.topPickCount !== a.topPickCount) return b.topPickCount - a.topPickCount;
    const aPos = a.averagePosition ?? 999;
    const bPos = b.averagePosition ?? 999;
    return aPos - bPos;
  });
}

function nameSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|app|ai|gg)$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function describeMix(candidates: CitationCandidate[]): string {
  const counts = candidates.reduce<Record<CitationSourceType, number>>(
    (acc, c) => {
      acc[c.sourceType] = (acc[c.sourceType] || 0) + 1;
      return acc;
    },
    { listicle: 0, review: 0, comparison: 0, forum: 0, news: 0, media: 0, analyst: 0, other: 0 }
  );
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${t}`)
    .join(', ');
}
