import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';

const { logDebug } = createLogger('[claudeService]');

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
    return new Promise(resolve => this.pending.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.pending.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  get queueDepth(): number { return this.pending.length; }
}

const _concurrency = parseInt(process.env.CLAUDE_CONCURRENCY || '3', 10);
const _semaphore = new Semaphore(Number.isFinite(_concurrency) && _concurrency > 0 ? _concurrency : 3);

export function loadCommand(rootDir: string, name: string): string | null {
  const commandPath = path.join(rootDir, '.claude', 'commands', `${name}.md`);
  if (!fs.existsSync(commandPath)) return null;
  return fs.readFileSync(commandPath, 'utf-8').replace(/^---[\s\S]*?---\n?/, '').trim();
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

/**
 * Returns the list of available providers based on configured tokens/binaries.
 * Always includes 'claude-cli'. Adds 'github-models' when GITHUB_MODELS_TOKEN is set.
 */
export function getAvailableProviders(): Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> {
  const providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> = [
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

  return providers;
}

function buildClaudeArgs(prompt: string): string[] {
  const args = ['-p', prompt];
  if (_modelOverride) args.push('--model', _modelOverride);
  return args;
}

// callClaude (non-streaming): 3 min — generate route, one-shot rewrites
const CALL_TIMEOUT_MS = 180_000;
// streamClaude (streaming): 5 min — upgrade/refine routes, long COVE rewrites
const STREAM_TIMEOUT_MS = 300_000;

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
const NO_RETRY_PATTERNS = [/invalid api key/i, /permission denied/i, /content policy/i, /context length/i];

function _spawnClaude(rootDir: string, prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const proc = spawn('claude', buildClaudeArgs(prompt), { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function _callGitHubModels(prompt: string): Promise<string> {
  const token = process.env.GITHUB_MODELS_TOKEN;
  if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set');

  const model = _modelOverride || 'openai/gpt-4o';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(GITHUB_MODELS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub Models API error ${res.status}: ${errText}`);
  }

  const json = await res.json() as any;
  const content = json?.choices?.[0]?.message?.content ?? '';
  return normalizeOutput(content);
}

async function _streamGitHubModels(prompt: string, onChunk: (chunk: string) => void): Promise<void> {
  const token = process.env.GITHUB_MODELS_TOKEN;
  if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set');

  const model = _modelOverride || 'openai/gpt-4o';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(GITHUB_MODELS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub Models API error ${res.status}: ${errText}`);
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
        } catch {}
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/**
 * Invoke the AI provider non-streaming. Dispatches to GitHub Models or Claude CLI
 * based on the current provider override. Retries up to `maxAttempts` times with
 * exponential back-off (2s, 4s, 8s). User-content errors are not retried.
 */
export async function callClaude(rootDir: string, prompt: string, { maxAttempts = 3 } = {}): Promise<string> {
  if (process.env.MOCK_CLAUDE) return Promise.resolve(MOCK_RESPONSE);

  await _semaphore.acquire();
  try {
    const provider = _providerOverride || 'claude-cli';
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (provider === 'github-models') {
          return await _callGitHubModels(prompt);
        }
        return await _spawnClaude(rootDir, prompt, CALL_TIMEOUT_MS);
      } catch (err: any) {
        lastErr = err;
        const isUserError = !err.isTimeout && NO_RETRY_PATTERNS.some((p: RegExp) => p.test(err.message));
        if (isUserError || attempt === maxAttempts) break;
        await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
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
export async function streamClaude(rootDir: string, prompt: string, onChunk: (chunk: string) => void): Promise<void> {
  if (process.env.MOCK_CLAUDE) {
    onChunk(MOCK_RESPONSE);
    return;
  }

  await _semaphore.acquire();
  try {
    const provider = _providerOverride || 'claude-cli';
    if (provider === 'github-models') {
      return await _streamGitHubModels(prompt, onChunk);
    }

    return await new Promise<void>((resolve, reject) => {
      let err = '';
      const proc = spawn('claude', buildClaudeArgs(prompt), { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('Claude subprocess timed out after 5 min'));
      }, STREAM_TIMEOUT_MS);
      proc.stdout!.on('data', (d: Buffer) => onChunk(d.toString()));
      proc.stderr!.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(err.trim() || `claude exited ${code}`));
      });
    });
  } finally {
    _semaphore.release();
  }
}
