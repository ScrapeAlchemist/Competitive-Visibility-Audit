// =====================================================
// Stage 3: Homepage scrape + extract for self + top competitors
// All in parallel: 6 BD Unlocker calls -> 6 Claude CLI extractions.
// =====================================================

import { unlockUrl, htmlToCleanText } from '../../brightdata';
import { runClaudeJson } from '../../claude-cli';
import { BrandProfile, CompetitorBrand, DiscoveredBrand } from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 3;

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
}

export async function runHomepageStage(
  auditId: string,
  brand: DiscoveredBrand,
  competitors: CompetitorBrand[]
): Promise<BrandProfile[]> {
  startStage(auditId, STAGE_ID);

  const targets: BrandEntry[] = [
    { domain: brand.domain, url: brand.url, isSelf: true },
    ...competitors.map((c) => ({ domain: c.domain, url: c.url, isSelf: false })),
  ];

  const tasks = targets.map(async (entry) => {
    const scrapeSub = addSubTask(auditId, STAGE_ID, `Read ${entry.domain}`, 'UNLOCKER');
    let homepageText = '';
    try {
      const t0 = Date.now();
      log(auditId, 'BD_CALL', `Unlocker: ${entry.url}`, { bdProduct: 'UNLOCKER', stage: STAGE_ID });
      const html = await unlockUrl(entry.url);
      homepageText = htmlToCleanText(html, 8000);
      log(auditId, 'BD_DONE', `Unlocker: ${entry.domain} (${homepageText.length} chars)`, {
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
      return null;
    }

    const extractSub = addSubTask(auditId, STAGE_ID, `Profile ${entry.domain}`, 'CLAUDE');
    try {
      const t0 = Date.now();
      log(auditId, 'CLAUDE_CALL', `Extracting profile: ${entry.domain}`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
      });
      const ext = await extractProfile(entry.domain, entry.url, homepageText);
      log(auditId, 'CLAUDE_DONE', `Profiled ${entry.domain}: "${ext.category}"`, {
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
      return profile;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSubTask(auditId, STAGE_ID, extractSub.id, msg);
      log(auditId, 'CLAUDE_FAIL', `Profile ${entry.domain} failed: ${msg}`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
      });
      return null;
    }
  });

  const settled = await Promise.all(tasks);
  const profiles = settled.filter((p): p is BrandProfile => p !== null);
  const partial = profiles.length < targets.length;

  log(auditId, 'INFO', `Built ${profiles.length}/${targets.length} brand profiles`, { stage: STAGE_ID });
  completeStage(auditId, STAGE_ID, partial);
  return profiles;
}

async function extractProfile(domain: string, url: string, homepageText: string): Promise<ExtractedProfile> {
  const prompt = `Extract a structured competitive profile from this company's homepage. Be faithful to the page - do not invent. If something is not on the page, use an empty string or empty array.

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
  "trustSignals": ["<logo / case study / award / cert>", ...]
}`;
  return runClaudeJson<ExtractedProfile>(prompt, { timeoutMs: 60_000 });
}
