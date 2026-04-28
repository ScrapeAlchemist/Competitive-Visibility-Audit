// =====================================================
// Stage 2: SERP rankings + competitor aggregation
// Runs all keywords in parallel via BD SERP. Aggregates domain
// frequencies across keywords, picks top N competitors.
// =====================================================

import { searchSerp } from '../../brightdata';
import {
  COMPETITOR_COUNT,
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

export interface SerpStageOutput {
  serp: SerpResultByKeyword[];
  competitors: CompetitorBrand[];
}

export async function runSerpStage(
  auditId: string,
  keywords: string[],
  brand: DiscoveredBrand,
  countryCode?: string
): Promise<SerpStageOutput> {
  startStage(auditId, STAGE_ID);

  type Out = { keyword: string; items: import('../../types').SerpItem[]; ok: boolean };
  const tasks: Promise<Out>[] = keywords.map(async (keyword): Promise<Out> => {
    const sub = addSubTask(auditId, STAGE_ID, `SERP: "${keyword}"`, 'SERP');
    const t0 = Date.now();
    try {
      log(auditId, 'BD_CALL', `SERP: "${keyword}"`, { bdProduct: 'SERP', stage: STAGE_ID });
      const items = await searchSerp(keyword, {
        num: SERP_RESULTS_PER_KEYWORD,
        country: countryCode,
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
  const competitors = aggregateCompetitors(serp, brand.domain, COMPETITOR_COUNT);

  log(
    auditId,
    'INFO',
    `Aggregated ${competitors.length} top competitors from ${successCount}/${keywords.length} keyword SERPs`,
    { stage: STAGE_ID }
  );

  completeStage(auditId, STAGE_ID, partial);
  return { serp, competitors };
}

/**
 * Aggregate domain appearance frequency across all keyword SERPs.
 * Excludes the brand's own domain. Returns top N by appearance count.
 */
function aggregateCompetitors(
  serp: SerpResultByKeyword[],
  selfDomain: string,
  topN: number
): CompetitorBrand[] {
  const aggregator = new Map<string, CompetitorBrand>();
  const blocklist = [
    'wikipedia.org',
    'youtube.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'instagram.com',
    'reddit.com',
    'quora.com',
    'medium.com',
    'github.com',
  ];

  const isAggregatorOrSocial = (domain: string) => blocklist.some((b) => domain.endsWith(b));

  for (const { keyword, items } of serp) {
    for (const item of items) {
      const domain = item.domain;
      if (!domain) continue;
      if (domain === selfDomain) continue;
      if (isAggregatorOrSocial(domain)) continue;

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
