// ── Integration tests: extended doc endpoints ──────────────────────────────────
// Covers: batch-delete, distribute, split-story (SSE), upgrade (SSE).
// Claude calls are intercepted via MOCK_CLAUDE=1 (set in startTestApp).
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

// ── SSE helper: POST to an SSE endpoint and collect all events ────────────────
function ssePost(url, body) {
  const events = [];
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const bodyStr = JSON.stringify(body || {});
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6))); } catch {}
            }
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, events }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── POST /api/docs/batch-delete ───────────────────────────────────────────────
describe('POST /api/docs/batch-delete', () => {
  let epicA, epicB;

  before(async () => {
    const { data: a } = await api('POST', '/api/generate', { idea: 'Batch delete epic A', type: 'epic' });
    const { data: b } = await api('POST', '/api/generate', { idea: 'Batch delete epic B', type: 'epic' });
    epicA = a.filename;
    epicB = b.filename;
  });

  test('returns 400 when docs array is empty', async () => {
    const { status, data } = await api('POST', '/api/docs/batch-delete', { docs: [] });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('deletes multiple documents in one request', async () => {
    const { status, data } = await api('POST', '/api/docs/batch-delete', {
      docs: [
        { type: 'epic', filename: epicA },
        { type: 'epic', filename: epicB },
      ],
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.deleted, 2);
    assert.equal(data.skipped.length, 0);
    // Files should be gone from disk
    assert.ok(!fs.existsSync(path.join(docsRoot, 'epics', epicA)));
    assert.ok(!fs.existsSync(path.join(docsRoot, 'epics', epicB)));
  });

  test('skips non-existent files and reports them', async () => {
    const { data: doc } = await api('POST', '/api/generate', { idea: 'Batch delete survivor', type: 'epic' });
    const { status, data } = await api('POST', '/api/docs/batch-delete', {
      docs: [
        { type: 'epic', filename: doc.filename },
        { type: 'epic', filename: 'ghost-does-not-exist.md' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(data.deleted, 1);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].reason, 'not found');
  });
});

// ── POST /api/docs/distribute ─────────────────────────────────────────────────
describe('POST /api/docs/distribute', () => {
  const PI_NAME = 'PI-2026.distribute-test';

  before(async () => {
    // Configure sprints for this PI via the settings API
    await api('PUT', `/api/settings/pi/sprints/${encodeURIComponent(PI_NAME)}`, {
      sprints: [
        { name: 'Sprint 1', capacity: 10 },
        { name: 'Sprint 2', capacity: 5 },
      ],
    });
    // Create a story with Fix_Version set to this PI
    await api('POST', '/api/generate', {
      idea:       'Distribute story for sprint assignment',
      type:       'story',
      fixVersion: PI_NAME,
    });
  });

  test('returns 400 when piName is missing', async () => {
    const { status, data } = await api('POST', '/api/docs/distribute', {});
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when no sprint config exists for the PI', async () => {
    const { status, data } = await api('POST', '/api/docs/distribute', { piName: 'NonExistentPI' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'NO_SPRINTS');
  });

  test('returns sprint buckets for a configured PI', async () => {
    const { status, data } = await api('POST', '/api/docs/distribute', { piName: PI_NAME });
    assert.equal(status, 200);
    assert.equal(data.piName, PI_NAME);
    assert.ok(Array.isArray(data.sprints));
    assert.equal(data.sprints.length, 2);
    assert.equal(data.sprints[0].name, 'Sprint 1');
    assert.equal(data.sprints[0].capacity, 10);
    assert.ok(Array.isArray(data.overflow));
    assert.ok(Array.isArray(data.warnings));
  });
});

// ── POST /api/docs/split-story (SSE) ─────────────────────────────────────────
describe('POST /api/docs/split-story', () => {
  test('returns 400 when filename and docType are missing', async () => {
    // Pre-SSE validation returns plain JSON
    const { status, data } = await api('POST', '/api/docs/split-story', {});
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when targetCount is not a number', async () => {
    const { data: doc } = await api('POST', '/api/generate', { idea: 'Split count test', type: 'story' });
    const { status, data } = await api('POST', '/api/docs/split-story', {
      filename: doc.filename, docType: 'story', targetCount: 'abc',
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 404 when source file does not exist', async () => {
    const { status, data } = await api('POST', '/api/docs/split-story', {
      filename: 'nonexistent-story.md', docType: 'story', targetCount: 2,
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });

  test('streams SSE events for an existing story (mock returns error event)', async () => {
    // Mock Claude does not produce ===SPLIT=== content, so an SSE error event is sent.
    // This verifies the SSE setup, streaming pipeline, and error-path event format.
    const { data: doc } = await api('POST', '/api/generate', { idea: 'Story to split SSE test', type: 'story' });
    const { status, events } = await ssePost(`${baseUrl}/api/docs/split-story`, {
      filename: doc.filename, docType: 'story', targetCount: 2,
    });
    assert.equal(status, 200);           // SSE response always 200 at transport level
    assert.ok(events.length > 0, 'should receive at least one SSE event');
    // The mock can't produce a valid split, so we expect a text chunk + error event
    const lastEvent = events[events.length - 1];
    assert.ok(lastEvent.error || lastEvent.done, 'last event should be error or done');
  });
});

// ── POST /api/doc/:type/:filename/upgrade (SSE) ───────────────────────────────
describe('POST /api/doc/:type/:filename/upgrade', () => {
  let epicFilename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea:   'Upgrade endpoint test epic',
      title:  'Upgrade Test Epic',
      type:   'epic',
    });
    epicFilename = data.filename;
    // Set a known status so we can verify it is preserved
    await api('PATCH', `/api/doc/epic/${encodeURIComponent(epicFilename)}`, { status: 'Created in JIRA' });
  });

  test('returns 404 when document does not exist', async () => {
    const { status, data } = await api('POST', '/api/doc/epic/nonexistent.md/upgrade', {
      feedback: 'Improve the objective section',
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });

  test('streams upgraded content and sends done:true (mock Claude)', async () => {
    const { status, events } = await ssePost(
      `${baseUrl}/api/doc/epic/${encodeURIComponent(epicFilename)}/upgrade`,
      { feedback: 'Sharpen the objective and add more concrete KPIs' },
    );
    assert.equal(status, 200);
    assert.ok(events.length > 0, 'should receive at least one SSE event');
    const doneEvent = events.find(e => e.done === true);
    assert.ok(doneEvent, 'should receive a done:true event');
    assert.ok(typeof doneEvent.content === 'string', 'done event should include content');
  });

  test('preserves existing Status in frontmatter after upgrade', async () => {
    // After the upgrade above the file should still carry 'Created in JIRA'
    const { data } = await api('GET', `/api/doc/epic/${encodeURIComponent(epicFilename)}`);
    assert.match(data.content, /^Status: Created in JIRA$/m);
  });

  test('streams an SSE error event when feedback is missing', async () => {
    const { status, events } = await ssePost(
      `${baseUrl}/api/doc/epic/${encodeURIComponent(epicFilename)}/upgrade`,
      { feedback: '' },
    );
    assert.equal(status, 200);
    const errEvent = events.find(e => e.error);
    assert.ok(errEvent, 'should receive an SSE error event');
    assert.equal(errEvent.error.code, 'VALIDATION_ERROR');
  });
});
