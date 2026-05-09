// ── E2E test fixtures ─────────────────────────────────────────────────────────
// Helpers to pre-populate the E2E docs directory with fixture documents.
// The server uses TEST_DOCS_ROOT from playwright.config.js, so files written
// here are immediately visible to the running server.

import fs from 'fs';
import path from 'path';
import os from 'os';

export const E2E_DOCS_ROOT = path.join(os.tmpdir(), 'backlog-e2e-docs');

export function clearDocsDir() {
  for (const sub of ['features', 'epics', 'stories', 'spikes', 'bugs']) {
    const dir = path.join(E2E_DOCS_ROOT, sub);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write a fixture .md file into the E2E docs directory.
 * Returns the filename and title.
 */
export function createFixtureDoc(type, overrides = {}) {
  const dir = path.join(E2E_DOCS_ROOT, `${type}s`);
  fs.mkdirSync(dir, { recursive: true });

  const date  = new Date().toISOString().slice(0, 10);
  const title = overrides.title || `Fixture ${type} ${Date.now()}`;
  const slug  = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const filename = `${date}-${slug}.md`;

  const content = `---
JIRA_ID: TBD
Story_Points: ${overrides.storyPoints || '3'}
Status: ${overrides.status || 'Draft'}
Priority: ${overrides.priority || 'Medium'}
Sprint: ${overrides.sprint || 'TBD'}
Squad: TBD
PI: ${overrides.pi || 'TBD'}
Fix_Version: ${overrides.fixVersion || 'TBD'}
Created: ${date}
---

## ${title}

${overrides.description || 'Fixture description for E2E testing.'}
`;

  fs.writeFileSync(path.join(dir, filename), content);
  return { filename, type, title };
}
