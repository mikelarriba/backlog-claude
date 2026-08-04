// ── Integration tests: src/routes/bugs.ts error/validation paths ──────────────
// The only prior coverage was a single e2e happy-path flow. These cover
// malformed bodies, attachment mimetype rejection, and the attachment-GET
// route's slug/filename validation and not-found handling — matching the
// fs-errors.test.js / write-permission-errors.test.js style used for the
// docs/jira routes.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, baseUrl, docsRoot;

before(async () => {
  ({ api, stop, baseUrl, docsRoot } = await startTestApp());
});

after(async () => {
  await stop();
});

// ── POST /api/bugs/create — malformed body ────────────────────────────────────
describe('POST /api/bugs/create — malformed body', () => {
  test('returns 400 VALIDATION_ERROR when id is missing', async () => {
    const { status, data } = await api('POST', '/api/bugs/create', { title: 'Missing ID' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.match(data.error, /ID and Title are required/);
  });

  test('returns 400 VALIDATION_ERROR when title is missing', async () => {
    const { status, data } = await api('POST', '/api/bugs/create', { id: 'BUG-1' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 VALIDATION_ERROR when both id and title are missing', async () => {
    const { status, data } = await api('POST', '/api/bugs/create', {});
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 VALIDATION_ERROR when id exceeds 200 characters', async () => {
    const { status, data } = await api('POST', '/api/bugs/create', {
      id: 'x'.repeat(201),
      title: 'Valid title',
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.match(data.error, /200 characters/);
  });

  test('returns 400 VALIDATION_ERROR when title exceeds 200 characters', async () => {
    const { status, data } = await api('POST', '/api/bugs/create', {
      id: 'BUG-2',
      title: 'y'.repeat(201),
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.match(data.error, /200 characters/);
  });
});

// ── POST /api/bugs/create — attachment mimetype validation ───────────────────
describe('POST /api/bugs/create — attachment mimetype validation', () => {
  test('rejects an unsupported file type', async () => {
    const form = new FormData();
    form.append('id', 'BUG-3');
    form.append('title', 'Bug with unsupported attachment');
    form.append(
      'attachments',
      new Blob(['fake binary content'], { type: 'application/x-executable' }),
      'payload.exe'
    );

    const res = await fetch(`${baseUrl}/api/bugs/create`, { method: 'POST', body: form });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.match(data.error, /Unsupported file type/);
  });

  test('accepts an image attachment and creates the bug', async () => {
    const form = new FormData();
    form.append('id', 'BUG-4');
    form.append('title', 'Bug with image attachment');
    form.append('attachments', new Blob(['fake png bytes'], { type: 'image/png' }), 'shot.png');

    const res = await fetch(`${baseUrl}/api/bugs/create`, { method: 'POST', body: form });
    const data = await res.json();

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.docType, 'bug');
    assert.ok(data.filename.endsWith('.md'));
  });

  test('accepts an allow-listed octet-stream extension (.log) sent as application/octet-stream', async () => {
    const form = new FormData();
    form.append('id', 'BUG-5');
    form.append('title', 'Bug with log attachment');
    form.append(
      'attachments',
      new Blob(['log contents'], { type: 'application/octet-stream' }),
      'trace.log'
    );

    const res = await fetch(`${baseUrl}/api/bugs/create`, { method: 'POST', body: form });
    const data = await res.json();

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.docType, 'bug');
  });

  test('rejects an octet-stream extension not on the allow-list', async () => {
    const form = new FormData();
    form.append('id', 'BUG-6');
    form.append('title', 'Bug with unlisted octet-stream extension');
    form.append(
      'attachments',
      new Blob(['binary'], { type: 'application/octet-stream' }),
      'archive.zip'
    );

    const res = await fetch(`${baseUrl}/api/bugs/create`, { method: 'POST', body: form });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });
});

// ── GET /api/bugs/attachments/:slug/:file — validation & not-found ───────────
describe('GET /api/bugs/attachments/:slug/:file', () => {
  test('returns 400 INVALID_FILENAME for an uppercase/invalid slug', async () => {
    const { status, data } = await api('GET', '/api/bugs/attachments/UPPERCASE-SLUG/file.md');
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_FILENAME');
  });

  test('returns 400 INVALID_FILENAME for an invalid file segment', async () => {
    const { status, data } = await api(
      'GET',
      '/api/bugs/attachments/valid-slug/Invalid File Name.md'
    );
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_FILENAME');
  });

  test('returns 404 NOT_FOUND for a well-formed but nonexistent slug/file pair', async () => {
    // assertFilename's pattern requires both segments to end in ".md" — real
    // slugs/attachment names (e.g. "my-bug-title", "screenshot.png") never do
    // (see below), so this uses ".md"-suffixed names purely to reach the
    // not-found branch past validation.
    const { status, data } = await api(
      'GET',
      '/api/bugs/attachments/nonexistent-slug.md/nonexistent-file.md'
    );
    assert.equal(status, 404);
    assert.equal(data.code, 'NOT_FOUND');
  });

  test('BUG: a real, just-created attachment cannot be retrieved through this endpoint', async () => {
    // src/routes/bugs.ts reuses routeHelpers.assertFilename (designed for
    // markdown doc filenames — pattern requires a ".md" suffix) to validate
    // BOTH the :slug and :file params here. Real bug slugs come from
    // slugify(title) (never ".md") and real attachment filenames keep their
    // original extension (.png, .pdf, .msg, ...) — neither can ever match
    // `^[a-z0-9][a-z0-9-]*\.md$`. As a result GET /api/bugs/attachments/:slug/:file
    // always 400s for genuine attachments created via POST /api/bugs/create.
    // Documented here per issue #459 scope (test-only; not fixed in this PR).
    const form = new FormData();
    form.append('id', 'BUG-7');
    form.append('title', 'Bug proving attachment retrieval is broken');
    form.append('attachments', new Blob(['fake png bytes'], { type: 'image/png' }), 'evidence.png');
    const createRes = await fetch(`${baseUrl}/api/bugs/create`, { method: 'POST', body: form });
    const created = await createRes.json();
    assert.equal(createRes.status, 200, `Expected 200, got ${createRes.status}`);

    // Recover the real attachment URL the app itself just wrote/linked.
    const bugContent = fs.readFileSync(path.join(docsRoot, 'bugs', created.filename), 'utf-8');
    const linkMatch = bugContent.match(/\(attachments\/([^)]+)\)/);
    assert.ok(linkMatch, 'created bug should reference its attachment');
    const attachmentRelPath = linkMatch[1]; // "<slug>/<safeName>"

    const attachRes = await fetch(`${baseUrl}/api/bugs/attachments/${attachmentRelPath}`);
    // Current (buggy) behavior: 400 INVALID_FILENAME instead of 200 + the file.
    assert.equal(attachRes.status, 400);
    const attachData = await attachRes.json();
    assert.equal(attachData.code, 'INVALID_FILENAME');
  });
});
