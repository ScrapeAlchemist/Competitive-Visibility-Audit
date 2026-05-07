// =====================================================
// Competitive Visibility Audit - data model
// =====================================================

export type AuditStatus =
  | 'discovering'
  | 'awaiting_confirmation'
  | 'running'
  | 'partial'
  | 'complete'
  | 'failed';

export type StageStatus = 'pending' | 'running' | 'complete' | 'partial' | 'failed';

export type BdProduct = 'SERP' | 'UNLOCKER' | 'SCRAPER' | 'CLAUDE';

export type LogType =
  | 'INFO'
  | 'STAGE_START'
  | 'STAGE_DONE'
  | 'STAGE_FAIL'
  | 'BD_CALL'
  | 'BD_DONE'
  | 'BD_FAIL'
  | 'CLAUDE_CALL'
  | 'CLAUDE_DONE'
  | 'CLAUDE_FAIL'
  | 'WARN'
  | 'ERROR';

// =====================================================
// Inputs
// =====================================================

export interface AuditInput {
  brandName: string;
  location: string;
  recipientEmail?: string;
}

// =====================================================
// Stage 0 - brand discovery
// =====================================================

export interface BrandProfileLite {
  category: string;
  valueProp: string;
  targetSegments: string[];
  keyFeatures: string[];
  pricingModel: string;
}

export interface DiscoveredBrand {
  url: string;
  domain: string;
  brandProfile: BrandProfileLite;
}

// =====================================================
// Stage 2 - SERP results
// =====================================================

export interface SerpItem {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface SerpResultByKeyword {
  keyword: string;
  items: SerpItem[];
}

export interface CompetitorBrand {
  domain: string;
  url: string;
  appearanceCount: number;
  rankings: { keyword: string; rank: number; title: string }[];
}

// =====================================================
// Stage 3 - homepage profiles
// =====================================================

export interface BrandProfile {
  domain: string;
  url: string;
  category: string;
  valueProp: string;
  features: string[];
  pricingModel: string;
  targetSegments: string[];
  trustSignals: string[];
  isSelf: boolean;
}

// =====================================================
// Stage 4 - Third-party citations (listicles, forums, reviews)
// =====================================================

export type CitationSourceType =
  | 'listicle'      // numbered "best X" / top-N roundup articles
  | 'review'        // single-product or rating-style reviews
  | 'comparison'    // "X vs Y" articles
  | 'forum'         // reddit, quora — community discussion
  | 'news'          // press / news articles
  | 'media'         // blog posts, magazine pieces
  | 'analyst'       // Gartner / Forrester / IDC
  | 'other';

export interface BrandCitation {
  brand: string;
  domain?: string;
  position: number | null;     // numeric rank in a list, null otherwise
  recommendation: 'top pick' | 'recommended' | 'mentioned' | 'criticized';
  quote: string;               // short verbatim phrase, capped under 15 words
}

export interface CitationSource {
  url: string;
  domain: string;
  title: string;
  type: CitationSourceType;
  fromKeywords: string[];
  citations: BrandCitation[];
  status: 'success' | 'partial' | 'failed';
  errorMessage?: string;
}

export interface BrandCitationProfile {
  brand: string;
  domain?: string;
  citationCount: number;       // distinct sources mentioning this brand
  topPickCount: number;        // sources where this brand is #1 / "top pick"
  averagePosition: number | null;
  recommendedCount: number;
  criticizedCount: number;
  mentionedCount: number;
  sources: { url: string; sourceTitle: string; sourceDomain: string; position: number | null; quote: string; recommendation: BrandCitation['recommendation'] }[];
  isSelf: boolean;
}

export interface CitationStageOutput {
  sources: CitationSource[];
  profiles: BrandCitationProfile[];
}

/**
 * Carrier passed from Stage 2/3 into Stage 4. Stage 3 fills `cachedText`
 * for listicles already unlocked during competitor filtering; Stage 2
 * forwards forum/social hosts that never reach Stage 3, so those have
 * no cached text and Stage 4 must unlock them itself.
 */
export interface CitationCandidate {
  url: string;
  domain: string;
  title: string;
  sourceType: CitationSourceType;
  fromKeywords: string[];
  cachedText?: string;
}

// =====================================================
// Stage 5 - AI mentions (was Stage 4)
// =====================================================

export type AiEngine = 'chatgpt' | 'perplexity' | 'grok' | 'gemini';

export interface AiMention {
  engine: AiEngine;
  query: string;
  rawResponse: string;
  brandsMentioned: {
    brand: string;
    sentiment: 'positive' | 'neutral' | 'negative';
    context: string;
  }[];
  status: 'success' | 'partial' | 'failed';
}

// =====================================================
// Stage 6 - deep page insights (was Stage 5)
// =====================================================

export type DeepPageType = 'pricing' | 'about' | 'features';

export interface DeepPageInsight {
  domain: string;
  pageType: DeepPageType;
  url: string;
  summary: string;
}

// =====================================================
// Stage 7 - executive summary (was Stage 6)
// =====================================================

export interface RecommendationItem {
  action: string;
  rationale: string;
}

export interface VisibilityScore {
  /** 0-100 composite score generated by the LLM, weighting SERP / AI / citations. */
  value: number;
  /** Single-sentence rationale referencing the specific pillar data points. */
  rationale: string;
}

export interface ExecutiveSummary {
  /** Optional for backward compat with reports written before LLM-driven scoring shipped. */
  visibilityScore?: VisibilityScore;
  narrativeArc: string;
  headline: string;
  keyFindings: string[];
  quickWins: RecommendationItem[];
  strategicPlays: RecommendationItem[];
}

// =====================================================
// Final report
// =====================================================

export interface AuditReport {
  brand: DiscoveredBrand;
  keywords: string[];
  serp: SerpResultByKeyword[];
  competitors: CompetitorBrand[];
  brandProfiles: BrandProfile[];
  aiMentions: AiMention[];
  deepInsights: DeepPageInsight[];
  executiveSummary: ExecutiveSummary;
  citations?: CitationStageOutput;
}

// =====================================================
// Progress tracking
// =====================================================

export interface SubTask {
  id: string;
  label: string;
  status: StageStatus;
  bdProduct?: BdProduct;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export interface StageProgress {
  id: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  name: string;
  status: StageStatus;
  startedAt?: number;
  endedAt?: number;
  subTasks: SubTask[];
  error?: string;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: LogType;
  message: string;
  bdProduct?: BdProduct;
  stage?: number;
  durationMs?: number;
}

// =====================================================
// Audit state container
// =====================================================

export interface Audit {
  id: string;
  status: AuditStatus;
  input: AuditInput;
  brand?: DiscoveredBrand;
  stages: StageProgress[];
  report?: AuditReport;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

// =====================================================
// API request/response shapes
// =====================================================

export interface StartAuditRequest {
  brandName: string;
  location: string;
  recipientEmail?: string;
}

export interface StartAuditResponse {
  auditId: string;
}

export interface ConfirmAuditRequest {
  url?: string;
}

export interface EmailAuditRequest {
  recipientEmail: string;
}

export interface AuditStatusResponse {
  audit: Audit;
}

// =====================================================
// Stage definitions
// =====================================================

export const STAGES: { id: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; name: string }[] = [
  { id: 0, name: 'Brand discovery' },
  { id: 1, name: 'Keyword generation' },
  { id: 2, name: 'SERP rankings' },
  { id: 3, name: 'Homepage extraction' },
  { id: 4, name: 'Third-party citations' },
  { id: 5, name: 'AI engine mentions' },
  { id: 6, name: 'Deep page scrape' },
  { id: 7, name: 'Executive synthesis' },
];

export const KEYWORD_COUNT = 8;
export const COMPETITOR_COUNT = 5;
export const SERP_RESULTS_PER_KEYWORD = 20;
