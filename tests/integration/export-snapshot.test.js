// ── Integration tests: export route HTML structure ─────────────────────────────
// Verifies that GET /api/export/doc and GET /api/export/roadmap return well-
// formed HTML with the expected structural landmarks.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, baseUrl;

before(async () => {
  ({ api, stop, baseUrl } = await startTestApp());
});

after(async () => {
  await stop();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createDoc(type, title) {
  const { status, data } = await api('POST', '/api/docs/draft', { title, type });
  assert.equal(status, 200, `Failed to create ${type}: ${JSON.stringify(data)}`);
  return data;
}

async function fetchHtml(urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  return {
    status: res.status,
    html: await res.text(),
    contentType: res.headers.get('content-type') || '',
  };
}

// ── GET /api/export/doc — error cases ────────────────────────────────────────

describe('GET /api/export/doc — error cases', () => {
  test('returns 400 for unknown doc type', async () => {
    const { status } = await fetchHtml('/api/export/doc/unknown/some-file.md');
    assert.equal(status, 400);
  });

  test('returns 404 for missing file', async () => {
    const { status } = await fetchHtml('/api/export/doc/epic/nonexistent.md');
    assert.equal(status, 404);
  });
});

// ── GET /api/export/doc — HTML structure for epic ────────────────────────────

describe('GET /api/export/doc — HTML structure', () => {
  test('returns HTML document with correct structure for an epic', async () => {
    const { filename } = await createDoc('epic', 'Test Export Epic');
    const { status, html, contentType } = await fetchHtml(
      `/api/export/doc/epic/${encodeURIComponent(filename)}`
    );

    assert.equal(status, 200);
    assert.ok(contentType.includes('text/html'), `Expected text/html, got ${contentType}`);
    assert.ok(html.includes('<!DOCTYPE html>'), 'should start with DOCTYPE');
    assert.ok(html.includes('<html'), 'should have <html> tag');
    assert.ok(html.includes('</html>'), 'should close </html>');
  });

  test('HTML contains the epic title', async () => {
    const title = 'Export Structure Verification Epic';
    const { filename } = await createDoc('epic', title);
    const { html } = await fetchHtml(`/api/export/doc/epic/${encodeURIComponent(filename)}`);
    assert.ok(
      html.includes(title) || html.includes('Export Structure'),
      'HTML should contain the doc title'
    );
  });

  test('HTML includes a style tag', async () => {
    const { filename } = await createDoc('epic', 'Style Tag Epic');
    const { html } = await fetchHtml(`/api/export/doc/epic/${encodeURIComponent(filename)}`);
    assert.ok(html.includes('<style'), 'HTML should include styles');
  });

  test('HTML includes print-related CSS (font-size or font-family)', async () => {
    const { filename } = await createDoc('epic', 'Print CSS Epic');
    const { html } = await fetchHtml(`/api/export/doc/epic/${encodeURIComponent(filename)}`);
    assert.ok(
      html.includes('font-size') || html.includes('font-family') || html.includes('@page'),
      'HTML should include print-oriented CSS properties'
    );
  });

  test('returns valid HTML for a story export', async () => {
    const { filename } = await createDoc('story', 'A Story For Export');
    const { status, html } = await fetchHtml(`/api/export/doc/story/${encodeURIComponent(filename)}`);
    assert.equal(status, 200);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });

  test('returns valid HTML for a feature export', async () => {
    const { filename } = await createDoc('feature', 'Feature Export Test');
    const { status, html } = await fetchHtml(
      `/api/export/doc/feature/${encodeURIComponent(filename)}`
    );
    assert.equal(status, 200);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });
});

// ── GET /api/export/roadmap ───────────────────────────────────────────────────

describe('GET /api/export/roadmap — HTML structure', () => {
  test('returns 200 with text/html content type', async () => {
    const { status, contentType } = await fetchHtml('/api/export/roadmap');
    assert.equal(status, 200);
    assert.ok(contentType.includes('text/html'), `Expected text/html, got ${contentType}`);
  });

  test('roadmap HTML has DOCTYPE and html elements', async () => {
    const { html } = await fetchHtml('/api/export/roadmap');
    assert.ok(html.includes('<!DOCTYPE html>'), 'must have DOCTYPE');
    assert.ok(html.includes('<html'), 'must have <html>');
    assert.ok(html.includes('</html>'), 'must close </html>');
  });

  test('roadmap HTML includes a style tag', async () => {
    const { html } = await fetchHtml('/api/export/roadmap');
    assert.ok(html.includes('<style'), 'must have <style> for roadmap layout');
  });

  test('roadmap with includes=titles returns HTML', async () => {
    const { status, html } = await fetchHtml('/api/export/roadmap?includes=titles');
    assert.equal(status, 200);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });

  test('roadmap with includes=descriptions returns HTML', async () => {
    const { status, html } = await fetchHtml('/api/export/roadmap?includes=descriptions');
    assert.equal(status, 200);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });

  test('roadmap with hideEmpty=1 returns HTML', async () => {
    const { status, html } = await fetchHtml('/api/export/roadmap?hideEmpty=1');
    assert.equal(status, 200);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });

  test('roadmap with sprint filter returns HTML', async () => {
    const { status, html } = await fetchHtml('/api/export/roadmap?sprints=Sprint+1');
    assert.equal(status, 200);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });
});
