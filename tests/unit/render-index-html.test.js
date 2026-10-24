import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderIndexHtml } from '../../src/app/middleware.js';

describe('renderIndexHtml', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'midas-index-'));
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<script type="module" src="/public/js/main.js"></script>'
    );
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('returns null when no bundle manifest exists', () => {
    assert.equal(renderIndexHtml(root), null);
  });

  it('points the module entry at the hashed bundle', () => {
    fs.mkdirSync(path.join(root, 'public/dist'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'public/dist/manifest.json'),
      JSON.stringify({ 'main.js': 'main-ABC123.js' })
    );
    assert.equal(
      renderIndexHtml(root),
      '<script type="module" src="/public/dist/main-ABC123.js"></script>'
    );
  });

  it('returns null when the manifest has no main.js entry', () => {
    fs.writeFileSync(path.join(root, 'public/dist/manifest.json'), '{}');
    assert.equal(renderIndexHtml(root), null);
  });
});
