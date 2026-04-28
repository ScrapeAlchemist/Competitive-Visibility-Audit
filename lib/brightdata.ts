// =====================================================
// Bright Data API wrapper - SERP, Web Unlocker, Scraper
// =====================================================

const BD_BASE = 'https://api.brightdata.com/request';
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const SERP_ZONE = process.env.BRIGHTDATA_SERP_ZONE || 'serp';
const UNLOCKER_ZONE = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE || 'unlocker';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 3000];

export class BdError extends Error {
  constructor(message: string, public status?: number, public stage?: string) {
    super(message);
    this.name = 'BdError';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function bdRequest<T = unknown>(
  zone: string,
  url: string,
  options: { format?: 'raw' | 'parsed_light'; dataFormat?: string; timeoutMs?: number } = {}
): Promise<T> {
  if (!TOKEN) throw new BdError('BRIGHTDATA_API_TOKEN not set');

  const body: Record<string, unknown> = {
    zone,
    url,
    format: options.format || 'raw',
  };
  if (options.dataFormat) body.data_format = options.dataFormat;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        BD_BASE,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        options.timeoutMs || DEFAULT_TIMEOUT_MS
      );

      if (!res.ok) {
        throw new BdError(`BD request failed: ${res.status} ${res.statusText}`, res.status);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new BdError(String(lastErr));
}

// =====================================================
// SERP API
// =====================================================

export interface SerpRawItem {
  link?: string;
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
}

export interface SerpRawResponse {
  organic?: SerpRawItem[];
}

export interface SerpResult {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  rank: number;
}

export async function searchSerp(query: string, opts: { num?: number; country?: string } = {}): Promise<SerpResult[]> {
  const num = opts.num ?? 20;
  const params = new URLSearchParams({ q: query, num: String(num) });
  if (opts.country) params.set('gl', opts.country);
  const url = `https://www.google.com/search?${params.toString()}`;

  const data = await bdRequest<SerpRawResponse>(SERP_ZONE, url, {
    format: 'raw',
    dataFormat: 'parsed_light',
  });

  const items = data.organic || [];
  return items.slice(0, num).map((item, idx) => {
    const itemUrl = item.link || item.url || '';
    let domain = '';
    try {
      domain = new URL(itemUrl).hostname.replace(/^www\./, '');
    } catch {
      domain = '';
    }
    return {
      url: itemUrl,
      domain,
      title: item.title || '',
      snippet: item.description || item.snippet || '',
      rank: idx + 1,
    };
  });
}

// =====================================================
// Web Unlocker
// =====================================================

export async function unlockUrl(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const html = await bdRequest<string>(UNLOCKER_ZONE, url, {
    format: 'raw',
    timeoutMs: opts.timeoutMs,
  });
  return typeof html === 'string' ? html : JSON.stringify(html);
}

export function htmlToCleanText(html: string, maxLen = 8000): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// =====================================================
// AI engine mentions (best-effort - uses Web Unlocker on engines that
// allow public search URLs; falls back to a labeled stub for engines that
// require auth/dataset configuration)
// =====================================================

export type AiEngineId = 'chatgpt' | 'perplexity' | 'grok' | 'gemini';

export interface AiEngineQueryResult {
  engine: AiEngineId;
  status: 'success' | 'failed';
  query: string;
  rawText: string;
  errorMessage?: string;
}

/**
 * Perplexity has a public search URL that Web Unlocker can usually reach.
 * Returns the cleaned text response.
 */
async function queryPerplexity(query: string): Promise<AiEngineQueryResult> {
  const url = `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`;
  try {
    const html = await unlockUrl(url, { timeoutMs: 45_000 });
    const text = htmlToCleanText(html, 12_000);
    return { engine: 'perplexity', status: 'success', query, rawText: text };
  } catch (err) {
    return {
      engine: 'perplexity',
      status: 'failed',
      query,
      rawText: '',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * For engines that require auth (ChatGPT, Grok, Gemini), the proper integration
 * is via Bright Data's Web Scraper API datasets. Without dataset IDs configured,
 * we mark the result as failed but with a clear hint - this keeps the parallel
 * Stage 4 visualization honest while not blocking the demo.
 */
async function queryAuthedEngine(engine: AiEngineId, query: string): Promise<AiEngineQueryResult> {
  // Try a public-search-style URL that Web Unlocker may handle.
  // ChatGPT does not expose public answers; Gemini search routes to Google AI Overviews.
  if (engine === 'gemini') {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=50`;
    try {
      const html = await unlockUrl(url, { timeoutMs: 45_000 });
      const text = htmlToCleanText(html, 12_000);
      return { engine, status: 'success', query, rawText: text };
    } catch (err) {
      return {
        engine,
        status: 'failed',
        query,
        rawText: '',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
  // ChatGPT / Grok require BD Scraper API datasets
  return {
    engine,
    status: 'failed',
    query,
    rawText: '',
    errorMessage: `${engine} requires BD Scraper API dataset; not configured`,
  };
}

export async function queryAiEngine(engine: AiEngineId, query: string): Promise<AiEngineQueryResult> {
  if (engine === 'perplexity') return queryPerplexity(query);
  return queryAuthedEngine(engine, query);
}

// =====================================================
// Warmup - one tiny call against each product
// =====================================================

export async function warmup(): Promise<{ serp: boolean; unlocker: boolean }> {
  const [serpOk, unlockerOk] = await Promise.all([
    searchSerp('hello world', { num: 1 })
      .then(() => true)
      .catch(() => false),
    unlockUrl('https://example.com')
      .then(() => true)
      .catch(() => false),
  ]);
  return { serp: serpOk, unlocker: unlockerOk };
}
