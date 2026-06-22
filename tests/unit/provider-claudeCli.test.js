// ── Unit tests: src/services/providers/claudeCli.ts ───────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeOutput,
  loadProductContext,
  loadCommand,
  loadCommandRaw,
} from '../../src/services/providers/claudeCli.js';

describe('normalizeOutput', () => {
  test('returns empty string for empty input', () => {
    assert.equal(normalizeOutput(''), '');
  });

  test('strips yaml-fenced frontmatter wrapper', () => {
    const input = '```yaml\n---\nStatus: Draft\n---\n```\n\n## Body';
    const result = normalizeOutput(input);
    assert.ok(!result.startsWith('```'), 'yaml fence should be stripped');
    assert.ok(result.includes('---'), 'frontmatter should be preserved');
  });

  test('strips markdown code fence wrapper', () => {
    const input = '```markdown\n---\nStatus: Draft\n---\n\n## Title\n```';
    const result = normalizeOutput(input);
    assert.ok(!result.includes('```'), 'fences should be stripped');
    assert.ok(result.includes('---'), 'frontmatter should be preserved');
  });

  test('preserves content without fences', () => {
    const input = '---\nTitle: My Epic\nStatus: Draft\n---\n\n## Body';
    assert.equal(normalizeOutput(input), input);
  });
});

describe('loadProductContext', () => {
  test('returns empty content when neither file exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    const result = loadProductContext(tmpDir);
    assert.equal(result.content, '');
    assert.equal(result.source, 'example');
    fs.rmdirSync(tmpDir);
  });

  test('returns custom file content when it exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    fs.writeFileSync(path.join(tmpDir, '.product-context.md'), 'Custom context');
    const result = loadProductContext(tmpDir);
    assert.equal(result.content, 'Custom context');
    assert.equal(result.source, 'custom');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('falls back to example file when custom does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    fs.writeFileSync(path.join(tmpDir, '.product-context.example.md'), 'Example context');
    const result = loadProductContext(tmpDir);
    assert.equal(result.content, 'Example context');
    assert.equal(result.source, 'example');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('loadCommand', () => {
  test('returns null when command does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    assert.equal(loadCommand(tmpDir, 'nonexistent'), null);
    fs.rmdirSync(tmpDir);
  });

  test('loads command from custom directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    const cmdDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'my-cmd.md'), '---\ntitle: cmd\n---\nCommand body');
    const result = loadCommand(tmpDir, 'my-cmd');
    assert.ok(result !== null);
    assert.ok(result.includes('Command body'), 'body should be present');
    assert.ok(!result.includes('---'), 'frontmatter should be stripped');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('loadCommandRaw', () => {
  test('returns null when command does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    assert.equal(loadCommandRaw(tmpDir, 'nonexistent'), null);
    fs.rmdirSync(tmpDir);
  });

  test('returns full raw content including frontmatter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    const cmdDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(cmdDir, { recursive: true });
    const raw = '---\ntitle: cmd\n---\nBody';
    fs.writeFileSync(path.join(cmdDir, 'raw-cmd.md'), raw);
    const result = loadCommandRaw(tmpDir, 'raw-cmd');
    assert.ok(result !== null);
    assert.equal(result.content, raw);
    assert.equal(result.source, 'custom');
    fs.rmSync(tmpDir, { recursive: true });
  });
});
