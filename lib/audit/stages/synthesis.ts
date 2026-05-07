// =====================================================
// Stage 7: Executive synthesis
// One Claude CLI call given the full aggregated audit context.
// Produces a structured executive summary ready for the report tab.
// =====================================================

import { runClaudeJson, MODEL_OPUS } from '../../claude';
import {
  AiMention,
  AuditReport,
  BrandCitationProfile,
  BrandProfile,
  CompetitorBrand,
  DeepPageInsight,
  DiscoveredBrand,
  ExecutiveSummary,
  SerpResultByKeyword,
} from '../../types';
import { computeVisibilityMetrics } from '../../visibility';
import {
  addSubTask,
  completeSubTask,
  failSubTask,
  log,
  startStage,
  completeStage,
  failStage,
} from '../state';

const STAGE_ID = 7;

interface SynthesisInputs {
  brand: DiscoveredBrand;
  keywords: string[];
  serp: SerpResultByKeyword[];
  competitors: CompetitorBrand[];
  brandProfiles: BrandProfile[];
  aiMentions: AiMention[];
  deepInsights: DeepPageInsight[];
  citationProfiles: BrandCitationProfile[];
  citationSourceCount: number;
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
  const selfDomain = inputs.brand.domain;

  // Pillar metrics — same logic the UI scorecard runs, fed to the LLM so
  // its visibilityScore is grounded in the same numbers the user sees.
  // Sources list isn't needed for metrics, only the count, so we pass
  // an array of the right length as a stand-in.
  const metrics = computeVisibilityMetrics({
    brand: inputs.brand,
    keywords: inputs.keywords,
    serp: inputs.serp,
    competitors: inputs.competitors,
    brandProfiles: inputs.brandProfiles,
    aiMentions: inputs.aiMentions,
    deepInsights: inputs.deepInsights,
    citations: {
      sources: new Array(inputs.citationSourceCount),
      profiles: inputs.citationProfiles,
    },
  } as AuditReport);
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const scoringInputs = [
    `- Organic SERP: ${metrics.serpHits}/${metrics.serpTotal} keywords ranking top 10 (${pct(metrics.serpHits, metrics.serpTotal)}%)`,
    `- AI engines: ${metrics.aiHits}/${metrics.aiQueried} engines mentioning the brand (${pct(metrics.aiHits, metrics.aiQueried)}%)`,
    metrics.citationsAvailable
      ? `- Third-party citations: ${metrics.citationHits}/${metrics.citationTotal} sources cite the brand (${pct(metrics.citationHits, metrics.citationTotal)}%), ${metrics.citationTopPicks} top-pick`
      : `- Third-party citations: no third-party sources mined for this audit (skip this pillar)`,
  ].join('\n');

  // Compute brand's own SERP presence per keyword (the key data point for the LLM)
  const selfSerpLines = inputs.serp.map((s) => {
    const hit = s.items.find((i) => i.domain === selfDomain);
    if (hit) return `- "${s.keyword}": ${selfDomain} ranks #${hit.rank}`;
    return `- "${s.keyword}": ${selfDomain} NOT in top ${s.items.length}`;
  }).join('\n');

  const aiMentionSummary = inputs.aiMentions
    .map((m) => {
      if (m.status !== 'success') return `- ${m.engine}: <no data>`;
      const top = m.brandsMentioned.slice(0, 10).map((b, idx) => `${idx + 1}. ${b.brand}`).join('; ');
      return `- ${m.engine}: ${top || '<no brands extracted>'}`;
    })
    .join('\n');

  const citationSummary = inputs.citationProfiles.length === 0
    ? '<no third-party citations mined>'
    : inputs.citationProfiles
        .slice(0, 12)
        .map((p) => {
          const youTag = p.isSelf ? ' (YOU)' : '';
          const avg = p.averagePosition !== null ? ` avg #${p.averagePosition.toFixed(1)}` : '';
          const tops = p.topPickCount > 0 ? ` ${p.topPickCount} top-pick` : '';
          return `- ${p.brand}${youTag}: cited in ${p.citationCount} of ${inputs.citationSourceCount} third-party sources${avg}${tops}`;
        })
        .join('\n');

  const selfCitation = inputs.citationProfiles.find((p) => p.isSelf);
  const selfCitationLine = selfCitation
    ? `Cited in ${selfCitation.citationCount} of ${inputs.citationSourceCount} third-party sources` +
      (selfCitation.averagePosition !== null
        ? `, avg position #${selfCitation.averagePosition.toFixed(1)}`
        : '') +
      (selfCitation.topPickCount > 0 ? `, ${selfCitation.topPickCount} top-pick` : '')
    : `Cited in 0 of ${inputs.citationSourceCount} third-party sources`;

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

KEYWORDS GENERATED FROM THE BRAND'S OWN SITE (buyer-intent search queries)
${inputs.keywords.map((k) => `- ${k}`).join('\n')}

THIS BRAND'S OWN SERP PRESENCE (per keyword)
${selfSerpLines}

TOP COMPETITORS BY SERP FREQUENCY
${serpSummary}

COMPETITOR PROFILES + DEEP PAGE INSIGHTS
${competitorSummary}

AI ENGINE MENTIONS (ordered list of brands each engine surfaced for the category-level query)
${aiMentionSummary}

THIRD-PARTY CITATIONS (brands ranked or recommended INSIDE listicles, review sites, and Reddit threads that surfaced for the category — note: this often catches competitors who don't rank directly but get named in the "best X" round-ups buyers actually read)
This brand: ${selfCitationLine}
Brands cited across ${inputs.citationSourceCount} third-party sources:
${citationSummary}

VISIBILITY SCORING INPUTS (pre-computed pillar ratios — use these to ground the visibilityScore field)
${scoringInputs}

Write a sharp, data-grounded executive summary for an SEO/marketing team. Every claim must reference a specific data point from above (a keyword name, a competitor domain, an AI engine, a rank number, a feature). Avoid generic statements like "improve SEO presence".

OUTPUT LANGUAGE: write the entire summary (narrativeArc, headline, keyFindings, quickWins, strategicPlays, visibilityScore.rationale) in English. Some keywords above may be in the local market language - quote them literally as they appear, but write all surrounding rationale and analysis in English.

VISIBILITY SCORE RUBRIC (0-100, integer)
- 0-19   Effectively invisible. The brand is missing from organic SERP, AI engines, and third-party listicles for the buyer-intent queries its own site implies.
- 20-39  Heavy gaps. One pillar may show partial presence (e.g. 1-2 keywords ranking, or one AI engine mentions) but the brand is absent from the rest.
- 40-59  Partial presence. Brand appears in some pillars but with weak signal — low ranks, occasional AI engine, or back-of-the-list citations.
- 60-79  Strong but not dominant. Brand wins one pillar clearly (e.g. AI engines #1) but has gaps in another (SERP or citations).
- 80-100 Category leader. Brand wins or near-wins in all three pillars: high SERP coverage, top of AI lists, top-pick in most third-party sources.

Weight the pillars by the actual signal strength: AI engines ranking the brand #1 in 3 of 4 engines should pull the score up more than 0/8 SERP hits pulls it down — but only if the citations also corroborate strength. If citations contradict AI (e.g. AI loves the brand but it's cited 0 times), penalize. Use the rubric buckets so the score doesn't drift across audits — don't write 47 when the brand fits the 40-59 description, write a value inside that range that distinguishes it from a 50.

Return ONLY a JSON object with this exact shape:
{
  "visibilityScore": {
    "value": <integer 0-100, picked from the rubric above>,
    "rationale": "<one sentence under 25 words. Reference at least two pillars by name (SERP / AI / citations) with the specific ratios that drove the bucket choice. e.g. 'AI engines rank the brand #1 in 3 of 4, but it appears in 0 of 8 SERPs and 0 of 7 third-party listicles — partial presence anchored almost entirely in AI.'>"
  },
  "narrativeArc": "<one sentence capturing the central tension or 'so what' of this audit. Example pattern: 'Brand X has won the AI brand-recognition battle but is invisible in organic search where their buyers research first.'>",
  "headline": "<one striking sentence with a specific data point baked in (e.g. a count like 0/8 or a competitor name)>",
  "keyFindings": [
    "<striking finding tied to specific keywords/ranks/competitors - exactly 3 items, no more no less>",
    "<...>",
    "<...>"
  ],
  "quickWins": [
    {
      "action": "<imperative one-liner the team could ship in under 30 days>",
      "rationale": "<the specific data point that motivates this. e.g. 'CompetitorX owns rank 1 for keyword Y; ${selfDomain} does not appear in top 20.'>"
    }
  ],
  "strategicPlays": [
    {
      "action": "<longer-term play, 1-3 quarters, content/positioning/product-marketing>",
      "rationale": "<specific data motivation referencing competitor names or AI engine results>"
    }
  ]
}

Constraints:
- visibilityScore.value: integer in [0, 100], chosen from a rubric bucket above.
- visibilityScore.rationale: one sentence, names at least two pillars with ratios.
- keyFindings: exactly 3 items.
- quickWins: 2 to 3 items.
- strategicPlays: 2 to 3 items.
- Every "rationale" must name a real keyword, competitor, AI engine, or rank from above.
- Do not invent data points. Only use what is in the audit context.`;

  const result = await runClaudeJson<Partial<ExecutiveSummary>>(prompt, {
    timeoutMs: 120_000,
    model: MODEL_OPUS,
  });

  // Validate shape - throw clearly if Claude returned something unexpected
  if (!result || typeof result !== 'object') {
    throw new Error(`Synthesis returned non-object: ${JSON.stringify(result).slice(0, 200)}`);
  }
  const missing: string[] = [];
  if (!result.narrativeArc) missing.push('narrativeArc');
  if (!result.headline) missing.push('headline');
  if (!Array.isArray(result.keyFindings) || result.keyFindings.length === 0) missing.push('keyFindings');
  if (!Array.isArray(result.quickWins) || result.quickWins.length === 0) missing.push('quickWins');
  if (!Array.isArray(result.strategicPlays) || result.strategicPlays.length === 0) missing.push('strategicPlays');
  const vs = result.visibilityScore;
  if (!vs || typeof vs !== 'object' || typeof vs.value !== 'number' || !vs.rationale) {
    missing.push('visibilityScore');
  }
  if (missing.length) {
    throw new Error(`Synthesis missing required fields: ${missing.join(', ')}`);
  }

  // Clamp the score to [0,100] integer in case the LLM drifts outside the rubric.
  const clampedScore = Math.max(0, Math.min(100, Math.round(vs!.value)));

  return {
    visibilityScore: { value: clampedScore, rationale: vs!.rationale },
    narrativeArc: result.narrativeArc!,
    headline: result.headline!,
    keyFindings: result.keyFindings!.slice(0, 3),
    quickWins: result.quickWins!.filter((r) => r && r.action && r.rationale).slice(0, 3),
    strategicPlays: result.strategicPlays!.filter((r) => r && r.action && r.rationale).slice(0, 3),
  };
}

function avgRank(c: CompetitorBrand): string {
  if (c.rankings.length === 0) return '?';
  return (c.rankings.reduce((s, r) => s + r.rank, 0) / c.rankings.length).toFixed(1);
}
