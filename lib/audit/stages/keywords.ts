// =====================================================
// Stage 1: Keyword generation
// Grounded in the brand profile from Stage 0 - generates the search
// queries real customers would type to find this kind of service.
// =====================================================

import { runClaudeJson, MODEL_OPUS } from '../../claude';
import { languageName } from '../../locale';
import { BrandProfileLite, DiscoveredBrand, KEYWORD_COUNT } from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
  failStage,
} from '../state';

const STAGE_ID = 1;

interface KeywordResponse {
  keywords: string[];
}

export async function runKeywordGeneration(
  auditId: string,
  brand: DiscoveredBrand,
  location: string,
  language: string
): Promise<string[]> {
  startStage(auditId, STAGE_ID);
  const langLabel = languageName(language);
  const sub = addSubTask(
    auditId,
    STAGE_ID,
    `Generate ${KEYWORD_COUNT} ${langLabel} keywords from brand profile`,
    'CLAUDE'
  );

  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', `Generating keywords in ${langLabel} from brand profile`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    const result = await generateKeywords(brand.brandProfile, location, language);
    const cleaned = sanitizeKeywords(result.keywords).slice(0, KEYWORD_COUNT);
    log(auditId, 'CLAUDE_DONE', `Generated ${cleaned.length} ${langLabel} keywords: ${cleaned.join(', ')}`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, sub.id);
    completeStage(auditId, STAGE_ID);
    return cleaned;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, sub.id, msg);
    failStage(auditId, STAGE_ID, msg);
    throw err;
  }
}

async function generateKeywords(
  profile: BrandProfileLite,
  location: string,
  language: string
): Promise<KeywordResponse> {
  const langLabel = languageName(language);
  const currentYear = new Date().getUTCFullYear();
  // Critical: queries must be in the market's language. The query language
  // picks the corpus - English queries return global English listicles even
  // with gl=fr. French queries return the actual French market.
  const prompt = `You are generating commercial-intent search queries that real customers in ${location} would type into Google to find a product like the one described below.

The current year is ${currentYear}. Do NOT include a year in queries unless searchers genuinely use one (e.g. "best X ${currentYear}" only if year-tagged listicles are a real intent for this category). Never use a year other than ${currentYear}; queries with stale years like "best savings rates 2023" are useless.

CRITICAL: Write every query in ${langLabel}, the way native ${langLabel} speakers actually search. Do NOT translate word-for-word from English - use the natural phrasing a local searcher would use. The brand profile below is in English; you are translating its INTENT into ${langLabel} search behaviour.

Brand profile (in English, for your reference only):
- Category: ${profile.category}
- Value proposition: ${profile.valueProp}
- Target segments: ${profile.targetSegments.join(', ')}
- Key features: ${profile.keyFeatures.join(', ')}
- Pricing model: ${profile.pricingModel}
- Customer market: ${location}

Generate exactly ${KEYWORD_COUNT} search queries IN ${langLabel.toUpperCase()}. Mix:
- 3-4 category queries ("best <thing>", "<thing> for <segment>")
- 2-3 problem queries ("how to <do thing>", "<problem> solution")
- 1-2 comparison queries ("<category> vs <category>")
- 1 buying-intent query ("<category> pricing", "<category> reviews")

Return ONLY a JSON object with this exact shape, nothing else:
{
  "keywords": ["query 1", "query 2", "query 3", "query 4", "query 5", "query 6", "query 7", "query 8"]
}`;
  return runClaudeJson<KeywordResponse>(prompt, { timeoutMs: 90_000, model: MODEL_OPUS });
}

function sanitizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of keywords) {
    if (typeof kw !== 'string') continue;
    const trimmed = kw.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}
