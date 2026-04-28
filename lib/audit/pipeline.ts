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
  CompetitorBrand,
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
import { runAiMentionsStage } from './stages/ai-mentions';
import { runDeepScrapeStage } from './stages/deep-scrape';
import { runSynthesisStage } from './stages/synthesis';

interface PipelineContext {
  brand?: DiscoveredBrand;
  keywords?: string[];
  serp?: SerpResultByKeyword[];
  competitors?: CompetitorBrand[];
  brandProfiles?: BrandProfile[];
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
      const brand = await runBrandDiscovery(auditId, audit.input.brandName, audit.input.location);
      const ctx = contexts.get(auditId);
      if (ctx) ctx.brand = brand;
    } catch (err) {
      // failStage / setAuditStatus already called inside the stage
      const msg = err instanceof Error ? err.message : String(err);
      log(auditId, 'ERROR', `Discovery failed: ${msg}`);
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
      // Stage 1: keywords
      ctx.keywords = await runKeywordGeneration(auditId, confirmedBrand, audit.input.location);

      // Stage 2: SERP + competitor aggregation
      const countryCode = guessCountryCode(audit.input.location);
      const serpOut = await runSerpStage(auditId, ctx.keywords, confirmedBrand, countryCode);
      ctx.serp = serpOut.serp;
      ctx.competitors = serpOut.competitors;
      if (getAudit(auditId)?.stages[2].status === 'partial') anyPartial = true;

      // Stage 3: homepage scrape + extract (parallel)
      ctx.brandProfiles = await runHomepageStage(auditId, confirmedBrand, ctx.competitors);
      if (getAudit(auditId)?.stages[3].status === 'partial') anyPartial = true;

      // Stages 4 + 5 in parallel - they don't depend on each other
      const aiCountry = (countryCode || 'us').toUpperCase();
      const [aiMentions, deepInsights] = await Promise.all([
        runAiMentionsStage(auditId, confirmedBrand, ctx.competitors, ctx.brandProfiles, aiCountry),
        runDeepScrapeStage(auditId, confirmedBrand, ctx.competitors),
      ]);
      ctx.aiMentions = aiMentions;
      ctx.deepInsights = deepInsights;
      if (getAudit(auditId)?.stages[4].status === 'partial') anyPartial = true;
      if (getAudit(auditId)?.stages[5].status === 'partial') anyPartial = true;

      // Stage 6: synthesis
      ctx.executiveSummary = await runSynthesisStage(auditId, {
        brand: confirmedBrand,
        keywords: ctx.keywords,
        serp: ctx.serp,
        competitors: ctx.competitors,
        brandProfiles: ctx.brandProfiles,
        aiMentions: ctx.aiMentions,
        deepInsights: ctx.deepInsights,
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

/**
 * Map common location strings to ISO country codes for SERP localization.
 * Returns undefined when we can't be confident; SERP defaults to a generic locale.
 */
function guessCountryCode(location: string): string | undefined {
  const l = location.trim().toLowerCase();
  const map: Record<string, string> = {
    israel: 'il',
    'united states': 'us',
    usa: 'us',
    us: 'us',
    'united kingdom': 'uk',
    uk: 'uk',
    england: 'uk',
    britain: 'uk',
    germany: 'de',
    france: 'fr',
    spain: 'es',
    italy: 'it',
    netherlands: 'nl',
    canada: 'ca',
    australia: 'au',
    india: 'in',
    japan: 'jp',
    brazil: 'br',
  };
  if (map[l]) return map[l];
  // Two-letter fallback if user passed an ISO code already
  if (/^[a-z]{2}$/.test(l)) return l;
  return undefined;
}
