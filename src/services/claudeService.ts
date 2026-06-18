import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';

const { logDebug, logInfo } = createLogger('[claudeService]');

// ── Concurrency semaphore ─────────────────────────────────────────────────────
class Semaphore {
  private readonly pending: Array<() => void> = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    logDebug('semaphore', `AI call queued (queue depth: ${this.pending.length + 1})`);
    return new Promise((resolve) => this.pending.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.pending.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  get queueDepth(): number {
    return this.pending.length;
  }
}

const _concurrency = parseInt(process.env.CLAUDE_CONCURRENCY || '3', 10);
const _semaphore = new Semaphore(
  Number.isFinite(_concurrency) && _concurrency > 0 ? _concurrency : 3
);

/**
 * Resolve the path to a command file, checking custom dir first then example dir.
 * Returns the path and source, or null if neither exists.
 */
function resolveCommandPath(
  rootDir: string,
  name: string
): { path: string; source: 'custom' | 'example' } | null {
  const customPath = path.join(rootDir, '.claude', 'commands', `${name}.md`);
  if (fs.existsSync(customPath)) return { path: customPath, source: 'custom' };
  const examplePath = path.join(rootDir, '.claude', 'commands.example', `${name}.md`);
  if (fs.existsSync(examplePath)) return { path: examplePath, source: 'example' };
  return null;
}

/**
 * Load the product context from .product-context.md (custom) or
 * .product-context.example.md (fallback). Returns the file content.
 */
export function loadProductContext(rootDir: string): {
  content: string;
  source: 'custom' | 'example';
} {
  const customPath = path.join(rootDir, '.product-context.md');
  if (fs.existsSync(customPath)) {
    return { content: fs.readFileSync(customPath, 'utf-8'), source: 'custom' };
  }
  const examplePath = path.join(rootDir, '.product-context.example.md');
  if (fs.existsSync(examplePath)) {
    return { content: fs.readFileSync(examplePath, 'utf-8'), source: 'example' };
  }
  return { content: '', source: 'example' };
}

export function loadCommand(rootDir: string, name: string): string | null {
  const resolved = resolveCommandPath(rootDir, name);
  if (!resolved) return null;
  let content = fs
    .readFileSync(resolved.path, 'utf-8')
    .replace(/^---[\s\S]*?---\n?/, '')
    .trim();
  // Inject product context into {{PRODUCT_CONTEXT}} placeholder
  if (content.includes('{{PRODUCT_CONTEXT}}')) {
    const ctx = loadProductContext(rootDir);
    content = content.replace('{{PRODUCT_CONTEXT}}', ctx.content);
  }
  return content;
}

/**
 * Load the full raw content of a command (including YAML frontmatter) plus its source.
 * Used by the Skills UI to display and edit commands.
 */
export function loadCommandRaw(
  rootDir: string,
  name: string
): { content: string; source: 'custom' | 'example' } | null {
  const resolved = resolveCommandPath(rootDir, name);
  if (!resolved) return null;
  return {
    content: fs.readFileSync(resolved.path, 'utf-8'),
    source: resolved.source,
  };
}

const MOCK_RESPONSE = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: Medium
Created: 2026-01-01T00:00:00.000Z
---

## Mock Epic Title

## Context
Mock context for testing.

## Objective
Mock objective.

## Value
Mock value.

## Execution
Mock execution steps.

## Acceptance Criteria
- Given a test environment, when tests run, then mocks are returned.

## Out of Scope
N/A
`;

// Model override — read from settings file if present
let _modelOverride: string | null = null;
// Provider override — 'claude-cli' (default) | 'github-models'
let _providerOverride: string | null = null;

export function setModelOverride(model: string | null | undefined): void {
  _modelOverride = model || null;
}

export function getModelOverride(): string | null {
  return _modelOverride;
}

export function setProviderOverride(provider: string | null | undefined): void {
  _providerOverride = provider || null;
}

export function getProviderOverride(): string | null {
  return _providerOverride;
}

// ── Ollama local provider ──────────────────────────────────────────────────────
function _getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
}

const OLLAMA_CACHE_TTL_MS = 30_000;
let _ollamaHealthCache: { result: boolean; expiresAt: number } | null = null;
let _ollamaModelsCache: { result: Array<{ id: string; name: string }>; expiresAt: number } | null =
  null;

async function _checkOllamaHealth(): Promise<boolean> {
  const now = Date.now();
  if (_ollamaHealthCache && now < _ollamaHealthCache.expiresAt) return _ollamaHealthCache.result;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await fetch(`${_getOllamaBaseUrl()}/`, { signal: controller.signal });
      _ollamaHealthCache = { result: res.ok, expiresAt: now + OLLAMA_CACHE_TTL_MS };
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    _ollamaHealthCache = { result: false, expiresAt: now + OLLAMA_CACHE_TTL_MS };
    return false;
  }
}

async function _fetchOllamaModels(): Promise<Array<{ id: string; name: string }>> {
  const now = Date.now();
  if (_ollamaModelsCache && now < _ollamaModelsCache.expiresAt) return _ollamaModelsCache.result;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    let res: Response;
    try {
      res = await fetch(`${_getOllamaBaseUrl()}/api/tags`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      _ollamaModelsCache = { result: [], expiresAt: now + OLLAMA_CACHE_TTL_MS };
      return [];
    }
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (json?.models || []).map((m: { name: string }) => ({
      id: m.name,
      name: m.name,
    }));
    _ollamaModelsCache = { result: models, expiresAt: now + OLLAMA_CACHE_TTL_MS };
    return models;
  } catch {
    _ollamaModelsCache = { result: [], expiresAt: now + OLLAMA_CACHE_TTL_MS };
    return [];
  }
}

export function _resetOllamaCache(): void {
  _ollamaHealthCache = null;
  _ollamaModelsCache = null;
}

/**
 * Returns the list of available providers based on configured tokens/binaries.
 * Always includes 'claude-cli'. Adds 'github-models' when GITHUB_MODELS_TOKEN is set.
 * Adds 'ollama' when a local Ollama instance is reachable (health-checked with 2s timeout).
 */
export async function getAvailableProviders(): Promise<
  Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>
> {
  const providers: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string }>;
  }> = [
    {
      id: 'claude-cli',
      name: 'Claude (Anthropic)',
      models: [
        { id: '', name: 'Default (Sonnet)' },
        { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
        { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
        { id: 'claude-opus-4-6', name: 'Opus 4.6' },
      ],
    },
  ];

  if (process.env.GITHUB_MODELS_TOKEN) {
    providers.push({
      id: 'github-models',
      name: 'GitHub Models',
      models: [
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
        { id: 'deepseek/DeepSeek-V3-0324', name: 'DeepSeek V3' },
        { id: 'deepseek/DeepSeek-R1', name: 'DeepSeek R1' },
        { id: 'meta/Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B' },
        { id: 'Mistral-large-2411', name: 'Mistral Large' },
      ],
    });
  }

  if (await _checkOllamaHealth()) {
    const ollamaModels = await _fetchOllamaModels();
    providers.push({
      id: 'ollama',
      name: 'Ollama (local)',
      models: ollamaModels,
    });
  }

  return providers;
}

function buildClaudeArgs(prompt: string): string[] {
  const args = ['-p', prompt];
  if (_modelOverride) args.push('--model', _modelOverride);
  return args;
}

// callClaude (non-streaming): default 3 min, configurable via CLAUDE_TIMEOUT_MS
const CALL_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 180_000;
// streamClaude (streaming): default 5 min (CLAUDE_TIMEOUT_MS * 1.67, or own env var)
const STREAM_TIMEOUT_MS = Number(process.env.CLAUDE_STREAM_TIMEOUT_MS) || 300_000;

// Strip code fences that models sometimes wrap around output.
export function normalizeOutput(content: string): string {
  let c = content.trim();
  // Unwrap yaml-fenced frontmatter block that appears before the body
  c = c.replace(/^```[\w]+\n(---[\s\S]*?---)\n```\n?/, '$1\n');
  // Strip any remaining outer code fence (```markdown, ``` etc.)
  c = c.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return c.trim();
}

// Error patterns that indicate a user-content problem — do not retry these.
const NO_RETRY_PATTERNS = [
  /invalid api key/i,
  /permission denied/i,
  /content policy/i,
  /context length/i,
];

function _spawnClaude(rootDir: string, prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const proc = spawn('claude', buildClaudeArgs(prompt), {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(Object.assign(new Error('Claude subprocess timed out'), { isTimeout: true }));
    }, timeoutMs);
    proc.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      resolve(normalizeOutput(out));
    });
  });
}

const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';

async function _callOpenAICompatible(
  endpoint: string,
  model: string,
  prompt: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json?.choices?.[0]?.message?.content ?? '';
  return normalizeOutput(content);
}

async function _streamOpenAICompatible(
  endpoint: string,
  model: string,
  prompt: string,
  extraHeaders: Record<string, string>,
  onChunk: (chunk: string) => void,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${res.status}: ${errText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
        } catch {
          /* malformed SSE chunk — skip */
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

async function _callGitHubModels(prompt: string): Promise<string> {
  const token = process.env.GITHUB_MODELS_TOKEN;
  if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set');
  return _callOpenAICompatible(
    GITHUB_MODELS_ENDPOINT,
    _modelOverride || 'openai/gpt-4o',
    prompt,
    { Authorization: `Bearer ${token}` },
    CALL_TIMEOUT_MS
  );
}

async function _streamGitHubModels(
  prompt: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  const token = process.env.GITHUB_MODELS_TOKEN;
  if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set');
  return _streamOpenAICompatible(
    GITHUB_MODELS_ENDPOINT,
    _modelOverride || 'openai/gpt-4o',
    prompt,
    { Authorization: `Bearer ${token}` },
    onChunk,
    STREAM_TIMEOUT_MS
  );
}

function _ollamaDefaultModel(): string {
  return _ollamaModelsCache?.result?.[0]?.id || '';
}

async function _callOllama(prompt: string): Promise<string> {
  return _callOpenAICompatible(
    `${_getOllamaBaseUrl()}/v1/chat/completions`,
    _modelOverride || _ollamaDefaultModel(),
    prompt,
    {},
    CALL_TIMEOUT_MS
  );
}

async function _streamOllama(prompt: string, onChunk: (chunk: string) => void): Promise<void> {
  return _streamOpenAICompatible(
    `${_getOllamaBaseUrl()}/v1/chat/completions`,
    _modelOverride || _ollamaDefaultModel(),
    prompt,
    {},
    onChunk,
    STREAM_TIMEOUT_MS
  );
}

/**
 * Invoke the AI provider non-streaming. Dispatches to GitHub Models or Claude CLI
 * based on the current provider override. Retries up to `maxAttempts` times with
 * exponential back-off (2s, 4s, 8s). User-content errors are not retried.
 */
export async function callClaude(
  rootDir: string,
  prompt: string,
  { maxAttempts = 3 } = {}
): Promise<string> {
  if (process.env.MOCK_CLAUDE) return Promise.resolve(MOCK_RESPONSE);

  const t = Date.now();
  await _semaphore.acquire();
  try {
    const provider = _providerOverride || 'claude-cli';
    const model = _modelOverride || '(default)';
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let result: string;
        if (provider === 'github-models') {
          result = await _callGitHubModels(prompt);
        } else if (provider === 'ollama') {
          result = await _callOllama(prompt);
        } else {
          result = await _spawnClaude(rootDir, prompt, CALL_TIMEOUT_MS);
        }
        logInfo('callClaude', `provider=${provider} model=${model} duration=${Date.now() - t}ms`);
        return result;
      } catch (err: unknown) {
        lastErr = err;
        const e = err as { isTimeout?: boolean; message?: string };
        const isUserError =
          !e.isTimeout && NO_RETRY_PATTERNS.some((p: RegExp) => p.test(e.message ?? ''));
        if (isUserError || attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
    throw lastErr;
  } finally {
    _semaphore.release();
  }
}

/**
 * Invoke the AI provider in streaming mode. Dispatches to GitHub Models (SSE) or
 * Claude CLI based on the current provider override. Each chunk is forwarded to `onChunk`.
 */
export async function streamClaude(
  rootDir: string,
  prompt: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (process.env.MOCK_CLAUDE) {
    onChunk(MOCK_RESPONSE);
    return;
  }

  const t = Date.now();
  await _semaphore.acquire();
  try {
    const provider = _providerOverride || 'claude-cli';
    const model = _modelOverride || '(default)';
    if (provider === 'github-models') {
      await _streamGitHubModels(prompt, onChunk);
    } else if (provider === 'ollama') {
      await _streamOllama(prompt, onChunk);
    } else {
      await new Promise<void>((resolve, reject) => {
        let err = '';
        const proc = spawn('claude', buildClaudeArgs(prompt), {
          cwd: rootDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error('Claude subprocess timed out after 5 min'));
        }, STREAM_TIMEOUT_MS);
        proc.stdout!.on('data', (d: Buffer) => onChunk(d.toString()));
        proc.stderr!.on('data', (d: Buffer) => (err += d.toString()));
        proc.on('close', (code: number | null) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(err.trim() || `claude exited ${code}`));
        });
      });
    }
    logInfo('streamClaude', `provider=${provider} model=${model} duration=${Date.now() - t}ms`);
  } finally {
    _semaphore.release();
  }
}
