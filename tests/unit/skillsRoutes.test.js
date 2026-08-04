// ── Unit tests: src/routes/skills.ts ──────────────────────────────────────────
// Mounts the skills router directly on a throwaway express app with an
// isolated rootDir, so the 404 (no custom, no example file) branch and the
// broadcast/logInfo side-effects can be asserted deterministically without
// depending on this checkout's real .claude/commands state (see
// tests/integration/skills.test.js for the full-app, real-rootDir coverage).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import skillsRoutes from '../../src/routes/skills.js';

let server, baseUrl, tmpRoot;
let broadcasts;
let infoLogs;

async function api(method, urlPath, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${urlPath}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-route-test-'));
  broadcasts = [];
  infoLogs = [];

  const app = express();
  app.use(express.json());
  app.use(
    skillsRoutes({
      rootDir: tmpRoot,
      broadcast: (msg) => broadcasts.push(msg),
      callClaude: async (prompt) => `IMPROVED: ${prompt}`,
      logInfo: (scope, msg) => infoLogs.push({ scope, msg }),
    })
  );

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/skills/:name — no custom, no example file on disk', () => {
  test('returns 404 NOT_FOUND', async () => {
    const { status, data } = await api('GET', '/api/skills/create-bugs');
    assert.equal(status, 404);
    assert.equal(data.code, 'NOT_FOUND');
    assert.match(data.error, /create-bugs/);
  });
});

describe('GET /api/skills — with no files at all on disk', () => {
  test('still returns 200 with all 7 skills, each falling back to empty/example', async () => {
    const { status, data } = await api('GET', '/api/skills');
    assert.equal(status, 200);
    assert.equal(data.skills.length, 7);
    for (const skill of data.skills) {
      assert.equal(skill.source, 'example');
      assert.equal(skill.content, '');
    }
  });
});

describe('PUT /api/skills/:name — writes through to disk and broadcasts', () => {
  test('creates .claude/commands lazily and saves content', async () => {
    const content = '---\nname: create-bugs\ndescription: test\n---\nBody';
    const { status, data } = await api('PUT', '/api/skills/create-bugs', { content });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.source, 'custom');

    const filePath = path.join(tmpRoot, '.claude', 'commands', 'create-bugs.md');
    assert.equal(fs.readFileSync(filePath, 'utf-8'), content);

    assert.deepEqual(broadcasts.at(-1), { type: 'skill_updated', name: 'create-bugs' });
    assert.ok(infoLogs.some((l) => l.msg.includes('Saved skill: create-bugs')));
  });

  test('now that a custom file exists, GET returns it with source=custom', async () => {
    const { status, data } = await api('GET', '/api/skills/create-bugs');
    assert.equal(status, 200);
    assert.equal(data.source, 'custom');
  });
});

describe('DELETE /api/skills/:name — resets and broadcasts', () => {
  test('removes the custom file and reports source=example', async () => {
    const { status, data } = await api('DELETE', '/api/skills/create-bugs');
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.source, 'example');
    assert.deepEqual(broadcasts.at(-1), { type: 'skill_reset', name: 'create-bugs' });

    const filePath = path.join(tmpRoot, '.claude', 'commands', 'create-bugs.md');
    assert.equal(fs.existsSync(filePath), false);
  });
});

describe('PUT /api/skills/:name/improve — uses the injected callClaude', () => {
  test('returns the (mocked) improved content built from the prompt', async () => {
    const { status, data } = await api('PUT', '/api/skills/create-bugs/improve', {
      content: 'Original',
    });
    assert.equal(status, 200);
    assert.match(data.improved, /^IMPROVED: /);
    // buildImprovePrompt embeds the original content in the prompt it builds.
    assert.match(data.improved, /Original/);
  });

  test('returns 502 AI_ERROR when callClaude rejects', async () => {
    // Re-mount a second router instance sharing the same server isn't simple
    // with Express (routes are already registered), so we spin up a second
    // throwaway app+server just for this one failure-path assertion.
    const app2 = express();
    app2.use(express.json());
    app2.use(
      skillsRoutes({
        rootDir: tmpRoot,
        broadcast: () => {},
        callClaude: async () => {
          throw new Error('provider unavailable');
        },
        logInfo: () => {},
      })
    );
    const server2 = http.createServer(app2);
    await new Promise((resolve) => server2.listen(0, resolve));
    const port2 = server2.address().port;

    const res = await fetch(`http://localhost:${port2}/api/skills/create-bugs/improve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Original' }),
    });
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.code, 'AI_ERROR');
    assert.match(data.error, /provider unavailable/);

    await new Promise((resolve) => server2.close(resolve));
  });
});
