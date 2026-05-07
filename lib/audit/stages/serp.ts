// =====================================================
// Stage 2: SERP rankings + competitor aggregation
// Runs all keywords in parallel via BD SERP, then aggregates domain
// frequency across keywords. Hard blocklist drops social/aggregators
// from the COMPETITOR list, but we now also track those same hosts
// as CITATION CANDIDATES (Reddit threads, listicle round-ups on
// Medium/Quora, G2/Capterra reviews) — Stage 4 mines them for
// brand mentions instead of throwing them away.
// The "is this an actual competitor?" judgment is deferred to Stage 3,
// which has the full homepage text to compare categories against -
// way more accurate than guessing from 3 SERP titles.
// =====================================================

import { searchSerp } from '../../brightdata';
import {
  CitationCandidate,
  CitationSourceType,
  CompetitorBrand,
  DiscoveredBrand,
  SerpResultByKeyword,
  SERP_RESULTS_PER_KEYWORD,
} from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 2;
// We pass this many top-frequency candidates to Stage 3, which uses
// full homepage content to drop off-topic brands and trims to
// COMPETITOR_COUNT. Cushion absorbs unlock failures + off-topic drops -
// SERPs heavy in listicles (e.g. "best knowledge management tools")
// can lose 6-8 candidates to filter, so we want enough product survivors.
const SERP_CANDIDATE_COUNT = 15;

// Cap citation candidates so Stage 4 stays within a reasonable
// parallel-fetch budget. SERPs over 8 keywords routinely surface
// reddit.com 6-8 times; without a cap we'd queue up dozens of
// duplicate-host fetches.
const CITATION_CANDIDATE_CAP = 12;

// Hosts that are inherently citation sources, mapped to source type.
// Endsuffix matching, so subdomains (old.reddit.com, en.wikipedia.org)
// work too.
const CITATION_HOSTS: { suffix: string; type: CitationSourceType }[] = [
  // Forums / Q&A — discussion of brands by users
  { suffix: 'reddit.com', type: 'forum' },
  { suffix: 'quora.com', type: 'forum' },
  // Long-form media that frequently runs "best X" listicles
  { suffix: 'medium.com', type: 'media' },
  // Reference / encyclopedic
  { suffix: 'wikipedia.org', type: 'media' },
  // Software review aggregators — rich brand citations
  { suffix: 'g2.com', type: 'review' },
  { suffix: 'capterra.com', type: 'review' },
  { suffix: 'softwareadvice.com', type: 'review' },
  { suffix: 'getapp.com', type: 'review' },
  { suffix: 'trustpilot.com', type: 'review' },
  { suffix: 'trustradius.com', type: 'review' },
  { suffix: 'peerspot.com', type: 'review' },
  // Analysts
  { suffix: 'gartner.com', type: 'analyst' },
  { suffix: 'forrester.com', type: 'analyst' },
];

// Hosts that are aggregators we don't want as competitors AND don't
// want to mine for citations either (no useful brand-ranking content).
const SKIP_HOSTS = [
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'instagram.com',
  'github.com',
  'tiktok.com',
];

export interface SerpStageOutput {
  serp: SerpResultByKeyword[];
  competitors: CompetitorBrand[];
  citationCandidates: CitationCandidate[];
}

export async function runSerpStage(
  auditId: string,
  keywords: string[],
  brand: DiscoveredBrand,
  country: string,
  language: string
): Promise<SerpStageOutput> {
  startStage(auditId, STAGE_ID);
  log(
    auditId,
    'INFO',
    `SERP localization: gl=${country} hl=${language} (top ${SERP_RESULTS_PER_KEYWORD} per keyword)`,
    { stage: STAGE_ID }
  );

  type Out = { keyword: string; items: import('../../types').SerpItem[]; ok: boolean };
  const tasks: Promise<Out>[] = keywords.map(async (keyword): Promise<Out> => {
    const sub = addSubTask(auditId, STAGE_ID, `SERP: "${keyword}"`, 'SERP');
    const t0 = Date.now();
    try {
      log(auditId, 'BD_CALL', `SERP: "${keyword}" gl=${country} hl=${language}`, {
        bdProduct: 'SERP',
        stage: STAGE_ID,
      });
      const items = await searchSerp(keyword, {
        num: SERP_RESULTS_PER_KEYWORD,
        country,
        language,
      });
      log(auditId, 'BD_DONE', `SERP "${keyword}" returned ${items.length} results`, {
        bdProduct: 'SERP',
        stage: STAGE_ID,
        durationMs: Date.now() - t0,
      });
      completeSubTask(auditId, STAGE_ID, sub.id);
      return { keyword, items, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSubTask(auditId, STAGE_ID, sub.id, msg);
      log(auditId, 'BD_FAIL', `SERP "${keyword}" failed: ${msg}`, { bdProduct: 'SERP', stage: STAGE_ID });
      return { keyword, items: [], ok: false };
    }
  });

  const results = await Promise.all(tasks);
  const successCount = results.filter((r) => r.ok).length;
  const partial = successCount < keywords.length;

  const serp: SerpResultByKeyword[] = results.map(({ keyword, items }) => ({ keyword, items }));
  const competitors = aggregateCompetitors(serp, brand.domain, SERP_CANDIDATE_COUNT);
  const citationCandidates = aggregateCitationCandidates(serp, brand.domain, CITATION_CANDIDATE_CAP);

  log(
    auditId,
    'INFO',
    `Aggregated ${competitors.length} candidate competitors by SERP frequency from ${successCount}/${keywords.length} keywords (Stage 3 will filter off-topic brands using homepage content)`,
    { stage: STAGE_ID }
  );
  if (citationCandidates.length > 0) {
    const byType = citationCandidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.sourceType] = (acc[c.sourceType] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byType)
      .map(([t, n]) => `${n} ${t}`)
      .join(', ');
    log(
      auditId,
      'INFO',
      `Captured ${citationCandidates.length} citation candidates from social/forum/review hosts (${breakdown}) → Stage 4 will mine them`,
      { stage: STAGE_ID }
    );
  }

  completeStage(auditId, STAGE_ID, partial);
  return { serp, competitors, citationCandidates };
}

/**
 * Aggregate domain appearance frequency across all keyword SERPs.
 * Excludes the brand's own domain and a hard blocklist of sites that
 * cannot possibly be a product competitor (social, encyclopedias,
 * pure software-review aggregators). Returns top N by frequency.
 */
function aggregateCompetitors(
  serp: SerpResultByKeyword[],
  selfDomain: string,
  topN: number
): CompetitorBrand[] {
  const aggregator = new Map<string, CompetitorBrand>();
  // Citation hosts and skip hosts both excluded from competitors —
  // citation hosts go to Stage 4, skip hosts are dropped entirely.
  const excluded = (domain: string): boolean => {
    if (SKIP_HOSTS.some((s) => domain.endsWith(s))) return true;
    if (CITATION_HOSTS.some(({ suffix }) => domain.endsWith(suffix))) return true;
    return false;
  };

  for (const { keyword, items } of serp) {
    for (const item of items) {
      const domain = item.domain;
      if (!domain) continue;
      if (domain === selfDomain) continue;
      if (excluded(domain)) continue;

      let entry = aggregator.get(domain);
      if (!entry) {
        entry = {
          domain,
          url: item.url,
          appearanceCount: 0,
          rankings: [],
        };
        aggregator.set(domain, entry);
      }
      entry.appearanceCount += 1;
      entry.rankings.push({ keyword, rank: item.rank, title: item.title });
    }
  }

  return Array.from(aggregator.values())
    .sort((a, b) => {
      if (b.appearanceCount !== a.appearanceCount) return b.appearanceCount - a.appearanceCount;
      // Tiebreak: best (lowest) average rank
      const avgA = a.rankings.reduce((s, r) => s + r.rank, 0) / a.rankings.length;
      const avgB = b.rankings.reduce((s, r) => s + r.rank, 0) / b.rankings.length;
      return avgA - avgB;
    })
    .slice(0, topN);
}

/**
 * Aggregate citation candidates from the SERP. For Reddit / Quora /
 * Medium / Wikipedia / G2 / Capterra / etc the URL is what we mine,
 * not the domain — the same Reddit thread on multiple keywords is
 * one candidate, but two different Reddit threads count as two.
 * Cap to avoid blowing out the parallel-fetch budget in Stage 4.
 */
function aggregateCitationCandidates(
  serp: SerpResultByKeyword[],
  selfDomain: string,
  cap: number
): CitationCandidate[] {
  const byUrl = new Map<string, { c: CitationCandidate; bestRank: number }>();

  for (const { keyword, items } of serp) {
    for (const item of items) {
      const domain = item.domain;
      if (!domain) continue;
      if (domain === selfDomain) continue;
      const match = CITATION_HOSTS.find(({ suffix }) => domain.endsWith(suffix));
      if (!match) continue;

      const existing = byUrl.get(item.url);
      if (existing) {
        if (!existing.c.fromKeywords.includes(keyword)) existing.c.fromKeywords.push(keyword);
        if (item.rank < existing.bestRank) existing.bestRank = item.rank;
      } else {
        byUrl.set(item.url, {
          c: {
            url: item.url,
            domain,
            title: item.title,
            sourceType: match.type,
            fromKeywords: [keyword],
          },
          bestRank: item.rank,
        });
      }
    }
  }

  // Sort by best rank across appearances, then by appearance count.
  // The most-cited surfaces first.
  return Array.from(byUrl.values())
    .sort((a, b) => {
      if (b.c.fromKeywords.length !== a.c.fromKeywords.length) {
        return b.c.fromKeywords.length - a.c.fromKeywords.length;
      }
      return a.bestRank - b.bestRank;
    })
    .slice(0, cap)
    .map((x) => x.c);
}
