// ── Integration tests: stories.ts write paths keep docIndex in sync ────────────
// Covers issue #419 acceptance criteria: upgrade-story and DELETE story both
// invalidate the docIndex entry for the *-stories.md container file so GET
// /api/docs reflects the change without a server restart.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, docsRoot, baseUrl;

before(async () => {
  ({ api, stop, docsRoot, baseUrl } = await startTestApp());
});

after(async () => {
  await stop();
});

function ssePost(baseUrl, urlPath, body) {
  const events = [];
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body || {});
    const req = http.request(
      `${baseUrl}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {
                /* no-op */
              }
            }
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, events }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function findDoc(filename) {
  const { data } = await api('GET', '/api/docs');
  return data.find((d) => d.filename === filename);
}

function writeStoriesFile(docsRoot, filename, sections) {
  const storiesDir = path.join(docsRoot, 'stories');
  fs.mkdirSync(storiesDir, { recursive: true });
  const frontmatter = '---\nEpic_ID: TBD\nCreated: 2026-01-01\n---';
  fs.writeFileSync(path.join(storiesDir, filename), `${frontmatter}\n\n${sections.join('\n\n')}\n`);
}

describe('stories.ts write paths keep docIndex in sync', () => {
  test('upgrade-story invalidates the index so GET /api/docs sees the new title', async () => {
    const filename = '2026-01-01-upgrade-target-stories.md';
    writeStoriesFile(docsRoot, filename, [
      '## Story 1: Original Title\nOriginal body.',
      '## Story 2: Second Story\nSecond body.',
    ]);

    // Not yet in the index (written directly to disk after server startup).
    assert.equal(await findDoc(filename), undefined);

    const { status } = await ssePost(baseUrl, `/api/stories/${filename}/upgrade-story`, {
      storyIndex: 0,
      feedback: 'Make it better',
    });
    assert.equal(status, 200);

    const doc = await findDoc(filename);
    assert.ok(doc, 'container file should now be indexed');
    // MOCK_CLAUDE returns fixed mock content for story 1 — if invalidate() were
    // not called, the stale index would still report the original heading.
    assert.notEqual(doc.title, 'Story 1: Original Title');
  });

  test('DELETE story invalidates the index so GET /api/docs sees the remaining content', async () => {
    const filename = '2026-01-01-delete-target-stories.md';
    writeStoriesFile(docsRoot, filename, [
      '## Story 1: First Story\nFirst body.',
      '## Story 2: Second Story\nSecond body.',
    ]);
    // Prime the index the same way the app would (GET /api/docs triggers ensureDir
    // only; force an entry to exist first via a no-op upgrade-free path — simplest
    // is to just rely on invalidate() being called by the DELETE handler itself).
    assert.equal(await findDoc(filename), undefined);

    const { status, data } = await api('DELETE', `/api/stories/${filename}/story`, {
      storyIndex: 0,
    });
    assert.equal(status, 200);
    assert.equal(data.remaining, 1);

    const doc = await findDoc(filename);
    assert.ok(doc, 'container file should now be indexed');
    assert.equal(doc.title, 'Story 2: Second Story');
  });
});
