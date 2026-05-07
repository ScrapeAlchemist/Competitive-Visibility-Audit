// =====================================================
// Visibility metrics — shared between Stage 7 (synthesis prompt)
// and the report UI scorecard. The numeric breakdown here is
// deterministic; the composite 0-100 score is produced by the
// synthesis LLM call so it can weight pillars in context.
// =====================================================

import { AuditReport } from './types';

export interface VisibilityMetrics {
  serpHits: number;        // keywords where the brand ranks in SERP top 10
  serpTotal: number;
  aiHits: number;
  aiQueried: number;
  aiTotal: number;
  citationHits: number;     // third-party sources citing the brand
  citationTopPicks: number; // subset of hits where the brand was the top pick
  citationTotal: number;    // total third-party sources mined
  citationsAvailable: boolean;
}

export function computeVisibilityMetrics(report: AuditReport): VisibilityMetrics {
  const selfDomain = report.brand.domain.toLowerCase();
  const slug = brandSlugFromDomain(report.brand.domain);

  let serpHits = 0;
  for (const s of report.serp) {
    if (s.items.some((i) => i.domain?.toLowerCase() === selfDomain && i.rank <= 10)) {
      serpHits++;
    }
  }
  const serpTotal = report.keywords.length;

  let aiHits = 0;
  let aiQueried = 0;
  for (const m of report.aiMentions) {
    if (m.status !== 'success') continue;
    aiQueried++;
    if (m.brandsMentioned.some((b) => brandMatchesSelf(b.brand, slug))) aiHits++;
  }

  const citations = report.citations;
  const citationTotal = citations?.sources.length ?? 0;
  const citationsAvailable = citationTotal > 0;
  const selfProfile = citations?.profiles.find(
    (p) => p.isSelf || brandMatchesSelf(p.brand, slug)
  );
  const citationHits = selfProfile?.citationCount ?? 0;
  const citationTopPicks = selfProfile?.topPickCount ?? 0;

  return {
    serpHits,
    serpTotal,
    aiHits,
    aiQueried,
    aiTotal: report.aiMentions.length,
    citationHits,
    citationTopPicks,
    citationTotal,
    citationsAvailable,
  };
}

export function brandMatchesSelf(brandName: string, selfSlug: string): boolean {
  const b = brandName.toLowerCase();
  // Guard against trivially-short slugs ("eu" from a subdomain like
  // eu.eastpak.com) that would substring-match unrelated brands. Anything
  // under 4 chars is too generic to use as a positive identifier — fall
  // back to first-word equality only.
  if (!selfSlug || selfSlug.length < 4) {
    if (!selfSlug) return false;
    const firstWord = b.split(/[\s.()/-]+/)[0];
    return firstWord === selfSlug;
  }
  if (b.includes(selfSlug)) return true;
  const firstWord = b.split(/[\s.()/-]+/)[0];
  return firstWord.length >= 3 && selfSlug.includes(firstWord);
}

/**
 * Pull the registrable brand name from a hostname so substring-matching
 * doesn't false-positive on the subdomain ("eu" in `eu.eastpak.com` would
 * match "Deuter" via .includes). Handles common compound TLDs (.co.uk,
 * .com.br) so we don't return "co" or "com" as the brand.
 */
export function brandSlugFromDomain(domain: string): string {
  const host = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const compoundSecond = new Set(['uk', 'jp', 'br', 'au', 'nz', 'za', 'in', 'kr', 'mx', 'il']);
  const compoundFirst = new Set(['co', 'com', 'ne', 'net', 'or', 'org', 'ac', 'gov', 'edu']);
  let last = parts.length - 1;
  if (parts.length >= 3 && compoundSecond.has(parts[last]) && compoundFirst.has(parts[last - 1])) {
    last -= 2;
  } else {
    last -= 1;
  }
  return parts[Math.max(0, last)];
}
