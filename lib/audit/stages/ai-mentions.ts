// =====================================================
// Stage 5: AI engine mentions
// Queries 4 AI assistants in parallel for a category-level prompt,
// then has Claude parse which brands surface in each engine's response.
// Engines that need auth/datasets are stubbed cleanly so the parallel
// visualization stays honest.
// =====================================================

import { queryAiEngineRaced, AiEngineId, AI_ENGINES, REDUNDANT_REQUESTS } from '../../brightdata';
import { runClaudeJson, MODEL_HAIKU } from '../../claude';
import { languageName } from '../../locale';
import { AiEngine, AiMention, BrandProfile, CompetitorBrand, DiscoveredBrand } from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 5;
const ENGINES: AiEngineId[] = ['perplexity', 'chatgpt', 'grok', 'gemini'];

interface ExtractMentionsResponse {
  brandsMentioned: {
    brand: string;
    sentiment: 'positive' | 'neutral' | 'negative';
    context: string;
  }[];
}

export async function runAiMentionsStage(
  auditId: string,
  brand: DiscoveredBrand,
  competitors: CompetitorBrand[],
  profiles: BrandProfile[],
  country: string,
  language: string
): Promise<AiMention[]> {
  startStage(auditId, STAGE_ID);

  const category = profiles.find((p) => p.isSelf)?.category || brand.brandProfile.category;
  const query = await buildCategoryQuery(category, language);
  if (language !== 'en') {
    log(auditId, 'INFO', `AI engine prompt localized to ${languageName(language)}: "${query.slice(0, 80)}${query.length > 80 ? '...' : ''}"`, {
      stage: STAGE_ID,
    });
  }
  const knownBrands = [brand.domain, ...competitors.map((c) => c.domain)];

  const tasks = ENGINES.map(async (engine): Promise<AiMention> => {
    const querySub = addSubTask(
      auditId,
      STAGE_ID,
      `${AI_ENGINES[engine].name} (race ${REDUNDANT_REQUESTS}x)`,
      'SCRAPER'
    );
    const t0 = Date.now();
    let raw = '';
    let queryStatus: 'success' | 'failed' = 'failed';
    let queryError: string | undefined;

    try {
      log(auditId, 'BD_CALL', `${AI_ENGINES[engine].name}: triggering ${REDUNDANT_REQUESTS} snapshots for "${query.slice(0, 60)}..."`, {
        bdProduct: 'SCRAPER',
        stage: STAGE_ID,
      });
      const result = await queryAiEngineRaced(engine, query, country, {
        onTriggered: (snapshotId, attemptIdx) => {
          log(
            auditId,
            'BD_CALL',
            `${AI_ENGINES[engine].name}: snapshot ${attemptIdx + 1} = ${snapshotId.slice(0, 12)}`,
            { bdProduct: 'SCRAPER', stage: STAGE_ID }
          );
        },
        onFirstReady: (snapshotId, elapsedMs) => {
          log(
            auditId,
            'BD_DONE',
            `${AI_ENGINES[engine].name}: first snapshot ready in ${(elapsedMs / 1000).toFixed(1)}s (${snapshotId.slice(0, 12)})`,
            { bdProduct: 'SCRAPER', stage: STAGE_ID, durationMs: elapsedMs }
          );
        },
      });
      raw = result.rawText;
      queryStatus = result.status;
      queryError = result.errorMessage;
      if (result.status === 'success') {
        log(auditId, 'BD_DONE', `${AI_ENGINES[engine].name}: downloaded ${raw.length} chars`, {
          bdProduct: 'SCRAPER',
          stage: STAGE_ID,
          durationMs: Date.now() - t0,
        });
        completeSubTask(auditId, STAGE_ID, querySub.id);
      } else {
        log(auditId, 'BD_FAIL', `${AI_ENGINES[engine].name}: ${queryError || 'unknown'}`, {
          bdProduct: 'SCRAPER',
          stage: STAGE_ID,
        });
        failSubTask(auditId, STAGE_ID, querySub.id, queryError || 'failed');
      }
    } catch (err) {
      queryError = err instanceof Error ? err.message : String(err);
      log(auditId, 'BD_FAIL', `${AI_ENGINES[engine].name}: ${queryError}`, {
        bdProduct: 'SCRAPER',
        stage: STAGE_ID,
      });
      failSubTask(auditId, STAGE_ID, querySub.id, queryError);
    }

    if (queryStatus !== 'success' || !raw.trim()) {
      return {
        engine: engine as AiEngine,
        query,
        rawResponse: raw,
        brandsMentioned: [],
        status: 'failed',
      };
    }

    // Parse mentions via Claude
    const parseSub = addSubTask(auditId, STAGE_ID, `Parse ${engine} mentions`, 'CLAUDE');
    try {
      const t1 = Date.now();
      log(auditId, 'CLAUDE_CALL', `Parsing ${engine} response for brand mentions`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
      });
      const parsed = await extractMentions(raw, knownBrands);
      log(auditId, 'CLAUDE_DONE', `${engine}: ${parsed.brandsMentioned.length} brands mentioned`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
        durationMs: Date.now() - t1,
      });
      completeSubTask(auditId, STAGE_ID, parseSub.id);
      return {
        engine: engine as AiEngine,
        query,
        rawResponse: raw,
        brandsMentioned: parsed.brandsMentioned,
        status: 'success',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSubTask(auditId, STAGE_ID, parseSub.id, msg);
      log(auditId, 'CLAUDE_FAIL', `Parse ${engine} failed: ${msg}`, {
        bdProduct: 'CLAUDE',
        stage: STAGE_ID,
      });
      return {
        engine: engine as AiEngine,
        query,
        rawResponse: raw,
        brandsMentioned: [],
        status: 'partial',
      };
    }
  });

  const mentions = await Promise.all(tasks);
  const successCount = mentions.filter((m) => m.status === 'success').length;
  // Demo tolerance: 3/4 engines responding is still a useful AI-visibility
  // picture for the booth. Mark partial only if MORE THAN HALF of engines
  // failed - i.e. the visualization would look broken.
  const partial = successCount < mentions.length / 2;

  log(auditId, 'INFO', `${successCount}/${mentions.length} AI engines responded successfully`, {
    stage: STAGE_ID,
  });
  completeStage(auditId, STAGE_ID, partial);
  return mentions;
}

async function buildCategoryQuery(category: string, language: string): Promise<string> {
  const cleaned = (category || 'this category').trim();
  const englishQuery = `What are the best ${cleaned}? List the top providers and explain what makes each one stand out. Include both established players and newer entrants.`;
  if ((language || 'en').toLowerCase() === 'en') return englishQuery;

  // Localize the question into the market language. Same intent, but phrased
  // the way a native speaker would ask. The category itself often needs
  // translation too ("backpack manufacturer" -> "fabricant de sacs à dos").
  const langLabel = languageName(language);
  const prompt = `Translate the following English buyer-research question into natural ${langLabel}, the way a native ${langLabel} speaker would ask an AI assistant. Translate the category name idiomatically (do not leave English nouns in if a natural ${langLabel} term exists). Keep the same intent: ask for the best providers, with a mix of established and newer entrants.

English question:
"${englishQuery}"

Return ONLY this JSON, nothing else:
{"question": "<the question rewritten in ${langLabel}>"}`;
  try {
    const { question } = await runClaudeJson<{ question: string }>(prompt, {
      model: MODEL_HAIKU,
      timeoutMs: 30_000,
    });
    const trimmed = (question || '').trim();
    return trimmed || englishQuery;
  } catch {
    // Translation is best-effort; fall back to English so the demo still runs
    return englishQuery;
  }
}

async function extractMentions(rawText: string, knownBrands: string[]): Promise<ExtractMentionsResponse> {
  const truncated = rawText.slice(0, 12_000);
  const prompt = `You are extracting brand mentions from an AI assistant's response. The response was generated by a search/chat AI when asked about a product category. The response may be in any language; the report consuming your output is in English.

Identify which brands or products are mentioned, the sentiment toward each, and the context (one short phrase).

Output language rules:
- "brand": keep the brand name as-is (proper nouns like Eastpak, Decathlon, Lafuma stay the same in any language).
- "context": ALWAYS write the context phrase in English, even if the source response is in another language. Translate idiomatically.

Known relevant brand domains (these matter most, but include any other brands you spot too): ${knownBrands.join(', ')}

AI response:
"""
${truncated}
"""

Return ONLY a JSON object with this exact shape:
{
  "brandsMentioned": [
    {"brand": "<brand or product name>", "sentiment": "positive" | "neutral" | "negative", "context": "<short English phrase explaining the mention>"}
  ]
}

If no brands are mentioned, return {"brandsMentioned": []}.`;
  return runClaudeJson<ExtractMentionsResponse>(prompt, { timeoutMs: 60_000 });
}
