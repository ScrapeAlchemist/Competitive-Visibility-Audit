// =====================================================
// Stage 6: Executive synthesis
// One Claude CLI call given the full aggregated audit context.
// Produces a structured executive summary ready for the report tab.
// =====================================================

import { runClaudeJson } from '../../claude-cli';
import {
  AiMention,
  BrandProfile,
  CompetitorBrand,
  DeepPageInsight,
  DiscoveredBrand,
  ExecutiveSummary,
  SerpResultByKeyword,
} from '../../types';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
  failStage,
} from '../state';

const STAGE_ID = 6;

interface SynthesisInputs {
  brand: DiscoveredBrand;
  keywords: string[];
  serp: SerpResultByKeyword[];
  competitors: CompetitorBrand[];
  brandProfiles: BrandProfile[];
  aiMentions: AiMention[];
  deepInsights: DeepPageInsight[];
}

export async function runSynthesisStage(auditId: string, inputs: SynthesisInputs): Promise<ExecutiveSummary> {
  startStage(auditId, STAGE_ID);
  const sub = addSubTask(auditId, STAGE_ID, 'Synthesize executive summary', 'CLAUDE');

  try {
    const t0 = Date.now();
    log(auditId, 'CLAUDE_CALL', 'Synthesizing executive summary', {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
    });
    const summary = await synthesize(inputs);
    log(auditId, 'CLAUDE_DONE', `Executive summary generated`, {
      bdProduct: 'CLAUDE',
      stage: STAGE_ID,
      durationMs: Date.now() - t0,
    });
    completeSubTask(auditId, STAGE_ID, sub.id);
    completeStage(auditId, STAGE_ID);
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failSubTask(auditId, STAGE_ID, sub.id, msg);
    failStage(auditId, STAGE_ID, msg);
    throw err;
  }
}

async function synthesize(inputs: SynthesisInputs): Promise<ExecutiveSummary> {
  const self = inputs.brandProfiles.find((p) => p.isSelf);
  const competitorProfiles = inputs.brandProfiles.filter((p) => !p.isSelf);

  const aiMentionSummary = inputs.aiMentions
    .map((m) => {
      if (m.status !== 'success') return `- ${m.engine}: <no data>`;
      const top = m.brandsMentioned.slice(0, 8).map((b) => b.brand).join(', ');
      return `- ${m.engine}: ${top || '<no brands extracted>'}`;
    })
    .join('\n');

  const competitorSummary = competitorProfiles
    .map((c) => {
      const matchingDeep = inputs.deepInsights.filter((d) => d.domain === c.domain);
      const deepSnips = matchingDeep.map((d) => `    [${d.pageType}] ${d.summary}`).join('\n');
      return `- ${c.domain}\n    category: ${c.category}\n    valueProp: ${c.valueProp}\n    pricing: ${c.pricingModel}\n    features: ${c.features.slice(0, 6).join(' | ')}\n${deepSnips}`;
    })
    .join('\n');

  const serpSummary = inputs.competitors
    .map((c) => `- ${c.domain}: appears in ${c.appearanceCount}/${inputs.keywords.length} keyword SERPs (avg rank ${avgRank(c)})`)
    .join('\n');

  const prompt = `You are writing an executive summary for a competitive visibility audit. The audit was for the brand "${inputs.brand.domain}".

THE BRAND
url: ${inputs.brand.url}
extracted self-profile from homepage: ${self ? `${self.category} | ${self.valueProp}` : '(profile failed to extract)'}

KEYWORDS GENERATED FROM THE BRAND'S OWN SITE (8 buyer-intent search queries)
${inputs.keywords.map((k) => `- ${k}`).join('\n')}

SERP COMPETITIVE LANDSCAPE
${serpSummary}

COMPETITOR PROFILES + DEEP PAGE INSIGHTS
${competitorSummary}

AI ENGINE MENTIONS (which brands surfaced when an AI was asked the category-level question)
${aiMentionSummary}

Write a sharp, no-fluff executive summary. Focus on actionable insights for an SEO/marketing team. Avoid generic statements. Surface specific gaps, mismatches, or differentiation opportunities you can see from the data.

Return ONLY a JSON object with this exact shape:
{
  "headline": "<single punchy sentence summarizing the competitive position>",
  "keyFindings": ["<finding 1>", "<finding 2>", "<finding 3>", "<finding 4>", "<finding 5>"],
  "competitiveGaps": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "recommendations": ["<action 1>", "<action 2>", "<action 3>", "<action 4>"]
}`;
  return runClaudeJson<ExecutiveSummary>(prompt, { timeoutMs: 90_000 });
}

function avgRank(c: CompetitorBrand): string {
  if (c.rankings.length === 0) return '?';
  return (c.rankings.reduce((s, r) => s + r.rank, 0) / c.rankings.length).toFixed(1);
}
