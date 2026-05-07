// ── Integration tests: core API flows ─────────────────────────────────────────
// Covers: generate doc, update status, get doc, delete doc, get links.
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

// ── GET /api/docs ─────────────────────────────────────────────────────────────
describe('GET /api/docs', () => {
  test('returns 200 with an array', async () => {
    const { status, data } = await api('GET', '/api/docs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
  });

  test('index invalidation: create doc → GET /api/docs includes it', async () => {
    const { status: cs, data: cd } = await api('POST', '/api/docs/draft', {
      title: 'Index Invalidation Test',
      type: 'story',
    });
    assert.equal(cs, 200);
    const { filename } = cd;

    const { data: docs } = await api('GET', '/api/docs');
    assert.ok(docs.some(d => d.filename === filename), 'new doc should appear in index');
  });

  test('index invalidation: delete doc → GET /api/docs excludes it', async () => {
    const { data: cd } = await api('POST', '/api/docs/draft', {
      title: 'Index Delete Test',
      type: 'spike',
    });
    const { filename } = cd;

    await api('DELETE', `/api/doc/spike/${encodeURIComponent(filename)}`);

    const { data: docs } = await api('GET', '/api/docs');
    assert.ok(!docs.some(d => d.filename === filename), 'deleted doc should be absent from index');
  });
});

// ── POST /api/generate ────────────────────────────────────────────────────────
describe('POST /api/generate', () => {
  test('returns 400 when idea is missing', async () => {
    const { status, data } = await api('POST', '/api/generate', { type: 'epic' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 for an invalid doc type', async () => {
    const { status, data } = await api('POST', '/api/generate', { idea: 'Test', type: 'bogus' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'INVALID_TYPE');
  });

  test('creates an epic and returns filename + docType', async () => {
    const { status, data } = await api('POST', '/api/generate', {
      idea: 'As a user I want to search tests',
      title: 'Search Tests',
      type: 'epic',
      priority: 'High',
    });
    assert.equal(status, 200);
    assert.ok(data.filename, 'filename should be set');
    assert.equal(data.docType, 'epic');
    // The generated file should exist on disk
    const filePath = path.join(docsRoot, 'epics', data.filename);
    assert.ok(fs.existsSync(filePath), `expected ${filePath} to exist`);
  });

  test('creates a story', async () => {
    const { status, data } = await api('POST', '/api/generate', {
      idea: 'As a test engineer I want to filter by date',
      type: 'story',
    });
    assert.equal(status, 200);
    assert.equal(data.docType, 'story');
  });

  test('creates a spike', async () => {
    const { status, data } = await api('POST', '/api/generate', {
      idea: 'Investigate RabbitMQ throughput limits',
      type: 'spike',
    });
    assert.equal(status, 200);
    assert.equal(data.docType, 'spike');
  });
});

// ── GET /api/doc/:type/:filename ──────────────────────────────────────────────
describe('GET /api/doc/:type/:filename', () => {
  let createdFilename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Get doc test idea',
      title: 'Get Doc Epic',
      type: 'epic',
    });
    createdFilename = data.filename;
  });

  test('returns 200 with content for an existing doc', async () => {
    const { status, data } = await api('GET', `/api/doc/epic/${encodeURIComponent(createdFilename)}`);
    assert.equal(status, 200);
    assert.equal(data.filename, createdFilename);
    assert.ok(typeof data.content === 'string');
  });

  test('returns 404 for a non-existent doc', async () => {
    const { status, data } = await api('GET', '/api/doc/epic/does-not-exist.md');
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });

  test('returns 400 for an invalid type', async () => {
    const { status } = await api('GET', '/api/doc/bogus/test.md');
    assert.equal(status, 400);
  });
});

// ── PATCH /api/doc/:type/:filename ── update status ──────────────────────────
describe('PATCH /api/doc/:type/:filename — update status', () => {
  let filename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Status update test',
      title: 'Status Epic',
      type: 'epic',
    });
    filename = data.filename;
  });

  test('updates status to Archived and returns success', async () => {
    const { status, data } = await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, {
      status: 'Archived',
    });
    assert.equal(status, 200);
    assert.equal(data.status, 'Archived');
  });

  test('persists the new status in the file', async () => {
    await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, { status: 'Created in JIRA' });
    const { data } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.match(data.content, /^Status: Created in JIRA$/m);
  });

  test('returns 400 for an invalid status value', async () => {
    const { status, data } = await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, {
      status: 'WrongStatus',
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'INVALID_STATUS');
  });

  test('returns 404 when doc does not exist', async () => {
    const { status } = await api('PATCH', '/api/doc/epic/ghost.md', { status: 'Draft' });
    assert.equal(status, 404);
  });
});

// ── DELETE /api/doc/:type/:filename ───────────────────────────────────────────
describe('DELETE /api/doc/:type/:filename', () => {
  let filename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Delete me',
      type: 'epic',
    });
    filename = data.filename;
  });

  test('deletes the document and returns success', async () => {
    const { status, data } = await api('DELETE', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);
  });

  test('returns 404 after deletion', async () => {
    const { status } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.equal(status, 404);
  });
});

// ── GET /api/links/:type/:filename ────────────────────────────────────────────
describe('GET /api/links/:type/:filename', () => {
  test('returns parent: null and children: [] for an unlinked epic', async () => {
    const { data: gen } = await api('POST', '/api/generate', {
      idea: 'Unlinked epic for hierarchy test',
      type: 'epic',
    });
    const { status, data } = await api('GET', `/api/links/epic/${encodeURIComponent(gen.filename)}`);
    assert.equal(status, 200);
    assert.equal(data.parent, null);
    assert.ok(Array.isArray(data.children));
  });

  test('returns 400 for an invalid doc type', async () => {
    const { status } = await api('GET', '/api/links/bogus/test.md');
    assert.equal(status, 400);
  });
});

// ── POST /api/link ── create a local link between documents ─────────────────
describe('POST /api/link', () => {
  let epicFilename, storyFilename, featureFilename;

  before(async () => {
    const { data: epic } = await api('POST', '/api/generate', { idea: 'Link target epic', type: 'epic' });
    epicFilename = epic.filename;
    const { data: story } = await api('POST', '/api/generate', { idea: 'Link source story', type: 'story' });
    storyFilename = story.filename;
    const { data: feature } = await api('POST', '/api/generate', { idea: 'Link target feature', type: 'feature' });
    featureFilename = feature.filename;
  });

  test('links a story to an epic and updates Epic_ID in frontmatter', async () => {
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: storyFilename,
      targetType: 'epic',  targetFilename: epicFilename,
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.field, 'Epic_ID');
    // Verify frontmatter was updated on disk
    const { data: doc } = await api('GET', `/api/doc/story/${encodeURIComponent(storyFilename)}`);
    assert.match(doc.content, new RegExp(`^Epic_ID: ${epicFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });

  test('links an epic to a feature and updates Feature_ID', async () => {
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'epic',    sourceFilename: epicFilename,
      targetType: 'feature', targetFilename: featureFilename,
    });
    assert.equal(status, 200);
    assert.equal(data.field, 'Feature_ID');
  });

  test('returns 400 for missing fields', async () => {
    const { status, data } = await api('POST', '/api/link', { sourceType: 'story' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 for invalid link direction', async () => {
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'epic', sourceFilename: epicFilename,
      targetType: 'story', targetFilename: storyFilename,
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'INVALID_LINK');
  });

  test('returns 404 when source document does not exist', async () => {
    const { status } = await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: 'nonexistent.md',
      targetType: 'epic',  targetFilename: epicFilename,
    });
    assert.equal(status, 404);
  });
});

// ── GET /api/links with linked documents ─────────────────────────────────────
describe('GET /api/links — with linked documents', () => {
  let epicFilename, storyFilename, featureFilename;

  before(async () => {
    const { data: feature } = await api('POST', '/api/generate', { idea: 'Feature for link test', type: 'feature' });
    featureFilename = feature.filename;
    const { data: epic } = await api('POST', '/api/generate', { idea: 'Epic for link test', type: 'epic' });
    epicFilename = epic.filename;
    const { data: story } = await api('POST', '/api/generate', { idea: 'Story for link test', type: 'story' });
    storyFilename = story.filename;
    // Link epic→feature and story→epic
    await api('POST', '/api/link', { sourceType: 'epic', sourceFilename: epicFilename, targetType: 'feature', targetFilename: featureFilename });
    await api('POST', '/api/link', { sourceType: 'story', sourceFilename: storyFilename, targetType: 'epic', targetFilename: epicFilename });
  });

  test('epic links show parent feature and child story', async () => {
    const { status, data } = await api('GET', `/api/links/epic/${encodeURIComponent(epicFilename)}`);
    assert.equal(status, 200);
    assert.ok(data.parent, 'should have a parent');
    assert.equal(data.parent.docType, 'feature');
    assert.equal(data.parent.filename, featureFilename);
    assert.ok(data.children.length >= 1);
    assert.ok(data.children.some(c => c.filename === storyFilename));
  });

  test('feature links show child epics', async () => {
    const { status, data } = await api('GET', `/api/links/feature/${encodeURIComponent(featureFilename)}`);
    assert.equal(status, 200);
    assert.equal(data.parent, null);
    assert.ok(data.children.some(c => c.filename === epicFilename));
  });
});

// ── POST /api/docs/batch-fix-version ─────────────────────────────────────────
describe('POST /api/docs/batch-fix-version', () => {
  let epicFilename, storyFilename;

  before(async () => {
    const { data: epic } = await api('POST', '/api/generate', { idea: 'Batch version epic', type: 'epic' });
    epicFilename = epic.filename;
    const { data: story } = await api('POST', '/api/generate', { idea: 'Batch version story', type: 'story' });
    storyFilename = story.filename;
  });

  test('updates Fix_Version on multiple documents', async () => {
    const { status, data } = await api('POST', '/api/docs/batch-fix-version', {
      fixVersion: 'PI-2026.1',
      docs: [
        { type: 'epic', filename: epicFilename },
        { type: 'story', filename: storyFilename },
      ],
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.updated, 2);
    // Verify on disk
    const { data: epicDoc } = await api('GET', `/api/doc/epic/${encodeURIComponent(epicFilename)}`);
    assert.match(epicDoc.content, /^Fix_Version: PI-2026\.1$/m);
    const { data: storyDoc } = await api('GET', `/api/doc/story/${encodeURIComponent(storyFilename)}`);
    assert.match(storyDoc.content, /^Fix_Version: PI-2026\.1$/m);
  });

  test('skips nonexistent files and still updates valid ones', async () => {
    const { status, data } = await api('POST', '/api/docs/batch-fix-version', {
      fixVersion: 'PI-2026.2',
      docs: [
        { type: 'epic', filename: epicFilename },
        { type: 'epic', filename: 'nonexistent.md' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(data.updated, 1);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].reason, 'not found');
  });

  test('clears Fix_Version to TBD when fixVersion is null', async () => {
    const { status } = await api('POST', '/api/docs/batch-fix-version', {
      fixVersion: null,
      docs: [{ type: 'epic', filename: epicFilename }],
    });
    assert.equal(status, 200);
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(epicFilename)}`);
    assert.match(doc.content, /^Fix_Version: TBD$/m);
  });

  test('returns 400 when docs array is missing', async () => {
    const { status } = await api('POST', '/api/docs/batch-fix-version', { fixVersion: 'v1' });
    assert.equal(status, 400);
  });
});

// ── PATCH /api/doc — fixVersion update ───────────────────────────────────────
describe('PATCH /api/doc/:type/:filename — fixVersion update', () => {
  let filename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', { idea: 'Fix version patch test', type: 'epic' });
    filename = data.filename;
  });

  test('sets Fix_Version in frontmatter', async () => {
    const { status, data } = await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, {
      fixVersion: 'PI-2026.3',
    });
    assert.equal(status, 200);
    assert.equal(data.fixVersion, 'PI-2026.3');
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.match(doc.content, /^Fix_Version: PI-2026\.3$/m);
  });

  test('clears Fix_Version to TBD when empty string', async () => {
    const { status } = await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, { fixVersion: '' });
    assert.equal(status, 200);
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.match(doc.content, /^Fix_Version: TBD$/m);
  });
});

// ── Phase 3 & 4 validation tests ─────────────────────────────────────────────

describe('POST /api/link — target document validation', () => {
  let epicFilename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', { idea: 'Link target epic v2', type: 'epic' });
    epicFilename = data.filename;
  });

  test('returns 404 when target document does not exist', async () => {
    const { data: story } = await api('POST', '/api/generate', { idea: 'Link source story v2', type: 'story' });
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: story.filename,
      targetType: 'epic',  targetFilename: 'nonexistent-target.md',
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });
});

describe('PUT /api/settings/pi/split-threshold — upper bound validation', () => {
  test('returns 400 when splitThreshold exceeds 50', async () => {
    const { status, data } = await api('PUT', '/api/settings/pi/split-threshold', { splitThreshold: 999 });
    assert.equal(status, 400);
    assert.ok(data.error, 'should return an error');
  });

  test('accepts a valid splitThreshold within range', async () => {
    const { status } = await api('PUT', '/api/settings/pi/split-threshold', { splitThreshold: 10 });
    assert.equal(status, 200);
  });
});

describe('PUT /api/settings/pi/sprints/:piName — sprint count validation', () => {
  test('returns 400 when more than 10 sprints are provided', async () => {
    const sprints = Array.from({ length: 11 }, (_, i) => ({ name: `Sprint ${i + 1}`, capacity: 10 }));
    const { status, data } = await api('PUT', '/api/settings/pi/sprints/myPI', { sprints });
    assert.equal(status, 400);
    assert.ok(data.error, 'should return an error');
  });
});

describe('PATCH /api/doc/:type/:filename — storyPoints validation', () => {
  let filename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', { idea: 'Story points test', type: 'story' });
    filename = data.filename;
  });

  test('returns 400 when storyPoints is negative', async () => {
    const { status, data } = await api('PATCH', `/api/doc/story/${encodeURIComponent(filename)}`, {
      storyPoints: -5,
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('accepts storyPoints of 0', async () => {
    const { status } = await api('PATCH', `/api/doc/story/${encodeURIComponent(filename)}`, { storyPoints: 0 });
    assert.equal(status, 200);
  });
});

describe('POST /api/docs/apply-distribution — entry validation', () => {
  test('returns 400 when an entry is missing the sprint field', async () => {
    const { status, data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [{ docType: 'story', filename: 'some-story.md' }],
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when sprint is not a string', async () => {
    const { status, data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [{ docType: 'story', filename: 'some-story.md', sprint: 42 }],
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });
});

// ── SSE /api/events — event types on doc creation (regression: issue #15) ────
// Verifies the server broadcasts the correct event type for each doc type so
// the client-side SSE handler can call loadDocs() → applyFilters() rather than
// bypassing applyFilters() with a direct renderSwimlanes(allDocs) call.
describe('SSE /api/events — event type per doc type', () => {
  function openSseConnection(url) {
    const events = [];
    let connectedResolve;
    const connectedPromise = new Promise(r => { connectedResolve = r; });

    const req = http.request(url, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              events.push(event);
              if (event.type === 'connected') connectedResolve();
            } catch {}
          }
        }
      });
    });
    req.on('error', () => {});
    req.end();
    return { events, waitConnected: () => connectedPromise, close: () => req.destroy() };
  }

  for (const [type, expectedEvent] of [
    ['feature', 'feature_created'],
    ['epic',    'epic_created'],
    ['story',   'story_created'],
    ['spike',   'spike_created'],
  ]) {
    test(`broadcasts ${expectedEvent} when creating a ${type}`, async () => {
      const sse = openSseConnection(`${baseUrl}/api/events`);
      await sse.waitConnected();

      const { status, data } = await api('POST', '/api/generate', {
        idea: `SSE regression test for ${type}`,
        title: `SSE ${type} test`,
        type,
      });
      assert.equal(status, 200);

      await new Promise(r => setTimeout(r, 150));
      sse.close();

      const created = sse.events.find(e => e.type === expectedEvent);
      assert.ok(created, `expected ${expectedEvent} SSE event`);
      assert.equal(created.docType, type);
      assert.equal(created.filename, data.filename);
    });
  }
});
