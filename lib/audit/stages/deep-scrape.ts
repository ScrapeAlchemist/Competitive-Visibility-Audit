// =====================================================
// Stage 5: Deep page scrape
// For each competitor, try /pricing, /about, /features in parallel.
// Up to ~15 concurrent BD Unlocker calls.
// =====================================================

import { unlockUrl, htmlToCleanText } from '../../brightdata';
import { runClaudeJson } from '../../claude-cli';
import { CompetitorBrand, DeepPageInsight, DeepPageType, DiscoveredBrand } from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 5;
const PAGE_PATHS: { type: DeepPageType; paths: string[] }[] = [
  { type: 'pricing', paths: ['/pricing', '/plans', '/price', '/cp/pricing', '/products/pricing', '/buy', '/checkout/plans'] },
  { type: 'about', paths: ['/about', '/about-us', '/company', '/about-company', '/who-we-are', '/our-story'] },
  { type: 'features', paths: ['/features', '/product', '/platform', '/products', '/solutions', '/use-cases', '/capabilities'] },
];

interface SummaryResponse {
  summary: string;
}

export async function runDeepScrapeStage(
  auditId: string,
  brand: DiscoveredBrand,
  competitors: CompetitorBrand[]
): Promise<DeepPageInsight[]> {
  startStage(auditId, STAGE_ID);

  const targets = [brand, ...competitors.map((c) => ({ domain: c.domain, url: c.url }))];

  const tasks: Promise<DeepPageInsight | null>[] = [];
  for (const target of targets) {
    for (const { type, paths } of PAGE_PATHS) {
      tasks.push(scrapeOneDeepPage(auditId, target.domain, target.url, type, paths));
    }
  }

  const settled = await Promise.all(tasks);
  const insights = settled.filter((i): i is DeepPageInsight => i !== null);
  const partial = insights.length < tasks.length;

  log(
    auditId,
    'INFO',
    `Captured ${insights.length}/${tasks.length} deep pages across ${targets.length} brands`,
    { stage: STAGE_ID }
  );
  completeStage(auditId, STAGE_ID, partial);
  return insights;
}

async function scrapeOneDeepPage(
  auditId: string,
  domain: string,
  rootUrl: string,
  type: DeepPageType,
  candidatePaths: string[]
): Promise<DeepPageInsight | null> {
  const sub = addSubTask(auditId, STAGE_ID, `${domain}/${type}`, 'UNLOCKER');

  let scrapedUrl = '';
  let scrapedText = '';
  // Try each candidate path until one returns non-trivial content.
  for (const path of candidatePaths) {
    let baseHost: string;
    try {
      baseHost = new URL(rootUrl).origin;
    } catch {
      failSubTask(auditId, STAGE_ID, sub.id, `Invalid root URL: ${rootUrl}`);
      return null;
    }
    const tryUrl = `${baseHost}${path}`;
    try {
      const t0 = Date.now();
      log(auditId, 'BD_CALL', `Unlocker: ${tryUrl}`, { bdProduct: 'UNLOCKER', stage: STAGE_ID });
      const html = await unlockUrl(tryUrl, { timeoutMs: 25_000 });
      const text = htmlToCleanText(html, 6000);
      if (text.length > 400) {
        scrapedUrl = tryUrl;
        scrapedText = text;
        log(auditId, 'BD_DONE', `Unlocker: ${tryUrl} (${text.length} chars)`, {
          bdProduct: 'UNLOCKER',
          stage: STAGE_ID,
          durationMs: Date.now() - t0,
        });
        break;
      }
      log(auditId, 'WARN', `Unlocker: ${tryUrl} returned minimal content, trying next path`, {
        bdProduct: 'UNLOCKER',
        stage: STAGE_ID,
      });
    } catch {
      // try next path
    }
  }

  if (!scrapedText) {
    failSubTask(auditId, STAGE_ID, sub.id, `No accessible /${type} page`);
    return null;
  }
  completeSubTask(auditId, STAGE_ID, sub.id);

  const summarizeSub = addSubTask(auditId, STAGE_ID, `Summarize ${domain}/${type}`, 'CLAUDE');
  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', `Summarize ${domain} ${type}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    const summary = await summarizePage(domain, type, scrapedText);
    log(auditId, 'CLAUDE_DONE', `Summarized ${domain}/${type}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, summarizeSub.id);
    return { domain, pageType: type, url: scrapedUrl, summary: summary.summary };
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

async function summarizePage(domain: string, type: DeepPageType, text: string): Promise<SummaryResponse> {
  const focus = {
    pricing: 'pricing tiers, what differentiates them, and any free / trial / enterprise mentions',
    about: 'positioning, founding story or year, team or HQ, key customers or markets',
    features: 'top product capabilities and what target user each addresses',
  }[type];
  const prompt = `Summarize the most decision-useful information from this competitor page. Focus on: ${focus}. Be concrete and short - 3 to 5 bullet-style sentences max. Do not invent details.

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
  return runClaudeJson<SummaryResponse>(prompt, { timeoutMs: 45_000 });
}
