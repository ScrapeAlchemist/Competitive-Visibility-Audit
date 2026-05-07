// =====================================================
// Stage 6: Deep page scrape
// For each brand, give Claude the real list of internal links pulled
// from the homepage in Stage 3 and let Claude pick the best URLs for
// pricing / about / features. Then unlock + summarize each.
// This replaces the old approach of guessing /pricing /about etc paths
// which 404'd often.
// =====================================================

import { unlockUrl, htmlToCleanText, InternalLink } from '../../brightdata';
import { runClaudeJson, MODEL_HAIKU } from '../../claude';
import { DeepPageInsight, DeepPageType } from '../../types';
import { HomepageLinks } from './homepage';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 6;
const PAGE_TYPES: DeepPageType[] = ['pricing', 'about', 'features'];

interface PickResult {
  pricing: string | null;
  about: string | null;
  features: string | null;
}

interface SummaryResponse {
  summary: string;
}

export async function runDeepScrapeStage(
  auditId: string,
  homepageLinks: HomepageLinks[]
): Promise<DeepPageInsight[]> {
  startStage(auditId, STAGE_ID);

  let totalAttempted = 0;
  let totalFailed = 0;

  const brandTasks = homepageLinks.map(async (hl) => {
    const result = await processBrand(auditId, hl);
    totalAttempted += result.attempted;
    totalFailed += result.failed;
    return result.insights;
  });

  const settled = await Promise.all(brandTasks);
  const insights = settled.flat();

  log(
    auditId,
    'INFO',
    `Captured ${insights.length}/${totalAttempted} deep pages across ${homepageLinks.length} brands`,
    { stage: STAGE_ID }
  );
  // Some pages are flat-blocked by the proxy (e.g. atlassian.com/jira/pricing returns
  // <200 chars on policy block) - that's expected and should not mark the whole stage
  // partial. Only flag partial if MORE THAN HALF of the attempts produced no insight.
  const partial = totalAttempted > 0 && totalFailed > totalAttempted / 2;
  completeStage(auditId, STAGE_ID, partial);
  return insights;
}

async function processBrand(
  auditId: string,
  hl: HomepageLinks
): Promise<{ insights: DeepPageInsight[]; attempted: number; failed: number }> {
  const { domain, links } = hl;

  // No links -> skip this brand entirely. Honest empty result.
  if (links.length === 0) {
    log(auditId, 'WARN', `${domain}: no internal links captured from homepage; skipping deep scrape`, {
      stage: STAGE_ID,
    });
    return { insights: [], attempted: 0, failed: 0 };
  }

  // Step 1: Claude picks the best URL per page type from the real link list
  const pickSub = addSubTask(auditId, STAGE_ID, `Pick pages for ${domain}`, 'CLAUDE');
  let picks: PickResult;
  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', `Selecting deep-page URLs for ${domain} from ${links.length} links`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    picks = await pickBestUrls(domain, links);
    const summary = PAGE_TYPES.map((t) => `${t}=${picks[t] ? '✓' : '–'}`).join(' ');
    log(auditId, 'CLAUDE_DONE', `Picked pages for ${domain}: ${summary}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, pickSub.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, pickSub.id, msg);
    log(auditId, 'CLAUDE_FAIL', `Page-pick for ${domain} failed: ${msg}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    return { insights: [], attempted: 0, failed: 1 };
  }

  // Step 2: For each non-null pick, unlock + summarize in parallel
  const pageTasks = PAGE_TYPES.flatMap((type) => {
    const url = picks[type];
    if (!url) return [];
    return [scrapeAndSummarize(auditId, domain, type, url)];
  });
  const attempted = pageTasks.length;
  if (attempted === 0) {
    return { insights: [], attempted: 0, failed: 0 };
  }
  const results = await Promise.all(pageTasks);
  const insights = results.filter((r): r is DeepPageInsight => r !== null);
  const failed = attempted - insights.length;
  return { insights, attempted, failed };
}

async function scrapeAndSummarize(
  auditId: string,
  domain: string,
  type: DeepPageType,
  url: string
): Promise<DeepPageInsight | null> {
  const shortLabel = pathLabel(url) || type;
  const scrapeSub = addSubTask(auditId, STAGE_ID, `${domain}${shortLabel}`, 'UNLOCKER');
  let pageText = '';
  try {
    const t0 = Date.now();
    log(auditId, 'BD_CALL', `Unlocker: ${url}`, { bdProduct: 'UNLOCKER', stage: STAGE_ID });
    const html = await unlockUrl(url, { timeoutMs: 25_000 });
    pageText = htmlToCleanText(html, 6000);
    if (pageText.length < 400) {
      failSubTask(auditId, STAGE_ID, scrapeSub.id, `Page returned only ${pageText.length} chars`);
      log(auditId, 'WARN', `Unlocker: ${url} returned minimal content (${pageText.length} chars)`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
      });
      return null;
    }
    log(auditId, 'BD_DONE', `Unlocker: ${url} (${pageText.length} chars)`, {
      bdProduct: 'UNLOCKER',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, scrapeSub.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, scrapeSub.id, msg);
    log(auditId, 'BD_FAIL', `Unlocker ${url} failed: ${msg}`, { bdProduct: 'UNLOCKER', stage: STAGE_ID });
    return null;
  }

  const summarizeSub = addSubTask(auditId, STAGE_ID, `Summarize ${domain}${shortLabel}`, 'CLAUDE');
  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', `Summarize ${domain} ${type}`, { bdProduct: 'CLAUDE', stage: STAGE_ID });
    const summary = await summarizePage(domain, type, pageText);
    log(auditId, 'CLAUDE_DONE', `Summarized ${domain} ${type}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, summarizeSub.id);
    return { domain, pageType: type, url, summary: summary.summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, summarizeSub.id, msg);
    log(auditId, 'CLAUDE_FAIL', `Summarize ${domain}/${type} failed: ${msg}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    return null;
  }
}

async function pickBestUrls(domain: string, links: InternalLink[]): Promise<PickResult> {
  // Cap to 60 to keep prompt size sane; homepages with huge nav menus get truncated
  const linkList = links
    .slice(0, 60)
    .map((l) => `- ${l.url} | ${l.text || '(no anchor text)'}`)
    .join('\n');

  const prompt = `Given this list of internal URLs scraped from ${domain}'s homepage, identify the single best URL for each of these page types. Pick the one most likely to be the canonical page for that type. If no link in the list is a good match for a category, return null for that category. Do not invent URLs - only choose URLs that appear in the list below.

Categories:
- pricing: pricing tiers, plans, packages, costs ("how much does it cost")
- about: company info, team, mission, story, leadership
- features: product capabilities, what the product does, use cases, how it works

URLs from ${domain}'s homepage (anchor text after the | for context):
${linkList}

Return ONLY a JSON object with this exact shape. Use null when no good match exists:
{
  "pricing": "<exact URL from list or null>",
  "about": "<exact URL from list or null>",
  "features": "<exact URL from list or null>"
}`;

  const result = await runClaudeJson<Partial<PickResult>>(prompt, {
    timeoutMs: 60_000,
    model: MODEL_HAIKU,
  });

  // Validate that Claude only returned URLs from the actual list (no hallucinations)
  const validUrls = new Set(links.map((l) => l.url));
  const sanitize = (val: unknown): string | null => {
    if (typeof val !== 'string') return null;
    return validUrls.has(val) ? val : null;
  };
  return {
    pricing: sanitize(result.pricing),
    about: sanitize(result.about),
    features: sanitize(result.features),
  };
}

async function summarizePage(domain: string, type: DeepPageType, text: string): Promise<SummaryResponse> {
  const focus = {
    pricing: 'pricing tiers, what differentiates them, and any free / trial / enterprise mentions',
    about: 'positioning, founding story or year, team or HQ, key customers or markets',
    features: 'top product capabilities and what target user each addresses',
  }[type];
  const prompt = `Summarize the most decision-useful information from this competitor page. Focus on: ${focus}. Be concrete and short - 3 to 5 bullet-style sentences max. Do not invent details.

OUTPUT LANGUAGE: write the summary in English even if the page is in another language. Brand names, product names, and pricing tier names stay as-is.

Domain: ${domain}
Page type: ${type}

Page text:
"""
${text}
"""

Return ONLY a JSON object with this exact shape:
{
  "summary": "<concise summary, 3-5 sentences>"
}`;
  return runClaudeJson<SummaryResponse>(prompt, { timeoutMs: 60_000 });
}

function pathLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return path.length > 30 ? path.slice(0, 29) + '…' : path;
  } catch {
    return '';
  }
}
