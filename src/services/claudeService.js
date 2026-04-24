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

const CLAUDE_TIMEOUT_MS = 120_000;

export function callClaude(rootDir, prompt) {
  if (process.env.MOCK_CLAUDE) return Promise.resolve(MOCK_RESPONSE);
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const proc = spawn('claude', buildClaudeArgs(prompt), { cwd: rootDir });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Claude subprocess timed out after 120s'));
    }, CLAUDE_TIMEOUT_MS);
    proc.stdout.on('data', d => (out += d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      const trimmed = out.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');
      resolve(trimmed);
    });
  });
}

export function streamClaude(rootDir, prompt, onChunk) {
  if (process.env.MOCK_CLAUDE) {
    onChunk(MOCK_RESPONSE);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let err = '';
    const proc = spawn('claude', buildClaudeArgs(prompt), { cwd: rootDir });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Claude subprocess timed out after 120s'));
    }, CLAUDE_TIMEOUT_MS);
    proc.stdout.on('data', d => onChunk(d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(err.trim() || `claude exited ${code}`));
    });
  });
}
