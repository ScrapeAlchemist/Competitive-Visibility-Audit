// =====================================================
// Stage 4: AI engine mentions
// Queries 4 AI assistants in parallel for a category-level prompt,
// then has Claude parse which brands surface in each engine's response.
// Engines that need auth/datasets are stubbed cleanly so the parallel
// visualization stays honest.
// =====================================================

import { queryAiEngineRaced, AiEngineId, AI_ENGINES, REDUNDANT_REQUESTS } from '../../brightdata';
import { runClaudeJson } from '../../claude-cli';
import { AiEngine, AiMention, BrandProfile, CompetitorBrand, DiscoveredBrand } from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
} from '../state';

const STAGE_ID = 4;
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
  country: string
): Promise<AiMention[]> {
  startStage(auditId, STAGE_ID);

  const category = profiles.find((p) => p.isSelf)?.category || brand.brandProfile.category;
  const query = buildCategoryQuery(category);
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
  const partial = successCount < mentions.length;

  log(auditId, 'INFO', `${successCount}/${mentions.length} AI engines responded successfully`, {
    stage: STAGE_ID,
  });
  completeStage(auditId, STAGE_ID, partial);
  return mentions;
}

function buildCategoryQuery(category: string): string {
  const cleaned = (category || 'this category').trim();
  return `What are the best ${cleaned}? List the top providers and explain what makes each one stand out. Include both established players and newer entrants.`;
}

async function extractMentions(rawText: string, knownBrands: string[]): Promise<ExtractMentionsResponse> {
  const truncated = rawText.slice(0, 12_000);
  const prompt = `You are extracting brand mentions from an AI assistant's response. The response was generated by a search/chat AI when asked about a product category. Identify which brands or products are mentioned, the sentiment toward each, and the context (one short phrase).

Known relevant brand domains (these matter most, but include any other brands you spot too): ${knownBrands.join(', ')}

AI response:
"""
${truncated}
"""

Return ONLY a JSON object with this exact shape:
{
  "brandsMentioned": [
    {"brand": "<brand or product name>", "sentiment": "positive" | "neutral" | "negative", "context": "<short phrase explaining the mention>"}
  ]
}

If no brands are mentioned, return {"brandsMentioned": []}.`;
  return runClaudeJson<ExtractMentionsResponse>(prompt, { timeoutMs: 60_000 });
}
