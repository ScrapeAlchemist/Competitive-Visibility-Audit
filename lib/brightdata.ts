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
  const body = typeof html === 'string' ? html : JSON.stringify(html);
  // BD sometimes returns 200 with empty body on policy blocks; treat as failure
  if (!body || body.length < 200) {
    throw new BdError(`Unlocker returned empty/short body for ${url} (${body?.length ?? 0} chars) - likely a policy block or anti-bot redirect`);
  }
  return body;
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
// AI engine mentions via Bright Data AI Search dataset APIs
// 3-phase flow: trigger -> poll progress -> download snapshot.
// Each (engine, query) pair fires N redundant trigger requests; we
// take the snapshot that becomes ready first. Mirrors the original
// notebook's REDUNDANT_REQUESTS=3 pattern for speed.
// =====================================================

export type AiEngineId = 'chatgpt' | 'perplexity' | 'grok' | 'gemini';

interface AiEngineConfig {
  datasetId: string;
  name: string;
  url: string;
  payloadStyle: 'array' | 'inputWrapper';
  countrySupportsIL: boolean;
}

export const AI_ENGINES: Record<AiEngineId, AiEngineConfig> = {
  chatgpt: {
    datasetId: 'gd_m7aof0k82r803d5bjm',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    payloadStyle: 'array',
    countrySupportsIL: true,
  },
  perplexity: {
    datasetId: 'gd_m7dhdot1vw9a7gc1n',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai',
    payloadStyle: 'array',
    countrySupportsIL: true,
  },
  grok: {
    datasetId: 'gd_m8ve0u141icu75ae74',
    name: 'Grok',
    url: 'https://grok.com/',
    payloadStyle: 'array',
    countrySupportsIL: true,
  },
  gemini: {
    datasetId: 'gd_mbz66arm2mf9cu856y',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    payloadStyle: 'inputWrapper',
    countrySupportsIL: false,
  },
};

export const REDUNDANT_REQUESTS = 3;

export interface AiEngineQueryResult {
  engine: AiEngineId;
  status: 'success' | 'failed';
  query: string;
  rawText: string;
  errorMessage?: string;
  snapshotId?: string;
  durationMs?: number;
}

const BD_DATASETS_BASE = 'https://api.brightdata.com/datasets/v3';

async function triggerAiSnapshot(
  engine: AiEngineId,
  query: string,
  country: string
): Promise<string | null> {
  if (!TOKEN) throw new BdError('BRIGHTDATA_API_TOKEN not set');
  const cfg = AI_ENGINES[engine];
  // Gemini doesn't support Israel; strip the country in that case
  const queryCountry = !cfg.countrySupportsIL && country.toUpperCase() === 'IL' ? '' : country.toUpperCase();
  const item = { url: cfg.url, prompt: query, country: queryCountry };
  const payload = cfg.payloadStyle === 'inputWrapper' ? { input: [item] } : [item];

  try {
    const res = await fetchWithTimeout(
      `${BD_DATASETS_BASE}/trigger?dataset_id=${cfg.datasetId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      30_000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { snapshot_id?: string };
    return data.snapshot_id || null;
  } catch {
    return null;
  }
}

type SnapshotStatus = 'running' | 'ready' | 'failed' | 'unknown';

async function checkSnapshotStatus(snapshotId: string): Promise<SnapshotStatus> {
  if (!TOKEN) return 'unknown';
  try {
    const res = await fetchWithTimeout(
      `${BD_DATASETS_BASE}/progress/${snapshotId}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      10_000
    );
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { status?: string };
    if (data.status === 'ready') return 'ready';
    if (data.status === 'failed') return 'failed';
    return 'running';
  } catch {
    return 'unknown';
  }
}

async function downloadSnapshot(snapshotId: string): Promise<string | null> {
  if (!TOKEN) return null;
  try {
    const res = await fetchWithTimeout(
      `${BD_DATASETS_BASE}/snapshot/${snapshotId}?format=json`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      30_000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const item = data[0];
    const text =
      (item['answer_text_markdown'] as string | undefined) ||
      (item['answer_text'] as string | undefined) ||
      (item['answer'] as string | undefined) ||
      JSON.stringify(item).slice(0, 12_000);
    return text || null;
  } catch {
    return null;
  }
}

interface QueryOpts {
  redundancy?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onTriggered?: (snapshotId: string, attemptIdx: number) => void;
  onFirstReady?: (snapshotId: string, elapsedMs: number) => void;
}

/**
 * Race N redundant snapshot triggers, take the first ready, download it.
 */
export async function queryAiEngineRaced(
  engine: AiEngineId,
  query: string,
  country: string,
  opts: QueryOpts = {}
): Promise<AiEngineQueryResult> {
  const redundancy = opts.redundancy ?? REDUNDANT_REQUESTS;
  const pollIntervalMs = opts.pollIntervalMs ?? 4000;
  const maxWaitMs = opts.maxWaitMs ?? 180_000;
  const startedAt = Date.now();

  // Phase 1: trigger N snapshots in parallel
  const triggerResults = await Promise.all(
    Array.from({ length: redundancy }, () => triggerAiSnapshot(engine, query, country))
  );
  const snapshotIds = triggerResults.filter((id): id is string => !!id);
  snapshotIds.forEach((id, idx) => opts.onTriggered?.(id, idx));
  if (snapshotIds.length === 0) {
    return {
      engine,
      query,
      status: 'failed',
      rawText: '',
      errorMessage: 'All trigger requests failed',
      durationMs: Date.now() - startedAt,
    };
  }

  // Phase 2: poll all snapshots in parallel until one becomes ready
  let firstReady: string | null = null;
  while (Date.now() - startedAt < maxWaitMs && !firstReady) {
    const statuses = await Promise.all(snapshotIds.map((id) => checkSnapshotStatus(id)));
    const idx = statuses.findIndex((s) => s === 'ready');
    if (idx >= 0) {
      firstReady = snapshotIds[idx];
      opts.onFirstReady?.(firstReady, Date.now() - startedAt);
      break;
    }
    if (statuses.every((s) => s === 'failed' || s === 'unknown')) {
      return {
        engine,
        query,
        status: 'failed',
        rawText: '',
        errorMessage: 'All snapshots failed',
        durationMs: Date.now() - startedAt,
      };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  if (!firstReady) {
    return {
      engine,
      query,
      status: 'failed',
      rawText: '',
      errorMessage: `Timed out after ${maxWaitMs}ms (no snapshot ready)`,
      durationMs: Date.now() - startedAt,
    };
  }

  // Phase 3: download the first-ready snapshot
  const text = await downloadSnapshot(firstReady);
  if (!text) {
    return {
      engine,
      query,
      status: 'failed',
      rawText: '',
      errorMessage: 'Snapshot ready but download returned no text',
      snapshotId: firstReady,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    engine,
    query,
    status: 'success',
    rawText: text,
    snapshotId: firstReady,
    durationMs: Date.now() - startedAt,
  };
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
