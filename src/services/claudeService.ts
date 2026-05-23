import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

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

// Model + provider override — read from settings file if present
let _modelOverride: string | null = null;
let _providerOverride: 'claude-cli' | 'github-models' = 'claude-cli';

/**
 * Override the Claude model used for all subsequent spawns (session-scoped).
 * Pass null or undefined to clear the override and use the CLI default.
 */
export function setModelOverride(model: string | null | undefined): void {
  _modelOverride = model || null;
}

export function getModelOverride(): string | null {
  return _modelOverride;
}

export function setProviderOverride(provider: string | null | undefined): void {
  if (provider === 'github-models' && process.env.GITHUB_MODELS_TOKEN) {
    _providerOverride = 'github-models';
  } else {
    _providerOverride = 'claude-cli';
  }
}

export function getProviderOverride(): string {
  return _providerOverride;
}

export function getAvailableProviders(): { id: string; name: string; models: { id: string; name: string }[] }[] {
  const providers = [
    {
      id: 'claude-cli',
      name: 'Claude (CLI)',
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
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
        { id: 'DeepSeek-V3-0324', name: 'DeepSeek V3' },
        { id: 'DeepSeek-R1-0528', name: 'DeepSeek R1' },
        { id: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B' },
        { id: 'Mistral-Large-2411', name: 'Mistral Large' },
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

const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';

async function _callGitHubModels(prompt: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_MODELS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: _modelOverride || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub Models API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    return normalizeOutput(content);
  } finally {
    clearTimeout(timer);
  }
}

async function _streamGitHubModels(prompt: string, onChunk: (chunk: string) => void, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_MODELS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: _modelOverride || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub Models API error ${res.status}: ${body}`);
    }

    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onChunk(content);
        } catch { /* skip malformed SSE lines */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * Invoke the Claude CLI non-streaming. Retries up to `maxAttempts` times
 * with exponential back-off (2s, 4s, 8s). User-content errors (bad API key,
 * content policy, context too long) are not retried.
 */
export async function callClaude(rootDir: string, prompt: string, { maxAttempts = 3 } = {}): Promise<string> {
  if (process.env.MOCK_CLAUDE) return Promise.resolve(MOCK_RESPONSE);

  const callFn = _providerOverride === 'github-models'
    ? () => _callGitHubModels(prompt, CALL_TIMEOUT_MS)
    : () => _spawnClaude(rootDir, prompt, CALL_TIMEOUT_MS);

  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callFn();
    } catch (err: any) {
      lastErr = err;
      const isUserError = !err.isTimeout && NO_RETRY_PATTERNS.some((p: RegExp) => p.test(err.message));
      if (isUserError || attempt === maxAttempts) break;
      // Exponential back-off: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastErr;
}

/**
 * Invoke the Claude CLI in streaming mode. Each stdout chunk is forwarded to
 * `onChunk` as it arrives. Times out after 5 minutes.
 */
export function streamClaude(rootDir: string, prompt: string, onChunk: (chunk: string) => void): Promise<void> {
  if (process.env.MOCK_CLAUDE) {
    onChunk(MOCK_RESPONSE);
    return Promise.resolve();
  }

  if (_providerOverride === 'github-models') {
    return _streamGitHubModels(prompt, onChunk, STREAM_TIMEOUT_MS);
  }

  return new Promise((resolve, reject) => {
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
}
