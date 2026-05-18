import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export function loadCommand(rootDir, name) {
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
let _modelOverride = null;

export function setModelOverride(model) {
  _modelOverride = model || null;
}

export function getModelOverride() {
  return _modelOverride;
}

function buildClaudeArgs(prompt) {
  const args = ['-p', prompt];
  if (_modelOverride) args.push('--model', _modelOverride);
  return args;
}

// callClaude (non-streaming): 3 min — generate route, one-shot rewrites
const CALL_TIMEOUT_MS = 180_000;
// streamClaude (streaming): 5 min — upgrade/refine routes, long COVE rewrites
const STREAM_TIMEOUT_MS = 300_000;

// Strip code fences that models sometimes wrap around output.
// Handles: ```yaml\n---frontmatter---\n```\nbody  →  ---frontmatter---\nbody
// And:     ```markdown\nentire output\n```  →  entire output
export function normalizeOutput(content) {
  let c = content.trim();
  // Unwrap yaml-fenced frontmatter block that appears before the body
  c = c.replace(/^```[\w]+\n(---[\s\S]*?---)\n```\n?/, '$1\n');
  // Strip any remaining outer code fence (```markdown, ``` etc.)
  c = c.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return c.trim();
}

// Error patterns that indicate a user-content problem — do not retry these.
const NO_RETRY_PATTERNS = [/invalid api key/i, /permission denied/i, /content policy/i, /context length/i];

function _spawnClaude(rootDir, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const proc = spawn('claude', buildClaudeArgs(prompt), { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      proc.kill();
      reject(Object.assign(new Error('Claude subprocess timed out'), { isTimeout: true }));
    }, timeoutMs);
    proc.stdout.on('data', d => (out += d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      resolve(normalizeOutput(out));
    });
  });
}

export async function callClaude(rootDir, prompt, { maxAttempts = 3 } = {}) {
  if (process.env.MOCK_CLAUDE) return Promise.resolve(MOCK_RESPONSE);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await _spawnClaude(rootDir, prompt, CALL_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      const isUserError = !err.isTimeout && NO_RETRY_PATTERNS.some(p => p.test(err.message));
      if (isUserError || attempt === maxAttempts) break;
      // Exponential back-off: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastErr;
}

export function streamClaude(rootDir, prompt, onChunk) {
  if (process.env.MOCK_CLAUDE) {
    onChunk(MOCK_RESPONSE);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let err = '';
    const proc = spawn('claude', buildClaudeArgs(prompt), { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Claude subprocess timed out after 5 min'));
    }, STREAM_TIMEOUT_MS);
    proc.stdout.on('data', d => onChunk(d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(err.trim() || `claude exited ${code}`));
    });
  });
}
