// =====================================================
// Stage 0: Brand discovery
// SERP search for brand+location -> Web Unlocker on top result
// -> Claude CLI extraction of brand profile.
// =====================================================

import { searchSerp, unlockUrl, htmlToCleanText } from '../../brightdata';
import { runClaudeJson } from '../../claude-cli';
import { BrandProfileLite, DiscoveredBrand } from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
  failStage,
  setBrand,
  setAuditStatus,
} from '../state';

const STAGE_ID = 0;

export async function runBrandDiscovery(
  auditId: string,
  brandName: string,
  location: string
): Promise<DiscoveredBrand> {
  startStage(auditId, STAGE_ID);

  // Step 1: SERP search for the brand
  const serpSub = addSubTask(auditId, STAGE_ID, `SERP: "${brandName}" in ${location}`, 'SERP');
  let candidateUrl: string;
  try {
    const t0 = Date.now();
    log(auditId, 'BD_CALL', `SERP: "${brandName} ${location}"`, { bdProduct: 'SERP', stage: STAGE_ID });
    const results = await searchSerp(`${brandName} ${location}`, { num: 10 });
    log(auditId, 'BD_DONE', `SERP returned ${results.length} results`, {
      bdProduct: 'SERP',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    const top = pickBrandUrl(results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet })), brandName);
    if (!top) throw new Error('No plausible brand URL in top SERP results');
    candidateUrl = top;
    completeSubTask(auditId, STAGE_ID, serpSub.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, serpSub.id, msg);
    failStage(auditId, STAGE_ID, msg);
    setAuditStatus(auditId, 'failed', msg);
    throw err;
  }

  // Step 2: Unlock the homepage
  const unlockSub = addSubTask(auditId, STAGE_ID, `Read homepage: ${candidateUrl}`, 'UNLOCKER');
  let homepageText: string;
  try {
    const t0 = Date.now();
    log(auditId, 'BD_CALL', `Unlocker: ${candidateUrl}`, { bdProduct: 'UNLOCKER', stage: STAGE_ID });
    const html = await unlockUrl(candidateUrl);
    homepageText = htmlToCleanText(html, 8000);
    log(auditId, 'BD_DONE', `Unlocker: read ${homepageText.length} chars`, {
      bdProduct: 'UNLOCKER',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, unlockSub.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, unlockSub.id, msg);
    failStage(auditId, STAGE_ID, msg);
    setAuditStatus(auditId, 'failed', msg);
    throw err;
  }

  // Step 3: Claude extracts brand profile from homepage text
  const extractSub = addSubTask(auditId, STAGE_ID, 'Extract brand profile', 'CLAUDE');
  let profile: BrandProfileLite;
  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', 'Extracting brand profile from homepage', {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    profile = await extractBrandProfile(brandName, candidateUrl, homepageText);
    log(auditId, 'CLAUDE_DONE', `Profile extracted: "${profile.category}"`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, extractSub.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, extractSub.id, msg);
    failStage(auditId, STAGE_ID, msg);
    setAuditStatus(auditId, 'failed', msg);
    throw err;
  }

  const brand: DiscoveredBrand = {
    url: candidateUrl,
    domain: new URL(candidateUrl).hostname.replace(/^www\./, ''),
    brandProfile: profile,
  };
  setBrand(auditId, brand);
  completeStage(auditId, STAGE_ID);
  setAuditStatus(auditId, 'awaiting_confirmation');
  return brand;
}

/**
 * Pick the most likely brand-owned URL from SERP results.
 * Heuristic: prefer the highest-ranked result whose domain
 * contains the brand name (slugged). Skip aggregator/social/wiki sites.
 */
function pickBrandUrl(
  results: { url: string; title: string; snippet: string }[],
  brandName: string
): string | null {
  if (results.length === 0) return null;
  const slug = brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const blocklist = [
    'wikipedia.org',
    'crunchbase.com',
    'linkedin.com',
    'twitter.com',
    'x.com',
    'facebook.com',
    'instagram.com',
    'youtube.com',
    'reddit.com',
    'g2.com',
    'bloomberg.com',
    'glassdoor.com',
    'indeed.com',
    'capterra.com',
  ];

  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.toLowerCase();
      if (blocklist.some((b) => host.includes(b))) continue;
      const hostSlug = host.replace(/[^a-z0-9]/g, '');
      if (hostSlug.includes(slug)) return r.url;
    } catch {
      // skip malformed URLs
    }
  }
  // Fallback: first non-blocklisted result
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.toLowerCase();
      if (!blocklist.some((b) => host.includes(b))) return r.url;
    } catch {
      // skip
    }
  }
  return results[0].url;
}

async function extractBrandProfile(
  brandName: string,
  url: string,
  homepageText: string
): Promise<BrandProfileLite> {
  const prompt = `You are extracting a structured brand profile from a company's homepage. Be faithful to what the page actually says - do not invent features or claims that are not in the text.

Brand name: ${brandName}
URL: ${url}

Homepage text (cleaned):
"""
${homepageText}
"""

Return ONLY a JSON object with this exact shape, nothing else:
{
  "category": "<short noun phrase, e.g. 'B2B SEO analytics platform'>",
  "valueProp": "<one-sentence value proposition in the company's own words or close paraphrase>",
  "targetSegments": ["<segment 1>", "<segment 2>", ...],
  "keyFeatures": ["<feature 1>", "<feature 2>", ...],
  "pricingModel": "<short description: 'freemium', 'enterprise sales', 'monthly subscription tiers', etc.>"
}`;
  return runClaudeJson<BrandProfileLite>(prompt, { timeoutMs: 60_000 });
}
