// =====================================================
// Stage 3: Homepage scrape + extract for self + top competitors
// All in parallel: BD Unlocker calls -> Claude CLI extractions.
// Also captures internal links from the homepage HTML so Stage 5
// (deep-scrape) can pick real URLs instead of guessing paths.
//
// This stage also filters off-topic brands. Stage 2 hands us a pool
// of SERP-frequency-ranked candidates (today: 10). For each non-self
// brand, the profile extraction also returns categoryMatch - whether
// this brand competes in the same broad category as the audited one.
// We drop categoryMatch=false brands and keep top maxCompetitors of
// the survivors. Doing the filter here (vs. on SERP titles in Stage 2)
// uses the actual product page content - far more accurate.
// =====================================================

import { unlockUrl, htmlToCleanText, extractInternalLinks, InternalLink } from '../../brightdata';
import { runClaudeJson } from '../../claude';
import {
  BrandProfile,
  CitationCandidate,
  CitationSourceType,
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

const STAGE_ID = 3;

// Source-type labels Stage 4 can mine. "other" and null are dropped
// (other product sites in mismatched categories — not citation sources).
const MINEABLE_SOURCE_TYPES: ReadonlySet<CitationSourceType> = new Set<CitationSourceType>([
  'listicle',
  'review',
  'comparison',
  'forum',
  'news',
  'media',
  'analyst',
]);

interface BrandEntry {
  domain: string;
  url: string;
  isSelf: boolean;
}

interface ExtractedProfile {
  category: string;
  valueProp: string;
  features: string[];
  pricingModel: string;
  targetSegments: string[];
  trustSignals: string[];
  categoryMatch?: boolean; // only set for non-self brands
  sourceType?: CitationSourceType | null; // only set when categoryMatch=false
}

export interface HomepageLinks {
  domain: string;
  rootUrl: string;
  links: InternalLink[];
}

export interface HomepageStageOutput {
  profiles: BrandProfile[];
  homepageLinks: HomepageLinks[];
  competitors: CompetitorBrand[]; // post-filter, capped at maxCompetitors
  citationCandidates: CitationCandidate[]; // off-topic drops Stage 4 can mine
}

export async function runHomepageStage(
  auditId: string,
  brand: DiscoveredBrand,
  competitors: CompetitorBrand[],
  auditedCategory: string,
  maxCompetitors: number
): Promise<HomepageStageOutput> {
  startStage(auditId, STAGE_ID);

  // For competitors, always scrape the root homepage (https://domain/)
  // instead of the SERP-ranked URL. The SERP URL is often a blog post or
  // listicle page (e.g. zapier.com/blog/best-pm-tools) which gets mis-
  // classified as "off-topic - listicle" even though the company itself
  // is a direct competitor. Root homepage gives accurate categorization.
  const targets: BrandEntry[] = [
    { domain: brand.domain, url: brand.url, isSelf: true },
    ...competitors.map((c) => ({ domain: c.domain, url: `https://${c.domain}/`, isSelf: false })),
  ];

  type PerBrandResult = {
    profile: BrandProfile | null;
    links: HomepageLinks | null;
    categoryMatch: boolean; // self always true; competitors based on extraction (false on failure)
    extractedCategory: string; // for the off-topic drop log line
    sourceType: CitationSourceType | null; // populated when categoryMatch=false
    cachedText: string; // Stage 4 reuses this when this candidate is mineable
    title: string;
  };

  // Map domain -> SERP item title from the Stage 2 candidates. Used so
  // off-topic-but-mineable sources hand a real title to Stage 4 instead
  // of the bare domain (Reddit and listicles benefit visibly).
  const titleByDomain = new Map<string, string>();
  for (const c of competitors) {
    const top = c.rankings[0];
    if (top && top.title) titleByDomain.set(c.domain, top.title);
  }

  const tasks: Promise<PerBrandResult>[] = targets.map(async (entry): Promise<PerBrandResult> => {
    const scrapeSub = addSubTask(auditId, STAGE_ID, `Read ${entry.domain}`, 'UNLOCKER');
    let homepageText = '';
    let links: InternalLink[] = [];
    try {
      const t0 = Date.now();
      log(auditId, 'BD_CALL', `Unlocker: ${entry.url}`, { bdProduct: 'UNLOCKER', stage: STAGE_ID });
      const html = await unlockUrl(entry.url);
      homepageText = htmlToCleanText(html, 8000);
      links = extractInternalLinks(html, entry.url, 80);
      log(auditId, 'BD_DONE', `Unlocker: ${entry.domain} (${homepageText.length} chars, ${links.length} internal links)`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
        durationMs: Date.now() - t0,
      });
      completeSubTask(auditId, STAGE_ID, scrapeSub.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSubTask(auditId, STAGE_ID, scrapeSub.id, msg);
      log(auditId, 'BD_FAIL', `Unlocker ${entry.domain} failed: ${msg}`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
      });
      return {
        profile: null,
        links: null,
        categoryMatch: entry.isSelf,
        extractedCategory: '',
        sourceType: null,
        cachedText: '',
        title: titleByDomain.get(entry.domain) || entry.domain,
      };
    }

    const linksOut: HomepageLinks = { domain: entry.domain, rootUrl: entry.url, links };

    const extractSub = addSubTask(auditId, STAGE_ID, `Profile ${entry.domain}`, 'CLAUDE');
    try {
      const t0 = Date.now();
      log(auditId, 'CLAUDE_CALL', `Extracting profile: ${entry.domain}`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
      });
      const ext = await extractProfile(
        entry.domain,
        entry.url,
        homepageText,
        entry.isSelf ? null : auditedCategory
      );
      const matchSuffix = entry.isSelf
        ? ''
        : ext.categoryMatch === true
          ? ' [on-topic]'
          : ` [off-topic - ${ext.sourceType || 'unclassified'}]`;
      log(auditId, 'CLAUDE_DONE', `Profiled ${entry.domain}: "${ext.category}"${matchSuffix}`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
        durationMs: Date.now() - t0,
      });
      completeSubTask(auditId, STAGE_ID, extractSub.id);
      const profile: BrandProfile = {
        domain: entry.domain,
        url: entry.url,
        category: ext.category || '',
        valueProp: ext.valueProp || '',
        features: Array.isArray(ext.features) ? ext.features : [],
        pricingModel: ext.pricingModel || '',
        targetSegments: Array.isArray(ext.targetSegments) ? ext.targetSegments : [],
        trustSignals: Array.isArray(ext.trustSignals) ? ext.trustSignals : [],
        isSelf: entry.isSelf,
      };
      const categoryMatch = entry.isSelf ? true : ext.categoryMatch === true;
      const sourceType = !categoryMatch && ext.sourceType ? ext.sourceType : null;
      return {
        profile,
        links: linksOut,
        categoryMatch,
        extractedCategory: ext.category || '',
        sourceType,
        cachedText: homepageText,
        title: titleByDomain.get(entry.domain) || ext.category || entry.domain,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSubTask(auditId, STAGE_ID, extractSub.id, msg);
      log(auditId, 'CLAUDE_FAIL', `Profile ${entry.domain} failed: ${msg}`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
      });
      // Self always kept on extraction failure (we still want to show the audited brand).
      // Competitors with no extracted profile can't be category-checked, so drop them -
      // we'd just be guessing and they'd show up as empty rows in the report anyway.
      return {
        profile: null,
        links: linksOut,
        categoryMatch: entry.isSelf,
        extractedCategory: '',
        sourceType: null,
        cachedText: homepageText,
        title: titleByDomain.get(entry.domain) || entry.domain,
      };
    }
  });

  const settled = await Promise.all(tasks);
  const selfResult = settled[0]; // first task is always self (built that way above)
  const competitorResults = settled.slice(1);

  // Filter competitors by category match, preserve SERP-frequency order, cap at maxCompetitors.
  const keptCompetitors: CompetitorBrand[] = [];
  const keptCompetitorResults: PerBrandResult[] = [];
  const droppedOffTopic: string[] = [];
  const citationCandidates: CitationCandidate[] = [];
  for (let i = 0; i < competitorResults.length; i++) {
    const r = competitorResults[i];
    if (!r.categoryMatch) {
      if (r.profile) {
        droppedOffTopic.push(`${competitors[i].domain} ("${r.extractedCategory}")`);
        // Mineable off-topic source → forward to Stage 4 with cached homepage text.
        if (r.sourceType && MINEABLE_SOURCE_TYPES.has(r.sourceType) && r.cachedText) {
          citationCandidates.push({
            url: competitors[i].url,
            domain: competitors[i].domain,
            title: r.title,
            sourceType: r.sourceType,
            fromKeywords: competitors[i].rankings.map((rk) => rk.keyword),
            cachedText: r.cachedText,
          });
        }
      }
      continue;
    }
    if (keptCompetitors.length >= maxCompetitors) break;
    keptCompetitors.push(competitors[i]);
    keptCompetitorResults.push(r);
  }

  // Build outputs from self + kept competitors only.
  const allKept = [selfResult, ...keptCompetitorResults];
  const profiles = allKept.map((r) => r.profile).filter((p): p is BrandProfile => p !== null);
  const homepageLinks = allKept.map((r) => r.links).filter((l): l is HomepageLinks => l !== null);

  if (droppedOffTopic.length > 0) {
    log(auditId, 'INFO', `Dropped off-topic candidates: ${droppedOffTopic.join(', ')}`, { stage: STAGE_ID });
  }
  if (citationCandidates.length > 0) {
    log(
      auditId,
      'INFO',
      `Forwarded ${citationCandidates.length} off-topic candidates to Stage 4 as citation sources: ${citationCandidates
        .map((c) => `${c.domain} (${c.sourceType})`)
        .join(', ')}`,
      { stage: STAGE_ID }
    );
  }

  // Partial = real load failures (unlock or extract) on more than half of attempted targets.
  // Off-topic drops are EXPECTED behavior, not failures - don't count them.
  const totalAttempted = targets.length;
  const totalFailed = settled.filter((r) => r.profile === null).length;
  const partial = totalFailed > totalAttempted / 2;

  log(
    auditId,
    'INFO',
    `Built ${profiles.length} profiles (1 self + ${keptCompetitors.length} on-topic competitors); ${droppedOffTopic.length} off-topic dropped, ${totalFailed} unlock/extract failures`,
    { stage: STAGE_ID }
  );
  completeStage(auditId, STAGE_ID, partial);
  return { profiles, homepageLinks, competitors: keptCompetitors, citationCandidates };
}

async function extractProfile(
  domain: string,
  url: string,
  homepageText: string,
  comparisonCategory: string | null
): Promise<ExtractedProfile> {
  const isSelf = comparisonCategory === null;
  const matchSection = isSelf
    ? ''
    : `

ALSO determine whether this domain belongs to the same broad sector as the audited brand.
Audited brand's category: "${comparisonCategory}"

CRITICAL CALIBRATION: SaaS sectors are made up of overlapping sub-segments. Sub-segments within the SAME sector use different surface words but compete for the same buyers. Treat the following groups as ONE sector each - if the audited brand and the candidate are both in the same group, they MATCH:

  Work management:           project management, product development, issue tracking, agile, roadmap, sprint planning, dev workflow, PM software, work tracking, ticketing
  Knowledge & workspace:     knowledge management, wiki, docs, notes, workspace, team collaboration, team messaging, internal communications, content collaboration
  CRM & marketing:           CRM, sales platform, pipeline, marketing automation, customer engagement, sales engagement, customer data platform, email marketing
  Payments & billing:        payments, payment processing, billing, subscription billing, invoicing, financial infrastructure, money transfer, embedded finance, expense management, AP automation
  Security:                  security automation, SOAR, SIEM, IDS/IPS, WAF, EDR, vuln management
  Analytics & BI:            analytics, BI, data visualization, metrics, dashboards
  HR & people ops:           HRIS, payroll, ATS, recruiting, benefits, employee experience
  Design & creative:         design tool, prototyping, whiteboarding, illustration, creative collaboration
  Dev infra / DevOps:        CI/CD, observability, APM, hosting, IaC, monitoring

If the audited and candidate fall in the SAME group above, set categoryMatch=true even if the surface words differ.

Set categoryMatch=false ONLY when the candidate falls into a different group than the audited brand, OR is one of:
- Content / listicle / review / comparison / news / forum / community / education site (not a product company itself).
- A generic agency / consulting / training / certification / professional services site.

When unsure, prefer TRUE. The bar for FALSE is clear cross-sector mismatch, not minor sub-segment differences.

WHEN categoryMatch=false, ALSO classify the site type. Pick the single best label:
- "listicle"   — numbered "best X" / "top N" / roundup articles ranking multiple products
- "review"     — single-product reviews or rating-style content (G2, Capterra style)
- "comparison" — "X vs Y" head-to-head articles
- "forum"      — community discussion threads (reddit, quora, hackernews)
- "news"       — news / press / announcement articles
- "media"      — blog posts, magazine pieces, vendor blog content
- "analyst"    — Gartner, Forrester, IDC content
- "other"      — any other site (e.g. a different SaaS product in a different sector, agency site, etc.)

When categoryMatch=true, set sourceType to null.`;

  const matchField = isSelf ? '' : ',\n  "categoryMatch": <true | false>,\n  "sourceType": <"listicle" | "review" | "comparison" | "forum" | "news" | "media" | "analyst" | "other" | null>';

  const prompt = `Extract a structured competitive profile from this company's homepage. Be faithful to the page - do not invent. If something is not on the page, use an empty string or empty array.${matchSection}

OUTPUT LANGUAGE: write every text field (category, valueProp, features, pricingModel, targetSegments, trustSignals) in English even if the homepage is in another language. Translate the meaning faithfully; do not transliterate. Brand names and proper nouns stay as-is.

Domain: ${domain}
URL: ${url}

Homepage text:
"""
${homepageText}
"""

Return ONLY a JSON object with this exact shape:
{
  "category": "<short noun phrase>",
  "valueProp": "<one-sentence value proposition>",
  "features": ["<feature>", ...],
  "pricingModel": "<short description>",
  "targetSegments": ["<segment>", ...],
  "trustSignals": ["<logo / case study / award / cert>", ...]${matchField}
}`;
  return runClaudeJson<ExtractedProfile>(prompt, { timeoutMs: 60_000 });
}
