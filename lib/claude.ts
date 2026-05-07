// =====================================================
// Anthropic API wrapper
//
// Direct API calls via @anthropic-ai/sdk. Pure text-in/text-out —
// no tool use, no streaming, no session state.
// =====================================================

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 1;

// Model IDs for the Anthropic Messages API.
// Routing rule:
//   classification        -> Haiku  (filter listicles, pick best URL per category)
//   basic processing      -> Sonnet (extract profile, parse AI mentions, summarize page)
//   report generation     -> Opus   (keyword generation, executive synthesis)
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
export const MODEL_SONNET = 'claude-sonnet-4-5-20250514';
export const MODEL_OPUS = 'claude-opus-4-20250115';
const DEFAULT_MODEL = MODEL_SONNET;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export class ClaudeApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ClaudeApiError';
  }
}

interface RunOptions {
  timeoutMs?: number;
  model?: string;
  appendSystemPrompt?: string;
  systemPrompt?: string;
}

async function runOnce(prompt: string, opts: RunOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  let system: string | undefined;
  if (opts.systemPrompt && opts.appendSystemPrompt) {
    system = opts.systemPrompt + '\n\n' + opts.appendSystemPrompt;
  } else {
    system = opts.systemPrompt || opts.appendSystemPrompt;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await getClient().messages.create(
      {
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) throw new ClaudeApiError('No text content in Claude response');
    return text;
  } catch (err) {
    if (err instanceof ClaudeApiError) throw err;
    if (
      (err instanceof Error && err.name === 'AbortError') ||
      (err instanceof Anthropic.APIConnectionError && controller.signal.aborted)
    ) {
      throw new ClaudeApiError(`Claude API timed out after ${timeoutMs}ms`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ClaudeApiError(`Claude API error (${err.status}): ${err.message}`, err.status);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a prompt against the Anthropic Messages API and return the response text.
 * Includes one retry on transient failures.
 */
export async function runClaude(prompt: string, opts: RunOptions = {}): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await runOnce(prompt, opts);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new ClaudeApiError(String(lastErr));
}

const JSON_SYSTEM_PROMPT =
  'You are a structured-data extraction service. Your only job is to read the user message and output a single JSON value (object or array) that matches the schema described in that message. Output rules: (1) Output ONLY the JSON value. No prose, no explanation, no apology, no preamble, no follow-up. (2) The very first character of your response MUST be { or [. (3) The very last character MUST be } or ]. (4) No markdown code fences. (5) Do not invent or fetch additional information; rely only on what the user message provides. (6) Do NOT reference tools, do NOT output tool-call JSON like {"tool": "..."}, do NOT suggest fetching or scraping anything. Treat the user message text as the only source of truth and extract from it directly.';

/**
 * Convenience: run a prompt and parse the response as JSON.
 * Uses a strict JSON-only system prompt so Claude does not add prose.
 */
export async function runClaudeJson<T = unknown>(prompt: string, opts: RunOptions = {}): Promise<T> {
  const raw = await runClaude(prompt, {
    ...opts,
    systemPrompt: opts.systemPrompt || JSON_SYSTEM_PROMPT,
  });
  return parseJsonResponse<T>(raw);
}

/**
 * Robust JSON extractor. Tries in order:
 *   1. Direct JSON.parse on the trimmed text
 *   2. Strip ```json fences then parse
 *   3. Find the first balanced {...} or [...] block via bracket counting
 */
export function parseJsonResponse<T = unknown>(text: string): T {
  const cleaned = text.trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // continue
  }

  let stripped = cleaned;
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(stripped) as T;
    } catch {
      // continue
    }
  }

  const balanced = extractFirstBalancedJson(stripped);
  if (balanced) {
    try {
      return JSON.parse(balanced) as T;
    } catch {
      // fall through
    }
  }

  throw new ClaudeApiError(`Could not parse Claude response as JSON. Preview: ${text.slice(0, 200)}`);
}

function extractFirstBalancedJson(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }
  }
  return null;
}

/**
 * Warmup ping. Returns true if the Anthropic API key is valid and the API is reachable.
 */
export async function warmup(): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  try {
    await runOnce('Reply with the single word: ok', { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}
