// =====================================================
// Stage 1: Keyword generation
// Grounded in the brand profile from Stage 0 - generates the search
// queries real customers would type to find this kind of service.
// =====================================================

import { runClaudeJson } from '../../claude-cli';
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
  location: string
): Promise<string[]> {
  startStage(auditId, STAGE_ID);
  const sub = addSubTask(auditId, STAGE_ID, `Generate ${KEYWORD_COUNT} keywords from brand profile`, 'CLAUDE');

  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', 'Generating keywords from brand profile', {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    const result = await generateKeywords(brand.brandProfile, location);
    const cleaned = sanitizeKeywords(result.keywords).slice(0, KEYWORD_COUNT);
    log(auditId, 'CLAUDE_DONE', `Generated ${cleaned.length} keywords: ${cleaned.join(', ')}`, {
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

async function generateKeywords(profile: BrandProfileLite, location: string): Promise<KeywordResponse> {
  const prompt = `You are generating commercial-intent search queries that real customers would type into Google to find a product like the one described below. The queries should be specific to the category and use real customer language - not generic or overly branded.

Brand profile:
- Category: ${profile.category}
- Value proposition: ${profile.valueProp}
- Target segments: ${profile.targetSegments.join(', ')}
- Key features: ${profile.keyFeatures.join(', ')}
- Pricing model: ${profile.pricingModel}
- Customer location/market: ${location}

Generate exactly ${KEYWORD_COUNT} search queries. Mix:
- 3-4 category queries ("best <thing>", "<thing> for <segment>")
- 2-3 problem queries ("how to <do thing>", "<problem> solution")
- 1-2 comparison queries ("<category> vs <category>")
- 1 buying-intent query ("<category> pricing", "<category> reviews")

Return ONLY a JSON object with this exact shape, nothing else:
{
  "keywords": ["query 1", "query 2", "query 3", "query 4", "query 5", "query 6", "query 7", "query 8"]
}`;
  return runClaudeJson<KeywordResponse>(prompt, { timeoutMs: 60_000 });
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
