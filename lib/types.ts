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
// Stage 4 - AI mentions
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
// Stage 5 - deep page insights
// =====================================================

export type DeepPageType = 'pricing' | 'about' | 'features';

export interface DeepPageInsight {
  domain: string;
  pageType: DeepPageType;
  url: string;
  summary: string;
}

// =====================================================
// Stage 6 - executive summary
// =====================================================

export interface ExecutiveSummary {
  headline: string;
  keyFindings: string[];
  competitiveGaps: string[];
  recommendations: string[];
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
  id: 0 | 1 | 2 | 3 | 4 | 5 | 6;
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

export const STAGES: { id: 0 | 1 | 2 | 3 | 4 | 5 | 6; name: string }[] = [
  { id: 0, name: 'Brand discovery' },
  { id: 1, name: 'Keyword generation' },
  { id: 2, name: 'SERP rankings' },
  { id: 3, name: 'Homepage extraction' },
  { id: 4, name: 'AI engine mentions' },
  { id: 5, name: 'Deep page scrape' },
  { id: 6, name: 'Executive synthesis' },
];

export const KEYWORD_COUNT = 8;
export const COMPETITOR_COUNT = 5;
export const SERP_RESULTS_PER_KEYWORD = 20;
