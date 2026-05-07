// =====================================================
// Pipeline orchestrator
// Coordinates Stage 0 (discovery) and Stages 1-6 (main pipeline).
// Holds intermediate context per audit so we can resume after the
// user-confirm-URL pause.
// =====================================================

import {
  AiMention,
  AuditReport,
  BrandProfile,
  CitationCandidate,
  CitationStageOutput,
  CompetitorBrand,
  COMPETITOR_COUNT,
  DeepPageInsight,
  DiscoveredBrand,
  ExecutiveSummary,
  SerpResultByKeyword,
} from '../types';
import {
  failStage,
  getAudit,
  log,
  markComplete,
  setAuditStatus,
  setReport,
} from './state';
import { runBrandDiscovery } from './stages/brand-discovery';
import { runKeywordGeneration } from './stages/keywords';
import { runSerpStage } from './stages/serp';
import { runHomepageStage } from './stages/homepage';
import { runCitationsStage } from './stages/citations';
import { runAiMentionsStage } from './stages/ai-mentions';
import { runDeepScrapeStage } from './stages/deep-scrape';
import { runSynthesisStage } from './stages/synthesis';
import { toCountryCode, defaultLanguageForCountry, languageName } from '../locale';

interface PipelineContext {
  brand?: DiscoveredBrand;
  keywords?: string[];
  serp?: SerpResultByKeyword[];
  competitors?: CompetitorBrand[];
  brandProfiles?: BrandProfile[];
  citationCandidates?: CitationCandidate[];
  citations?: CitationStageOutput;
  aiMentions?: AiMention[];
  deepInsights?: DeepPageInsight[];
  executiveSummary?: ExecutiveSummary;
}

// Persist across Next.js dev hot-reload (same pattern as audit state).
const globalKey = '__cva_pipeline_contexts';
const contexts: Map<string, PipelineContext> =
  (globalThis as Record<string, unknown>)[globalKey] as Map<string, PipelineContext> ||
  ((globalThis as Record<string, unknown>)[globalKey] = new Map<string, PipelineContext>());

export function getContext(auditId: string): PipelineContext | undefined {
  return contexts.get(auditId);
}

// Stage 0 has multiple internal retries (BD: 3x30s + Claude: 60s = up to 4min worst case).
// Cap the whole thing so the discovery card never pulses forever on a hung upstream.
const DISCOVERY_TIMEOUT_MS = 90_000;

/**
 * Phase A: brand discovery.
 * Runs in the background. Sets audit status to 'awaiting_confirmation' on success.
 */
export function startDiscovery(auditId: string): void {
  contexts.set(auditId, {});
  (async () => {
    const audit = getAudit(auditId);
    if (!audit) return;
    try {
      const brand = await Promise.race([
        runBrandDiscovery(auditId, audit.input.brandName, audit.input.location),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Brand discovery exceeded ${DISCOVERY_TIMEOUT_MS / 1000}s timeout`)),
            DISCOVERY_TIMEOUT_MS
          )
        ),
      ]);
      const ctx = contexts.get(auditId);
      if (ctx) ctx.brand = brand;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(auditId, 'ERROR', `Discovery failed: ${msg}`);
      // Inner stages call failStage + setAuditStatus on their own catches. If we got here
      // via the global timeout, status is still 'discovering' and we need to surface the failure.
      const a = getAudit(auditId);
      if (a && a.status === 'discovering') {
        setAuditStatus(auditId, 'failed', msg);
      }
      markComplete(auditId);
    }
  })();
}

/**
 * Phase B: main pipeline (Stages 1-6).
 * Triggered after user confirms / overrides the discovered URL.
 * The confirmedBrand may have an updated URL/domain if the user edited it.
 */
export function startMainPipeline(auditId: string, confirmedBrand: DiscoveredBrand): void {
  const ctx = contexts.get(auditId) || {};
  ctx.brand = confirmedBrand;
  contexts.set(auditId, ctx);

  setAuditStatus(auditId, 'running');

  (async () => {
    const audit = getAudit(auditId);
    if (!audit) return;
    let anyPartial = false;

    try {
      // Localization: country drives `gl` and the default language drives `hl`
      // and the natural language used for Stage 1 keywords + Stage 5 AI prompts.
      // The query language picks the corpus - Anglophone queries from gl=fr
      // still return global English listicles. See test_uule.mjs for proof.
      const country = toCountryCode(audit.input.location);
      const language = defaultLanguageForCountry(country);
      log(
        auditId,
        'INFO',
        `Localization: country=${country} language=${language} (${languageName(language)}). Final report stays in English.`
      );

      // Stage 1: keywords (in market language)
      ctx.keywords = await runKeywordGeneration(auditId, confirmedBrand, audit.input.location, language);

      // Stage 2: SERP + competitor aggregation
      // Stage 2 now also returns citationCandidates: SERP results from
      // forum/social/review hosts (Reddit threads, G2/Capterra reviews,
      // Medium articles) that go to Stage 4 instead of being dropped.
      const serpOut = await runSerpStage(auditId, ctx.keywords, confirmedBrand, country, language);
      ctx.serp = serpOut.serp;
      ctx.competitors = serpOut.competitors;
      ctx.citationCandidates = serpOut.citationCandidates;
      if (getAudit(auditId)?.stages[2].status === 'partial') anyPartial = true;

      // Stage 3: homepage scrape + extract (parallel) - also captures internal links.
      // Stage 3 also drops off-topic SERP candidates (e.g. hostinger.com showing up
      // in PM-tool searches because of their listicle content) by comparing each
      // brand's extracted category against the audited brand's category from Stage 0.
      // The returned competitors list overwrites the SERP-only list passed in.
      // Stage 3 ALSO appends additional citation candidates: off-topic drops
      // that classify as listicle/review/comparison/news/media/analyst, with
      // their already-fetched homepage text cached so Stage 4 can skip the
      // re-fetch on those.
      const homepageOut = await runHomepageStage(
        auditId,
        confirmedBrand,
        ctx.competitors,
        confirmedBrand.brandProfile.category,
        COMPETITOR_COUNT
      );
      ctx.competitors = homepageOut.competitors;
      ctx.brandProfiles = homepageOut.profiles;
      ctx.citationCandidates = [...(ctx.citationCandidates || []), ...homepageOut.citationCandidates];
      if (getAudit(auditId)?.stages[3].status === 'partial') anyPartial = true;

      // Stages 4 + 5 + 6 in parallel - they're independent.
      // Stage 4: mine listicles/forums/reviews for brand citations.
      // Stage 5: AI engine mentions.
      // Stage 6: deep page scrape on competitors' /pricing /about /features.
      const aiCountry = country.toUpperCase();
      const [citations, aiMentions, deepInsights] = await Promise.all([
        runCitationsStage(auditId, confirmedBrand, ctx.competitors, ctx.citationCandidates),
        runAiMentionsStage(auditId, confirmedBrand, ctx.competitors, ctx.brandProfiles, aiCountry, language),
        runDeepScrapeStage(auditId, homepageOut.homepageLinks),
      ]);
      ctx.citations = citations;
      ctx.aiMentions = aiMentions;
      ctx.deepInsights = deepInsights;
      if (getAudit(auditId)?.stages[4].status === 'partial') anyPartial = true;
      if (getAudit(auditId)?.stages[5].status === 'partial') anyPartial = true;
      if (getAudit(auditId)?.stages[6].status === 'partial') anyPartial = true;

      // Stage 7: synthesis
      ctx.executiveSummary = await runSynthesisStage(auditId, {
        brand: confirmedBrand,
        keywords: ctx.keywords,
        serp: ctx.serp,
        competitors: ctx.competitors,
        brandProfiles: ctx.brandProfiles,
        aiMentions: ctx.aiMentions,
        deepInsights: ctx.deepInsights,
        citationProfiles: ctx.citations.profiles,
        citationSourceCount: ctx.citations.sources.length,
      });

      // Build final report
      const report: AuditReport = {
        brand: confirmedBrand,
        keywords: ctx.keywords,
        serp: ctx.serp,
        competitors: ctx.competitors,
        brandProfiles: ctx.brandProfiles,
        aiMentions: ctx.aiMentions,
        deepInsights: ctx.deepInsights,
        executiveSummary: ctx.executiveSummary,
        citations: ctx.citations,
      };
      setReport(auditId, report);
      setAuditStatus(auditId, anyPartial ? 'partial' : 'complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(auditId, 'ERROR', `Pipeline failed: ${msg}`);
      const audit = getAudit(auditId);
      if (audit) {
        const runningStage = audit.stages.find((s) => s.status === 'running');
        if (runningStage) failStage(auditId, runningStage.id, msg);
      }
      setAuditStatus(auditId, 'failed', msg);
    } finally {
      markComplete(auditId);
    }
  })();
}

