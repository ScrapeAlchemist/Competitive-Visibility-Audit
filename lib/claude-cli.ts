// =====================================================
// Claude CLI subprocess wrapper
//
// Spawns `claude -p "<prompt>" --output-format json`, captures stdout,
// parses the structured response. One-shot, no interactive session.
// =====================================================

import { spawn } from 'child_process';

const CLI_PATH = process.env.CLAUDE_CLI_PATH || 'claude';
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 1;

export class ClaudeCliError extends Error {
  constructor(message: string, public exitCode?: number, public stderr?: string) {
    super(message);
    this.name = 'ClaudeCliError';
  }
}

interface ClaudeCliJsonOutput {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  // Other fields we don't need
  [key: string]: unknown;
}

interface RunOptions {
  timeoutMs?: number;
  model?: string;
  appendSystemPrompt?: string;
  systemPrompt?: string;
}

async function runOnce(prompt: string, opts: RunOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  // --tools "" disables all built-in tools so Claude treats this as pure text-in-text-out.
  // --no-session-persistence avoids writing session state to disk for these one-shot calls.
  const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
  if (opts.appendSystemPrompt) args.push('--append-system-prompt', opts.appendSystemPrompt);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(CLI_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ClaudeCliError(`spawn error: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new ClaudeCliError(`Claude CLI timed out after ${timeoutMs}ms`));
      }
      if (code !== 0) {
        return reject(new ClaudeCliError(`Claude CLI exited with code ${code}`, code ?? undefined, stderr));
      }
      try {
        const parsed = JSON.parse(stdout) as ClaudeCliJsonOutput;
        if (parsed.is_error) {
          return reject(new ClaudeCliError(`Claude CLI returned error: ${parsed.result || 'unknown'}`));
        }
        resolve(parsed.result || '');
      } catch {
        // If JSON parse fails, return raw stdout (sometimes single-line text)
        if (stdout.trim()) return resolve(stdout.trim());
        reject(new ClaudeCliError('Failed to parse Claude CLI output', undefined, stderr));
      }
    });

    // Send prompt via stdin so we don't worry about shell escaping
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Run a prompt against the Claude CLI and return the response text.
 * Includes one retry on non-zero exit.
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
  throw lastErr instanceof Error ? lastErr : new ClaudeCliError(String(lastErr));
}

const JSON_SYSTEM_PROMPT =
  'You are a structured-data extraction service. Your only job is to read the user message and output a single JSON value (object or array) that matches the schema described in that message. Output rules: (1) Output ONLY the JSON value. No prose, no explanation, no apology, no preamble, no follow-up. (2) The very first character of your response MUST be { or [. (3) The very last character MUST be } or ]. (4) No markdown code fences. (5) Do not invent or fetch additional information; rely only on what the user message provides.';

/**
 * Convenience: run a prompt and parse the response as JSON.
 * Replaces the default Claude Code system prompt with a strict JSON-only one
 * so Claude does not try to use tools or add prose.
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

  // Try direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // continue
  }

  // Strip markdown fences and try again
  let stripped = cleaned;
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(stripped) as T;
    } catch {
      // continue
    }
  }

  // Bracket-counting scan for the first balanced { ... } or [ ... ]
  const balanced = extractFirstBalancedJson(stripped);
  if (balanced) {
    try {
      return JSON.parse(balanced) as T;
    } catch {
      // fall through
    }
  }

  throw new ClaudeCliError(`Could not parse Claude response as JSON. Preview: ${text.slice(0, 200)}`);
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
 * Warmup ping. Returns true if Claude CLI is callable.
 */
export async function warmup(): Promise<boolean> {
  try {
    await runOnce('Reply with the single word: ok', { timeoutMs: 30_000 });
    return true;
  } catch {
    return false;
  }
}
